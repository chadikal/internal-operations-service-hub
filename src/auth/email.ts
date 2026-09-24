import { BadRequestException } from '@nestjs/common';
import validator = require('validator');

const MAX_EMAIL_LENGTH = 254;

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_EMAIL_LENGTH ||
    !validator.isEmail(normalized, { allow_display_name: false, require_tld: true })
  ) {
    throw new BadRequestException('email must be a valid email address');
  }
  return normalized;
}

export function loginEmailKey(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
}
