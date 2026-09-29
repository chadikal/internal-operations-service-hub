import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { removeSignupCompanies, TEST_PASSWORD } from './db';
import { completeWorkspaceSetup } from './login';

const EMAIL_OUTBOX = join(process.cwd(), 'test-results', 'email-outbox.jsonl');
const NEW_PASSWORD = 'replacement-password-not-for-production-12';

test.describe('Password reset', () => {
  test.beforeEach(async () => {
    await removeSignupCompanies();
  });

  test.afterEach(async () => {
    await removeSignupCompanies();
  });

  test('sends a generic acknowledgement and replaces the password', async ({ page }) => {
    const stamp = Date.now();
    const email = `reset.${stamp}@operations-hub.test`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Reset Co ${stamp}`);
    await page.getByLabel('Your name').fill('Rae Reset');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await completeWorkspaceSetup(page);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const verification = await outboxMessage(email, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill('missing.person@operations-hub.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText('If an account exists for that email, a reset link has been sent.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to log in' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Rae Reset');

    const requested = await page.evaluate(async (address) => {
      const response = await fetch('http://localhost:3000/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address }),
      });
      return response.json() as Promise<{ message: string }>;
    }, email);
    expect(requested.message).toBe('If an account exists for that email, a reset link has been sent.');

    const reset = await outboxMessage(email, 'password-reset');
    await page.goto(`/?reset=${reset.token}`);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await expect(page.getByText("Passwords don't match.")).toHaveCount(0);
    await page.getByLabel('Confirm password').fill('different-password-value');
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update password' })).toBeDisabled();
    await page.getByLabel('New password').fill(`${NEW_PASSWORD}x`);
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await expect(page.getByText("Passwords don't match.")).toHaveCount(0);
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Password updated');

    const sessionCheck = page.waitForResponse((response) => response.url().includes('/auth/me'));
    await page.goto('/');
    await sessionCheck;
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.getByTestId('signed-in-name')).toHaveCount(0);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page.getByRole('alert')).not.toContainText('401');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Rae Reset');
  });
});

async function outboxMessage(email: string, purpose: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (existsSync(EMAIL_OUTBOX)) {
      const messages = readFileSync(EMAIL_OUTBOX, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { to: string; purpose: string; token: string });
      const match = [...messages].reverse().find((item) => item.to === email && item.purpose === purpose);
      if (match) {
        return match;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No ${purpose} message for ${email}`);
}
