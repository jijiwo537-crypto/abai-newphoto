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
const DETECT_LONG = 480;

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
      runningMode: 'VIDEO', numFaces: 4,
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

  /** 送去偵測的小圖（退路：每一格把相機畫面縮小畫上來） */
  private snap = document.createElement('canvas');
  private sentAt = 0;
  constructor(private d: Detector) {
    if (d.kind === 'worker') d.w.addEventListener('message', e => {
      const m = e.data;
      if (m?.type === 'vfFail') { this.useVideoFrame = false; this.busy = false; return; }
      if (m?.type !== 'faces') return;
      this.stat(m.ms);
      if (m.bitmap) this.onMask(m.bitmap, m.n, m.frac, m.box);
      else this.onFaces(m.faces);
    });
  }

  /** 每一格新畫面呼叫：上一張還在算就跳過（不排隊、不落後）。回傳「從上次呼叫到現在有沒有新的遮罩」 */
  update(video: HTMLVideoElement, now: number): boolean {
    const vw = video.videoWidth, vh = video.videoHeight;
    // 背景執行緒的回覆遺失（極少見）：兩秒沒回就當作沒在算
    if (this.busy && now - this.sentAt > 2000) this.busy = false;
    /* 背景執行緒找臉每秒最多 12 次：遮罩有柔邊，臉移動時看不出差別；
       少一半的縮圖、傳輸跟 CPU 運算，手機不會因為忙著找臉而發熱降頻、讓畫面變卡 */
    /* 找臉的頻率：畫面裡有臉時跟著臉走（背景執行緒每秒 15 次）；沒有臉時每秒約 7 次（太慢會很難抓到臉）。
       退路（主執行緒找臉，每次都會擋住畫面）再放慢：有臉每秒 5 次、沒臉每秒 2 次 */
    const gap = this.d.kind === 'worker' ? (this.faces ? 66 : 150) : (this.faces ? 200 : 500);
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
            return this.take();
          } catch { this.useVideoFrame = false; }
        }
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
        this.onFaces(faces);
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
  private take() {
    const f = this.fresh; this.fresh = false;
    return f;
  }
  private vw = 0; private vh = 0;

  /** 背景執行緒連遮罩都畫好了：主執行緒只要換貼圖 */
  private onMask(bitmap: ImageBitmap, n: number, frac: number, box: [number, number, number, number]) {
    this.busy = false;
    if (!n && this.faces === 0) { bitmap.close(); return; }
    const old = this.mask;
    this.mask = bitmap; this.maskW = bitmap.width; this.maskH = bitmap.height;
    if (old !== this.canvas && typeof (old as ImageBitmap).close === 'function') (old as ImageBitmap).close();
    if (frac > 0) this.faceFrac = frac;
    if (n) this.box = box;
    this.faces = n;
    this.version++;
    this.fresh = true;
  }

  private onFaces(faces: number[][]) {
    this.busy = false;
    const vw = this.vw, vh = this.vh;
    if (!vw || !vh) return;
    if (!faces.length && this.faces === 0) return;   // 一直都沒有臉：不用重畫
    const [mw, mh] = maskSize(vw, vh);
    const c = this.canvas;
    if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh; }
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const { frac, box } = drawSkinMask(g, mw, mh, faces, vw, vh, this.bufs);
    this.mask = c; this.maskW = mw; this.maskH = mh;
    if (frac > 0) this.faceFrac = frac;
    if (faces.length) this.box = box;
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
