import { PrismaClient } from '@prisma/client';

const { loadTestEnv } = require('../scripts/load-test-env.cjs') as {
  loadTestEnv: () => string;
};

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
