import { randomBytes, timingSafeEqual } from 'crypto';
import jwt = require('jsonwebtoken');

export const ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;
export const IDLE_SESSION_MS = 30 * 60 * 1000;
export const SESSION_COOKIE = 'hub_session';

export function newSecretToken(): string {
  return randomBytes(32).toString('base64url');
}

export function signSessionToken(
  accountId: number,
  sessionId: string,
  expiresAt: Date,
  secret: string,
): string {
  const seconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return jwt.sign({ sub: String(accountId) }, secret, {
    algorithm: 'HS256',
    jwtid: sessionId,
    expiresIn: seconds,
  });
}

export type SessionClaims = {
  sub: number;
  jti: string;
  exp: number;
};

export function readSessionToken(token: string, secret: string): SessionClaims {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof payload === 'string') {
    throw new Error('JWT payload must be an object');
  }
  const claims = payload as jwt.JwtPayload;
  if (typeof claims.exp !== 'number') {
    throw new Error('JWT exp is required');
  }
  if (typeof claims.sub !== 'string' || !/^[1-9]\d*$/.test(claims.sub)) {
    throw new Error('JWT sub is required');
  }
  if (typeof claims.jti !== 'string' || claims.jti.length < 20) {
    throw new Error('JWT jti is required');
  }
  return { sub: Number(claims.sub), jti: claims.jti, exp: claims.exp };
}

export function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
