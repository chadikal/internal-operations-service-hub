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

describe('Request visibility business rules', () => {
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

  it('lets John view his own request and lets Chadi view it as a handler', async () => {
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set(asActor(JOHN))
      .send({ submittedBy: JOHN, departmentId: IT });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const johnViewsOwn = await request(app.getHttpServer())
      .get(`/requests/${id}`)
      .set(asActor(JOHN));
    expect(johnViewsOwn.status).toBe(200);
    expect(johnViewsOwn.body.id).toBe(id);
    expect(johnViewsOwn.body.submittedBy).toBe(JOHN);

    const chadiViewsJohns = await request(app.getHttpServer())
      .get(`/requests/${id}`)
      .set(asActor(CHADI));
    expect(chadiViewsJohns.status).toBe(200);
    expect(chadiViewsJohns.body.id).toBe(id);
    expect(chadiViewsJohns.body.submittedBy).toBe(JOHN);
  });

  it('forbids John from viewing another employee request', async () => {
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set(asActor(CHADI))
      .send({ submittedBy: CHADI, departmentId: IT });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const johnViewsChadis = await request(app.getHttpServer())
      .get(`/requests/${id}`)
      .set(asActor(JOHN));
    expect(johnViewsChadis.status).toBe(403);
    expect(johnViewsChadis.body.message).toMatch(/not allowed to view/i);
  });
});
