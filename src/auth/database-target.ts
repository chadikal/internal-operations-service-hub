export const DEVELOPMENT_DATABASE_NAME = 'operations_hub';
export const TEST_DATABASE_NAME = 'operations_hub_test';

export function databaseNameFromUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  return decodeURIComponent(parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, ''));
}

export function assertDevelopmentCredentialTarget(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): void {
  if (nodeEnv !== 'development') {
    throw new Error(
      'Refusing to set credentials. NODE_ENV must be exactly "development". This command is not for tests or production.',
    );
  }
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  const name = databaseNameFromUrl(databaseUrl);
  if (name !== DEVELOPMENT_DATABASE_NAME) {
    throw new Error(
      `Refusing to set credentials. DATABASE_URL must use the database "${DEVELOPMENT_DATABASE_NAME}", but it points at "${name}".`,
    );
  }
}

export function isTestDatabase(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) {
    return false;
  }
  try {
    return databaseNameFromUrl(databaseUrl) === TEST_DATABASE_NAME;
  } catch {
    return false;
  }
}

export function assertTestDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  const name = databaseNameFromUrl(databaseUrl);
  if (name !== TEST_DATABASE_NAME) {
    throw new Error(
      `Test fixtures can only write credentials to "${TEST_DATABASE_NAME}", but DATABASE_URL points at "${name}".`,
    );
  }
}
