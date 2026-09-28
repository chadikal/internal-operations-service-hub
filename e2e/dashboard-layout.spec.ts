import { expect, Locator, test } from '@playwright/test';
import { ensureTestLogins, setDevelopmentAccountRole, setDevelopmentDepartmentName, TEST_PASSWORD } from './db';
import { login } from './login';
import { clickCardPadding, expectBreakdownEmphasis, expectBreakdownFits, expectMainLinkEmphasis } from './summary-card';

async function iconShape(locator: Locator) {
  return locator.locator('svg').evaluate((svg) =>
    [...svg.querySelectorAll('circle, path')]
      .map((node) =>
        node.tagName === 'circle'
          ? `c:${node.getAttribute('cx')},${node.getAttribute('cy')},${node.getAttribute('r')}`
          : node.getAttribute('d'),
      )
      .join('|'),
  );
}

test.describe('Dashboard layout and request detail', () => {
  test.beforeEach(async () => {
    await ensureTestLogins();
    await setDevelopmentAccountRole(1, 'EMPLOYEE', true);
    await setDevelopmentAccountRole(2, 'EMPLOYEE', false);
  });

  test.afterEach(async () => {
    await setDevelopmentAccountRole(1, 'EMPLOYEE', true);
    await setDevelopmentAccountRole(2, 'EMPLOYEE', false);
  });

  test('sidebar order, login landing, summary cards, and keyboard detail', async ({ page }) => {
    await login(page, 'john@operations-hub.test');
    const employeeNav = page.getByRole('navigation', { name: 'Employee' });
    await expect(employeeNav.getByRole('link')).toHaveCount(3);
    await expect(employeeNav.getByRole('link').nth(0)).toHaveText('Dashboard');
    await expect(employeeNav.getByRole('link').nth(1)).toHaveText('My Requests');
    await expect(employeeNav.getByRole('link').nth(2)).toContainText('Settings');
    await expect(page.getByRole('heading', { name: 'Internal Operations Service Hub' })).toBeVisible();
    await employeeNav.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Security' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Company' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'My Department' })).toHaveCount(0);
    await expect(page.getByLabel('Email')).toHaveValue('john@operations-hub.test');
    await expect(page.getByLabel('Role')).toHaveValue('Employee');
    await expect(page.getByLabel('Department')).toHaveValue('IT');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await page.getByLabel('Name').fill('Johnny');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Johnny');
    await page.getByLabel('Name').fill('John');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('John');
    await page.getByRole('tab', { name: 'Security' }).click();
    await expect(page.getByRole('button', { name: 'Email a password reset link' })).toHaveCount(0);
    await expect(page.getByLabel('Current password')).toBeVisible();
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm new password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
    await page.getByLabel('Current password').fill('wrong-current-password');
    await page.getByLabel('New password', { exact: true }).fill('replacement-password-12');
    await page.getByLabel('Confirm new password').fill('other-password-ok-12');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert')).toContainText('Passwords do not match');
    await page.getByLabel('Confirm new password').fill('replacement-password-12');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert')).toContainText('Current password is incorrect');
    await employeeNav.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Your dashboard' })).toBeVisible();
    await expect(page.locator('.summary-card')).toHaveCount(1);
    await expect(page.locator('.summary-label')).toHaveText(['My Requests']);
    const myCard = page.locator('.summary-card');
    expect(await iconShape(myCard.locator('.summary-icon'))).toBe(
      await iconShape(employeeNav.getByRole('link', { name: 'My Requests' })),
    );
    await expectMainLinkEmphasis(myCard.locator('a.summary-card-main'));
    await expectBreakdownEmphasis(myCard.getByRole('link', { name: /Completed/ }));
    await expectBreakdownEmphasis(myCard.getByRole('link', { name: /Unclaimed/ }));
    await expect(myCard.getByRole('link', { name: /Awaiting approval|Approved|Denied/ })).toHaveCount(0);
    await myCard.getByTestId('my-unclaimed').click();
    await expect(page).toHaveURL(/\/my-requests\?assignment=unclaimed$/);
    await expect(page.getByRole('combobox', { name: 'Claim Status' })).toHaveValue('unclaimed');
    await expect(page.getByRole('combobox', { name: 'Work Status' })).toHaveValue('');
    await expect(page.getByRole('option', { name: 'No stored approval state' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Work Status' }).selectOption('SUBMITTED');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/\/my-requests\?workStatus=SUBMITTED&assignment=unclaimed$/);
    await employeeNav.getByRole('link', { name: 'Dashboard' }).click();
    await clickCardPadding(page, myCard);
    await expect(page).toHaveURL(/\/my-requests$/);
    await employeeNav.getByRole('link', { name: 'Dashboard' }).click();

    await employeeNav.getByRole('link', { name: 'My Requests' }).click();
    await page.getByRole('button', { name: 'New Request' }).click();
    const createCard = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await createCard.getByLabel('Department').selectOption({ label: 'IT' });
    await createCard.getByLabel('Request type').selectOption({ label: 'General' });
    await createCard.getByLabel('Title').fill('Dashboard detail check');
    await createCard.getByRole('button', { name: 'Create Request' }).click();
    await page.getByTestId('close-form').click();
    await page.getByRole('button', { name: /Dashboard detail check/ }).first().click();
    const overlay = page.getByTestId('form-overlay');
    await expect(overlay.getByTestId('request-detail')).toBeVisible();
    await expectHistory(overlay.getByTestId('status-history'), ['Submitted', 'Unclaimed']);
    await expect(overlay.getByTestId('status-history')).not.toContainText('Awaiting Approval');
    await expect(overlay.getByText('Destination')).toBeVisible();
    await expect(overlay.getByText('Approval Status')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await page.getByLabel('Email').fill('chadi@operations-hub.test');
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Your dashboard' })).toBeVisible();
    await expect(page.getByTestId('handling-available')).toBeVisible();
    await expect(page.locator('.summary-card')).toHaveCount(2);
    const queues = page.locator('.summary-card', { has: page.getByText('Requests', { exact: true }) });
    await expectMainLinkEmphasis(queues.locator('a.summary-card-main'));
    await expectBreakdownEmphasis(queues.getByRole('link', { name: /Claimed by me/ }));

    await page.setViewportSize({ width: 390, height: 800 });
    const card = page.locator('.summary-card').first();
    const lead = await card.locator('.summary-lead').boundingBox();
    const side = await card.locator('.summary-side').boundingBox();
    expect(lead).not.toBeNull();
    expect(side).not.toBeNull();
    expect(side!.y).toBeGreaterThan(lead!.y + lead!.height - 4);
    await expectBreakdownFits(card);
    await expectBreakdownFits(queues);

    await page.setViewportSize({ width: 1280, height: 800 });
    const wideLead = await card.locator('.summary-lead').boundingBox();
    const wideSide = await card.locator('.summary-side').boundingBox();
    expect(wideSide!.x).toBeGreaterThan(wideLead!.x + wideLead!.width - 4);
    await expectBreakdownFits(card);
    await expectBreakdownFits(queues);
    await queues.locator('a.summary-card-main').click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByRole('tab', { name: 'Available' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('navigation', { name: 'Handler' }).getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Your dashboard' })).toBeVisible();

    await page.getByTestId('handling-claimed').click();
    await expect(page).toHaveURL(/\/requests\?queue=claimed$/);
    await expect(page.getByRole('tab', { name: 'Claimed by Me' })).toHaveAttribute('aria-selected', 'true');

  });

  test('sidebar stays fixed while the main area scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, 'john@operations-hub.test');
    const shell = page.locator('.admin-shell');
    const sidebar = page.locator('.sidebar');
    const main = page.locator('.admin-main');
    expect(await shell.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
    expect(await main.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    await main.evaluate((el) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1800px';
      el.appendChild(spacer);
    });
    const before = await sidebar.boundingBox();
    await main.evaluate((el) => {
      el.scrollTop = 700;
    });
    expect(await main.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
    expect(await page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop)).toBe(0);
    const after = await sidebar.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
    const footer = await page.locator('.sidebar-footer').boundingBox();
    expect((footer?.y ?? 0) + (footer?.height ?? 0)).toBeGreaterThan((after?.y ?? 0) + (after?.height ?? 0) - 48);

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(shell).toHaveClass(/sidebar-collapsed/);
    await expect(page.getByRole('button', { name: 'Log out' }).locator('svg')).toBeVisible();
    const collapsedBefore = await sidebar.boundingBox();
    await main.evaluate((el) => {
      el.scrollTop = 900;
    });
    const collapsedAfter = await sidebar.boundingBox();
    expect(Math.abs((collapsedAfter?.y ?? 0) - (collapsedBefore?.y ?? 0))).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  });

  test('Department Admin nav omits Departments and scopes cards to the department', async ({ page }) => {
    await setDevelopmentAccountRole(1, 'DEPARTMENT_ADMIN', true);
    await login(page, 'chadi@operations-hub.test');
    const nav = page.getByRole('navigation', { name: 'Department Admin' });
    const labels = ['Dashboard', 'Requests', 'My Requests', 'Approvals', 'Staff', 'Settings'];
    await expect(nav.getByRole('link')).toHaveCount(labels.length);
    for (let index = 0; index < labels.length; index += 1) {
      await expect(nav.getByRole('link').nth(index)).toContainText(labels[index]);
    }
    await expect(nav.getByRole('link', { name: 'Departments' })).toHaveCount(0);
    await expect(page.getByTestId('department-dashboard-counts')).toBeVisible();
    const departmentMyRequests = page
      .getByTestId('department-dashboard-counts')
      .locator('.summary-card', { has: page.getByText('My Requests', { exact: true }) });
    expect(await iconShape(departmentMyRequests.locator('.summary-icon'))).toBe(
      await iconShape(nav.getByRole('link', { name: 'My Requests' })),
    );
    await expect(page.getByTestId('department-employees')).toBeVisible();
    await expect(page.getByTestId('department-unclaimed')).toBeVisible();
    await expect(page.getByTestId('department-pending-approvals')).toBeVisible();
    const board = page.getByTestId('department-dashboard-counts');
    await expect(board.locator('.summary-label')).toHaveText(['Requests', 'My Requests', 'Approvals', 'Staff']);
    await expect(board.getByTestId('department-requests').locator('a').first()).toBeVisible();
    await expectMainLinkEmphasis(board.getByTestId('department-approvals').locator('a.summary-card-main'));
    await expectBreakdownEmphasis(page.getByTestId('department-pending-approvals').locator('xpath=..'));
    await expectMainLinkEmphasis(board.getByTestId('department-employees').locator('a.summary-card-main'));
    await page.setViewportSize({ width: 1280, height: 900 });
    const boardBox = await board.boundingBox();
    const requestsBox = await board.locator('.summary-card-requests').boundingBox();
    expect(requestsBox!.width).toBeGreaterThan((boardBox?.width ?? 0) * 0.9);
    const figures = board.locator('.summary-card-requests .summary-breakdown li');
    await expect(figures).toHaveCount(6);
    const first = await figures.nth(0).boundingBox();
    const second = await figures.nth(1).boundingBox();
    const third = await figures.nth(2).boundingBox();
    expect(second!.x).toBeGreaterThan(first!.x + 8);
    expect(Math.abs(second!.y - first!.y)).toBeLessThan(4);
    expect(third!.y).toBeGreaterThan(first!.y + first!.height - 4);
    expect(Math.abs(third!.x - first!.x)).toBeLessThan(8);
    const staffBox = await board.locator('.summary-card-wide').boundingBox();
    expect(staffBox!.width).toBeGreaterThan((boardBox?.width ?? 0) * 0.9);
    const mine = board.locator('.summary-card', { has: page.getByText('My Requests', { exact: true }) });
    await expect(mine.locator('.summary-breakdown li')).toHaveCount(4);
    await expect(mine.getByRole('link', { name: /Awaiting approval|Approved|Denied/ })).toHaveCount(0);
    await expectBreakdownFits(mine);
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await board.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const narrowLead = await board.locator('.summary-card-requests .summary-lead').boundingBox();
    const narrowSide = await board.locator('.summary-card-requests .summary-side').boundingBox();
    expect(narrowSide!.y).toBeGreaterThan(narrowLead!.y + narrowLead!.height - 4);
    await expectBreakdownFits(mine);
    await page.getByTestId('department-handlers').click();
    await expect(page).toHaveURL(/\/employees\?canHandle=true$/);
    await expect(page.getByTestId('department-employee-table')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByTestId('department-pending-approvals').click();
    await expect(page).toHaveURL(/\/approvals\?status=awaiting$/);
    const approvalFilter = page.getByRole('combobox', { name: 'Approval Status' });
    await expect(approvalFilter).toHaveValue('awaiting');
    await expect(approvalFilter.getByRole('option', { name: 'Waiting for your decision' })).toHaveCount(0);
    await expect(approvalFilter.getByRole('option')).toHaveText(['All', 'Awaiting', 'Approved', 'Denied']);
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByTestId('department-approvals').locator('a.summary-lead').click();
    await expect(page).toHaveURL(/\/approvals\?status=all$/);
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByTestId('department-admins').click();
    await expect(page).toHaveURL(/\/employees\?role=DEPARTMENT_ADMIN$/);
    await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible();
    const roleFilter = page.getByRole('combobox', { name: 'Role', exact: true });
    await expect(roleFilter).toHaveValue('DEPARTMENT_ADMIN');
    await expect(roleFilter.getByRole('option', { name: 'Super Admin' })).toHaveCount(0);
    await expect(roleFilter.getByRole('option', { name: 'Admins' })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Handlers', exact: true })).toHaveCount(1);
    await expect(page.getByRole('option', { name: 'Non-handlers' })).toHaveCount(1);
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await board.getByTestId('count-submitted').click();
    await expect(page).toHaveURL(/\/requests\?status=SUBMITTED$/);
    await expect(page.getByRole('tab', { name: 'All requests' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', { name: 'Work Status' })).toHaveValue('SUBMITTED');
    await expect(page.getByRole('tab', { name: 'Available' })).toBeVisible();
    await nav.getByRole('link', { name: 'Dashboard' }).click();
    await page.getByTestId('my-unclaimed').click();
    await expect(page).toHaveURL(/\/my-requests\?assignment=unclaimed$/);
    await expect(page.getByRole('combobox', { name: 'Claim Status' })).toHaveValue('unclaimed');
    await expect(page.getByRole('option', { name: 'No stored approval state' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Security' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'My Department' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Company' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'My Department' }).click();
    const departmentName = page.getByLabel('Department name');
    await expect(departmentName).toHaveValue('IT');
    await expect(page.getByRole('button', { name: 'Add department' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add request type' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use template' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Edit / })).toHaveCount(0);
    await expect(page.getByTestId('settings-department').locator('input')).toHaveCount(1);
    await expect(page.getByTestId('settings-department')).toContainText('General');
    try {
      await departmentName.fill('IT Desk');
      await page.getByRole('button', { name: 'Save department' }).click();
      await expect(page.getByText('Department saved.')).toBeVisible();
      await expect(departmentName).toHaveValue('IT Desk');
    } finally {
      await setDevelopmentDepartmentName(1, 'IT');
    }
  });
});

async function expectHistory(history: Locator, labels: string[]) {
  await expect(history.locator('.timeline-chain')).toHaveCount(0);
  await expect(history.locator('ol.timeline')).toHaveCount(1);
  await expect(history.locator('.timeline strong')).toHaveText(labels);
}
