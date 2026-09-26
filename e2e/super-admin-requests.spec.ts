import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, test, Page } from '@playwright/test';
import { ensureTestLogins, removeSignupCompanies, TEST_PASSWORD } from './db';
import { login } from './login';

const EMAIL_OUTBOX = join(process.cwd(), 'test-results', 'email-outbox.jsonl');

test.describe('Super Admin requests', () => {
  test.beforeEach(async () => {
    await ensureTestLogins();
    await removeSignupCompanies();
  });

  test.afterEach(async () => {
    await removeSignupCompanies();
  });

  test('Dashboard cards open a filtered company list and Super Admin can inspect own details', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `ada.requests.${stamp}@operations-hub.test`;
    const staffEmail = `sam.requests.${stamp}@operations-hub.test`;
    const adaTitle = `Ada laptop ${stamp}`;
    const samTitle = `Sam certificate ${stamp}`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create a company workspace' }).click();
    await page.getByLabel('Company name').fill(`Request Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Requests');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Requests');

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await nav.getByRole('link', { name: 'Departments' }).click();
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await addRequestType(page, 'People Ops', 'General');

    await nav.getByRole('link', { name: 'Employees' }).click();
    await page.getByLabel('Staff name').fill('Sam Handler');
    await page.getByLabel('Staff email').fill(staffEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'People Ops' });
    await page.getByLabel('Can handle requests').check();
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    await nav.getByRole('link', { name: 'Requests' }).click();
    const createCard = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await createCard.getByLabel('Department').selectOption({ label: 'People Ops' });
    await createCard.getByLabel('Request type').selectOption({ label: 'General' });
    await createCard.getByLabel('Title').fill(adaTitle);
    await createCard.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('request-id')).toBeVisible();
    const adaRequestId = (await page.getByTestId('request-id').innerText()).replace('#', '').trim();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    const invitation = await outboxMessage(staffEmail, 'invitation');
    await page.goto(`/?invite=${invitation.token}`);
    await page.getByLabel('New password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await login(page, staffEmail);

    await page.getByLabel('Request ID').fill(adaRequestId);
    await page.getByRole('button', { name: 'Load Request' }).click();
    await page.getByRole('button', { name: 'Claim' }).click();
    await page.getByRole('button', { name: 'Start Request' }).click();
    await expect(page.getByTestId('request-status')).toHaveText('IN PROGRESS');

    const staffCreate = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await staffCreate.getByLabel('Department').selectOption({ label: 'People Ops' });
    await staffCreate.getByLabel('Request type').selectOption({ label: 'General' });
    await staffCreate.getByLabel('Title').fill(samTitle);
    await staffCreate.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByText(samTitle)).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await login(page, founderEmail);
    await expect(page.getByTestId('count-requests')).toHaveText('2');
    await expect(page.getByTestId('count-submitted')).toHaveText('1');
    await expect(page.getByTestId('count-inProgress')).toHaveText('1');
    await expect(page.getByTestId('count-active')).toHaveText('2');

    await page.getByTestId('count-submitted').click();
    const table = page.getByTestId('request-table');
    await expect(table).toContainText(samTitle);
    await expect(table).not.toContainText(adaTitle);
    await expect(page.getByRole('combobox', { name: 'Work status' })).toHaveValue('SUBMITTED');

    await expect(table.getByRole('button', { name: samTitle })).toHaveCount(0);
    await expect(table).toContainText(samTitle);
    await expect(table).toContainText('People Ops');
    await expect(page.getByRole('columnheader', { name: 'Owner' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Last status update' })).toHaveCount(0);
    await expect(page.getByTestId('status-history')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load Request' })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByTestId('count-inProgress').click();
    await expect(table).toContainText(adaTitle);
    await expect(table).not.toContainText(samTitle);
    await table.getByRole('button', { name: adaTitle }).click();
    await expect(page.getByTestId('status-history')).toContainText('SUBMITTED → IN PROGRESS');
    await expect(page.getByTestId('status-history')).toContainText('by Sam Handler');
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete Request' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'My requests' }).click();
    await expect(table).toContainText(adaTitle);
    await expect(table).not.toContainText(samTitle);
    await expect(page.getByText(/not requests assigned to you/i)).toBeVisible();
  });

  test('Super Admin can submit own requests without handling controls', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `ada.view.${stamp}@operations-hub.test`;
    const title = `View only ${stamp}`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create a company workspace' }).click();
    await page.getByLabel('Company name').fill(`View Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Viewer');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Viewer');

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await nav.getByRole('link', { name: 'Departments' }).click();
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await addRequestType(page, 'People Ops', 'General');

    await nav.getByRole('link', { name: 'Requests' }).click();
    await expect(page.getByRole('tab', { name: 'All requests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Request' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request Intake' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load Request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Request' })).toHaveCount(0);

    const createCard = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await createCard.getByLabel('Department').selectOption({ label: 'People Ops' });
    await createCard.getByLabel('Request type').selectOption({ label: 'General' });
    await createCard.getByLabel('Title').fill(title);
    await createCard.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('request-id')).toBeVisible();
    await expect(page.getByTestId('request-table')).toContainText(title);
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete Request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load Request' })).toHaveCount(0);
  });
});

async function addRequestType(page: Page, departmentName: string, typeName: string) {
  const block = page.getByTestId(`request-types-for-${departmentName}`);
  await block.getByLabel(`New type for ${departmentName}`).fill(typeName);
  await block.getByLabel(`Approval policy for new ${departmentName} type`).selectOption('NONE');
  await block.getByRole('button', { name: `Add request type to ${departmentName}` }).click();
  await expect(block).toContainText(typeName);
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
