import { mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DEVELOPMENT_DATABASE_NAME,
  databaseNameFromUrl,
  isTestDatabase,
} from './database-target';
import { allowedOrigins } from './origin';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EMAIL_NOT_CONFIGURED =
  'Email delivery is not configured. Company signup and invitations cannot run until a mail provider is chosen.';

export type OutboundPurpose = 'email-verification' | 'invitation';

export type OutboundEmail = {
  to: string;
  purpose: OutboundPurpose;
  subject: string;
  text: string;
  token: string;
};

export function appLinkOrigin(): string {
  return allowedOrigins()[0] ?? 'http://localhost:5173';
}

export function shouldLogOutboundEmail(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): boolean {
  if (nodeEnv !== 'development' || !databaseUrl) {
    return false;
  }
  try {
    return databaseNameFromUrl(databaseUrl) === DEVELOPMENT_DATABASE_NAME;
  } catch {
    return false;
  }
}

export function isTestEmailDelivery(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): boolean {
  return nodeEnv === 'test' && isTestDatabase(databaseUrl);
}

export function canDeliverOutboundEmail(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): boolean {
  return shouldLogOutboundEmail(nodeEnv, databaseUrl) || isTestEmailDelivery(nodeEnv, databaseUrl);
}

export function testEmailOutboxPath(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
  configuredPath: string | undefined,
): string | undefined {
  if (!isTestEmailDelivery(nodeEnv, databaseUrl)) {
    return undefined;
  }
  const path = configuredPath?.trim() ?? '';
  return path.length > 0 ? path : undefined;
}

@Injectable()
export class EmailSender {
  private readonly messages: OutboundEmail[] = [];

  assertCanSend(): void {
    if (!canDeliverOutboundEmail(process.env.NODE_ENV, process.env.DATABASE_URL)) {
      throw new ServiceUnavailableException(EMAIL_NOT_CONFIGURED);
    }
  }

  async send(message: OutboundEmail): Promise<void> {
    this.assertCanSend();
    this.messages.push(message);
    if (shouldLogOutboundEmail(process.env.NODE_ENV, process.env.DATABASE_URL)) {
      console.log(`Email queued for ${message.to}: ${message.subject}`);
      console.log(message.text);
    }
    const outboxPath = testEmailOutboxPath(
      process.env.NODE_ENV,
      process.env.DATABASE_URL,
      process.env.TEST_EMAIL_OUTBOX,
    );
    if (outboxPath) {
      await mkdir(dirname(outboxPath), { recursive: true });
      await appendFile(
        outboxPath,
        `${JSON.stringify({
          to: message.to,
          purpose: message.purpose,
          subject: message.subject,
          token: message.token,
        })}\n`,
      );
    }
  }

  list(): OutboundEmail[] {
    return this.messages.map((message) => ({ ...message }));
  }
}
