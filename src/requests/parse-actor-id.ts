import { BadRequestException } from '@nestjs/common';

export function parseActorId(header: string | undefined): number {
  if (header === undefined || header.trim() === '') {
    throw new BadRequestException('X-Actor-Id header is required');
  }
  const id = Number(header);
  if (!Number.isInteger(id) || id < 1) {
    throw new BadRequestException('X-Actor-Id must be a positive integer');
  }
  return id;
}
