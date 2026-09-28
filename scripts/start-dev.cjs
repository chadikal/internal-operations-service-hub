'use strict';

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const nestBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '@nestjs',
  'cli',
  'bin',
  'nest.js',
);

if (!existsSync(nestBin)) {
  console.error('Nest CLI was not found. Run npm install.');
  process.exit(1);
}

const child = spawn(process.execPath, [nestBin, 'start', '--watch'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
