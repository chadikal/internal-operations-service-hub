import { defineConfig, devices } from '@playwright/test';

const { loadTestEnv } = require('./scripts/load-test-env.cjs') as {
  loadTestEnv: () => string;
};
const path = require('path') as { join: (...parts: string[]) => string };

const databaseUrl = loadTestEnv();
const testEmailOutbox = path.join(__dirname, 'test-results', 'email-outbox.jsonl');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: [
    {
      command: 'npm start',
      url: 'http://localhost:3000/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        DIRECT_URL: databaseUrl,
        AI_PROVIDER: 'mock',
        REQUESTY_API_KEY: '',
        RESEND_API_KEY: '',
        EMAIL_FROM: '',
        JWT_SECRET: 'test-only-jwt-secret-not-for-production-use',
        AUTH_ORIGINS: 'http://localhost:5173',
        NODE_ENV: 'test',
        TEST_EMAIL_OUTBOX: testEmailOutbox,
      },
    },
    {
      command: 'npm run dev',
      cwd: 'frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
