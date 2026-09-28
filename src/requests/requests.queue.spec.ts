import { INestApplication } from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import * as request from 'supertest';
import { hashPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';
import {
  authHeaders,
  CHADI,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  developmentCompanyId,
  IT,
  IT_TYPE,
  JOHN,
  removeNonDevelopmentCompanies,
  sessionCookieFrom,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './test-helpers';

describe('Role request queues', () => {
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

  it('lists claimable work separately from submissions and owned work', async () => {
    const created = await submit(JOHN, 'Printer jam');
    const mine = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'submitted' })
      .set(await authHeaders(app, prisma, JOHN));
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((item: { title: string }) => item.title)).toEqual(['Printer jam']);
    expect(mine.body.items[0]).not.toHaveProperty('description');
    expect(mine.body.items[0].approvalState).toBe('NOT_REQUIRED');
    expect(mine.body.items[0].status).toBe('SUBMITTED');

    const johnAvailable = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'available' })
      .set(await authHeaders(app, prisma, JOHN));
    expect(johnAvailable.status).toBe(403);

    const byId = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'submitted', q: String(created.body.id) })
      .set(await authHeaders(app, prisma, JOHN));
    expect(byId.status).toBe(200);
    expect(byId.body.items.map((item: { id: number }) => item.id)).toEqual([created.body.id]);

    const available = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'available', q: String(created.body.id) })
      .set(await authHeaders(app, prisma, CHADI));
    expect(available.status).toBe(200);
    expect(available.body.items).toHaveLength(1);
    expect(available.body.items[0].currentOwnerId).toBeNull();

    const claimed = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/claim`)
      .set(await authHeaders(app, prisma, CHADI));
    expect(claimed.status).toBe(201);

    const afterClaim = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'available' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(afterClaim.body.items).toHaveLength(0);
    const owned = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'claimed' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(owned.body.items.map((item: { id: number }) => item.id)).toEqual([created.body.id]);

    await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/transition`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ to: 'IN_PROGRESS', changedBy: CHADI });
    await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/transition`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ to: 'COMPLETED', changedBy: CHADI });
    const done = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'completed' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(done.body.items[0].status).toBe('COMPLETED');
    const stillClaimed = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'claimed' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(stillClaimed.body.items).toHaveLength(0);
  });

  it('keeps pending requests out of Available and lets a Department Admin list department approvals', async () => {
    const deptType = await prisma.requestType.create({
      data: {
        companyId,
        departmentId: IT,
        name: `Access ${Date.now()}`,
        approvalPolicy: 'DEPARTMENT_ADMIN',
      },
    });
    const pending = await submit(JOHN, 'Badge', deptType.id);
    const hidden = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'available' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(hidden.body.items).toHaveLength(0);

    const admin = await prisma.employee.create({
      data: {
        name: 'IT Admin',
        email: `it.admin.queue.${Date.now()}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role: AccountRole.DEPARTMENT_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    createdAccountIds.push(admin.id);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: admin.email, password: TEST_PASSWORD });
    const headers = {
      Cookie: sessionCookieFrom(login),
      'X-CSRF-Token': String(login.body.csrfToken),
      Origin: TEST_ORIGIN,
    };
    const department = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'department' })
      .set(headers);
    expect(department.status).toBe(200);
    expect(department.body.items.map((item: { id: number }) => item.id)).toEqual([pending.body.id]);
    expect(department.body.items[0].approvalState).toBe('PENDING');

    const employeeDepartment = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'department' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(employeeDepartment.status).toBe(403);

    const mixed = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'available', workStatus: 'COMPLETED' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(mixed.status).toBe(400);
  });

  it('summarizes stored fields without merging them into one status', async () => {
    await submit(JOHN, 'Summary');
    const summary = await request(app.getHttpServer())
      .get('/requests/summary')
      .set(await authHeaders(app, prisma, JOHN));
    expect(summary.status).toBe(200);
    expect(summary.body.submissions.awaitingHandler).toBe(1);
    expect(summary.body.handling).toBeNull();
    expect(summary.body.departmentApprovals).toBeNull();
    expect(summary.body.myRequests).toEqual({
      total: 1,
      submitted: 1,
      completed: 0,
      inProgress: 0,
      unclaimed: 1,
      awaitingApproval: 0,
      approved: 0,
      denied: 0,
    });
    expect(summary.body).not.toHaveProperty('status');
  });

  it('combines work status and assignment on the submitter’s own requests and keeps legacy rows', async () => {
    const claimed = await submit(JOHN, 'Claimed submission');
    const unclaimed = await submit(JOHN, 'Unclaimed submission');
    await submit(CHADI, 'Someone else');
    const claim = await request(app.getHttpServer())
      .post(`/requests/${claimed.body.id}/claim`)
      .set(await authHeaders(app, prisma, CHADI));
    expect(claim.status).toBe(201);

    const legacy = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        title: 'Legacy null approval',
        approvalState: null,
        capturedApprovalPolicy: null,
        status: 'IN_PROGRESS',
        statusUpdatedAt: new Date(),
      },
    });

    const john = await authHeaders(app, prisma, JOHN);
    const all = await request(app.getHttpServer()).get('/requests').query({ queue: 'submitted' }).set(john);
    expect(all.status).toBe(200);
    expect(all.body.items.map((item: { title: string }) => item.title)).toEqual([
      'Legacy null approval',
      'Unclaimed submission',
      'Claimed submission',
    ]);
    expect(all.body.items.find((item: { id: number }) => item.id === legacy.id).approvalState).toBeNull();

    const submittedUnclaimed = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'submitted', workStatus: 'SUBMITTED', assignment: 'unclaimed' })
      .set(john);
    expect(submittedUnclaimed.status).toBe(200);
    expect(submittedUnclaimed.body.items.map((item: { id: number }) => item.id)).toEqual([unclaimed.body.id]);

    const submittedClaimed = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'submitted', workStatus: 'SUBMITTED', assignment: 'claimed' })
      .set(john);
    expect(submittedClaimed.body.items.map((item: { id: number }) => item.id)).toEqual([claimed.body.id]);

    const pending = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'submitted', approvalState: 'PENDING' })
      .set(john);
    expect(pending.body.items.map((item: { id: number }) => item.id)).not.toContain(legacy.id);

    const detail = await request(app.getHttpServer()).get(`/requests/${legacy.id}`).set(john);
    expect(detail.status).toBe(200);
    expect(detail.body.approvalState).toBeNull();
    expect(detail.body.title).toBe('Legacy null approval');

    const wrongQueue = await request(app.getHttpServer())
      .get('/requests')
      .query({ queue: 'available', assignment: 'unclaimed' })
      .set(await authHeaders(app, prisma, CHADI));
    expect(wrongQueue.status).toBe(400);
  });

  async function submit(actorId: number, title: string, requestTypeId = IT_TYPE) {
    return request(app.getHttpServer())
      .post('/requests')
      .set(await authHeaders(app, prisma, actorId))
      .send({ submittedBy: actorId, departmentId: IT, requestTypeId, title });
  }
});
