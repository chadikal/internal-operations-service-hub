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
    await expect(page.getByText("Passwords don't match.")).toHaveCount(0);
    await page.getByLabel('Confirm password').fill('different-password-value');
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activate account' })).toBeDisabled();
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await expect(page.getByText("Passwords don't match.")).toHaveCount(0);
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
    await expect(page.getByText('Invitations will be sent after you verify your workspace.')).toBeVisible();
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
    await expect(page.getByText('Staff invitations sent.')).toBeVisible();
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

  test('step 1 shows inline password errors and rejects an email that is already in use', async ({ page }) => {
    const stamp = Date.now();
    const usedEmail = `used.${stamp}@operations-hub.test`;
    const freshEmail = `fresh.${stamp}@operations-hub.test`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Used Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Founder');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Email').blur();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await page.getByLabel('Email').fill(usedEmail);
    await page.getByLabel('Email').blur();
    await expect(page.getByText('Enter a valid email address.')).toHaveCount(0);
    await page.getByLabel('Password', { exact: true }).fill('short-pass');
    await expect(page.getByText('Password must be at least 12 characters.')).toBeVisible();
    await expect(page.getByText("Passwords don't match.")).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await expect(page.getByText('Password must be at least 12 characters.')).toHaveCount(0);
    await page.getByLabel('Confirm password').fill('x');
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await expect(page.getByText("Passwords don't match.")).toHaveCount(0);
    await page.getByLabel('Password', { exact: true }).fill(`${TEST_PASSWORD}x`);
    await expect(page.getByText("Passwords don't match.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await expect(page.getByText("Passwords don't match.")).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
    await completeWorkspaceSetup(page);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to log in' }).click();
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Second Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Founder');
    await page.getByLabel('Email').fill(usedEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Company Information' })).toBeVisible();
    await expect(page.getByText('This email is already in use.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

    await page.getByLabel('Email').fill(freshEmail);
    await expect(page.getByText('This email is already in use.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Set Up Departments' })).toBeVisible();
    const raced = await page.evaluate(async (address) => {
      const response = await fetch('http://localhost:3000/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: 'Race Co',
          name: 'Race Founder',
          email: address,
          password: 'founder-password-not-for-production',
        }),
      });
      return response.status;
    }, freshEmail);
    expect(raced).toBe(201);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Company Information' })).toBeVisible();
    await expect(page.getByText('This email is already in use.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
  });

  test('prepared invitations report partial and total failure and stay retryable without duplicates', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `invite.feedback.${stamp}@operations-hub.test`;
    const sentEmail = `sent.${stamp}@operations-hub.test`;
    const failedEmail = `failed.${stamp}@operations-hub.test`;
    const manualEmail = `manual.${stamp}@operations-hub.test`;
    let failEmails = new Set<string>();

    await page.route('**/auth/invitations', async (route) => {
      const body = route.request().postDataJSON() as { email?: string };
      if (body.email && failEmails.has(body.email.toLowerCase())) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Email could not be sent. Try again later.' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Invite Feedback ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Founder');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await addPreparedStaff(page, 'Sent Person', sentEmail, 'IT');
    await addPreparedStaff(page, 'Failed Person', failedEmail, 'HR');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    failEmails = new Set([failedEmail]);
    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Some staff invitations could not be sent. You can retry them from Staff.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('cell', { name: 'Sent Person', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Failed Person', exact: true })).toHaveCount(0);

    failEmails = new Set();
    await page.reload();
    await expect(page.getByText('Staff invitations sent.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Dashboard' }).click();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('cell', { name: 'Failed Person', exact: true })).toHaveCount(1);
    await expect(page.getByRole('cell', { name: 'Sent Person', exact: true })).toHaveCount(1);
    await expect.poll(() => countOutbox(failedEmail, 'invitation')).toBe(1);
    await page.reload();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Dashboard' }).click();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('cell', { name: 'Failed Person', exact: true })).toHaveCount(1);
    await expect.poll(() => countOutbox(failedEmail, 'invitation')).toBe(1);

    failEmails = new Set([manualEmail]);
    await page.getByRole('button', { name: 'Invite Staff' }).click();
    await page.getByLabel('Staff name').fill('Manual Person');
    await page.getByLabel('Staff email').fill(manualEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'Finance' });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('alert')).toContainText('Email could not be sent. Try again later.');
    await expect(page.getByText('Invitation sent.')).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Manual Person', exact: true })).toHaveCount(0);
  });

  test('a total prepared-invitation failure stays on the dashboard and can be retried', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `invite.none.${stamp}@operations-hub.test`;
    const staffEmail = `none.${stamp}@operations-hub.test`;
    let failInvites = false;

    await page.route('**/auth/invitations', async (route) => {
      if (failInvites) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Email could not be sent. Try again later.' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Invite None ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Founder');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await addPreparedStaff(page, 'Nobody Sent', staffEmail, 'Finance');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    failInvites = true;
    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Staff invitations could not be sent. You can retry them from Staff.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('cell', { name: 'Nobody Sent', exact: true })).toHaveCount(0);

    failInvites = false;
    await page.reload();
    await expect(page.getByText('Staff invitations sent.')).toBeVisible();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Dashboard' }).click();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('cell', { name: 'Nobody Sent', exact: true })).toHaveCount(1);
    await expect.poll(() => countOutbox(staffEmail, 'invitation')).toBe(1);
    await page.reload();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Dashboard' }).click();
    await page.getByRole('navigation', { name: 'Super Admin' }).getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('cell', { name: 'Nobody Sent', exact: true })).toHaveCount(1);
    await expect.poll(() => countOutbox(staffEmail, 'invitation')).toBe(1);
  });
});

async function addPreparedStaff(page: import('@playwright/test').Page, name: string, email: string, department: string) {
  await page.getByRole('button', { name: 'Add staff' }).click();
  const block = page.locator('.wizard-block').last();
  await block.getByLabel('Staff name').fill(name);
  await block.getByLabel('Staff email').fill(email);
  await block.getByLabel('Staff department').selectOption({ label: department });
}

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
