import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { ensureTestLogins, removeSignupCompanies, TEST_PASSWORD } from './db';
import { login } from './login';

const EMAIL_OUTBOX = join(process.cwd(), 'test-results', 'email-outbox.jsonl');

test.describe('Super Admin workspace', () => {
  test.beforeEach(async () => {
    await ensureTestLogins();
    await removeSignupCompanies();
  });

  test.afterEach(async () => {
    await removeSignupCompanies();
  });

  test('Super Admin can navigate the workspace and see this company’s employees', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `admin.${stamp}@operations-hub.test`;
    const staffEmail = `handler.${stamp}@operations-hub.test`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create a company workspace' }).click();
    await page.getByLabel('Company name').fill(`Admin Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Admin');
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
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Admin');
    await expect(page.getByText(`Admin Co ${stamp}`)).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Employees' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Departments' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Requests' })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Approvals/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Settings/ })).toBeVisible();
    await expect(page.getByTestId('count-employees')).toHaveText('1');
    await expect(page.getByTestId('count-departments')).toHaveText('3');
    await expect(page.getByTestId('count-requests')).toHaveText('0');
    await expect(page.getByTestId('dashboard-empty-requests')).toBeVisible();

    await nav.getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByTestId('department-list')).toContainText('IT');
    await expect(page.getByTestId('department-list')).toContainText('HR');
    await expect(page.getByTestId('department-list')).toContainText('Finance');
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await expect(page.getByTestId('department-list')).toContainText('People Ops');

    await nav.getByRole('link', { name: 'Employees' }).click();
    await page.getByLabel('Staff name').fill('Pat Handler');
    await page.getByLabel('Staff email').fill(staffEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'People Ops' });
    await page.getByLabel('Staff role').selectOption('Department Admin');
    await page.getByLabel('Can handle requests').check();
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    const table = page.getByTestId('employee-table');
    await expect(table).toContainText('Ada Admin');
    await expect(table).toContainText(founderEmail);
    await expect(table).toContainText('Pat Handler');
    await expect(table).toContainText(staffEmail);
    await expect(table).toContainText('Department Admin');
    await expect(table.getByRole('row', { name: /Pat Handler/ })).toContainText('Yes');
    await expect(table.getByRole('row', { name: /Pat Handler/ })).toContainText('Inactive');

    await page.getByLabel('Search name or email').fill('Pat');
    await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('Department Admin');
    await page.getByRole('combobox', { name: 'Handler eligibility' }).selectOption('Can handle');
    await expect(table.getByRole('row', { name: /Pat Handler/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Ada Admin/ })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Requests' }).click();
    await expect(page.getByRole('tab', { name: 'All requests' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'My requests' })).toBeVisible();
    await expect(page.getByTestId('requests-empty')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Request' })).toBeVisible();

    await nav.getByRole('link', { name: /Approvals/ }).click();
    await expect(page.getByTestId('coming-later')).toContainText('Coming later');
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await login(page, 'john@operations-hub.test');
    await expect(page.getByRole('navigation', { name: 'Super Admin' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Create Request' })).toBeVisible();
    await page.goto('/admin/employees');
    await expect(page.getByRole('navigation', { name: 'Super Admin' })).toHaveCount(0);
    await expect(page.getByTestId('employee-table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Create Request' })).toBeVisible();
  });

  test('Super Admin can review a template and apply edited types without renaming the department', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `admin.templates.${stamp}@operations-hub.test`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create a company workspace' }).click();
    await page.getByLabel('Company name').fill(`Template Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Templates');
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
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Templates');

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await nav.getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByLabel('Department template')).toContainText('Operations');
    await expect(page.getByTestId('request-types-for-IT')).toContainText('No request types yet.');
    await expect(page.getByTestId('request-types-for-HR')).toContainText('No request types yet.');
    await expect(page.getByTestId('request-types-for-Finance')).toContainText('No request types yet.');

    await page.getByLabel('Department name').fill('Night Shift');
    await page.getByLabel('Department template').selectOption({ label: 'Operations' });
    await expect(page.getByLabel('Suggested type name 1 for new department')).toHaveValue('Process change');
    await expect(page.getByLabel('Suggested approval policy 1 for new department')).toHaveValue(
      'DEPARTMENT_ADMIN',
    );
    await expect(page.getByLabel('Suggested type name 2 for new department')).toHaveValue('Operational support');
    await expect(page.getByLabel('Suggested approval policy 2 for new department')).toHaveValue('NONE');
    await page.getByRole('button', { name: 'Remove suggested type 2 for new department' }).click();
    await page.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await expect(page.getByTestId('department-list')).toContainText('Night Shift');
    await expect(page.getByTestId('request-types-for-Night Shift')).toContainText('Process change');
    await expect(page.getByTestId('request-types-for-Night Shift')).not.toContainText('Operational support');

    await page.getByLabel('Template to apply to IT').selectOption({ label: 'IT' });
    await expect(page.getByLabel('Suggested type name 1 for IT')).toHaveValue('Hardware');
    await expect(page.getByLabel('Suggested type name 2 for IT')).toHaveValue('Software');
    await expect(page.getByLabel('Suggested type name 3 for IT')).toHaveValue('Access');
    await page.getByRole('button', { name: 'Apply suggested types to IT' }).click();
    await expect(page.getByTestId('request-types-for-IT')).toContainText('Hardware');
    await expect(page.getByTestId('request-types-for-IT')).toContainText('Software');
    await expect(page.getByTestId('request-types-for-IT')).toContainText('Access');
    await expect(page.getByTestId('department-list')).toContainText('IT');
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
