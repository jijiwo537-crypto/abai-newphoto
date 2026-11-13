/* 圖片轉點陣文字（點字 Braille U+2800～U+28FF）
 *
 * 一格點字是 2×4 個點：照片縮成「字數×2」寬、「行數×4」高，每一格 8 個像素各自決定點亮或不亮。
 * 前處理（「自動」模式）：
 *   1. 依照片自己的明暗分布拉開對比（只看最暗、最亮那一小撮之外的範圍）。
 *   2. 用線稿模型畫出輪廓線，把輪廓線以「色彩增值」疊在拉好對比的照片上（疊越多次線越重）。
 *   3a. 線稿版：用一個明暗門檻轉成純黑白，再把黑色擴張幾次讓線變粗。
 *   3b. 陰影版：用 Atkinson 誤差擴散（在線性光空間）抖動成黑白點，保留灰階層次。
 *   4. 每一版各出三種大小（設定值的 0.6 倍、1 倍、1.3 倍）。
 * 全部是自己寫的實作；線稿模型是 Informative Drawings（Caroline Chan, MIT License）。 */

export interface DotArtSettings {
  /** 字數（寬度），1～200 */
  width: number;
  /** 明暗（0.01～0.99）：越大越亮 */
  threshold: number;
  /** 線條多寡：輪廓線疊幾次（0～20） */
  lines: number;
  /** 線條粗細：黑色擴張幾次（0～10） */
  thicken: number;
}
export const DOT_ART_DEFAULTS: DotArtSettings = { width: 50, threshold: 0.8, lines: 9, thicken: 2 };
/** 開啟陰影時明暗的預設值（粗細不適用） */
export const DOT_ART_SHADE_THRESHOLD = 0.65;

export interface DotArtResult { kind: 'line' | 'shade'; width: number; text: string; chars: number }

const MAX_INPUT_W = 768;

import { BLANK, canvas, ctx2d, scratchCanvas, stretchContrast, overlayLines, erodedLuma, thresholdEroded, thresholdAndThicken, ditherAt, toBraille, trimAt, trim, fillOf, curveT, CURVE_N, type Cvs, type Eroded } from './dotArtCore';
export { curveT, CURVE_N } from './dotArtCore';

/* ── 1. 讀圖：寬度最多 768，寬高裁成 4 的倍數（一格點字 4 列高） ── */
export async function prepareDotArtImage(file: Blob): Promise<HTMLCanvasElement> {
  /* 先只讀尺寸（<img> 讀檔頭就知道寬高，不會整張解碼）：4800 萬像素的照片整張解碼要將近 200MB，
     iPhone 上會讓分頁直接崩潰。寬度超過 768 就直接解碼成縮小後的尺寸（跟原本同一個縮圖呼叫，結果一樣）。 */
  const natW = await new Promise<number>(res => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { res(im.naturalWidth); URL.revokeObjectURL(url); };
    im.onerror = () => { res(0); URL.revokeObjectURL(url); };
    im.src = url;
  });
  const bmp = natW > MAX_INPUT_W
    ? await createImageBitmap(file, { resizeWidth: MAX_INPUT_W })
    : await createImageBitmap(file);
  if (bmp.width > MAX_INPUT_W) {   // 讀不到尺寸的特殊格式：照舊縮
    const small = await createImageBitmap(file, { resizeWidth: MAX_INPUT_W }); bmp.close();
    return finishPrepared(small);
  }
  return finishPrepared(bmp);
}
function finishPrepared(bmp: ImageBitmap): HTMLCanvasElement {
  let w = bmp.width, h = bmp.height;
  if (w > 20) { w -= w % 4; h -= h % 4; }
  const c = canvas(w, h) as HTMLCanvasElement;
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}


/* ── 3. 線稿模型（背景執行緒） ── */
/* 只用 CPU（單執行緒 WebAssembly）那支 worker。
   試過 WebGPU：iPhone 上要多載一份較大的執行檔、模型要兩份（GPU 自我檢查用），
   768px 的中間結果在 GPU 上又要好幾百 MB —— Safari 會直接把整個分頁關掉（導入圖片就崩潰），所以拿掉。 */
