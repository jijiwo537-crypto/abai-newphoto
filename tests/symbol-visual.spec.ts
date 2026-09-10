import { test, expect } from '@playwright/test';

test('every symbol is tightly enclosed and animation returns pixel-perfectly', async ({ page }, info) => {
  test.setTimeout(360000);
  await page.goto('/tests/symbol-visual.html');
  await page.waitForFunction(() => window.__symbolReport?.done, undefined, { timeout: 300000 });
  const report = await page.evaluate(() => window.__symbolReport);
  if (info.project.name === 'chromium') {
    await page.screenshot({ path: `test-results/symbol-contact-${info.project.name}.png`, fullPage: true });
  } else {
    await page.screenshot({ path: `test-results/symbol-contact-${info.project.name}.png` });
  }
  console.log(`Pixel-verified ${report?.total ?? 0} symbols in ${info.project.name}; failures: ${report?.failed?.length ?? -1}`);
  expect(report?.failed?.map((item: any) => item.index), JSON.stringify(report?.failed?.slice(0, 3), null, 2)).toEqual([]);
});

test('the final 12 long symbols stay inside their frames on iPhone', async ({ page }, info) => {
  test.skip(info.project.name !== 'webkit-iphone');
  await page.goto('/tests/symbol-visual.html?tail=12');
  await page.waitForFunction(() => window.__symbolReport?.done, undefined, { timeout: 180000 });
  const report = await page.evaluate(() => window.__symbolReport);
  await page.screenshot({ path: 'test-results/symbol-tail-iphone.png', fullPage: true });
  console.log(`iPhone tail symbols: ${report?.total ?? 0}; failures: ${report?.failed?.length ?? -1}`);
  expect(report?.total).toBe(12);
  expect(report?.failed, JSON.stringify(report?.failed, null, 2)).toEqual([]);
});
