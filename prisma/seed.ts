import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.department.upsert({
    where: { id: 1 },
    update: { name: 'IT' },
    create: { id: 1, name: 'IT' },
  });
  await prisma.department.upsert({
    where: { id: 2 },
    update: { name: 'HR' },
    create: { id: 2, name: 'HR' },
  });
  await prisma.department.upsert({
    where: { id: 3 },
    update: { name: 'Finance' },
    create: { id: 3, name: 'Finance' },
  });

  await prisma.employee.upsert({
    where: { id: 1 },
    update: { name: 'Chadi', departmentId: 1, canHandle: true },
    create: { id: 1, name: 'Chadi', departmentId: 1, canHandle: true },
  });
  await prisma.employee.upsert({
    where: { id: 2 },
    update: { name: 'John', departmentId: 1, canHandle: false },
    create: { id: 2, name: 'John', departmentId: 1, canHandle: false },
  });

  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"Department"', 'id'), COALESCE((SELECT MAX(id) FROM "Department"), 1))`,
  );
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"Employee"', 'id'), COALESCE((SELECT MAX(id) FROM "Employee"), 1))`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
