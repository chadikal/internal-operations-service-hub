import { expect, Locator, Page } from '@playwright/test';

const PRIMARY = 'rgb(31, 78, 121)';
const SOFT = 'rgb(93, 137, 176)';

async function colorOf(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).color);
}

export async function expectMainLinkEmphasis(link: Locator) {
  const total = link.locator('.summary-total');
  const label = link.locator('.summary-label');
  const icon = link.locator('.summary-icon');
  await link.hover();
  await expect.poll(() => colorOf(total)).toBe(PRIMARY);
  expect(await colorOf(label)).toBe(PRIMARY);
  expect(await colorOf(icon)).toBe(PRIMARY);
  expect(await link.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await link.evaluate((element: HTMLElement) => element.focus({ focusVisible: true }));
  expect(await colorOf(total)).toBe(PRIMARY);
  expect(await colorOf(label)).toBe(PRIMARY);
  expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
}

export async function expectBreakdownEmphasis(link: Locator) {
  await link.hover();
  await expect.poll(() => colorOf(link.locator('span'))).toBe(SOFT);
  expect(await colorOf(link.locator('strong'))).toBe(SOFT);
  expect(await link.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await link.evaluate((element: HTMLElement) => element.focus({ focusVisible: true }));
  expect(await colorOf(link.locator('span'))).toBe(SOFT);
  expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
}

export async function expectBreakdownFits(card: Locator) {
  const rows = card.locator('.summary-breakdown li');
  const count = await rows.count();
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const body = rows.nth(index).locator('a, .summary-static');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    const clipped = await body.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
    );
    expect(clipped).toBe(false);
    const numberBox = await body.locator('strong').boundingBox();
    expect(numberBox).not.toBeNull();
    expect(numberBox!.x).toBeGreaterThanOrEqual(box!.x - 1);
    expect(numberBox!.x + numberBox!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    boxes.push(box!);
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      const separated =
        a.x + a.width <= b.x + 1 ||
        b.x + b.width <= a.x + 1 ||
        a.y + a.height <= b.y + 1 ||
        b.y + b.height <= a.y + 1;
      expect(separated).toBe(true);
    }
  }
}

export async function clickCardPadding(page: Page, card: Locator) {
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + 10, box!.y + box!.height - 10);
}
