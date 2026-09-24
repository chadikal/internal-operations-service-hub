import { ABSOLUTE_SESSION_MS, SESSION_COOKIE } from './session-token';

type CookieOptions = {
  httpOnly: boolean;
  path: string;
  maxAge: number;
  sameSite: 'lax';
  secure: boolean;
};

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, `Max-Age=${options.maxAge}`, `Path=${options.path}`, 'SameSite=Lax'];
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function parseCookie(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function cookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    path: '/',
    maxAge,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };
}

export function sessionCookieHeader(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, cookieOptions(Math.floor(ABSOLUTE_SESSION_MS / 1000)));
}

export function clearSessionCookieHeader(): string {
  return serializeCookie(SESSION_COOKIE, '', cookieOptions(0));
}

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const value = parseCookie(cookieHeader)[SESSION_COOKIE];
  return value && value.length > 0 ? value : undefined;
}
