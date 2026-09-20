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

describe('Request persistence', () => {
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

  it('persists SUBMITTED to IN_PROGRESS and one history row in PostgreSQL', async () => {
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

    const persisted = await prisma.request.findUnique({ where: { id } });
    expect(persisted).not.toBeNull();
    expect(persisted?.id).toBe(id);
    expect(persisted?.submittedBy).toBe(JOHN);
    expect(persisted?.currentOwnerId).toBe(CHADI);
    expect(persisted?.status).toBe('IN_PROGRESS');

    const history = await prisma.requestStatusHistory.findMany({
      where: { requestId: id },
      orderBy: { id: 'asc' },
    });
    expect(history).toHaveLength(1);
    expect(history[0].requestId).toBe(id);
    expect(history[0].previousStatus).toBe('SUBMITTED');
    expect(history[0].newStatus).toBe('IN_PROGRESS');
    expect(history[0].changedBy).toBe(CHADI);
  });

  it('stores optional title and description and keeps omitted fields null', async () => {
    const withText = await request(app.getHttpServer())
      .post('/requests')
      .set(asActor(JOHN))
      .send({
        submittedBy: JOHN,
        departmentId: IT,
        title: 'Laptop request',
        description: 'I need a laptop for development work.',
      });
    expect(withText.status).toBe(201);
    expect(withText.body.title).toBe('Laptop request');
    expect(withText.body.description).toBe('I need a laptop for development work.');

    const persistedWithText = await prisma.request.findUnique({
      where: { id: withText.body.id as number },
    });
    expect(persistedWithText?.title).toBe('Laptop request');
    expect(persistedWithText?.description).toBe('I need a laptop for development work.');

    const omitted = await request(app.getHttpServer())
      .post('/requests')
      .set(asActor(JOHN))
      .send({ submittedBy: JOHN, departmentId: IT });
    expect(omitted.status).toBe(201);
    expect(omitted.body.title).toBeNull();
    expect(omitted.body.description).toBeNull();

    const persistedOmitted = await prisma.request.findUnique({
      where: { id: omitted.body.id as number },
    });
    expect(persistedOmitted?.title).toBeNull();
    expect(persistedOmitted?.description).toBeNull();
  });
});
