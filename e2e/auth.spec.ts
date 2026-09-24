import { expect, test } from '@playwright/test';
import { cleanRequestData, ensureTestLogins, TEST_PASSWORD } from './db';
import { login } from './login';

test.describe('Account login', () => {
  test.beforeEach(async () => {
    await ensureTestLogins();
    await cleanRequestData();
  });

  test('rejects a wrong password and returns to the login form after logout', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('john@operations-hub.test');
    await page.getByLabel('Password').fill('wrong-password-value');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);

    await login(page, 'john@operations-hub.test');
    await expect(page.getByRole('heading', { name: 'Create Request' })).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Request' })).toHaveCount(0);
  });

  test('clears the previous account after session expiry and a new login', async ({ page }) => {
    await login(page, 'john@operations-hub.test');
    const createCard = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Create Request', level: 2 }),
    });
    await createCard.getByLabel('Department').selectOption({ label: 'IT' });
    await createCard.getByLabel('Title').fill('John private title');
    await createCard.getByRole('button', { name: 'Create Request' }).click();
    await expect(page.getByText('John private title')).toBeVisible();
    const requestId = (await page.getByTestId('request-id').innerText()).replace('#', '').trim();

    let releaseStale = () => undefined;
    const released = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    await page.route('**/requests/**', async (route) => {
      const incoming = route.request();
      const url = incoming.url();
      if (incoming.method() === 'GET' && /\/requests\/\d+\/history$/.test(url)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Authentication is required', statusCode: 401 }),
        });
        return;
      }
      if (incoming.method() === 'GET' && /\/requests\/\d+$/.test(url)) {
        await released;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: Number(requestId),
            submittedBy: 2,
            departmentId: 1,
            currentOwnerId: null,
            status: 'SUBMITTED',
            statusUpdatedAt: new Date().toISOString(),
            title: 'STALE-SESSION-PAYLOAD',
            description: 'STALE-SESSION-PAYLOAD',
            submitter: { id: 2, name: 'John' },
            department: { id: 1, name: 'IT' },
            currentOwner: null,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByLabel('Request ID').fill(requestId);
    await page.getByRole('button', { name: 'Load Request' }).click();
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.getByText('John private title')).toHaveCount(0);
    await expect(page.getByTestId('request-status')).toHaveCount(0);

    await page.getByLabel('Email').fill('chadi@operations-hub.test');
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('signed-in-name')).toContainText('Chadi');
    await expect(page.getByText('John private title')).toHaveCount(0);
    await expect(page.getByTestId('request-status')).toHaveCount(0);

    const staleResponse = page.waitForResponse(
      (response) => /\/requests\/\d+$/.test(response.url()) && response.request().method() === 'GET',
    );
    releaseStale();
    await staleResponse;
    await expect(page.getByText('STALE-SESSION-PAYLOAD')).toHaveCount(0);
    await expect(page.getByText('John private title')).toHaveCount(0);
    await expect(page.getByTestId('signed-in-name')).toContainText('Chadi');
  });
});
