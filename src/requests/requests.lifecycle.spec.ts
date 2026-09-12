import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import {
  asActor,
  CHADI,
  cleanRequestData,
  closeTestApp,
  createTestApp,
  IT,
  JOHN,
} from './test-helpers';

describe('Request lifecycle safety', () => {
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

  it('rejects SUBMITTED to COMPLETED with 409 and does not write history', async () => {
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set(asActor(JOHN))
      .send({ submittedBy: JOHN, departmentId: IT });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const owned = await request(app.getHttpServer())
      .patch(`/requests/${id}/owner`)
      .set(asActor(CHADI))
      .send({ currentOwnerId: CHADI });
    expect(owned.status).toBe(200);

    const skipped = await request(app.getHttpServer())
      .patch(`/requests/${id}/transition`)
      .set(asActor(CHADI))
      .send({ to: 'COMPLETED', changedBy: CHADI });
    expect(skipped.status).toBe(409);

    const persisted = await prisma.request.findUnique({ where: { id } });
    expect(persisted?.status).toBe('SUBMITTED');
    expect(persisted?.currentOwnerId).toBe(CHADI);

    const historyCount = await prisma.requestStatusHistory.count({
      where: { requestId: id },
    });
    expect(historyCount).toBe(0);
  });

  it('returns 404 for a request id that does not exist', async () => {
    const aggregate = await prisma.request.aggregate({ _max: { id: true } });
    const missingId = (aggregate._max.id ?? 0) + 1_000_000;

    const missing = await request(app.getHttpServer())
      .get(`/requests/${missingId}`)
      .set(asActor(CHADI));
    expect(missing.status).toBe(404);
    expect(missing.body.message).toMatch(new RegExp(`Request ${missingId} was not found`));
  });

  it('still persists SUBMITTED to IN_PROGRESS to COMPLETED with two history rows', async () => {
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set(asActor(JOHN))
      .send({ submittedBy: JOHN, departmentId: IT });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const owned = await request(app.getHttpServer())
      .patch(`/requests/${id}/owner`)
      .set(asActor(CHADI))
      .send({ currentOwnerId: CHADI });
    expect(owned.status).toBe(200);

    const started = await request(app.getHttpServer())
      .patch(`/requests/${id}/transition`)
      .set(asActor(CHADI))
      .send({ to: 'IN_PROGRESS', changedBy: CHADI });
    expect(started.status).toBe(200);

    const completed = await request(app.getHttpServer())
      .patch(`/requests/${id}/transition`)
      .set(asActor(CHADI))
      .send({ to: 'COMPLETED', changedBy: CHADI });
    expect(completed.status).toBe(200);

    const persisted = await prisma.request.findUnique({ where: { id } });
    expect(persisted?.status).toBe('COMPLETED');

    const history = await prisma.requestStatusHistory.findMany({
      where: { requestId: id },
      orderBy: { id: 'asc' },
    });
    expect(history).toHaveLength(2);
    expect(history[0].previousStatus).toBe('SUBMITTED');
    expect(history[0].newStatus).toBe('IN_PROGRESS');
    expect(history[0].changedBy).toBe(CHADI);
    expect(history[1].previousStatus).toBe('IN_PROGRESS');
    expect(history[1].newStatus).toBe('COMPLETED');
    expect(history[1].changedBy).toBe(CHADI);
  });
});
