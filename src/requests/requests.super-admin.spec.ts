import { INestApplication } from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import * as request from 'supertest';
import { EmailSender } from '../auth/email-sender';
import { LoginRateLimiter } from '../auth/login-rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanRequestData,
  closeTestApp,
  createTestApp,
  createTestRequestType,
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

async function loginHeaders(app: INestApplication, email: string) {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password: PASSWORD });
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

describe('Super Admin request prohibitions', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    app.get(LoginRateLimiter).reset();
    await cleanRequestData(prisma);
    await removeNonDevelopmentCompanies(prisma);
  });

  afterEach(async () => {
    await cleanRequestData(prisma);
    await removeNonDevelopmentCompanies(prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  async function companyWithHandler() {
    const created = await request(app.getHttpServer()).post('/auth/signup').set('Origin', TEST_ORIGIN).send({
      companyName: 'Handle Ban Co',
      name: 'Ada Super',
      email: 'ada.ban@operations-hub.test',
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    const verify = await request(app.getHttpServer()).post('/auth/verify-email').set('Origin', TEST_ORIGIN).send({
      token: await outboxToken(app, 'ada.ban@operations-hub.test', 'email-verification'),
    });
    expect(verify.status).toBe(200);
    const headersA = await loginHeaders(app, 'ada.ban@operations-hub.test');
    const founder = await prisma.employee.findUniqueOrThrow({
      where: { email: 'ada.ban@operations-hub.test' },
    });
    expect(founder.role).toBe(AccountRole.SUPER_ADMIN);
    const desk = await request(app.getHttpServer()).post('/departments').set(headersA).send({ name: 'IT' });
    expect(desk.status).toBe(201);
    const requestType = await createTestRequestType(app, headersA, desk.body.id);
    const invited = await request(app.getHttpServer()).post('/auth/invitations').set(headersA).send({
      email: 'sam.ban@operations-hub.test',
      name: 'Sam Handler',
      departmentId: desk.body.id,
      role: 'EMPLOYEE',
      canHandle: true,
    });
    expect(invited.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer()).post('/auth/invitations/accept').set('Origin', TEST_ORIGIN).send({
          token: await outboxToken(app, 'sam.ban@operations-hub.test', 'invitation'),
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    const staffHeaders = await loginHeaders(app, 'sam.ban@operations-hub.test');
    const staff = await prisma.employee.findUniqueOrThrow({
      where: { email: 'sam.ban@operations-hub.test' },
    });
    return { headersA, founder, deskId: desk.body.id as number, typeId: requestType.id, staffHeaders, staff };
  }

  it('rejects a Super Admin as owner even when canHandle is true', async () => {
    const { headersA, founder, deskId, typeId, staffHeaders, staff } = await companyWithHandler();
    await prisma.employee.update({ where: { id: founder.id }, data: { canHandle: true } });

    const created = await request(app.getHttpServer()).post('/requests').set(staffHeaders).send({
      submittedBy: staff.id,
      departmentId: deskId,
      requestTypeId: typeId,
      title: 'Staff printer',
    });
    expect(created.status).toBe(201);

    const assign = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(staffHeaders)
      .send({ currentOwnerId: founder.id });
    expect(assign.status).toBe(403);
    expect(assign.body.message).toMatch(/Super Admin cannot own/i);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } })).currentOwnerId).toBeNull();

    const selfAssign = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(headersA)
      .send({ currentOwnerId: founder.id });
    expect(selfAssign.status).toBe(403);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } })).currentOwnerId).toBeNull();
  });

  it('rejects a Super Admin acting as a handler even when canHandle is true', async () => {
    const { headersA, founder, deskId, typeId, staff } = await companyWithHandler();
    await prisma.employee.update({ where: { id: founder.id }, data: { canHandle: true } });

    const created = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founder.id,
      departmentId: deskId,
      requestTypeId: typeId,
      title: 'Ada laptop',
    });
    expect(created.status).toBe(201);

    const assign = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/owner`)
      .set(headersA)
      .send({ currentOwnerId: staff.id });
    expect(assign.status).toBe(403);
    expect(assign.body.message).toMatch(/not allowed to handle/i);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } })).currentOwnerId).toBeNull();

    const transition = await request(app.getHttpServer())
      .patch(`/requests/${created.body.id}/transition`)
      .set(headersA)
      .send({ to: 'IN_PROGRESS', changedBy: founder.id });
    expect(transition.status).toBe(403);
    expect(transition.body.message).toMatch(/not allowed to handle/i);
    const row = await prisma.request.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.status).toBe('SUBMITTED');
    expect(row.currentOwnerId).toBeNull();
  });

  it('lets a Super Admin open own request details and denies colleague and other-company ids', async () => {
    const { headersA, founder, deskId, typeId, staffHeaders, staff } = await companyWithHandler();
    await prisma.employee.update({ where: { id: founder.id }, data: { canHandle: true } });

    const mine = await request(app.getHttpServer()).post('/requests').set(headersA).send({
      submittedBy: founder.id,
      departmentId: deskId,
      requestTypeId: typeId,
      title: 'Ada laptop',
      description: 'Need a laptop',
    });
    const theirs = await request(app.getHttpServer()).post('/requests').set(staffHeaders).send({
      submittedBy: staff.id,
      departmentId: deskId,
      requestTypeId: typeId,
      title: 'Staff printer',
      description: 'COLLEAGUE-SECRET-BODY',
    });
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);

    const openMine = await request(app.getHttpServer()).get(`/requests/${mine.body.id}`).set(headersA);
    expect(openMine.status).toBe(200);
    expect(openMine.body.description).toBe('Need a laptop');
    const mineHistory = await request(app.getHttpServer()).get(`/requests/${mine.body.id}/history`).set(headersA);
    expect(mineHistory.status).toBe(200);
    expect(Array.isArray(mineHistory.body)).toBe(true);

    const openTheirs = await request(app.getHttpServer()).get(`/requests/${theirs.body.id}`).set(headersA);
    expect(openTheirs.status).toBe(403);
    expect(JSON.stringify(openTheirs.body)).not.toContain('COLLEAGUE-SECRET-BODY');
    const theirsHistory = await request(app.getHttpServer()).get(`/requests/${theirs.body.id}/history`).set(headersA);
    expect(theirsHistory.status).toBe(403);
    expect(JSON.stringify(theirsHistory.body)).not.toContain('COLLEAGUE-SECRET-BODY');

    const other = await request(app.getHttpServer()).post('/auth/signup').set('Origin', TEST_ORIGIN).send({
      companyName: 'Other Co',
      name: 'Bea Super',
      email: 'bea.view@operations-hub.test',
      password: PASSWORD,
    });
    expect(other.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer()).post('/auth/verify-email').set('Origin', TEST_ORIGIN).send({
          token: await outboxToken(app, 'bea.view@operations-hub.test', 'email-verification'),
        })
      ).status,
    ).toBe(200);
    const headersB = await loginHeaders(app, 'bea.view@operations-hub.test');
    const founderB = await prisma.employee.findUniqueOrThrow({
      where: { email: 'bea.view@operations-hub.test' },
    });
    const deskB = await request(app.getHttpServer()).post('/departments').set(headersB).send({ name: 'Other' });
    expect(deskB.status).toBe(201);
    const typeB = await createTestRequestType(app, headersB, deskB.body.id);
    const foreign = await request(app.getHttpServer()).post('/requests').set(headersB).send({
      submittedBy: founderB.id,
      departmentId: deskB.body.id,
      requestTypeId: typeB.id,
      title: 'Bea only',
    });
    expect(foreign.status).toBe(201);
    const foreignRead = await request(app.getHttpServer()).get(`/requests/${foreign.body.id}`).set(headersA);
    const foreignHistory = await request(app.getHttpServer())
      .get(`/requests/${foreign.body.id}/history`)
      .set(headersA);
    expect(foreignRead.status).toBe(404);
    expect(foreignHistory.status).toBe(404);
    expect(JSON.stringify(foreignRead.body)).not.toContain('Bea only');
  });
});
