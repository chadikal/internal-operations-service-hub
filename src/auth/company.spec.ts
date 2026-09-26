import { INestApplication } from '@nestjs/common';
import { CompanyStatus } from '@prisma/client';
import * as request from 'supertest';
import { AiProvider } from '../ai/ai-provider';
import { PrismaService } from '../prisma/prisma.service';
import { isTestDatabase } from './database-target';
import {
  canDeliverOutboundEmail,
  EmailSender,
  EMAIL_NOT_CONFIGURED,
  isTestEmailDelivery,
  shouldLogOutboundEmail,
  testEmailOutboxPath,
} from './email-sender';
import { hashOpaqueToken } from './token-hash';
import { LoginRateLimiter } from './login-rate-limit';
import { DEFAULT_COMPANY_DEPARTMENTS } from './auth.service';
import {
  authHeaders,
  CHADI,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  developmentCompanyId,
  ensureTestCredentials,
  IT,
  JOHN,
  createTestRequestType,
  removeNonDevelopmentCompanies,
  TEST_ORIGIN,
} from '../requests/test-helpers';

jest.setTimeout(60_000);

const PASSWORD = 'founder-password-not-for-production';

const seenDepartments: { id: number; name: string }[] = [];
const seenRequestTypes: { id: number; name: string; departmentId: number }[] = [];

const recordingProvider: AiProvider = {
  async complete(input) {
    seenDepartments.splice(0, seenDepartments.length, ...input.departments);
    seenRequestTypes.splice(0, seenRequestTypes.length, ...input.requestTypes);
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [],
      suggestions: [],
      draft: null,
    };
  },
};

function signup(
  app: INestApplication,
  body: { companyName: string; name: string; email: string; password: string },
  origin: string | undefined = TEST_ORIGIN,
) {
  const call = request(app.getHttpServer()).post('/auth/signup');
  if (origin !== undefined) {
    call.set('Origin', origin);
  }
  return call.send(body);
}

async function outboxToken(app: INestApplication, email: string, purpose: string): Promise<string> {
  const message = [...app.get(EmailSender).list()]
    .reverse()
    .find((item) => item.to === email && item.purpose === purpose);
  if (!message) {
    throw new Error(`No ${purpose} message for ${email}`);
  }
  return message.token;
}

async function cleanup(prisma: PrismaService) {
  await cleanRequestData(prisma);
  const extras = await prisma.employee.findMany({
    where: { id: { notIn: [JOHN, CHADI] } },
    select: { id: true },
  });
  const ids = extras.map((employee) => employee.id);
  if (ids.length > 0) {
    await prisma.emailVerification.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.invitation.deleteMany({
      where: { OR: [{ accountId: { in: ids } }, { invitedById: { in: ids } }] },
    });
    await prisma.session.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  }
  await removeNonDevelopmentCompanies(prisma);
}

