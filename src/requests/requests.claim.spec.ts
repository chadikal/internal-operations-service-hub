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
  developmentCompanyId,
  HR,
  IT,
  IT_TYPE,
  JOHN,
  removeNonDevelopmentCompanies,
  sessionCookieFrom,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './test-helpers';

jest.setTimeout(60_000);

describe('Handler self-claim', () => {
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
      data: { canHandle: false, active: true, departmentId: IT },
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

  it('lets an eligible handler claim an unassigned request and start it later', async () => {
    const created = await submit(JOHN, IT, IT_TYPE);
    const claimed = await claim(CHADI, created.body.id);
    expect(claimed.status).toBe(201);
    expect(claimed.body.currentOwnerId).toBe(CHADI);
    expect(claimed.body.status).toBe('SUBMITTED');
    expect(claimed.body.approvalState).toBe('NOT_REQUIRED');
    expect(await prisma.requestStatusHistory.count({ where: { requestId: created.body.id } })).toBe(0);

    const started = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/transition`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ to: 'IN_PROGRESS', changedBy: CHADI });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_PROGRESS');
    expect(started.body.currentOwnerId).toBe(CHADI);
  });

  it('rejects the submitter, another department, a pending or denied request, and a second claim', async () => {
    await prisma.employee.update({ where: { id: JOHN }, data: { canHandle: true } });
    const own = await submit(JOHN, IT, IT_TYPE);
    const ownClaim = await claim(JOHN, own.body.id);
    expect(ownClaim.status).toBe(403);
    expect(ownClaim.body.message).toMatch(/submitted/i);

    const hrHandler = await addHandler('HR Handler', HR);
    const otherDepartment = await claim(hrHandler.id, own.body.id);
    expect(otherDepartment.status).toBe(403);
    expect(otherDepartment.body.message).toMatch(/your department/i);

    const deptType = await prisma.requestType.create({
      data: {
        companyId,
        departmentId: IT,
        name: `Access ${Date.now()}`,
        approvalPolicy: 'DEPARTMENT_ADMIN',
      },
    });
    const itAdmin = await addHandler('IT Admin', IT, AccountRole.DEPARTMENT_ADMIN);
    const pending = await submit(JOHN, IT, deptType.id);
    const pendingClaim = await claim(CHADI, pending.body.id);
    expect(pendingClaim.status).toBe(409);
    expect(pendingClaim.body.message).toMatch(/waiting for approval/i);

    const denied = await request(app.getHttpServer())
      .post(`/requests/${pending.body.id}/approval`)
      .set(await login(requiredEmail(itAdmin.email)))
      .send({ decision: 'DENIED', reason: 'Not now' });
    expect(denied.status).toBe(201);
    const deniedClaim = await claim(CHADI, pending.body.id);
    expect(deniedClaim.status).toBe(409);
    expect(deniedClaim.body.message).toMatch(/denied/i);

    const approved = await submit(JOHN, IT, deptType.id);
    const decision = await request(app.getHttpServer())
      .post(`/requests/${approved.body.id}/approval`)
      .set(await login(requiredEmail(itAdmin.email)))
      .send({ decision: 'APPROVED' });
    expect(decision.status).toBe(201);
    const first = await claim(CHADI, approved.body.id);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('SUBMITTED');
    const second = await claim(hrHandler.id, approved.body.id);
    expect(second.status).toBe(403);
    const again = await claim(CHADI, approved.body.id);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already has an owner/i);
    expect(
      (await prisma.request.findUniqueOrThrow({ where: { id: approved.body.id } })).currentOwnerId,
    ).toBe(CHADI);
  });

  it('rejects Super Admin, an inactive handler, and a non-owner transition', async () => {
    const created = await submit(JOHN, IT, IT_TYPE);
    const founder = await addHandler('Founder', IT, AccountRole.SUPER_ADMIN);
    await prisma.employee.update({ where: { id: founder.id }, data: { canHandle: true } });
    const superClaim = await claim(founder.id, created.body.id);
    expect(superClaim.status).toBe(403);
    expect(superClaim.body.message).toMatch(/not allowed to handle/i);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } })).currentOwnerId).toBeNull();

    const peer = await addHandler('Peer', IT);
    const peerHeaders = await login(requiredEmail(peer.email));
    await prisma.employee.update({ where: { id: peer.id }, data: { active: false } });
    const inactive = await request(app.getHttpServer())
      .post(`/requests/${created.body.id}/claim`)
      .set(peerHeaders);
    expect(inactive.status).toBe(401);

    const claimed = await claim(CHADI, created.body.id);
    expect(claimed.status).toBe(201);
    await prisma.employee.update({ where: { id: peer.id }, data: { active: true } });
    const transition = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/transition`)
      .set(await login(requiredEmail(peer.email)))
      .send({ to: 'IN_PROGRESS', changedBy: peer.id });
    expect(transition.status).toBe(409);
    expect(transition.body.message).toMatch(/current owner/i);
    const row = await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.status).toBe('SUBMITTED');
    expect(row.currentOwnerId).toBe(CHADI);
    expect(await prisma.requestStatusHistory.count({ where: { requestId: created.body.id } })).toBe(0);
  });

  it('lets exactly one of two concurrent claims become the owner', async () => {
    const created = await submit(JOHN, IT, IT_TYPE);
    const peer = await addHandler('Racer', IT);
    const [first, second] = await Promise.all([claim(CHADI, created.body.id), claim(peer.id, created.body.id)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const row = await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } });
    expect([CHADI, peer.id]).toContain(row.currentOwnerId);
    expect(row.status).toBe('SUBMITTED');
    expect(await prisma.requestStatusHistory.count({ where: { requestId: created.body.id } })).toBe(0);
  });

  it('blocks assigning another person and hides another company', async () => {
    const created = await submit(JOHN, IT, IT_TYPE);
    const blocked = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ currentOwnerId: CHADI });
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/cannot be assigned/i);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } })).currentOwnerId).toBeNull();

    const other = await prisma.company.create({
      data: { name: `Other ${Date.now()}`, status: 'ACTIVE' },
    });
    const outsider = await prisma.employee.create({
      data: {
        name: 'Outsider',
        email: `outsider.claim.${Date.now()}@operations-hub.test`,
        companyId: other.id,
        departmentId: null,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role: AccountRole.EMPLOYEE,
        canHandle: true,
        active: true,
      },
    });
    createdAccountIds.push(outsider.id);
    const foreign = await claim(outsider.id, created.body.id);
    expect(foreign.status).toBe(404);
  });

  it('claims an unassigned legacy request and lets the owner complete it', async () => {
    const legacy = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Legacy unassigned',
      },
    });
    const claimed = await claim(CHADI, legacy.id);
    expect(claimed.status).toBe(201);
    expect(claimed.body.currentOwnerId).toBe(CHADI);
    expect(claimed.body.status).toBe('SUBMITTED');
    expect(claimed.body.approvalState).toBeNull();
    expect(claimed.body.capturedApprovalPolicy).toBeNull();
    expect(await prisma.requestStatusHistory.count({ where: { requestId: legacy.id } })).toBe(0);

    const headers = await authHeaders(app, prisma, CHADI);
    const started = await request(app.getHttpServer())
      .patch(`/requests/${legacy.id}/transition`)
      .set(headers)
      .send({ to: 'IN_PROGRESS', changedBy: CHADI });
    expect(started.status).toBe(200);
    const completed = await request(app.getHttpServer())
      .patch(`/requests/${legacy.id}/transition`)
      .set(headers)
      .send({ to: 'COMPLETED', changedBy: CHADI });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.currentOwnerId).toBe(CHADI);
    const row = await prisma.request.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(row.approvalState).toBeNull();
    expect(row.capturedApprovalPolicy).toBeNull();
    expect(await prisma.requestStatusHistory.count({ where: { requestId: legacy.id } })).toBe(2);
  });

  it('claims a typed NONE request that still has a null approval state', async () => {
    const typed = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        requestTypeId: IT_TYPE,
        capturedApprovalPolicy: 'NONE',
        approvalState: null,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Legacy none',
      },
    });
    const claimed = await claim(CHADI, typed.id);
    expect(claimed.status).toBe(201);
    expect(claimed.body.approvalState).toBeNull();
    expect(claimed.body.capturedApprovalPolicy).toBe('NONE');
    expect(claimed.body.status).toBe('SUBMITTED');
  });

  it('keeps a required-policy null state blocked until approval, and keeps pending and denied blocked', async () => {
    const deptType = await prisma.requestType.create({
      data: {
        companyId,
        departmentId: IT,
        name: `Leave ${Date.now()}`,
        approvalPolicy: 'DEPARTMENT_ADMIN',
      },
    });
    const waiting = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        requestTypeId: deptType.id,
        capturedApprovalPolicy: 'DEPARTMENT_ADMIN',
        approvalState: null,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Needs a decision',
      },
    });
    const blocked = await claim(CHADI, waiting.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/waiting for approval/i);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: waiting.id } })).currentOwnerId).toBeNull();

    const owned = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        requestTypeId: deptType.id,
        capturedApprovalPolicy: 'SUPER_ADMIN',
        approvalState: null,
        currentOwnerId: CHADI,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Owned before approval',
      },
    });
    const early = await request(app.getHttpServer())
      .patch(`/requests/${owned.id}/transition`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ to: 'IN_PROGRESS', changedBy: CHADI });
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/waiting for approval/i);

    const itAdmin = await addHandler('IT Admin', IT, AccountRole.DEPARTMENT_ADMIN);
    const decision = await request(app.getHttpServer())
      .post(`/requests/${waiting.id}/approval`)
      .set(await login(requiredEmail(itAdmin.email)))
      .send({ decision: 'APPROVED' });
    expect(decision.status).toBe(201);
    expect(decision.body.approvalState).toBe('APPROVED');
    const claimed = await claim(CHADI, waiting.id);
    expect(claimed.status).toBe(201);
    expect(claimed.body.status).toBe('SUBMITTED');
    expect(claimed.body.approvalState).toBe('APPROVED');

    const pending = await submit(JOHN, IT, deptType.id);
    const pendingClaim = await claim(CHADI, pending.body.id);
    expect(pendingClaim.status).toBe(409);
    expect(pendingClaim.body.message).toMatch(/waiting for approval/i);
    const denied = await request(app.getHttpServer())
      .post(`/requests/${pending.body.id}/approval`)
      .set(await login(requiredEmail(itAdmin.email)))
      .send({ decision: 'DENIED', reason: 'Not this one' });
    expect(denied.status).toBe(201);
    const deniedClaim = await claim(CHADI, pending.body.id);
    expect(deniedClaim.status).toBe(409);
    expect(deniedClaim.body.message).toMatch(/denied/i);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: pending.body.id } })).currentOwnerId).toBeNull();
  });

  it('keeps a legacy owner and history, and does not replace that owner', async () => {
    const legacy = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        currentOwnerId: CHADI,
        status: RequestStatus.SUBMITTED,
        statusUpdatedAt: new Date(),
        title: 'Legacy owned',
      },
    });
    await prisma.requestStatusHistory.create({
      data: {
        companyId,
        requestId: legacy.id,
        previousStatus: RequestStatus.SUBMITTED,
        newStatus: RequestStatus.SUBMITTED,
        changedBy: CHADI,
        changedAt: new Date(),
      },
    });
    const rejected = await claim(CHADI, legacy.id);
    expect(rejected.status).toBe(409);
    expect(rejected.body.message).toMatch(/already has an owner/i);
    const row = await prisma.request.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(row.currentOwnerId).toBe(CHADI);
    expect(row.approvalState).toBeNull();
    expect(await prisma.requestStatusHistory.count({ where: { requestId: legacy.id } })).toBe(1);

    const started = await request(app.getHttpServer())
      .patch(`/requests/${legacy.id}/transition`)
      .set(await authHeaders(app, prisma, CHADI))
      .send({ to: 'IN_PROGRESS', changedBy: CHADI });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('IN_PROGRESS');
  });

  async function submit(actorId: number, departmentId: number, requestTypeId: number) {
    return request(app.getHttpServer())
      .post('/requests')
      .set(await authHeaders(app, prisma, actorId))
      .send({ submittedBy: actorId, departmentId, requestTypeId, title: 'Claim me' });
  }

  async function claim(actorId: number, id: number) {
    const headers =
      actorId === JOHN || actorId === CHADI
        ? await authHeaders(app, prisma, actorId)
        : await login(requiredEmail((await prisma.employee.findUniqueOrThrow({ where: { id: actorId } })).email));
    return request(app.getHttpServer()).post(`/requests/${id}/claim`).set(headers);
  }

  function requiredEmail(email: string | null) {
    if (!email) {
      throw new Error('Test account is missing an email');
    }
    return email;
  }

  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    return {
      Cookie: sessionCookieFrom(response),
      'X-CSRF-Token': String(response.body.csrfToken),
      Origin: TEST_ORIGIN,
    };
  }

  async function addHandler(name: string, departmentId: number, role: AccountRole = AccountRole.EMPLOYEE) {
    const email = `${name.toLowerCase().replace(/ /g, '.')}.${Date.now()}@operations-hub.test`;
    const employee = await prisma.employee.create({
      data: {
        name,
        email,
        companyId,
        departmentId,
        passwordHash: await hashPassword(TEST_PASSWORD),
        role,
        canHandle: true,
        active: true,
      },
    });
    createdAccountIds.push(employee.id);
    return employee;
  }
});
