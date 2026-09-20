import { expect, test } from '@playwright/test';
import { cleanRequestData } from './db';

test.describe('Request intake', () => {
  test.beforeEach(async () => {
    await cleanRequestData();
  });

  test.afterEach(async () => {
    await cleanRequestData();
  });

  test('thin input asks for more detail and does not offer Prepare a request', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByLabel('What do you need?').fill('I need help.');
    await page.getByRole('button', { name: 'Analyze' }).click();

    const missing = page.getByTestId('intake-missing-information');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('Some information is missing');
    await expect(page.getByTestId('intake-need-more')).toBeVisible();
    await expect(page.getByTestId('intake-need-more')).toContainText(
      'provide a little more detail so we can understand your request',
    );

    await expect(
      page.getByText('This looks like a straightforward request, so troubleshooting is not needed.'),
    ).toHaveCount(0);
    await expect(page.getByTestId('troubleshooting-steps')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare a request' })).toHaveCount(0);
    await expect(page.getByTestId('request-id')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible();
    await expect(page.getByLabel('What do you need?')).toBeEnabled();

    await page.getByLabel('What do you need?').fill('I need a laptop.');
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(
      page.getByText('This looks like a straightforward request, so troubleshooting is not needed.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prepare a request' })).toBeVisible();
    await expect(page.getByTestId('intake-need-more')).toHaveCount(0);
    await expect(page.getByLabel('What do you need?')).toHaveValue('I need a laptop.');
    await expect(page.getByLabel('What do you need?')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible();
    await expect(page.getByTestId('request-id')).toHaveCount(0);
  });

  test('clear need still offers to prepare a request', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('What do you need?').fill('I need a laptop.');
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(
      page.getByText('This looks like a straightforward request, so troubleshooting is not needed.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prepare a request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible();
    await expect(page.getByLabel('What do you need?')).toBeEnabled();
    await expect(page.getByLabel('What do you need?')).toHaveValue('I need a laptop.');
    await expect(page.getByTestId('troubleshooting-steps')).toHaveCount(0);
    await expect(page.getByTestId('intake-need-more')).toHaveCount(0);
    await expect(page.getByTestId('request-id')).toHaveCount(0);
  });

  test('failed re-analyze does not keep the previous AI result', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('What do you need?').fill('I need a laptop.');
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByRole('button', { name: 'Prepare a request' })).toBeVisible();

    await page.route('**/ai/intake', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'The intake assistant is unavailable. Try again later.',
          error: 'Service Unavailable',
          statusCode: 503,
        }),
      });
    });

    const updatedText =
      'I need an employment certificate from HR. Purpose: visa application.';
    await page.getByLabel('What do you need?').fill(updatedText);
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(page.getByRole('alert')).toContainText('unavailable');
    await expect(page.getByRole('button', { name: 'Prepare a request' })).toHaveCount(0);
    await expect(
      page.getByText('This looks like a straightforward request, so troubleshooting is not needed.'),
    ).toHaveCount(0);
    await expect(page.getByTestId('intake-missing-information')).toHaveCount(0);
    await expect(page.getByTestId('troubleshooting-steps')).toHaveCount(0);
    await expect(page.getByLabel('What do you need?')).toHaveValue(updatedText);
    await expect(page.getByTestId('request-id')).toHaveCount(0);
  });
});
