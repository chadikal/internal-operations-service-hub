import { PrismaClient } from '@prisma/client';

const { loadTestEnv } = require('../scripts/load-test-env.cjs') as {
  loadTestEnv: () => string;
};

export const TEST_PASSWORD = 'test-password-not-for-production-use-12';

function assertTestDatabase(databaseUrl: string) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, '').replace(/\/+$/, ''));
  if (name !== 'operations_hub_test') {
    throw new Error(
      `Test fixtures can only write credentials to "operations_hub_test", but DATABASE_URL points at "${name}".`,
    );
  }
}

export async function removeSignupCompanies() {
  loadTestEnv();
  const prisma = new PrismaClient();
  try {
    const development = await prisma.company.findFirst({
      where: { name: 'Development', status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    if (!development) {
      return;
    }
    const extras = await prisma.company.findMany({
      where: { id: { not: development.id } },
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
  } finally {
    await prisma.$disconnect();
  }
}

export async function cleanRequestData() {
  loadTestEnv();
  const prisma = new PrismaClient();
  try {
    await prisma.requestStatusHistory.deleteMany();
    await prisma.request.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}

export async function ensureTestLogins() {
  const databaseUrl = loadTestEnv();
  assertTestDatabase(databaseUrl);
  const argon2 = require('argon2') as {
    hash: (password: string, options: { type: number }) => Promise<string>;
    argon2id: number;
  };
  const passwordHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
  const prisma = new PrismaClient();
  try {
    await prisma.employee.update({
      where: { id: 1 },
      data: { email: 'chadi@operations-hub.test', passwordHash },
    });
    await prisma.employee.update({
      where: { id: 2 },
      data: { email: 'john@operations-hub.test', passwordHash },
    });
    const company = await prisma.company.findFirst({
      where: { name: 'Development', status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    if (!company) {
      throw new Error('Development company is missing. Apply migrations before e2e tests.');
    }
    const defaults = [
      { id: 1, departmentId: 1, name: 'General' },
      { id: 2, departmentId: 2, name: 'General' },
      { id: 3, departmentId: 3, name: 'General' },
    ];
    for (const row of defaults) {
      await prisma.requestType.upsert({
        where: { id: row.id },
        update: {
          name: row.name,
          approvalPolicy: 'NONE',
          departmentId: row.departmentId,
          companyId: company.id,
        },
        create: {
          id: row.id,
          name: row.name,
          approvalPolicy: 'NONE',
          departmentId: row.departmentId,
          companyId: company.id,
        },
      });
    }
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"RequestType"', 'id'), COALESCE((SELECT MAX(id) FROM "RequestType"), 1))`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
