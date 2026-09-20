import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { isActionableIntakeDraft } from './intake.schema';
import { PrismaService } from '../prisma/prisma.service';
import {
  asActor,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  HR,
  IT,
  JOHN,
} from '../requests/test-helpers';

async function countAuthoritativeRows(prisma: PrismaService) {
  const [requests, history] = await Promise.all([
    prisma.request.count(),
    prisma.requestStatusHistory.count(),
  ]);
  return { requests, history };
}

describe('AI intake evals', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  beforeEach(async () => {
    await cleanRequestData(prisma);
  });

  afterEach(async () => {
    await cleanRequestData(prisma);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('1 clear problem: Wi-Fi suggests troubleshooting and an IT draft', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(asActor(JOHN))
      .send({ text: "My laptop won't connect to Wi-Fi." });

    expect(response.status).toBe(200);
    expect(response.body.situation).toBe('problem');
    expect(response.body.troubleshootingSteps).toHaveLength(3);
    expect(response.body.draft.departmentId).toBe(IT);
    expect(response.body.draft.summary).toBeTruthy();
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('2 clear need: laptop request has no troubleshooting and routes to IT', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(asActor(JOHN))
      .send({ text: 'I need a laptop.' });

    expect(response.status).toBe(200);
    expect(response.body.situation).toBe('need');
    expect(response.body.troubleshootingSteps).toEqual([]);
    expect(response.body.draft.departmentId).toBe(IT);
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('3 clear need: employment certificate keeps an HR draft plus useful missing details', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(asActor(JOHN))
      .send({ text: 'I need an employment certificate from HR.' });

    expect(response.status).toBe(200);
    expect(response.body.situation).toBe('need');
    expect(response.body.troubleshootingSteps).toEqual([]);
    expect(response.body.draft.departmentId).toBe(HR);
    expect(response.body.draft.summary).toBeTruthy();
    expect(isActionableIntakeDraft(response.body.draft)).toBe(true);
    expect(response.body.missingInformation.length).toBeGreaterThan(0);
    expect(response.body.missingInformation.join(' ')).toMatch(
      /purpose|recipient|deadline|format|language/i,
    );
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('4 thin input: does not invent a department or draft details', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(asActor(JOHN))
      .send({ text: 'I need help.' });

    expect(response.status).toBe(200);
    expect(response.body.missingInformation.length).toBeGreaterThan(0);
    expect(response.body.draft).toBeNull();
    expect(response.body.troubleshootingSteps).toEqual([]);
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('5 ambiguous dual intent: does not pick one department confidently', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(asActor(JOHN))
      .send({ text: 'My computer is broken and I also need a certificate.' });

    expect(response.status).toBe(200);
    expect(response.body.missingInformation.length).toBeGreaterThan(0);
    expect(response.body.draft).toBeNull();
    expect(response.body.troubleshootingSteps).toEqual([]);
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('6 trusted context: does not invent a Legal department', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(asActor(JOHN))
      .send({ text: 'Please send this to Legal.' });

    expect(response.status).toBe(200);
    expect(response.body.draft).toBeNull();
    expect(response.body.missingInformation.join(' ')).toMatch(/not available|department/i);
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('7 invalid provider output is rejected and writes nothing', async () => {
    const overridden = await createTestApp({
      complete: async () => ({
        situation: 'need',
        draft: { departmentId: 999 },
        status: 'COMPLETED',
      }),
    });
    try {
      await cleanRequestData(overridden.prisma);
      const response = await request(overridden.app.getHttpServer())
        .post('/ai/intake')
        .set(asActor(JOHN))
        .send({ text: 'I need a laptop.' });

      expect(response.status).toBe(502);
      expect(response.body.message).toMatch(/invalid result/i);
      expect(await countAuthoritativeRows(overridden.prisma)).toEqual({
        requests: 0,
        history: 0,
      });
    } finally {
      await cleanRequestData(overridden.prisma);
      await closeTestApp(overridden.app);
    }
  });

  it('8 provider failure is mapped to 503 and writes nothing', async () => {
    const overridden = await createTestApp({
      complete: async () => {
        throw new Error('provider down');
      },
    });
    try {
      await cleanRequestData(overridden.prisma);
      const response = await request(overridden.app.getHttpServer())
        .post('/ai/intake')
        .set(asActor(JOHN))
        .send({ text: 'I need a laptop.' });

      expect(response.status).toBe(503);
      expect(await countAuthoritativeRows(overridden.prisma)).toEqual({
        requests: 0,
        history: 0,
      });
    } finally {
      await cleanRequestData(overridden.prisma);
      await closeTestApp(overridden.app);
    }
  });
});
