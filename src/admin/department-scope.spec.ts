import { INestApplication } from '@nestjs/common';
import { AccountRole, ApprovalPolicy, ApprovalState, RequestStatus } from '@prisma/client';
import * as request from 'supertest';
import { hashPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHADI,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  developmentCompanyId,
  ensureTestCredentials,
  HR,
  IT,
  JOHN,
  removeNonDevelopmentCompanies,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../requests/test-helpers';

jest.setTimeout(60_000);

describe('Department Admin department scope', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: number;
  let itAdminId: number;
  let hrAdminId: number;
  const createdAccountIds: number[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    companyId = await developmentCompanyId(prisma);
    await ensureTestCredentials(prisma);
  });

  beforeEach(async () => {
    await cleanRequestData(prisma);
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const stamp = Date.now();
    const itAdmin = await prisma.employee.create({
      data: {
        name: 'Dana IT',
        email: `dana.scope.${stamp}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash,
        role: AccountRole.DEPARTMENT_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    const hrAdmin = await prisma.employee.create({
      data: {
        name: 'Hana HR',
        email: `hana.scope.${stamp}@operations-hub.test`,
        companyId,
        departmentId: HR,
        passwordHash,
        role: AccountRole.DEPARTMENT_ADMIN,
        canHandle: true,
        active: true,
      },
    });
    const inactive = await prisma.employee.create({
      data: {
        name: 'Inactive IT',
        email: `inactive.scope.${stamp}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash,
        role: AccountRole.EMPLOYEE,
        canHandle: true,
        active: false,
      },
    });
    itAdminId = itAdmin.id;
    hrAdminId = hrAdmin.id;
    createdAccountIds.push(itAdmin.id, hrAdmin.id, inactive.id);
  });

  afterEach(async () => {
    await cleanRequestData(prisma);
    if (createdAccountIds.length > 0) {
      await prisma.session.deleteMany({ where: { accountId: { in: createdAccountIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: createdAccountIds } } });
      createdAccountIds.length = 0;
    }
    await removeNonDevelopmentCompanies(prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('counts destination-department requests and department members, with pending overlapping ownership', async () => {
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: hrAdminId,
        departmentId: IT,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        currentOwnerId: null,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'IT-PENDING-UNCLAIMED',
        description: 'should-not-appear-in-dashboard',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.SUPER_ADMIN,
        currentOwnerId: CHADI,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'IT-PENDING-CLAIMED',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: ApprovalState.NOT_REQUIRED,
        capturedApprovalPolicy: ApprovalPolicy.NONE,
        currentOwnerId: null,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'IT-UNCLAIMED-NONE',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: itAdminId,
        departmentId: HR,
        approvalState: ApprovalState.NOT_REQUIRED,
        capturedApprovalPolicy: ApprovalPolicy.NONE,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'HR-DESTINATION',
        description: 'HR-ONLY-BODY',
      },
    });

    const dashboard = await request(app.getHttpServer())
      .get('/department/dashboard')
      .set(await login(itAdminId));
    expect(dashboard.status).toBe(200);
    const itMembers = await prisma.employee.count({ where: { companyId, departmentId: IT } });
    const itAdmins = await prisma.employee.count({
      where: { companyId, departmentId: IT, role: 'DEPARTMENT_ADMIN' },
    });
    const itSuperAdmins = await prisma.employee.count({
      where: { companyId, departmentId: IT, role: 'SUPER_ADMIN' },
    });
    const itHandlers = await prisma.employee.count({
      where: { companyId, departmentId: IT, canHandle: true },
    });
    const itEmployees = await prisma.employee.count({
      where: { companyId, departmentId: IT, role: 'EMPLOYEE' },
    });
    expect(dashboard.body.departmentId).toBe(IT);
    expect(dashboard.body.people).toEqual({
      total: itMembers,
      admins: itAdmins,
      handlers: itHandlers,
      employees: itEmployees,
    });
    expect(dashboard.body.people.admins + dashboard.body.people.employees + itSuperAdmins).toBe(
      dashboard.body.people.total,
    );
    expect(dashboard.body.requests).toEqual({
      total: 3,
      submitted: 3,
      inProgress: 0,
      completed: 0,
      claimed: 1,
      unclaimed: 2,
      active: 3,
    });
    expect(dashboard.body.approvals).toEqual({ total: 1, awaiting: 1, approved: 0, denied: 0 });
    expect(dashboard.body.myRequests).toEqual({
      total: 1,
      submitted: 1,
      completed: 0,
      inProgress: 0,
      unclaimed: 1,
      awaitingApproval: 0,
      approved: 0,
      denied: 0,
    });
    expect(JSON.stringify(dashboard.body)).not.toContain('HR-ONLY-BODY');
    expect(JSON.stringify(dashboard.body)).not.toContain('IT-PENDING-UNCLAIMED');

    const forced = await request(app.getHttpServer())
      .get('/department/dashboard')
      .query({ departmentId: HR })
      .set(await login(itAdminId));
    expect(forced.status).toBe(400);

    const hrDashboard = await request(app.getHttpServer())
      .get('/department/dashboard')
      .set(await login(hrAdminId));
    expect(hrDashboard.status).toBe(200);
    expect(hrDashboard.body.departmentId).toBe(HR);
    expect(hrDashboard.body.requests).toEqual({
      total: 1,
      submitted: 1,
      inProgress: 0,
      completed: 0,
      claimed: 0,
      unclaimed: 1,
      active: 1,
    });
    expect(hrDashboard.body.approvals).toEqual({ total: 0, awaiting: 0, approved: 0, denied: 0 });
    expect(hrDashboard.body.myRequests).toMatchObject({
      total: 1,
      unclaimed: 1,
      awaitingApproval: 1,
      approved: 0,
      denied: 0,
    });

    const employeeDenied = await request(app.getHttpServer())
      .get('/department/dashboard')
      .set(await login(JOHN));
    expect(employeeDenied.status).toBe(403);
    const handlerDenied = await request(app.getHttpServer())
      .get('/department/dashboard')
      .set(await login(CHADI));
    expect(handlerDenied.status).toBe(403);
  });

  it('keeps legacy approval states in the destination department only', async () => {
    const now = new Date();
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: null,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: now,
        title: 'LEGACY-AWAITING',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: null,
        capturedApprovalPolicy: null,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: now,
        title: 'LEGACY-EMPTY',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: HR,
        approvalState: ApprovalState.APPROVED,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        currentOwnerId: hrAdminId,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: now,
        title: 'HR-APPROVED-STILL-SUBMITTED',
      },
    });

    const dashboard = await request(app.getHttpServer())
      .get('/department/dashboard')
      .set(await login(itAdminId));
    expect(dashboard.body.requests.total).toBe(2);
    expect(dashboard.body.approvals).toEqual({ total: 1, awaiting: 1, approved: 0, denied: 0 });
    expect(dashboard.body.myRequests.total).toBe(0);

    const hrDashboard = await request(app.getHttpServer())
      .get('/department/dashboard')
      .set(await login(hrAdminId));
    expect(hrDashboard.body.requests).toMatchObject({ total: 1, submitted: 1, claimed: 1, active: 1 });
    expect(hrDashboard.body.approvals).toEqual({ total: 1, awaiting: 0, approved: 1, denied: 0 });
    expect(JSON.stringify(dashboard.body)).not.toContain('HR-APPROVED-STILL-SUBMITTED');
  });

  it('lists only that department and filters handler eligibility', async () => {
    const headers = await login(itAdminId);
    const all = await request(app.getHttpServer()).get('/department/employees').set(headers);
    expect(all.status).toBe(200);
    const ids = all.body.map((row: { id: number; department: { id: number } }) => row.id);
    expect(ids).toContain(itAdminId);
    expect(ids).toContain(JOHN);
    expect(ids).toContain(CHADI);
    expect(ids).not.toContain(hrAdminId);
    expect(all.body.every((row: { department: { id: number } }) => row.department.id === IT)).toBe(true);
    expect(JSON.stringify(all.body)).not.toContain('passwordHash');

    const handlers = await request(app.getHttpServer())
      .get('/department/employees')
      .query({ canHandle: 'true' })
      .set(headers);
    expect(handlers.status).toBe(200);
    expect(handlers.body.map((row: { id: number }) => row.id)).toContain(CHADI);
    expect(handlers.body.map((row: { id: number }) => row.id)).not.toContain(JOHN);
    expect(handlers.body.every((row: { canHandle: boolean }) => row.canHandle)).toBe(true);

    const admins = await request(app.getHttpServer()).get('/department/employees').query({ role: 'ADMIN' }).set(headers);
    expect(admins.status).toBe(200);
    expect(admins.body.every((row: { role: string }) => row.role === 'DEPARTMENT_ADMIN' || row.role === 'SUPER_ADMIN')).toBe(true);
    expect(admins.body.map((row: { id: number }) => row.id)).toContain(itAdminId);
    expect(admins.body.map((row: { id: number }) => row.id)).not.toContain(JOHN);

    const notHandlers = await request(app.getHttpServer())
      .get('/department/employees')
      .query({ canHandle: 'false' })
      .set(headers);
    expect(notHandlers.body.map((row: { id: number }) => row.id)).toContain(JOHN);
    expect(notHandlers.body.map((row: { id: number }) => row.id)).not.toContain(CHADI);

    const otherDepartment = await request(app.getHttpServer())
      .get('/department/employees')
      .query({ departmentId: HR })
      .set(headers);
    expect(otherDepartment.status).toBe(400);
    expect(JSON.stringify(otherDepartment.body)).not.toContain('Hana HR');

    const companyList = await request(app.getHttpServer()).get('/admin/employees').set(headers);
    expect(companyList.status).toBe(403);
    const companyRequests = await request(app.getHttpServer()).get('/admin/requests').set(headers);
    expect(companyRequests.status).toBe(403);
    expect(JSON.stringify(companyRequests.body)).not.toContain('HR-ONLY-BODY');

    const lookup = await request(app.getHttpServer()).get('/employees').set(headers);
    expect(lookup.status).toBe(200);
    expect(lookup.body.map((row: { id: number }) => row.id)).not.toContain(hrAdminId);
    expect(lookup.body.every((row: { departmentId: number }) => row.departmentId === IT)).toBe(true);

    const johnLookup = await request(app.getHttpServer()).get('/employees').set(await login(JOHN));
    expect(johnLookup.status).toBe(200);
    expect(johnLookup.body.map((row: { id: number }) => row.id)).toContain(hrAdminId);
  });

  it('matches each department request figure to the filtered list and opens claimable department work', async () => {
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: hrAdminId,
        departmentId: IT,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        currentOwnerId: null,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'IT-DECIDABLE',
        description: 'IT-DECIDABLE-BODY',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: ApprovalState.NOT_REQUIRED,
        capturedApprovalPolicy: ApprovalPolicy.NONE,
        currentOwnerId: null,
        status: RequestStatus.IN_PROGRESS,
        statusUpdatedAt: new Date(),
        title: 'IT-CLOSED-NONE',
        description: 'IT-CLOSED-BODY',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: HR,
        approvalState: ApprovalState.NOT_REQUIRED,
        capturedApprovalPolicy: ApprovalPolicy.NONE,
        status: RequestStatus.COMPLETED,
        statusUpdatedAt: new Date(),
        title: 'HR-OUTSIDE',
        description: 'HR-OUTSIDE-BODY',
      },
    });

    const headers = await login(itAdminId);
    const dashboard = await request(app.getHttpServer()).get('/department/dashboard').set(headers);
    expect(dashboard.status).toBe(200);
    const figures: { query: Record<string, string>; total: number }[] = [
      { query: {}, total: dashboard.body.requests.total },
      { query: { status: 'SUBMITTED' }, total: dashboard.body.requests.submitted },
      { query: { status: 'IN_PROGRESS' }, total: dashboard.body.requests.inProgress },
      { query: { status: 'COMPLETED' }, total: dashboard.body.requests.completed },
      { query: { status: 'ACTIVE' }, total: dashboard.body.requests.active },
      { query: { assignment: 'assigned' }, total: dashboard.body.requests.claimed },
      { query: { assignment: 'unassigned' }, total: dashboard.body.requests.unclaimed },
    ];
    for (const figure of figures) {
      const list = await request(app.getHttpServer()).get('/department/requests').query(figure.query).set(headers);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(figure.total);
      expect(JSON.stringify(list.body)).not.toContain('description');
      expect(JSON.stringify(list.body)).not.toContain('HR-OUTSIDE');
    }

    const all = await request(app.getHttpServer()).get('/department/requests').set(headers);
    const decidable = all.body.items.find((item: { title: string }) => item.title === 'IT-DECIDABLE');
    const closed = all.body.items.find((item: { title: string }) => item.title === 'IT-CLOSED-NONE');
    expect(decidable.canOpen).toBe(true);
    expect(closed.canOpen).toBe(true);
    expect(closed.description).toBeUndefined();

    const detail = await request(app.getHttpServer()).get(`/requests/${closed.id}`).set(headers);
    expect(detail.status).toBe(200);
    expect(detail.body.description).toBe('IT-CLOSED-BODY');
    expect(JSON.stringify(detail.body)).not.toContain('passwordHash');

    const otherDepartment = await request(app.getHttpServer())
      .get('/department/requests')
      .query({ departmentId: HR })
      .set(headers);
    expect(otherDepartment.status).toBe(400);
    const employee = await request(app.getHttpServer()).get('/department/requests').set(await login(JOHN));
    expect(employee.status).toBe(403);
  });

  it('keeps approval filters to requests this admin can decide and matches the dashboard', async () => {
    const own = await prisma.request.create({
      data: {
        companyId,
        submittedBy: itAdminId,
        departmentId: IT,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'OWN-PENDING',
      },
    });
    const eligible = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'ELIGIBLE-AWAITING',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: ApprovalState.APPROVED,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'ELIGIBLE-APPROVED',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.SUPER_ADMIN,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'SUPER-POLICY',
      },
    });

    const headers = await login(itAdminId);
    const dashboard = await request(app.getHttpServer()).get('/department/dashboard').set(headers);
    const awaiting = await request(app.getHttpServer()).get('/requests/approvals').query({ status: 'awaiting' }).set(headers);
    const defaults = await request(app.getHttpServer()).get('/requests/approvals').set(headers);
    const all = await request(app.getHttpServer()).get('/requests/approvals').query({ status: 'all' }).set(headers);
    const approved = await request(app.getHttpServer()).get('/requests/approvals').query({ status: 'approved' }).set(headers);
    const ids = (body: { items: { id: number }[] }) => body.items.map((item) => item.id);

    expect(awaiting.body.items).toHaveLength(dashboard.body.approvals.awaiting);
    expect(ids(awaiting.body)).toEqual(ids(defaults.body));
    expect(ids(awaiting.body)).toContain(eligible.id);
    expect(ids(awaiting.body)).not.toContain(own.id);
    expect(ids(all.body)).not.toContain(own.id);
    expect(ids(all.body)).toHaveLength(dashboard.body.approvals.total);
    expect(ids(approved.body)).toHaveLength(dashboard.body.approvals.approved);
    expect(JSON.stringify(all.body)).not.toContain('SUPER-POLICY');
    expect(JSON.stringify(all.body)).not.toContain('OWN-PENDING');
  });

  it('counts a handling department admin once in the total and in both filters', async () => {
    const headers = await login(hrAdminId);
    const dashboard = await request(app.getHttpServer()).get('/department/dashboard').set(headers);
    const all = await request(app.getHttpServer()).get('/department/employees').set(headers);
    const admins = await request(app.getHttpServer())
      .get('/department/employees')
      .query({ role: 'DEPARTMENT_ADMIN' })
      .set(headers);
    const handlers = await request(app.getHttpServer())
      .get('/department/employees')
      .query({ canHandle: 'true' })
      .set(headers);
    const employees = await request(app.getHttpServer())
      .get('/department/employees')
      .query({ role: 'EMPLOYEE' })
      .set(headers);
    const ids = (body: { id: number }[]) => body.map((row) => row.id);

    expect(all.body).toHaveLength(dashboard.body.people.total);
    expect(admins.body).toHaveLength(dashboard.body.people.admins);
    expect(handlers.body).toHaveLength(dashboard.body.people.handlers);
    expect(employees.body).toHaveLength(dashboard.body.people.employees);
    expect(ids(all.body).filter((id: number) => id === hrAdminId)).toEqual([hrAdminId]);
    expect(ids(admins.body)).toContain(hrAdminId);
    expect(ids(handlers.body)).toContain(hrAdminId);
    expect(ids(employees.body)).not.toContain(hrAdminId);
    expect(admins.body.every((row: { department: { id: number } }) => row.department.id === HR)).toBe(true);
    expect(handlers.body.every((row: { canHandle: boolean }) => row.canHandle)).toBe(true);
  });

  async function login(actorId: number) {
    const account = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: account.email, password: TEST_PASSWORD });
    if (response.status !== 200) {
      throw new Error(`Login failed for ${account.email}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    const raw = response.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
    const match = /hub_session=([^;]+)/.exec(header);
    if (!match) {
      throw new Error('Login did not set a session cookie');
    }
    return {
      Cookie: `hub_session=${match[1]}`,
      'X-CSRF-Token': response.body.csrfToken as string,
    };
  }
});
