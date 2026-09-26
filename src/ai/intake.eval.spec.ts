import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { isActionableIntakeDraft } from './intake.schema';
import { PrismaService } from '../prisma/prisma.service';
import {
  authHeaders,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  developmentCompanyId,
  HR,
  HR_TYPE,
  IT,
  IT_TYPE,
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
      .set(await authHeaders(app, prisma, JOHN))
      .send({ text: "My laptop won't connect to Wi-Fi." });

    expect(response.status).toBe(200);
    expect(response.body.situation).toBe('problem');
    expect(response.body.troubleshootingSteps).toHaveLength(3);
    expect(response.body.draft.departmentId).toBe(IT);
    expect(response.body.draft.requestTypeId).toBe(IT_TYPE);
    expect(response.body.draft.summary).toBeTruthy();
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('2 clear need: laptop request has no troubleshooting and routes to IT', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(await authHeaders(app, prisma, JOHN))
      .send({ text: 'I need a laptop.' });

    expect(response.status).toBe(200);
    expect(response.body.situation).toBe('need');
    expect(response.body.troubleshootingSteps).toEqual([]);
    expect(response.body.draft.departmentId).toBe(IT);
    expect(response.body.draft.requestTypeId).toBe(IT_TYPE);
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('3 clear need: employment certificate keeps an HR draft plus useful missing details', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(await authHeaders(app, prisma, JOHN))
      .send({ text: 'I need an employment certificate from HR.' });

    expect(response.status).toBe(200);
    expect(response.body.situation).toBe('need');
    expect(response.body.troubleshootingSteps).toEqual([]);
    expect(response.body.draft.departmentId).toBe(HR);
    expect(response.body.draft.requestTypeId).toBe(HR_TYPE);
    expect(response.body.draft.summary).toBeTruthy();
    expect(isActionableIntakeDraft(response.body.draft)).toBe(true);
    expect(response.body.missingInformation).toEqual([]);
    expect(response.body.suggestions.length).toBeGreaterThan(0);
    expect(response.body.suggestions.join(' ')).toMatch(
      /purpose|recipient|deadline|format|language/i,
    );
    expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
  });

  it('clear access intent selects the entitlement type and not a failing connection', async () => {
    const types = await addNamedTypes(prisma, [
      { departmentId: IT, name: 'Software' },
      { departmentId: IT, name: 'Access' },
      { departmentId: HR, name: 'Access' },
    ]);
    try {
      const vpn = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(await authHeaders(app, prisma, JOHN))
        .send({ text: 'I need permission to use the VPN.' });
      expect(vpn.status).toBe(200);
      expect(vpn.body.situation).toBe('need');
      expect(vpn.body.troubleshootingSteps).toEqual([]);
      expect(vpn.body.draft.departmentId).toBe(IT);
      expect(vpn.body.draft.requestTypeId).toBe(types.IT.Access);

      const records = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(await authHeaders(app, prisma, JOHN))
        .send({ text: 'I need permission to view employee records in HR.' });
      expect(records.status).toBe(200);
      expect(records.body.situation).toBe('need');
      expect(records.body.draft.departmentId).toBe(HR);
      expect(records.body.draft.requestTypeId).toBe(types.HR.Access);
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      await removeNamedTypes(prisma, types.ids);
    }
  });

  it('clear malfunction selects the software type for an existing connection', async () => {
    const types = await addNamedTypes(prisma, [
      { departmentId: IT, name: 'Software' },
      { departmentId: IT, name: 'Access' },
    ]);
    try {
      const response = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(await authHeaders(app, prisma, JOHN))
        .send({ text: 'The VPN client will not connect.' });
      expect(response.status).toBe(200);
      expect(response.body.situation).toBe('problem');
      expect(response.body.troubleshootingSteps).toHaveLength(3);
      expect(response.body.draft.departmentId).toBe(IT);
      expect(response.body.draft.requestTypeId).toBe(types.IT.Software);
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      await removeNamedTypes(prisma, types.ids);
    }
  });

  it('ambiguous access wording keeps troubleshooting and does not preselect a type', async () => {
    const types = await addNamedTypes(prisma, [
      { departmentId: IT, name: 'Software' },
      { departmentId: IT, name: 'Access' },
    ]);
    try {
      const response = await request(app.getHttpServer())
        .post('/ai/intake')
        .set(await authHeaders(app, prisma, JOHN))
        .send({ text: "I can't access the VPN; I need permission." });
      expect(response.status).toBe(200);
      expect(response.body.situation).toBe('problem');
      expect(response.body.troubleshootingSteps.length).toBeGreaterThan(0);
      expect(response.body.missingInformation).toEqual([]);
      expect(response.body.draft.departmentId).toBe(IT);
      expect(response.body.draft.requestTypeId).toBeNull();
      expect(response.body.draft.summary).toBeTruthy();
      expect(response.body.suggestions.join(' ')).toMatch(/permission|failing/i);
      expect(await countAuthoritativeRows(prisma)).toEqual({ requests: 0, history: 0 });
    } finally {
      await removeNamedTypes(prisma, types.ids);
    }
  });

  it('4 thin input: does not invent a department or draft details', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai/intake')
      .set(await authHeaders(app, prisma, JOHN))
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
      .set(await authHeaders(app, prisma, JOHN))
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
      .set(await authHeaders(app, prisma, JOHN))
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
        .set(await authHeaders(app, prisma, JOHN))
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
        .set(await authHeaders(app, prisma, JOHN))
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

async function addNamedTypes(
  prisma: PrismaService,
  rows: Array<{ departmentId: number; name: string }>,
) {
  const companyId = await developmentCompanyId(prisma);
  const created: Array<{ id: number; departmentId: number; name: string }> = [];
  for (const row of rows) {
    created.push(
      await prisma.requestType.create({
        data: {
          companyId,
          departmentId: row.departmentId,
          name: row.name,
          approvalPolicy: 'NONE',
        },
      }),
    );
  }
  const byDepartment: Record<number, Record<string, number>> = {};
  for (const row of created) {
    byDepartment[row.departmentId] = byDepartment[row.departmentId] ?? {};
    byDepartment[row.departmentId][row.name] = row.id;
  }
  return {
    ids: created.map((row) => row.id),
    IT: byDepartment[IT] ?? {},
    HR: byDepartment[HR] ?? {},
  };
}

async function removeNamedTypes(prisma: PrismaService, ids: number[]) {
  if (ids.length === 0) {
    return;
  }
  await prisma.requestType.deleteMany({ where: { id: { in: ids } } });
}
