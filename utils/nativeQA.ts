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
  for (const q of ['720p']) {
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

/* 廣色域存檔：一張 P3 純綠（sRGB 表示不出來的綠）走修圖存檔的原生路線，
   色彩表分別是「不變」與「黑白」：不變→綠要留在 P3 的綠（不能被夾成 sRGB 的綠）；黑白→不能透出綠色 */
async function scenarioWideSave() {
  const { nativeImage, blobToNativeFile } = await import('./nativeImage');
  const { fileSrc } = await import('./nativeBridge');
  const img = await nativeImage();
  if (!img) { log('widesave: no NativeImage'); return; }
  let step = 'make source';
  try {
    let src: Blob | null = null, kind = '';
    try {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600;
      const g = c.getContext('2d', { colorSpace: 'display-p3' } as any) as CanvasRenderingContext2D | null;
      if (g) {
        g.fillStyle = 'color(display-p3 0 1 0)'; g.fillRect(0, 0, 800, 600);
        g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, 200, 600);
        src = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png')); kind = 'p3 canvas';
      }
    } catch (e: any) { log(`widesave p3 canvas unavailable: ${e?.name}: ${e?.message}`); }
    if (!src) {
      try { const r = await fetch('https://webkit.org/blog-files/color-gamut/Webkit-logo-P3.png'); if (r.ok) { src = await r.blob(); kind = 'webkit P3 png'; } }
      catch (e: any) { log(`widesave fetch P3 sample failed: ${e?.message}`); }
    }
    if (!src) {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600;
      const g = c.getContext('2d')!; g.fillStyle = 'rgb(0,255,0)'; g.fillRect(0, 0, 800, 600); g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, 200, 600);
      src = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png')); kind = 'srgb canvas';
    }
    if (!src) { log('widesave: no source'); return; }
    log(`widesave source kind=${kind} bytes=${src.size}`);
    step = 'write source';
    const path = await blobToNativeFile(src, 'png');
    const N = 64, n = N ** 3;
    const mk = (gray: boolean) => {
      const f = new Float32Array(n * 4);
      for (let b = 0, i = 0; b < N; b++) for (let gg = 0; gg < N; gg++) for (let r = 0; r < N; r++, i++) {
        const R = r / (N - 1), G = gg / (N - 1), B = b / (N - 1), y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        f[i * 4] = gray ? y : R; f[i * 4 + 1] = gray ? y : G; f[i * 4 + 2] = gray ? y : B; f[i * 4 + 3] = 1;
      }
      return f;
    };
    const read = async (p: string) => {
      const im = new Image(); im.src = fileSrc(p);
      await new Promise<void>((res, rej) => { im.onload = () => res(); im.onerror = () => rej(new Error('img load')); });
      const cv = document.createElement('canvas'); cv.width = 80; cv.height = 60;
      let p3: CanvasRenderingContext2D | null = null;
      try { p3 = cv.getContext('2d', { colorSpace: 'display-p3' } as any) as CanvasRenderingContext2D | null; } catch { p3 = null; }
      const x = p3 || cv.getContext('2d')!;
      x.drawImage(im, 0, 0, 80, 60);
      const at = (px: number) => { let d: Uint8ClampedArray; try { d = (x as any).getImageData(px, 30, 1, 1, { colorSpace: 'display-p3' }).data; } catch { d = x.getImageData(px, 30, 1, 1).data; } return Array.from(d.slice(0, 3)).join(','); };
      return `${im.naturalWidth}x${im.naturalHeight} green=${at(60)} gray=${at(5)} (${p3 ? 'p3' : 'srgb'} readback)`;
    };
    step = 'read source';
    log(`widesave source ${await read(path)}`);
    for (const gray of [false, true]) {
      step = 'write cube';
      const cubePath = await blobToNativeFile(new Blob([mk(gray).buffer]), 'cube');
      for (const format of ['heic10', 'jpeg', 'png']) {
        const t0 = performance.now();
        try {
          const r = await (img as any).render({ path, cubePath, cubeSize: N, format, quality: 1, hdr: true, keepGamut: true });
          const size = (await (await fetch(fileSrc(r.path))).blob()).size;
          log(`widesave ${gray ? 'gray' : 'identity'} ${format} → ${await read(r.path)} bytes=${size} in ${Math.round(performance.now() - t0)}ms`);
        } catch (e: any) { log(`widesave ${gray ? 'gray' : 'identity'} ${format} FAILED: ${String(e?.message ?? e)}`); }
      }
    }
    // 混合路線：網頁成品（這裡用一張黑白的）＋原圖超出 sRGB 的部分
    step = 'hybrid base';
    const bc = document.createElement('canvas'); bc.width = 800; bc.height = 600;
    const bg = bc.getContext('2d')!; bg.fillStyle = 'rgb(182,182,182)'; bg.fillRect(0, 0, 800, 600); bg.fillStyle = 'rgb(128,128,128)'; bg.fillRect(0, 0, 200, 600);
    const baseBlob = await new Promise<Blob | null>(r => bc.toBlob(r, 'image/png'));
    const basePath = await blobToNativeFile(baseBlob!, 'png');
    for (const format of ['heic10', 'jpeg']) {
      const t0 = performance.now();
      try {
        const r = await (img as any).render({ path, basePath, format, quality: 1, hdr: true, keepGamut: true });
        log(`widesave hybrid ${format} → ${await read(r.path)} in ${Math.round(performance.now() - t0)}ms`);
      } catch (e: any) { log(`widesave hybrid ${format} FAILED: ${String(e?.message ?? e)}`); }
    }
  } catch (e: any) { log(`widesave FAILED at ${step}: ${e?.name}: ${String(e?.message ?? e)} ${String(e?.stack ?? '').slice(0, 300)}`); }
}

