import { defineConfig, devices } from '@playwright/test';

const { loadTestEnv } = require('./scripts/load-test-env.cjs') as {
  loadTestEnv: () => string;
};

const databaseUrl = loadTestEnv();

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
      url: 'http://localhost:3000/employees',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
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
