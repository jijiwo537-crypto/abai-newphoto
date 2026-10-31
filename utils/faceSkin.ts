/* 相機的人臉磨皮：找臉 → 畫出「只有皮膚」的範圍。
 *
 * 找臉用 Google MediaPipe 的 Face Landmarker（每張臉 478 個點），在背景執行緒（faceSkin.worker）跑：
 * 載入模型、每一格偵測都不佔主執行緒，打開磨皮不會卡。相機一打開、閒下來就先在背景載好，
 * 所以一按開關就有效果。模型與執行檔都放在自己網站上，不連外部網路。
 *
 * 範圍：臉的外輪廓整塊，挖掉眼睛（含睫毛一圈）、眉毛、嘴唇、鼻孔；
 * 整張遮罩再做柔邊（模糊半徑跟著臉的大小），眼周、嘴邊、鼻翼都是慢慢過渡，沒有斷層。
 * 座標是相機原始畫面（沒鏡像）的比例座標，跟影像貼圖一一對應。 */

import { drawSkinMask, maskSize, type MaskBufs } from './faceSkinDraw';

/** 送去偵測的畫面長邊：模型本身吃 192／256 的小圖，送大的只是浪費傳輸 */
const DETECT_LONG = 384;

/** 找臉的引擎：背景執行緒（優先），或主執行緒（背景執行緒在這台裝置上起不來時的退路） */
type Detector =
  | { kind: 'worker'; w: Worker }
  | { kind: 'main'; detect: (src: HTMLCanvasElement, t: number) => number[][] };
let detector: Detector | null = null;
let ready: Promise<boolean> | null = null;

async function loadMain(): Promise<Detector | null> {
  try {
    const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
    const base = new URL('./', document.baseURI).href;
    const fileset = await FilesetResolver.forVisionTasks(base + 'mediapipe');
    const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: base + 'models/face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 2,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    let lm: Awaited<ReturnType<typeof make>>;
    try { lm = await make('GPU'); } catch { lm = await make('CPU'); }
    let last = 0;
    return {
      kind: 'main', detect: (src, t) => {
        t = Math.max(t, last + 1); last = t;
        return (lm.detectForVideo(src, t).faceLandmarks || []).map(f => { const a: number[] = []; f.forEach(p => a.push(p.x, p.y)); return a; });
      },
    };
  } catch { return null; }
}

function loadWorker(): Promise<Detector | null> {
  return new Promise(resolve => {
    let w: Worker;
    // 一般（classic）worker：MediaPipe 在 worker 裡用 importScripts 載 wasm，module worker 沒有這支（iPhone 上就是因此沒反應）
    try { w = new Worker(new URL('./faceSkin.worker.ts', import.meta.url)); }
    catch { resolve(null); return; }
    let settled = false;
    const done = (d: Detector | null) => { if (settled) return; settled = true; clearTimeout(timer); if (!d) w.terminate(); resolve(d); };
    // 有的裝置在背景執行緒建 GPU 環境會一直等不到回應：等太久就改用主執行緒
    const timer = setTimeout(() => done(null), 15000);
    w.addEventListener('message', e => { if (e.data?.type === 'ready') done({ kind: 'worker', w }); else if (e.data?.type === 'fail') done(null); });
    w.addEventListener('error', () => done(null));
    w.postMessage({ type: 'init', base: new URL('./', document.baseURI).href });
  });
}

/** 載入找臉的引擎（只載一次）。相機一打開就先叫，開關按下去時已經好了 */
export function preloadFaceSkin(): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    detector = await loadWorker() || await loadMain();
    if (!detector) ready = null;   // 下次再試（例如剛剛沒網路）
    try { (window as any).__faceSkinEngine = detector?.kind || 'none'; } catch { /* noop */ }
    return !!detector;
  })();
  return ready;
}

/** 每一格畫面送去找臉，結果回來就把皮膚範圍畫到 canvas 上（貼圖要不要重傳看 version） */
export class FaceSkinMask {
  /** 主執行緒畫遮罩時用的 canvas */
  readonly canvas = document.createElement('canvas');
  /** 要上傳成貼圖的遮罩：背景執行緒畫好傳回來的 ImageBitmap，或主執行緒的 canvas */
  mask: TexImageSource = this.canvas;
  maskW = 1; maskH = 1;
  faces = 0;
  /** 最大那張臉的寬度佔畫面寬度的比例（磨皮的半徑跟著臉的大小走） */
  faceFrac = 0.3;
  /** 所有臉的外框（比例座標 x0, y0, x1, y1，含一圈餘裕）：磨皮只在這個框裡算 */
  box: [number, number, number, number] = [0, 0, 1, 1];
  version = 0;
  private busy = false;
  private fresh = false;
  private seq = 0;
  private bufs: MaskBufs = { a: null, t: null };
  /** 直接從影像縮圖成 ImageBitmap（非同步，主執行緒不用等 GPU 回讀）；這台不支援就改用 canvas */
  private bitmapResize = true;
  /** 這台能不能把 VideoFrame 交給背景執行緒（不行的話背景會回報，改走 ImageBitmap） */
  private useVideoFrame = true;
  private lastVF = false;
  private vfStalls = 0;

