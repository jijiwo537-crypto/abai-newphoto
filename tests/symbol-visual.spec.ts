import { test, expect } from '@playwright/test';

test('every symbol is tightly enclosed and animation returns pixel-perfectly', async ({ page }, info) => {
  test.setTimeout(360000);
  await page.goto('/tests/symbol-visual.html');
  await page.waitForFunction(() => window.__symbolReport?.done, undefined, { timeout: 300000 });
  const report = await page.evaluate(() => window.__symbolReport);
  /* 168 張卡片的 full-page PNG 在 Retina runner 可超過 1GB；像素驗證已在
     Canvas 逐顆完成，這裡只保留目前 viewport 作為人工抽查證據。 */
  await page.screenshot({ path: `test-results/symbol-contact-${info.project.name}.png` });
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

test('opening the animation panel stays responsive on iPhone', async ({ page }, info) => {
  test.skip(info.project.name !== 'webkit-iphone');
  test.setTimeout(60000);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /創意拼圖/ }).click();
  await (await chooser).setFiles('public/icon-source.jpg');
  await page.waitForTimeout(600);
  const viewport = page.viewportSize();
  const tabY = (viewport?.height || 844) - 275;
  await page.mouse.click(195, tabY); // 新增分頁
  await page.getByRole('button', { name: /新增符號/ }).click();
  await page.locator('button[aria-label]').nth(13).click();
  await page.waitForTimeout(800); // 讓單顆放置符號在 idle slot 完成母片

  const started = Date.now();
  await page.mouse.click(339, tabY); // 動畫分頁
  await page.getByText('進場動畫', { exact: true }).waitFor({ state: 'visible', timeout: 1500 });
  const openMs = Date.now() - started;
  const nextFrame = await page.evaluate(() => new Promise<boolean>(resolve => requestAnimationFrame(() => resolve(true))));
  console.log(`iPhone animation panel opened in ${openMs}ms`);
  expect(openMs).toBeLessThan(1000);
  expect(nextFrame).toBe(true);
});
