import { expect, test } from '@playwright/test';
import { cleanRequestData, ensureTestLogins } from './db';
import { login } from './login';

test.describe('Service request user journey', () => {
  test.beforeEach(async () => {
    await ensureTestLogins();
    await cleanRequestData();
  });

  test.afterEach(async () => {
    await cleanRequestData();
  });

  test('John creates a request and Chadi starts it', async ({ page }) => {
    await login(page, 'john@operations-hub.test');
    await expect(page.getByTestId('signed-in-name')).toContainText('John');

    await page.getByLabel('Department').selectOption({ label: 'IT' });
    await page.getByLabel('Request type').selectOption({ label: 'General' });
    await page.getByRole('button', { name: 'Create Request' }).click();

    await expect(page.getByTestId('request-status')).toHaveText('SUBMITTED');
    const requestIdText = await page.getByTestId('request-id').innerText();
    const requestId = requestIdText.replace('#', '').trim();
    expect(requestId).toMatch(/^\d+$/);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await login(page, 'chadi@operations-hub.test');
    await expect(page.getByTestId('signed-in-name')).toContainText('Chadi');
    await expect(page.getByTestId('request-status')).toHaveCount(0);

    await page.getByLabel('Request ID').fill(requestId);
    await page.getByRole('button', { name: 'Load Request' }).click();

    await expect(page.getByTestId('request-status')).toHaveText('SUBMITTED');
    await expect(page.getByText('Submitter', { exact: true })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: /^John$/ })).toBeVisible();

    await page.getByRole('button', { name: 'Assign owner' }).click();
    await expect(page.getByRole('definition').filter({ hasText: /^Chadi$/ })).toBeVisible();

    await page.getByRole('button', { name: 'Start Request' }).click();
    await expect(page.getByTestId('request-status')).toHaveText('IN PROGRESS');

    const history = page.getByTestId('status-history');
    await expect(history).toContainText('SUBMITTED → IN PROGRESS');
    await expect(history).toContainText('by Chadi');
  });
});
