/* 診斷紀錄：手機上才會出現、電腦重現不了的問題（閃退、存檔畫面錯亂）用的。
 * - 記在本機（localStorage），閃退、重開之後還在；最多留最近 400 行。
 * - 每 5 秒記一次心跳（含 App 回報的剩餘記憶體）。下次打開時，上一次沒有正常結束就記一筆「上次異常結束」，
 *   最後一筆心跳和最後幾個動作就是閃退前的狀態。
 * - 存檔期間（gpuWatch）才檢查 GPU 錯誤和「讀到空白畫布」：平常不檢查，不影響效能。
 * - 使用者在拼圖的「⋯」選單點「複製診斷紀錄」，貼給開發者。 */
import { nativeImage } from './nativeImage';

const KEY = 'abai-diag-log', ALIVE = 'abai-diag-alive', MAX = 400;
let lines: string[] = [];
let installed = false, gpuWatch = 0, lastMem = '';
const stamp = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`; };
const persist = () => { try { localStorage.setItem(KEY, lines.slice(-MAX).join('\n')); } catch { /* 存不下就算了 */ } };
let persistTimer = 0;
const persistSoon = () => { if (persistTimer) return; persistTimer = window.setTimeout(() => { persistTimer = 0; persist(); }, 300); };

export function diag(tag: string, ...parts: unknown[]) {
  const msg = parts.map(p => typeof p === 'string' ? p : (() => { try { return JSON.stringify(p); } catch { return String(p); } })()).join(' ');
  lines.push(`${stamp()} [${tag}] ${msg}`.slice(0, 600));
  if (lines.length > MAX * 1.5) lines = lines.slice(-MAX);
  persistSoon();
}
/** 馬上寫進本機（存檔前後這種「下一秒可能就閃退」的時候用） */
export function diagFlush() { if (persistTimer) { clearTimeout(persistTimer); persistTimer = 0; } persist(); }

const shortStack = () => (new Error().stack || '').split('\n').slice(2, 6).map(s => s.trim().replace(/^at /, '').replace(/^.*\//, '').replace(/\?[^:)]*/, '')).join(' < ');

/** 存檔期間打開 GPU／畫布檢查（可以巢狀） */
export function diagGpuWatch(on: boolean) { gpuWatch = Math.max(0, gpuWatch + (on ? 1 : -1)); }

async function heartbeat() {
  let mem = '';
  try { const p = await nativeImage(); if (p) { const m = await p.memory(); mem = `可用記憶體 ${Math.round(m.available / 1048576)}MB/${Math.round(m.physical / 1048576)}MB`; } } catch { /* 網頁版沒有 */ }
  const heap = (performance as any).memory?.usedJSHeapSize;
  if (heap) mem += ` JS ${Math.round(heap / 1048576)}MB`;
  lastMem = mem;
  try { localStorage.setItem(ALIVE, JSON.stringify({ t: Date.now(), mem, last: lines.slice(-1)[0] || '' })); } catch { /* ignore */ }
}
export const diagMemory = () => lastMem;

export function installDiag() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try { lines = (localStorage.getItem(KEY) || '').split('\n').filter(Boolean); } catch { lines = []; }
  try {
    const prev = localStorage.getItem(ALIVE);
    if (prev) { const a = JSON.parse(prev); diag('上次異常結束', `（閃退或被系統關掉）最後心跳 ${new Date(a.t).toTimeString().slice(0, 8)} ${a.mem || ''}`); }
  } catch { /* ignore */ }
  diag('啟動', navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''), `螢幕 ${screen.width}x${screen.height}@${devicePixelRatio}`);
  window.addEventListener('error', e => diag('程式錯誤', e.message, `${(e.filename || '').replace(/^.*\//, '')}:${e.lineno}`));
  window.addEventListener('unhandledrejection', e => diag('未處理錯誤', String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 300)));
  window.addEventListener('pagehide', () => { try { localStorage.removeItem(ALIVE); } catch { /* ignore */ } diagFlush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') diagFlush(); else void heartbeat(); });
  void heartbeat(); window.setInterval(() => { void heartbeat(); }, 5000);
  // GPU 錯誤、空白畫布：只在存檔期間檢查
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const fn of ['drawArrays', 'texImage2D'] as const) {
      const orig = (C.prototype as any)[fn];
      (C.prototype as any)[fn] = function (this: WebGLRenderingContext, ...a: unknown[]) {
        const r = orig.apply(this, a);
        if (gpuWatch) { const e = this.getError(); if (e) diag('GPU錯誤', fn, e === this.OUT_OF_MEMORY ? 'OUT_OF_MEMORY' : e, `${this.drawingBufferWidth}x${this.drawingBufferHeight}`, shortStack()); }
        return r;
      };
    }
  }
  const gid = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...a: any[]) {
    const d = (gid as any).apply(this, a) as ImageData;
    if (gpuWatch && d.width * d.height > 40000) {
      let blank = true; const u = d.data, step = Math.max(4, (u.length >> 10) & ~3);
      for (let i = 3; i < u.length; i += step) if (u[i]) { blank = false; break; }
      if (blank) diag('讀到空白畫布', `${d.width}x${d.height}`, shortStack());
    }
    return d;
  };
}

/** 給使用者複製的全文 */
export function diagText(): string {
  return [`ABAI 診斷紀錄（${stamp()}）`, lastMem, ...lines.slice(-MAX)].join('\n');
}
export async function copyDiag(): Promise<void> {
  const text = diagText();
  try { await navigator.clipboard.writeText(text); alert('診斷紀錄已複製，貼給開發者就可以了'); return; } catch { /* 有些情況不給寫剪貼簿 */ }
  window.prompt('請全選這段文字複製，貼給開發者：', text);
}
