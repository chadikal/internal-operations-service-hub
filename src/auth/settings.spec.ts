import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSender } from './email-sender';
import { LoginRateLimiter } from './login-rate-limit';
import {
  closeTestApp,
  createTestApp,
  removeNonDevelopmentCompanies,
  sessionCookieFrom,
  TEST_ORIGIN,
} from '../requests/test-helpers';

jest.setTimeout(60_000);

const PASSWORD = 'settings-password-not-for-production';
const NEXT_PASSWORD = 'settings-password-changed-ok-12';

function signup(
  app: INestApplication,
  body: { companyName: string; name: string; email: string; password: string },
) {
  return request(app.getHttpServer()).post('/auth/signup').set('Origin', TEST_ORIGIN).send(body);
}

async function outboxToken(app: INestApplication, email: string, purpose: string): Promise<string> {
  const message = [...app.get(EmailSender).list()]
    .reverse()
    .find((item) => item.to === email && item.purpose === purpose);
  if (!message) throw new Error(`No ${purpose} message for ${email}`);
  return message.token;
}

async function verify(app: INestApplication, email: string) {
  const token = await outboxToken(app, email, 'email-verification');
  const response = await request(app.getHttpServer())
    .post('/auth/verify-email')
    .set('Origin', TEST_ORIGIN)
    .send({ token });
  expect(response.status).toBe(200);
}

async function loginHeaders(app: INestApplication, email: string, password: string) {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password });
  expect(response.status).toBe(200);
  return {
    Cookie: sessionCookieFrom(response),
    'X-CSRF-Token': response.body.csrfToken as string,
  };
}

async function acceptInvite(app: INestApplication, email: string, password: string) {
  const token = await outboxToken(app, email, 'invitation');
  const accepted = await request(app.getHttpServer())
    .post('/auth/invitations/accept')
    .set('Origin', TEST_ORIGIN)
    .send({ token, password });
  expect(accepted.status).toBe(200);
}

