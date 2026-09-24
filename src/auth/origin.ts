import { ForbiddenException } from '@nestjs/common';

export function allowedOrigins(): string[] {
  const configured = process.env.AUTH_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (!configured || configured.length === 0) {
    return ['http://localhost:5173'];
  }
  return configured;
}

export function assertTrustedOrigin(origin: string | undefined): void {
  if (!origin || !allowedOrigins().includes(origin)) {
    throw new ForbiddenException('This origin is not allowed to sign in.');
  }
}
