import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

export const CHADI = 1;
export const JOHN = 2;
export const IT = 1;

export function asActor(actorId: number) {
  return { 'X-Actor-Id': String(actorId) };
}

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

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
