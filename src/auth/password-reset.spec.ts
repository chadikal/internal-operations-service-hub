import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanRequestData,
  closeTestApp,
  createTestApp,
  removeNonDevelopmentCompanies,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../requests/test-helpers';
import { PASSWORD_RESET_ACK } from './auth.service';
import { EMAIL_NOT_CONFIGURED, EmailSender } from './email-sender';
import { LoginRateLimiter } from './login-rate-limit';
import { hashOpaqueToken } from './token-hash';

const NEW_PASSWORD = 'replacement-password-not-for-production-12';
const NEWER_PASSWORD = 'second-replacement-password-not-for-use-12';

function signup(app: INestApplication, body: { companyName: string; name: string; email: string; password: string }) {
  return request(app.getHttpServer()).post('/auth/signup').set('Origin', TEST_ORIGIN).send(body);
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

function authCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = /hub_session=([^;]+)/.exec(header);
  if (!match) {
    throw new Error('Login did not set a session cookie');
  }
  return `hub_session=${match[1]}`;
}

async function verifyFounder(app: INestApplication, email: string) {
  const token = await outboxToken(app, email, 'email-verification');
  const verified = await request(app.getHttpServer())
    .post('/auth/verify-email')
    .set('Origin', TEST_ORIGIN)
    .send({ token });
  expect(verified.status).toBe(200);
}

