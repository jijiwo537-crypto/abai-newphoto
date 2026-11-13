/* iOS 模擬器自動測試（對應 ios/App/App/QAPlugin.swift、.github/workflows/ios.yml）。
 *
 * 平常不做任何事：只有 CI 用「-abaiQA 情境」打開 App 時才會跑。
 * 每一步寫一行 ABAIQA 紀錄，CI 同時定時截圖，兩邊對起來就知道每個畫面長怎樣、哪一步卡住。
 *   save          產生一張照片、一段影片，直接存進相簿（順便讓相簿裡有東西可以選）
 *   video         原生編碼、網頁編碼各輸出一段影片，記錄進度和花的時間，再把成品讀回來播放、跳格
 *   gallery       打開自己的相簿畫面、選三張、按完成
 *   tool:<名稱>   從主頁點進工具（art、dot、collage、layout、beauty、match、edit），
 *                 從相簿選第一張照片，進到工具畫面後記錄版面位置
 *   layoutvideo   跨頁拼圖選一段影片、按儲存，盯著輸出進度 */
import { nativePlugin } from './nativeBridge';

interface QAApi { scenario(): Promise<{ scenario: string }>; log(o: { msg: string }): Promise<void> }

let qa: QAApi | null = null;
/* 紀錄同時放進 window.__abaiQALog：原生那邊每秒來收一次（外掛呼叫不通時也拿得到） */
const buf: string[] = ((window as any).__abaiQALog ||= []);
const log = (msg: string) => { if (qa) void qa.log({ msg }).catch(() => buf.push(msg)); else buf.push(msg); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined | false, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`等不到：${what}`);
    await sleep(200);
  }
}

const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const buttons = () => Array.from(document.querySelectorAll('button')).filter(visible) as HTMLButtonElement[];
const findButton = (re: RegExp) => buttons().find(b => re.test(`${b.getAttribute('aria-label') || b.getAttribute('title') || ''} ${(b.textContent || '').trim()}`.trim()));
const click = (el: HTMLElement) => { el.click(); };

function logButtons(tag: string) {
  const names = buttons().map(b => (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)).filter(Boolean);
  log(`${tag} buttons: ${names.slice(0, 60).join(' | ')}`);
}

