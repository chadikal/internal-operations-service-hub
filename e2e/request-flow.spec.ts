import { expect, test } from '@playwright/test';
import { cleanRequestData } from './db';

test.describe('Service request user journey', () => {
  test.beforeEach(async () => {
    await cleanRequestData();
  });

  test.afterEach(async () => {
    await cleanRequestData();
  });

  test('John creates a request and Chadi starts it', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'John' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chadi' })).toBeVisible();

    await page.getByRole('button', { name: 'John' }).click();
    await page.getByLabel('Department').selectOption({ label: 'IT' });
    await page.getByRole('button', { name: 'Create Request' }).click();

    await expect(page.getByTestId('request-status')).toHaveText('SUBMITTED');
    const requestIdText = await page.getByTestId('request-id').innerText();
    const requestId = requestIdText.replace('#', '').trim();
    expect(requestId).toMatch(/^\d+$/);

    await page.getByRole('button', { name: 'Chadi' }).click();
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
