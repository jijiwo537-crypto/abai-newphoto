// WebKit（Safari 引擎）檢查：無縫拼圖「預覽 vs 存出來的成品」是否一致。由 .github/workflows/webkit-check.yml 執行（script=seam-export）。
// 5 張像真實照片的大圖（3024×4032，有漸層、雜訊、大數字），開無縫、套整體特效，存檔後逐格比對。
import { webkit } from 'playwright';
import fs from 'fs';
fs.mkdirSync('webkit-out', { recursive: true });
const b = await webkit.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', e => errs.push('pageerror ' + e.message));
page.on('crash', () => errs.push('PAGE CRASH'));
page.on('console', m => { if (m.type() === 'error') errs.push('error ' + m.text().slice(0, 200)); });
page.on('dialog', d => { errs.push('dialog ' + d.message()); d.dismiss(); });
await page.addInitScript(() => { globalThis.__ABAI_ALLOW_SOFT_GL = true; });
await page.goto('http://127.0.0.1:4173/'); await page.waitForTimeout(5000);
await page.evaluate(async () => {
  const mk = (i) => new Promise(r => {
    const w = 3024, h = 4032, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, `hsl(${i * 72},70%,35%)`); gr.addColorStop(1, `hsl(${i * 72 + 40},60%,70%)`);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 400; k++) { g.fillStyle = `hsla(${(i * 72 + k * 13) % 360},60%,${30 + k % 50}%,.35)`; g.fillRect((k * 397) % w, (k * 613) % h, 120 + k % 200, 80 + k % 150); }
    g.strokeStyle = '#000'; g.lineWidth = 12; for (let x = 0; x < w; x += w / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += h / 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#fff'; g.font = 'bold 1400px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), w / 2, h / 2);
    cv.toBlob(bl => { cv.width = 1; r(new File([bl], `p${i}.jpg`, { type: 'image/jpeg' })); }, 'image/jpeg', .9);
  });
  const el = document.querySelector('input[data-pick-modes]'); const dt = new DataTransfer();
  for (let i = 0; i < 5; i++) dt.items.add(await mk(i));
  el.files = dt.files; el.dataset.pickMode = 'collage'; el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForSelector('[data-creative-stage]'); await page.waitForTimeout(6000);
console.log('webgl2', await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2')));
// 開無縫
await page.click('[data-creative-tab="setting"]'); await page.waitForTimeout(800);
const sb = await page.locator('[data-creative-seamless] input[type=range]').boundingBox();
await page.mouse.move(sb.x + sb.width * .2, sb.y + sb.height / 2); await page.mouse.down();
await page.mouse.move(sb.x + sb.width * .7, sb.y + sb.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(4000);
const variants = (process.env.VARIANTS || 'plain,gfx').split(',');
const stage = await page.locator('[data-creative-stage]').boundingBox();
for (const v of variants) {
  if (v === 'gfx') {
    const bx = await page.locator('[data-creative-stage] canvas').first().boundingBox();
    await page.click('[data-creative-tab="objedit"]'); await page.waitForTimeout(600);
    await page.mouse.click(5, bx.y + 20); await page.waitForTimeout(800);
    await page.locator('button', { hasText: '特效' }).first().click(); await page.waitForTimeout(600);
    await page.locator('[data-fx-card="fxExposureSpill"]').click().catch(e => errs.push('no fx card ' + e.message.slice(0, 80))); await page.waitForTimeout(4000);
    await page.click('[data-creative-tab="setting"]'); await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000);
  const prev = await page.screenshot({ clip: stage }); fs.writeFileSync(`webkit-out/${v}_prev.png`, prev);
  const t0 = Date.now();
  await page.locator('button', { hasText: /^儲存$/ }).first().click();
  await page.waitForSelector('text=拼下一張', { timeout: 600000 });
  const res = await page.evaluate(async (pb64) => {
    const im = [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 500).sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
    await im.decode().catch(() => {});
    const pv = new Image(); pv.src = 'data:image/png;base64,' + pb64; await pv.decode();
    // 預覽截圖裡找出照片範圍（不是黑底的部分）
    const pc = document.createElement('canvas'); pc.width = pv.width; pc.height = pv.height; const pg = pc.getContext('2d'); pg.drawImage(pv, 0, 0);
    const pd = pg.getImageData(0, 0, pc.width, pc.height).data; let x0 = pc.width, y0 = pc.height, x1 = 0, y1 = 0;
    for (let y = 0; y < pc.height; y += 2) for (let x = 0; x < pc.width; x += 2) { const i = (y * pc.width + x) * 4; if (pd[i] + pd[i + 1] + pd[i + 2] > 75) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const G = 12, W = 240, H = Math.round(W * im.naturalHeight / im.naturalWidth);
    const norm = (src, sx, sy, sw, sh) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H); return g.getImageData(0, 0, W, H, { colorSpace: 'srgb' }).data; };
    const a = norm(pv, x0, y0, x1 - x0, y1 - y0), e = norm(im, 0, 0, im.naturalWidth, im.naturalHeight);
    const cells = []; let worst = 0;
    for (let cy = 0; cy < G; cy++) { const row = []; for (let cx = 0; cx < G; cx++) { let s = 0, n = 0; for (let y = Math.floor(cy * H / G); y < (cy + 1) * H / G; y++) for (let x = Math.floor(cx * W / G); x < (cx + 1) * W / G; x++) { const i = (y * W + x) * 4; s += Math.abs(a[i] - e[i]) + Math.abs(a[i + 1] - e[i + 1]) + Math.abs(a[i + 2] - e[i + 2]); n += 3; } const d = Math.round(s / n); row.push(d); if (d > worst) worst = d; } cells.push(row.join(' ')); }
    const c = document.createElement('canvas'); c.width = Math.min(1200, im.naturalWidth); c.height = Math.round(c.width * im.naturalHeight / im.naturalWidth); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return { dim: im.naturalWidth + 'x' + im.naturalHeight, worst, cells, png: c.toDataURL('image/png').split(',')[1] };
  }, prev.toString('base64'));
  fs.writeFileSync(`webkit-out/${v}_exp.png`, Buffer.from(res.png, 'base64'));
  console.log(`== ${v}: export ${res.dim} in ${Date.now() - t0}ms; worst cell diff ${res.worst} (0–255; >25 = visibly different)`);
  console.log(res.cells.join('\n'));
  await page.locator('button', { hasText: '繼續編輯' }).first().click(); await page.waitForTimeout(3000);
}
console.log('ERRORS', JSON.stringify(errs.slice(0, 20)));
await b.close();