function logLayout(tag: string) {
  const vw = innerWidth, vh = innerHeight;
  /* 畫面上最大的幾塊：看工具有沒有整個往下移 */
  const blocks = Array.from(document.querySelectorAll('#root *')).filter(visible)
    .map(el => ({ el, r: (el as HTMLElement).getBoundingClientRect() }))
    .filter(({ r }) => r.width >= vw * 0.9 && r.height >= 40)
    .slice(0, 6)
    .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className || '').split(' ').slice(0, 3).join('.')}@${Math.round(r.top)}-${Math.round(r.bottom)}`);
  log(`${tag} viewport ${vw}x${vh} safeTop=${getComputedStyle(document.documentElement).getPropertyValue('--sat') || '?'} blocks: ${blocks.join(' ; ')}`);
}

async function makePhoto(hue = -1): Promise<File> {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1200;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 1600, 1200);
  grd.addColorStop(0, hue < 0 ? '#ff7a59' : `hsl(${hue} 80% 60%)`); grd.addColorStop(1, hue < 0 ? '#3b5bff' : `hsl(${hue + 40} 80% 50%)`);
  g.fillStyle = grd; g.fillRect(0, 0, 1600, 1200);
  g.fillStyle = '#fff'; g.font = 'bold 160px sans-serif'; g.fillText('ABAI QA', 360, 650);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9));
  return new File([blob!], 'qa.jpg', { type: 'image/jpeg' });
}

function testCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const draw = (i: number) => {
    g.fillStyle = `hsl(${(i * 4) % 360} 70% 45%)`; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(80 + (i * 12) % (w - 160), h / 2, 70, 0, Math.PI * 2); g.fill();
    g.font = 'bold 64px sans-serif'; g.fillText(`frame ${i}`, 40, 90);
  };
  return { c, draw };
}

async function encodeTest(which: 'native' | 'web', frames = 90): Promise<Blob | null> {
  const { encodeCanvasFrames } = await import('./frameExactVideo');
  const { c, draw } = testCanvas(1280, 720);
  const t0 = performance.now();
  let lastLogged = -1;
  try {
    const blob = await encodeCanvasFrames({
      canvas: c, fps: 30, frames, bitrate: 8_000_000, webOnly: which === 'web',
      draw: i => draw(i),
      onProgress: f => {
        const pct = Math.floor(f * 100 / 10) * 10;
        if (pct !== lastLogged) { lastLogged = pct; log(`video ${which} progress ${pct}% at ${Math.round(performance.now() - t0)}ms`); }
      },
    });
    log(`video ${which} done: ${blob ? `${blob.type} ${blob.size} bytes` : 'null（這條路做不到）'} in ${Math.round(performance.now() - t0)}ms`);
    return blob;
  } catch (e: any) {
    log(`video ${which} FAILED after ${Math.round(performance.now() - t0)}ms: ${String(e?.message ?? e)}`);
    return null;
  }
}

async function playbackTest(blob: Blob) {
  const { seekVideosTo } = await import('./frameExactVideo');
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = URL.createObjectURL(blob);
  try {
    await waitFor(() => v.readyState >= 1, 8000, 'loadedmetadata');
    log(`playback duration=${v.duration.toFixed(2)} size=${v.videoWidth}x${v.videoHeight}`);
    await seekVideosTo([v], 1.5);
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    c.getContext('2d')!.drawImage(v, 0, 0, 64, 36);
    const px = c.getContext('2d')!.getImageData(32, 18, 1, 1).data;
    log(`playback seek 1.5s readyState=${v.readyState} centerPixel=${px[0]},${px[1]},${px[2]}`);
  } catch (e: any) { log(`playback FAILED: ${String(e?.message ?? e)}`); }
  finally { URL.revokeObjectURL(v.src); }
}

async function scenarioSave() {
  const { saveToPhotos } = await import('./nativePhotos');
  const photo = await makePhoto();
  log(`save photo: ${JSON.stringify(await saveToPhotos([photo]))}`);
  const vid = await encodeTest('native', 120);
  if (vid) log(`save video: ${JSON.stringify(await saveToPhotos([new File([vid], 'qa.mp4', { type: 'video/mp4' })]))}`);
}

async function scenarioVideo() {
  log(`video support: VideoEncoder=${typeof (window as any).VideoEncoder} MediaRecorder=${typeof (window as any).MediaRecorder} mp4=${typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('video/mp4')}`);
  const n = await encodeTest('native');
  if (n) await playbackTest(n);
  const w = await encodeTest('web');
  if (w) await playbackTest(w);
}

async function pickInGallery(n: number, wantVideo = false) {
  const cells = await waitFor(() => {
    const all = Array.from(document.querySelectorAll('[data-abai-gallery] .abg-cell')) as HTMLElement[];
    const real = all.filter(c => c.tagName === 'BUTTON');
    return real.length ? real : null;
  }, 15000, '相簿的照片格子');
  await sleep(1500);   // 讓縮圖淡入，截圖看得到
  const pool = cells.filter(c => (c.getAttribute('aria-label') || '').startsWith('影片') === wantVideo);
  log(`gallery shows ${cells.length} cells (${pool.length} ${wantVideo ? 'videos' : 'photos'}) title="${document.querySelector('[data-abai-gallery] .text-\\[16px\\].font-semibold')?.textContent ?? ''}"`);
  const chosen = (pool.length ? pool : cells).slice(0, n);
  for (const c of chosen) { click(c); await sleep(350); }
  const done = Array.from(document.querySelectorAll('[data-abai-gallery] button')).find(b => /^完成/.test(b.textContent || '')) as HTMLButtonElement | undefined;
  if (document.querySelector('[data-abai-gallery]') && done && !done.disabled) { await sleep(800); click(done); }
  await waitFor(() => !document.querySelector('[data-abai-gallery]'), 30000, '相簿收起來');
  log('gallery closed');
}

async function scenarioGallery() {
  const { openGallery } = await import('./nativeGallery');
  const pending = openGallery({ limit: 0, filter: 'any' });
  await pickInGallery(3);
  const files = await pending;
  log(`gallery result: ${files === null ? 'null' : files.map(f => `${f.name}(${f.type},${f.size})`).join(', ')}`);
}

const TOOL_ENTRY: Record<string, RegExp> = {
  art: /開啟藝術效果|Art/i, dot: /開啟點陣文字|Dot/i, collage: /創意拼圖/, layout: /跨頁拼圖/,
  beauty: /美顏/, match: /仿色/, edit: /^\s*編輯\s*$|add_photo_alternate\s*編輯/,
};

/* 模擬器的相簿權限沒辦法自動給「完整取用」（iOS 18 一定會跳系統詢問框），
   所以工具測試直接把測試用的照片／影片交給匯入那一步，不經過相簿畫面 */
let qaVideo: File | null = null;
async function provideFiles(n: number, native = false) {
  const photos: File[] = [];
  for (let i = 0; i < n; i++) {
    const p = await makePhoto(native ? i * 110 : -1);
    if (!native) { photos.push(p); continue; }
    /* 跟 App 自己的相簿一樣：原圖先存成原生檔案，再讀回來變成 File，並記下原生路徑 */
    const { blobToNativeFile } = await import('./nativeImage');
    const { fileSrc, rememberNativeFile } = await import('./nativeBridge');
    const path = await blobToNativeFile(p, 'jpg');
    const f = new File([await (await fetch(fileSrc(path))).blob()], `qa${i}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    rememberNativeFile(f, path);
    photos.push(f);
  }
  (window as any).__abaiQAFiles = (filter: string) => {
    log(`import intercepted (filter=${filter}) → ${filter === 'videos' || (filter === 'any' && qaVideo) ? 'video' : `${n} photo(s)`}`);
    if (filter === 'videos' || (filter === 'any' && qaVideo)) return qaVideo ? [qaVideo] : photos;
    return photos;
  };
}

