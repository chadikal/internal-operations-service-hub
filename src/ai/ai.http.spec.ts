import { Logger } from '@nestjs/common';
import * as request from 'supertest';
import { RequestyAiProvider } from './requesty-ai.provider';
import { PrismaService } from '../prisma/prisma.service';
import {
  asActor,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  JOHN,
} from '../requests/test-helpers';

async function countAuthoritativeRows(prisma: PrismaService) {
  const [requests, history] = await Promise.all([
    prisma.request.count(),
    prisma.requestStatusHistory.count(),
  ]);
  return { requests, history };
}

describe('AI intake HTTP boundary', () => {
  it('returns an advisory result without creating a request or history', async () => {
    const { app, prisma } = await createTestApp();
    try {
      await cleanRequestData(prisma);

      const response = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(asActor(JOHN))
        .send({ text: 'I need a laptop.' });

      expect(response.status).toBe(200);
      expect(response.body.situation).toBe('need');
      expect(response.body.troubleshootingSteps).toEqual([]);
      expect(response.body.draft.departmentId).toBe(1);
      expect(response.body).not.toHaveProperty('status');
      expect(response.body).not.toHaveProperty('currentOwnerId');
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      await cleanRequestData(prisma);
      await closeTestApp(app);
    }
  });

  it('rejects invalid provider output without creating a request or history', async () => {
    const { app, prisma } = await createTestApp({
      complete: async () => ({
        situation: 'need',
        draft: { departmentId: 999 },
        status: 'COMPLETED',
      }),
    });
    try {
      await cleanRequestData(prisma);

      const response = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(asActor(JOHN))
        .send({ text: 'I need a laptop.' });

      expect(response.status).toBe(502);
      expect(response.body.message).toMatch(/invalid result/i);
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      await cleanRequestData(prisma);
      await closeTestApp(app);
    }
  });

  it('maps provider failure to 503 without creating a request or history', async () => {
    const { app, prisma } = await createTestApp({
      complete: async () => {
        throw new Error('provider down');
      },
    });
    try {
      await cleanRequestData(prisma);

      const response = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(asActor(JOHN))
        .send({ text: 'I need a laptop.' });

      expect(response.status).toBe(503);
      expect(response.body.message).toMatch(/unavailable/i);
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      await cleanRequestData(prisma);
      await closeTestApp(app);
    }
  });

  it('rejects missing, invalid, and unknown actors', async () => {
    const { app, prisma } = await createTestApp();
    try {
      const missing = await request(app.getHttpServer())
        .post('/ai/intake')
        .send({ text: 'I need a laptop.' });
      expect(missing.status).toBe(400);
      expect(missing.body.message).toMatch(/X-Actor-Id header is required/);

      const invalid = await request(app.getHttpServer())
        .post('/ai/intake')
        .set({ 'X-Actor-Id': 'abc' })
        .send({ text: 'I need a laptop.' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.message).toMatch(/positive integer/);

      const unknown = await request(app.getHttpServer())
        .post('/ai/intake')
        .set({ 'X-Actor-Id': '999999' })
        .send({ text: 'I need a laptop.' });
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toMatch(/Employee 999999 was not found/);

      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      await closeTestApp(app);
    }
  });

  it('keeps using the mock during tests even if AI_PROVIDER=requesty', async () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = 'requesty';
    const { app, prisma } = await createTestApp();
    try {
      await cleanRequestData(prisma);
      const response = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(asActor(JOHN))
        .send({ text: 'I need a laptop.' });

      expect(response.status).toBe(200);
      expect(response.body.draft.departmentId).toBe(1);
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      if (previous === undefined) {
        delete process.env.AI_PROVIDER;
      } else {
        process.env.AI_PROVIDER = previous;
      }
      await cleanRequestData(prisma);
      await closeTestApp(app);
    }
  });

  it('maps a Requesty HTTP failure to 503 without creating a request or history', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const provider = new RequestyAiProvider(async () => ({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          message: 'upstream-rate-limit-detail',
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        },
      }),
    }));
    const { app, prisma } = await createTestApp(provider);
    try {
      await cleanRequestData(prisma);
      const response = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(asActor(JOHN))
        .send({ text: 'I need a laptop.' });

      expect(response.status).toBe(503);
      expect(response.body.message).toBe(
        'The intake assistant is unavailable. Try again later.',
      );
      expect(JSON.stringify(response.body)).not.toContain('upstream-rate-limit-detail');
      expect(JSON.stringify(response.body)).not.toContain('rate_limit_exceeded');
      expect(JSON.stringify(response.body)).not.toContain('test-key-not-real');
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain(
        'Requesty intake upstream failure: Requesty request failed with status 429',
      );
      expect(logged).toContain('code=rate_limit_exceeded');
      expect(logged).toContain('message=upstream-rate-limit-detail');
      expect(logged).not.toContain('test-key-not-real');
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      errorSpy.mockRestore();
      delete process.env.REQUESTY_API_KEY;
      await cleanRequestData(prisma);
      await closeTestApp(app);
    }
  });
});