  /** 送去偵測的小圖（退路：每一格把相機畫面縮小畫上來） */
  private snap = document.createElement('canvas');
  private sentAt = 0;
  constructor(private d: Detector) {
    if (d.kind === 'worker') d.w.addEventListener('message', e => {
      const m = e.data;
      if (m?.type === 'vfFail') { this.useVideoFrame = false; this.busy = false; return; }
      if (m?.type !== 'faces') return;
      this.vfStalls = 0;
      this.stat(m.ms); try { (window as any).__faceSkinStats.n = m.bitmap ? m.n : m.faces?.length; } catch { /* noop */ }
      if (m.bitmap) this.onMask(m.bitmap, m.n, m.frac, m.box, m.t);
      else this.onFaces(m.faces, m.t);
    });
  }

  /** 每一格新畫面呼叫：上一張還在算就跳過（不排隊、不落後）。回傳「從上次呼叫到現在有沒有新的遮罩」 */
  update(video: HTMLVideoElement, now: number): boolean {
    const vw = video.videoWidth, vh = video.videoHeight;
    // 背景執行緒的回覆遺失（極少見）：兩秒沒回就當作沒在算
    if (this.busy && now - this.sentAt > 2000) {
      this.busy = false;
      // 交 VideoFrame 過去卻一直沒回音（某些裝置背景執行緒處理不了）：連兩次就改走 ImageBitmap 那條
      if (this.lastVF && ++this.vfStalls >= 2) this.useVideoFrame = false;
    }
    /* 背景執行緒找臉每秒最多 12 次：遮罩有柔邊，臉移動時看不出差別；
       少一半的縮圖、傳輸跟 CPU 運算，手機不會因為忙著找臉而發熱降頻、讓畫面變卡 */
    /* 找臉的頻率：畫面裡有臉時跟著臉走（背景執行緒每秒 10 次，中間偶爾找不到由追蹤保持補上）；沒有臉時每秒約 4.5 次。找臉越頻繁，手機越忙、畫面幀數越低。
       退路（主執行緒找臉，每次都會擋住畫面）再放慢：有臉每秒 5 次、沒臉每秒 2 次 */
    const gap = this.d.kind === 'worker' ? (this.faces ? 100 : 220) : (this.faces ? 200 : 500);
    const due = now - this.sentAt >= gap;
    if (!this.busy && due && vw && vh && video.readyState >= 2) {
      const k = Math.min(1, DETECT_LONG / Math.max(vw, vh));
      const sw = Math.max(1, Math.round(vw * k)), sh = Math.max(1, Math.round(vh * k));
      this.vw = vw; this.vh = vh;
      if (this.d.kind === 'worker' && typeof createImageBitmap === 'function') {
        this.busy = true; this.sentAt = now;
        const w = this.d.w, id = ++this.seq;
        const send = (bitmap: ImageBitmap) => w.postMessage({ type: 'frame', bitmap, t: now, id, vw, vh }, [bitmap]);
        const viaCanvas = () => {
          const c = this.snap;
          if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
          c.getContext('2d')!.drawImage(video, 0, 0, sw, sh);
          return createImageBitmap(c);
        };
        /* 最好的路：VideoFrame 直接包住相機這一格（不複製、不讀回），整個轉交給背景執行緒，
           縮圖、找臉、畫遮罩全在背景做，主執行緒一點事都沒有（原生美顏 app 也是這樣：相機畫面直接交給另一條線處理） */
        if (this.useVideoFrame && typeof (window as any).VideoFrame === 'function') {
          try {
            const vf = new (window as any).VideoFrame(video, { timestamp: Math.round(now * 1000) });
            w.postMessage({ type: 'frame', vf, sw, sh, t: now, id, vw, vh }, [vf]);
            this.lastVF = true;
            return this.take();
          } catch { this.useVideoFrame = false; }
        }
        this.lastVF = false;
        let p: Promise<ImageBitmap>;
        try { p = this.bitmapResize ? createImageBitmap(video, { resizeWidth: sw, resizeHeight: sh, resizeQuality: 'medium' }) : viaCanvas(); }
        catch { this.bitmapResize = false; try { p = viaCanvas(); } catch { this.busy = false; return this.take(); } }
        p.then(send).catch(() => { this.bitmapResize = false; this.busy = false; });
      } else if (this.d.kind === 'main') {
        this.sentAt = now;
        const c = this.snap;
        if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
        try { c.getContext('2d')!.drawImage(video, 0, 0, sw, sh); } catch { return this.take(); }
        let faces: number[][] = [];
        const t0 = performance.now();
        try { faces = this.d.detect(c, now); } catch { faces = []; }
        this.stat(performance.now() - t0);
        this.onFaces(faces, now);
      }
    }
    return this.take();
  }
  /** 診斷用：找臉一次花多久（設定選單裡顯示，方便在手機上看是哪條路、多重） */
  private stat(ms: number) {
    if (!(ms >= 0)) return;
    this.ms = this.ms ? this.ms * 0.8 + ms * 0.2 : ms;
    try { (window as any).__faceSkinStats = { engine: this.d.kind, ms: Math.round(this.ms), vf: this.d.kind === 'worker' && this.useVideoFrame }; } catch { /* noop */ }
  }
  private ms = 0;
  /* ── 動態補償（跟專業美顏 app 同一套思路）──
     找臉一次要幾十毫秒，結果回來時臉早就移動了；而且一秒只找十次。直接用就會「磨皮範圍落後、跑掉」。
     做法：每個遮罩記住它是哪一刻的畫面算的、當時臉在哪（中心、大小），
     用 α-β 濾波器（簡化的卡爾曼濾波）一路估計臉的移動速度與縮放速度，
     每一格畫面都預測「臉現在在哪」，把遮罩平移／縮放貼到預測的位置上（GPU 上做，幾乎不花時間）。
     所以兩次找臉之間、還有結果延遲的那段時間，磨皮都會跟著臉走。 */
  /** 遮罩算的那一刻臉的中心、大小（對數） */
  private m0 = { x: 0.5, y: 0.5, ls: 0, t: 0 };
  /** 濾波器狀態：位置、速度（每毫秒） */
  private kf = { x: 0.5, y: 0.5, ls: 0, vx: 0, vy: 0, vs: 0, t: 0, ok: false };
  private track(box: [number, number, number, number], t?: number) {
    const now = performance.now();
    const at = typeof t === 'number' && t <= now && now - t < 1000 ? t : now;
    const x = (box[0] + box[2]) / 2, y = (box[1] + box[3]) / 2;
    const ls = Math.log(Math.max(1e-3, Math.sqrt((box[2] - box[0]) * (box[3] - box[1]))));
    this.m0 = { x, y, ls, t: at };
    const k = this.kf, dt = at - k.t;
    if (!k.ok || dt <= 0 || dt > 600) { Object.assign(k, { x, y, ls, vx: 0, vy: 0, vs: 0, t: at, ok: true }); return; }
    // α-β 濾波：先用速度預測，再用量到的位置修正（α 修正位置、β 修正速度）
    const px = k.x + k.vx * dt, py = k.y + k.vy * dt, ps = k.ls + k.vs * dt;
    const a = 0.9, b = 0.6;
    const rx = x - px, ry = y - py, rs = ls - ps;
    k.x = px + a * rx; k.y = py + a * ry; k.ls = ps + a * rs;
    k.vx += (b * rx) / dt; k.vy += (b * ry) / dt; k.vs += (b * rs) / dt;
    // 速度上限（避免偵測抖一下就飛出去）：每秒最多移動 1.5 個畫面、縮放 3 倍
    const cap = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    k.vx = cap(k.vx, 0.0015); k.vy = cap(k.vy, 0.0015); k.vs = cap(k.vs, 0.0011);
    k.t = at;
  }
  /** 這一刻要把遮罩怎麼貼：回傳 [遮罩中心x, y, 預測中心x, y, 縮放比]；畫面座標 uv → 遮罩座標 = m0 + (uv − 預測) × 比 */
  maskXform(now = performance.now()): [number, number, number, number, number] {
    const k = this.kf, m = this.m0;
    if (!k.ok) return [0.5, 0.5, 0.5, 0.5, 1];
    // 最多往前預測 0.3 秒；越久沒新結果，速度的信任度越低
    const dt = Math.max(0, Math.min(300, now - k.t)), damp = 1 - dt / 600;
    const x = k.x + k.vx * dt * damp, y = k.y + k.vy * dt * damp, ls = k.ls + k.vs * dt * damp;
    return [m.x, m.y, x, y, Math.exp(m.ls - ls)];
  }
  /** 預測位置上的磨皮外框（畫面座標） */
  predictedBox(now = performance.now()): [number, number, number, number] {
    const [mx, my, px, py, r] = this.maskXform(now), [x0, y0, x1, y1] = this.box;
    const f = (u: number, mc: number, pc: number) => pc + (u - mc) / r;
    // 跟「上一次量到的位置」取聯集：主畫面兩個位置都會取樣（見 Viewfinder），外框要兩個都包住
    return [Math.max(0, Math.min(x0, f(x0, mx, px))), Math.max(0, Math.min(y0, f(y0, my, py))), Math.min(1, Math.max(x1, f(x1, mx, px))), Math.min(1, Math.max(y1, f(y1, my, py)))];
  }

