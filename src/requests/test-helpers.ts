import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AI_PROVIDER, AiProvider } from '../ai/ai-provider';
import { AppModule } from '../app.module';
import { assertTestDatabase } from '../auth/database-target';
import { hashPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';

export const CHADI = 1;
export const JOHN = 2;
export const IT = 1;
export const HR = 2;
export const FINANCE = 3;
export const IT_TYPE = 1;
export const HR_TYPE = 2;
export const FINANCE_TYPE = 3;
export const TEST_PASSWORD = 'test-password-not-for-production-use-12';
export const JOHN_EMAIL = 'john@operations-hub.test';
export const CHADI_EMAIL = 'chadi@operations-hub.test';
export const TEST_ORIGIN = 'http://localhost:5173';

const headerCache = new WeakMap<INestApplication, Map<number, Record<string, string>>>();
let credentialsReady: Promise<void> | null = null;

export async function ensureTestCredentials(prisma: PrismaService) {
  if (!credentialsReady) {
    credentialsReady = (async () => {
      assertTestDatabase(process.env.DATABASE_URL);
      const passwordHash = await hashPassword(TEST_PASSWORD);
      await prisma.employee.update({
        where: { id: CHADI },
        data: { email: CHADI_EMAIL, passwordHash },
      });
      await prisma.employee.update({
        where: { id: JOHN },
        data: { email: JOHN_EMAIL, passwordHash },
      });
      await ensureDevelopmentRequestTypes(prisma);
    })();
  }
  await credentialsReady;
}

export async function ensureDevelopmentRequestTypes(prisma: PrismaService) {
  const companyId = await developmentCompanyId(prisma);
  const defaults: Array<{ id: number; departmentId: number; name: string }> = [
    { id: IT_TYPE, departmentId: IT, name: 'General' },
    { id: HR_TYPE, departmentId: HR, name: 'General' },
    { id: FINANCE_TYPE, departmentId: FINANCE, name: 'General' },
  ];
  for (const row of defaults) {
    await prisma.requestType.upsert({
      where: { id: row.id },
      update: {
        name: row.name,
        approvalPolicy: 'NONE',
        departmentId: row.departmentId,
        companyId,
      },
      create: {
        id: row.id,
        name: row.name,
        approvalPolicy: 'NONE',
        departmentId: row.departmentId,
        companyId,
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"RequestType"', 'id'), COALESCE((SELECT MAX(id) FROM "RequestType"), 1))`,
  );
}

export async function createTestRequestType(
  app: INestApplication,
  headers: Record<string, string>,
  departmentId: number,
  name = 'General',
  approvalPolicy: 'NONE' | 'DEPARTMENT_ADMIN' | 'SUPER_ADMIN' = 'NONE',
): Promise<{ id: number; name: string; approvalPolicy: string; departmentId: number }> {
  const created = await request(app.getHttpServer())
    .post(`/departments/${departmentId}/request-types`)
    .set(headers)
    .send({ name, approvalPolicy });
  if (created.status !== 201) {
    throw new Error(
      `Creating a request type failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  return created.body;
}

export function sessionCookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = /hub_session=([^;]+)/.exec(header);
  if (!match) {
    throw new Error('Login did not set a session cookie');
  }
  return `hub_session=${match[1]}`;
}

export async function authHeaders(app: INestApplication, prisma: PrismaService, actorId: number) {
  await ensureTestCredentials(prisma);
  let byActor = headerCache.get(app);
  if (!byActor) {
    byActor = new Map();
    headerCache.set(app, byActor);
  }
  const cached = byActor.get(actorId);
  if (cached) {
    return cached;
  }

  const email = actorId === CHADI ? CHADI_EMAIL : actorId === JOHN ? JOHN_EMAIL : null;
  if (!email) {
    throw new Error(`No test login is configured for employee ${actorId}`);
  }
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ email, password: TEST_PASSWORD });
  if (response.status !== 200) {
    throw new Error(`Test login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const headers = {
    Cookie: sessionCookieFrom(response),
    'X-CSRF-Token': String(response.body.csrfToken),
  };
  byActor.set(actorId, headers);
  return headers;
}

export async function createTestApp(aiProvider?: AiProvider) {
  const builder = Test.createTestingModule({
    imports: [AppModule],
  });
  if (aiProvider) {
    builder.overrideProvider(AI_PROVIDER).useValue(aiProvider);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
  };
}

export async function closeTestApp(app: INestApplication) {
  await app.close();
}

export async function cleanRequestData(prisma: PrismaService) {
  await prisma.requestStatusHistory.deleteMany();
  await prisma.request.deleteMany();
}

export async function developmentCompanyId(prisma: PrismaService): Promise<number> {
  const company = await prisma.company.findFirst({
    where: { name: 'Development', status: 'ACTIVE' },
    orderBy: { id: 'asc' },
  });
  if (!company) {
    throw new Error('Development company is missing. Apply the company migration before tests.');
  }
  return company.id;
}

export async function removeNonDevelopmentCompanies(prisma: PrismaService) {
  const companyId = await developmentCompanyId(prisma);
  const extras = await prisma.company.findMany({
    where: { id: { not: companyId } },
    select: { id: true },
  });
  const companyIds = extras.map((company) => company.id);
  if (companyIds.length === 0) {
    return;
  }
  await prisma.emailVerification.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.invitation.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.session.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.requestStatusHistory.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.request.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.requestType.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.employee.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.department.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
}
