import { INestApplication } from '@nestjs/common';
import { AccountRole, ApprovalState, RequestStatus } from '@prisma/client';
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

describe('Approval decisions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: number;
  let superAdminId: number;
  let itAdminId: number;
  let itAdminTwoId: number;
  let hrAdminId: number;
  let deptTypeId: number;
  let superTypeId: number;
  const createdAccountIds: number[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    companyId = await developmentCompanyId(prisma);
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const stamp = Date.now();
    const superAdmin = await prisma.employee.create({
      data: {
        name: 'Ada Approver',
        email: `ada.approver.${stamp}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash,
        role: AccountRole.SUPER_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    const itAdmin = await prisma.employee.create({
      data: {
        name: 'Dana IT',
        email: `dana.it.${stamp}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash,
        role: AccountRole.DEPARTMENT_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    const itAdminTwo = await prisma.employee.create({
      data: {
        name: 'Rami IT',
        email: `rami.it.${stamp}@operations-hub.test`,
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
        email: `hana.hr.${stamp}@operations-hub.test`,
        companyId,
        departmentId: HR,
        passwordHash,
        role: AccountRole.DEPARTMENT_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    superAdminId = superAdmin.id;
    itAdminId = itAdmin.id;
    itAdminTwoId = itAdminTwo.id;
    hrAdminId = hrAdmin.id;
    createdAccountIds.push(superAdminId, itAdminId, itAdminTwoId, hrAdminId);

    const superHeaders = await login(superAdmin.email!);
    const deptType = await createTestRequestType(app, superHeaders, IT, 'Access approval', 'DEPARTMENT_ADMIN');
    const superType = await createTestRequestType(app, superHeaders, IT, 'Purchase exception', 'SUPER_ADMIN');
    deptTypeId = deptType.id;
    superTypeId = superType.id;
  });

  afterEach(async () => {
    await cleanRequestData(prisma);
  });

  afterAll(async () => {
    await cleanRequestData(prisma);
    if (createdAccountIds.length > 0) {
      await prisma.session.deleteMany({ where: { accountId: { in: createdAccountIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: createdAccountIds } } });
    }
    await removeNonDevelopmentCompanies(prisma);
    await prisma.requestType.deleteMany({
      where: { companyId, id: { notIn: [1, 2, 3] } },
    });
    await closeTestApp(app);
  });

  it('leaves NONE requests undecided and lets handlers take them', async () => {
    const created = await submit(JOHN, IT, IT_TYPE, 'Laptop');
    expect(created.body.approvalState).toBe('NOT_REQUIRED');
    expect(created.body.approvalDecision).toBeNull();
    expect(created.body.noEligibleApprover).toBe(false);
    expect(created.body.status).toBe('SUBMITTED');

    const unnecessary = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(JOHN))
      .send({ decision: 'APPROVED' });
    expect(unnecessary.status).toBe(409);
    expect(unnecessary.body.message).toMatch(/does not require/i);

    const assigned = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ currentOwnerId: CHADI });
    expect(assigned.status).toBe(200);
    expect(assigned.body.approvalState).toBe('NOT_REQUIRED');
  });

  it('routes a department request to that department admin and blocks handling until approval', async () => {
    const created = await submit(JOHN, IT, deptTypeId, 'Badge access');
    expect(created.body.approvalState).toBe('PENDING');
    expect(created.body.status).toBe('SUBMITTED');
    expect(created.body.noEligibleApprover).toBe(false);

    const inbox = await request(app.getHttpServer()).get('/requests/approvals').set(await loginById(itAdminId));
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.map((item: { id: number }) => item.id)).toContain(created.body.id);
    expect(inbox.body.items.find((item: { id: number }) => item.id === created.body.id).description).toBe(
      'Badge access',
    );

    const hrInbox = await request(app.getHttpServer()).get('/requests/approvals').set(await loginById(hrAdminId));
    expect(hrInbox.status).toBe(200);
    expect(hrInbox.body.items).toEqual([]);

    const employeeInbox = await request(app.getHttpServer())
      .get('/requests/approvals')
      .set(await loginById(JOHN));
    expect(employeeInbox.status).toBe(403);

    const wrongDepartment = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(hrAdminId))
      .send({ decision: 'APPROVED' });
    expect(wrongDepartment.status).toBe(403);

    const selfView = await request(app.getHttpServer())
      .get(`/requests/${created.body.id}`)
      .set(await loginById(itAdminId));
    expect(selfView.status).toBe(200);
    expect(selfView.body.description).toBe('Badge access');

    const blockedAssign = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ currentOwnerId: CHADI });
    expect(blockedAssign.status).toBe(409);
    expect(blockedAssign.body.message).toMatch(/waiting for approval/i);

    const missingReason = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(itAdminId))
      .send({ decision: 'DENIED' });
    expect(missingReason.status).toBe(400);

    const denied = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(itAdminId))
      .send({ decision: 'DENIED', reason: '  Not this team  ' });
    expect(denied.status).toBe(201);
    expect(denied.body.approvalState).toBe('DENIED');
    expect(denied.body.status).toBe('SUBMITTED');
    expect(denied.body.approvalDecision).toEqual(
      expect.objectContaining({
        decision: 'DENIED',
        reason: 'Not this team',
        approverId: itAdminId,
        approverRole: 'DEPARTMENT_ADMIN',
      }),
    );
    expect(denied.body.approvalDecision.decidedAt).toEqual(expect.any(String));

    const repeat = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(itAdminTwoId))
      .send({ decision: 'APPROVED' });
    expect(repeat.status).toBe(409);

    const stillDenied = await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stillDenied.approvalState).toBe(ApprovalState.DENIED);
    expect(stillDenied.status).toBe(RequestStatus.SUBMITTED);
    expect(await prisma.approvalDecision.count({ where: { requestId: created.body.id } })).toBe(1);

    const blockedAfterDenial = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ currentOwnerId: CHADI });
    expect(blockedAfterDenial.status).toBe(409);
    expect(blockedAfterDenial.body.message).toMatch(/denied/i);
  });

  it('approves without changing work status and then allows temporary assignment', async () => {
    const created = await submit(JOHN, IT, deptTypeId, 'Software seat');
    const approved = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(itAdminId))
      .send({ decision: 'APPROVED' });
    expect(approved.status).toBe(201);
    expect(approved.body.approvalState).toBe('APPROVED');
    expect(approved.body.status).toBe('SUBMITTED');
    expect(approved.body.approvalDecision.approverRole).toBe('DEPARTMENT_ADMIN');

    const assigned = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ currentOwnerId: CHADI });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('SUBMITTED');
    expect(assigned.body.approvalState).toBe('APPROVED');
  });

  it('rejects self-approval and stays pending when no other department admin can decide', async () => {
    const solo = await prisma.employee.create({
      data: {
        name: 'Solo HR',
        email: `solo.hr.${Date.now()}@operations-hub.test`,
        companyId,
        departmentId: HR,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role: AccountRole.DEPARTMENT_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    createdAccountIds.push(solo.id);
    await prisma.employee.update({ where: { id: hrAdminId }, data: { active: false } });
    try {
      const hrType = await createTestRequestType(
        app,
        await loginById(superAdminId),
        HR,
        `Leave ${Date.now()}`,
        'DEPARTMENT_ADMIN',
      );
      const created = await submit(solo.id, HR, hrType.id, 'My own leave');
      expect(created.body.approvalState).toBe('PENDING');
      expect(created.body.noEligibleApprover).toBe(true);
      expect(created.body.approvalNotice).toMatch(/No other Department Admin/);

      const selfDecision = await request(app.getHttpServer())
        .post(`/requests/${created.body.id}/approval`)
        .set(await loginById(solo.id))
        .send({ decision: 'APPROVED' });
      expect(selfDecision.status).toBe(403);
      expect(selfDecision.body.message).toMatch(/own request/i);

      const stored = await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stored.approvalState).toBe(ApprovalState.PENDING);
      expect(await prisma.approvalDecision.count({ where: { requestId: created.body.id } })).toBe(0);
    } finally {
      await prisma.employee.update({ where: { id: hrAdminId }, data: { active: true } });
    }
  });

  it('lets another Super Admin decide a captured SUPER_ADMIN request and keeps unrelated detail closed', async () => {
    const created = await submit(superAdminId, IT, superTypeId, 'Exception spend');
    expect(created.body.noEligibleApprover).toBe(true);
    expect(created.body.approvalNotice).toMatch(/No other Super Admin/);

    const selfDecision = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(superAdminId))
      .send({ decision: 'APPROVED' });
    expect(selfDecision.status).toBe(403);

    const second = await prisma.employee.create({
      data: {
        name: 'Second Super',
        email: `second.super.${Date.now()}@operations-hub.test`,
        companyId,
        departmentId: IT,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role: AccountRole.SUPER_ADMIN,
        canHandle: true,
        active: true,
      },
    });
    createdAccountIds.push(second.id);

    const waiting = await request(app.getHttpServer())
      .get(`/requests/${created.body.id}`)
      .set(await loginById(superAdminId));
    expect(waiting.body.noEligibleApprover).toBe(false);

    const inbox = await request(app.getHttpServer()).get('/requests/approvals').set(await loginById(second.id));
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.map((item: { id: number }) => item.id)).toEqual([created.body.id]);

    const detail = await request(app.getHttpServer())
      .get(`/requests/${created.body.id}`)
      .set(await loginById(second.id));
    expect(detail.status).toBe(200);
    expect(detail.body.description).toBe('Exception spend');
    const history = await request(app.getHttpServer())
      .get(`/requests/${created.body.id}/history`)
      .set(await loginById(second.id));
    expect(history.status).toBe(200);

    const unrelated = await submit(JOHN, IT, IT_TYPE, 'Ordinary laptop');
    const hidden = await request(app.getHttpServer())
      .get(`/requests/${unrelated.body.id}`)
      .set(await loginById(second.id));
    expect(hidden.status).toBe(403);
    const hiddenHistory = await request(app.getHttpServer())
      .get(`/requests/${unrelated.body.id}/history`)
      .set(await loginById(second.id));
    expect(hiddenHistory.status).toBe(403);

    const oversight = await request(app.getHttpServer())
      .get('/admin/requests')
      .set(await loginById(second.id));
    expect(oversight.status).toBe(200);
    const listed = oversight.body.items.find((item: { id: number }) => item.id === created.body.id);
    expect(listed).toEqual(
      expect.objectContaining({
        id: created.body.id,
        title: 'Exception spend',
        status: 'SUBMITTED',
      }),
    );
    expect(listed).not.toHaveProperty('description');
    expect(listed).not.toHaveProperty('approvalState');
    expect(JSON.stringify(oversight.body)).not.toMatch(/Exception spend details|approvalNotice/);

    const otherCompany = await prisma.company.create({
      data: { name: `Elsewhere ${Date.now()}`, status: 'ACTIVE' },
    });
    const outsider = await prisma.employee.create({
      data: {
        name: 'Outsider',
        email: `outsider.${Date.now()}@operations-hub.test`,
        companyId: otherCompany.id,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role: AccountRole.SUPER_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    const cross = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await login(outsider.email!))
      .send({ decision: 'APPROVED' });
    expect(cross.status).toBe(404);
    const crossRead = await request(app.getHttpServer())
      .get(`/requests/${created.body.id}`)
      .set(await login(outsider.email!));
    expect(crossRead.status).toBe(404);

    const approved = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/approval`)
      .set(await loginById(second.id))
      .send({ decision: 'APPROVED' });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('SUBMITTED');
    expect(approved.body.approvalDecision.approverRole).toBe('SUPER_ADMIN');

    const handled = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(await loginById(second.id))
      .send({ currentOwnerId: CHADI });
    expect(handled.status).toBe(403);
  });

  it('records exactly one decision when two admins decide together', async () => {
    const created = await submit(JOHN, IT, deptTypeId, 'Concurrent seat');
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/requests/${created.body.id}/approval`)
        .set(await loginById(itAdminId))
        .send({ decision: 'APPROVED' }),
      request(app.getHttpServer())
        .post(`/requests/${created.body.id}/approval`)
        .set(await loginById(itAdminTwoId))
        .send({ decision: 'DENIED', reason: 'Too late' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const stored = await prisma.request.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { approvalDecision: true },
    });
    expect(stored.status).toBe(RequestStatus.SUBMITTED);
    expect(stored.approvalState === ApprovalState.APPROVED || stored.approvalState === ApprovalState.DENIED).toBe(
      true,
    );
    expect(stored.approvalDecision).not.toBeNull();
    expect(await prisma.approvalDecision.count({ where: { requestId: created.body.id } })).toBe(1);
  });

  it('keeps a legacy request without an approval state readable and handleable', async () => {
    const legacy = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Legacy title',
      },
    });
    const read = await request(app.getHttpServer())
      .get(`/requests/${legacy.id}`)
      .set(await loginById(JOHN));
    expect(read.status).toBe(200);
    expect(read.body.approvalState).toBeNull();
    expect(read.body.capturedApprovalPolicy).toBeNull();
    expect(read.body.approvalDecision).toBeNull();

    const assigned = await request(app.getHttpServer())
      .patch(`/requests/${legacy.id}/owner`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ currentOwnerId: CHADI });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('SUBMITTED');
  });

  async function submit(actorId: number, departmentId: number, requestTypeId: number, description: string) {
    return request(app.getHttpServer())
      .post('/requests')
      .set(await loginById(actorId))
      .send({ submittedBy: actorId, departmentId, requestTypeId, title: description, description });
  }

  async function loginById(actorId: number) {
    if (actorId === JOHN) {
      return authHeaders(app, prisma, JOHN);
    }
    if (actorId === CHADI) {
      return authHeaders(app, prisma, CHADI);
    }
    const account = await prisma.employee.findUniqueOrThrow({ where: { id: actorId } });
    return login(account.email!);
  }

  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD });
    if (response.status !== 200) {
      throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    const raw = response.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
    const match = /hub_session=([^;]+)/.exec(header);
    if (!match) {
      throw new Error('Login did not set a session cookie');
    }
    return {
      Cookie: `hub_session=${match[1]}`,
      'X-CSRF-Token': String(response.body.csrfToken),
    };
  }
});
