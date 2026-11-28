// 核心回歸測試：每次改版都跑，確認最容易被改壞的幾件事沒有退步。
// 用法：先開 vite（npx vite --port 4321），再 node tests/regression/core.mjs
// 任何一項不通過，結束碼為 1（雲端工作流程會顯示失敗）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4321/';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

const launch = () => chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
async function newPage(b) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.setDefaultTimeout(240000);
  p.on('dialog', d => d.dismiss());
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    globalThis.__ABAI_ALLOW_SOFT_GL = true;
    const urls = new Set(); const cu = URL.createObjectURL; URL.createObjectURL = function (x) { const u = cu.call(URL, x); urls.add(u); return u; };
    const ru = URL.revokeObjectURL; URL.revokeObjectURL = function (u) { urls.delete(u); return ru.call(URL, u); };
    window.__urlCount = () => urls.size;
  });
  await p.goto(BASE); await p.waitForTimeout(3500);
  return { p, errors };
}
/** 在頁面裡做幾張有內容的測試照片並導入 */
async function importPhotos(p, n, mode, w = 2400, h = 3200, sel = 'input[data-pick-modes]') {
  await p.evaluate(async ([n, mode, w, h, sel]) => {
    const mk = (i) => new Promise(r => {
      const cv = document.createElement('canvas'); cv.width = i % 2 ? h : w; cv.height = i % 2 ? w : h; const g = cv.getContext('2d');
      const gr = g.createLinearGradient(0, 0, cv.width, cv.height); gr.addColorStop(0, `hsl(${i * 72},70%,40%)`); gr.addColorStop(1, `hsl(${i * 72 + 50},60%,70%)`);
      g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = '#000'; g.lineWidth = 10; for (let x = 0; x < cv.width; x += cv.width / 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke(); }
      g.fillStyle = '#fff'; g.font = `bold ${cv.height / 3}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), cv.width / 2, cv.height / 2);
      cv.toBlob(bl => { cv.width = 1; r(new File([bl], `p${i}.jpg`, { type: 'image/jpeg' })); }, 'image/jpeg', .92);
    });
    const el = document.querySelector(sel); const dt = new DataTransfer();
    for (let i = 0; i < n; i++) dt.items.add(await mk(i));
    el.files = dt.files; if (mode) el.dataset.pickMode = mode; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [n, mode, w, h, sel]);
}
/** 預覽截圖 vs 成品：都縮到同一個大小、切 6×8 格，回傳最差的那一格的平均差（0～255）與成品資訊 */
async function compareWithExport(p, previewPng) {
  return p.evaluate(async (b64) => {
    const im = [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 500).sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
    if (!im) return { error: 'no exported image' };
    await im.decode().catch(() => {});
    const pv = new Image(); pv.src = 'data:image/png;base64,' + b64; await pv.decode();
    const pc = document.createElement('canvas'); pc.width = pv.width; pc.height = pv.height; const pg = pc.getContext('2d'); pg.drawImage(pv, 0, 0);
    const pd = pg.getImageData(0, 0, pc.width, pc.height).data; let x0 = pc.width, y0 = pc.height, x1 = 0, y1 = 0;
    for (let y = 0; y < pc.height; y += 2) for (let x = 0; x < pc.width; x += 2) { const i = (y * pc.width + x) * 4; if (pd[i] + pd[i + 1] + pd[i + 2] > 75) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const W = 120, H = Math.round(W * im.naturalHeight / im.naturalWidth);
    const norm = (src, sx, sy, sw, sh) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H); return g.getImageData(0, 0, W, H, { colorSpace: 'srgb' }).data; };
    const a = norm(pv, x0, y0, x1 - x0, y1 - y0), e = norm(im, 0, 0, im.naturalWidth, im.naturalHeight);
    let worst = 0, lum = 0;
    // 最底下那排略過：預覽上疊著介面按鈕（圖層、前後對比），成品裡本來就沒有
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 6; gx++) { let s = 0, n = 0;
      for (let y = Math.floor(gy * H / 8); y < (gy + 1) * H / 8; y++) for (let x = Math.floor(gx * W / 6); x < (gx + 1) * W / 6; x++) { const i = (y * W + x) * 4; s += Math.abs(a[i] - e[i]) + Math.abs(a[i + 1] - e[i + 1]) + Math.abs(a[i + 2] - e[i + 2]); n += 3; }
      worst = Math.max(worst, s / n); }
    for (let i = 0; i < e.length; i += 4) lum += e[i] + e[i + 1] + e[i + 2];
    return { worst: Math.round(worst), meanLum: Math.round(lum / (e.length / 4) / 3), size: im.naturalWidth + 'x' + im.naturalHeight };
  }, previewPng.toString('base64'));
}
async function save(p, doneText, label = /^儲存$/) {
  await p.locator('button', { hasText: label }).first().click();
  await p.waitForSelector(`text=${doneText}`, { timeout: 600000 });
  await p.waitForTimeout(1500);
}

// ── 1. 編輯：套濾鏡，預覽 ＝ 成品 ─────────────────────────
async function editorFilter(b) {
  const { p, errors } = await newPage(b);
  await importPhotos(p, 1, 'edit');
  await p.waitForTimeout(7000);
  await p.getByText('F3', { exact: true }).first().click();
  await p.waitForTimeout(3000);
  const box = await p.locator('canvas').first().boundingBox();
  const prev = await p.screenshot({ clip: { x: 0, y: Math.max(0, box.y - 10), width: 390, height: Math.min(844 - box.y, box.height + 20) } });
  await save(p, '修下一張');
  if (process.env.DUMP) require('fs').writeFileSync('reg_editor_prev.png', prev);
  const r = await compareWithExport(p, prev);
  check('編輯：套濾鏡後預覽 ＝ 成品', !r.error && r.worst <= 12 && r.meanLum > 20, JSON.stringify(r));
  check('編輯：沒有程式錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}

// ── 2. 編輯的拼圖：5 張、無縫、整體特效，預覽 ＝ 成品 ────────
async function collageSeamless(b) {
  const { p, errors } = await newPage(b);
  await importPhotos(p, 5, 'collage');
  await p.waitForSelector('[data-creative-stage]'); await p.waitForTimeout(4000);
  await p.click('[data-creative-tab="setting"]'); await p.waitForTimeout(600);
  const sb = await p.locator('[data-creative-seamless] input[type=range]').boundingBox();
  await p.mouse.move(sb.x + sb.width * .2, sb.y + sb.height / 2); await p.mouse.down();
  await p.mouse.move(sb.x + sb.width * .7, sb.y + sb.height / 2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(3000);
  const stage = await p.locator('[data-creative-stage]').boundingBox();
  await p.click('[data-creative-tab="objedit"]'); await p.waitForTimeout(600);
  await p.mouse.click(5, stage.y + 20); await p.waitForTimeout(800);
  await p.locator('button', { hasText: '特效' }).first().click(); await p.waitForTimeout(600);
  await p.locator('[data-fx-card="fxExposureSpill"]').click(); await p.waitForTimeout(4000);
  await p.click('[data-creative-tab="setting"]'); await p.waitForTimeout(60000);   // 軟體 GPU 慢：等畫面完全畫好
  const prev = await p.screenshot({ clip: stage, timeout: 300000 });
  await save(p, '拼下一張');
  const r = await compareWithExport(p, prev);
  check('編輯的拼圖：無縫＋整體特效，預覽 ＝ 成品', !r.error && r.worst <= 30 && r.meanLum > 20, JSON.stringify(r));
  check('編輯的拼圖：沒有程式錯誤', errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}

// ── 3. 原尺寸存檔：大圖，流量控制、成品尺寸與內容 ───────────
async function fullRes(b) {
  const { p } = await newPage(b);
  const r = await p.evaluate(async () => {
    const m = await import('/utils/fullResExport.ts');
    const W = 6000, H = 4500, pw = 3200, ph = 2400;
    const big = document.createElement('canvas'); big.width = W; big.height = H; const g = big.getContext('2d');
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#c63'); gr.addColorStop(1, '#36c'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const D = m.originalAt(big, pw, ph); const P = new Uint8ClampedArray(D); for (let i = 0; i < P.length; i += 4) P[i] = Math.min(255, P[i] * 1.2);
    const u = await m.fullResFromProcessed(big, P, D, pw, ph, 'image/jpeg');
    const im = new Image(); im.src = u; await im.decode();
    const c = document.createElement('canvas'); c.width = 60; c.height = 45; c.getContext('2d').drawImage(im, 0, 0, 60, 45);
    const d = c.getContext('2d').getImageData(0, 0, 60, 45).data; let l = 0; for (let i = 0; i < d.length; i += 4) l += d[i] + d[i + 1] + d[i + 2];
    return { size: im.naturalWidth + 'x' + im.naturalHeight, meanLum: Math.round(l / (d.length / 4) / 3) };
  });
  check('原尺寸存檔：成品是原尺寸、有內容', r.size === '6000x4500' && r.meanLum > 20, JSON.stringify(r));
  await p.close();
}

// ── 4. 記憶體：編輯反覆導入，照片檔網址不累積 ───────────────
async function editorLeak(b) {
  const { p } = await newPage(b);
  const counts = [];
  for (let round = 0; round < 3; round++) {
    await importPhotos(p, 1, 'edit', 1200, 1600);
    await p.waitForTimeout(5000);
    for (let k = 0; k < 4; k++) {
      await p.locator('button[aria-label="返回"], header button').first().click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(700);
      await p.locator('button', { hasText: /^(放棄|不儲存|離開)$/ }).first().click({ timeout: 2000 }).catch(() => {});
      await p.waitForTimeout(700);
      if (await p.locator('input[data-pick-modes]').count() && !(await p.locator('canvas').count() > 3)) break;
    }
    await p.waitForTimeout(16000);
    counts.push(await p.evaluate(() => window.__urlCount()));
  }
  check('記憶體：編輯反覆導入，照片檔不累積', counts[2] <= counts[0], JSON.stringify(counts));
  await p.close();
}

// ── 5. 其他工具：導入 → 存檔，成品張數、尺寸、有內容、沒有程式錯誤 ──
/** 每個工具：怎麼導入、按哪顆儲存、存完畫面上會出現哪個字、應該存出幾張、成品最短邊至少多少 */
const TOOLS = [
  { name: '美顏', sel: 'input[data-import-hero="beauty"]', n: 1, done: '修下一張', count: 1, minSide: 1600 },
  { name: '仿色', sel: 'input[data-import-hero="match"]', n: 1, done: '接著調色', count: 1, minSide: 1600 },
  { name: '藝術效果', sel: 'input[type=file][hidden]:not([data-instant])', n: 1, done: '修下一張', count: 1, minSide: 1600 },
  { name: '跨頁拼圖', sel: 'input[data-allow-alpha]', n: 3, done: '拼下一組', count: 1, minSide: 2000 },
  { name: '批量編輯', sel: 'input[data-pick-modes]', n: 3, done: '修下一張', count: 3, minSide: 1600, label: /^儲存$/ },
];
async function toolSaves(b) {
  for (const t of TOOLS) {
    const { p, errors } = await newPage(b);
    try {
      await importPhotos(p, t.n, null, 1600, 2000, t.sel);
      await p.waitForTimeout(12000);
      await save(p, t.done, t.label);
      const r = await p.evaluate(() => Promise.all([...document.querySelectorAll('img')].filter(i => i.naturalWidth > 500).map(async im => {
        await im.decode().catch(() => {});
        const c = document.createElement('canvas'); c.width = 40; c.height = 40; c.getContext('2d').drawImage(im, 0, 0, 40, 40);
        const d = c.getContext('2d').getImageData(0, 0, 40, 40).data; let l = 0; for (let i = 0; i < d.length; i += 4) l += d[i] + d[i + 1] + d[i + 2];
        return { w: im.naturalWidth, h: im.naturalHeight, lum: Math.round(l / 1600 / 3) };
      })));
      // 仿色的成品頁同時顯示原圖和成品：只要求「至少」該有的張數
      const ok = r.length >= t.count && r.every(x => Math.min(x.w, x.h) >= t.minSide && x.lum > 20);
      check(`${t.name}：存檔成功、尺寸對、有內容`, ok, JSON.stringify(r));
      check(`${t.name}：沒有程式錯誤`, errors.length === 0, errors.slice(0, 3).join(' | '));
    } catch (e) { check(`${t.name}：存檔`, false, 'crashed: ' + String(e.message || e).slice(0, 200)); }
    await p.close();
  }
}

const b = await launch();
for (const t of [fullRes, editorFilter, editorLeak, collageSeamless, toolSaves].filter(t => !process.env.ONLY || process.env.ONLY.split(',').includes(t.name))) {
  try { await t(b); } catch (e) { check(t.name, false, 'crashed: ' + String(e.message || e).slice(0, 200)); }
}
await b.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
