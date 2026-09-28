import { INestApplication } from '@nestjs/common';
import { AccountRole, ApprovalPolicy, ApprovalState, RequestStatus } from '@prisma/client';
import * as request from 'supertest';
import { hashPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';
import {
  authHeaders,
  CHADI,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  createTestRequestType,
  developmentCompanyId,
  HR,
  IT,
  IT_TYPE,
  JOHN,
  removeNonDevelopmentCompanies,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './test-helpers';

jest.setTimeout(60_000);

describe('Direct request detail access', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: number;
  const createdAccountIds: number[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    companyId = await developmentCompanyId(prisma);
  });

  beforeEach(async () => {
    await cleanRequestData(prisma);
  });

  afterEach(async () => {
    await cleanRequestData(prisma);
    await prisma.requestType.deleteMany({
      where: { companyId, id: { notIn: [1, 2, 3] } },
    });
    if (createdAccountIds.length > 0) {
      await prisma.session.deleteMany({ where: { accountId: { in: createdAccountIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: createdAccountIds } } });
      createdAccountIds.length = 0;
    }
    await prisma.employee.update({
      where: { id: JOHN },
      data: { canHandle: false, active: true, departmentId: IT, role: AccountRole.EMPLOYEE },
    });
    await prisma.employee.update({
      where: { id: CHADI },
      data: { canHandle: true, active: true, departmentId: IT, role: AccountRole.EMPLOYEE },
    });
    await removeNonDevelopmentCompanies(prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('lets a handler open claimable or owned work and hides a colleague owner', async () => {
    const peer = await createAccount('Peer Handler', IT, AccountRole.EMPLOYEE, true);
    const bystander = await createAccount('Bystander', IT, AccountRole.EMPLOYEE, false);
    const created = await submit(JOHN, 'Printer jam body');

    const submitter = await read(JOHN, created.body.id);
    expect(submitter.status).toBe(200);
    expect(submitter.body.description).toBe('Printer jam body');
    const submitterHistory = await history(JOHN, created.body.id);
    expect(submitterHistory.status).toBe(200);

    const claimable = await read(CHADI, created.body.id);
    expect(claimable.status).toBe(200);
    expect(claimable.body.description).toBe('Printer jam body');
    expect((await history(CHADI, created.body.id)).status).toBe(200);

    const notAHandler = await read(bystander.id, created.body.id);
    expect(notAHandler.status).toBe(403);
    expect(JSON.stringify(notAHandler.body)).not.toContain('Printer jam body');
    expect((await history(bystander.id, created.body.id)).status).toBe(403);

    const claimed = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/claim`)
      .set(await authHeaders(app, prisma, CHADI));
    expect(claimed.status).toBe(201);

    const owner = await read(CHADI, created.body.id);
    expect(owner.status).toBe(200);
    expect(owner.body.currentOwnerId).toBe(CHADI);
    const colleague = await read(peer.id, created.body.id);
    expect(colleague.status).toBe(403);
    expect(JSON.stringify(colleague.body)).not.toContain('Printer jam body');
    expect((await history(peer.id, created.body.id)).status).toBe(403);

    const available = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'available' })
      .set(await loginById(peer.id));
    expect(available.status).toBe(200);
    expect(available.body.items.map((item: { id: number }) => item.id)).not.toContain(created.body.id);

    await prisma.request.update({
      where: { id: created.body.id },
      data: { status: RequestStatus.COMPLETED },
    });
    expect((await read(CHADI, created.body.id)).status).toBe(200);
    expect((await read(peer.id, created.body.id)).status).toBe(403);
    expect((await read(JOHN, created.body.id)).status).toBe(200);
  });

  it('keeps an already-owned legacy request open for its handler and closed for everyone else', async () => {
    const peer = await createAccount('Other Handler', IT, AccountRole.EMPLOYEE, true);
    const legacy = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        currentOwnerId: CHADI,
        approvalState: null,
        capturedApprovalPolicy: null,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Legacy owned',
        description: 'LEGACY-OWNED-BODY',
      },
    });

    const owner = await read(CHADI, legacy.id);
    expect(owner.status).toBe(200);
    expect(owner.body.description).toBe('LEGACY-OWNED-BODY');
    expect(owner.body.approvalState).toBeNull();
    expect((await history(CHADI, legacy.id)).status).toBe(200);

    const submitter = await read(JOHN, legacy.id);
    expect(submitter.status).toBe(200);
    const otherHandler = await read(peer.id, legacy.id);
    expect(otherHandler.status).toBe(403);
    expect(JSON.stringify(otherHandler.body)).not.toContain('LEGACY-OWNED-BODY');

    const required = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        currentOwnerId: CHADI,
        approvalState: null,
        capturedApprovalPolicy: ApprovalPolicy.DEPARTMENT_ADMIN,
        status: RequestStatus.IN_PROGRESS,
        statusUpdatedAt: new Date(),
        title: 'Legacy required',
        description: 'LEGACY-REQUIRED-BODY',
      },
    });
    expect((await read(CHADI, required.id)).status).toBe(200);
    expect((await read(peer.id, required.id)).status).toBe(403);
    expect(JSON.stringify((await read(peer.id, required.id)).body)).not.toContain('LEGACY-REQUIRED-BODY');
  });

  it('follows approval eligibility and denies another company', async () => {
    const departmentAdmin = await createAccount('Dana IT', IT, AccountRole.DEPARTMENT_ADMIN, false);
    const otherDepartmentAdmin = await createAccount('Hana HR', HR, AccountRole.DEPARTMENT_ADMIN, false);
    const superAdmin = await createAccount('Ada Super', IT, AccountRole.SUPER_ADMIN, true);
    const handlingAdmin = await createAccount('Handler Admin', IT, AccountRole.DEPARTMENT_ADMIN, true);
    const hrHandler = await createAccount('HR Handler', HR, AccountRole.EMPLOYEE, true);
    const superHeaders = await loginById(superAdmin.id);
    const deptType = await createTestRequestType(app, superHeaders, IT, 'Badge', 'DEPARTMENT_ADMIN');
    const superType = await createTestRequestType(app, superHeaders, IT, 'Spend', 'SUPER_ADMIN');

    const pending = await submit(JOHN, 'PENDING-BODY', deptType.id);
    expect((await read(CHADI, pending.body.id)).status).toBe(403);
    expect(JSON.stringify((await read(CHADI, pending.body.id)).body)).not.toContain('PENDING-BODY');
    expect((await history(CHADI, pending.body.id)).status).toBe(403);
    expect((await read(departmentAdmin.id, pending.body.id)).status).toBe(200);
    expect((await read(departmentAdmin.id, pending.body.id)).body.description).toBe('PENDING-BODY');
    expect((await read(otherDepartmentAdmin.id, pending.body.id)).status).toBe(403);
    expect((await read(superAdmin.id, pending.body.id)).status).toBe(403);
    expect((await read(hrHandler.id, pending.body.id)).status).toBe(403);

    const approved = await request(app.getHttpServer())
      .post(`/requests/${pending.body.id}/approval`)
      .set(await loginById(departmentAdmin.id))
      .send({ decision: 'APPROVED' });
    expect(approved.status).toBe(201);
    expect((await read(CHADI, pending.body.id)).status).toBe(200);
    expect((await read(handlingAdmin.id, pending.body.id)).status).toBe(200);
    expect((await read(hrHandler.id, pending.body.id)).status).toBe(403);
    expect((await read(departmentAdmin.id, pending.body.id)).status).toBe(200);

    const denied = await submit(JOHN, 'DENIED-BODY', deptType.id);
    const denial = await request(app.getHttpServer())
      .post(`/requests/${denied.body.id}/approval`)
      .set(await loginById(departmentAdmin.id))
      .send({ decision: 'DENIED', reason: 'Out of scope' });
    expect(denial.status).toBe(201);
    expect((await read(CHADI, denied.body.id)).status).toBe(403);
    expect(JSON.stringify((await read(CHADI, denied.body.id)).body)).not.toContain('DENIED-BODY');
    expect((await read(departmentAdmin.id, denied.body.id)).status).toBe(200);
    expect((await read(JOHN, denied.body.id)).status).toBe(200);

    const executive = await submit(superAdmin.id, 'EXEC-BODY', superType.id);
    expect((await read(CHADI, executive.body.id)).status).toBe(403);
    expect((await read(superAdmin.id, executive.body.id)).status).toBe(200);
    const secondSuper = await createAccount('Second Super', IT, AccountRole.SUPER_ADMIN, false);
    expect((await read(secondSuper.id, executive.body.id)).status).toBe(200);
    expect((await read(secondSuper.id, executive.body.id)).body.description).toBe('EXEC-BODY');
    expect((await history(secondSuper.id, executive.body.id)).status).toBe(200);

    const ordinary = await submit(JOHN, 'ORDINARY-BODY');
    expect((await read(secondSuper.id, ordinary.body.id)).status).toBe(403);
    expect(JSON.stringify((await read(secondSuper.id, ordinary.body.id)).body)).not.toContain('ORDINARY-BODY');
    expect((await history(secondSuper.id, ordinary.body.id)).status).toBe(403);

    const departmentList = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'department' })
      .set(await loginById(departmentAdmin.id));
    expect(departmentList.status).toBe(200);
    expect(departmentList.body.items.map((item: { id: number }) => item.id)).not.toContain(ordinary.body.id);

    const otherCompany = await prisma.company.create({
      data: { name: `Elsewhere ${Date.now()}`, status: 'ACTIVE' },
    });
    const outsider = await prisma.employee.create({
      data: {
        name: 'Outsider',
        email: `outsider.detail.${Date.now()}@operations-hub.test`,
        companyId: otherCompany.id,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role: AccountRole.SUPER_ADMIN,
        canHandle: true,
        active: true,
      },
    });
    const cross = await read(outsider.id, ordinary.body.id);
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain('ORDINARY-BODY');
    const crossHistory = await history(outsider.id, ordinary.body.id);
    expect(crossHistory.status).toBe(404);
    expect(JSON.stringify(crossHistory.body)).not.toContain('ORDINARY-BODY');
  });

  async function createAccount(
    name: string,
    departmentId: number,
    role: AccountRole,
    canHandle: boolean,
  ) {
    const account = await prisma.employee.create({
      data: {
        name,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${Date.now()}@operations-hub.test`,
        companyId,
        departmentId,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role,
        canHandle,
        active: true,
      },
    });
    createdAccountIds.push(account.id);
    return account;
  }

  async function submit(actorId: number, description: string, requestTypeId = IT_TYPE) {
    return request(app.getHttpServer())
      .post('/requests')
      .set(await loginById(actorId))
      .send({
        submittedBy: actorId,
        departmentId: IT,
        requestTypeId,
        title: description,
        description,
      });
  }

  async function read(actorId: number, id: number) {
    return request(app.getHttpServer()).get(`/requests/${id}`).set(await loginById(actorId));
  }

  async function history(actorId: number, id: number) {
    return request(app.getHttpServer()).get(`/requests/${id}/history`).set(await loginById(actorId));
  }

  async function loginById(actorId: number) {
    if (actorId === JOHN || actorId === CHADI) {
      return authHeaders(app, prisma, actorId);
    }
    const account = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: account.email, password: TEST_PASSWORD });
    if (response.status !== 200) {
      throw new Error(`Login failed for ${account.email}: ${response.status}`);
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
