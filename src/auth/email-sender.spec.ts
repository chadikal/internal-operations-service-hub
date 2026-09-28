import { existsSync } from 'fs';
import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { EmailSender } from './email-sender';

const DEVELOPMENT_URL = 'postgresql://postgres:secret@localhost:5432/operations_hub';
const OTHER_URL = 'postgresql://postgres:secret@localhost:5432/operations_hub_test';

function captureLogs(): { lines: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return {
    lines: () => lines.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

describe('development mail outbox', () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    outbox: process.env.TEST_EMAIL_OUTBOX,
  };

  afterEach(() => {
    process.env.NODE_ENV = previous.nodeEnv;
    process.env.DATABASE_URL = previous.databaseUrl;
    if (previous.outbox === undefined) {
      delete process.env.TEST_EMAIL_OUTBOX;
    } else {
      process.env.TEST_EMAIL_OUTBOX = previous.outbox;
    }
  });

  it('prints verification and invitation links only for the development database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eurisko-dev-mail-'));
    const outboxFile = join(directory, 'outbox.jsonl');
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = DEVELOPMENT_URL;
    process.env.TEST_EMAIL_OUTBOX = outboxFile;
    const logs = captureLogs();
    const sender = new EmailSender();
    try {
      await sender.send({
        to: 'founder@example.test',
        purpose: 'email-verification',
        subject: 'Verify your email',
        text: 'Verify your email to activate Example: http://localhost:5173/?verify=verify-token-value',
        token: 'verify-token-value',
      });
      await sender.send({
        to: 'invitee@example.test',
        purpose: 'invitation',
        subject: 'You are invited',
        text: 'Accept your invitation to Example: http://localhost:5173/?invite=invite-token-value',
        token: 'invite-token-value',
      });
      await sender.send({
        to: 'founder@example.test',
        purpose: 'password-reset',
        subject: 'Reset your password',
        text: 'Reset your password: http://localhost:5173/?reset=reset-token-value',
        token: 'reset-token-value',
      });
      const printed = logs.lines();
      expect(printed).toContain('Development mail outbox for founder@example.test');
      expect(printed).toContain('http://localhost:5173/?verify=verify-token-value');
      expect(printed).toContain('Development mail outbox for invitee@example.test');
      expect(printed).toContain('http://localhost:5173/?invite=invite-token-value');
      expect(printed).toContain('http://localhost:5173/?reset=reset-token-value');
      expect(sender.list()).toHaveLength(3);
      expect(existsSync(outboxFile)).toBe(false);
    } finally {
      logs.restore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns 503 and does not log tokens for production or any other database', async () => {
    const cases = [
      { nodeEnv: 'production', databaseUrl: DEVELOPMENT_URL },
      { nodeEnv: 'development', databaseUrl: OTHER_URL },
      { nodeEnv: 'test', databaseUrl: DEVELOPMENT_URL },
    ];
    for (const item of cases) {
      process.env.NODE_ENV = item.nodeEnv;
      process.env.DATABASE_URL = item.databaseUrl;
      const logs = captureLogs();
      const sender = new EmailSender();
      try {
        await expect(
          sender.send({
            to: 'founder@example.test',
            purpose: 'email-verification',
            subject: 'Verify your email',
            text: 'http://localhost:5173/?verify=hidden-verify-token',
            token: 'hidden-verify-token',
          }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        await expect(
          sender.send({
            to: 'invitee@example.test',
            purpose: 'invitation',
            subject: 'You are invited',
            text: 'http://localhost:5173/?invite=hidden-invite-token',
            token: 'hidden-invite-token',
          }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        const printed = logs.lines();
        expect(printed).not.toContain('hidden-verify-token');
        expect(printed).not.toContain('hidden-invite-token');
        expect(printed).not.toContain('Development mail outbox');
        expect(sender.list()).toHaveLength(0);
      } finally {
        logs.restore();
      }
    }
  });
});
