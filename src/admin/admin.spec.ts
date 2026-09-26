import { INestApplication } from '@nestjs/common';
import { AccountRole, RequestStatus } from '@prisma/client';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSender } from '../auth/email-sender';
import { LoginRateLimiter } from '../auth/login-rate-limit';
import {
  authHeaders,
  CHADI,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  JOHN,
  createTestRequestType,
  removeNonDevelopmentCompanies,
  TEST_ORIGIN,
} from '../requests/test-helpers';

jest.setTimeout(60_000);

const PASSWORD = 'founder-password-not-for-production';

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

async function outboxToken(app: INestApplication, email: string, purpose: string): Promise<string> {
  const message = [...app.get(EmailSender).list()]
    .reverse()
    .find((item) => item.to === email && item.purpose === purpose);
  if (!message) {
    throw new Error(`No ${purpose} message for ${email}`);
  }
  return message.token;
}

async function signupAndVerify(
  app: INestApplication,
  input: { companyName: string; name: string; email: string },
) {
  const created = await request(app.getHttpServer())
    .post('/auth/signup')
    .set('Origin', TEST_ORIGIN)
    .send({ ...input, password: PASSWORD });
  if (created.status !== 201) {
    throw new Error(`Signup failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const token = await outboxToken(app, input.email, 'email-verification');
  const verified = await request(app.getHttpServer())
    .post('/auth/verify-email')
    .set('Origin', TEST_ORIGIN)
    .send({ token });
  if (verified.status !== 200) {
    throw new Error(`Verify failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  }
  return loginHeaders(app, input.email, PASSWORD);
}

function assertNoSecrets(body: unknown) {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('passwordHash');
  expect(serialized).not.toMatch(/"password"/);
  expect(serialized).not.toContain('csrfToken');
  expect(serialized).not.toMatch(/"token"/);
  expect(serialized).not.toContain('sessionId');
  expect(serialized).not.toContain('hub_session');
}

type EmployeeRow = {
  id: number;
  name: string;
  email: string | null;
  department: { id: number; name: string } | null;
  role: string;
  canHandle: boolean;
  active: boolean;
};

describe('company Super Admin workspace', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    app.get(LoginRateLimiter).reset();
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
  });

  afterAll(async () => {
    await cleanRequestData(prisma);
    await removeNonDevelopmentCompanies(prisma);
    await closeTestApp(app);
  });

  it('returns company-scoped dashboard counts and treats active requests as SUBMITTED plus IN_PROGRESS', async () => {
    const headersA = await signupAndVerify(app, {
      companyName: 'Counts A',
      name: 'Founder A',
      email: 'counts.a@operations-hub.test',
    });
    const headersB = await signupAndVerify(app, {
      companyName: 'Counts B',
      name: 'Founder B',
      email: 'counts.b@operations-hub.test',
    });
    const founderA = await prisma.employee.findUniqueOrThrow({
      where: { email: 'counts.a@operations-hub.test' },
    });
    const founderB = await prisma.employee.findUniqueOrThrow({
      where: { email: 'counts.b@operations-hub.test' },
    });

    const deptA = await request(app.getHttpServer()).post('/departments').set(headersA).send({ name: 'Desk A' });
    const deptB = await request(app.getHttpServer()).post('/departments').set(headersB).send({ name: 'Desk B' });
    expect(deptA.status).toBe(201);
    expect(deptB.status).toBe(201);
    const typeA = await createTestRequestType(app, headersA, deptA.body.id);
    const typeB = await createTestRequestType(app, headersB, deptB.body.id);

    const submitted = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: deptA.body.id,
      requestTypeId: typeA.id,
    });
    const inProgress = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: deptA.body.id,
      requestTypeId: typeA.id,
    });
    const completed = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: deptA.body.id,
      requestTypeId: typeA.id,
    });
    expect(submitted.status).toBe(201);
    await prisma.request.update({
      where: { id: inProgress.body.id },
      data: { status: RequestStatus.IN_PROGRESS },
    });
    await prisma.request.update({
      where: { id: completed.body.id },
      data: { status: RequestStatus.COMPLETED },
    });
    await request(app.getHttpServer()).post('/requests').set(headersB).send({
      submittedBy: founderB.id,
      departmentId: deptB.body.id,
      requestTypeId: typeB.id,
    });

    const dashboard = await request(app.getHttpServer()).get('/admin/dashboard').set(headersA);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toEqual({
      employees: 1,
      departments: 4,
      requests: 3,
      submitted: 1,
      inProgress: 1,
      completed: 1,
      activeRequests: 2,
    });
    assertNoSecrets(dashboard.body);

    const other = await request(app.getHttpServer()).get('/admin/dashboard').set(headersB);
    expect(other.status).toBe(200);
    expect(other.body).toEqual({
      employees: 1,
      departments: 4,
      requests: 1,
      submitted: 1,
      inProgress: 0,
      completed: 0,
      activeRequests: 1,
    });
  });

  it('lists employees with combinable filters and never returns secrets or another company', async () => {
    const headersA = await signupAndVerify(app, {
      companyName: 'Staff A',
      name: 'Ada Founder',
      email: 'ada.admin@operations-hub.test',
    });
    const headersB = await signupAndVerify(app, {
      companyName: 'Staff B',
      name: 'Bea Founder',
      email: 'bea.admin@operations-hub.test',
    });
    const desk = await request(app.getHttpServer()).post('/departments').set(headersA).send({ name: 'People' });
    const otherDesk = await request(app.getHttpServer()).post('/departments').set(headersA).send({ name: 'Finance' });
    const foreignDesk = await request(app.getHttpServer()).post('/departments').set(headersB).send({ name: 'Other' });
    expect(desk.status).toBe(201);

    const invite = async (body: {
      email: string;
      name: string;
      departmentId: number;
      role: 'EMPLOYEE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN';
      canHandle: boolean;
    }) => {
      const created = await request(app.getHttpServer()).post('/auth/invitations').set(headersA).send(body);
      expect(created.status).toBe(201);
      return created.body as { id: number; email: string };
    };

    const handlerAdmin = await invite({
      email: 'pat.handler@operations-hub.test',
      name: 'Pat Handler',
      departmentId: desk.body.id,
      role: 'DEPARTMENT_ADMIN',
      canHandle: true,
    });
    await invite({
      email: 'quinn.viewer@operations-hub.test',
      name: 'Quinn Viewer',
      departmentId: desk.body.id,
      role: 'DEPARTMENT_ADMIN',
      canHandle: false,
    });
    await invite({
      email: 'remy.staff@operations-hub.test',
      name: 'Remy Staff',
      departmentId: otherDesk.body.id,
      role: 'EMPLOYEE',
      canHandle: true,
    });
    const inviteToken = await outboxToken(app, 'pat.handler@operations-hub.test', 'invitation');
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/invitations/accept')
          .set('Origin', TEST_ORIGIN)
          .send({ token: inviteToken, password: 'staff-password-not-for-production' })
      ).status,
    ).toBe(200);

    const listed = await request(app.getHttpServer()).get('/admin/employees').set(headersA);
    expect(listed.status).toBe(200);
    const names = (listed.body as EmployeeRow[]).map((row) => row.name);
    expect(names).toEqual(['Ada Founder', 'Pat Handler', 'Quinn Viewer', 'Remy Staff']);
    expect(listed.body.map((row: EmployeeRow) => row.email)).not.toContain('bea.admin@operations-hub.test');
    const pat = (listed.body as EmployeeRow[]).find((row) => row.email === 'pat.handler@operations-hub.test');
    expect(pat).toMatchObject({
      id: handlerAdmin.id,
      name: 'Pat Handler',
      email: 'pat.handler@operations-hub.test',
      department: { id: desk.body.id, name: 'People' },
      role: AccountRole.DEPARTMENT_ADMIN,
      canHandle: true,
      active: true,
    });
    assertNoSecrets(listed.body);
    for (const row of listed.body as EmployeeRow[]) {
      expect(row).toEqual({
        id: expect.any(Number),
        name: expect.any(String),
        email: row.email,
        department: row.department,
        role: expect.any(String),
        canHandle: expect.any(Boolean),
        active: expect.any(Boolean),
      });
    }

    const filtered = await request(app.getHttpServer()).get('/admin/employees').query({
      q: 'pat',
      departmentId: String(desk.body.id),
      role: 'DEPARTMENT_ADMIN',
      canHandle: 'true',
      active: 'true',
    }).set(headersA);
    expect(filtered.status).toBe(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].email).toBe('pat.handler@operations-hub.test');
    expect(filtered.body[0].role).toBe('DEPARTMENT_ADMIN');
    expect(filtered.body[0].canHandle).toBe(true);

    const inactiveAdmins = await request(app.getHttpServer()).get('/admin/employees').query({
      role: 'DEPARTMENT_ADMIN',
      canHandle: 'false',
      active: 'false',
      departmentId: String(desk.body.id),
    }).set(headersA);
    expect(inactiveAdmins.body.map((row: EmployeeRow) => row.email)).toEqual(['quinn.viewer@operations-hub.test']);

    const searchEmail = await request(app.getHttpServer())
      .get('/admin/employees')
      .query({ q: 'REMY.STAFF@' })
      .set(headersA);
    expect(searchEmail.body.map((row: EmployeeRow) => row.name)).toEqual(['Remy Staff']);

    const foreign = await request(app.getHttpServer()).get('/admin/employees').set(headersB);
    expect(foreign.status).toBe(200);
    expect(foreign.body.map((row: EmployeeRow) => row.email)).toEqual(['bea.admin@operations-hub.test']);
    expect(foreign.body.map((row: EmployeeRow) => row.email)).not.toContain('ada.admin@operations-hub.test');
    expect(foreign.body[0].department).toBeNull();

    const lookup = await request(app.getHttpServer()).get('/employees').set(headersA);
    expect(lookup.body.find((row: { id: number }) => row.id === handlerAdmin.id)).toEqual({
      id: handlerAdmin.id,
      name: 'Pat Handler',
      departmentId: desk.body.id,
      canHandle: true,
    });
    expect(JSON.stringify(lookup.body)).not.toContain('passwordHash');
    expect(JSON.stringify(lookup.body)).not.toContain('pat.handler@operations-hub.test');
    expect((listed.body as EmployeeRow[]).some((row) => row.department?.id === foreignDesk.body.id)).toBe(false);
  });

  it('denies Employee and Department Admin callers and unauthenticated access', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Denied Co',
      name: 'Owner Founder',
      email: 'owner.denied@operations-hub.test',
    });
    const desk = await request(app.getHttpServer()).post('/departments').set(headers).send({ name: 'Ops' });
    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headers).send({
      email: 'staff.denied@operations-hub.test',
      name: 'Staff Denied',
      departmentId: desk.body.id,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    const deptInvited = await request(app.getHttpServer()).post('/auth/invitations').set(headers).send({
      email: 'dept.denied@operations-hub.test',
      name: 'Dept Denied',
      departmentId: desk.body.id,
      role: 'DEPARTMENT_ADMIN',
      canHandle: true,
    });
    expect(invited.status).toBe(201);
    expect(deptInvited.status).toBe(201);
    const staffToken = await outboxToken(app, 'staff.denied@operations-hub.test', 'invitation');
    const deptToken = await outboxToken(app, 'dept.denied@operations-hub.test', 'invitation');
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/invitations/accept')
          .set('Origin', TEST_ORIGIN)
          .send({ token: staffToken, password: PASSWORD })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/invitations/accept')
          .set('Origin', TEST_ORIGIN)
          .send({ token: deptToken, password: PASSWORD })
      ).status,
    ).toBe(200);

    const staffHeaders = await loginHeaders(app, 'staff.denied@operations-hub.test', PASSWORD);
    const deptHeaders = await loginHeaders(app, 'dept.denied@operations-hub.test', PASSWORD);
    const johnHeaders = await authHeaders(app, prisma, JOHN);

    for (const denied of [staffHeaders, deptHeaders, johnHeaders]) {
      const dashboard = await request(app.getHttpServer()).get('/admin/dashboard').set(denied);
      const employees = await request(app.getHttpServer()).get('/admin/employees').set(denied);
      const requests = await request(app.getHttpServer()).get('/admin/requests').set(denied);
      expect(dashboard.status).toBe(403);
      expect(employees.status).toBe(403);
      expect(requests.status).toBe(403);
      expect(dashboard.body.message).toBe('Only a Super Admin can manage this company');
      expect(JSON.stringify(dashboard.body)).not.toContain('passwordHash');
    }

    const anonymousDashboard = await request(app.getHttpServer()).get('/admin/dashboard');
    const anonymousEmployees = await request(app.getHttpServer()).get('/admin/employees');
    const anonymousRequests = await request(app.getHttpServer()).get('/admin/requests');
    expect(anonymousDashboard.status).toBe(401);
    expect(anonymousEmployees.status).toBe(401);
    expect(anonymousRequests.status).toBe(401);
  });

  it('lets a Super Admin list limited oversight fields, open own details, and rejects Super Admin ownership', async () => {
    const headersA = await signupAndVerify(app, {
      companyName: 'Inbox A',
      name: 'Ada Viewer',
      email: 'ada.viewer@operations-hub.test',
    });
    const headersB = await signupAndVerify(app, {
      companyName: 'Inbox B',
      name: 'Bea Viewer',
      email: 'bea.viewer@operations-hub.test',
    });
    const founderA = await prisma.employee.findUniqueOrThrow({
      where: { email: 'ada.viewer@operations-hub.test' },
    });
    expect(founderA.canHandle).toBe(false);
    expect(founderA.role).toBe('SUPER_ADMIN');
    const founderB = await prisma.employee.findUniqueOrThrow({
      where: { email: 'bea.viewer@operations-hub.test' },
    });

    const deskA = await request(app.getHttpServer()).post('/departments').set(headersA).send({ name: 'IT' });
    const financeA = await request(app.getHttpServer()).post('/departments').set(headersA).send({ name: 'Finance' });
    const deskB = await request(app.getHttpServer()).post('/departments').set(headersB).send({ name: 'Other' });
    expect(deskA.status).toBe(201);
    const typeA = await createTestRequestType(app, headersA, deskA.body.id, 'Hardware');
    const financeType = await createTestRequestType(app, headersA, financeA.body.id, 'Certificate');
    const typeB = await createTestRequestType(app, headersB, deskB.body.id);

    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headersA).send({
      email: 'sam.handler@operations-hub.test',
      name: 'Sam Handler',
      departmentId: deskA.body.id,
      role: 'EMPLOYEE',
      canHandle: true,
    });
    expect(invited.status).toBe(201);
    const inviteToken = await outboxToken(app, 'sam.handler@operations-hub.test', 'invitation');
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/invitations/accept')
          .set('Origin', TEST_ORIGIN)
          .send({ token: inviteToken, password: PASSWORD })
      ).status,
    ).toBe(200);
    const staffHeaders = await loginHeaders(app, 'sam.handler@operations-hub.test', PASSWORD);
    const staff = await prisma.employee.findUniqueOrThrow({
      where: { email: 'sam.handler@operations-hub.test' },
    });

    const mine = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: deskA.body.id,
      requestTypeId: typeA.id,
      title: 'Ada laptop',
      description: 'Need a laptop',
    });
    const theirs = await request(app.getHttpServer()).post('/requests').set(staffHeaders).send({
      submittedBy: staff.id,
      departmentId: financeA.body.id,
      requestTypeId: financeType.id,
      title: 'Sam certificate',
      description: 'UNIQUE-BODY-PHRASE-NOT-IN-TITLE',
    });
    const assignedBySam = await request(app.getHttpServer()).post('/requests').set(staffHeaders).send({
      submittedBy: staff.id,
      departmentId: deskA.body.id,
      requestTypeId: typeA.id,
      title: 'Printer jam',
    });
    const foreign = await request(app.getHttpServer()).post('/requests').set(headersB).send({
      submittedBy: founderB.id,
      departmentId: deskB.body.id,
      requestTypeId: typeB.id,
      title: 'Bea only',
    });
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(assignedBySam.status).toBe(201);
    expect(foreign.status).toBe(201);

    await prisma.employee.update({ where: { id: founderA.id }, data: { canHandle: true } });
    const superAdminOwns = await request(app.getHttpServer())
      .patch(`/requests/${assignedBySam.body.id}/owner`)
      .set(headersA)
      .send({ currentOwnerId: founderA.id });
    expect(superAdminOwns.status).toBe(403);
    expect(superAdminOwns.body.message).toMatch(/not allowed to handle/i);
    const handlerAssignsSuperAdmin = await request(app.getHttpServer())
      .patch(`/requests/${assignedBySam.body.id}/owner`)
      .set(staffHeaders)
      .send({ currentOwnerId: founderA.id });
    expect(handlerAssignsSuperAdmin.status).toBe(403);
    expect(handlerAssignsSuperAdmin.body.message).toMatch(/Super Admin cannot own/i);
    const superAdminAssignsStaff = await request(app.getHttpServer())
      .patch(`/requests/${mine.body.id}/owner`)
      .set(headersA)
      .send({ currentOwnerId: staff.id });
    expect(superAdminAssignsStaff.status).toBe(403);
    expect(
      (await prisma.request.findUniqueOrThrow({ where: { id: assignedBySam.body.id } })).currentOwnerId,
    ).toBeNull();
    expect((await prisma.request.findUniqueOrThrow({ where: { id: mine.body.id } })).currentOwnerId).toBeNull();
    await prisma.employee.update({ where: { id: founderA.id }, data: { canHandle: false } });

    expect(
      (
        await request(app.getHttpServer())
          .patch(`/requests/${mine.body.id}/owner`)
          .set(staffHeaders)
          .send({ currentOwnerId: staff.id })
      ).status,
    ).toBe(200);
    await prisma.request.update({
      where: { id: theirs.body.id },
      data: { status: RequestStatus.IN_PROGRESS, statusUpdatedAt: new Date() },
    });
    await prisma.request.update({
      where: { id: mine.body.id },
      data: { status: RequestStatus.COMPLETED, statusUpdatedAt: new Date() },
    });

    const all = await request(app.getHttpServer()).get('/admin/requests').set(headersA);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.page).toBe(1);
    expect(all.body.pageSize).toBe(20);
    const titles = all.body.items.map((row: { title: string }) => row.title);
    expect(titles).toEqual(expect.arrayContaining(['Ada laptop', 'Sam certificate', 'Printer jam']));
    expect(titles).not.toContain('Bea only');
    expect(JSON.stringify(all.body)).not.toContain('Bea only');
    expect(JSON.stringify(all.body)).not.toContain('Need a laptop');
    expect(JSON.stringify(all.body)).not.toContain('UNIQUE-BODY-PHRASE-NOT-IN-TITLE');
    for (const item of all.body.items) {
      expect(Object.keys(item).sort()).toEqual([
        'department',
        'id',
        'mine',
        'status',
        'submitter',
        'submitterDepartment',
        'title',
      ]);
      expect(Object.keys(item.submitter)).toEqual(['name']);
      expect(Object.keys(item.department)).toEqual(['name']);
      expect(item.currentOwner).toBeUndefined();
      expect(item.currentOwnerId).toBeUndefined();
      expect(item.statusUpdatedAt).toBeUndefined();
      expect(item.description).toBeUndefined();
      expect(item.submittedBy).toBeUndefined();
      expect(item.departmentId).toBeUndefined();
    }
    const adaRow = all.body.items.find((row: { title: string }) => row.title === 'Ada laptop');
    const samRow = all.body.items.find((row: { title: string }) => row.title === 'Sam certificate');
    expect(adaRow).toMatchObject({
      mine: true,
      submitter: { name: 'Ada Viewer' },
      submitterDepartment: null,
      department: { name: 'IT' },
      status: 'COMPLETED',
    });
    expect(samRow).toMatchObject({
      mine: false,
      submitter: { name: 'Sam Handler' },
      submitterDepartment: { name: 'IT' },
      department: { name: 'Finance' },
      status: 'IN_PROGRESS',
    });
    assertNoSecrets(all.body);

    const mineList = await request(app.getHttpServer()).get('/admin/requests').query({ scope: 'mine' }).set(headersA);
    expect(mineList.body.items.map((row: { title: string }) => row.title)).toEqual(['Ada laptop']);
    expect(mineList.body.items[0].mine).toBe(true);
    expect(mineList.body.items[0].currentOwner).toBeUndefined();

    const combined = await request(app.getHttpServer()).get('/admin/requests').query({
      departmentId: String(deskA.body.id),
      status: 'COMPLETED',
      assignment: 'assigned',
      q: 'Ada',
    }).set(headersA);
    expect(combined.body.total).toBe(1);
    expect(combined.body.items[0].title).toBe('Ada laptop');
    expect(combined.body.items[0].submitter.name).toBe('Ada Viewer');
    expect(combined.body.items[0].department.name).toBe('IT');

    const byOwnerName = await request(app.getHttpServer())
      .get('/admin/requests')
      .query({ q: 'Sam Handler' })
      .set(headersA);
    expect(byOwnerName.body.items.map((row: { title: string }) => row.title).sort()).toEqual([
      'Printer jam',
      'Sam certificate',
    ]);

    const byDescription = await request(app.getHttpServer())
      .get('/admin/requests')
      .query({ q: 'UNIQUE-BODY-PHRASE-NOT-IN-TITLE' })
      .set(headersA);
    expect(byDescription.body.total).toBe(0);
    expect(byDescription.body.items).toEqual([]);

    const active = await request(app.getHttpServer()).get('/admin/requests').query({ status: 'ACTIVE' }).set(headersA);
    expect(active.body.items.map((row: { title: string }) => row.title).sort()).toEqual([
      'Printer jam',
      'Sam certificate',
    ]);

    const unassigned = await request(app.getHttpServer())
      .get('/admin/requests')
      .query({ assignment: 'unassigned' })
      .set(headersA);
    expect(unassigned.body.items.map((row: { title: string }) => row.title).sort()).toEqual([
      'Printer jam',
      'Sam certificate',
    ]);

    const openMine = await request(app.getHttpServer()).get(`/requests/${mine.body.id}`).set(headersA);
    expect(openMine.status).toBe(200);
    expect(openMine.body.title).toBe('Ada laptop');
    expect(openMine.body.description).toBe('Need a laptop');
    const mineHistory = await request(app.getHttpServer()).get(`/requests/${mine.body.id}/history`).set(headersA);
    expect(mineHistory.status).toBe(200);
    expect(Array.isArray(mineHistory.body)).toBe(true);

    const openTheirs = await request(app.getHttpServer()).get(`/requests/${theirs.body.id}`).set(headersA);
    expect(openTheirs.status).toBe(403);
    expect(openTheirs.body.message).toMatch(/not allowed to view/i);
    expect(JSON.stringify(openTheirs.body)).not.toContain('Sam certificate');
    expect(JSON.stringify(openTheirs.body)).not.toContain('UNIQUE-BODY-PHRASE-NOT-IN-TITLE');
    const history = await request(app.getHttpServer()).get(`/requests/${theirs.body.id}/history`).set(headersA);
    expect(history.status).toBe(403);
    expect(JSON.stringify(history.body)).not.toContain('UNIQUE-BODY-PHRASE-NOT-IN-TITLE');

    const assignDenied = await request(app.getHttpServer())
      .patch(`/requests/${theirs.body.id}/owner`)
      .set(headersA)
      .send({ currentOwnerId: staff.id });
    expect(assignDenied.status).toBe(403);

    const foreignRead = await request(app.getHttpServer()).get(`/requests/${foreign.body.id}`).set(headersA);
    const foreignHistory = await request(app.getHttpServer())
      .get(`/requests/${foreign.body.id}/history`)
      .set(headersA);
    expect(foreignRead.status).toBe(404);
    expect(foreignHistory.status).toBe(404);
    expect(JSON.stringify(foreignRead.body)).not.toContain('Bea only');

    const otherCompany = await request(app.getHttpServer()).get('/admin/requests').set(headersB);
    expect(otherCompany.body.items.map((row: { title: string }) => row.title)).toEqual(['Bea only']);
    expect(otherCompany.body.total).toBe(1);

    const extraTitles = ['Page one', 'Page two', 'Page three'];
    for (const title of extraTitles) {
      expect(
        (
          await request(app.getHttpServer()).post('/requests').set(headersA).send({
            submittedBy: founderA.id,
            departmentId: deskA.body.id,
            requestTypeId: typeA.id,
            title,
          })
        ).status,
      ).toBe(201);
    }
    const page1 = await request(app.getHttpServer())
      .get('/admin/requests')
      .query({ page: '1', pageSize: '2', scope: 'mine' })
      .set(headersA);
    const page2 = await request(app.getHttpServer())
      .get('/admin/requests')
      .query({ page: '2', pageSize: '2', scope: 'mine' })
      .set(headersA);
    expect(page1.body.pageSize).toBe(2);
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(2);
    expect(page1.body.total).toBe(4);
    const page1Ids = page1.body.items.map((row: { id: number }) => row.id);
    const page2Ids = page2.body.items.map((row: { id: number }) => row.id);
    expect(page1Ids).not.toEqual(page2Ids);
    expect([...page1Ids, ...page2Ids].length).toBe(new Set([...page1Ids, ...page2Ids]).size);
    expect(page1.body.items[0].id).toBeGreaterThan(page1.body.items[1].id);
  });
});