let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
const modelUrl = () => new URL(`${(import.meta as any).env?.BASE_URL || '/'}models/line-art.onnx`, location.href).href;
function lineWorker() {
  if (!worker) {
    worker = new Worker(new URL('./lineArt.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    worker.onerror = e => { for (const p of pending.values()) p.rej(e); pending.clear(); worker?.terminate(); worker = null; };
  }
  return worker;
}
const call = (msg: any) => new Promise<any>((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej });
  lineWorker().postMessage({ ...msg, id, modelUrl: modelUrl() }, msg.data ? [(msg.data as Float32Array).buffer] : []);
});
/** 離開點陣工具時呼叫：線稿模型（ONNX，載入後連同中間結果可佔數百 MB）跟線稿那條背景執行緒都關掉，
 *  記憶體立刻還給系統。不關的話它們一直留著，接著打開藝術效果之類吃記憶體的工具，iPhone 會直接把 App 收掉重開。
 *  下次再打開點陣工具會自動重新建立。 */
export function releaseDotArtWorkers() {
  const w = worker, ls = lineStage;
  worker = null; lineStage = undefined; lsOwner = null;
  /* 不在運算中途硬關：手上的工作做完、模型先自己釋放，再結束執行緒。
     結果已經沒人要了，回來的訊息直接丟掉 */
  // 線稿那支是一個接一個處理訊息：「釋放」排在手上的運算後面，回報了才結束它（最多等 60 秒）
  const mineLs = new Set(lsPending.keys());
  void (async () => {
    if (w) {
      await new Promise<void>(res => {
        const t = setTimeout(res, 60000);
        const prev = w.onmessage;
        w.onmessage = e => { if (e.data?.id === -1) { clearTimeout(t); res(); } else prev?.call(w, e); };
        try { w.postMessage({ type: 'dispose', id: -1 }); } catch { clearTimeout(t); res(); }
      });
      try { w.terminate(); } catch { /* */ }
    }
    if (ls) {
      const t0 = Date.now();
      while ([...mineLs].some(id => lsPending.has(id)) && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 200));
      try { ls.terminate(); } catch { /* */ }
    }
  })();
}
/** 先把模型載好（打開工具就開始下載，按「產生」時就不用等） */
export const warmLineArtModel = () => call({ type: 'warm' }).catch(() => {});