async function scenarioTool(name: string) {
  const re = TOOL_ENTRY[name];
  if (!re) { log(`unknown tool ${name}`); return; }
  await provideFiles(name === 'collage' || name === 'layout' ? 2 : 1);
  const btn = await waitFor(() => findButton(re), 15000, `主頁的 ${name} 按鈕`);
  log(`tool ${name}: tap "${(btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 20)}"`);
  click(btn);
  for (const t of [3000, 4000, 6000]) {
    await sleep(t);
    logLayout(`tool ${name} +${t}`);
  }
  logButtons(`tool ${name}`);
}

/* 跨頁拼圖選一段影片、按儲存，盯著進度 */
async function scenarioLayoutVideo() {
  /* 先做一段 4 秒的測試影片，當成「從相簿選的影片」 */
  const v = await encodeTest('native', 120);
  if (!v) { log('layoutvideo: could not make a test video'); return; }
  qaVideo = new File([v], 'qa.mp4', { type: 'video/mp4' });
  await provideFiles(1);
  const btn = await waitFor(() => findButton(TOOL_ENTRY.layout), 15000, '跨頁拼圖按鈕');
  click(btn);
  await sleep(6000);
  logButtons('layoutvideo editor');
  const save = await waitFor(() => findButton(/^(儲存|匯出|完成|下一步)/), 10000, '儲存按鈕').catch(() => null);
  if (!save) { log('layoutvideo: no save button'); return; }
  log(`layoutvideo: tap "${save.textContent?.trim()}"`);
  click(save);
  await sleep(2500);
  logButtons('layoutvideo after save');
  /* 有匯出選項的話再按一次確認 */
  const confirm = findButton(/^(儲存|匯出|開始|確定)/);
  if (confirm && confirm !== save) { log(`layoutvideo: confirm "${confirm.textContent?.trim()}"`); click(confirm); }
  let last = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await sleep(2000);
    const pct = (document.body.innerText.match(/\d{1,3}\s?%/g) || []).slice(0, 3).join(',');
    const state = `${pct} ${document.querySelector('video[src^="blob:"]') ? 'video-ready' : ''}`.trim();
    if (state !== last) { last = state; log(`layoutvideo +${Math.round((Date.now() - t0) / 1000)}s ${state || '(no percent)'}`); }
    if (/儲存影片|已存到相簿|儲存中/.test(document.body.innerText) && !pct) { log('layoutvideo: result page reached'); break; }
  }
  logButtons('layoutvideo end');
}

