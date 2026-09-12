'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { loadTestEnv } = require('./load-test-env.cjs');

const root = path.resolve(__dirname, '..');
const databaseUrl = loadTestEnv();

function runPrisma(command) {
  const result = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

runPrisma('npx prisma migrate deploy');
runPrisma('npx prisma db seed');
