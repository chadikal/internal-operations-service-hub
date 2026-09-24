import { expect, Page } from '@playwright/test';
import { TEST_PASSWORD } from './db';

export async function login(page: Page, email: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Acting as' })).toHaveCount(0);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('signed-in-name')).toBeVisible();
}