/* 用觸控事件點一下（React 的格子選取是接 touch 事件的） */
async function tapAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return;
  const t = new Touch({ identifier: Date.now() % 100000, target: el, clientX: x, clientY: y });
  const ev = (type: string, list: Touch[]) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: [t] }));
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, pointerId: 7 }));
  ev('touchstart', [t]);
  await sleep(70);
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, pointerId: 7 }));
  ev('touchend', []);
  el.click();
}
/* 每個佈局畫布：可見與否、尺寸、左右兩半中心的顏色（18,18,18＝空格子的深色＝圖不見了） */
function probeLayouts(tag: string) {
  const out = Array.from(document.querySelectorAll('canvas[data-layout-base], canvas[data-layout-photo-surface]')).map(n => {
    const c = n as HTMLCanvasElement, cs = getComputedStyle(c);
    let px = '';
    try {
      const g = c.getContext('2d')!;
      px = [0.25, 0.75].map(fx => Array.from(g.getImageData(Math.floor(c.width * fx), Math.floor(c.height / 2), 1, 1).data).join(',')).join(' / ');
    } catch (e: any) { px = `ERR ${String(e?.message ?? e)}`; }
    return `${c.hasAttribute('data-layout-base') ? 'base' : 'detail'} ${c.width}x${c.height} ${cs.display}/${cs.visibility} [${px}]`;
  });
  log(`${tag} layouts: ${out.join(' ; ') || '(none)'}`);
}
async function scenarioLayoutUndo() {
  await provideFiles(3, true);
  click(await waitFor(() => findButton(TOOL_ENTRY.layout), 15000, '跨頁拼圖按鈕'));
  await sleep(6000);
  const add = await waitFor(() => findButton(/^新增內容$/), 8000, '新增內容');
  click(add); await sleep(900);
  click(await waitFor(() => findButton(/新增佈局/), 8000, '新增佈局')); await sleep(1500);
  const tmpl = buttons().filter(b => { const r = b.getBoundingClientRect(); return r.top > innerHeight * 0.6 && r.width < innerWidth / 3; });
  log(`layoutundo: ${tmpl.length} template cards`);
  if (tmpl[1]) click(tmpl[1]);
  await sleep(2000);
  const cells = Array.from(document.querySelectorAll('[data-cell-id]')) as HTMLElement[];
  log(`layoutundo: ${cells.length} cells`);
  for (const cell of cells.slice(0, 2)) {
    const r = cell.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    await tapAt(x, y); await sleep(600); await tapAt(x, y); await sleep(3500);
  }
  await tapAt(5, innerHeight * 0.4); await sleep(2500);
  probeLayouts('layoutundo filled');
  log('SHOT filled'); await sleep(2500);
  const undo = findButton(/^undo$/), redo = () => findButton(/^redo$/);
  if (undo) { click(undo); await sleep(2500); probeLayouts('layoutundo after undo'); log('SHOT undo'); await sleep(2500); }
  const r1 = redo(); if (r1) { click(r1); await sleep(3000); probeLayouts('layoutundo after redo'); log('SHOT redo'); await sleep(2500); }
  if (undo) { click(undo); await sleep(800); click(undo); await sleep(800); }
  for (let i = 0; i < 2; i++) { const r = redo(); if (r) { click(r); await sleep(900); } }
  await sleep(3000); probeLayouts('layoutundo after 2x undo/redo'); log('SHOT undo2'); await sleep(2500);
  const back = findButton(/返回主頁/);
  if (back) {
    click(back); await sleep(1500);
    const save = findButton(/^儲存$/); if (save) click(save);
    await sleep(4000);
    const mine = findButton(/^我的$/); if (mine) click(mine);
    await sleep(2000);
    const hist = Array.from(document.querySelectorAll('img')).filter(visible).map(i => i.closest('button')).find(Boolean) as HTMLButtonElement | undefined;
    log(`layoutundo: history item ${hist ? 'found' : 'missing'}`);
    if (hist) { click(hist); await sleep(8000); probeLayouts('layoutundo after draft resume'); log('SHOT draft'); await sleep(2500); }
  }
}