  /* 追蹤保持：臉移動時（動態模糊、側臉）偶爾會有一兩次找不到，以前遮罩就立刻消失、磨皮一閃一閃。
     現在找不到時先保留上一個遮罩（外框放大一點包住移動），連續 0.8 秒都找不到才真的關掉 */
  private lastFaceAt = 0;
  private holdMiss(n: number) {
    const now = performance.now();
    if (n) { this.lastFaceAt = now; return false; }
    if (this.faces && now - this.lastFaceAt < 800) {
      const [x0, y0, x1, y1] = this.box, gx = (x1 - x0) * 0.06, gy = (y1 - y0) * 0.06;
      this.box = [Math.max(0, x0 - gx), Math.max(0, y0 - gy), Math.min(1, x1 + gx), Math.min(1, y1 + gy)];
      return true;
    }
    return false;
  }
  private take() {
    const f = this.fresh; this.fresh = false;
    return f;
  }
  private vw = 0; private vh = 0;

  /** 背景執行緒連遮罩都畫好了：主執行緒只要換貼圖 */
  private onMask(bitmap: ImageBitmap, n: number, frac: number, box: [number, number, number, number], t?: number) {
    this.busy = false;
    if (!n && this.faces === 0) { bitmap.close(); return; }
    if (this.holdMiss(n)) { bitmap.close(); return; }
    const old = this.mask;
    this.mask = bitmap; this.maskW = bitmap.width; this.maskH = bitmap.height;
    if (old !== this.canvas && typeof (old as ImageBitmap).close === 'function') (old as ImageBitmap).close();
    if (frac > 0) this.faceFrac = frac;
    if (n) { this.box = box; this.track(box, t); }
    this.faces = n;
    this.version++;
    this.fresh = true;
  }

