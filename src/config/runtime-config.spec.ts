import { assertRuntimeConfig } from './runtime-config';

const SECRET_JWT = 'jwt-secret-value-that-must-not-appear-in-errors';
const DATABASE_PASSWORD = 'db-password-that-must-not-appear';
const RESEND_KEY = 're_resend_key_that_must_not_appear';
const REQUESTY_KEY = 'requesty-key-that-must-not-appear';

function productionEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: `postgresql://postgres:${DATABASE_PASSWORD}@localhost:5432/operations_hub`,
    JWT_SECRET: SECRET_JWT,
    AUTH_ORIGINS: 'https://app.example.com',
    RESEND_API_KEY: RESEND_KEY,
    EMAIL_FROM: 'Internal Operations Service Hub <onboarding@example.com>',
    AI_PROVIDER: 'requesty',
    REQUESTY_API_KEY: REQUESTY_KEY,
    REQUESTY_MODEL: 'mistral/leanstral-1-5',
    TRUST_PROXY: 'true',
    ...overrides,
  };
}

function messageFrom(env: NodeJS.ProcessEnv): string {
  try {
    assertRuntimeConfig(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected configuration validation to fail');
}

function expectNoSecrets(message: string): void {
  expect(message).not.toContain(SECRET_JWT);
  expect(message).not.toContain(DATABASE_PASSWORD);
  expect(message).not.toContain(RESEND_KEY);
  expect(message).not.toContain(REQUESTY_KEY);
  expect(message).not.toContain('postgresql://');
  expect(message).not.toContain('process.env');
}

describe('runtime configuration', () => {
  it('accepts a complete production configuration', () => {
    expect(() => assertRuntimeConfig(productionEnv())).not.toThrow();
  });

  it('accepts several comma-separated origins', () => {
    expect(() =>
      assertRuntimeConfig(
        productionEnv({
          AUTH_ORIGINS: 'https://app.example.com, https://admin.example.com',
        }),
      ),
    ).not.toThrow();
  });

  it('fails when DATABASE_URL is missing', () => {
    const env = productionEnv();
    delete env.DATABASE_URL;
    expect(messageFrom(env)).toBe('Invalid production configuration: DATABASE_URL is required');
  });

  it('fails when DATABASE_URL is not a postgres URL and does not echo it', () => {
    const message = messageFrom(
      productionEnv({
        DATABASE_URL: `not-a-url-${DATABASE_PASSWORD}`,
      }),
    );
    expect(message).toBe('Invalid production configuration: DATABASE_URL is invalid');
    expectNoSecrets(message);
  });

  it('fails when JWT_SECRET is missing', () => {
    const env = productionEnv();
    delete env.JWT_SECRET;
    const message = messageFrom(env);
    expect(message).toBe('Invalid production configuration: JWT_SECRET is required');
    expectNoSecrets(message);
  });

  it('fails when JWT_SECRET is shorter than 32 characters', () => {
    const message = messageFrom(productionEnv({ JWT_SECRET: 'too-short' }));
    expect(message).toBe(
      'Invalid production configuration: JWT_SECRET must be at least 32 characters',
    );
    expect(message).not.toContain('too-short');
    expectNoSecrets(message);
  });

  it('fails when AUTH_ORIGINS is missing', () => {
    const env = productionEnv();
    delete env.AUTH_ORIGINS;
    expect(messageFrom(env)).toBe('Invalid production configuration: AUTH_ORIGINS is required');
  });

  it('fails when AUTH_ORIGINS is a wildcard or otherwise not an origin', () => {
    expect(messageFrom(productionEnv({ AUTH_ORIGINS: '*' }))).toBe(
      'Invalid production configuration: AUTH_ORIGINS is invalid',
    );
    expect(messageFrom(productionEnv({ AUTH_ORIGINS: 'https://*.example.com' }))).toBe(
      'Invalid production configuration: AUTH_ORIGINS is invalid',
    );
    expect(messageFrom(productionEnv({ AUTH_ORIGINS: 'https://app.example.com/path' }))).toBe(
      'Invalid production configuration: AUTH_ORIGINS is invalid',
    );
    expect(messageFrom(productionEnv({ AUTH_ORIGINS: 'not-an-origin' }))).toBe(
      'Invalid production configuration: AUTH_ORIGINS is invalid',
    );
  });

  it('fails when Requesty is selected without REQUESTY_API_KEY', () => {
    const env = productionEnv();
    delete env.REQUESTY_API_KEY;
    const message = messageFrom(env);
    expect(message).toBe('Invalid production configuration: REQUESTY_API_KEY is required');
    expectNoSecrets(message);
  });

  it('fails when Requesty is selected without REQUESTY_MODEL', () => {
    const env = productionEnv();
    delete env.REQUESTY_MODEL;
    expect(messageFrom(env)).toBe('Invalid production configuration: REQUESTY_MODEL is required');
  });

  it('fails when production Resend configuration is incomplete', () => {
    const missingKey = productionEnv();
    delete missingKey.RESEND_API_KEY;
    expect(messageFrom(missingKey)).toBe(
      'Invalid production configuration: RESEND_API_KEY is required',
    );

    const missingFrom = productionEnv();
    delete missingFrom.EMAIL_FROM;
    expect(messageFrom(missingFrom)).toBe('Invalid production configuration: EMAIL_FROM is required');

    const both = productionEnv();
    delete both.RESEND_API_KEY;
    delete both.EMAIL_FROM;
    const message = messageFrom(both);
    expect(message).toBe(
      'Invalid production configuration: RESEND_API_KEY is required; EMAIL_FROM is required',
    );
    expectNoSecrets(message);
  });

  it('names missing variables and does not include secret values', () => {
    const env = productionEnv({
      JWT_SECRET: 'short-secret',
      DATABASE_URL: `postgresql://postgres:${DATABASE_PASSWORD}@localhost:5432/operations_hub`,
    });
    delete env.RESEND_API_KEY;
    const message = messageFrom(env);
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('RESEND_API_KEY');
    expect(message).not.toContain('short-secret');
    expectNoSecrets(message);
  });

  it('does not require production credentials for test or development', () => {
    expect(() => assertRuntimeConfig({ NODE_ENV: 'test' })).not.toThrow();
    expect(() =>
      assertRuntimeConfig({
        NODE_ENV: 'test',
        AI_PROVIDER: 'mock',
        DATABASE_URL: 'postgresql://postgres:local@localhost:5432/operations_hub_test',
      }),
    ).not.toThrow();
    expect(() => assertRuntimeConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertRuntimeConfig({})).not.toThrow();
  });

  it('rejects an unknown NODE_ENV without reading other variables', () => {
    expect(messageFrom({ NODE_ENV: 'prod', JWT_SECRET: SECRET_JWT })).toBe(
      'Invalid configuration: NODE_ENV must be development, test, or production',
    );
  });
});