/* 奇數尺寸的影片（創意拼圖選 720／2K 時就是這種尺寸）：原生編碼直接輸出 vs 新流程（補成偶數＋播放檢查） */
async function scenarioOddVideo() {
  const { encodeCanvasFramesNative } = await import('./nativeVideo');
  const { encodeCanvasFrames, isPlayableVideo } = await import('./frameExactVideo');
  for (const [w, h] of [[719, 959], [720, 960], [1439, 1919]]) {
    const { c, draw } = testCanvas(w, h);
    try {
      const raw = await encodeCanvasFramesNative({ canvas: c, fps: 30, frames: 30, bitrate: 6_000_000, draw: i => draw(i) });
      log(`oddvideo ${w}x${h} native-raw: ${raw ? `${raw.size} bytes playable=${await isPlayableVideo(raw)}` : 'null'}`);
      if (raw) await playbackTest(raw);
    } catch (e: any) { log(`oddvideo ${w}x${h} native-raw FAILED: ${String(e?.message ?? e)}`); }
    try {
      const fixed = await encodeCanvasFrames({ canvas: c, fps: 30, frames: 30, bitrate: 6_000_000, draw: i => draw(i) });
      log(`oddvideo ${w}x${h} pipeline: ${fixed ? `${fixed.size} bytes playable=${await isPlayableVideo(fixed)}` : 'null'}`);
      if (fixed) await playbackTest(fixed);
    } catch (e: any) { log(`oddvideo ${w}x${h} pipeline FAILED: ${String(e?.message ?? e)}`); }
  }
}

