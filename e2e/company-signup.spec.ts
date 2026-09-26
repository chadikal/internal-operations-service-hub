import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { removeSignupCompanies, TEST_PASSWORD } from './db';

const EMAIL_OUTBOX = join(process.cwd(), 'test-results', 'email-outbox.jsonl');

test.describe('Company signup', () => {
  test.beforeEach(async () => {
    await removeSignupCompanies();
  });

  test.afterEach(async () => {
    await removeSignupCompanies();
  });

  test('a founder verifies email and an invitee sets a password', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `founder.${stamp}@operations-hub.test`;
    const staffEmail = `staff.${stamp}@operations-hub.test`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create a company workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Create a company workspace' })).toBeVisible();
    await expect(page.getByText(/working alone/i)).toHaveCount(0);
    await page.getByLabel('Company name').fill(`Northwind ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Founder');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Founder');
    await expect(page.getByRole('navigation', { name: 'Super Admin' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByTestId('department-list')).toContainText('IT');
    await expect(page.getByTestId('department-list')).toContainText('HR');
    await expect(page.getByTestId('department-list')).toContainText('Finance');
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await expect(page.getByTestId('department-list')).toContainText('People Ops');

    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Employees' }).click();
    await page.getByLabel('Staff name').fill('Sam Staff');
    await page.getByLabel('Staff email').fill(staffEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'People Ops' });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();

    const invitation = await outboxMessage(staffEmail, 'invitation');
    await page.goto(`/?invite=${invitation.token}`);
    await page.getByLabel('New password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await page.getByLabel('Email').fill(staffEmail);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Sam Staff');
    await expect(page.getByRole('heading', { name: 'Invite staff' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create a company workspace' })).toHaveCount(0);
  });
});

async function outboxMessage(email: string, purpose: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (existsSync(EMAIL_OUTBOX)) {
      const messages = readFileSync(EMAIL_OUTBOX, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { to: string; purpose: string; token: string });
      const message = [...messages].reverse().find((item) => item.to === email && item.purpose === purpose);
      if (message?.token) {
        return message;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No ${purpose} message for ${email}`);
}
