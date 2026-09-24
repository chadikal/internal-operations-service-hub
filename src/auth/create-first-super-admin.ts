import { PrismaClient } from '@prisma/client';

export type FirstAdminInput = {
  email: string;
  password: string;
  name: string;
  departmentId: number;
};

export async function createFirstSuperAdmin(
  _prisma: PrismaClient,
  _input: FirstAdminInput,
): Promise<never> {
  throw new Error(
    'Company signup replaced the first Super Admin command. This command does not create a Super Admin.',
  );
}
