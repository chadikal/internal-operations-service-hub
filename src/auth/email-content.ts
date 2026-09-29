export const PRODUCT_NAME = 'Internal Operations Service Hub';

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function transactionalEmail(input: {
  subject: string;
  paragraphs: string[];
  actionLabel: string;
  url: string;
  expiry: string;
}): EmailContent {
  const text = [
    ...input.paragraphs,
    `${input.actionLabel}: ${input.url}`,
    'If the link does not open, copy it into your browser.',
    input.expiry,
  ].join('\n\n');
  const body = input.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
  const href = escapeHtml(input.url);
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.5">${body}<p><a href="${href}" style="display:inline-block;background:#1f4b99;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px">${escapeHtml(input.actionLabel)}</a></p><p>If the button does not work, copy this link into your browser:<br><a href="${href}">${href}</a></p><p>${escapeHtml(input.expiry)}</p></body></html>`;
  return { subject: input.subject, text, html };
}

export function verificationEmail(input: { companyName: string; verifyUrl: string }): EmailContent {
  return transactionalEmail({
    subject: 'Verify your workspace',
    paragraphs: [
      `Verify your email to activate ${input.companyName} on ${PRODUCT_NAME}.`,
    ],
    actionLabel: 'Verify your workspace',
    url: input.verifyUrl,
    expiry: 'This link expires in 24 hours and can be used once.',
  });
}

export function passwordResetEmail(input: { resetUrl: string }): EmailContent {
  return transactionalEmail({
    subject: 'Reset your password',
    paragraphs: [`Reset the password for your ${PRODUCT_NAME} account.`],
    actionLabel: 'Reset your password',
    url: input.resetUrl,
    expiry: 'This link expires in one hour and can be used once.',
  });
}

export function invitationEmail(input: { companyName: string; inviteUrl: string }): EmailContent {
  return transactionalEmail({
    subject: `You're invited to ${PRODUCT_NAME}`,
    paragraphs: [
      `${input.companyName} invited you to ${PRODUCT_NAME}.`,
      'Accept the invitation and choose your own password.',
    ],
    actionLabel: 'Accept invitation',
    url: input.inviteUrl,
    expiry: 'This link expires in 7 days and can be used once.',
  });
}
