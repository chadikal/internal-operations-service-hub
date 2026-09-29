import { INestApplication, Logger } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../requests/test-helpers';

describe('health', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('returns liveness without a session and without querying the database', async () => {
    const query = jest.spyOn(prisma, '$queryRaw');
    const execute = jest.spyOn(prisma, '$executeRaw');
    const callsBefore = query.mock.calls.length + execute.mock.calls.length;

    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(query.mock.calls.length + execute.mock.calls.length).toBe(callsBefore);
    query.mockRestore();
    execute.mockRestore();
  });

  it('keeps GET /health as a public liveness alias', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports ready when the database accepts a read-only check', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  it('reports not ready without database details when the check fails', async () => {
    const query = jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(
      new Error('connect ECONNREFUSED secret-host.neon.tech user=neondb password=super-secret'),
    );
    const logs: string[] = [];
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .set('X-Request-Id', 'ready-check-1');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
    expect(response.headers['x-request-id']).toBe('ready-check-1');
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/neon|password|ECONNREFUSED|secret-host|neondb|super-secret/i);
    const printed = logs.join('\n');
    expect(printed).toContain('Database readiness check failed');
    expect(printed).toContain('ready-check-1');
    expect(printed).not.toMatch(/neon|password|ECONNREFUSED|secret-host|neondb|super-secret/i);
    query.mockRestore();
    errorSpy.mockRestore();
  });
});
