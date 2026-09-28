import { INestApplication } from '@nestjs/common';
import { ApprovalPolicy } from '@prisma/client';
import * as request from 'supertest';
import { EmailSender } from '../auth/email-sender';
import { LoginRateLimiter } from '../auth/login-rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import {
  authHeaders,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  createTestRequestType,
  IT,
  IT_TYPE,
  JOHN,
  removeNonDevelopmentCompanies,
  TEST_ORIGIN,
} from './test-helpers';

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

describe('request types and captured policy', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    app.get(LoginRateLimiter).reset();
    await cleanRequestData(prisma);
    const extras = await prisma.employee.findMany({
      where: { id: { notIn: [JOHN, 1] } },
      select: { id: true },
    });
    const ids = extras.map((employee) => employee.id);
    if (ids.length > 0) {
      await prisma.passwordReset.deleteMany({ where: { accountId: { in: ids } } });
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

  it('keeps request types inside one company and one destination department', async () => {
    const headersA = await signupAndVerify(app, {
      companyName: 'Types A',
      name: 'Founder A',
      email: 'types.a@operations-hub.test',
    });
    const headersB = await signupAndVerify(app, {
      companyName: 'Types B',
      name: 'Founder B',
      email: 'types.b@operations-hub.test',
    });
    const itA = (await request(app.getHttpServer()).get('/departments').set(headersA)).body.find(
      (row: { name: string }) => row.name === 'IT',
    );
    const hrA = (await request(app.getHttpServer()).get('/departments').set(headersA)).body.find(
      (row: { name: string }) => row.name === 'HR',
    );
    const itB = (await request(app.getHttpServer()).get('/departments').set(headersB)).body.find(
      (row: { name: string }) => row.name === 'IT',
    );
    const typeA = await createTestRequestType(app, headersA, itA.id, 'Laptop', 'NONE');
    const typeHr = await createTestRequestType(app, headersA, hrA.id, 'Certificate', 'DEPARTMENT_ADMIN');
    const typeB = await createTestRequestType(app, headersB, itB.id, 'Laptop', 'SUPER_ADMIN');

    const listedA = await request(app.getHttpServer()).get('/request-types').set(headersA);
    const listedB = await request(app.getHttpServer()).get('/request-types').set(headersB);
    expect(listedA.status).toBe(200);
    expect(listedA.body.map((row: { id: number }) => row.id)).toEqual(
      expect.arrayContaining([typeA.id, typeHr.id]),
    );
    expect(listedA.body.map((row: { id: number }) => row.id)).not.toContain(typeB.id);
    expect(listedB.body.map((row: { id: number }) => row.id)).toEqual([typeB.id]);

    const steal = await request(app.getHttpServer())
      .patch(`/request-types/${typeB.id}`)
      .set(headersA)
      .send({ name: 'Stolen' });
    expect(steal.status).toBe(404);

    const founderA = await prisma.employee.findUniqueOrThrow({
      where: { email: 'types.a@operations-hub.test' },
    });
    const wrongDepartment = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: itA.id,
      requestTypeId: typeHr.id,
      title: 'Wrong department type',
    });
    expect(wrongDepartment.status).toBe(400);
    const otherCompany = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founderA.id,
      departmentId: itA.id,
      requestTypeId: typeB.id,
      title: 'Other company type',
    });
    expect(otherCompany.status).toBe(400);
    expect(await prisma.request.count({ where: { companyId: founderA.companyId } })).toBe(0);
  });

  it('rejects an unknown type, a client-supplied snapshot, and a missing type', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Invalid Type Co',
      name: 'Founder',
      email: 'invalid.type@operations-hub.test',
    });
    const it = (await request(app.getHttpServer()).get('/departments').set(headers)).body.find(
      (row: { name: string }) => row.name === 'IT',
    );
    const type = await createTestRequestType(app, headers, it.id, 'Hardware', 'NONE');
    const founder = await prisma.employee.findUniqueOrThrow({
      where: { email: 'invalid.type@operations-hub.test' },
    });

    const missing = await request(app.getHttpServer()).post('/requests').set(headers).send({
      submittedBy: founder.id,
      departmentId: it.id,
      title: 'No type',
    });
    expect(missing.status).toBe(400);

    const unknown = await request(app.getHttpServer()).post('/requests').set(headers).send({
      submittedBy: founder.id,
      departmentId: it.id,
      requestTypeId: 999999,
      title: 'Unknown type',
    });
    expect(unknown.status).toBe(400);

    const suppliedPolicy = await request(app.getHttpServer()).post('/requests').set(headers).send({
      submittedBy: founder.id,
      departmentId: it.id,
      requestTypeId: type.id,
      capturedApprovalPolicy: 'SUPER_ADMIN',
      title: 'Forged policy',
    });
    expect(suppliedPolicy.status).toBe(400);
    expect(await prisma.request.count({ where: { submittedBy: founder.id } })).toBe(0);
  });

  it('snapshots the live policy at submit and ignores later type edits', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Snapshot Co',
      name: 'Founder',
      email: 'snapshot.type@operations-hub.test',
    });
    const it = (await request(app.getHttpServer()).get('/departments').set(headers)).body.find(
      (row: { name: string }) => row.name === 'IT',
    );
    const type = await createTestRequestType(app, headers, it.id, 'Access', 'DEPARTMENT_ADMIN');
    const founder = await prisma.employee.findUniqueOrThrow({
      where: { email: 'snapshot.type@operations-hub.test' },
    });

    const created = await request(app.getHttpServer()).post('/requests').set(headers).send({
      submittedBy: founder.id,
      departmentId: it.id,
      requestTypeId: type.id,
      title: 'VPN access',
    });
    expect(created.status).toBe(201);
    expect(created.body.requestTypeId).toBe(type.id);
    expect(created.body.capturedApprovalPolicy).toBe('DEPARTMENT_ADMIN');
    expect(created.body.requestType).toEqual({ id: type.id, name: 'Access' });

    const renamed = await request(app.getHttpServer())
      .patch(`/request-types/${type.id}`)
      .set(headers)
      .send({ name: 'Remote access', approvalPolicy: 'SUPER_ADMIN' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      id: type.id,
      name: 'Remote access',
      approvalPolicy: 'SUPER_ADMIN',
    });

    const stored = await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.capturedApprovalPolicy).toBe(ApprovalPolicy.DEPARTMENT_ADMIN);
    expect(stored.requestTypeId).toBe(type.id);

    const read = await request(app.getHttpServer()).get(`/requests/${created.body.id}`).set(headers);
    expect(read.status).toBe(200);
    expect(read.body.capturedApprovalPolicy).toBe('DEPARTMENT_ADMIN');
    expect(read.body.requestType).toEqual({ id: type.id, name: 'Remote access' });
  });

  it('keeps existing requests readable when they have no type or snapshot', async () => {
    const headers = await authHeaders(app, prisma, JOHN);
    const companyId = (await prisma.employee.findUniqueOrThrow({ where: { id: JOHN } })).companyId;
    const preserved = await prisma.request.create({
      data: {
        companyId,
        submittedBy: JOHN,
        departmentId: IT,
        requestTypeId: null,
        capturedApprovalPolicy: null,
        currentOwnerId: null,
        status: 'SUBMITTED',
        statusUpdatedAt: new Date(),
        title: 'Legacy request',
        description: 'Created before request types',
      },
    });

    const read = await request(app.getHttpServer()).get(`/requests/${preserved.id}`).set(headers);
    expect(read.status).toBe(200);
    expect(read.body.title).toBe('Legacy request');
    expect(read.body.description).toBe('Created before request types');
    expect(read.body.departmentId).toBe(IT);
    expect(read.body.requestTypeId).toBeNull();
    expect(read.body.capturedApprovalPolicy).toBeNull();
    expect(read.body.requestType).toBeNull();

    const johnCreate = await request(app.getHttpServer()).post('/requests').set(headers).send({
      submittedBy: JOHN,
      departmentId: IT,
      requestTypeId: IT_TYPE,
      title: 'Typed request',
    });
    expect(johnCreate.status).toBe(201);
    expect(johnCreate.body.capturedApprovalPolicy).toBe('NONE');
    expect(johnCreate.body.requestTypeId).toBe(IT_TYPE);
  });

  it('does not let staff create or edit request types', async () => {
    const headers = await signupAndVerify(app, {
      companyName: 'Staff Types',
      name: 'Founder',
      email: 'staff.types@operations-hub.test',
    });
    const it = (await request(app.getHttpServer()).get('/departments').set(headers)).body.find(
      (row: { name: string }) => row.name === 'IT',
    );
    const type = await createTestRequestType(app, headers, it.id, 'Hardware');
    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headers).send({
      email: 'types.staff@operations-hub.test',
      name: 'Type Staff',
      departmentId: it.id,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(invited.status).toBe(201);
    const inviteToken = await outboxToken(app, 'types.staff@operations-hub.test', 'invitation');
    expect(
      (
        await request(app.getHttpServer())
          .post('/auth/invitations/accept')
          .set('Origin', TEST_ORIGIN)
          .send({ token: inviteToken, password: PASSWORD })
      ).status,
    ).toBe(200);
    const staffHeaders = await loginHeaders(app, 'types.staff@operations-hub.test', PASSWORD);
    const createDenied = await request(app.getHttpServer())
      .post(`/departments/${it.id}/request-types`)
      .set(staffHeaders)
      .send({ name: 'Secret', approvalPolicy: 'NONE' });
    expect(createDenied.status).toBe(403);
    const patchDenied = await request(app.getHttpServer())
      .patch(`/request-types/${type.id}`)
      .set(staffHeaders)
      .send({ approvalPolicy: 'SUPER_ADMIN' });
    expect(patchDenied.status).toBe(403);
    const deleteDenied = await request(app.getHttpServer())
      .delete(`/request-types/${type.id}`)
      .set(staffHeaders);
    expect(deleteDenied.status).toBe(403);
  });

  it('lets a Super Admin remove an unused request type and keeps one that has requests', async () => {
    const stamp = Date.now();
    const headers = await signupAndVerify(app, {
      companyName: `Remove Type ${stamp}`,
      name: 'Founder',
      email: `remove.type.${stamp}@operations-hub.test`,
    });
    const it = (await request(app.getHttpServer()).get('/departments').set(headers)).body.find(
      (row: { name: string }) => row.name === 'IT',
    );
    const spare = await createTestRequestType(app, headers, it.id, 'Spare', 'NONE');
    const used = await createTestRequestType(app, headers, it.id, 'Used', 'NONE');
    const founder = await prisma.employee.findUniqueOrThrow({
      where: { email: `remove.type.${stamp}@operations-hub.test` },
    });
    const submitted = await request(app.getHttpServer()).post('/requests').set(headers).send({
      submittedBy: founder.id,
      departmentId: it.id,
      requestTypeId: used.id,
      title: 'Keep this type',
    });
    expect(submitted.status).toBe(201);

    const removed = await request(app.getHttpServer()).delete(`/request-types/${spare.id}`).set(headers);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true });
    expect(await prisma.requestType.findUnique({ where: { id: spare.id } })).toBeNull();

    const blocked = await request(app.getHttpServer()).delete(`/request-types/${used.id}`).set(headers);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('A request type that is used by requests cannot be removed');
    expect(await prisma.requestType.findUnique({ where: { id: used.id } })).not.toBeNull();
  });
});
