import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { removeSignupCompanies, TEST_PASSWORD } from './db';
import { completeWorkspaceSetup } from './login';

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
    await expect(page.getByRole('button', { name: 'Create one' })).toBeVisible();
    await page.getByRole('button', { name: 'Create one' }).click();
    await expect(page.getByRole('heading', { name: 'Company Information' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByLabel('Company name').fill(`Northwind ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Founder');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill('short');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await expect(page.getByRole('list', { name: 'Setup progress' }).getByRole('listitem').nth(0)).toHaveAttribute(
      'aria-current',
      'step',
    );
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Set Up Departments' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Setup progress' }).getByRole('listitem').nth(1)).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByTestId('workspace-wizard')).toContainText('IT');
    await expect(page.getByTestId('workspace-wizard')).toContainText('HR');
    await expect(page.getByTestId('workspace-wizard')).toContainText('Finance');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Company name')).toHaveValue(`Northwind ${stamp}`);
    await completeWorkspaceSetup(page);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Founder');
    await expect(page.getByRole('navigation', { name: 'Super Admin' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByTestId('department-list')).toContainText('IT');
    await expect(page.getByTestId('department-list')).toContainText('HR');
    await expect(page.getByTestId('department-list')).toContainText('Finance');
    await page.getByRole('button', { name: 'Add department' }).click();
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByTestId('form-overlay').getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await expect(page.getByTestId('department-list')).toContainText('People Ops');

    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await page.getByRole('button', { name: 'Invite Staff' }).click();
    await page.getByLabel('Staff name').fill('Sam Staff');
    await page.getByLabel('Staff email').fill(staffEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'People Ops' });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();

    const invitation = await outboxMessage(staffEmail, 'invitation');
    await page.goto(`/?invite=${invitation.token}`);
    await page.getByLabel('New password').fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill('different-password-value');
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByRole('alert')).toContainText('must match');
    await expect(page.getByRole('alert')).not.toContainText(/\b\d{3}\b/);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await page.getByLabel('Email').fill(staffEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Sam Staff');
    await expect(page.getByRole('heading', { name: 'Invite staff' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create one' })).toHaveCount(0);
  });

  test('the wizard keeps confirmed departments and invites a department admin after sign-in', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `wizard.${stamp}@operations-hub.test`;
    const adminEmail = `desk.admin.${stamp}@operations-hub.test`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Wizard Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Wizard');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Remove department HR' }).click();
    await page.getByRole('button', { name: 'Add department' }).click();
    await page.getByLabel('Department name new').fill('People Ops');
    await page.getByLabel('Use template for People Ops').selectOption({ label: 'IT' });
    await expect(page.getByLabel('Approval policy for Access in People Ops')).toHaveValue('DEPARTMENT_ADMIN');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Add staff' }).click();
    await page.getByLabel('Staff name').fill('Quinn Admin');
    await page.getByLabel('Staff email').fill(adminEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'People Ops' });
    await page.getByLabel('Staff role').selectOption({ label: 'Department Admin' });
    await expect(page.getByLabel('Handler access')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Department name People Ops')).toHaveValue('People Ops');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByLabel('Staff email')).toHaveValue(adminEmail);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    expect(countOutbox(adminEmail, 'invitation')).toBe(0);

    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Wizard');
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByTestId('department-list')).toContainText('IT');
    await expect(page.getByTestId('department-list')).toContainText('Finance');
    await expect(page.getByTestId('department-list')).toContainText('People Ops');
    await expect(page.getByTestId('department-list')).not.toContainText('HR');
    await expect(page.getByTestId('department-detail')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit People Ops' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit department' })).toBeVisible();
    await expect(page.getByTestId('request-types-for-People Ops')).toContainText('Hardware');
    await expect(page.getByTestId('request-types-for-People Ops')).toContainText('Access');
    await page.getByRole('dialog', { name: 'Edit department' }).getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('cell', { name: 'Quinn Admin', exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: 'Quinn Admin', exact: true }),
    });
    await expect(row).toContainText('Department Admin');
    await expect(row).toContainText('Yes');
    await expect.poll(() => countOutbox(adminEmail, 'invitation')).toBe(1);
  });
});

function countOutbox(email: string, purpose: string) {
  if (!existsSync(EMAIL_OUTBOX)) return 0;
  return readFileSync(EMAIL_OUTBOX, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { to: string; purpose: string })
    .filter((item) => item.to === email && item.purpose === purpose).length;
}

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