describe('account settings', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const founderEmail = `settings.founder.${stamp}@operations-hub.test`;
  const otherFounderEmail = `settings.other.${stamp}@operations-hub.test`;
  const employeeEmail = `settings.employee.${stamp}@operations-hub.test`;
  const handlerEmail = `settings.handler.${stamp}@operations-hub.test`;
  const adminEmail = `settings.admin.${stamp}@operations-hub.test`;
  const passwordEmail = `settings.password.${stamp}@operations-hub.test`;
  let founder: { Cookie: string; 'X-CSRF-Token': string };
  let employee: { Cookie: string; 'X-CSRF-Token': string };
  let departmentAdmin: { Cookie: string; 'X-CSRF-Token': string };
  let itId: number;
  let hrId: number;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await removeNonDevelopmentCompanies(prisma);
    app.get(LoginRateLimiter).reset();

    expect(
      (
        await signup(app, {
          companyName: `Settings Co ${stamp}`,
          name: 'Settings Founder',
          email: founderEmail,
          password: PASSWORD,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await signup(app, {
          companyName: `Other Co ${stamp}`,
          name: 'Other Founder',
          email: otherFounderEmail,
          password: PASSWORD,
        })
      ).status,
    ).toBe(201);
    await verify(app, founderEmail);
    await verify(app, otherFounderEmail);
    founder = await loginHeaders(app, founderEmail, PASSWORD);
    const departments = await request(app.getHttpServer()).get('/departments').set(founder);
    expect(departments.status).toBe(200);
    itId = departments.body.find((item: { name: string }) => item.name === 'IT').id;
    hrId = departments.body.find((item: { name: string }) => item.name === 'HR').id;

    const created = await request(app.getHttpServer())
      .post(`/departments/${itId}/request-types`)
      .set(founder)
      .send({ name: 'Hardware', approvalPolicy: 'NONE' });
    expect(created.status).toBe(201);

    for (const invite of [
      { email: employeeEmail, name: 'Settings Employee', role: 'EMPLOYEE', canHandle: false },
      { email: handlerEmail, name: 'Settings Handler', role: 'EMPLOYEE', canHandle: true },
      { email: adminEmail, name: 'Settings Admin', role: 'DEPARTMENT_ADMIN', canHandle: false },
      { email: passwordEmail, name: 'Settings Password', role: 'EMPLOYEE', canHandle: false },
    ]) {
      const invited = await request(app.getHttpServer()).post('/auth/invitations').set(founder).send({
        ...invite,
        departmentId: itId,
      });
      expect(invited.status).toBe(201);
      await acceptInvite(app, invite.email, PASSWORD);
    }
    employee = await loginHeaders(app, employeeEmail, PASSWORD);
    departmentAdmin = await loginHeaders(app, adminEmail, PASSWORD);
  });

  afterAll(async () => {
    await removeNonDevelopmentCompanies(prisma);
    await closeTestApp(app);
  });

  it('lets a user rename only their own profile', async () => {
    const founderBefore = await prisma.employee.findUniqueOrThrow({ where: { email: founderEmail } });
    const renamed = await request(app.getHttpServer()).patch('/auth/me').set(employee).send({ name: 'Renamed Employee' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed Employee');
    expect(renamed.body.email).toBe(employeeEmail);
    expect(renamed.body.role).toBe('EMPLOYEE');
    expect(renamed.body.departmentId).toBe(itId);
    expect(renamed.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(renamed.body)).not.toContain('passwordHash');

    const me = await request(app.getHttpServer()).get('/auth/me').set(employee);
    expect(me.status).toBe(200);
    expect(me.body.name).toBe('Renamed Employee');

    const founderAfter = await prisma.employee.findUniqueOrThrow({ where: { email: founderEmail } });
    expect(founderAfter.name).toBe(founderBefore.name);

    const rejected = await request(app.getHttpServer()).patch('/auth/me').set(employee).send({
      name: 'Should Not Apply',
      email: 'taken@operations-hub.test',
      role: 'SUPER_ADMIN',
      departmentId: hrId,
      canHandle: true,
      active: false,
      id: founderBefore.id,
    });
    expect(rejected.status).toBe(400);
    const unchanged = await prisma.employee.findUniqueOrThrow({ where: { email: employeeEmail } });
    expect(unchanged.name).toBe('Renamed Employee');
    expect(unchanged.email).toBe(employeeEmail);
    expect(unchanged.role).toBe('EMPLOYEE');
    expect(unchanged.departmentId).toBe(itId);
    expect(unchanged.canHandle).toBe(false);
    expect(unchanged.active).toBe(true);
  });

  it('changes a password only when the current password is right and the new one matches the rules', async () => {
    const first = await loginHeaders(app, passwordEmail, PASSWORD);
    const second = await loginHeaders(app, passwordEmail, PASSWORD);

    const wrong = await request(app.getHttpServer()).post('/auth/change-password').set(first).send({
      currentPassword: 'not-the-current-password',
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe('Current password is incorrect');
    expect(JSON.stringify(wrong.body)).not.toContain('passwordHash');
    expect(JSON.stringify(wrong.body)).not.toContain(PASSWORD);

    const mismatch = await request(app.getHttpServer()).post('/auth/change-password').set(first).send({
      currentPassword: PASSWORD,
      newPassword: NEXT_PASSWORD,
      confirmPassword: 'settings-password-other-ok-12',
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toBe('Passwords do not match');

    const short = await request(app.getHttpServer()).post('/auth/change-password').set(first).send({
      currentPassword: PASSWORD,
      newPassword: 'short-pass',
      confirmPassword: 'short-pass',
    });
    expect(short.status).toBe(400);

    const changed = await request(app.getHttpServer()).post('/auth/change-password').set(first).send({
      currentPassword: PASSWORD,
      newPassword: NEXT_PASSWORD,
      confirmPassword: NEXT_PASSWORD,
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ changed: true });
    const serialized = JSON.stringify(changed.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(NEXT_PASSWORD);
    expect(serialized).not.toContain('argon2');

    expect((await request(app.getHttpServer()).get('/auth/me').set(first)).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/auth/me').set(second)).status).toBe(401);

    const oldLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: passwordEmail, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    expect(JSON.stringify(oldLogin.body)).not.toContain('passwordHash');

    const newLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: passwordEmail, password: NEXT_PASSWORD });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(newLogin.body)).not.toContain(NEXT_PASSWORD);
  });

  it('lets a Super Admin rename only their own company', async () => {
    const otherBefore = await prisma.company.findFirstOrThrow({ where: { name: `Other Co ${stamp}` } });
    const renamed = await request(app.getHttpServer())
      .patch('/auth/company')
      .set(founder)
      .send({ name: `Settings Co Renamed ${stamp}` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.companyName).toBe(`Settings Co Renamed ${stamp}`);
    expect(renamed.body.companyId).not.toBe(otherBefore.id);

    const me = await request(app.getHttpServer()).get('/auth/me').set(founder);
    expect(me.body.companyName).toBe(`Settings Co Renamed ${stamp}`);

    const otherAfter = await prisma.company.findUniqueOrThrow({ where: { id: otherBefore.id } });
    expect(otherAfter.name).toBe(`Other Co ${stamp}`);

    const withForeignId = await request(app.getHttpServer())
      .patch('/auth/company')
      .set(founder)
      .send({ name: 'Should Not Apply', companyId: otherBefore.id });
    expect(withForeignId.status).toBe(400);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: otherBefore.id } })).name).toBe(
      `Other Co ${stamp}`,
    );

    expect((await request(app.getHttpServer()).patch('/auth/company').set(departmentAdmin).send({ name: 'Nope' })).status).toBe(
      403,
    );
    expect((await request(app.getHttpServer()).patch('/auth/company').set(employee).send({ name: 'Nope' })).status).toBe(
      403,
    );
    expect((await prisma.company.findUniqueOrThrow({ where: { id: otherBefore.id } })).name).toBe(`Other Co ${stamp}`);
  });

  it('lets a Department Admin rename only their own department and keeps request types read-only', async () => {
    const renamed = await request(app.getHttpServer())
      .patch(`/departments/${itId}`)
      .set(departmentAdmin)
      .send({ name: `IT Desk ${stamp}` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe(`IT Desk ${stamp}`);

    const other = await request(app.getHttpServer())
      .patch(`/departments/${hrId}`)
      .set(departmentAdmin)
      .send({ name: 'People' });
    expect(other.status).toBe(403);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: hrId } })).name).toBe('HR');

    const otherCompany = await prisma.company.findFirstOrThrow({ where: { name: `Other Co ${stamp}` } });
    const foreign = await prisma.department.findFirstOrThrow({
      where: { companyId: otherCompany.id, name: 'Finance' },
    });
    const leaked = await request(app.getHttpServer())
      .patch(`/departments/${foreign.id}`)
      .set(departmentAdmin)
      .send({ name: 'Taken' });
    expect(leaked.status).toBe(404);
    expect(leaked.body.message).toBe(`Department ${foreign.id} was not found`);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: foreign.id } })).name).toBe('Finance');

    const type = await prisma.requestType.findFirstOrThrow({
      where: { departmentId: itId, name: 'Hardware' },
    });
    expect(
      (
        await request(app.getHttpServer())
          .patch(`/request-types/${type.id}`)
          .set(departmentAdmin)
          .send({ name: 'Changed', approvalPolicy: 'SUPER_ADMIN' })
      ).status,
    ).toBe(403);
    expect((await request(app.getHttpServer()).delete(`/request-types/${type.id}`).set(departmentAdmin)).status).toBe(
      403,
    );
    const listed = await request(app.getHttpServer()).get('/request-types').set(departmentAdmin);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: type.id, name: 'Hardware', approvalPolicy: 'NONE' }),
      ]),
    );

    await request(app.getHttpServer()).patch(`/departments/${itId}`).set(founder).send({ name: 'IT' });
  });
});