/* 貼圖滑桿在真正的 WebKit 上的手感：創意拼圖加各類貼圖，每根滑桿模擬拖 40 格量每一格的間隔；
   再把發光打開重量一次（發光在 Safari 上最貴，實際使用最常開） */
async function scenarioStickerPerf() {
  await provideFiles(1);
  click(await waitFor(() => findButton(TOOL_ENTRY.collage), 15000, '創意拼圖按鈕'));
  await sleep(9000);
  const items = ['star-f', 'circle-o', 'line-wave', 'grid-cross', 'grid-dots', 'blur-star-f', '霧白邊框', 'hole-sb-cross-thin', 'line-stitch-plus'];
  const raf = () => new Promise<number>(r => requestAnimationFrame(r));
  const labelOf = (el: Element) => { const c = el.closest('.space-y-1\\.5'); const sp = c && c.querySelector('span'); return sp ? sp.textContent || '?' : '?'; };
  const drag = async (r: HTMLInputElement) => {
    const min = +r.min, max = +r.max, gaps: number[] = [];
    r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    let last = await raf();
    for (let i = 1; i <= 40; i++) {
      const v = min + (max - min) * (0.3 + 0.4 * Math.sin(i / 40 * Math.PI));
      r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true }));
      const now = await raf(); gaps.push(now - last); last = now;
    }
    r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await sleep(400);
    const s = [...gaps].sort((a, b) => b - a), avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    return `${avg.toFixed(0)}/${Math.round(s[0])}`;
  };
  const sliders = () => (Array.from(document.querySelectorAll('.slider-wrap input[type=range]')) as HTMLInputElement[]).filter(visible);
  /* 基準：模擬器什麼都不做時一格要多久（CI 的虛擬機可能本來就跑不到 60 格），沒有這個數字上面那些沒辦法解讀 */
  {
    const gaps: number[] = []; let last = await raf();
    for (let i = 0; i < 60; i++) { const now = await raf(); gaps.push(now - last); last = now; }
    const s2 = [...gaps].sort((a, b) => a - b);
    log(`stickerperf BASELINE idle: avg ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)}ms median ${s2[30].toFixed(1)} max ${s2[59].toFixed(0)}`);
  }
  for (const id of items) {
    const tab = document.querySelector('[data-creative-tab=add]') as HTMLElement | null; if (tab) click(tab); await sleep(800);
    const add = findButton(/^新增貼圖/); if (add) { click(add); await sleep(800); }
    const it = document.querySelector(`button[aria-label="${id}"]`) as HTMLElement | null;
    if (!it) { log(`stickerperf ${id}: not found`); continue; }
    click(it); await sleep(2500);
    const adj = findButton(/^圖形調整/); if (adj) { click(adj); await sleep(1500); }
    const out: string[] = [];
    for (const r of sliders()) out.push(`${labelOf(r)}:${await drag(r)}`);
    log(`stickerperf ${id} glow0  ${out.join('  ')}`);
    const glow = sliders().find(r => labelOf(r) === '發光');
    if (glow) {
      glow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); glow.value = String(+glow.max * 0.7); glow.dispatchEvent(new Event('input', { bubbles: true }));
      await raf(); glow.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); await sleep(800);
      const out2: string[] = [];
      for (const r of sliders()) if (labelOf(r) !== '發光') out2.push(`${labelOf(r)}:${await drag(r)}`);
      log(`stickerperf ${id} glow70 ${out2.join('  ')}`);
    }
    const del = findButton(/^刪除$/); if (del) { click(del); await sleep(800); }
  }
}

