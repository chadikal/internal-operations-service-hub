import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { ensureTestLogins, removeSignupCompanies, TEST_PASSWORD } from './db';
import { completeWorkspaceSetup, login } from './login';
import { clickCardPadding, expectBreakdownEmphasis, expectBreakdownFits, expectMainLinkEmphasis } from './summary-card';

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
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Admin Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Admin');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await completeWorkspaceSetup(page);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Admin');
    await expect(page.getByText(`Admin Co ${stamp}`)).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Staff' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Departments' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Requests', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'My Requests' })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Approvals/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Settings/ })).toBeVisible();
    await expect(page.getByTestId('count-employees')).toHaveText('1');
    await expect(page.getByTestId('count-departments')).toHaveText('3');
    await expect(page.getByTestId('count-requests')).toHaveText('0');
    await expect(page.getByTestId('dashboard-empty-requests')).toBeVisible();
    const counts = page.getByTestId('dashboard-counts');
    await expectMainLinkEmphasis(counts.locator('.summary-card-requests a.summary-card-main'));
    await expectBreakdownEmphasis(counts.locator('.summary-card-requests').getByRole('link', { name: /Claimed/ }));
    await expectBreakdownEmphasis(counts.locator('.summary-card').nth(1).getByRole('link', { name: /Unclaimed/ }));
    await counts.locator('.summary-card').nth(1).getByRole('link', { name: /^Submitted/ }).click();
    await expect(page).toHaveURL(/\/admin\/my-requests\?workStatus=SUBMITTED$/);
    await expect(page.getByRole('combobox', { name: 'Work Status' })).toHaveValue('SUBMITTED');
    await expect(page.getByRole('combobox', { name: 'Claim Status' })).toHaveValue('');
    await expect(page.getByRole('option', { name: 'No stored approval state' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await counts.locator('.summary-card').nth(1).getByRole('link', { name: /Unclaimed/ }).click();
    await expect(page).toHaveURL(/\/admin\/my-requests\?assignment=unclaimed$/);
    await page.getByRole('combobox', { name: 'Work Status' }).selectOption('IN_PROGRESS');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/\/admin\/my-requests\?workStatus=IN_PROGRESS&assignment=unclaimed$/);
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await expectMainLinkEmphasis(counts.getByRole('link', { name: /My Requests/ }));
    await expectMainLinkEmphasis(counts.getByRole('link', { name: /Approvals/ }));
    await expectBreakdownEmphasis(counts.getByRole('link', { name: /^Approved/ }));
    await expectMainLinkEmphasis(counts.locator('.summary-card-embedded a.summary-card-main'));
    await expectBreakdownEmphasis(counts.getByRole('link', { name: /Admins/ }));
    await expectMainLinkEmphasis(page.getByTestId('departments-count'));
    await counts.locator('.summary-card-requests').getByRole('link', { name: /Claimed/ }).click();
    await expect(page).toHaveURL(/\/admin\/requests\?assignment=assigned$/);
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await clickCardPadding(page, counts.locator('.summary-card-requests'));
    await expect(page).toHaveURL(/\/admin\/requests$/);
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    const board = page.getByTestId('dashboard-counts');
    const boardBox = await board.boundingBox();
    await expectBreakdownFits(board.locator('.summary-card-requests'));
    await expectBreakdownFits(board.locator('.summary-card').nth(1));
    await expectBreakdownFits(board.locator('.summary-card').nth(2));
    const panel = page.getByTestId('staff-departments-panel');
    const panelBox = await panel.boundingBox();
    const staffBox = await panel.locator('.summary-card').boundingBox();
    const departments = panel.locator('.summary-departments');
    const departmentsBox = await departments.boundingBox();
    expect(panelBox!.width).toBeGreaterThan((boardBox?.width ?? 0) * 0.9);
    await expectBreakdownFits(panel.locator('.summary-card'));
    expect(departmentsBox!.x).toBeGreaterThan((staffBox?.x ?? 0) + (staffBox?.width ?? 0) - 4);
    expect(departmentsBox!.width).toBeLessThan((panelBox?.width ?? 0) * 0.35);
    expect(Math.abs((departmentsBox?.height ?? 0) - (staffBox?.height ?? 0))).toBeLessThan(2);
    expect((panelBox?.height ?? 0) - (departmentsBox?.height ?? 0)).toBeLessThanOrEqual(2);
    await page.setViewportSize({ width: 390, height: 800 });
    const narrowStaff = await panel.locator('.summary-card').boundingBox();
    const narrowDepartments = await departments.boundingBox();
    expect(narrowDepartments!.y).toBeGreaterThan((narrowStaff?.y ?? 0) + (narrowStaff?.height ?? 0) - 4);
    expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await departments.click();
    await expect(page.getByTestId('department-overview')).toBeVisible();
    await nav.getByRole('link', { name: 'Dashboard' }).click();

    await nav.getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByTestId('department-detail')).toHaveCount(0);
    const overview = page.getByTestId('department-overview');
    await expect(overview).toContainText('IT');
    await expect(overview).toContainText('HR');
    await expect(overview).toContainText('Finance');
    await expect(overview.getByRole('row', { name: /IT/ })).toContainText('None');
    await nav.getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByTestId('department-list')).toContainText('IT');
    await page.getByRole('button', { name: 'Add department' }).click();
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByTestId('form-overlay').getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await expect(page.getByTestId('department-list')).toContainText('People Ops');

    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Security' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Company' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'My Department' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveCount(0);
    await expect(page.getByLabel('Department')).toHaveCount(0);
    await expect(page.getByLabel('Department name')).toHaveCount(0);
    await page.getByLabel('Name').fill('Ada Renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Renamed');
    await page.getByRole('tab', { name: 'Company' }).click();
    await page.getByLabel('Company name').fill(`Admin Co Renamed ${stamp}`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`Admin Co Renamed ${stamp}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add department' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add request type' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use template' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Staff' }).click();
    await page.getByRole('button', { name: 'Invite Staff' }).click();
    await page.getByLabel('Staff name').fill('Pat Handler');
    await page.getByLabel('Staff email').fill(staffEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'People Ops' });
    await page.getByLabel('Staff role').selectOption('Department Admin');
    await expect(page.getByLabel('Handler access')).toHaveCount(0);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    const table = page.getByTestId('employee-table');
    await expect(table).toContainText('Ada Renamed');
    await expect(table).toContainText(founderEmail);
    await expect(table).toContainText('Pat Handler');
    await expect(table).toContainText(staffEmail);
    await expect(table).toContainText('Department Admin');
    await expect(table.getByRole('row', { name: /Pat Handler/ })).toContainText('Yes');
    await expect(table.getByRole('row', { name: /Pat Handler/ })).toContainText('Inactive');

    await page.getByLabel('Search name or email').fill('Pat');
    await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('Department Admin');
    await page.getByRole('combobox', { name: 'Handler eligibility' }).selectOption('Handlers');
    await expect(table.getByRole('row', { name: /Pat Handler/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Ada Renamed/ })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Departments' }).click();
    await expect(page.getByTestId('department-row-People Ops')).toContainText('Pat Handler');
    await expect(page.getByTestId('department-row-People Ops')).toContainText('1');
    await expect(page.getByTestId('department-row-IT')).toContainText('None');
    await expect(nav.getByText('Coming later')).toHaveCount(0);

    await nav.getByRole('link', { name: 'Requests', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'All requests' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'My requests' })).toHaveCount(0);
    await expect(page.getByTestId('requests-empty')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();
    await expect(page.getByTestId('form-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Request' })).toBeVisible();
    await page.getByTestId('close-form').click();

    await nav.getByRole('link', { name: /Approvals/ }).click();
    await expect(page.getByTestId('approval-inbox')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Approval Status' })).toHaveValue('all');
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
    const emptyApprovals = page.getByTestId('approval-table').getByRole('cell', { name: 'No requests match this approval status.' });
    await expect(emptyApprovals).toBeVisible();
    await expect(page.getByTestId('approval-table').getByRole('columnheader')).toHaveText([
      'ID',
      'Title',
      'Submitter',
      'Destination Department',
      'Submitted At',
      'Approval Status',
    ]);
    await expect(page.getByTestId('approval-table').getByRole('columnheader', { name: 'Employee Department' })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(emptyApprovals).toBeVisible();
    expect(await page.getByTestId('approval-inbox').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

    await login(page, 'john@operations-hub.test');
    await expect(page.getByRole('navigation', { name: 'Super Admin' })).toHaveCount(0);
    await expect(page.getByTestId('staff-dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);
    await page.goto('/admin/employees');
    await expect(page.getByRole('navigation', { name: 'Super Admin' })).toHaveCount(0);
    await expect(page.getByTestId('employee-table')).toHaveCount(0);
    await expect(page.getByTestId('staff-dashboard')).toBeVisible();
  });

  test('Super Admin can review a template and apply edited types without renaming the department', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `admin.templates.${stamp}@operations-hub.test`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Template Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Templates');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await completeWorkspaceSetup(page);
    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${verification.token}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Templates');

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await nav.getByRole('link', { name: 'Departments' }).click();
    await page.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByLabel('Department template')).toContainText('Operations');
    await page.getByTestId('close-form').click();
    const defaults: Array<[string, string[]]> = [
      ['IT', ['Hardware', 'Software', 'Access']],
      ['HR', ['Leave', 'Certificate']],
      ['Finance', ['Expense', 'Purchase exception']],
    ];
    await expect(page.getByTestId('department-detail')).toHaveCount(0);
    for (const [name, types] of defaults) {
      await page.getByRole('button', { name: `Edit ${name}` }).click();
      const panel = page.getByTestId(`request-types-for-${name}`);
      await expect(page.getByRole('dialog', { name: 'Edit department' })).toBeVisible();
      for (const type of types) {
        await expect(panel).toContainText(type);
      }
      await expect(panel.getByRole('listitem').filter({ hasText: types[0] })).toBeVisible();
      await page.getByRole('dialog', { name: 'Edit department' }).getByRole('button', { name: 'Cancel' }).click();
    }

    await page.getByRole('button', { name: 'Add department' }).click();
    await page.getByLabel('Department name').fill('Night Shift');
    await page.getByLabel('Department template').selectOption({ label: 'Operations' });
    await expect(page.getByLabel('Suggested type name 1 for new department')).toHaveValue('Process change');
    await expect(page.getByLabel('Suggested approval policy 1 for new department')).toHaveValue(
      'DEPARTMENT_ADMIN',
    );
    await expect(page.getByLabel('Suggested type name 2 for new department')).toHaveValue('Operational support');
    await expect(page.getByLabel('Suggested approval policy 2 for new department')).toHaveValue('NONE');
    await page.getByRole('button', { name: 'Remove Operational support' }).click();
    await expect(page.getByRole('button', { name: 'Add type' })).toBeVisible();
    await page.getByTestId('form-overlay').getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await expect(page.getByTestId('department-list')).toContainText('Night Shift');
    await expect(page.getByTestId('department-detail')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit Night Shift' }).click();
    await expect(page.getByTestId('request-types-for-Night Shift')).toContainText('Process change');
    await expect(page.getByTestId('request-types-for-Night Shift')).not.toContainText('Operational support');
    await page.getByRole('dialog', { name: 'Edit department' }).getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Edit IT' }).click();
    await page.getByRole('button', { name: 'Use template' }).click();
    await page.getByLabel('Template to apply to IT').selectOption({ label: 'Marketing' });
    await expect(page.getByLabel('Suggested type name 1 for IT')).toHaveValue('Campaign');
    await expect(page.getByLabel('Suggested type name 2 for IT')).toHaveValue('Brand asset');
    await page.getByRole('button', { name: 'Remove Brand asset' }).click();
    await page.getByRole('button', { name: 'Apply suggested types to IT' }).click();
    await expect(page.getByTestId('request-types-for-IT')).toContainText('Campaign');
    await expect(page.getByTestId('request-types-for-IT')).toContainText('Hardware');
    await expect(page.getByTestId('request-types-for-IT')).not.toContainText('Brand asset');
    await expect(page.getByTestId('department-list')).toContainText('IT');
    const hardware = page.getByTestId('request-types-for-IT').getByRole('listitem').filter({ hasText: 'Hardware' });
    await expect(hardware).toContainText('None');
    await page.getByRole('button', { name: 'Edit Hardware' }).click();
    const typeDialog = page.getByRole('dialog', { name: 'Edit request type' });
    await typeDialog.getByLabel('Approval policy for Hardware').selectOption('DEPARTMENT_ADMIN');
    await typeDialog.getByRole('button', { name: 'Save' }).click();
    await expect(hardware).toContainText('Department Admin');
    await page.getByRole('button', { name: 'Add request type' }).click();
    const addType = page.getByRole('dialog', { name: 'Add request type' });
    await addType.getByLabel('New type for IT').fill('Badge');
    await addType.getByLabel('Approval policy for new IT type').selectOption('NONE');
    await addType.getByRole('button', { name: 'Add request type' }).click();
    await expect(page.getByTestId('request-types-for-IT')).toContainText('Badge');
    await page.getByRole('dialog', { name: 'Edit department' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('department-detail')).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit Finance' }).click();
    await page.getByTestId('close-form').click();
    await expect(page.getByTestId('form-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit Finance' }).click();
    await page.getByLabel('Department name').fill('Finance Desk');
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('Discard unsaved changes?');
      return dialog.dismiss();
    });
    await page.getByTestId('close-form').click();
    await expect(page.getByLabel('Department name')).toHaveValue('Finance Desk');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('form-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit Finance' }).click();
    await page.getByLabel('Department name').fill('Finance Desk');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('department-row-Finance Desk')).toBeVisible();
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