describe('password reset', () => {
  jest.setTimeout(60_000);
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

  afterAll(async () => {
    await removeNonDevelopmentCompanies(prisma);
    await closeTestApp(app);
  });

  it('uses the same acknowledgement for an unknown email and does not create a token', async () => {
    const created = await signup(app, {
      companyName: 'Reset Known',
      name: 'Reset Founder',
      email: 'reset.founder@operations-hub.test',
      password: TEST_PASSWORD,
    });
    expect(created.status).toBe(201);
    await verifyFounder(app, 'reset.founder@operations-hub.test');

    const unknown = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'nobody.here@operations-hub.test' });
    const known = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'reset.founder@operations-hub.test' });

    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.body).toEqual({ sent: true, message: PASSWORD_RESET_ACK });
    expect(JSON.stringify(unknown.body)).not.toContain('reset=');
    expect(JSON.stringify(known.body)).not.toContain('reset=');
    expect(
      app.get(EmailSender).list().filter((item) => item.to === 'nobody.here@operations-hub.test'),
    ).toHaveLength(0);
    expect(await prisma.passwordReset.count({ where: { account: { email: 'nobody.here@operations-hub.test' } } })).toBe(
      0,
    );
  });

  it('does not reset an unverified account', async () => {
    const created = await signup(app, {
      companyName: 'Reset Pending',
      name: 'Pending Founder',
      email: 'pending.reset@operations-hub.test',
      password: TEST_PASSWORD,
    });
    expect(created.status).toBe(201);
    const queued = app.get(EmailSender).list().length;
    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'pending.reset@operations-hub.test' });
    expect(response.body).toEqual({ sent: true, message: PASSWORD_RESET_ACK });
    expect(app.get(EmailSender).list()).toHaveLength(queued);
    expect(await prisma.passwordReset.count({ where: { account: { email: 'pending.reset@operations-hub.test' } } })).toBe(
      0,
    );
  });

  it('rejects an expired link, a reused link, and the session that was open before the reset', async () => {
    const email = 'session.reset@operations-hub.test';
    const created = await signup(app, {
      companyName: 'Reset Session',
      name: 'Session Founder',
      email,
      password: TEST_PASSWORD,
    });
    expect(created.status).toBe(201);
    await verifyFounder(app, email);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const cookie = authCookie(login);

    const firstRequest = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Origin', TEST_ORIGIN)
      .send({ email });
    expect(firstRequest.status).toBe(200);
    const replaced = await outboxToken(app, email, 'password-reset');
    const secondRequest = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Origin', TEST_ORIGIN)
      .send({ email });
    expect(secondRequest.status).toBe(200);
    const current = await outboxToken(app, email, 'password-reset');
    expect(current).not.toBe(replaced);

    const staleLink = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('Origin', TEST_ORIGIN)
      .send({ token: replaced, password: NEWER_PASSWORD });
    expect(staleLink.status).toBe(400);
    expect(staleLink.body.message).toBe('This link has already been used.');
    expect(JSON.stringify(staleLink.body)).not.toContain(current);

    const expiredRequest = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Origin', TEST_ORIGIN)
      .send({ email });
    const expiredToken = await outboxToken(app, email, 'password-reset');
    await prisma.passwordReset.update({
      where: { tokenHash: hashOpaqueToken(expiredToken) },
      data: { expiresAt: new Date(Date.now() - 60_000), usedAt: null },
    });
    const expired = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('Origin', TEST_ORIGIN)
      .send({ token: expiredToken, password: NEWER_PASSWORD });
    expect(expired.status).toBe(400);
    expect(expired.body.message).toBe('This link is invalid or expired.');

    const freshRequest = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('Origin', TEST_ORIGIN)
      .send({ email });
    expect(freshRequest.status).toBe(200);
    const token = await outboxToken(app, email, 'password-reset');
    const reset = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('Origin', TEST_ORIGIN)
      .send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ reset: true });
    expect(JSON.stringify(reset.body)).not.toContain(token);

    const reused = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('Origin', TEST_ORIGIN)
      .send({ token, password: NEWER_PASSWORD });
    expect(reused.status).toBe(400);
    expect(reused.body.message).toBe('This link has already been used.');

    const session = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie);
    expect(session.status).toBe(401);
    const oldPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD });
    expect(oldPassword.status).toBe(401);
    const newPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: NEW_PASSWORD });
    expect(newPassword.status).toBe(200);
    const newerPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: NEWER_PASSWORD });
    expect(newerPassword.status).toBe(401);
  });

  it('returns 503 outside the development outbox and does not log the reset token', async () => {
    const email = 'guard.reset@operations-hub.test';
    const created = await signup(app, {
      companyName: 'Reset Guard',
      name: 'Guard Founder',
      email,
      password: TEST_PASSWORD,
    });
    expect(created.status).toBe(201);
    await verifyFounder(app, email);
    const previous = process.env.NODE_ENV;
    const printed: string[] = [];
    const logs = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(' '));
    });
    try {
      for (const nodeEnv of ['production', 'development']) {
        process.env.NODE_ENV = nodeEnv;
        const response = await request(app.getHttpServer())
          .post('/auth/forgot-password')
          .set('Origin', TEST_ORIGIN)
          .send({ email });
        expect(response.status).toBe(503);
        expect(response.body.message).toBe(EMAIL_NOT_CONFIGURED);
        expect(await prisma.passwordReset.count({ where: { account: { email } } })).toBe(0);
      }
      expect(printed.join('\n')).not.toContain('reset=');
      expect(printed.join('\n')).not.toContain('Development mail outbox');
    } finally {
      logs.mockRestore();
      process.env.NODE_ENV = previous;
    }
  });

  it('rolls back the reset token when mail fails inside the transaction', async () => {
    const email = 'rollback.reset@operations-hub.test';
    const created = await signup(app, {
      companyName: 'Reset Rollback',
      name: 'Rollback Founder',
      email,
      password: TEST_PASSWORD,
    });
    expect(created.status).toBe(201);
    await verifyFounder(app, email);
    const sender = app.get(EmailSender);
    const send = jest.spyOn(sender, 'send').mockRejectedValueOnce(new Error('mail failed after writes'));
    try {
      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('Origin', TEST_ORIGIN)
        .send({ email });
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(await prisma.passwordReset.count({ where: { account: { email } } })).toBe(0);
    } finally {
      send.mockRestore();
    }
  });
});
