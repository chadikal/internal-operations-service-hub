import { assertJwtSecret } from '../auth/jwt-secret';
import { parseAuthOrigins } from '../auth/origin';

const KNOWN_NODE_ENVS = new Set(['development', 'test', 'production']);

export function assertRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv !== undefined && nodeEnv !== '' && !KNOWN_NODE_ENVS.has(nodeEnv)) {
    throw new Error('Invalid configuration: NODE_ENV must be development, test, or production');
  }
  if (nodeEnv !== 'production') {
    return;
  }

  const problems = productionProblems(env);
  if (problems.length > 0) {
    throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
  }
}

function productionProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  push(problems, databaseProblem(env.DATABASE_URL));
  push(problems, jwtProblem(env.JWT_SECRET));
  push(problems, authOriginsProblem(env.AUTH_ORIGINS));
  problems.push(...resendProblems(env));
  problems.push(...aiProblems(env));
  push(problems, trustProxyProblem(env.TRUST_PROXY));
  return problems;
}

function push(problems: string[], problem: string | undefined): void {
  if (problem) {
    problems.push(problem);
  }
}

function databaseProblem(value: string | undefined): string | undefined {
  const databaseUrl = value?.trim() ?? '';
  if (!databaseUrl) {
    return 'DATABASE_URL is required';
  }
  try {
    const parsed = new URL(databaseUrl);
    if (
      (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
      !parsed.hostname
    ) {
      return 'DATABASE_URL is invalid';
    }
  } catch {
    return 'DATABASE_URL is invalid';
  }
  return undefined;
}

function jwtProblem(value: string | undefined): string | undefined {
  try {
    assertJwtSecret(value);
    return undefined;
  } catch {
    const secret = value?.trim() ?? '';
    return secret.length === 0
      ? 'JWT_SECRET is required'
      : 'JWT_SECRET must be at least 32 characters';
  }
}

function authOriginsProblem(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return 'AUTH_ORIGINS is required';
  }
  const origins = parseAuthOrigins(value);
  if (origins.length === 0) {
    return 'AUTH_ORIGINS is required';
  }
  if (origins.some((origin) => !isAcceptableOrigin(origin))) {
    return 'AUTH_ORIGINS is invalid';
  }
  return undefined;
}

function isAcceptableOrigin(origin: string): boolean {
  if (origin.includes('*')) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return false;
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return false;
  }
  return parsed.origin === origin;
}

function resendProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  if (!(env.RESEND_API_KEY?.trim() ?? '')) {
    problems.push('RESEND_API_KEY is required');
  }
  const from = env.EMAIL_FROM?.trim() ?? '';
  if (!from) {
    problems.push('EMAIL_FROM is required');
  } else if (from.includes('\n') || from.includes('\r') || !from.includes('@')) {
    problems.push('EMAIL_FROM is invalid');
  }
  return problems;
}

function aiProblems(env: NodeJS.ProcessEnv): string[] {
  const provider = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (!provider) {
    return ['AI_PROVIDER is required'];
  }
  if (provider !== 'requesty') {
    return ['AI_PROVIDER must be requesty'];
  }
  const problems: string[] = [];
  if (!(env.REQUESTY_API_KEY?.trim() ?? '')) {
    problems.push('REQUESTY_API_KEY is required');
  }
  if (!(env.REQUESTY_MODEL?.trim() ?? '')) {
    problems.push('REQUESTY_MODEL is required');
  }
  return problems;
}

function trustProxyProblem(value: string | undefined): string | undefined {
  if (value === undefined || value === '') {
    return 'TRUST_PROXY is required';
  }
  if (value !== 'true') {
    return 'TRUST_PROXY must be true';
  }
  return undefined;
}
