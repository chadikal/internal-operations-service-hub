'use strict';

const fs = require('fs');
const path = require('path');
const { config } = require('dotenv');

const TEST_DATABASE_NAME = 'operations_hub_test';
const envPath = path.resolve(__dirname, '..', '.env.test');

function fail(message) {
  throw new Error(message);
}

function parseDatabaseName(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail(
      'DATABASE_URL in .env.test is not a valid URL. If the password contains #, @, or %, URL-encode those characters.',
    );
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    fail('DATABASE_URL in .env.test must be a postgresql:// URL.');
  }

  const databaseName = decodeURIComponent(
    parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, ''),
  );

  return databaseName;
}

function loadTestEnv() {
  if (!fs.existsSync(envPath)) {
    fail(
      '.env.test was not found. Copy .env.test.example to .env.test and set DATABASE_URL to the operations_hub_test database. Automated tests will not fall back to .env or the development database.',
    );
  }

  const result = config({ path: envPath, override: true });
  if (result.error) {
    fail(
      `Could not load .env.test: ${result.error.message}. Copy .env.test.example to .env.test and set DATABASE_URL to the operations_hub_test database. Automated tests will not fall back to .env or the development database.`,
    );
  }

  const databaseUrl = result.parsed && result.parsed.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim() === '') {
    fail(
      '.env.test must contain DATABASE_URL pointing at operations_hub_test. Automated tests will not inherit DATABASE_URL from the environment or from .env.',
    );
  }

  const databaseName = parseDatabaseName(databaseUrl);
  if (databaseName !== TEST_DATABASE_NAME) {
    fail(
      `Automated tests are not allowed to use the development database. DATABASE_URL in .env.test must use the exact database name "${TEST_DATABASE_NAME}", but it points at "${databaseName || '(none)'}".`,
    );
  }

  process.env.DATABASE_URL = databaseUrl;
  process.env.AI_PROVIDER = 'mock';
  delete process.env.REQUESTY_API_KEY;
  return databaseUrl;
}

loadTestEnv();

module.exports = {
  TEST_DATABASE_NAME,
  loadTestEnv,
};
