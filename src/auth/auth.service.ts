import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountRole, ApprovalPolicy, CompanyStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  appLinkOrigin,
  EmailSender,
  EMAIL_VERIFICATION_TTL_MS,
  INVITATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
} from './email-sender';
import { invitationEmail, passwordResetEmail, verificationEmail } from './email-content';
import { loginEmailKey, normalizeEmail } from './email';
import { assertJwtSecret } from './jwt-secret';
import { LoginRateLimiter, RateLimitError } from './login-rate-limit';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { storedCanHandle } from './handler-access';
import { toPublicAccount, PublicAccount } from './public-account';
import {
  ABSOLUTE_SESSION_MS,
  IDLE_SESSION_MS,
  newSecretToken,
  readSessionToken,
  signSessionToken,
} from './session-token';
import {
  DepartmentTemplatePreview,
  getDepartmentTemplate,
  listDepartmentTemplates,
  toTemplatePreview,
} from './department-templates';
import { hashOpaqueToken } from './token-hash';

const INVALID_LOGIN = 'Invalid email or password';
const INVALID_LINK = 'This link is invalid or expired.';
const USED_LINK = 'This link has already been used.';
export const PASSWORD_RESET_ACK =
  'If an account exists for that email, a reset link has been sent.';
const EMAIL_IN_USE = 'An account with this email already exists';
const DEPARTMENT_IN_USE = 'A department with employees or requests cannot be deleted';
const REQUEST_TYPE_IN_USE = 'A request type that is used by requests cannot be removed';
const UNKNOWN_TEMPLATE = 'Unknown department template';
const DUPLICATE_CONFIRMED_NAMES = 'Confirmed request types must not use the same name more than once';

type ConfirmedRequestType = { name: string; approvalPolicy: ApprovalPolicy };
type RequestTypeRecord = {
  id: number;
  departmentId: number;
  name: string;
  approvalPolicy: ApprovalPolicy;
};

export const DEFAULT_COMPANY_DEPARTMENTS = ['IT', 'HR', 'Finance'] as const;

const accountWithCompany = {
  include: { company: { select: { name: true, status: true } } },
} as const;

