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
const log = (msg: string) => { void qa?.log({ msg }); };
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
const findButton = (re: RegExp) => buttons().find(b => re.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '').trim()));
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

async function makePhoto(): Promise<File> {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1200;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 1600, 1200);
  grd.addColorStop(0, '#ff7a59'); grd.addColorStop(1, '#3b5bff');
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

async function scenarioTool(name: string) {
  const re = TOOL_ENTRY[name];
  if (!re) { log(`unknown tool ${name}`); return; }
  const btn = await waitFor(() => findButton(re), 15000, `主頁的 ${name} 按鈕`);
  log(`tool ${name}: tap "${(btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 20)}"`);
  click(btn);
  await pickInGallery(name === 'collage' || name === 'layout' ? 2 : 1);
  for (const t of [3000, 4000, 6000]) {
    await sleep(t);
    logLayout(`tool ${name} +${t}`);
  }
  logButtons(`tool ${name}`);
}

/* 跨頁拼圖選一段影片、按儲存，盯著進度 */
async function scenarioLayoutVideo() {
  const btn = await waitFor(() => findButton(TOOL_ENTRY.layout), 15000, '跨頁拼圖按鈕');
  click(btn);
  await pickInGallery(1, true);
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

export async function runNativeQA() {
  qa = await nativePlugin<QAApi>('ABAIQA');
  if (!qa) { console.log('ABAIQA plugin missing'); return; }
  const { scenario } = await qa.scenario();
  if (!scenario) return;
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
    else if (scenario === 'layoutvideo') await scenarioLayoutVideo();
    else if (scenario.startsWith('tool:')) await scenarioTool(scenario.slice(5));
    log(`end ${scenario}`);
  } catch (e: any) {
    log(`FAILED ${scenario}: ${String(e?.message ?? e)}`);
    logButtons('at failure');
  }
}