const lineArtCache = new WeakMap<Cvs, Cvs>();
async function lineArt(src: Cvs): Promise<Cvs> {
  const hit = lineArtCache.get(src); if (hit) return hit;
  const w = src.width, h = src.height, px = ctx2d(src).getImageData(0, 0, w, h).data, plane = w * h;
  const input = new Float32Array(plane * 3);
  for (let i = 0, p = 0; p < plane; i += 4, p++) { input[p] = px[i] / 255; input[plane + p] = px[i + 1] / 255; input[2 * plane + p] = px[i + 2] / 255; }
  const out = await call({ type: 'run', data: input, width: w, height: h });
  (globalThis as any).__dotArtTiming = { wait: out.waitMs, run: out.runMs, ep: out.ep, w, h };
  const ow = out.width, oh = out.height, v = out.data as Float32Array;
  const c = canvas(ow, oh), g = ctx2d(c), img = g.createImageData(ow, oh), d = img.data;
  for (let p = 0, i = 0; p < v.length; p++, i += 4) { const x = 255 * v[p]; d[i] = x; d[i + 1] = x; d[i + 2] = x; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  lineArtCache.set(src, c);
  return c;
}

/** 拉好對比的照片 × 輪廓線（色彩增值疊 lines 次） */
async function preprocess(src: Cvs, base: Cvs, lines: number): Promise<Cvs> {
  return overlayLines(base, lines > 0 ? await lineArt(src) : null, lines);
}

/* ── 4a. 線稿版：明暗門檻 → 黑色擴張 ──
   門檻 f(L)=clamp(256·L − 255·level) 對亮度 L 是單調遞增的，所以「先門檻再取 3×3 最暗」＝「先取最暗再門檻」。
   拖明暗滑桿時只重做最便宜的門檻那一步；擴張（最花時間）每組「線條／粗細」只做一次。結果逐像素相同。 */

/** 反轉：每一格的 8 個點亮暗互換 */
export const invertDotArt = (text: string) =>
  Array.from(text, ch => { const c = ch.charCodeAt(0); return c >= 0x2800 && c <= 0x28ff ? String.fromCharCode(0x2800 + (0xff ^ (c - 0x2800))) : ch; }).join('');

/** 一張圖的全部結果：陰影版在前、線稿版在後，各三種大小 */
export async function generateDotArt(src: Cvs, s: DotArtSettings, onStep?: (label: string) => void): Promise<{ preview: Cvs; results: DotArtResult[] }> {
  const pre = await preprocess(src, stretchContrast(src), s.lines);
  const sizes = [Math.round(0.6 * s.width), s.width, Math.round(1.3 * s.width)];
  const groups: DotArtResult[][] = [];
  // 線稿版
  const thr = s.threshold || 0.5;
  const line = thresholdAndThicken(pre, Math.round(255 * (1 - thr)), s.thicken);
  const lineRes: DotArtResult[] = [];
  for (const w of sizes) {
    onStep?.(`線稿 ${w} 字`);
    await new Promise(r => setTimeout(r, 0));
    const t = trim(toBraille(line, 128, w));
    if (t) { const text = t.join('\n'); lineRes.push({ kind: 'line', width: w, text, chars: text.length }); }
  }
  groups.push(lineRes);
  // 陰影版
  const shadeRes: DotArtResult[] = [];
  for (const w of sizes) {
    onStep?.(`陰影 ${w} 字`);
    await new Promise(r => setTimeout(r, 0));
    const t = trim(toBraille(ditherAt(pre, w, 2 * s.threshold), 128, w));
    if (t) { const text = t.join('\n'); shadeRes.push({ kind: 'shade', width: w, text, chars: text.length }); }
  }
  groups.unshift(shadeRes);
  return { preview: pre, results: groups.flat() };
}

/* ── 即時預覽用：同一張圖的各階段各留一份，拖滑桿時只重算變了的那一段 ──
   線稿模型只跑一次；「線條多寡」變了才重疊；「粗細」變了才重做擴張；「明暗」只重做門檻；「大小」只重排點字。 */
/** 主要成品：收邊後的文字，加上它在「整張照片的點陣」裡的位置（預覽用固定的框，拖滑桿時才不會跳） */
export interface DotArtFrame { text: string; left: number; top: number; cols: number; rows: number }
/** 一次算圖的結果：成品（整張空白時是 null） */
export interface DotArtRender { frame: DotArtFrame | null }
/** 明暗滑桿的對照表算好時通知：key＝「線稿/陰影|輪廓|字數」，curve[k]＝明暗 curveT(k) 時點亮的比例 */
export type CurveListener = (key: string, curve: Float32Array) => void;
/* 線稿版在背景執行緒算（見 dotArtLine.worker）：主畫面不卡，閒下來時先算好輪廓的前後幾格。
   不支援 OffscreenCanvas 的瀏覽器，或背景執行緒出錯時，自動改回在主畫面算（結果一樣）。 */
let lineStage: Worker | null | undefined, lsSeq = 0, lsOwner: object | null = null;
const lsPending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
function lineStageWorker(): Worker | null {
  if (lineStage !== undefined) return lineStage;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return (lineStage = null);
  try {
    const w = new Worker(new URL('./dotArtLine.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = e => { if (e.data.type === 'curve') { (lsOwner as DotArtSession | null)?.workerCurve(e.data); return; } const p = lsPending.get(e.data.id); if (!p) return; lsPending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    w.onerror = e => { e.preventDefault?.(); for (const p of lsPending.values()) p.rej(new Error('line stage worker failed')); lsPending.clear(); w.terminate(); lineStage = null; };
    lineStage = w;
  } catch { lineStage = null; }
  return lineStage;
}
const lsCall = (msg: any, transfer: Transferable[] = []) => new Promise<any>((res, rej) => {
  const w = lineStageWorker(); if (!w) { rej(new Error('no worker')); return; }
  const id = ++lsSeq; lsPending.set(id, { res, rej }); w.postMessage({ ...msg, id }, transfer);
});

export class DotArtSession {
  private pre = new Map<number, Cvs>();
  private eroded = new Map<string, Eroded>();
  private line = new Map<string, Cvs>();
  /** 線稿模型跑完了沒（跑完之前先用「不疊線」的版本頂著，不用乾等） */
  modelReady = false;
  private base: Cvs | null = null;   // 對比拉開的照片：跟輪廓無關，只算一次
  private useWorker = true;
  private sentBase: Promise<void> | null = null;
  private sentLa: Promise<void> | null = null;
  constructor(readonly src: Cvs) {}
  /** 背景跑線稿模型（第一次比較久） */
  async prepare() { await lineArt(this.src); this.modelReady = true; }
  private baseCanvas() { if (!this.base) this.base = stretchContrast(this.src); return this.base; }
  private async preFor(lines: number) {
    let c = this.pre.get(lines);
    if (!c) {
      c = await preprocess(this.src, this.baseCanvas(), lines);
      if (this.pre.size >= 4) { const [k, old] = this.pre.entries().next().value as [number, Cvs]; old.width = old.height = 0; this.pre.delete(k); }
      this.pre.set(lines, c);
    } else { this.pre.delete(lines); this.pre.set(lines, c); }   // 最近用的排到最後
    return c;
  }
  /** 線稿版在背景執行緒算出整張的點字；不能用時回 null（改在主畫面算） */
  /** 明暗對照表算好時叫這個（畫面拿去換算滑桿位置） */
  onCurve: CurveListener | null = null;
  private curveKeys = new Set<string>();
  private curveRun: { key: string; cancel: boolean } | null = null;
  /** 背景執行緒算好線稿版的對照表 */
  workerCurve(m: { lines: number; thicken: number; width: number; curve: Float32Array }) {
    const key = `line|${m.lines}|${m.width}`;
    this.curveKeys.add(key); this.onCurve?.(key, m.curve);
  }
  /** 在主畫面一格一格算對照表（陰影版，或背景執行緒不能用時的線稿版）：每格算完讓出一下，不卡畫面 */
  private sampleCurve(kind: 'line' | 'shade', s: DotArtSettings) {
    const key = `${kind}|${s.lines}|${s.width}`;
    if (this.curveKeys.has(key) || this.curveRun?.key === key) return;
    if (this.curveRun) this.curveRun.cancel = true;
    const run = { key, cancel: false }; this.curveRun = run;
    const fills = new Float32Array(CURVE_N);
    let k = 0;
    const step = async () => {
      if (run.cancel) return;
      try {
        const t = curveT(k);
        let full: string[];
        if (kind === 'line') {
          const ek = `${s.lines}|${s.thicken}`;
          let e = this.eroded.get(ek);
          if (!e) { e = erodedLuma(await this.preFor(s.lines), s.thicken); if (this.eroded.size > 4) this.eroded.clear(); this.eroded.set(ek, e); }
          const c = thresholdEroded(e, Math.round(255 * (1 - t))); full = toBraille(c, 128, s.width); c.width = c.height = 0;
        } else full = toBraille(ditherAt(await this.preFor(s.lines), s.width, 2 * t), 128, s.width);
        fills[k++] = fillOf(full);
      } catch { if (this.curveRun === run) this.curveRun = null; return; }
      if (k < CURVE_N) setTimeout(step, 0);
      else { if (this.curveRun === run) this.curveRun = null; this.curveKeys.add(key); this.onCurve?.(key, fills); }
    };
    setTimeout(step, 500);   // 停手一下才開始（拖數量、輪廓時每一格都會換一份，邊拖邊算會卡）
  }
  private async lineInWorker(s: DotArtSettings, level: number): Promise<{ full: string[] } | null> {
    if (!this.useWorker || !lineStageWorker()) return null;
    try {
      if (lsOwner !== this) { lsOwner = this; this.sentBase = null; this.sentLa = null; }
      if (!this.sentBase) this.sentBase = createImageBitmap(this.baseCanvas()).then(b => lsCall({ type: 'init', base: b }, [b]));
      await this.sentBase;
      if (s.lines > 0) {
        if (!this.sentLa) this.sentLa = lineArt(this.src).then(la => createImageBitmap(la)).then(b => lsCall({ type: 'lineArt', la: b }, [b]));
        await this.sentLa;
      }
      if (lsOwner !== this) return null;
      const r = await lsCall({ type: 'render', lines: s.lines, thicken: s.thicken, level, width: s.width });
      return r.skipped ? null : { full: r.full };
    } catch (e) { console.warn('dot art worker → main thread', e); this.useWorker = false; return null; }
  }
  async render(kind: 'line' | 'shade', s0: DotArtSettings): Promise<DotArtFrame | null> { return (await this.renderWithCurve(kind, s0)).frame; }
  /** 算好的成品（同一張照片、同樣設定）：線稿／陰影來回切、滑桿拖回原處時直接拿，不重算 */
  private frames = new Map<string, DotArtRender>();
  /** prewarm＝閒下來時先算好另一種（不去動明暗對照表的排程） */
  async renderWithCurve(kind: 'line' | 'shade', s0: DotArtSettings, prewarm = false): Promise<DotArtRender> {
    const s = this.modelReady ? s0 : { ...s0, lines: 0 };
    const fk = `${kind}|${s.lines}|${s.thicken}|${s.width}|${kind === 'line' ? Math.round(255 * (1 - (s.threshold || 0.5))) : s.threshold}`;
    const hit = this.frames.get(fk);
    if (hit) { this.frames.delete(fk); this.frames.set(fk, hit); return hit; }
    const r = await this.compute(kind, s, prewarm);
    this.frames.set(fk, r);
    while (this.frames.size > 64) this.frames.delete(this.frames.keys().next().value as string);
    return r;
  }
  private async compute(kind: 'line' | 'shade', s: DotArtSettings, prewarm: boolean): Promise<DotArtRender> {
    let full: string[] | null = null;
    if (kind === 'line') {
      const level = Math.round(255 * (1 - (s.threshold || 0.5))), ek = `${s.lines}|${s.thicken}`, key = `${ek}|${level}`;
      const w = await this.lineInWorker(s, level);
      if (w) full = w.full;
      if (!full) {
        const pre = await this.preFor(s.lines);
        let c = this.line.get(key);
        if (!c) {
          let e = this.eroded.get(ek);
          if (!e) { e = erodedLuma(pre, s.thicken); if (this.eroded.size > 4) this.eroded.clear(); this.eroded.set(ek, e); }
          c = thresholdEroded(e, level);
          if (this.line.size >= 8) { const [k, old] = this.line.entries().next().value as [string, Cvs]; old.width = old.height = 0; this.line.delete(k); }
          this.line.set(key, c);
        }
        full = toBraille(c, 128, s.width);
        if (!prewarm) this.sampleCurve('line', s);
      }
    } else {
      const pre = await this.preFor(s.lines);
      full = toBraille(ditherAt(pre, s.width, 2 * s.threshold), 128, s.width);
      if (!prewarm) this.sampleCurve('shade', s);
    }
    const t = trimAt(full);
    return { frame: t ? { text: t.lines.join('\n'), left: t.left, top: t.top, cols: full[0]?.length || s.width, rows: full.length } : null };
  }
  /** 測試用：強制在主畫面算 */
  set workerEnabled(v: boolean) { this.useWorker = v; }
}