describe('company signup', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp(recordingProvider));
    await ensureTestCredentials(prisma);
  });

  beforeEach(async () => {
    seenDepartments.splice(0, seenDepartments.length);
    seenRequestTypes.splice(0, seenRequestTypes.length);
    app.get(LoginRateLimiter).reset();
    await cleanup(prisma);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await closeTestApp(app);
  });

  it('keeps the migrated development records attached to one company', async () => {
    const companyId = await developmentCompanyId(prisma);
    const john = await prisma.employee.findUniqueOrThrow({ where: { id: JOHN } });
    const chadi = await prisma.employee.findUniqueOrThrow({ where: { id: CHADI } });
    expect(john.name).toBe('John');
    expect(chadi.name).toBe('Chadi');
    expect(chadi.canHandle).toBe(true);
    expect(john.companyId).toBe(companyId);
    expect(chadi.companyId).toBe(companyId);
    const it = await prisma.department.findUniqueOrThrow({ where: { id: IT } });
    expect(it.name).toBe('IT');
    expect(it.companyId).toBe(companyId);
    const developmentDepartments = await prisma.department.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    expect(developmentDepartments).toEqual([
      { id: 1, name: 'IT' },
      { id: 2, name: 'HR' },
      { id: 3, name: 'Finance' },
    ]);
  });

  it('activates a workspace only after email verification and lets the invitee set a password', async () => {
    const created = await signup(app, {
      companyName: '  Northwind  ',
      name: 'Ada Founder',
      email: 'Ada.Founder@operations-hub.test',
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      pending: true,
      companyName: 'Northwind',
      email: 'ada.founder@operations-hub.test',
    });
    expect(JSON.stringify(created.body)).not.toContain(PASSWORD);

    const pendingLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada.founder@operations-hub.test', password: PASSWORD });
    expect(pendingLogin.status).toBe(401);
    expect(pendingLogin.body.message).toBe('Invalid email or password');

    const company = await prisma.company.findFirstOrThrow({ where: { name: 'Northwind' } });
    expect(company.status).toBe(CompanyStatus.PENDING);
    const founder = await prisma.employee.findUniqueOrThrow({
      where: { email: 'ada.founder@operations-hub.test' },
    });
    expect(founder.active).toBe(false);
    expect(founder.role).toBe('SUPER_ADMIN');
    expect(founder.departmentId).toBeNull();
    expect(founder.companyId).toBe(company.id);
    expect(founder.passwordHash).not.toContain(PASSWORD);

    const token = await outboxToken(app, 'ada.founder@operations-hub.test', 'email-verification');
    const verified = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set('Origin', TEST_ORIGIN)
      .send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ verified: true });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).status).toBe(
      CompanyStatus.ACTIVE,
    );

    const reused = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set('Origin', TEST_ORIGIN)
      .send({ token });
    expect(reused.status).toBe(400);
    expect(reused.body.message).toMatch(/already been used/i);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ada.founder@operations-hub.test', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.companyName).toBe('Northwind');
    expect(login.body.role).toBe('SUPER_ADMIN');
    const headers = {
      Cookie: authCookie(login),
      'X-CSRF-Token': login.body.csrfToken as string,
    };

    const listed = await request(app.getHttpServer()).get('/departments').set(headers);
    expect(listed.status).toBe(200);
    expect(listed.body.map((department: { name: string }) => department.name).sort()).toEqual(
      [...DEFAULT_COMPANY_DEPARTMENTS].sort(),
    );

    const department = await request(app.getHttpServer())
      .post('/departments')
      .set(headers)
      .send({ name: 'People' });
    expect(department.status).toBe(201);

    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headers).send({
      email: 'Sam.Staff@operations-hub.test',
      name: 'Sam Staff',
      departmentId: department.body.id,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(invited.status).toBe(201);
    expect(invited.body.passwordHash).toBeUndefined();
    expect(invited.body.active).toBe(false);
    const staff = await prisma.employee.findUniqueOrThrow({
      where: { email: 'sam.staff@operations-hub.test' },
    });
    expect(staff.passwordHash).toBeNull();
    expect(staff.companyId).toBe(company.id);

    const early = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'sam.staff@operations-hub.test', password: 'staff-password-not-for-production' });
    expect(early.status).toBe(401);

    const inviteToken = await outboxToken(app, 'sam.staff@operations-hub.test', 'invitation');
    const accepted = await request(app.getHttpServer())
      .post('/auth/invitations/accept')
      .set('Origin', TEST_ORIGIN)
      .send({ token: inviteToken, password: 'staff-password-not-for-production' });
    expect(accepted.status).toBe(200);
    const again = await request(app.getHttpServer())
      .post('/auth/invitations/accept')
      .set('Origin', TEST_ORIGIN)
      .send({ token: inviteToken, password: 'another-staff-password-12' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already been used/i);
    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: staff.id } });
    expect(stored.active).toBe(true);
    expect(stored.passwordHash).not.toContain('staff-password-not-for-production');
    expect(stored.name).toBe('Sam Staff');

    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'sam.staff@operations-hub.test', password: 'staff-password-not-for-production' });
    expect(staffLogin.status).toBe(200);
    expect(staffLogin.body.companyId).toBe(company.id);
  });

  it('rejects failed and expired verification and invitation tokens', async () => {
    const created = await signup(app, {
      companyName: 'Expired Co',
      name: 'Eve Founder',
      email: 'eve.founder@operations-hub.test',
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    const failed = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set('Origin', TEST_ORIGIN)
      .send({ token: 'this-token-does-not-exist-anywhere' });
    expect(failed.status).toBe(400);
    expect(failed.body.message).toMatch(/invalid or expired/i);
    expect((await prisma.company.findFirstOrThrow({ where: { name: 'Expired Co' } })).status).toBe(
      CompanyStatus.PENDING,
    );

    const token = await outboxToken(app, 'eve.founder@operations-hub.test', 'email-verification');
    await prisma.emailVerification.update({
      where: { tokenHash: hashOpaqueToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set('Origin', TEST_ORIGIN)
      .send({ token });
    expect(expired.status).toBe(400);
    expect(expired.body.message).toMatch(/invalid or expired/i);
    expect((await prisma.employee.findUniqueOrThrow({ where: { email: 'eve.founder@operations-hub.test' } })).active).toBe(
      false,
    );

    await prisma.emailVerification.update({
      where: { tokenHash: hashOpaqueToken(token) },
      data: { expiresAt: new Date(Date.now() + 60_000) },
    });
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/verify-email')
          .set('Origin', TEST_ORIGIN)
          .send({ token })
      ).status,
    ).toBe(200);

    const headers = await loginHeaders(app, 'eve.founder@operations-hub.test', PASSWORD);
    const department = await request(app.getHttpServer())
      .post('/departments')
      .set(headers)
      .send({ name: 'Ops' });
    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headers).send({
      email: 'late.person@operations-hub.test',
      name: 'Late Person',
      departmentId: department.body.id,
      role: 'DEPARTMENT_ADMIN',
      canHandle: true,
    });
    expect(invited.status).toBe(201);
    const inviteToken = await outboxToken(app, 'late.person@operations-hub.test', 'invitation');
    const missing = await request(app.getHttpServer())
      .post('/auth/invitations/accept')
      .set('Origin', TEST_ORIGIN)
      .send({ token: 'this-invite-token-does-not-exist', password: PASSWORD });
    expect(missing.status).toBe(400);
    await prisma.invitation.update({
      where: { tokenHash: hashOpaqueToken(inviteToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredInvite = await request(app.getHttpServer())
      .post('/auth/invitations/accept')
      .set('Origin', TEST_ORIGIN)
      .send({ token: inviteToken, password: PASSWORD });
    expect(expiredInvite.status).toBe(400);
    expect(
      (await prisma.employee.findUniqueOrThrow({ where: { email: 'late.person@operations-hub.test' } })).active,
    ).toBe(false);
  });

  it('allows duplicate company names and lets two different founders sign up together', async () => {
    const [first, second] = await Promise.all([
      signup(app, {
        companyName: 'Shared Name',
        name: 'Founder One',
        email: 'founder.one@operations-hub.test',
        password: PASSWORD,
      }),
      signup(app, {
        companyName: 'Shared Name',
        name: 'Founder Two',
        email: 'founder.two@operations-hub.test',
        password: PASSWORD,
      }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await prisma.company.count({ where: { name: 'Shared Name' } })).toBe(2);
    expect(await prisma.employee.count({ where: { email: { in: [
      'founder.one@operations-hub.test',
      'founder.two@operations-hub.test',
    ] } } })).toBe(2);
  });

  it('keeps one founder when the same email is submitted concurrently', async () => {
    const raced = await Promise.all([
      signup(app, {
        companyName: 'Race One',
        name: 'Race Founder',
        email: 'race.founder@operations-hub.test',
        password: PASSWORD,
      }),
      signup(app, {
        companyName: 'Race Two',
        name: 'Race Founder',
        email: 'Race.Founder@operations-hub.test',
        password: PASSWORD,
      }),
    ]);
    const statuses = raced.map((result) => result.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.employee.count({ where: { email: 'race.founder@operations-hub.test' } })).toBe(1);
    expect(await prisma.company.count({ where: { name: { in: ['Race One', 'Race Two'] } } })).toBe(1);
    const winner = raced.find((result) => result.status === 201);
    expect(winner?.body.email).toBe('race.founder@operations-hub.test');
    const extraCompanies = await prisma.company.findMany({
      where: { name: { in: ['Race One', 'Race Two'] } },
      select: { id: true },
    });
    expect(extraCompanies).toHaveLength(1);
    expect(
      await prisma.department.count({ where: { companyId: extraCompanies[0].id } }),
    ).toBe(DEFAULT_COMPANY_DEPARTMENTS.length);
    expect(
      await prisma.department.count({
        where: { companyId: { not: await developmentCompanyId(prisma) } },
      }),
    ).toBe(DEFAULT_COMPANY_DEPARTMENTS.length);
  });

  it('gives each new company its own IT, HR, and Finance set and keeps those defaults ordinary', async () => {
    await signup(app, {
      companyName: 'Defaults A',
      name: 'Founder A',
      email: 'defaults.a@operations-hub.test',
      password: PASSWORD,
    });
    await signup(app, {
      companyName: 'Defaults B',
      name: 'Founder B',
      email: 'defaults.b@operations-hub.test',
      password: PASSWORD,
    });
    const tokenA = await outboxToken(app, 'defaults.a@operations-hub.test', 'email-verification');
    const tokenB = await outboxToken(app, 'defaults.b@operations-hub.test', 'email-verification');
    expect(
      (await request(app.getHttpServer()).post('/auth/verify-email').set('Origin', TEST_ORIGIN).send({ token: tokenA }))
        .status,
    ).toBe(200);
    expect(
      (await request(app.getHttpServer()).post('/auth/verify-email').set('Origin', TEST_ORIGIN).send({ token: tokenB }))
        .status,
    ).toBe(200);
    const headersA = await loginHeaders(app, 'defaults.a@operations-hub.test', PASSWORD);
    const headersB = await loginHeaders(app, 'defaults.b@operations-hub.test', PASSWORD);
    const companyA = await prisma.company.findFirstOrThrow({ where: { name: 'Defaults A' } });
    const companyB = await prisma.company.findFirstOrThrow({ where: { name: 'Defaults B' } });

    const listedA = await request(app.getHttpServer()).get('/departments').set(headersA);
    const listedB = await request(app.getHttpServer()).get('/departments').set(headersB);
    expect(listedA.status).toBe(200);
    expect(listedB.status).toBe(200);
    expect(listedA.body.map((department: { name: string }) => department.name).sort()).toEqual(
      [...DEFAULT_COMPANY_DEPARTMENTS].sort(),
    );
    expect(listedB.body.map((department: { name: string }) => department.name).sort()).toEqual(
      [...DEFAULT_COMPANY_DEPARTMENTS].sort(),
    );
    expect(listedA.body).toHaveLength(DEFAULT_COMPANY_DEPARTMENTS.length);
    expect(listedB.body).toHaveLength(DEFAULT_COMPANY_DEPARTMENTS.length);
    const idsA = listedA.body.map((department: { id: number }) => department.id);
    const idsB = listedB.body.map((department: { id: number }) => department.id);
    expect(idsA.some((id: number) => idsB.includes(id))).toBe(false);
    expect(await prisma.department.count({ where: { companyId: companyA.id } })).toBe(3);
    expect(await prisma.department.count({ where: { companyId: companyB.id } })).toBe(3);

    const financeA = listedA.body.find((department: { name: string }) => department.name === 'Finance');
    const hrA = listedA.body.find((department: { name: string }) => department.name === 'HR');
    const itA = listedA.body.find((department: { name: string }) => department.name === 'IT');
    expect(financeA).toBeDefined();
    expect(hrA).toBeDefined();
    expect(itA).toBeDefined();

    const renamed = await request(app.getHttpServer())
      .patch(`/departments/${financeA.id}`)
      .set(headersA)
      .send({ name: '  Treasury  ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toEqual({ id: financeA.id, name: 'Treasury' });

    const deletedHr = await request(app.getHttpServer()).delete(`/departments/${hrA.id}`).set(headersA);
    expect(deletedHr.status).toBe(200);
    expect(deletedHr.body).toEqual({ deleted: true });
    expect(await prisma.department.findUnique({ where: { id: hrA.id } })).toBeNull();

    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headersA).send({
      email: 'defaults.staff@operations-hub.test',
      name: 'Defaults Staff',
      departmentId: itA.id,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(invited.status).toBe(201);
    const occupied = await request(app.getHttpServer()).delete(`/departments/${itA.id}`).set(headersA);
    expect(occupied.status).toBe(409);
    expect(occupied.body.message).toBe('A department with employees or requests cannot be deleted');
    expect(await prisma.department.findUnique({ where: { id: itA.id } })).not.toBeNull();

    const founderA = await prisma.employee.findUniqueOrThrow({
      where: { email: 'defaults.a@operations-hub.test' },
    });
    const treasuryType = await createTestRequestType(app, headersA, financeA.id, 'Card');
    const createdRequest = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: financeA.id,
      requestTypeId: treasuryType.id,
      title: 'Treasury card',
    });
    expect(createdRequest.status).toBe(201);
    const occupiedByRequest = await request(app.getHttpServer())
      .delete(`/departments/${financeA.id}`)
      .set(headersA);
    expect(occupiedByRequest.status).toBe(409);
    expect(occupiedByRequest.body.message).toBe('A department with employees or requests cannot be deleted');

    const inviteToken = await outboxToken(app, 'defaults.staff@operations-hub.test', 'invitation');
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/invitations/accept')
          .set('Origin', TEST_ORIGIN)
          .send({ token: inviteToken, password: 'staff-password-not-for-production' })
      ).status,
    ).toBe(200);
    const staffHeaders = await loginHeaders(app, 'defaults.staff@operations-hub.test', 'staff-password-not-for-production');
    const staffPatch = await request(app.getHttpServer())
      .patch(`/departments/${itA.id}`)
      .set(staffHeaders)
      .send({ name: 'Helpdesk' });
    expect(staffPatch.status).toBe(403);
    const staffDelete = await request(app.getHttpServer()).delete(`/departments/${itA.id}`).set(staffHeaders);
    expect(staffDelete.status).toBe(403);

    const foreignPatch = await request(app.getHttpServer())
      .patch(`/departments/${idsB[0]}`)
      .set(headersA)
      .send({ name: 'Stolen' });
    expect(foreignPatch.status).toBe(404);
    const foreignDelete = await request(app.getHttpServer()).delete(`/departments/${idsB[0]}`).set(headersA);
    expect(foreignDelete.status).toBe(404);
    expect(
      (await request(app.getHttpServer()).get('/departments').set(headersB)).body.map(
        (department: { name: string }) => department.name,
      ).sort(),
    ).toEqual([...DEFAULT_COMPANY_DEPARTMENTS].sort());
  });

  it('denies cross-company request, history, lookup, and intake access', async () => {
    await signup(app, {
      companyName: 'Company A',
      name: 'Founder A',
      email: 'founder.a@operations-hub.test',
      password: PASSWORD,
    });
    await signup(app, {
      companyName: 'Company B',
      name: 'Founder B',
      email: 'founder.b@operations-hub.test',
      password: PASSWORD,
    });
    const tokenA = await outboxToken(app, 'founder.a@operations-hub.test', 'email-verification');
    const tokenB = await outboxToken(app, 'founder.b@operations-hub.test', 'email-verification');
    expect(
      (await request(app.getHttpServer()).post('/auth/verify-email').set('Origin', TEST_ORIGIN).send({ token: tokenA }))
        .status,
    ).toBe(200);
    expect(
      (await request(app.getHttpServer()).post('/auth/verify-email').set('Origin', TEST_ORIGIN).send({ token: tokenB }))
        .status,
    ).toBe(200);

    const headersA = await loginHeaders(app, 'founder.a@operations-hub.test', PASSWORD);
    const headersB = await loginHeaders(app, 'founder.b@operations-hub.test', PASSWORD);
    const founderA = await prisma.employee.findUniqueOrThrow({ where: { email: 'founder.a@operations-hub.test' } });
    const founderB = await prisma.employee.findUniqueOrThrow({ where: { email: 'founder.b@operations-hub.test' } });
    await prisma.employee.update({ where: { id: founderA.id }, data: { canHandle: true } });
    await prisma.employee.update({ where: { id: founderB.id }, data: { canHandle: true } });

    const departmentA = await request(app.getHttpServer())
      .post('/departments')
      .set(headersA)
      .send({ name: 'Desk A' });
    const departmentB = await request(app.getHttpServer())
      .post('/departments')
      .set(headersB)
      .send({ name: 'Desk B' });
    expect(departmentA.status).toBe(201);
    expect(departmentB.status).toBe(201);
    const typeA = await createTestRequestType(app, headersA, departmentA.body.id, 'Desk A work');
    const typeB = await createTestRequestType(app, headersB, departmentB.body.id, 'Desk B work');

    const created = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: departmentA.body.id,
      requestTypeId: typeA.id,
      title: 'Only company A',
    });
    expect(created.status).toBe(201);
    const requestId = created.body.id as number;

    const foreignDepartment = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: departmentB.body.id,
      requestTypeId: typeB.id,
      title: 'Should not exist',
    });
    expect(foreignDepartment.status).toBe(400);

    const read = await request(app.getHttpServer()).get(`/requests/${requestId}`).set(headersB);
    const history = await request(app.getHttpServer()).get(`/requests/${requestId}/history`).set(headersB);
    const assign = await request(app.getHttpServer())
      .patch(`/requests/${requestId}/owner`)
      .set(headersB)
      .send({ currentOwnerId: founderB.id });
    const transition = await request(app.getHttpServer())
      .patch(`/requests/${requestId}/transition`)
      .set(headersB)
      .send({ to: 'IN_PROGRESS', changedBy: founderB.id });
    for (const response of [read, history, assign, transition]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Only company A');
    }

    const employees = await request(app.getHttpServer()).get('/employees').set(headersB);
    expect(employees.body.map((employee: { id: number }) => employee.id)).not.toContain(founderA.id);
    const departments = await request(app.getHttpServer()).get('/departments').set(headersB);
    expect(departments.body.map((department: { id: number }) => department.id)).not.toContain(departmentA.body.id);

    const invite = await request(app.getHttpServer()).post('/auth/invitations').set(headersB).send({
      email: 'outsider@operations-hub.test',
      name: 'Outsider',
      departmentId: departmentA.body.id,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(invite.status).toBe(400);
    expect(await prisma.employee.findUnique({ where: { email: 'outsider@operations-hub.test' } })).toBeNull();

    const intake = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(headersA)
      .send({ text: 'I need a desk.' });
    expect(intake.status).toBe(200);
    expect(seenDepartments.map((department) => department.name).sort()).toEqual(
      ['Desk A', ...DEFAULT_COMPANY_DEPARTMENTS].sort(),
    );
    expect(seenDepartments.map((department) => department.id)).toContain(departmentA.body.id);
    expect(seenDepartments.map((department) => department.id)).not.toContain(departmentB.body.id);
    expect(seenRequestTypes.map((item) => item.id)).toContain(typeA.id);
    expect(seenRequestTypes.map((item) => item.id)).not.toContain(typeB.id);
    expect(JSON.stringify(seenRequestTypes)).not.toMatch(/approvalPolicy|DEPARTMENT_ADMIN|SUPER_ADMIN/);
    const listedA = await request(app.getHttpServer()).get('/request-types').set(headersA);
    const listedB = await request(app.getHttpServer()).get('/request-types').set(headersB);
    expect(listedA.body.map((item: { id: number }) => item.id)).toContain(typeA.id);
    expect(listedA.body.map((item: { id: number }) => item.id)).not.toContain(typeB.id);
    expect(listedB.body.map((item: { id: number }) => item.id)).toContain(typeB.id);
    expect(listedB.body.map((item: { id: number }) => item.id)).not.toContain(typeA.id);

    const session = await prisma.session.findFirstOrThrow({ where: { accountId: founderA.id, revokedAt: null } });
    await prisma.session.update({
      where: { id: session.id },
      data: { companyId: founderB.companyId },
    });
    const mismatched = await request(app.getHttpServer()).get('/auth/me').set('Cookie', headersA.Cookie);
    expect(mismatched.status).toBe(401);

    const devHeaders = await authHeaders(app, prisma, JOHN);
    const devEmployees = await request(app.getHttpServer()).get('/employees').set(devHeaders);
    const devIds = devEmployees.body.map((employee: { id: number }) => employee.id);
    expect(devIds).toContain(JOHN);
    expect(devIds).not.toContain(founderA.id);
    expect(devIds).not.toContain(founderB.id);
  });

  it('logs outbound mail only for the development database', () => {
    expect(shouldLogOutboundEmail('development', 'postgresql://postgres:secret@localhost:5432/operations_hub')).toBe(
      true,
    );
    expect(
      shouldLogOutboundEmail('development', 'postgresql://postgres:secret@localhost:5432/operations_hub_test'),
    ).toBe(false);
    expect(shouldLogOutboundEmail('test', 'postgresql://postgres:secret@localhost:5432/operations_hub')).toBe(false);
    expect(shouldLogOutboundEmail('production', 'postgresql://postgres:secret@localhost:5432/operations_hub')).toBe(
      false,
    );
    expect(isTestDatabase('postgresql://postgres:secret@localhost:5432/operations_hub')).toBe(false);
    expect(isTestDatabase(process.env.DATABASE_URL)).toBe(true);
    expect(isTestEmailDelivery('test', process.env.DATABASE_URL)).toBe(true);
    expect(canDeliverOutboundEmail('production', process.env.DATABASE_URL)).toBe(false);
    expect(canDeliverOutboundEmail('production', 'postgresql://postgres:secret@localhost:5432/operations_hub')).toBe(
      false,
    );
    expect(canDeliverOutboundEmail('test', 'postgresql://postgres:secret@localhost:5432/operations_hub')).toBe(false);
    expect(
      testEmailOutboxPath('test', process.env.DATABASE_URL, 'C:\\tmp\\email-outbox.jsonl'),
    ).toBe('C:\\tmp\\email-outbox.jsonl');
    expect(
      testEmailOutboxPath('production', process.env.DATABASE_URL, 'C:\\tmp\\email-outbox.jsonl'),
    ).toBeUndefined();
    expect(testEmailOutboxPath('test', process.env.DATABASE_URL, '  ')).toBeUndefined();
  });

  it('rejects production signup and invitations before creating records', async () => {
    const previous = process.env.NODE_ENV;
    const sender = app.get(EmailSender);
    const queuedBefore = sender.list().length;
    process.env.NODE_ENV = 'production';
    try {
      const created = await signup(app, {
        companyName: 'Production Blocked',
        name: 'Prod Founder',
        email: 'prod.founder@operations-hub.test',
        password: PASSWORD,
      });
      expect(created.status).toBe(503);
      expect(created.body.message).toBe(EMAIL_NOT_CONFIGURED);
      expect(await prisma.company.findFirst({ where: { name: 'Production Blocked' } })).toBeNull();
      expect(
        await prisma.department.count({ where: { company: { name: 'Production Blocked' } } }),
      ).toBe(0);
      expect(await prisma.employee.findUnique({ where: { email: 'prod.founder@operations-hub.test' } })).toBeNull();
      expect(
        await prisma.emailVerification.findFirst({
          where: { account: { email: 'prod.founder@operations-hub.test' } },
        }),
      ).toBeNull();
      expect(sender.list()).toHaveLength(queuedBefore);
    } finally {
      process.env.NODE_ENV = previous;
    }

    const prepared = await signup(app, {
      companyName: 'Invite Later',
      name: 'Invite Founder',
      email: 'invite.founder@operations-hub.test',
      password: PASSWORD,
    });
    expect(prepared.status).toBe(201);
    const verifyToken = await outboxToken(app, 'invite.founder@operations-hub.test', 'email-verification');
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/verify-email')
          .set('Origin', TEST_ORIGIN)
          .send({ token: verifyToken })
      ).status,
    ).toBe(200);
    const headers = await loginHeaders(app, 'invite.founder@operations-hub.test', PASSWORD);
    const department = await request(app.getHttpServer()).post('/departments').set(headers).send({ name: 'Mailroom' });
    expect(department.status).toBe(201);

    process.env.NODE_ENV = 'production';
    try {
      const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headers).send({
        email: 'prod.invitee@operations-hub.test',
        name: 'Prod Invitee',
        departmentId: department.body.id,
        role: 'EMPLOYEE',
        canHandle: false,
      });
      expect(invited.status).toBe(503);
      expect(invited.body.message).toBe(EMAIL_NOT_CONFIGURED);
      expect(await prisma.employee.findUnique({ where: { email: 'prod.invitee@operations-hub.test' } })).toBeNull();
      expect(await prisma.invitation.count({ where: { company: { name: 'Invite Later' } } })).toBe(0);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('rolls back the company and default departments when verification mail fails inside signup', async () => {
    const developmentId = await developmentCompanyId(prisma);
    const sender = app.get(EmailSender);
    const queuedBefore = sender.list().length;
    const send = jest.spyOn(sender, 'send').mockRejectedValueOnce(new Error('mail failed after writes'));
    try {
      const created = await signup(app, {
        companyName: 'Mail Fail Co',
        name: 'Mail Fail Founder',
        email: 'mail.fail@operations-hub.test',
        password: PASSWORD,
      });
      expect(created.status).toBeGreaterThanOrEqual(500);
      expect(await prisma.company.findFirst({ where: { name: 'Mail Fail Co' } })).toBeNull();
      expect(await prisma.employee.findUnique({ where: { email: 'mail.fail@operations-hub.test' } })).toBeNull();
      expect(await prisma.department.count({ where: { companyId: { not: developmentId } } })).toBe(0);
      expect(await prisma.company.count({ where: { id: { not: developmentId } } })).toBe(0);
      expect(sender.list()).toHaveLength(queuedBefore);
    } finally {
      send.mockRestore();
    }
  });

  it('does not expose verification or invitation tokens over HTTP', async () => {
    const created = await signup(app, {
      companyName: 'No Leak',
      name: 'Leak Founder',
      email: 'leak.founder@operations-hub.test',
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    const token = await outboxToken(app, 'leak.founder@operations-hub.test', 'email-verification');
    expect(JSON.stringify(created.body)).not.toContain(token);

    const previous = process.env.NODE_ENV;
    const hidden = await request(app.getHttpServer()).get('/auth/test/outbox');
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain(token);

    process.env.NODE_ENV = 'production';
    try {
      const productionHidden = await request(app.getHttpServer()).get('/auth/test/outbox');
      expect(productionHidden.status).toBe(404);
      expect(JSON.stringify(productionHidden.body)).not.toContain(token);
      expect(isTestDatabase(process.env.DATABASE_URL)).toBe(true);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

function authCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = /hub_session=([^;]+)/.exec(header);
  if (!match) {
    throw new Error('Login did not set a session cookie');
  }
  return `hub_session=${match[1]}`;
}

async function loginHeaders(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return {
    Cookie: authCookie(response),
    'X-CSRF-Token': response.body.csrfToken as string,
  };
}