/* 選取框與貼圖的距離（四邊）：新增前後各讀一次主畫布，變了的像素就是貼圖本身（選取框是畫布上方的 SVG，不在畫布裡），
   跟選取框的框線中心比，記下上、下、左、右各差幾個 CSS px。創意拼圖、跨頁拼圖各量一輪。 */
async function scenarioSelGap() {
  const items = ['circle-f', 'star-f', 'square-o', 'hole-love'];
  const measure = async (tool: string, addFlow: () => Promise<void>, frameOf: () => Element | null) => {
    for (const id of items) {
      const cv = [...document.querySelectorAll('canvas')].filter(c => visible(c)).sort((a, b) => b.width * b.height - a.width * a.height)[0] as HTMLCanvasElement | undefined;
      const g = cv?.getContext('2d');
      const before = g ? g.getImageData(0, 0, cv!.width, cv!.height).data.slice() : null;
      await addFlow();
      const it = document.querySelector(`button[aria-label="${id}"]`) as HTMLElement | null;
      if (!it) { log(`selgap ${tool} ${id}: not found`); continue; }
      click(it); await sleep(2500);
      const fe = frameOf();
      { const q = fe?.getBoundingClientRect(); log(`selgap shot ${id} t=${Math.round(performance.now())} frame css ${q?.left.toFixed(2)},${q?.top.toFixed(2)} ${q?.width.toFixed(2)}x${q?.height.toFixed(2)}`); }
      await sleep(9000);
      if (!fe || !cv || !g || !before) { log(`selgap ${tool} ${id}: no frame/canvas`); continue; }
      const fr = fe.getBoundingClientRect(), sw = parseFloat(getComputedStyle(fe).strokeWidth || '0') || 0;
      const after = g.getImageData(0, 0, cv.width, cv.height).data;
      const cr = cv.getBoundingClientRect(), sx = cv.width / cr.width, sy = cv.height / cr.height;
      let a = cv.width, b = cv.height, c = -1, e = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1]) + Math.abs(after[i + 2] - before[i + 2]) > 60) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > e) e = y; }
      }
      const L = cr.left + a / sx, T = cr.top + b / sy, R = cr.left + (c + 1) / sx, B = cr.top + (e + 1) / sy;
      const f = (v: number) => v.toFixed(2);
      log(`selgap ${tool} ${id}: top ${f(T - fr.top - sw / 2)} bottom ${f(fr.bottom - sw / 2 - B)} left ${f(L - fr.left - sw / 2)} right ${f(fr.right - sw / 2 - R)} (frame ${f(fr.width)}x${f(fr.height)} sw ${sw} dpr ${devicePixelRatio} canvas ${cv.width}/${f(cr.width)})`);
      const del = findButton(/^刪除$/); if (del) { click(del); await sleep(1000); }
    }
  };
  await provideFiles(1);
  click(await waitFor(() => findButton(TOOL_ENTRY.collage), 15000, '創意拼圖按鈕'));
  await sleep(9000);
  await measure('creative', async () => {
    const tab = document.querySelector('[data-creative-tab=add]') as HTMLElement | null; if (tab) click(tab); await sleep(800);
    const add = findButton(/^新增貼圖/); if (add) { click(add); await sleep(800); }
  }, () => {
    return [...document.querySelectorAll('svg rect')].find(el => el.getAttribute('stroke') === '#fff' && !el.hasAttribute('data-base-selection-rect')) || null;
  });
}

/* 去背 PNG × 特效：做一張點陣風格的大張去背 PNG，匯入拼圖工具，逐一套用每個特效、濾鏡。
   每一步都先寫記錄再動手：如果 WebContent 被系統砍掉，記錄會停在出事的那一步。 */
