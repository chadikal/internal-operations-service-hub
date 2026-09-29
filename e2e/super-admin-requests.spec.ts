import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, Locator, test, Page } from '@playwright/test';
import { ensureTestLogins, removeSignupCompanies, TEST_PASSWORD } from './db';
import { completeWorkspaceSetup, login } from './login';

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
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Request Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Requests');
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
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Requests');

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await nav.getByRole('link', { name: 'Departments' }).click();
    await page.getByRole('button', { name: 'Add department' }).click();
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByTestId('form-overlay').getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await addRequestType(page, 'People Ops', 'General');

    await nav.getByRole('link', { name: 'Staff' }).click();
    await page.getByRole('button', { name: 'Invite Staff' }).click();
    await page.getByLabel('Staff name').fill('Sam Handler');
    await page.getByLabel('Staff email').fill(staffEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'People Ops' });
    await page.getByLabel('Handler access').selectOption({ label: 'Handler — Can handle requests' });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    await nav.getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();
    const createCard = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await createCard.getByLabel('Department').selectOption({ label: 'People Ops' });
    await createCard.getByLabel('Request type').selectOption({ label: 'General' });
    await createCard.getByLabel('Title').fill(adaTitle);
    await createCard.getByRole('button', { name: 'Create Request' }).click();
    const adaRow = page.getByTestId('my-request-table').locator('tbody tr', { hasText: adaTitle });
    await expect(adaRow).toBeVisible();
    const adaRequestId = (await adaRow.getByRole('button').first().innerText()).replace('#', '').trim();
    await page.getByTestId('close-form').click();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    const invitation = await outboxMessage(staffEmail, 'invitation');
    await page.goto(`/?invite=${encodeURIComponent(invitation.token)}`);
    await page.getByLabel('New password').fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await login(page, staffEmail);
    await page.getByRole('navigation', { name: 'Handler' }).getByRole('link', { name: 'Requests', exact: true }).click();
    await page.getByLabel('Search requests').fill(adaRequestId);
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('button', { name: new RegExp(adaTitle) }).click();
    await page.getByRole('button', { name: 'Claim' }).click();
    await page.getByRole('button', { name: 'Start Work' }).click();
    await expect(page.getByTestId('request-stage')).toHaveText('In progress');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await page.getByTestId('close-form').click();
    await page.getByRole('navigation', { name: 'Handler' }).getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();

    const staffCreate = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await staffCreate.getByLabel('Department').selectOption({ label: 'People Ops' });
    await staffCreate.getByLabel('Request type').selectOption({ label: 'General' });
    await staffCreate.getByLabel('Title').fill(samTitle);
    await staffCreate.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('form-overlay').getByText(samTitle)).toBeVisible();
    await page.getByTestId('close-form').click();

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
    await expect(table.getByRole('columnheader')).toHaveText([
      'ID',
      'Title',
      'Submitter',
      'Employee Department',
      'Destination Department',
      'Work Status',
    ]);
    await expect(table.getByRole('columnheader', { name: 'Submitted At' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Work Status' })).toHaveValue('SUBMITTED');

    await expect(table.getByRole('button', { name: samTitle })).toHaveCount(0);
    await expect(table).toContainText(samTitle);
    await expect(table).toContainText('People Ops');
    await expect(page.getByRole('columnheader', { name: 'Owner' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Last status update' })).toHaveCount(0);
    await expect(page.getByTestId('status-history')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Work' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load Request' })).toHaveCount(0);

    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByTestId('count-inProgress').click();
    await expect(table).toContainText(adaTitle);
    await expect(table).not.toContainText(samTitle);
    await table.getByRole('button', { name: adaTitle }).click();
    const history = page.getByTestId('status-history');
    await expectHistory(history, ['Submitted', 'Unclaimed', 'Claimed', 'In Progress']);
    await expect(history).not.toContainText('Awaiting Approval');
    const claimed = history.locator('.timeline li').filter({ has: page.locator('strong', { hasText: /^Claimed$/ }) });
    await expect(claimed.locator('span')).toHaveText(/^by Sam Handler · /);
    await expect(history.locator('.timeline li', { hasText: 'In Progress' })).toContainText(/by Sam Handler · /);
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Work' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete' })).toHaveCount(0);
    await page.getByTestId('close-form').click();

    await nav.getByRole('link', { name: 'My Requests' }).click();
    await expect(page.getByTestId('my-requests')).toContainText(adaTitle);
    await expect(page.getByTestId('my-requests')).not.toContainText(samTitle);
    await expect(page.getByTestId('my-request-table').getByRole('columnheader')).toHaveText([
      'ID',
      'Title',
      'Submitter',
      'Destination Department',
      'Submitted At',
      'Request Stage',
    ]);
    await expect(page.getByTestId('my-request-table').getByRole('columnheader', { name: 'Employee Department' })).toHaveCount(0);
    await expect(page.getByText('Requests you submitted.')).toBeVisible();
  });

  test('Super Admin can submit own requests without handling controls', async ({ page }) => {
    const stamp = Date.now();
    const founderEmail = `ada.view.${stamp}@operations-hub.test`;
    const title = `View only ${stamp}`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`View Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Viewer');
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
    await expect(page.getByTestId('signed-in-name')).toContainText('Ada Viewer');

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await nav.getByRole('link', { name: 'Departments' }).click();
    await page.getByRole('button', { name: 'Add department' }).click();
    await page.getByLabel('Department name').fill('People Ops');
    await page.getByTestId('form-overlay').getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByText('Department added.')).toBeVisible();
    await addRequestType(page, 'People Ops', 'General');

    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();
    await expect(page).toHaveURL(/\/admin\/my-requests\?form=create$/);
    await expect(page.getByTestId('close-form')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('form-overlay')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Request' })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 640 });
    await page.getByRole('button', { name: 'AI Intake' }).click();
    const box = await page.getByTestId('form-overlay').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect((box!.y ?? 0) + (box!.height ?? 0)).toBeLessThanOrEqual(640);
    await expect(page.getByRole('heading', { name: 'Request Intake' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);
    await page.getByTestId('close-form').click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await nav.getByRole('link', { name: 'Requests', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'All requests' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'My requests' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();

    const createCard = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await createCard.getByLabel('Department').selectOption({ label: 'People Ops' });
    await createCard.getByLabel('Request type').selectOption({ label: 'General' });
    await createCard.getByLabel('Title').fill(title);
    await createCard.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('my-requests')).toContainText(title);
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Work' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load Request' })).toHaveCount(0);
    await page.getByTestId('close-form').click();
    await nav.getByRole('link', { name: 'Requests', exact: true }).click();
    await expect(page.getByTestId('request-table')).toContainText(title);
    await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start Work' })).toHaveCount(0);
  });

  test('request tables keep readable columns and separate approval from work status', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const founderEmail = `ada.tables.${stamp}@operations-hub.test`;
    const staffEmail = `sam.tables.${stamp}@operations-hub.test`;
    const staffName = 'Alexandria Montgomery';
    const pendingTitle = `Pending laptop ${stamp}`;
    const approvedTitle = `Approved laptop ${stamp}`;
    const ownTitle = `Ada own request ${stamp}`;
    const founderPending = `Ada approval ${stamp}`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Create one' }).click();
    await page.getByLabel('Company name').fill(`Table Co ${stamp}`);
    await page.getByLabel('Your name').fill('Ada Tables');
    await page.getByLabel('Email').fill(founderEmail);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await completeWorkspaceSetup(page);
    const verification = await outboxMessage(founderEmail, 'email-verification');
    await page.goto(`/?verify=${encodeURIComponent(verification.token)}`);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await login(page, founderEmail);

    const nav = page.getByRole('navigation', { name: 'Super Admin' });
    await nav.getByRole('link', { name: 'Departments' }).click();
    await addRequestType(page, 'IT', 'Laptop', 'SUPER_ADMIN');
    await addRequestType(page, 'IT', 'General');

    await nav.getByRole('link', { name: 'Staff' }).click();
    await page.getByRole('button', { name: 'Invite Staff' }).click();
    await page.getByLabel('Staff name').fill(staffName);
    await page.getByLabel('Staff email').fill(staffEmail);
    await page.getByLabel('Staff department').selectOption({ label: 'IT' });
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    await nav.getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();
    const founderCreate = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await founderCreate.getByLabel('Department').selectOption({ label: 'IT' });
    await founderCreate.getByLabel('Request type').selectOption({ label: 'General' });
    await founderCreate.getByLabel('Title').fill(ownTitle);
    await founderCreate.getByRole('button', { name: 'Create Request' }).click();
    await page.getByTestId('close-form').click();
    await page.getByRole('button', { name: 'New Request' }).click();
    await founderCreate.getByLabel('Department').selectOption({ label: 'IT' });
    await founderCreate.getByLabel('Request type').selectOption({ label: 'Laptop' });
    await founderCreate.getByLabel('Title').fill(founderPending);
    await founderCreate.getByRole('button', { name: 'Create Request' }).click();
    await page.getByTestId('close-form').click();
    await page.getByRole('button', { name: founderPending }).click();
    await expectHistory(page.getByTestId('status-history'), ['Submitted', 'Awaiting Approval']);
    await page.getByTestId('close-form').click();
    await expect(page.getByTestId('my-request-table')).toContainText(ownTitle);
    await expect(page.getByTestId('my-request-table')).toContainText(founderPending);
    await expect(page.getByRole('combobox', { name: 'Approval Status' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Work Status' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Request Stage' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Log out' }).click();
    const invitation = await outboxMessage(staffEmail, 'invitation');
    await page.goto(`/?invite=${encodeURIComponent(invitation.token)}`);
    await page.getByLabel('New password').fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Activate account' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await login(page, staffEmail);
    await page.getByRole('navigation', { name: 'Employee' }).getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();
    const staffCreate = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await staffCreate.getByLabel('Department').selectOption({ label: 'IT' });
    await staffCreate.getByLabel('Request type').selectOption({ label: 'Laptop' });
    await staffCreate.getByLabel('Title').fill(pendingTitle);
    await staffCreate.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('request-stage')).toHaveText('Awaiting approval');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await expectHistory(page.getByTestId('status-history'), ['Submitted', 'Awaiting Approval']);
    await expect(page.getByTestId('status-history')).not.toContainText('Approved');
    await expect(page.getByTestId('approval-state')).toHaveText('Awaiting Approval');
    await page.getByTestId('close-form').click();
    await page.getByRole('button', { name: 'New Request' }).click();
    await staffCreate.getByLabel('Department').selectOption({ label: 'IT' });
    await staffCreate.getByLabel('Request type').selectOption({ label: 'Laptop' });
    await staffCreate.getByLabel('Title').fill(approvedTitle);
    await staffCreate.getByRole('button', { name: 'Create Request' }).click();
    await page.getByTestId('close-form').click();
    await expectTableFits(page, 'my-request-table', staffName);

    await page.getByRole('button', { name: 'Log out' }).click();
    await login(page, founderEmail);
    await nav.getByRole('link', { name: /Approvals/ }).click();
    const approvalTable = page.getByTestId('approval-table');
    await expect(approvalTable).toContainText(pendingTitle);
    await expect(approvalTable).toContainText(approvedTitle);
    await expect(approvalTable).not.toContainText(founderPending);
    await expect(approvalTable).toContainText(staffName);
    await expect(approvalTable.getByRole('columnheader')).toHaveText([
      'ID',
      'Title',
      'Submitter',
      'Destination Department',
      'Submitted At',
      'Approval Status',
    ]);
    await expectTableFits(page, 'approval-table', staffName);
    await approvalTable.getByRole('button', { name: approvedTitle }).click();
    await page.getByTestId('form-overlay').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('combobox', { name: 'Approval Status' })).toHaveValue('all');
    await expect(approvalTable).toContainText(approvedTitle);
    await page.getByTestId('close-form').click();
    await page.getByRole('combobox', { name: 'Approval Status' }).selectOption('awaiting');
    await expect(approvalTable).not.toContainText(approvedTitle);
    await page.getByRole('combobox', { name: 'Approval Status' }).selectOption('approved');
    await approvalTable.getByRole('button', { name: approvedTitle }).click();
    await expectHistory(page.getByTestId('status-history'), ['Submitted', 'Awaiting Approval', 'Approved', 'Unclaimed']);
    await expect(page.getByTestId('request-stage')).toHaveText('Approved · awaiting handler');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('approval-state')).toHaveText('Approved');
    await page.getByTestId('close-form').click();
    await page.getByRole('combobox', { name: 'Approval Status' }).selectOption('awaiting');
    await approvalTable.getByRole('button', { name: pendingTitle }).click();
    const overlay = page.getByTestId('form-overlay');
    await expect(overlay.getByText('Request Stage')).toBeVisible();
    await expect(overlay.getByTestId('request-stage')).toHaveText('Awaiting approval');
    await expect(overlay.getByText('Approval Status')).toBeVisible();
    await expect(overlay.getByTestId('approval-state')).toHaveText('Awaiting Approval');
    await expectHistory(overlay.getByTestId('status-history'), ['Submitted', 'Awaiting Approval']);
    await expect(overlay.getByText('Work Status', { exact: true })).toHaveCount(0);
    await overlay.getByLabel('Denial reason').fill('Not this quarter');
    await overlay.getByRole('button', { name: 'Deny' }).click();
    await expect(approvalTable.getByRole('cell', { name: 'No requests match this approval status.' })).toBeVisible();

    await nav.getByRole('link', { name: 'Requests', exact: true }).click();
    await expect(page.getByText(/not claimable/i)).toHaveCount(0);
    const requestTable = page.getByTestId('request-table');
    await expect(requestTable).toContainText(pendingTitle);
    await expect(requestTable).toContainText('SUBMITTED');
    await expect(requestTable.getByRole('columnheader')).toHaveText([
      'ID',
      'Title',
      'Submitter',
      'Employee Department',
      'Destination Department',
      'Work Status',
    ]);
    await expectTableFits(page, 'request-table', staffName);

    await nav.getByRole('link', { name: 'My Requests' }).click();
    await expectTableFits(page, 'my-request-table', 'Ada Tables');

    await page.getByRole('button', { name: 'Log out' }).click();
    await login(page, staffEmail);
    await page.getByRole('navigation', { name: 'Employee' }).getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: pendingTitle }).click();
    await expect(page.getByTestId('request-stage')).toHaveText('Denied');
    await expect(page.getByTestId('approval-state')).toHaveText('Denied');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await expectHistory(page.getByTestId('status-history'), ['Submitted', 'Awaiting Approval', 'Denied']);
    await expect(page.getByTestId('status-history')).not.toContainText('In Progress');
  });
});

async function addRequestType(page: Page, departmentName: string, typeName: string, policy = 'NONE') {
  await page.getByRole('button', { name: `Edit ${departmentName}` }).click();
  await page.getByRole('button', { name: 'Add request type' }).click();
  const overlay = page.getByRole('dialog', { name: 'Add request type' });
  await overlay.getByLabel(`New type for ${departmentName}`).fill(typeName);
  await overlay.getByLabel(`Approval policy for new ${departmentName} type`).selectOption(policy);
  await overlay.getByRole('button', { name: 'Add request type' }).click();
  await expect(page.getByTestId(`request-types-for-${departmentName}`)).toContainText(typeName);
  await page.getByRole('dialog', { name: 'Edit department' }).getByRole('button', { name: 'Cancel' }).click();
}

async function expectTableFits(page: Page, testId: string, submitterName: string) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const table = page.getByTestId(testId);
    await expect(table).toBeVisible();
    const headers = table.getByRole('columnheader');
    const headerCount = await headers.count();
    let previousRight = -1;
    for (let index = 0; index < headerCount; index += 1) {
      const header = headers.nth(index);
      const box = await header.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(previousRight - 1);
      previousRight = box!.x + box!.width;
      expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    const submitter = table.locator('td.col-submitter .cell-nowrap', { hasText: submitterName }).first();
    await expect(submitter).toBeVisible();
    expect(await submitter.evaluate((element) => {
      const text = element.getBoundingClientRect();
      const cell = element.closest('td')?.getBoundingClientRect();
      return Boolean(cell) && text.x >= cell!.x - 1 && text.x + text.width <= cell!.x + cell!.width + 1;
    })).toBe(true);
    const dates = table.locator('td.col-submitted .cell-nowrap');
    if ((await dates.count()) > 0) {
      expect(await dates.first().evaluate((element) => {
        const text = element.getBoundingClientRect();
        const cell = element.closest('td')?.getBoundingClientRect();
        return Boolean(cell) && text.width > 0 && text.x + text.width <= cell!.x + cell!.width + 1;
      })).toBe(true);
    }
    const scroll = await page.evaluate((id) => {
      const sidebar = document.querySelector('.sidebar');
      const wrap = document.querySelector(`[data-testid="${id}"]`)?.closest('.table-wrap');
      return {
        pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        sidebarFits: !sidebar || sidebar.scrollWidth <= sidebar.clientWidth + 1,
        tableScrolls: !wrap || wrap.scrollWidth > wrap.clientWidth + 1,
      };
    }, testId);
    expect(scroll.pageFits).toBe(true);
    expect(scroll.sidebarFits).toBe(true);
    if (width === 390) {
      expect(scroll.tableScrolls).toBe(true);
    }
    const rows = table.locator('tbody tr');
    if ((await rows.count()) > 1) {
      const heights = await rows.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function expectHistory(history: Locator, labels: string[]) {
  await expect(history.locator('.timeline-chain')).toHaveCount(0);
  await expect(history.locator('ol.timeline')).toHaveCount(1);
  await expect(history.locator('.timeline strong')).toHaveText(labels);
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
