import { test, expect } from '@playwright/test';
import { SYMBOLS } from '../utils/symbols';

test('every symbol is tightly enclosed and animation returns pixel-perfectly', async ({ page }, info) => {
  test.setTimeout(360000);
  const failed:any[]=[];
  let verified=0;
  /* Mobile WebKit 會延後回收已導航頁面的 Retina Canvas。分成小批重開頁面，
     仍逐顆驗證 168 顆，但不讓測試環境累積數 GB backing store。 */
  for(let start=0;start<SYMBOLS.length;start+=18){
    await page.goto(`/tests/symbol-visual.html?start=${start}&count=18`);
    await page.waitForFunction(() => window.__symbolReport?.done, undefined, { timeout: 90000 });
    const chunk=await page.evaluate(() => window.__symbolReport);
    verified+=chunk?.total||0;
    failed.push(...(chunk?.failed||[]));
    if(start===0)await page.screenshot({path:`test-results/symbol-focus-${info.project.name}.png`,fullPage:true});
  }
  await page.screenshot({path:`test-results/symbol-tail-${info.project.name}.png`,fullPage:true});
  console.log(`Pixel-verified ${verified} symbols in ${info.project.name}; failures: ${failed.length}`);
  expect(verified).toBe(SYMBOLS.length);
  expect(failed.map((item: any) => item.sourceIndex),JSON.stringify(failed.slice(0,3),null,2)).toEqual([]);
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