async function makeAlphaPng(): Promise<File> {
  const c = document.createElement('canvas'); c.width = 3000; c.height = 3000;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 3000; y += 30) for (let x = 0; x < 3000; x += 30) {
    g.fillStyle = `hsl(${(x + y) % 360},80%,55%)`; g.beginPath(); g.arc(x + 15, y + 15, 4 + ((x * 7 + y * 13) % 10), 0, Math.PI * 2); g.fill();
  }
  const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/png'));
  c.width = c.height = 0;
  return new File([blob], 'dots.png', { type: 'image/png', lastModified: Date.now() });
}
async function scenarioAlphaFx(tool: string) {
  const base = await makePhoto(-1), alpha = await makeAlphaPng();
  log(`alphafx ${tool}: png ${alpha.size} bytes`);
  let calls = 0;
  (window as any).__abaiQAFiles = (filter: string) => { calls++; log(`import intercepted #${calls} (${filter})`); return calls === 1 ? [base] : [alpha]; };
  click(await waitFor(() => findButton(tool === 'layout' ? TOOL_ENTRY.layout : TOOL_ENTRY.collage), 15000, '拼圖按鈕'));
  await sleep(9000);
  if (tool === 'layout') {
    const add = findButton(/^新增內容$/); if (add) { click(add); await sleep(800); }
  } else {
    const tab = document.querySelector('[data-creative-tab=add]') as HTMLElement | null; if (tab) click(tab); await sleep(800);
  }
  const imp = findButton(/匯入圖片/); if (!imp) { log('alphafx: 找不到匯入圖片'); logButtons('alphafx'); return; }
  click(imp); await sleep(7000);
  if (tool === 'layout') {
    const els = [...document.querySelectorAll('[data-floating-id]')]; const el = els[els.length - 1] as HTMLElement | undefined;
    if (el) { const r = el.getBoundingClientRect(); await tapAt(r.left + r.width / 2, r.top + r.height / 2); await sleep(1500); }
  }
  const adj = findButton(/^圖片調整$/); if (!adj) { log('alphafx: 找不到圖片調整'); logButtons('alphafx'); return; }
  click(adj); await sleep(2500);
  const fxTab = [...buttons()].reverse().find(b => (b.textContent || '').trim() === '特效'); if (fxTab) click(fxTab); await sleep(2500);
  const ids = [...document.querySelectorAll('[data-fx-card]')].map(e => e.getAttribute('data-fx-card') || '').filter(Boolean);
  log(`alphafx ${tool}: ${ids.length} fx cards`);
  for (const id of ids) {
    log(`alphafx ${tool}: apply ${id}`);
    const el = document.querySelector(`[data-fx-card="${id}"]`) as HTMLElement | null; if (el) click(el);
    await sleep(2200);
    log(`alphafx ${tool}: ok ${id}`);
  }
  const fl = [...buttons()].reverse().find(b => (b.textContent || '').trim() === '濾鏡'); if (fl) click(fl); await sleep(2000);
  const luts = [...document.querySelectorAll('[data-lut-card]')].slice(0, 8) as HTMLElement[];
  for (const l of luts) { log(`alphafx ${tool}: lut ${l.getAttribute('data-lut-card')}`); click(l); await sleep(2000); }
  log(`alphafx ${tool}: done`);
}

/* 去背圖 × 調節滑桿：顏色（按住時 vs 放開閒置）與滑順度（每格幾毫秒）。
   alphaidle-<tool>-<alpha|opaque>。每個階段都寫記錄，CI 每 4 秒截一張圖可以對照。 */
