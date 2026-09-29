import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import { currentRequestId } from '../logging/request-context';
import { EMAIL_NOT_CONFIGURED, type OutboundEmail, type OutboundPurpose } from './email-sender';

export const EMAIL_DELIVERY_FAILED = 'Email could not be sent. Try again later.';

export function safeProviderDetail(error: unknown, apiKey: string): string {
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const code = record.statusCode ?? record.name ?? 'error';
  let message =
    typeof record.message === 'string'
      ? record.message
      : error instanceof Error
        ? error.message
        : 'Email provider request failed';
  if (apiKey) {
    message = message.split(apiKey).join('[redacted]');
  }
  message = message
    .replace(/re_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/(verify|invite|reset)=([^&\s"']+)/gi, '$1=[redacted]');
  if (message.length > 180) {
    message = `${message.slice(0, 180)}…`;
  }
  return `code=${String(code)} message=${message}`;
}

@Injectable()
export class ResendEmailProvider {
  async send(message: OutboundEmail): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
    const from = process.env.EMAIL_FROM?.trim() ?? '';
    if (!apiKey || !from) {
      throw new ServiceUnavailableException(EMAIL_NOT_CONFIGURED);
    }
    const resend = new Resend(apiKey);
    let error: unknown;
    try {
      const result = await resend.emails.send({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html ?? `<p>${message.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
      });
      error = result.error;
    } catch (caught) {
      error = caught;
    }
    if (error) {
      this.fail(message.purpose, error, apiKey);
    }
  }

  private fail(purpose: OutboundPurpose, error: unknown, apiKey: string): never {
    console.error(
      `Resend email send failed purpose=${purpose} provider=resend requestId=${currentRequestId()} ${safeProviderDetail(error, apiKey)}`,
    );
    throw new ServiceUnavailableException(EMAIL_DELIVERY_FAILED);
  }
}
