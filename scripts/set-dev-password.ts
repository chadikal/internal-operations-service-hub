import '../src/load-env';
import { PrismaClient } from '@prisma/client';
import { assertDevelopmentCredentialTarget } from '../src/auth/database-target';
import { planDevCredentialUpdate } from '../src/auth/dev-credentials';
import { hashPassword } from '../src/auth/password';

const employeeArg = process.argv[2];
const emailArg = process.argv[3];
const password = process.env.DEV_ACCOUNT_PASSWORD;

async function main() {
  assertDevelopmentCredentialTarget(process.env.NODE_ENV, process.env.DATABASE_URL);
  if (!employeeArg || !password) {
    throw new Error(
      'Usage: NODE_ENV=development DEV_ACCOUNT_PASSWORD="..." npm run auth:set-dev-password -- <employeeId> [email]',
    );
  }
  const employeeId = Number(employeeArg);
  if (!Number.isInteger(employeeId) || employeeId < 1) {
    throw new Error('employeeId must be a positive integer.');
  }
  if (password.length < 12) {
    throw new Error('DEV_ACCOUNT_PASSWORD must be at least 12 characters.');
  }

  const prisma = new PrismaClient();
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!employee) {
      throw new Error(`Employee ${employeeId} was not found.`);
    }
    const emailUpdate = planDevCredentialUpdate(employee, emailArg);
    await prisma.employee.update({
      where: { id: employeeId },
      data: { ...emailUpdate, passwordHash: await hashPassword(password) },
    });
    console.log(`Development password set for employee ${employeeId}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Could not set the development password.';
  console.error(message);
  process.exit(1);
});