async function makeTestPng(alpha: boolean): Promise<File> {
  const c = document.createElement('canvas'); c.width = 1600; c.height = 1600;
  const g = c.getContext('2d')!;
  if (!alpha) { g.fillStyle = '#000'; g.fillRect(0, 0, 1600, 1600); }
  g.fillStyle = 'rgb(200,40,40)'; g.beginPath(); g.arc(800, 800, 600, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(40,160,40,0.5)'; g.beginPath(); g.arc(800, 800, 200, 0, Math.PI * 2); g.fill();
  const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/png'));
  c.width = c.height = 0;
  return new File([blob], alpha ? 'cut.png' : 'opaque.png', { type: 'image/png', lastModified: Date.now() });
}
async function scenarioAlphaIdle(tool: string, kind: string) {
  const base = await makePhoto(-1), img = await makeTestPng(kind !== 'opaque');
  let calls = 0;
  (window as any).__abaiQAFiles = () => { calls++; return calls === 1 ? [base] : [img]; };
  click(await waitFor(() => findButton(tool === 'layout' ? /^跨頁拼圖$|跨頁拼圖/ : TOOL_ENTRY.collage), 20000, '拼圖按鈕'));
  await sleep(9000);
  if (tool === 'layout') { const add = findButton(/^新增內容$/); if (add) { click(add); await sleep(800); } }
  else { const tab = document.querySelector('[data-creative-tab=add]') as HTMLElement | null; if (tab) click(tab); await sleep(800); }
  const imp = findButton(/匯入圖片/); if (!imp) { log('alphaidle: 找不到匯入圖片'); logButtons('alphaidle'); return; }
  click(imp); await sleep(6000);
  if (tool === 'layout') {
    const els = [...document.querySelectorAll('[data-floating-id]')]; const el = els[els.length - 1] as HTMLElement | undefined;
    if (el) { const r = el.getBoundingClientRect(); await tapAt(r.left + r.width / 2, r.top + r.height / 2); await sleep(1500); }
  }
  log(`alphaidle ${tool} ${kind}: REST (no edit) t=${Math.round(performance.now())}`);
  await sleep(6000);
  const adj = findButton(/^圖片調整$/); if (!adj) { log('alphaidle: 找不到圖片調整'); logButtons('alphaidle'); return; }
  click(adj); await sleep(2000);
  const tabs = [...buttons()].map(b => (b.textContent || '').trim()).filter(t => ['濾鏡', '調節', '特效', '造型', '外觀', '構圖'].includes(t));
  log(`alphaidle ${tool} ${kind}: tabs ${tabs.join(' ')}`);
  const tune = [...buttons()].reverse().find(b => (b.textContent || '').trim() === '調節'); if (tune) click(tune); await sleep(1200);
  const sat = buttons().find(b => /飽和度$/.test((b.textContent || '').trim()) && !/自然/.test(b.textContent || '')); if (sat) click(sat); await sleep(1200);
  const range = document.querySelector('input[type=range]') as HTMLInputElement | null;
  if (!range) { log('alphaidle: 沒有滑桿'); return; }
  // 拖滑桿 3 秒：每一格改一次值，量每格間隔
  const rr = range.getBoundingClientRect();
  range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: rr.left + rr.width / 2, clientY: rr.top + rr.height / 2 }));
  const min = +range.min, max = +range.max;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  const gaps: number[] = []; let last = performance.now(); const t0 = last;
  while (performance.now() - t0 < 3000) {
    const ph = (performance.now() - t0) / 3000;
    const v = min + (max - min) * (0.5 + 0.45 * Math.sin(ph * Math.PI * 4));
    setter.call(range, String(Math.round(v)));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now(); gaps.push(now - last); last = now;
  }
  gaps.sort((a, b) => a - b);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  log(`alphaidle ${tool} ${kind}: slider frames ${gaps.length} avg ${avg.toFixed(1)}ms p90 ${gaps[Math.floor(gaps.length * 0.9)].toFixed(1)}ms max ${gaps[gaps.length - 1].toFixed(1)}ms`);
  setter.call(range, String(Math.round(min + (max - min) * 0.85))); range.dispatchEvent(new Event('input', { bubbles: true }));
  log(`alphaidle ${tool} ${kind}: HOLDING t=${Math.round(performance.now())}`);
  await sleep(6000);
  range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch' }));
  range.dispatchEvent(new Event('change', { bubbles: true }));
  log(`alphaidle ${tool} ${kind}: RELEASED t=${Math.round(performance.now())}`);
  await sleep(9000);
  log(`alphaidle ${tool} ${kind}: IDLE done t=${Math.round(performance.now())}`);
}

