import { ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import { invitationEmail, passwordResetEmail, verificationEmail } from './email-content';
import type { OutboundEmail } from './email-sender';
import { EMAIL_DELIVERY_FAILED, ResendEmailProvider } from './resend-email.provider';

const SECRET = 're_test_secret_value';
const FROM = 'Internal Operations Service Hub <onboarding@resend.dev>';

jest.mock('resend', () => {
  const send = jest.fn();
  return {
    Resend: jest.fn().mockImplementation(() => ({
      emails: { send },
    })),
  };
});

function sdkSend(): jest.Mock {
  return new Resend('unused').emails.send as unknown as jest.Mock;
}

function message(partial: Pick<OutboundEmail, 'to' | 'purpose' | 'subject' | 'text' | 'html' | 'token'>): OutboundEmail {
  return partial;
}

describe('Resend email provider', () => {
  const previous = {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
  };
  const provider = new ResendEmailProvider();

  beforeEach(() => {
    sdkSend().mockReset();
    (Resend as unknown as jest.Mock).mockClear();
    process.env.RESEND_API_KEY = SECRET;
    process.env.EMAIL_FROM = FROM;
  });

  afterEach(() => {
    if (previous.apiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = previous.apiKey;
    }
    if (previous.from === undefined) {
      delete process.env.EMAIL_FROM;
    } else {
      process.env.EMAIL_FROM = previous.from;
    }
  });

  it.each([
    {
      purpose: 'email-verification' as const,
      content: verificationEmail({
        companyName: 'Northwind',
        verifyUrl: 'http://localhost:5173/?verify=verify-token-value',
      }),
      token: 'verify-token-value',
    },
    {
      purpose: 'password-reset' as const,
      content: passwordResetEmail({
        resetUrl: 'http://localhost:5173/?reset=reset-token-value',
      }),
      token: 'reset-token-value',
    },
    {
      purpose: 'invitation' as const,
      content: invitationEmail({
        companyName: 'Northwind',
        inviteUrl: 'http://localhost:5173/?invite=invite-token-value',
      }),
      token: 'invite-token-value',
    },
  ])('sends $purpose with the configured sender and workflow link', async ({ purpose, content, token }) => {
    sdkSend().mockResolvedValue({ data: { id: 'email_123' }, error: null, headers: null });
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const errors: string[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      await provider.send(
        message({
          to: 'person@example.test',
          purpose,
          subject: content.subject,
          text: content.text,
          html: content.html,
          token,
        }),
      );
      expect(sdkSend()).toHaveBeenCalledWith({
        from: FROM,
        to: ['person@example.test'],
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      const payload = JSON.stringify(sdkSend().mock.calls[0][0]);
      expect(payload).toContain(token);
      expect(payload).not.toContain(SECRET);
      expect(logs.join('\n')).not.toContain(token);
      expect(logs.join('\n')).not.toContain(SECRET);
      expect(errors.join('\n')).not.toContain(token);
      expect(errors.join('\n')).not.toContain(SECRET);
      const constructedWith = (Resend as unknown as jest.Mock).mock.calls.map((call: unknown[]) => call[0]);
      expect(constructedWith).toContain(SECRET);
    } finally {
      spy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('reports provider errors without the API key or token', async () => {
    sdkSend().mockResolvedValue({
      data: null,
      error: {
        name: 'invalid_api_key',
        statusCode: 401,
        message: `rejected ${SECRET} for ?reset=reset-token-value`,
      },
      headers: null,
    });
    const errors: string[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      await expect(
        provider.send(
          message({
            to: 'person@example.test',
            purpose: 'password-reset',
            subject: 'Reset your password',
            text: 'http://localhost:5173/?reset=reset-token-value',
            html: '<a href="http://localhost:5173/?reset=reset-token-value">Reset</a>',
            token: 'reset-token-value',
          }),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      try {
        await provider.send(
          message({
            to: 'person@example.test',
            purpose: 'password-reset',
            subject: 'Reset your password',
            text: 'http://localhost:5173/?reset=reset-token-value',
            token: 'reset-token-value',
          }),
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).message).toBe(EMAIL_DELIVERY_FAILED);
        expect((error as ServiceUnavailableException).message).not.toContain(SECRET);
        expect((error as ServiceUnavailableException).message).not.toContain('reset-token-value');
      }
      const printed = errors.join('\n');
      expect(printed).toContain('purpose=password-reset');
      expect(printed).toContain('provider=resend');
      expect(printed).toContain('code=401');
      expect(printed).toContain('[redacted]');
      expect(printed).not.toContain(SECRET);
      expect(printed).not.toContain('reset-token-value');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('treats a thrown provider failure as an undelivered email', async () => {
    sdkSend().mockRejectedValue(new Error(`socket closed ${SECRET}`));
    const errors: string[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      await expect(
        provider.send(
          message({
            to: 'person@example.test',
            purpose: 'invitation',
            subject: "You're invited to Internal Operations Service Hub",
            text: 'http://localhost:5173/?invite=invite-token-value',
            token: 'invite-token-value',
          }),
        ),
      ).rejects.toMatchObject({ message: EMAIL_DELIVERY_FAILED });
      expect(errors.join('\n')).not.toContain(SECRET);
      expect(errors.join('\n')).not.toContain('invite-token-value');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
