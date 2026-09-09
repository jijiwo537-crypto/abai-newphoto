import { test, expect } from '@playwright/test';

test('every symbol is tightly enclosed and animation returns pixel-perfectly', async ({ page }, info) => {
  await page.goto('/tests/symbol-visual.html');
  await page.waitForFunction(() => window.__symbolReport?.done, undefined, { timeout: 180000 });
  const report = await page.evaluate(() => window.__symbolReport);
  await page.screenshot({ path: `test-results/symbol-contact-${info.project.name}.png`, fullPage: true });
  expect(report?.failed, JSON.stringify(report?.failed?.slice(0, 10), null, 2)).toEqual([]);
});