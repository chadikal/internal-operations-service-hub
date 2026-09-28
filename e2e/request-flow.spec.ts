import { expect, test, type Locator } from '@playwright/test';
import { cleanRequestData, ensureTestLogins, setDevelopmentAccountRole } from './db';
import { login } from './login';

test.describe('Service request user journey', () => {
  test.beforeEach(async () => {
    await ensureTestLogins();
    await setDevelopmentAccountRole(1, 'EMPLOYEE', true);
    await setDevelopmentAccountRole(2, 'EMPLOYEE', false);
    await cleanRequestData();
  });

  test.afterEach(async () => {
    await cleanRequestData();
  });

  test('John creates a request and Chadi claims it through completion', async ({ page }) => {
    await login(page, 'john@operations-hub.test');
    const employeeNav = page.getByRole('navigation', { name: 'Employee' });
    await expect(employeeNav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(employeeNav.getByRole('link', { name: 'My Requests' })).toBeVisible();
    await expect(employeeNav.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(employeeNav.getByRole('link', { name: 'New Request', exact: true })).toHaveCount(0);
    await expect(employeeNav.getByRole('link', { name: 'Requests', exact: true })).toHaveCount(0);
    await expect(employeeNav.getByRole('link', { name: 'Employees' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI Intake' })).toBeVisible();

    await page.getByRole('button', { name: 'New Request' }).click();
    await expect(page).toHaveURL(/\/my-requests\?form=create$/);
    await expect(page.getByTestId('form-overlay')).toBeVisible();
    await page.getByLabel('Department').selectOption({ label: 'HR' });
    await page.getByLabel('Request type').selectOption({ label: 'General' });
    await page.getByLabel('Title').fill('HR desk request');
    await page.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('form-overlay').getByTestId('request-stage')).toHaveText('Awaiting handler');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await page.getByTestId('close-form').click();
    await expect(page.getByTestId('form-overlay')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /HR desk request/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI Intake' })).toBeVisible();

    await page.getByRole('button', { name: 'New Request' }).click();
    await page.getByLabel('Department').selectOption({ label: 'IT' });
    await page.getByLabel('Request type').selectOption({ label: 'General' });
    await page.getByLabel('Title').fill('Printer jam');
    await page.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('form-overlay').getByTestId('request-stage')).toHaveText('Awaiting handler');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await page.getByTestId('close-form').click();

    const longTitle = `${'Cable '.repeat(30)}end`;
    await page.getByRole('button', { name: 'New Request' }).click();
    await page.getByLabel('Department').selectOption({ label: 'IT' });
    await page.getByLabel('Request type').selectOption({ label: 'General' });
    await page.getByLabel('Title').fill(longTitle);
    await page.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('form-overlay').locator('dd', { hasText: longTitle })).toBeVisible();
    await page.getByTestId('close-form').click();

    const rows = page.getByTestId('my-request-table').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId('my-request-table').getByRole('columnheader')).toHaveText([
      'ID',
      'Title',
      'Submitter',
      'Destination Department',
      'Submitted At',
      'Request Stage',
    ]);
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopHeights = await rowHeights(rows);
    expect(Math.max(...desktopHeights) - Math.min(...desktopHeights)).toBeLessThan(2);
    const clamped = rows.filter({ hasText: 'Cable' }).locator('.cell-clamp');
    const clampBox = await clamped.boundingBox();
    expect(clampBox!.height).toBeLessThanOrEqual(Math.min(...desktopHeights));
    await expect(page.getByTestId('form-overlay').getByRole('heading', { name: longTitle })).toHaveCount(0);
    await rows.filter({ hasText: 'Cable' }).getByRole('button', { name: longTitle }).click();
    await expect(page.getByTestId('form-overlay').getByRole('heading', { name: longTitle })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rows.filter({ hasText: 'Cable' }).getByRole('button', { name: longTitle })).toBeFocused();

    await page.setViewportSize({ width: 390, height: 800 });
    const narrowHeights = await rowHeights(rows);
    expect(Math.max(...narrowHeights) - Math.min(...narrowHeights)).toBeLessThan(2);
    expect(Math.abs(narrowHeights[0] - desktopHeights[0])).toBeLessThan(2);
    expect(await page.getByTestId('my-requests').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await login(page, 'chadi@operations-hub.test');
    const handlerNav = page.getByRole('navigation', { name: 'Handler' });
    await handlerNav.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Security' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Company' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'My Department' })).toHaveCount(0);
    await expect(page.getByLabel('Role')).toHaveValue('Handler');
    await handlerNav.getByRole('link', { name: 'Requests', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Available' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Claimed by Me' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Completed' })).toBeVisible();

    await page.getByLabel('Search requests').fill('Printer jam');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('button', { name: /Printer jam/ }).click();
    await expect(page.getByTestId('form-overlay').getByTestId('request-detail')).toBeVisible();
    await expect(page.getByTestId('request-stage')).toHaveText('Awaiting handler');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Claim' }).click();
    await expect(page.getByTestId('request-stage')).toHaveText('Claimed');
    const claimedRow = page
      .getByTestId('status-history')
      .locator('.timeline li')
      .filter({ has: page.locator('strong', { hasText: /^Claimed$/ }) });
    await expect(claimedRow.locator('span')).toHaveText(/^by Chadi · .+/);
    await page.getByTestId('close-form').click();
    await page.getByRole('tab', { name: 'Claimed by Me' }).click();
    await page.getByRole('button', { name: /Printer jam/ }).click();
    await expect(claimedRow.locator('span')).toHaveText(/^by Chadi · .+/);
    await page.getByRole('button', { name: 'Start Work' }).click();
    await expect(page.getByTestId('request-stage')).toHaveText('In progress');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Complete' }).click();
    await page.getByTestId('close-form').click();
    await page.getByRole('tab', { name: 'Completed' }).click();
    await page.getByRole('button', { name: /Printer jam/ }).click();
    await expect(page.getByTestId('request-stage')).toHaveText('Completed');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Printer jam/ })).toBeFocused();
  });

  test('a Department Admin handles department requests even without the stored handler flag', async ({
    page,
  }) => {
    await setDevelopmentAccountRole(1, 'DEPARTMENT_ADMIN', false);
    try {
      await login(page, 'chadi@operations-hub.test');
      const nav = page.getByRole('navigation', { name: 'Department Admin' });
      await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Requests', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'My Requests' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Staff' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Approvals' })).toBeVisible();
      await expect(nav.getByRole('link', { name: /Settings/ })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'New Request', exact: true })).toHaveCount(0);
      await expect(page.getByTestId('department-dashboard-counts')).toBeVisible();
      await expect(page.getByTestId('department-employees')).toBeVisible();
      await expect(page.getByTestId('department-requests')).toBeVisible();
      await expect(page.getByTestId('department-unclaimed')).toBeVisible();
      await expect(page.getByTestId('department-claimed')).toBeVisible();
      await expect(page.getByTestId('department-pending-approvals')).toBeVisible();
      await expect(page.getByRole('button', { name: 'New Request' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'AI Intake' })).toBeVisible();
      await page.getByRole('button', { name: 'AI Intake' }).click();
      await expect(page).toHaveURL(/\/my-requests\?form=intake$/);
      await expect(page.getByTestId('form-overlay')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Request Intake' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);
      await page.getByTestId('close-form').click();
      await nav.getByRole('link', { name: 'Staff' }).click();
      await expect(page.getByTestId('department-employee-table')).toBeVisible();
      await nav.getByRole('link', { name: 'Requests', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Requests', exact: true })).toBeVisible();
      await expect(page.getByTestId('queue-table')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Available' })).toBeVisible();
      await nav.getByRole('link', { name: 'Approvals' }).click();
      await expect(page.getByTestId('approval-inbox')).toBeVisible();
    } finally {
      await setDevelopmentAccountRole(1, 'EMPLOYEE', true);
    }
  });

  test('the request form stays in an overlay and keeps unsent input', async ({ page }) => {
    await login(page, 'john@operations-hub.test');
    await page.getByRole('button', { name: 'New Request' }).click();
    await expect(page).toHaveURL(/\/my-requests\?form=create$/);
    await expect(page.getByTestId('my-requests')).toBeVisible();
    await expect(page.getByTestId('close-form')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const stayedInside = await page.evaluate(
      () => document.activeElement?.closest('[data-testid="form-overlay"]') != null,
    );
    expect(stayedInside).toBe(true);
    await page.getByLabel('Title').fill('Unsent desk note');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('form-overlay')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Request' })).toBeFocused();

    await page.setViewportSize({ width: 390, height: 640 });
    await page.getByRole('button', { name: 'New Request' }).click();
    const box = await page.getByTestId('form-overlay').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect((box!.y ?? 0) + (box!.height ?? 0)).toBeLessThanOrEqual(640);
    await expect(page.getByLabel('Title')).toHaveValue('Unsent desk note');
    await page.getByLabel('Department').selectOption({ label: 'IT' });
    await page.getByLabel('Request type').selectOption({ label: 'General' });
    await page.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByTestId('form-overlay').getByTestId('request-stage')).toHaveText('Awaiting handler');
    await expect(page.getByTestId('form-overlay').getByText('Work Status', { exact: true })).toHaveCount(0);
    await page.getByTestId('close-form').click();
    const card = page.getByRole('button', { name: /Unsent desk note/ });
    await expect(card).toBeVisible();
    const row = page.getByTestId('my-request-table').locator('tbody tr', { hasText: 'Unsent desk note' });
    const requestId = (await row.getByRole('button').first().innerText()).replace('#', '').trim();
    await page.getByLabel('Search my requests').fill(requestId);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('my-request-table').locator('tbody tr')).toHaveCount(1);
    await card.click();
    await expect(page.getByTestId('form-overlay').getByTestId('request-detail')).toBeVisible();
    await expect(page.getByTestId('close-form')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('form-overlay')).toHaveCount(0);
    await expect(card).toBeFocused();
  });
});

async function rowHeights(rows: Locator) {
  const count = await rows.count();
  const heights: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const box = await rows.nth(index).boundingBox();
    heights.push(box?.height ?? 0);
  }
  return heights;
}