  private onFaces(faces: number[][], t?: number) {
    this.busy = false;
    const vw = this.vw, vh = this.vh;
    if (!vw || !vh) return;
    if (!faces.length && this.faces === 0) return;   // 一直都沒有臉：不用重畫
    if (this.holdMiss(faces.length)) return;
    const [mw, mh] = maskSize(vw, vh);
    const c = this.canvas;
    if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh; }
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const { frac, box } = drawSkinMask(g, mw, mh, faces, vw, vh, this.bufs);
    this.mask = c; this.maskW = mw; this.maskH = mh;
    if (frac > 0) this.faceFrac = frac;
    if (faces.length) { this.box = box; this.track(box, t); }
    this.faces = faces.length;
    this.version++;
    this.fresh = true;
  }
}

/** 拿到一個可以用的 FaceSkinMask（背景執行緒、模型都好了才給） */
export async function createFaceSkinMask(): Promise<FaceSkinMask | null> {
  const ok = await preloadFaceSkin();
  return ok && detector ? new FaceSkinMask(detector) : null;
}

/** 靜態照片找臉：回傳每張臉 478 點（比例座標，x0,y0,x1,y1…）。找不到或模型載不起來回空陣列 */
export async function detectFacesStill(src: CanvasImageSource & { width: number; height: number }): Promise<number[][]> {
  const ok = await preloadFaceSkin();
  if (!ok || !detector) return [];
  // 模型本身吃小圖，送 1024 長邊就夠（臉小的團體照也還抓得到）
  const k = Math.min(1, 1024 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  if (detector.kind === 'main') {
    try { detector.detect(c, performance.now()); return detector.detect(c, performance.now() + 33); } catch { return []; }
  }
  const wk = detector.w;
  const bitmap = await createImageBitmap(c);
  return new Promise(resolve => {
    const id = Math.random();
    const timer = setTimeout(() => { wk.removeEventListener('message', on); resolve([]); }, 8000);
    const on = (e: MessageEvent) => {
      if (e.data?.type !== 'stillFaces' || e.data.id !== id) return;
      clearTimeout(timer); wk.removeEventListener('message', on); resolve(e.data.faces || []);
    };
    wk.addEventListener('message', on);
    wk.postMessage({ type: 'still', bitmap, id }, [bitmap]);
  });
}