/* 創意拼圖：選 720／1080 畫質匯出影片，記錄成品頁的影片狀態（能不能播、尺寸、檔案大小、錯誤） */
async function scenarioCreativeVideo() {
  await provideFiles(1);
  for (const q of ['720p', '1080p']) {
    const home = findButton(/返回主頁/); if (home) { click(home); await sleep(2500); const d = findButton(/^放棄$/); if (d) { click(d); await sleep(2000); } }
    click(await waitFor(() => findButton(TOOL_ENTRY.collage), 15000, '創意拼圖按鈕'));
    await sleep(7000);
    const opt = await waitFor(() => findButton(/匯出選項/), 10000, '匯出選項');
    click(opt); await sleep(800);
    const qb = buttons().find(b => (b.textContent || '').trim() === q); if (qb) click(qb); else log(`creativevideo: no ${q} button`);
    await sleep(500); click(opt); await sleep(500);
    const save = await waitFor(() => findButton(/^儲存/), 8000, '儲存'); click(save); await sleep(1200);
    const sv = findButton(/儲存影片/); if (sv) click(sv);
    log(`creativevideo ${q}: export started`);
    const t0 = Date.now(); let last = '';
    while (Date.now() - t0 < 150000) {
      await sleep(2000);
      const pct = (document.body.innerText.match(/\d{1,3}\s?%/) || [''])[0];
      if (pct !== last) { last = pct; log(`creativevideo ${q} +${Math.round((Date.now() - t0) / 1000)}s ${pct}`); }
      const v = document.querySelector('[data-export-media] video') as HTMLVideoElement | null;
      if (v) {
        await sleep(3000);
        let size = -1; try { size = (await (await fetch(v.src)).blob()).size; } catch { /* */ }
        let px = '';
        try { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d')!; g.drawImage(v, 0, 0, 8, 8); px = Array.from(g.getImageData(4, 4, 1, 1).data.slice(0, 3)).join(','); } catch (e: any) { px = 'ERR ' + e?.message; }
        const r = v.getBoundingClientRect();
        log(`creativevideo ${q} RESULT readyState=${v.readyState} ${v.videoWidth}x${v.videoHeight} dur=${v.duration} err=${v.error?.code ?? '-'} bytes=${size} box=${Math.round(r.width)}x${Math.round(r.height)} centerPx=${px}`);
        break;
      }
      if (/失敗|錯誤/.test(document.body.innerText)) { log(`creativevideo ${q} ERROR text: ${document.body.innerText.slice(0, 160).replace(/\s+/g, ' ')}`); break; }
    }
    logButtons(`creativevideo ${q} end`);
    const back = findButton(/^返回$|繼續編輯/); if (back) { click(back); await sleep(1500); }
  }
}

let running = false;
/** forced：原生直接叫的（外掛通不通都要跑） */
/* 原生特效（相機用的柔光、朦朧、低保真）：模擬器沒有相機，拿一張測試照片走拍照後的同一條處理 */
async function scenarioCamFx() {
  const { nativeImage, blobToNativeFile } = await import('./nativeImage');
  const { fileSrc } = await import('./nativeBridge');
  const img = await nativeImage();
  if (!img) { log('camfx: no NativeImage'); return; }
  const path = await blobToNativeFile(await makePhoto(), 'jpg');
  const px = async (p: string) => {
    const im = new Image(); im.src = fileSrc(p); await im.decode();
    const c = document.createElement('canvas'); c.width = 40; c.height = 30;
    const g = c.getContext('2d')!; g.drawImage(im, 0, 0, 40, 30);
    const d = g.getImageData(0, 0, 40, 30).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return { w: im.naturalWidth, h: im.naturalHeight, mean: Math.round(sum / (d.length / 4 * 3)), center: Array.from(g.getImageData(20, 15, 1, 1).data.slice(0, 3)).join(',') };
  };
  for (const fx of [{ soft: 0, blur: 0, lowfi: 0 }, { soft: .7, blur: 0, lowfi: 0 }, { soft: 0, blur: .7, lowfi: 0 }, { soft: 0, blur: 0, lowfi: .5 }, { soft: .7, blur: .7, lowfi: .5 }]) {
    const t0 = performance.now();
    try {
      const r = await (img as any).render({ path, aspect: 2 / 3, fx, format: 'jpeg', quality: 0.9 });
      log(`camfx ${JSON.stringify(fx)} → ${JSON.stringify(await px(r.path))} in ${Math.round(performance.now() - t0)}ms`);
    } catch (e: any) { log(`camfx ${JSON.stringify(fx)} FAILED: ${String(e?.message ?? e)}`); }
  }
}

/* 選中框：進編輯 → 濾鏡選第三張 → 記下卡片位置（CI 截圖後放大看四個角）→ 特效選一張 → 模板 */
async function scenarioRings() {
  await provideFiles(1);
  const btn = await waitFor(() => findButton(TOOL_ENTRY.edit), 15000, '編輯按鈕');
  click(btn);
  await sleep(6000);
  const tab = (name: string) => buttons().find(b => (b.textContent || '').trim() === name);
  const rectOf = (el: Element) => { const r = el.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}`; };
  const f = tab('濾鏡'); if (f) click(f);
  await sleep(1500);
  const cards = Array.from(document.querySelectorAll('[data-filter-card]')) as HTMLElement[];
  if (cards[2]) { click(cards[2]); await sleep(2500); const box = cards[2].firstElementChild || cards[2]; log(`rings filter card rect ${rectOf(box)} dpr ${devicePixelRatio}`); }
  await sleep(4000);
  const fx = tab('特效'); if (fx) click(fx);
  await sleep(1500);
  const fxCards = Array.from(document.querySelectorAll('[data-effect-card], [data-fx-card]')) as HTMLElement[];
  log(`rings fx cards ${fxCards.length}`);
  await sleep(4000);
}

export async function runNativeQA(forced?: string) {
  if (running) return;
  const probe = Promise.race([nativePlugin<QAApi>('ABAIQA'), new Promise<null>(r => setTimeout(() => r(null), 3000))]);
  qa = await probe;
  let scenario = forced || '';
  if (!scenario && qa) {
    try { scenario = (await qa.scenario()).scenario; } catch (e: any) { buf.push(`scenario() failed: ${String(e?.message ?? e)}`); }
  }
  if (!scenario) return;
  if (running) return;
  running = true;
  if (!qa) buf.push('plugin ABAIQA not reachable from web; logging through window.__abaiQALog');
  /* 測試時不要被「這版沒有原生功能」之類的提示框卡住，提示內容照樣記下來 */
  window.alert = (m?: unknown) => log(`alert: ${String(m)}`);
  window.addEventListener('error', e => log(`js error: ${e.message}`));
  window.addEventListener('unhandledrejection', e => log(`js rejection: ${String((e as PromiseRejectionEvent).reason?.message ?? (e as PromiseRejectionEvent).reason)}`));
  log(`start ${scenario}`);
  await sleep(4000);
  try {
    if (scenario === 'save') await scenarioSave();
    else if (scenario === 'video') await scenarioVideo();
    else if (scenario === 'gallery') await scenarioGallery();
    else if (scenario === 'camfx') await scenarioCamFx();
    else if (scenario === 'rings') await scenarioRings();
    else if (scenario === 'layoutvideo') await scenarioLayoutVideo();
    else if (scenario === 'layoutundo') await scenarioLayoutUndo();
    else if (scenario === 'oddvideo') await scenarioOddVideo();
    else if (scenario === 'creativevideo') await scenarioCreativeVideo();
    else if (scenario.startsWith('tool:')) await scenarioTool(scenario.slice(5));
    log(`end ${scenario}`);
  } catch (e: any) {
    log(`FAILED ${scenario}: ${String(e?.message ?? e)}`);
    logButtons('at failure');
  }
}