/* 選中框四邊縫隙 × 縮放：用兩指 pointer 事件縮放貼圖本身、再縮放整個畫面，每一步量四邊（亞像素） */
async function scenarioZoomGap() {
  const raf = () => new Promise<number>(r => requestAnimationFrame(r));
  await provideFiles(1);
  click(await waitFor(() => findButton(TOOL_ENTRY.collage), 15000, '創意拼圖按鈕'));
  await sleep(9000);
  const tab = document.querySelector('[data-creative-tab=add]') as HTMLElement | null; if (tab) click(tab); await sleep(800);
  const add = findButton(/^新增貼圖/); if (add) { click(add); await sleep(800); }
  const it = document.querySelector('button[aria-label="square-f"]') as HTMLElement | null; if (it) click(it); await sleep(2500);
  const cv = () => [...document.querySelectorAll('canvas')].filter(c => visible(c)).sort((a, b) => b.width * b.height - a.width * a.height)[0] as HTMLCanvasElement;
  const frameEl = () => [...document.querySelectorAll('svg rect')].find(el => el.getAttribute('stroke') === '#fff' && !el.hasAttribute('data-base-selection-rect')) as SVGRectElement | undefined;
  const measure = (tag: string) => {
    const e = frameEl(); if (!e) { log(`zoomgap ${tag}: no frame`); return; }
    const r = e.getBoundingClientRect(), sw = parseFloat(getComputedStyle(e).strokeWidth) || 0;
    const c = cv(), cr = c.getBoundingClientRect(), sx = c.width / cr.width, sy = c.height / cr.height;
    const x0 = Math.max(0, Math.floor((r.left - 6 - cr.left) * sx)), y0 = Math.max(0, Math.floor((r.top - 6 - cr.top) * sy));
    const W = Math.min(c.width - x0, Math.ceil((r.width + 12) * sx)), H = Math.min(c.height - y0, Math.ceil((r.height + 12) * sy));
    if (W <= 0 || H <= 0) { log(`zoomgap ${tag}: off canvas`); return; }
    const d = c.getContext('2d')!.getImageData(x0, y0, W, H).data;
    const cov = (x: number, y: number) => { const i = (y * W + x) * 4; return Math.abs(d[i] - d[i + 2]) < 12 ? Math.min(d[i], d[i + 1], d[i + 2]) / 255 : 0; };
    const cx = Math.floor(W * 0.3), ry = Math.floor(H * 0.3);
    let fy = -1, ly = -1, fx = -1, lx = -1;
    for (let y = 0; y < H; y++) if (cov(cx, y) > 0.03) { fy = y; break; }
    for (let y = H - 1; y >= 0; y--) if (cov(cx, y) > 0.03) { ly = y; break; }
    for (let x = 0; x < W; x++) if (cov(x, ry) > 0.03) { fx = x; break; }
    for (let x = W - 1; x >= 0; x--) if (cov(x, ry) > 0.03) { lx = x; break; }
    const T = cr.top + (y0 + fy + 1 - cov(cx, fy)) / sy, B = cr.top + (y0 + ly + cov(cx, ly)) / sy;
    const L = cr.left + (x0 + fx + 1 - cov(fx, ry)) / sx, R = cr.left + (x0 + lx + cov(lx, ry)) / sx;
    const g = (v: number) => v.toFixed(3);
    log(`zoomgap ${tag}: T ${g(T - r.top - sw / 2)} B ${g(r.bottom - sw / 2 - B)} L ${g(L - r.left - sw / 2)} R ${g(r.right - sw / 2 - R)} | frame ${g(r.left)},${g(r.top)} ${g(r.width)}x${g(r.height)} canvas ${c.width}x${c.height} css ${g(cr.width)}x${g(cr.height)} @${g(cr.left)},${g(cr.top)} dpr ${devicePixelRatio}`);
  };
  const pinch = async (x: number, y: number, f: number) => {
    const c = cv(); const pe = (type: string, id: number, px: number, py: number) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py, pointerType: 'touch', pointerId: id, isPrimary: id === 11 }));
    const d0 = 30;
    pe('pointerdown', 11, x - d0, y); await raf(); pe('pointerdown', 12, x + d0, y); await raf();
    for (let i = 1; i <= 8; i++) { const d = d0 * (1 + (f - 1) * i / 8); pe('pointermove', 11, x - d, y + i * 0.37); pe('pointermove', 12, x + d, y - i * 0.37); await raf(); }
    const d = d0 * f; pe('pointerup', 12, x + d, y); pe('pointerup', 11, x - d, y); await sleep(1500);
  };
  measure('start');
  for (let i = 0; i < 6; i++) {
    const e = frameEl(); if (!e) break; const r = e.getBoundingClientRect();
    await pinch(r.left + r.width / 2, r.top + r.height / 2, 1.13); measure(`obj${i}`);
    await sleep(2500);
  }
  for (let i = 0; i < 6; i++) {
    const c = cv().getBoundingClientRect();
    await pinch(c.left + 40, c.bottom - 40, 1.11); measure(`view${i}`);
    await sleep(2500);
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
    else if (scenario === 'widesave') await scenarioWideSave();
    else if (scenario === 'stickerperf') await scenarioStickerPerf();
    else if (scenario === 'selgap') await scenarioSelGap();
    else if (scenario === 'zoomgap') await scenarioZoomGap();
    else if (scenario.startsWith('alphafx')) await scenarioAlphaFx(scenario.split('-')[1] || 'collage');
    else if (scenario.startsWith('alphaidle')) await scenarioAlphaIdle(scenario.split('-')[1] || 'collage', scenario.split('-')[2] || 'alpha');
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
