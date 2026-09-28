import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AccountRole, ApprovalPolicy, ApprovalState, Prisma, RequestStatus } from '@prisma/client';
import { AuthService, SessionAccount } from '../auth/auth.service';
import { storedCanHandle } from '../auth/handler-access';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApprovalCounts,
  countApprovals,
  countMyRequests,
  countPeople,
  countRequestWork,
  eligibleApprovalScope,
  MyRequestCounts,
  PeopleCounts,
  RequestWorkCounts,
} from '../requests/dashboard-counts';
import { RequestsService } from '../requests/requests.service';
import { ListDepartmentRequestsQueryDto } from './dto/department-admin.query';
import { UpdateCompanyEmployeeDto, UpdateDepartmentEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees.query';
import { ListCompanyRequestsQueryDto } from './dto/list-requests.query';

export type CompanyDashboardCounts = {
  people: PeopleCounts;
  requests: RequestWorkCounts;
  approvals: ApprovalCounts;
  departments: number;
  myRequests: MyRequestCounts;
};

export type CompanyEmployee = {
  id: number;
  name: string;
  email: string | null;
  department: { id: number; name: string } | null;
  role: AccountRole;
  canHandle: boolean;
  active: boolean;
};

export type CompanyRequestListItem = {
  id: number;
  title: string | null;
  status: RequestStatus;
  submitter: { name: string };
  submitterDepartment: { name: string } | null;
  department: { name: string };
  mine: boolean;
};

export type CompanyRequestList = {
  items: CompanyRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const employeePublicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  canHandle: true,
  active: true,
  department: { select: { id: true, name: true } },
} as const;

const requestListSelect = {
  id: true,
  title: true,
  status: true,
  submittedBy: true,
  submitter: {
    select: {
      name: true,
      department: { select: { name: true } },
    },
  },
  department: { select: { name: true } },
} as const;

const DEFAULT_PAGE_SIZE = 20;

export type DepartmentRequestListItem = {
  id: number;
  title: string | null;
  submittedAt: string;
  approvalState: ApprovalState | null;
  capturedApprovalPolicy: ApprovalPolicy | null;
  currentOwnerId: number | null;
  status: RequestStatus;
  submitter: { id: number; name: string };
  department: { id: number; name: string };
  canOpen: boolean;
};

export type DepartmentRequestList = {
  items: DepartmentRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly requestsService: RequestsService,
  ) {}

  async dashboard(actor: SessionAccount): Promise<CompanyDashboardCounts> {
    this.authService.assertCompanySuperAdmin(actor);
    const companyId = actor.companyId;
    const requestScope = { companyId };
    const [people, requests, approvals, departments, myRequests] = await Promise.all([
      countPeople(this.prisma, { companyId }),
      countRequestWork(this.prisma, requestScope),
      countApprovals(this.prisma, eligibleApprovalScope(actor)),
      this.prisma.department.count({ where: { companyId } }),
      countMyRequests(this.prisma, companyId, actor.id),
    ]);
    return { people, requests, approvals, departments, myRequests };
  }

  async listEmployees(actor: SessionAccount, query: ListEmployeesQueryDto): Promise<CompanyEmployee[]> {
    this.authService.assertCompanySuperAdmin(actor);
    const where: Prisma.EmployeeWhereInput = { companyId: actor.companyId };
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.departmentId != null) {
      where.departmentId = query.departmentId;
    }
    if (query.role === 'ADMIN') {
      where.role = { in: [AccountRole.SUPER_ADMIN, AccountRole.DEPARTMENT_ADMIN] };
    } else if (query.role) {
      where.role = query.role;
    }
    if (query.canHandle != null) {
      where.canHandle = query.canHandle;
    }
    if (query.active != null) {
      where.active = query.active;
    }
    const rows = await this.prisma.employee.findMany({
      where,
      select: employeePublicSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      department: row.department,
      role: row.role,
      canHandle: row.canHandle,
      active: row.active,
    }));
  }

  async departmentDashboard(actor: SessionAccount) {
    const departmentId = this.requireDepartmentAdmin(actor);
    const destination = { companyId: actor.companyId, departmentId };
    const [people, departmentAdmins, requests, approvals, myRequests] = await Promise.all([
      countPeople(this.prisma, { companyId: actor.companyId, departmentId }),
      this.prisma.employee.count({
        where: { companyId: actor.companyId, departmentId, role: AccountRole.DEPARTMENT_ADMIN },
      }),
      countRequestWork(this.prisma, destination),
      countApprovals(this.prisma, eligibleApprovalScope(actor)),
      countMyRequests(this.prisma, actor.companyId, actor.id),
    ]);
    return {
      departmentId,
      people: { ...people, admins: departmentAdmins },
      requests,
      approvals,
      myRequests,
    };
  }

  async listDepartmentRequests(
    actor: SessionAccount,
    query: ListDepartmentRequestsQueryDto,
  ): Promise<DepartmentRequestList> {
    const departmentId = this.requireDepartmentAdmin(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.RequestWhereInput = { companyId: actor.companyId, departmentId };
    if (query.status === 'ACTIVE') {
      where.status = { in: [RequestStatus.SUBMITTED, RequestStatus.IN_PROGRESS] };
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.assignment === 'unassigned') {
      where.currentOwnerId = null;
    } else if (query.assignment === 'assigned') {
      where.currentOwnerId = { not: null };
    }
    if (query.q) {
      const search: Prisma.RequestWhereInput[] = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { submitter: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
      const asId = Number(query.q);
      if (Number.isInteger(asId) && asId > 0 && String(asId) === query.q) {
        search.push({ id: asId });
      }
      where.OR = search;
    }
    const [total, rows] = await Promise.all([
      this.prisma.request.count({ where }),
      this.prisma.request.findMany({
        where,
        select: {
          id: true,
          title: true,
          submittedAt: true,
          approvalState: true,
          capturedApprovalPolicy: true,
          currentOwnerId: true,
          status: true,
          submittedBy: true,
          companyId: true,
          departmentId: true,
          submitter: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
        orderBy: [{ statusUpdatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        submittedAt: row.submittedAt.toISOString(),
        approvalState: row.approvalState,
        capturedApprovalPolicy: row.capturedApprovalPolicy,
        currentOwnerId: row.currentOwnerId,
        status: row.status,
        submitter: row.submitter,
        department: row.department,
        canOpen: this.requestsService.viewerCanOpen(actor, row),
      })),
      total,
      page,
      pageSize,
    };
  }

  async listDepartmentEmployees(
    actor: SessionAccount,
    query: { canHandle?: boolean; role?: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' | 'ADMIN' },
  ): Promise<CompanyEmployee[]> {
    const departmentId = this.requireDepartmentAdmin(actor);
    const where: Prisma.EmployeeWhereInput = { companyId: actor.companyId, departmentId };
    if (query.canHandle != null) {
      where.canHandle = query.canHandle;
    }
    if (query.role === 'ADMIN') {
      where.role = { in: [AccountRole.SUPER_ADMIN, AccountRole.DEPARTMENT_ADMIN] };
    } else if (query.role) {
      where.role = query.role;
    }
    const rows = await this.prisma.employee.findMany({
      where,
      select: employeePublicSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      department: row.department,
      role: row.role,
      canHandle: row.canHandle,
      active: row.active,
    }));
  }

  private requireDepartmentAdmin(actor: SessionAccount) {
    if (actor.role !== AccountRole.DEPARTMENT_ADMIN) {
      throw new ForbiddenException('Only a Department Admin can view this department');
    }
    if (actor.departmentId == null) {
      throw new ForbiddenException('You are not assigned to a department');
    }
    return actor.departmentId;
  }

  async departmentOverview(actor: SessionAccount) {
    this.authService.assertCompanySuperAdmin(actor);
    const companyId = actor.companyId;
    const [departments, employees, requests] = await Promise.all([
      this.prisma.department.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.employee.findMany({
        where: { companyId, departmentId: { not: null } },
        select: { departmentId: true, name: true, role: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.request.findMany({
        where: { companyId },
        select: { departmentId: true, approvalState: true, capturedApprovalPolicy: true },
      }),
    ]);
    return {
      items: departments.map((department) => {
        const members = employees.filter((employee) => employee.departmentId === department.id);
        const destination = requests.filter((row) => row.departmentId === department.id);
        return {
          id: department.id,
          name: department.name,
          employees: members.length,
          departmentAdmins: members
            .filter((employee) => employee.role === AccountRole.DEPARTMENT_ADMIN)
            .map((employee) => employee.name),
          requests: destination.length,
          awaitingApproval: destination.filter(
            (row) =>
              row.approvalState === ApprovalState.PENDING ||
              (row.approvalState == null &&
                (row.capturedApprovalPolicy === ApprovalPolicy.DEPARTMENT_ADMIN ||
                  row.capturedApprovalPolicy === ApprovalPolicy.SUPER_ADMIN)),
          ).length,
        };
      }),
    };
  }

  async listRequests(actor: SessionAccount, query: ListCompanyRequestsQueryDto): Promise<CompanyRequestList> {
    this.authService.assertCompanySuperAdmin(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.RequestWhereInput = { companyId: actor.companyId };
    if (query.scope === 'mine') {
      where.submittedBy = actor.id;
    }
    if (query.departmentId != null) {
      where.departmentId = query.departmentId;
    }
    if (query.status === 'ACTIVE') {
      where.status = { in: [RequestStatus.SUBMITTED, RequestStatus.IN_PROGRESS] };
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.assignment === 'unassigned') {
      where.currentOwnerId = null;
    } else if (query.assignment === 'assigned') {
      where.currentOwnerId = { not: null };
    }
    if (query.q) {
      const search: Prisma.RequestWhereInput[] = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { submitter: { name: { contains: query.q, mode: 'insensitive' } } },
        { submitter: { department: { name: { contains: query.q, mode: 'insensitive' } } } },
        { department: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
      const asId = Number(query.q);
      if (Number.isInteger(asId) && asId > 0 && String(asId) === query.q) {
        search.push({ id: asId });
      }
      where.OR = search;
    }
    const [total, rows] = await Promise.all([
      this.prisma.request.count({ where }),
      this.prisma.request.findMany({
        where,
        select: requestListSelect,
        orderBy: [{ statusUpdatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        submitter: { name: row.submitter.name },
        submitterDepartment: row.submitter.department,
        department: { name: row.department.name },
        mine: row.submittedBy === actor.id,
      })),
      total,
      page,
      pageSize,
    };
  }

  async updateCompanyEmployee(
    actor: SessionAccount,
    id: number,
    input: UpdateCompanyEmployeeDto,
  ): Promise<CompanyEmployee> {
    this.authService.assertCompanySuperAdmin(actor);
    if (
      input.name === undefined &&
      input.departmentId === undefined &&
      input.role === undefined &&
      input.canHandle === undefined &&
      input.active === undefined
    ) {
      throw new BadRequestException('No staff changes were provided');
    }
    const existing = await this.findCompanyEmployee(actor, id);
    if (existing.id === actor.id && (input.role !== undefined && input.role !== existing.role || input.active === false)) {
      throw new ForbiddenException('You cannot change your own access');
    }
    const role = input.role ?? existing.role;
    const departmentId = input.departmentId !== undefined ? input.departmentId : existing.department?.id ?? null;
    if (role !== AccountRole.SUPER_ADMIN && departmentId == null) {
      throw new BadRequestException('departmentId is required');
    }
    if (departmentId != null) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!department) {
        throw new BadRequestException(`Department ${departmentId} was not found`);
      }
    }
    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (name.length === 0 || name.length > 200) {
      throw new BadRequestException('name is required');
    }
    const active = input.active ?? existing.active;
    if (existing.role === AccountRole.SUPER_ADMIN && (role !== AccountRole.SUPER_ADMIN || (existing.active && !active))) {
      await this.assertAnotherActiveSuperAdmin(actor.companyId, existing.id);
    }
    if (existing.active && !active) {
      await this.assertNoUnfinishedWork(actor.companyId, existing.id);
    }
    const updated = await this.prisma.employee.update({
      where: { id: existing.id },
      data: {
        name,
        departmentId,
        role,
        canHandle: storedCanHandle(role, input.canHandle ?? existing.canHandle),
        active,
      },
      select: employeePublicSelect,
    });
    if (existing.active && !active) {
      await this.revokeAccess(existing.id);
    }
    return this.toCompanyEmployee(updated);
  }

  async updateDepartmentEmployee(
    actor: SessionAccount,
    id: number,
    input: UpdateDepartmentEmployeeDto,
  ): Promise<CompanyEmployee> {
    if (input.name === undefined && input.canHandle === undefined) {
      throw new BadRequestException('No staff changes were provided');
    }
    const existing = await this.findDepartmentEmployee(actor, id);
    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (name.length === 0 || name.length > 200) {
      throw new BadRequestException('name is required');
    }
    const updated = await this.prisma.employee.update({
      where: { id: existing.id },
      data: {
        name,
        canHandle: storedCanHandle(existing.role, input.canHandle ?? existing.canHandle),
      },
      select: employeePublicSelect,
    });
    return this.toCompanyEmployee(updated);
  }

  async deactivateCompanyEmployee(actor: SessionAccount, id: number): Promise<CompanyEmployee> {
    this.authService.assertCompanySuperAdmin(actor);
    const existing = await this.findCompanyEmployee(actor, id);
    return this.deactivateEmployee(actor, existing);
  }

  async deactivateDepartmentEmployee(actor: SessionAccount, id: number): Promise<CompanyEmployee> {
    const existing = await this.findDepartmentEmployee(actor, id);
    return this.deactivateEmployee(actor, existing);
  }

  private async deactivateEmployee(
    actor: SessionAccount,
    existing: CompanyEmployee & { id: number },
  ): Promise<CompanyEmployee> {
    if (existing.id === actor.id) {
      throw new ForbiddenException('You cannot remove your own account');
    }
    if (existing.role === AccountRole.SUPER_ADMIN && existing.active) {
      await this.assertAnotherActiveSuperAdmin(actor.companyId, existing.id);
    }
    if (existing.active) {
      await this.assertNoUnfinishedWork(actor.companyId, existing.id);
    }
    await this.prisma.employee.update({
      where: { id: existing.id },
      data: { active: false },
    });
    await this.revokeAccess(existing.id);
    const updated = await this.prisma.employee.findFirstOrThrow({
      where: { id: existing.id },
      select: employeePublicSelect,
    });
    return this.toCompanyEmployee(updated);
  }

  private async findCompanyEmployee(actor: SessionAccount, id: number) {
    const row = await this.prisma.employee.findFirst({
      where: { id, companyId: actor.companyId },
      select: employeePublicSelect,
    });
    if (!row) {
      throw new BadRequestException(`Employee ${id} was not found`);
    }
    return this.toCompanyEmployee(row);
  }

  private async findDepartmentEmployee(actor: SessionAccount, id: number) {
    const departmentId = this.requireDepartmentAdmin(actor);
    const row = await this.prisma.employee.findFirst({
      where: { id, companyId: actor.companyId },
      select: employeePublicSelect,
    });
    if (!row) {
      throw new BadRequestException(`Employee ${id} was not found`);
    }
    if (row.department?.id !== departmentId || row.role !== AccountRole.EMPLOYEE) {
      throw new ForbiddenException('You can only manage employees in your department');
    }
    return this.toCompanyEmployee(row);
  }

  private async assertAnotherActiveSuperAdmin(companyId: number, exceptId: number) {
    const others = await this.prisma.employee.count({
      where: {
        companyId,
        role: AccountRole.SUPER_ADMIN,
        active: true,
        id: { not: exceptId },
      },
    });
    if (others === 0) {
      throw new ConflictException('The last Super Admin cannot be removed');
    }
  }

  private async assertNoUnfinishedWork(companyId: number, accountId: number) {
    const owned = await this.prisma.request.count({
      where: {
        companyId,
        currentOwnerId: accountId,
        status: { in: [RequestStatus.SUBMITTED, RequestStatus.IN_PROGRESS] },
      },
    });
    if (owned > 0) {
      throw new ConflictException('This account still owns unfinished work');
    }
  }

  private async revokeAccess(accountId: number) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.invitation.updateMany({
        where: { accountId, usedAt: null },
        data: { usedAt: now },
      }),
    ]);
  }

  private toCompanyEmployee(row: {
    id: number;
    name: string;
    email: string | null;
    department: { id: number; name: string } | null;
    role: AccountRole;
    canHandle: boolean;
    active: boolean;
  }): CompanyEmployee {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      department: row.department,
      role: row.role,
      canHandle: row.canHandle,
      active: row.active,
    };
  }
}
