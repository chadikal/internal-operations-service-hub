import { createHash } from 'crypto';

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
