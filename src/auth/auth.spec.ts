import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import jwt = require('jsonwebtoken');
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { createFirstSuperAdmin } from './create-first-super-admin';
import { assertDevelopmentCredentialTarget, assertTestDatabase } from './database-target';
import { planDevCredentialUpdate } from './dev-credentials';
import { LoginDto, InviteStaffDto } from './dto/auth.dto';
import { assertJwtSecret } from './jwt-secret';
import { LoginRateLimiter } from './login-rate-limit';
import { hashPassword } from './password';
import { signSessionToken, readSessionToken } from './session-token';

jest.setTimeout(30_000);
import {
  authHeaders,
  CHADI,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  developmentCompanyId,
  ensureTestCredentials,
  removeNonDevelopmentCompanies,
  IT,
  IT_TYPE,
  JOHN,
  JOHN_EMAIL,
  sessionCookieFrom,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../requests/test-helpers';

const ADMIN_EMAIL = 'first-admin@operations-hub.test';
const ADMIN_PASSWORD = 'admin-password-not-for-production-12';

function login(app: INestApplication, email: string, password: string, origin?: string) {
  const call = request(app.getHttpServer()).post('/auth/login');
  if (origin !== undefined) {
    call.set('Origin', origin);
  }
  return call.send({ email, password });
}

function sessionIdFrom(cookie: string): string {
  const token = cookie.slice('hub_session='.length);
  return readSessionToken(token, assertJwtSecret(process.env.JWT_SECRET)).jti;
}

function assertNoCredentialFields(body: unknown, secrets: string[]) {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('passwordHash');
  expect(serialized).not.toMatch(/"password"/);
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

describe('authentication', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: number;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await ensureTestCredentials(prisma);
    companyId = await developmentCompanyId(prisma);
  });

  beforeEach(async () => {
    await cleanRequestData(prisma);
    app.get(LoginRateLimiter).reset();
    delete process.env.LOGIN_MAX_FAILURES_PER_EMAIL;
    delete process.env.LOGIN_MAX_FAILURES_PER_IP;
    await prisma.employee.update({
      where: { id: JOHN },
      data: { active: true, role: AccountRole.EMPLOYEE, canHandle: false, email: JOHN_EMAIL },
    });
    await prisma.employee.update({
      where: { id: CHADI },
      data: {
        active: true,
        role: AccountRole.EMPLOYEE,
        canHandle: true,
        email: 'chadi@operations-hub.test',
      },
    });
    await removeExtraAccounts(prisma);
  });

  afterAll(async () => {
    await removeExtraAccounts(prisma);
    await closeTestApp(app);
  });

  it('logs in with a revocable cookie and keeps every failure response identical', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    try {
      const success = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
      expect(success.status).toBe(200);
    expect(success.headers['cache-control']).toBe('private, no-store');
    const setCookie = Array.isArray(success.headers['set-cookie'])
      ? success.headers['set-cookie'].join('; ')
      : String(success.headers['set-cookie'] ?? '');
    expect(setCookie).toMatch(/hub_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
      expect(success.body.email).toBe(JOHN_EMAIL);
      expect(success.body.csrfToken).toEqual(expect.any(String));
      assertNoCredentialFields(success.body, [TEST_PASSWORD]);

      const unknown = await login(app, 'missing-person@operations-hub.test', 'wrong-password-value', TEST_ORIGIN);
      const invalid = await login(app, JOHN_EMAIL, 'wrong-password-value', TEST_ORIGIN);
      const missing = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', TEST_ORIGIN)
        .send({});
      await prisma.employee.update({ where: { id: JOHN }, data: { active: false } });
      const inactive = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);

      for (const response of [unknown, invalid, missing, inactive]) {
        expect(response.status).toBe(401);
        expect(response.body.message).toBe('Invalid email or password');
      }
      expect(logs.join('\n')).not.toContain(TEST_PASSWORD);
      expect(logs.join('\n')).not.toContain('passwordHash');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a missing origin, an untrusted origin, a tampered token, alg none, and an account mismatch', async () => {
    const before = await prisma.session.count();
    const missingOrigin = await login(app, JOHN_EMAIL, TEST_PASSWORD);
    const untrusted = await login(app, JOHN_EMAIL, TEST_PASSWORD, 'https://evil.example');
    expect(missingOrigin.status).toBe(403);
    expect(untrusted.status).toBe(403);
    expect(await prisma.session.count()).toBe(before);

    const success = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const cookie = sessionCookieFrom(success);
    const tampered = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${cookie.slice(0, -1)}x`);
    expect(tampered.status).toBe(401);

    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const nonePayload = Buffer.from(
      JSON.stringify({
        sub: String(JOHN),
        jti: 'a'.repeat(32),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const none = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `hub_session=${noneHeader}.${nonePayload}.`);
    expect(none.status).toBe(401);
    expect(none.headers['cache-control']).toBe('private, no-store');

    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionIdFrom(cookie) } });
    const mismatched = signSessionToken(
      CHADI,
      session.id,
      session.absoluteExpiresAt,
      assertJwtSecret(process.env.JWT_SECRET),
    );
    const mismatch = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `hub_session=${mismatched}`);
    expect(mismatch.status).toBe(401);
  });

  it('expires idle and absolute sessions without letting /auth/me refresh activity', async () => {
    const success = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const cookie = sessionCookieFrom(success);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionIdFrom(cookie) } });
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.session.update({ where: { id: session.id }, data: { lastActivityAt: stale } });

    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.headers['cache-control']).toBe('private, no-store');
    const afterMe = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(Math.abs(afterMe.lastActivityAt.getTime() - stale.getTime())).toBeLessThan(1000);
    expect(afterMe.absoluteExpiresAt.getTime()).toBe(session.absoluteExpiresAt.getTime());

    const headers = { Cookie: cookie, 'X-CSRF-Token': success.body.csrfToken as string };
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set(headers)
      .send({ submittedBy: JOHN, departmentId: IT, requestTypeId: IT_TYPE });
    expect(created.status).toBe(201);
    const afterWrite = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(afterWrite.lastActivityAt.getTime()).toBeGreaterThan(stale.getTime() + 60_000);
    expect(afterWrite.absoluteExpiresAt.getTime()).toBe(session.absoluteExpiresAt.getTime());
    assertNoCredentialFields(created.body, []);

    await prisma.session.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const idle = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie);
    expect(idle.status).toBe(401);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();

    const fresh = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const freshCookie = sessionCookieFrom(fresh);
    const freshSession = await prisma.session.findUniqueOrThrow({ where: { id: sessionIdFrom(freshCookie) } });
    await prisma.session.update({
      where: { id: freshSession.id },
      data: { absoluteExpiresAt: new Date(Date.now() - 1000), lastActivityAt: new Date() },
    });
    const absolute = await request(app.getHttpServer()).get('/auth/me').set('Cookie', freshCookie);
    expect(absolute.status).toBe(401);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: freshSession.id } })).revokedAt).not.toBeNull();
  });

  it('requires the current CSRF token and revokes the session on logout', async () => {
    const success = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const cookie = sessionCookieFrom(success);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionIdFrom(cookie) } });

    const missing = await request(app.getHttpServer())
      .post('/requests')
      .set('Cookie', cookie)
      .send({ submittedBy: JOHN, departmentId: IT, requestTypeId: IT_TYPE });
    expect(missing.status).toBe(403);
    expect(await prisma.request.count()).toBe(0);

    const wrong = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'not-the-token')
      .send({});
    expect(wrong.status).toBe(403);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();

    const loggedOut = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', success.body.csrfToken as string)
      .send({});
    expect(loggedOut.status).toBe(200);
    const reused = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie);
    expect(reused.status).toBe(401);
  });

  it('applies the same email limit to unknown addresses and ignores forwarded IPs unless trusted', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(
        app,
        attempt % 2 === 0 ? 'Unknown-User@operations-hub.test' : 'unknown-user@operations-hub.test',
        'wrong-password-value',
        TEST_ORIGIN,
      );
      expect(response.status).toBe(401);
    }
    const blocked = await login(app, 'unknown-user@operations-hub.test', 'wrong-password-value', TEST_ORIGIN);
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe('Too many login attempts. Try again later.');

    const otherAccount = await login(app, 'other-unknown@operations-hub.test', 'wrong-password-value', TEST_ORIGIN);
    expect(otherAccount.status).toBe(401);

    app.get(LoginRateLimiter).reset();
    process.env.LOGIN_MAX_FAILURES_PER_IP = '3';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', TEST_ORIGIN)
        .set('X-Forwarded-For', `203.0.113.${attempt}`)
        .send({ email: `ip-limit-${attempt}@operations-hub.test`, password: 'wrong-password-value' });
      expect(response.status).toBe(401);
    }
    const ipBlocked = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ email: 'ip-limit-fresh@operations-hub.test', password: 'wrong-password-value' });
    expect(ipBlocked.status).toBe(429);
  });

  it('enforces the current database role and hides credential fields', async () => {
    const admin = await prisma.employee.create({
      data: {
        name: 'Ada Admin',
        email: ADMIN_EMAIL,
        companyId,
        departmentId: IT,
        passwordHash: await hashPassword(ADMIN_PASSWORD),
        role: AccountRole.SUPER_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    const departmentAdmin = await prisma.employee.create({
      data: {
        name: 'Dana Dept',
        email: 'dept-admin@operations-hub.test',
        companyId,
        departmentId: IT,
        passwordHash: await hashPassword(ADMIN_PASSWORD),
        role: AccountRole.DEPARTMENT_ADMIN,
        canHandle: false,
        active: true,
      },
    });
    const adminLogin = await login(app, ADMIN_EMAIL, ADMIN_PASSWORD, TEST_ORIGIN);
    expect(adminLogin.status).toBe(200);
    const adminCookie = sessionCookieFrom(adminLogin);
    const adminHeaders = {
      Cookie: adminCookie,
      'X-CSRF-Token': adminLogin.body.csrfToken as string,
    };
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionIdFrom(adminCookie) } });
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.session.update({ where: { id: session.id }, data: { lastActivityAt: stale } });

    const created = await request(app.getHttpServer()).post('/auth/invitations').set(adminHeaders).send({
      email: 'New.Person@operations-hub.test',
      name: 'New Person',
      departmentId: IT,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('new.person@operations-hub.test');
    expect(created.body.active).toBe(false);
    assertNoCredentialFields(created.body, []);
    expect(created.body).not.toHaveProperty('csrfToken');
    const afterProvision = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(afterProvision.lastActivityAt.getTime()).toBeGreaterThan(stale.getTime() + 60_000);
    const invited = await prisma.employee.findUniqueOrThrow({
      where: { email: 'new.person@operations-hub.test' },
    });
    expect(invited.passwordHash).toBeNull();
    expect(invited.companyId).toBe(companyId);

    const duplicate = await request(app.getHttpServer()).post('/auth/invitations').set(adminHeaders).send({
      email: 'new.person@operations-hub.test',
      name: 'Changed Name',
      departmentId: IT,
      role: 'SUPER_ADMIN',
      canHandle: true,
    });
    expect(duplicate.status).toBe(409);
    const unchanged = await prisma.employee.findUniqueOrThrow({
      where: { email: 'new.person@operations-hub.test' },
    });
    expect(unchanged.name).toBe('New Person');
    expect(unchanged.role).toBe(AccountRole.EMPLOYEE);
    expect(unchanged.canHandle).toBe(false);

    const johnLogin = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const johnHeaders = {
      Cookie: sessionCookieFrom(johnLogin),
      'X-CSRF-Token': johnLogin.body.csrfToken as string,
    };
    const employeeDenied = await request(app.getHttpServer()).post('/auth/invitations').set(johnHeaders).send({
      email: 'employee-made@operations-hub.test',
      name: 'Should Not Exist',
      departmentId: IT,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(employeeDenied.status).toBe(403);

    const deptLogin = await login(app, 'dept-admin@operations-hub.test', ADMIN_PASSWORD, TEST_ORIGIN);
    const deptDenied = await request(app.getHttpServer())
      .post('/auth/invitations')
      .set({
        Cookie: sessionCookieFrom(deptLogin),
        'X-CSRF-Token': deptLogin.body.csrfToken as string,
      })
      .send({
        email: 'dept-made@operations-hub.test',
        name: 'Should Not Exist',
        departmentId: IT,
        role: 'EMPLOYEE',
        canHandle: false,
      });
    expect(deptDenied.status).toBe(403);

    await prisma.employee.update({ where: { id: admin.id }, data: { role: AccountRole.EMPLOYEE } });
    const demoted = await request(app.getHttpServer()).post('/auth/invitations').set(adminHeaders).send({
      email: 'after-demotion@operations-hub.test',
      name: 'After Demotion',
      departmentId: IT,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(demoted.status).toBe(403);

    await prisma.employee.update({
      where: { id: departmentAdmin.id },
      data: { role: AccountRole.SUPER_ADMIN },
    });
    const promoted = await request(app.getHttpServer())
      .post('/auth/invitations')
      .set({
        Cookie: sessionCookieFrom(deptLogin),
        'X-CSRF-Token': deptLogin.body.csrfToken as string,
      })
      .send({
        email: 'promoted-create@operations-hub.test',
        name: 'Promoted Create',
        departmentId: IT,
        role: 'EMPLOYEE',
        canHandle: true,
      });
    expect(promoted.status).toBe(201);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', sessionCookieFrom(deptLogin));
    expect(me.body.role).toBe('SUPER_ADMIN');
    expect(me.body.canHandle).toBe(false);

    const promotedHeaders = {
      Cookie: sessionCookieFrom(deptLogin),
      'X-CSRF-Token': deptLogin.body.csrfToken as string,
    };
    const invalidEmail = await request(app.getHttpServer()).post('/auth/invitations').set(promotedHeaders).send({
      email: 'not-an-email',
      name: 'Bad Email',
      departmentId: IT,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    expect(invalidEmail.status).toBe(400);

    const shortPassword = await request(app.getHttpServer())
      .post('/auth/invitations')
      .set({
        Cookie: sessionCookieFrom(deptLogin),
        'X-CSRF-Token': deptLogin.body.csrfToken as string,
      })
      .send({
        email: 'short-password@operations-hub.test',
        password: 'short-pass',
        name: 'Short Password',
        departmentId: IT,
        role: 'EMPLOYEE',
        canHandle: false,
      });
    expect(shortPassword.status).toBe(400);

    const unknownDepartment = await request(app.getHttpServer())
      .post('/auth/invitations')
      .set({
        Cookie: sessionCookieFrom(deptLogin),
        'X-CSRF-Token': deptLogin.body.csrfToken as string,
      })
      .send({
        email: 'unknown-dept@operations-hub.test',
        name: 'Unknown Department',
        departmentId: 999999,
        role: 'EMPLOYEE',
        canHandle: false,
      });
    expect(unknownDepartment.status).toBe(400);

    const requestRow = await request(app.getHttpServer())
      .post('/requests')
      .set(johnHeaders)
      .set('X-Actor-Id', String(CHADI))
      .send({ submittedBy: JOHN, departmentId: IT, requestTypeId: IT_TYPE });
    expect(requestRow.status).toBe(201);
    expect(requestRow.body.submittedBy).toBe(JOHN);
    assertNoCredentialFields(requestRow.body, []);

    const assignDenied = await request(app.getHttpServer())
      .patch(`/requests/${requestRow.body.id}/owner`)
      .set({
        Cookie: sessionCookieFrom(deptLogin),
        'X-CSRF-Token': deptLogin.body.csrfToken as string,
      })
      .send({ currentOwnerId: CHADI });
    expect(assignDenied.status).toBe(403);

    const employees = await request(app.getHttpServer()).get('/employees').set('Cookie', sessionCookieFrom(johnLogin));
    assertNoCredentialFields(employees.body, []);
    const history = await request(app.getHttpServer())
      .get(`/requests/${requestRow.body.id}/history`)
      .set('Cookie', sessionCookieFrom(johnLogin));
    assertNoCredentialFields(history.body, []);
  });

  it('rejects the existing cookie after the account is deactivated', async () => {
    const success = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const cookie = sessionCookieFrom(success);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionIdFrom(cookie) } });
    await prisma.employee.update({ where: { id: JOHN }, data: { active: false } });

    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(401);
    expect(me.body.message).toBe('Authentication is required');
    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).toBeNull();
    expect(after.accountId).toBe(JOHN);
  });

  it('rejects an expired JWT while the session row is still inside both limits', async () => {
    const success = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const cookie = sessionCookieFrom(success);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionIdFrom(cookie) } });
    expect(session.absoluteExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session.revokedAt).toBeNull();

    const expired = jwt.sign(
      { sub: String(JOHN), exp: Math.floor(Date.now() / 1000) - 30 },
      assertJwtSecret(process.env.JWT_SECRET),
      { algorithm: 'HS256', jwtid: session.id },
    );
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', `hub_session=${expired}`);
    expect(me.status).toBe(401);

    const after = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).toBeNull();
    expect(after.absoluteExpiresAt.getTime()).toBe(session.absoluteExpiresAt.getTime());
    expect(after.lastActivityAt.getTime()).toBe(session.lastActivityAt.getTime());
  });

  it('keeps a successful create when recording activity fails', async () => {
    const success = await login(app, JOHN_EMAIL, TEST_PASSWORD, TEST_ORIGIN);
    const headers = {
      Cookie: sessionCookieFrom(success),
      'X-CSRF-Token': success.body.csrfToken as string,
    };
    const auth = app.get(AuthService);
    const activity = jest.spyOn(auth, 'touchActivity').mockRejectedValueOnce(new Error('activity write failed'));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const created = await request(app.getHttpServer())
        .post('/requests')
        .set(headers)
        .send({ submittedBy: JOHN, departmentId: IT, requestTypeId: IT_TYPE, title: 'Saved despite activity failure' });
      expect(created.status).toBe(201);
      expect(created.body.title).toBe('Saved despite activity failure');
      expect(logged).toHaveBeenCalledWith('Session activity was not recorded.');
      const row = await prisma.request.findUniqueOrThrow({ where: { id: created.body.id as number } });
      expect(row.submittedBy).toBe(JOHN);
    } finally {
      activity.mockRestore();
      logged.mockRestore();
    }

    await prisma.session.update({
      where: { id: sessionIdFrom(headers.Cookie) },
      data: { revokedAt: new Date() },
    });
    const reused = await request(app.getHttpServer()).get('/auth/me').set('Cookie', headers.Cookie);
    expect(reused.status).toBe(401);
  });

  it('keeps existing employee ids and blocks login without credentials', async () => {
    const john = await prisma.employee.findUniqueOrThrow({ where: { id: JOHN } });
    const chadi = await prisma.employee.findUniqueOrThrow({ where: { id: CHADI } });
    expect(john.name).toBe('John');
    expect(chadi.name).toBe('Chadi');
    expect(chadi.canHandle).toBe(true);

    const noLogin = await prisma.employee.create({
      data: { name: 'No Credentials', companyId, departmentId: IT, canHandle: false },
    });
    const denied = await login(app, 'no-credentials@operations-hub.test', TEST_PASSWORD, TEST_ORIGIN);
    expect(denied.status).toBe(401);
    const still = await prisma.employee.findUniqueOrThrow({ where: { id: noLogin.id } });
    expect(still.email).toBeNull();
    expect(still.passwordHash).toBeNull();
    expect(still.id).toBe(noLogin.id);

    const headers = await authHeaders(app, prisma, JOHN);
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set(headers)
      .send({ submittedBy: JOHN, departmentId: IT, requestTypeId: IT_TYPE });
    expect(created.body.submittedBy).toBe(JOHN);
    expect(created.body.submitter).toEqual({ id: JOHN, name: 'John' });
  });

  it('does not create a Super Admin from the retired setup command', async () => {
    const before = await prisma.employee.count({ where: { role: AccountRole.SUPER_ADMIN } });
    await expect(createFirstSuperAdmin(prisma, {
      email: 'missing-dept@operations-hub.test',
      password: ADMIN_PASSWORD,
      name: 'Missing Department',
      departmentId: 999999,
    })).rejects.toThrow(/company signup/i);
    const raced = await Promise.allSettled([
      createFirstSuperAdmin(prisma, {
        email: 'lock-one@operations-hub.test',
        password: ADMIN_PASSWORD,
        name: 'Lock One',
        departmentId: IT,
      }),
      createFirstSuperAdmin(prisma, {
        email: 'lock-two@operations-hub.test',
        password: ADMIN_PASSWORD,
        name: 'Lock Two',
        departmentId: IT,
      }),
    ]);
    expect(raced.every((result) => result.status === 'rejected')).toBe(true);
    expect(await prisma.employee.count({ where: { role: AccountRole.SUPER_ADMIN } })).toBe(before);
  });
});

describe('authentication guards', () => {
  it('rejects a missing or short JWT secret and non-development credential targets', () => {
    expect(() => assertJwtSecret(undefined)).toThrow(/32/);
    expect(() => assertJwtSecret('too-short')).toThrow(/32/);
    expect(assertJwtSecret('x'.repeat(32)).length).toBeGreaterThanOrEqual(32);

    expect(() =>
      assertDevelopmentCredentialTarget(
        'test',
        'postgresql://postgres:secret@localhost:5432/operations_hub',
      ),
    ).toThrow(/development/);
    expect(() => assertDevelopmentCredentialTarget('development', process.env.DATABASE_URL)).toThrow(
      /operations_hub_test/,
    );
    expect(() =>
      assertDevelopmentCredentialTarget(
        'development',
        'postgresql://postgres:secret@localhost:5432/operations_hub',
      ),
    ).not.toThrow();
    expect(() =>
      assertTestDatabase('postgresql://postgres:secret@localhost:5432/operations_hub'),
    ).toThrow(/operations_hub_test/);

    expect(() =>
      planDevCredentialUpdate({ id: 2, email: null, passwordHash: 'already-set' }, 'john@example.com'),
    ).toThrow(/does not overwrite/);
    expect(
      planDevCredentialUpdate({ id: 2, email: null, passwordHash: null }, ' John@Example.com '),
    ).toEqual({ email: 'john@example.com' });
    expect(planDevCredentialUpdate({ id: 2, email: 'john@example.com', passwordHash: null }, undefined)).toEqual(
      {},
    );
  });

  it('resets a rate-limit window 15 minutes after the first failure', () => {
    const limiter = new LoginRateLimiter();
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    const email = 'person@operations-hub.test';
    const ip = '127.0.0.1';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.admit(email, ip, start);
      limiter.settleFailure(email, ip, start);
    }
    expect(() => limiter.admit(email, ip, start + 1000)).toThrow(/Too many login attempts/);
    expect(() => limiter.admit(email, ip, start + 15 * 60 * 1000)).not.toThrow();
  });

  it('counts in-flight attempts toward the limit and drops expired buckets', () => {
    const previousEmail = process.env.LOGIN_MAX_FAILURES_PER_EMAIL;
    const previousIp = process.env.LOGIN_MAX_FAILURES_PER_IP;
    process.env.LOGIN_MAX_FAILURES_PER_EMAIL = '3';
    process.env.LOGIN_MAX_FAILURES_PER_IP = '2';
    try {
      const limiter = new LoginRateLimiter();
      const now = 5_000_000;
      const ip = '203.0.113.5';
      limiter.admit('a@example.com', ip, now);
      limiter.admit('b@example.com', ip, now);
      expect(() => limiter.admit('c@example.com', ip, now)).toThrow(/Too many login attempts/);
      limiter.settleSuccess('a@example.com', ip, now);
      limiter.admit('a@example.com', ip, now);
      limiter.settleFailure('a@example.com', ip, now);
      limiter.settleFailure('b@example.com', ip, now);
      expect(() => limiter.admit('a@example.com', ip, now)).toThrow(/Too many login attempts/);

      const bounded = new LoginRateLimiter(2);
      const start = 8_000_000;
      bounded.admit('old@example.com', '192.0.2.1', start);
      bounded.settleFailure('old@example.com', '192.0.2.1', start);
      bounded.admit('kept@example.com', '192.0.2.2', start);
      bounded.settleFailure('kept@example.com', '192.0.2.2', start);
      expect(() => bounded.admit('extra@example.com', '192.0.2.3', start)).toThrow(/Too many login attempts/);
      bounded.admit('kept@example.com', '192.0.2.2', start + 15 * 60 * 1000);
      expect(bounded.snapshot()).toEqual({
        emails: ['kept@example.com'],
        ips: ['192.0.2.2'],
      });
    } finally {
      if (previousEmail === undefined) {
        delete process.env.LOGIN_MAX_FAILURES_PER_EMAIL;
      } else {
        process.env.LOGIN_MAX_FAILURES_PER_EMAIL = previousEmail;
      }
      if (previousIp === undefined) {
        delete process.env.LOGIN_MAX_FAILURES_PER_IP;
      } else {
        process.env.LOGIN_MAX_FAILURES_PER_IP = previousIp;
      }
    }
  });

  it('rejects non-string login credentials and lets omitted credentials through', async () => {
    const pipe = applicationValidationPipe();
    const missing = await pipe.transform({}, { type: 'body', metatype: LoginDto });
    expect(missing.email).toBeUndefined();
    expect(missing.password).toBeUndefined();

    const emailOnly = await pipe.transform(
      { email: 'Person@Example.com' },
      { type: 'body', metatype: LoginDto },
    );
    expect(emailOnly.email).toBe('Person@Example.com');
    expect(emailOnly.password).toBeUndefined();

    const valid = await pipe.transform(
      { email: 'Person@Example.com', password: 'secret' },
      { type: 'body', metatype: LoginDto },
    );
    expect(valid).toMatchObject({ email: 'Person@Example.com', password: 'secret' });

    const supplied = [1, true, { nested: true }, ['person@example.com'], null];
    for (const value of supplied) {
      await expect(
        pipe.transform({ email: value, password: 'secret' }, { type: 'body', metatype: LoginDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        pipe.transform({ email: 'person@example.com', password: value }, { type: 'body', metatype: LoginDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    try {
      await pipe.transform({ email: 12, password: 'secret' }, { type: 'body', metatype: LoginDto });
      throw new Error('numeric email should have been rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('keeps false canHandle false and rejects a string boolean', async () => {
    const pipe = applicationValidationPipe();
    const valid = await pipe.transform(
      {
        email: 'Person@Example.com',
        name: '  Pat  ',
        departmentId: '1',
        role: 'EMPLOYEE',
        canHandle: false,
      },
      { type: 'body', metatype: InviteStaffDto },
    );
    expect(valid).toMatchObject({
      email: 'person@example.com',
      name: 'Pat',
      departmentId: 1,
      role: 'EMPLOYEE',
      canHandle: false,
    });
    await expect(
      pipe.transform(
        {
          email: 'person@example.com',
          name: 'Pat',
          departmentId: 1,
          role: 'EMPLOYEE',
          canHandle: 'false',
        },
        { type: 'body', metatype: InviteStaffDto },
      ),
    ).rejects.toBeTruthy();
  });

  it('fails application startup when JWT_SECRET is missing', async () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = ' ';
    try {
      await expect(createTestApp()).rejects.toThrow(/32/);
    } finally {
      process.env.JWT_SECRET = previous;
    }
  });
});

function applicationValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}

async function removeExtraAccounts(prisma: PrismaService) {
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
    await prisma.requestStatusHistory.deleteMany({ where: { changedBy: { in: ids } } });
    await prisma.request.deleteMany({
      where: { OR: [{ submittedBy: { in: ids } }, { currentOwnerId: { in: ids } }] },
    });
    await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  }
  await removeNonDevelopmentCompanies(prisma);
}
