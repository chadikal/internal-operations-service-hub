import { ForbiddenException } from '@nestjs/common';

export function parseAuthOrigins(value: string | undefined): string[] {
  return (
    value
      ?.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0) ?? []
  );
}

export function allowedOrigins(): string[] {
  const configured = parseAuthOrigins(process.env.AUTH_ORIGINS);
  if (configured.length === 0) {
    return ['http://localhost:5173'];
  }
  return configured;
}

export function assertTrustedOrigin(origin: string | undefined): void {
  if (!origin || !allowedOrigins().includes(origin)) {
    throw new ForbiddenException('This origin is not allowed to sign in.');
  }
}