export type SessionAccount = PublicAccount & {
  sessionId: string;
  csrfToken: string;
};

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly emailSender: EmailSender,
  ) {}

  onModuleInit(): void {
    this.jwtSecret();
  }

  jwtSecret(): string {
    return assertJwtSecret(process.env.JWT_SECRET);
  }

  async login(email: unknown, password: unknown, ip: string): Promise<{
    token: string;
    account: PublicAccount;
    csrfToken: string;
  }> {
    const emailKey = loginEmailKey(email);
    let normalized: string | null = null;
    if (typeof email === 'string') {
      try {
        normalized = normalizeEmail(email);
      } catch {
        normalized = null;
      }
    }
    const passwordText = typeof password === 'string' ? password : '';

    let admitted = false;
    let settled = false;
    try {
      this.rateLimiter.admit(emailKey, ip);
      admitted = true;

      const employee = normalized
        ? await this.prisma.employee.findUnique({
            where: { email: normalized },
            ...accountWithCompany,
          })
        : null;

      if (
        !employee ||
        !employee.passwordHash ||
        !employee.active ||
        employee.company.status !== CompanyStatus.ACTIVE
      ) {
        await verifyAgainstDummy(passwordText);
        this.rateLimiter.settleFailure(emailKey, ip);
        settled = true;
        throw new UnauthorizedException(INVALID_LOGIN);
      }

      if (!(await verifyPassword(employee.passwordHash, passwordText))) {
        this.rateLimiter.settleFailure(emailKey, ip);
        settled = true;
        throw new UnauthorizedException(INVALID_LOGIN);
      }

      const createdAt = new Date();
      const absoluteExpiresAt = new Date(createdAt.getTime() + ABSOLUTE_SESSION_MS);
      const sessionId = newSecretToken();
      const csrfToken = newSecretToken();
      await this.prisma.session.create({
        data: {
          id: sessionId,
          accountId: employee.id,
          companyId: employee.companyId,
          csrfToken,
          createdAt,
          lastActivityAt: createdAt,
          absoluteExpiresAt,
        },
      });
      this.rateLimiter.settleSuccess(emailKey, ip);
      settled = true;
      return {
        token: signSessionToken(employee.id, sessionId, absoluteExpiresAt, this.jwtSecret()),
        account: toPublicAccount(employee),
        csrfToken,
      };
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    } finally {
      if (admitted && !settled) {
        this.rateLimiter.abandon(emailKey, ip);
      }
    }
  }

  async authenticate(token: string | undefined): Promise<SessionAccount> {
    if (!token) {
      throw new UnauthorizedException('Authentication is required');
    }
    let claims;
    try {
      claims = readSessionToken(token, this.jwtSecret());
    } catch {
      throw new UnauthorizedException('Authentication is required');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: claims.jti },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            email: true,
            companyId: true,
            departmentId: true,
            role: true,
            canHandle: true,
            active: true,
            company: { select: { name: true, status: true } },
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.accountId !== claims.sub ||
      session.companyId !== session.account.companyId
    ) {
      throw new UnauthorizedException('Authentication is required');
    }

    const now = Date.now();
    if (
      session.absoluteExpiresAt.getTime() <= now ||
      now - session.lastActivityAt.getTime() >= IDLE_SESSION_MS
    ) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Authentication is required');
    }

    if (!session.account.active || session.account.company.status !== CompanyStatus.ACTIVE) {
      throw new UnauthorizedException('Authentication is required');
    }

    return {
      ...toPublicAccount(session.account),
      sessionId: session.id,
      csrfToken: session.csrfToken,
    };
  }

  async touchActivity(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastActivityAt: new Date() },
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async signupEmailAvailability(emailInput: string, ip: string): Promise<{ available: boolean }> {
    try {
      this.rateLimiter.noteProbe(ip);
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }
    const email = normalizeEmail(emailInput);
    const existing = await this.prisma.employee.findUnique({
      where: { email },
      select: { id: true },
    });
    return { available: existing === null };
  }

  async signupCompany(input: {
    companyName: string;
    name: string;
    email: string;
    password: string;
    departments?: {
      name: string;
      requestTypes: { name: string; approvalPolicy: 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' }[];
    }[];
  }): Promise<{ pending: true; companyName: string; email: string }> {
    const email = normalizeEmail(input.email);
    const companyName = input.companyName.trim();
    const name = input.name.trim();
    if (companyName.length === 0 || companyName.length > 200) {
      throw new BadRequestException('companyName is required');
    }
    if (name.length === 0 || name.length > 200) {
      throw new BadRequestException('name is required');
    }
    if (input.password.length < 12) {
      throw new BadRequestException('password must be at least 12 characters');
    }

    this.emailSender.assertCanSend();
    const passwordHash = await hashPassword(input.password);
    const rawToken = newSecretToken();
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { name: companyName, status: CompanyStatus.PENDING },
        });
        const departments =
          input.departments === undefined
            ? DEFAULT_COMPANY_DEPARTMENTS.map((departmentName) => ({
                name: departmentName,
                requestTypes: [] as ConfirmedRequestType[],
              }))
            : this.confirmedSignupDepartments(input.departments);
        for (const department of departments) {
          const created = await tx.department.create({
            data: { name: department.name, companyId: company.id },
            select: { id: true },
          });
          await this.insertConfirmedTypes(tx, created.id, company.id, department.requestTypes);
        }
        const account = await tx.employee.create({
          data: {
            name,
            email,
            companyId: company.id,
            departmentId: null,
            passwordHash,
            role: AccountRole.SUPER_ADMIN,
            canHandle: storedCanHandle(AccountRole.SUPER_ADMIN, false),
            active: false,
          },
        });
        await tx.emailVerification.create({
          data: {
            tokenHash: hashOpaqueToken(rawToken),
            companyId: company.id,
            accountId: account.id,
            expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
          },
        });
        const verification = verificationEmail({
          companyName,
          verifyUrl: `${appLinkOrigin()}/?verify=${encodeURIComponent(rawToken)}`,
        });
        await this.emailSender.send({
          to: email,
          purpose: 'email-verification',
          ...verification,
          token: rawToken,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(EMAIL_IN_USE);
      }
      throw error;
    }
    return { pending: true, companyName, email };
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const tokenHash = hashOpaqueToken(token);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.emailVerification.findUnique({ where: { tokenHash } });
      if (!row) {
        throw new BadRequestException(INVALID_LINK);
      }
      if (row.usedAt) {
        throw new BadRequestException(USED_LINK);
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        throw new BadRequestException(INVALID_LINK);
      }
      const claimed = await tx.emailVerification.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        const again = await tx.emailVerification.findUnique({ where: { tokenHash } });
        if (again?.usedAt) {
          throw new BadRequestException(USED_LINK);
        }
        throw new BadRequestException(INVALID_LINK);
      }
      await tx.company.update({
        where: { id: row.companyId },
        data: { status: CompanyStatus.ACTIVE },
      });
      await tx.employee.update({
        where: { id: row.accountId },
        data: { active: true },
      });
    });
    return { verified: true };
  }

  listDepartmentTemplates(actor: SessionAccount): DepartmentTemplatePreview[] {
    this.assertCompanySuperAdmin(actor);
    return listDepartmentTemplates().map(toTemplatePreview);
  }

  previewDepartmentTemplate(actor: SessionAccount, id: string): DepartmentTemplatePreview {
    this.assertCompanySuperAdmin(actor);
    const template = getDepartmentTemplate(id);
    if (!template) {
      throw new NotFoundException(`Department template ${id} was not found`);
    }
    return toTemplatePreview(template);
  }

  async createDepartment(
    actor: SessionAccount,
    input: { name: string; templateId?: string; requestTypes?: ConfirmedRequestType[] },
  ): Promise<{ id: number; name: string; requestTypes: RequestTypeRecord[] }> {
    this.assertCompanySuperAdmin(actor);
    this.requireKnownTemplateId(input.templateId);
    const name = this.requireDepartmentName(input.name);
    const confirmed = this.normalizeConfirmedTypes(input.requestTypes ?? []);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.create({
        data: { name, companyId: actor.companyId },
        select: { id: true, name: true },
      });
      const requestTypes = await this.insertConfirmedTypes(
        tx,
        department.id,
        actor.companyId,
        confirmed,
      );
      return { ...department, requestTypes };
    });
  }

  async applyDepartmentTemplateTypes(
    actor: SessionAccount,
    departmentId: number,
    input: { templateId?: string; requestTypes: ConfirmedRequestType[] },
  ): Promise<{ id: number; name: string; requestTypes: RequestTypeRecord[] }> {
    this.assertCompanySuperAdmin(actor);
    this.requireKnownTemplateId(input.templateId);
    const confirmed = this.normalizeConfirmedTypes(input.requestTypes);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.findFirst({
        where: { id: departmentId, companyId: actor.companyId },
        select: { id: true, name: true },
      });
      if (!department) {
        throw new NotFoundException(`Department ${departmentId} was not found`);
      }
      await this.insertConfirmedTypes(tx, department.id, actor.companyId, confirmed);
      const requestTypes = await tx.requestType.findMany({
        where: { departmentId: department.id, companyId: actor.companyId },
        select: { id: true, departmentId: true, name: true, approvalPolicy: true },
        orderBy: { id: 'asc' },
      });
      return { ...department, requestTypes };
    });
  }

  async updateDepartment(
    actor: SessionAccount,
    id: number,
    name: string,
  ): Promise<{ id: number; name: string }> {
    await this.assertCanRenameDepartment(actor, id);
    const trimmed = this.requireDepartmentName(name);
    const updated = await this.prisma.department.updateMany({
      where: { id, companyId: actor.companyId },
      data: { name: trimmed },
    });
    if (updated.count !== 1) {
      throw new NotFoundException(`Department ${id} was not found`);
    }
    return { id, name: trimmed };
  }

  async deleteDepartment(actor: SessionAccount, id: number): Promise<{ deleted: true }> {
    this.assertCompanySuperAdmin(actor);
    const department = await this.prisma.department.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true },
    });
    if (!department) {
      throw new NotFoundException(`Department ${id} was not found`);
    }
    const [employees, requests] = await Promise.all([
      this.prisma.employee.count({ where: { departmentId: id, companyId: actor.companyId } }),
      this.prisma.request.count({ where: { departmentId: id, companyId: actor.companyId } }),
    ]);
    if (employees > 0 || requests > 0) {
      throw new ConflictException(DEPARTMENT_IN_USE);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.requestType.deleteMany({
          where: { departmentId: id, companyId: actor.companyId },
        });
        await tx.department.delete({ where: { id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(DEPARTMENT_IN_USE);
      }
      throw error;
    }
    return { deleted: true };
  }

  async createRequestType(
    actor: SessionAccount,
    departmentId: number,
    name: string,
    approvalPolicy: ApprovalPolicy,
  ): Promise<{ id: number; departmentId: number; name: string; approvalPolicy: ApprovalPolicy }> {
    this.assertCompanySuperAdmin(actor);
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!department) {
      throw new NotFoundException(`Department ${departmentId} was not found`);
    }
    const created = await this.insertConfirmedTypes(this.prisma, departmentId, actor.companyId, [
      { name: this.requireDepartmentName(name), approvalPolicy },
    ]);
    return created[0]!;
  }

  async updateRequestType(
    actor: SessionAccount,
    id: number,
    input: { name?: string; approvalPolicy?: ApprovalPolicy },
  ): Promise<{ id: number; departmentId: number; name: string; approvalPolicy: ApprovalPolicy }> {
    this.assertCompanySuperAdmin(actor);
    const existing = await this.prisma.requestType.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, departmentId: true, name: true, approvalPolicy: true },
    });
    if (!existing) {
      throw new NotFoundException(`Request type ${id} was not found`);
    }
    if (input.name === undefined && input.approvalPolicy === undefined) {
      throw new BadRequestException('name or approvalPolicy is required');
    }
    if (input.name !== undefined) {
      const nextName = this.requireDepartmentName(input.name);
      const clash = await this.prisma.requestType.findFirst({
        where: {
          departmentId: existing.departmentId,
          companyId: actor.companyId,
          id: { not: id },
          name: { equals: nextName, mode: 'insensitive' },
        },
        select: { name: true },
      });
      if (clash) {
        throw new ConflictException(this.duplicateTypeNameMessage(clash.name));
      }
    }
    const updated = await this.prisma.requestType.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: this.requireDepartmentName(input.name) } : {}),
        ...(input.approvalPolicy !== undefined ? { approvalPolicy: input.approvalPolicy } : {}),
      },
      select: { id: true, departmentId: true, name: true, approvalPolicy: true },
    });
    return updated;
  }

  async deleteRequestType(actor: SessionAccount, id: number): Promise<{ deleted: true }> {
    this.assertCompanySuperAdmin(actor);
    const existing = await this.prisma.requestType.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Request type ${id} was not found`);
    }
    const used = await this.prisma.request.count({
      where: { requestTypeId: id, companyId: actor.companyId },
    });
    if (used > 0) {
      throw new ConflictException(REQUEST_TYPE_IN_USE);
    }
    try {
      await this.prisma.requestType.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(REQUEST_TYPE_IN_USE);
      }
      throw error;
    }
    return { deleted: true };
  }

  private confirmedSignupDepartments(
    departments: {
      name: string;
      requestTypes: { name: string; approvalPolicy: 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' }[];
    }[],
  ): { name: string; requestTypes: ConfirmedRequestType[] }[] {
    const seen = new Set<string>();
    return departments.map((department) => {
      const name = this.requireDepartmentName(department.name);
      const key = name.toLowerCase();
      if (seen.has(key)) {
        throw new ConflictException('Department names must be unique');
      }
      seen.add(key);
      return {
        name,
        requestTypes: this.normalizeConfirmedTypes(
          department.requestTypes.map((item) => ({
            name: item.name,
            approvalPolicy: item.approvalPolicy as ApprovalPolicy,
          })),
        ),
      };
    });
  }

  private requireDepartmentName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new BadRequestException('name is required');
    }
    return trimmed;
  }

  private requireKnownTemplateId(templateId: string | undefined): void {
    if (templateId !== undefined && getDepartmentTemplate(templateId) == null) {
      throw new BadRequestException(UNKNOWN_TEMPLATE);
    }
  }

  private normalizeConfirmedTypes(items: ConfirmedRequestType[]): ConfirmedRequestType[] {
    return items.map((item) => ({
      name: this.requireDepartmentName(item.name),
      approvalPolicy: item.approvalPolicy,
    }));
  }

  private assertUniqueConfirmedNames(items: ConfirmedRequestType[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) {
        throw new ConflictException(DUPLICATE_CONFIRMED_NAMES);
      }
      seen.add(key);
    }
  }

  private duplicateTypeNameMessage(name: string): string {
    return `A request type named "${name}" already exists in this department`;
  }

  private async insertConfirmedTypes(
    tx: Prisma.TransactionClient | PrismaService,
    departmentId: number,
    companyId: number,
    items: ConfirmedRequestType[],
  ): Promise<RequestTypeRecord[]> {
    this.assertUniqueConfirmedNames(items);
    const created: RequestTypeRecord[] = [];
    for (const item of items) {
      const existing = await tx.requestType.findFirst({
        where: {
          departmentId,
          companyId,
          name: { equals: item.name, mode: 'insensitive' },
        },
        select: { name: true },
      });
      if (existing) {
        throw new ConflictException(this.duplicateTypeNameMessage(existing.name));
      }
      created.push(
        await tx.requestType.create({
          data: {
            name: item.name,
            approvalPolicy: item.approvalPolicy,
            departmentId,
            companyId,
          },
          select: { id: true, departmentId: true, name: true, approvalPolicy: true },
        }),
      );
    }
    return created;
  }

  async inviteStaff(
    actor: SessionAccount,
    input: {
      email: string;
      name: string;
      departmentId: number;
      role: AccountRole;
      canHandle: boolean;
    },
  ): Promise<PublicAccount> {
    const invite = await this.resolveStaffInvite(actor, input);
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    if (name.length === 0 || name.length > 200) {
      throw new BadRequestException('name is required');
    }
    const department = await this.prisma.department.findFirst({
      where: { id: invite.departmentId, companyId: actor.companyId },
    });
    if (!department) {
      throw new BadRequestException(`Department ${invite.departmentId} was not found`);
    }

    this.emailSender.assertCanSend();
    const rawToken = newSecretToken();
    const now = new Date();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const account = await tx.employee.create({
          data: {
            name,
            email,
            companyId: actor.companyId,
            departmentId: invite.departmentId,
            passwordHash: null,
            role: invite.role,
            canHandle: invite.canHandle,
            active: false,
          },
          include: { company: { select: { name: true, status: true } } },
        });
        await tx.invitation.create({
          data: {
            tokenHash: hashOpaqueToken(rawToken),
            companyId: actor.companyId,
            accountId: account.id,
            invitedById: actor.id,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          },
        });
        const invitation = invitationEmail({
          companyName: account.company.name,
          inviteUrl: `${appLinkOrigin()}/?invite=${encodeURIComponent(rawToken)}`,
        });
        await this.emailSender.send({
          to: email,
          purpose: 'invitation',
          ...invitation,
          token: rawToken,
        });
        return account;
      });
      return toPublicAccount(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(EMAIL_IN_USE);
      }
      throw error;
    }
  }

  async acceptInvitation(token: string, password: string): Promise<{ accepted: true }> {
    if (password.length < 12) {
      throw new BadRequestException('password must be at least 12 characters');
    }
    const tokenHash = hashOpaqueToken(token);
    const now = new Date();
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.invitation.findUnique({
        where: { tokenHash },
        include: { company: { select: { status: true } } },
      });
      if (!row || row.company.status !== CompanyStatus.ACTIVE) {
        throw new BadRequestException(INVALID_LINK);
      }
      if (row.usedAt) {
        throw new BadRequestException(USED_LINK);
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        throw new BadRequestException(INVALID_LINK);
      }
      const claimed = await tx.invitation.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        const again = await tx.invitation.findUnique({ where: { tokenHash } });
        if (again?.usedAt) {
          throw new BadRequestException(USED_LINK);
        }
        throw new BadRequestException(INVALID_LINK);
      }
      await tx.employee.update({
        where: { id: row.accountId },
        data: { passwordHash, active: true },
      });
    });
    return { accepted: true };
  }

  async requestPasswordReset(emailInput: string): Promise<{ sent: true; message: string }> {
    this.emailSender.assertCanSend();
    let email: string;
    try {
      email = normalizeEmail(emailInput);
    } catch (error) {
      if (error instanceof BadRequestException) {
        return { sent: true, message: PASSWORD_RESET_ACK };
      }
      throw error;
    }
    const employee = await this.prisma.employee.findUnique({
      where: { email },
      include: { company: { select: { status: true } } },
    });
    if (
      !employee?.passwordHash ||
      !employee.active ||
      employee.company.status !== CompanyStatus.ACTIVE
    ) {
      return { sent: true, message: PASSWORD_RESET_ACK };
    }

    const rawToken = newSecretToken();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.updateMany({
        where: { accountId: employee.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordReset.create({
        data: {
          tokenHash: hashOpaqueToken(rawToken),
          companyId: employee.companyId,
          accountId: employee.id,
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        },
      });
      const reset = passwordResetEmail({
        resetUrl: `${appLinkOrigin()}/?reset=${encodeURIComponent(rawToken)}`,
      });
      await this.emailSender.send({
        to: email,
        purpose: 'password-reset',
        ...reset,
        token: rawToken,
      });
    });
    return { sent: true, message: PASSWORD_RESET_ACK };
  }

  async resetPassword(token: string, password: string): Promise<{ reset: true }> {
    if (password.length < 12) {
      throw new BadRequestException('password must be at least 12 characters');
    }
    const tokenHash = hashOpaqueToken(token);
    const now = new Date();
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.passwordReset.findUnique({
        where: { tokenHash },
        include: { account: { select: { active: true } }, company: { select: { status: true } } },
      });
      if (
        !row ||
        !row.account.active ||
        row.company.status !== CompanyStatus.ACTIVE
      ) {
        throw new BadRequestException(INVALID_LINK);
      }
      if (row.usedAt) {
        throw new BadRequestException(USED_LINK);
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        throw new BadRequestException(INVALID_LINK);
      }
      const claimed = await tx.passwordReset.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        const again = await tx.passwordReset.findUnique({ where: { tokenHash } });
        if (again?.usedAt) {
          throw new BadRequestException(USED_LINK);
        }
        throw new BadRequestException(INVALID_LINK);
      }
      await tx.employee.update({
        where: { id: row.accountId },
        data: { passwordHash },
      });
      await tx.session.updateMany({
        where: { accountId: row.accountId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    return { reset: true };
  }

  private async resolveStaffInvite(
    actor: SessionAccount,
    input: { departmentId: number; role: AccountRole; canHandle: boolean },
  ): Promise<{ departmentId: number; role: AccountRole; canHandle: boolean }> {
    if (actor.role === AccountRole.DEPARTMENT_ADMIN) {
      if (actor.departmentId == null) {
        throw new ForbiddenException('You are not assigned to a department');
      }
      if (input.role !== AccountRole.EMPLOYEE) {
        throw new ForbiddenException('You can only invite employees');
      }
      if (input.departmentId !== actor.departmentId) {
        const inCompany = await this.prisma.department.findFirst({
          where: { id: input.departmentId, companyId: actor.companyId },
          select: { id: true },
        });
        if (!inCompany) {
          throw new BadRequestException(`Department ${input.departmentId} was not found`);
        }
        throw new ForbiddenException('You can only invite staff into your own department');
      }
      return {
        departmentId: actor.departmentId,
        role: AccountRole.EMPLOYEE,
        canHandle: input.canHandle,
      };
    }
    if (actor.role !== AccountRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a Super Admin can manage this company');
    }
    return {
      departmentId: input.departmentId,
      role: input.role,
      canHandle: storedCanHandle(input.role, input.canHandle),
    };
  }

  async updateProfile(actor: SessionAccount, name: string): Promise<PublicAccount> {
    const updated = await this.prisma.employee.update({
      where: { id: actor.id },
      data: { name },
      include: { company: { select: { name: true } } },
    });
    return toPublicAccount(updated);
  }

  async changePassword(
    actor: SessionAccount,
    input: { currentPassword: string; newPassword: string; confirmPassword: string },
  ): Promise<{ changed: true }> {
    if (input.newPassword !== input.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    const account = await this.prisma.employee.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true },
    });
    const matches = account?.passwordHash
      ? await verifyPassword(account.passwordHash, input.currentPassword)
      : false;
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(input.newPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: actor.id },
        data: { passwordHash },
      }),
      this.prisma.session.updateMany({
        where: { accountId: actor.id, revokedAt: null, id: { not: actor.sessionId } },
        data: { revokedAt: now },
      }),
    ]);
    return { changed: true };
  }

  async updateCompany(actor: SessionAccount, name: string): Promise<PublicAccount> {
    this.assertCompanySuperAdmin(actor);
    await this.prisma.company.update({
      where: { id: actor.companyId },
      data: { name },
    });
    const account = await this.prisma.employee.findUniqueOrThrow({
      where: { id: actor.id },
      include: { company: { select: { name: true } } },
    });
    return toPublicAccount(account);
  }

  assertCompanySuperAdmin(actor: SessionAccount): void {
    if (actor.role !== AccountRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a Super Admin can manage this company');
    }
  }

  private async assertCanRenameDepartment(actor: SessionAccount, id: number): Promise<void> {
    if (actor.role === AccountRole.SUPER_ADMIN) {
      return;
    }
    if (actor.role !== AccountRole.DEPARTMENT_ADMIN) {
      throw new ForbiddenException('Only a Super Admin can manage this company');
    }
    if (actor.departmentId == null) {
      throw new ForbiddenException('You are not assigned to a department');
    }
    if (id === actor.departmentId) {
      return;
    }
    const inCompany = await this.prisma.department.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true },
    });
    if (!inCompany) {
      throw new NotFoundException(`Department ${id} was not found`);
    }
    throw new ForbiddenException('You can only edit your own department');
  }
}
