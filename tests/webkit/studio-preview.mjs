// WebKit（Safari 引擎）檢查：進入人像／仿色時預覽是否還在。由 .github/workflows/webkit-check.yml 執行，結果印在 log。
import { webkit } from 'playwright';
const b = await webkit.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('pageerror ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 200)); });
await page.addInitScript(() => { globalThis.__ABAI_ALLOW_SOFT_GL = true; });
await page.goto('http://127.0.0.1:4173/art-qa.html?editor&luts&large&blob&full'); await page.waitForTimeout(12000);
const lum = async (label) => {
  const png = await page.screenshot({ clip: { x: 20, y: 120, width: 350, height: 420 } });
  const v = await page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0, mx = 0;
    for (let i = 0; i < d.length; i += 16) { const y = (d[i] + d[i + 1] + d[i + 2]) / 3; s += y; n++; if (y > mx) mx = y; }
    return { mean: Math.round(s / n), max: Math.round(mx) };
  }, png.toString('base64'));
  console.log(label, JSON.stringify(v));
};
await lum('editor');
const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); return !!c; });
console.log('webgl2', gl);
for (const sh of [0, 1]) {
  if (sh) {
    await page.click('[data-edit-tab="adjust"]'); await page.waitForTimeout(800);
    await page.getByText('陰影', { exact: true }).first().click(); await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const e = document.querySelector('input.custom-range'); const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    await page.mouse.click(r[0] + 32 + (r[2] - 64) * 0.15, r[1] + r[3] / 2); await page.waitForTimeout(3000);
    await lum('editor+shadows');
  }
  for (const t of ['beauty', 'match']) {
    await page.click(`[data-edit-tab="${t}"]`); await page.waitForTimeout(4000);
    await lum(`${t} (shadows=${sh})`);
    await page.click('[data-edit-tab="adjust"]'); await page.waitForTimeout(1500);
  }
}
console.log('ERRORS', JSON.stringify(errs.slice(0, 15)));
await b.close();
