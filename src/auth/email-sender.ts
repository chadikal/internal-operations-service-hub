import { mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import {
  DEVELOPMENT_DATABASE_NAME,
  databaseNameFromUrl,
  isTestDatabase,
} from './database-target';
import { allowedOrigins } from './origin';
import { ResendEmailProvider } from './resend-email.provider';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const EMAIL_NOT_CONFIGURED =
  'Email delivery is not configured. Company signup, invitations, and password reset cannot run until a mail provider is chosen.';

export type OutboundPurpose = 'email-verification' | 'invitation' | 'password-reset';

export type OutboundEmail = {
  to: string;
  purpose: OutboundPurpose;
  subject: string;
  text: string;
  html?: string;
  token: string;
};

export interface OutboundEmailTransport {
  send(message: OutboundEmail): Promise<void>;
}

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

export function resendConfig(): { apiKey: string; from: string } | undefined {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  const from = process.env.EMAIL_FROM?.trim() ?? '';
  if (!apiKey || !from) {
    return undefined;
  }
  return { apiKey, from };
}

export function canUseResend(nodeEnv: string | undefined, databaseUrl: string | undefined): boolean {
  if (nodeEnv === 'test' || isTestDatabase(databaseUrl)) {
    return false;
  }
  return resendConfig() !== undefined;
}

export function canDeliverOutboundEmail(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): boolean {
  return (
    isTestEmailDelivery(nodeEnv, databaseUrl) ||
    canUseResend(nodeEnv, databaseUrl) ||
    shouldLogOutboundEmail(nodeEnv, databaseUrl)
  );
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
  private readonly transport: OutboundEmailTransport;

  constructor(
    @Optional() @Inject(ResendEmailProvider) transport?: OutboundEmailTransport,
  ) {
    this.transport = transport ?? new ResendEmailProvider();
  }

  assertCanSend(): void {
    if (!canDeliverOutboundEmail(process.env.NODE_ENV, process.env.DATABASE_URL)) {
      throw new ServiceUnavailableException(EMAIL_NOT_CONFIGURED);
    }
  }

  async send(message: OutboundEmail): Promise<void> {
    this.assertCanSend();
    const nodeEnv = process.env.NODE_ENV;
    const databaseUrl = process.env.DATABASE_URL;
    if (isTestEmailDelivery(nodeEnv, databaseUrl)) {
      this.messages.push(message);
      await this.writeTestOutbox(message);
      return;
    }
    if (canUseResend(nodeEnv, databaseUrl)) {
      await this.transport.send(message);
      console.log(`Email accepted purpose=${message.purpose} provider=resend`);
      return;
    }
    if (!shouldLogOutboundEmail(nodeEnv, databaseUrl)) {
      throw new ServiceUnavailableException(EMAIL_NOT_CONFIGURED);
    }
    this.messages.push(message);
    console.log(
      `Development mail outbox for ${message.to}: ${message.subject}`,
    );
    console.log(message.text);
  }

  private async writeTestOutbox(message: OutboundEmail): Promise<void> {
    const outboxPath = testEmailOutboxPath(
      process.env.NODE_ENV,
      process.env.DATABASE_URL,
      process.env.TEST_EMAIL_OUTBOX,
    );
    if (!outboxPath) {
      return;
    }
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

  list(): OutboundEmail[] {
    return this.messages.map((message) => ({ ...message }));
  }
}
