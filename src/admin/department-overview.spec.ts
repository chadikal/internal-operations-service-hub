import { INestApplication } from '@nestjs/common';
import { AccountRole, ApprovalPolicy, ApprovalState, CompanyStatus, RequestStatus } from '@prisma/client';
import * as request from 'supertest';
import { hashPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanRequestData,
  closeTestApp,
  createTestApp,
  developmentCompanyId,
  ensureTestCredentials,
  IT,
  removeNonDevelopmentCompanies,
  sessionCookieFrom,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../requests/test-helpers';

jest.setTimeout(60_000);

describe('Super Admin department overview', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: number;
  const createdAccountIds: number[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    companyId = await developmentCompanyId(prisma);
    await ensureTestCredentials(prisma);
  });

  beforeEach(async () => {
    await cleanRequestData(prisma);
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

  it('counts this company’s departments and hides another company', async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const admin = await prisma.employee.create({
      data: {
        name: 'Overview Admin',
        email: `overview.admin.${stamp}@operations-hub.test`,
        companyId,
        passwordHash,
        role: AccountRole.SUPER_ADMIN,
        active: true,
      },
    });
    const ada = await prisma.employee.create({
      data: {
        name: 'Ada IT',
        email: `ada.overview.${stamp}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash,
        role: AccountRole.DEPARTMENT_ADMIN,
        active: true,
      },
    });
    const bea = await prisma.employee.create({
      data: {
        name: 'Bea IT',
        email: `bea.overview.${stamp}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash,
        role: AccountRole.DEPARTMENT_ADMIN,
        active: false,
      },
    });
    createdAccountIds.push(admin.id, ada.id, bea.id);
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: ada.id,
        departmentId: IT,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Waiting in IT',
      },
    });
    await prisma.request.create({
      data: {
        companyId,
        submittedBy: admin.id,
        departmentId: IT,
        approvalState: ApprovalState.NOT_REQUIRED,
        capturedApprovalPolicy: ApprovalPolicy.NONE,
        status: RequestStatus.COMPLETED,
        statusUpdatedAt: new Date(),
        title: 'Finished in IT',
      },
    });

    const other = await prisma.company.create({
      data: { name: `Other Co ${stamp}`, status: CompanyStatus.ACTIVE },
    });
    const secret = await prisma.department.create({
      data: { name: 'Secret Desk', companyId: other.id },
    });
    const outsider = await prisma.employee.create({
      data: {
        name: 'Other Admin',
        email: `other.overview.${stamp}@operations-hub.test`,
        companyId: other.id,
        departmentId: secret.id,
        passwordHash,
        role: AccountRole.DEPARTMENT_ADMIN,
        active: true,
      },
    });
    await prisma.request.create({
      data: {
        companyId: other.id,
        submittedBy: outsider.id,
        departmentId: secret.id,
        approvalState: ApprovalState.PENDING,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Other company request',
      },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: admin.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const headers = {
      Cookie: sessionCookieFrom(login),
      'X-CSRF-Token': String(login.body.csrfToken),
    };

    const overview = await request(app.getHttpServer()).get('/admin/department-overview').set(headers);
    expect(overview.status).toBe(200);
    const names = overview.body.items.map((item: { name: string }) => item.name);
    expect(names).not.toContain('Secret Desk');
    expect(JSON.stringify(overview.body)).not.toContain('Other Admin');

    const itRow = overview.body.items.find((item: { id: number }) => item.id === IT);
    const [employeeCount, requestCount] = await Promise.all([
      prisma.employee.count({ where: { companyId, departmentId: IT } }),
      prisma.request.count({ where: { companyId, departmentId: IT } }),
    ]);
    expect(itRow).toMatchObject({
      employees: employeeCount,
      departmentAdmins: ['Ada IT', 'Bea IT'],
      requests: requestCount,
      awaitingApproval: 1,
    });

    const hr = overview.body.items.find((item: { name: string }) => item.name === 'HR');
    expect(hr.departmentAdmins).toEqual([]);

    const leaked = await request(app.getHttpServer())
      .get('/admin/department-overview')
      .query({ companyId: other.id })
      .set(headers);
    expect(leaked.status).toBe(400);

    const employeeLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'john@operations-hub.test', password: TEST_PASSWORD });
    const denied = await request(app.getHttpServer())
      .get('/admin/department-overview')
      .set('Cookie', sessionCookieFrom(employeeLogin))
      .set('X-CSRF-Token', String(employeeLogin.body.csrfToken));
    expect(denied.status).toBe(403);
  });
});
