import { expect, test } from '@playwright/test';
import { addDevelopmentRequestType, cleanRequestData, countRequests, ensureTestLogins, removeRequestTypes } from './db';
import { login } from './login';

test.describe('Request intake', () => {
  test.beforeEach(async () => {
    await ensureTestLogins();
    await cleanRequestData();
  });

  test.afterEach(async () => {
    await cleanRequestData();
  });

  test('thin input asks for more detail and does not offer Prepare a request', async ({
    page,
  }) => {
    await login(page, 'john@operations-hub.test');
    await page.getByRole('button', { name: 'AI Intake' }).click();

    await page.getByLabel('What do you need?').fill('I need help.');
    await page.getByRole('button', { name: 'Analyze' }).click();

    const missing = page.getByTestId('intake-missing-information');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('Some information is missing');
    await expect(page.getByTestId('intake-need-more')).toBeVisible();
    await expect(page.getByTestId('intake-need-more')).toContainText(
      'provide the missing details so we can understand your request',
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
    await login(page, 'john@operations-hub.test');
    await page.getByRole('button', { name: 'AI Intake' }).click();

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
    await login(page, 'john@operations-hub.test');
    await page.getByRole('button', { name: 'AI Intake' }).click();

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

  test('optional suggestions do not block preparing a request', async ({ page }) => {
    await login(page, 'john@operations-hub.test');
    await page.getByRole('button', { name: 'AI Intake' }).click();

    await page.getByLabel('What do you need?').fill('I need an employment certificate from HR.');
    await page.getByRole('button', { name: 'Analyze' }).click();

    const suggestions = page.getByTestId('intake-suggestions');
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toContainText('Purpose or recipient of the certificate');
    await expect(page.getByTestId('intake-missing-information')).toHaveCount(0);
    await expect(page.getByTestId('intake-need-more')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prepare a request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'No thanks' })).toBeVisible();
    await expect(page.getByTestId('request-id')).toHaveCount(0);
  });

  test('required missing information hides prepare until a later analysis succeeds', async ({
    page,
  }) => {
    await login(page, 'john@operations-hub.test');
    await page.getByRole('button', { name: 'AI Intake' }).click();

    let intakeCalls = 0;
    await page.route('**/ai/intake', async (route) => {
      intakeCalls += 1;
      if (intakeCalls === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            situation: 'need',
            troubleshootingSteps: [],
            missingInformation: ['Which dates the certificate should cover'],
            suggestions: ['Preferred language'],
            draft: {
              departmentId: 2,
              summary: 'Employment certificate',
              description: 'I need an employment certificate.',
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByLabel('What do you need?').fill('I need an employment certificate.');
    await page.getByRole('button', { name: 'Analyze' }).click();

    const missing = page.getByTestId('intake-missing-information');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('Which dates the certificate should cover');
    await expect(page.getByTestId('intake-suggestions')).toContainText('Preferred language');
    await expect(page.getByTestId('intake-need-more')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prepare a request' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'No thanks' })).toHaveCount(0);

    await page
      .getByLabel('What do you need?')
      .fill('I need an employment certificate from HR covering January 2024 through December 2024.');
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(page.getByRole('button', { name: 'Prepare a request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'No thanks' })).toBeVisible();
    await expect(page.getByTestId('intake-missing-information')).toHaveCount(0);
    await expect(page.getByTestId('intake-need-more')).toHaveCount(0);
    await expect(page.getByTestId('intake-suggestions')).toBeVisible();
    await expect(page.getByTestId('request-id')).toHaveCount(0);
  });

  test('an uncertain request type cannot be submitted until the user selects one', async ({
    page,
  }) => {
    await login(page, 'john@operations-hub.test');
    await page.getByRole('button', { name: 'AI Intake' }).click();

    await page.getByLabel('What do you need?').fill("I can't access the VPN; I need permission.");
    await page.getByRole('button', { name: 'Analyze' }).click();

    await expect(page.getByTestId('troubleshooting-steps')).toBeVisible();
    await page.getByRole('button', { name: 'No, still unresolved' }).click();
    await page.getByRole('button', { name: 'Prepare a request' }).click();

    const draft = page.getByTestId('intake-draft-form');
    await expect(draft.getByLabel('Request type')).toHaveValue('');
    await expect(page.getByTestId('intake-type-choice')).toContainText(
      'Choose a request type before submitting',
    );
    await expect(draft.getByRole('button', { name: 'Create Request' })).toBeDisabled();
    await expect(page.getByTestId('request-id')).toHaveCount(0);

    await draft.getByLabel('Request type').selectOption({ label: 'General' });
    await expect(draft.getByRole('button', { name: 'Create Request' })).toBeEnabled();
    await expect(page.getByTestId('request-id')).toHaveCount(0);
  });

  test('a failing VPN client draft with no type can select IT Software without submitting', async ({
    page,
  }) => {
    const software = await addDevelopmentRequestType('IT', 'Software');
    try {
      await login(page, 'john@operations-hub.test');
      await page.getByRole('button', { name: 'AI Intake' }).click();
      await page.route('**/ai/intake', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            situation: 'problem',
            troubleshootingSteps: [
              'Restart the VPN client.',
              'Check the network connection.',
              'Try the connection again.',
            ],
            missingInformation: [],
            suggestions: ['Choose a request type for this failing VPN client.'],
            draft: {
              departmentId: software.departmentId,
              requestTypeId: null,
              summary: 'VPN client will not connect',
              description: 'The VPN client will not connect.',
            },
          }),
        });
      });

      await page.getByLabel('What do you need?').fill('The VPN client will not connect.');
      await page.getByRole('button', { name: 'Analyze' }).click();

      await expect(page.getByTestId('troubleshooting-steps')).toBeVisible();
      await page.getByRole('button', { name: 'No, still unresolved' }).click();
      await page.getByRole('button', { name: 'Prepare a request' }).click();

      const draft = page.getByTestId('intake-draft-form');
      await expect(draft.getByLabel('Request type')).toHaveValue('');
      await expect(draft.getByLabel('Request type').locator('option')).toContainText(['Software']);
      await expect(page.getByTestId('intake-type-choice')).toContainText(
        'Choose a request type before submitting',
      );
      await expect(draft.getByRole('button', { name: 'Create Request' })).toBeDisabled();

      await draft.getByLabel('Request type').selectOption({ label: 'Software' });
      await expect(draft.getByRole('button', { name: 'Create Request' })).toBeEnabled();
      await expect(page.getByTestId('request-id')).toHaveCount(0);
      expect(await countRequests()).toBe(0);
    } finally {
      await removeRequestTypes([software.id]);
    }
  });
});
