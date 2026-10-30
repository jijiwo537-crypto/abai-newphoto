/* 相機的人臉磨皮：找臉 → 畫出「只有皮膚」的範圍。
 *
 * 找臉用 Google MediaPipe 的 Face Landmarker（每張臉 478 個點），在背景執行緒（faceSkin.worker）跑：
 * 載入模型、每一格偵測都不佔主執行緒，打開磨皮不會卡。相機一打開、閒下來就先在背景載好，
 * 所以一按開關就有效果。模型與執行檔都放在自己網站上，不連外部網路。
 *
 * 範圍：臉的外輪廓整塊，挖掉眼睛（含睫毛一圈）、眉毛、嘴唇、鼻孔；
 * 整張遮罩再做柔邊（模糊半徑跟著臉的大小），眼周、嘴邊、鼻翼都是慢慢過渡，沒有斷層。
 * 座標是相機原始畫面（沒鏡像）的比例座標，跟影像貼圖一一對應。 */

const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
/** 鼻孔（兩邊鼻翼下緣）附近 */
const NOSTRILS = [98, 327];

/** 遮罩長邊（像素） */
const MASK_LONG = 256;
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
  readonly canvas = document.createElement('canvas');
  faces = 0;
  /** 最大那張臉的寬度佔畫面寬度的比例（磨皮的半徑跟著臉的大小走） */
  faceFrac = 0.3;
  /** 所有臉的外框（比例座標 x0, y0, x1, y1，含一圈餘裕）：磨皮只在這個框裡算 */
  box: [number, number, number, number] = [0, 0, 1, 1];
  version = 0;
  private busy = false;
  private fresh = false;
  private seq = 0;
  private buf: Float32Array | null = null;
  private tmp: Float32Array | null = null;

  /** 送去偵測的小圖（每一格把相機畫面縮小畫上來） */
  private snap = document.createElement('canvas');
  private mainTick = 0;
  private sentAt = 0;
  constructor(private d: Detector) {
    if (d.kind === 'worker') d.w.addEventListener('message', e => { if (e.data?.type === 'faces') this.onFaces(e.data.faces); });
  }

  /** 每一格新畫面呼叫：上一張還在算就跳過（不排隊、不落後）。回傳「從上次呼叫到現在有沒有新的遮罩」 */
  update(video: HTMLVideoElement, now: number): boolean {
    const vw = video.videoWidth, vh = video.videoHeight;
    // 背景執行緒的回覆遺失（極少見）：兩秒沒回就當作沒在算
    if (this.busy && now - this.sentAt > 2000) this.busy = false;
    if (!this.busy && vw && vh && video.readyState >= 2) {
      const k = Math.min(1, DETECT_LONG / Math.max(vw, vh));
      const sw = Math.max(1, Math.round(vw * k)), sh = Math.max(1, Math.round(vh * k));
      const c = this.snap;
      if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
      try { c.getContext('2d')!.drawImage(video, 0, 0, sw, sh); } catch { return this.take(); }
      this.vw = vw; this.vh = vh;
      if (this.d.kind === 'main') {
        // 主執行緒那條退路：隔一格才找一次臉，畫面才不會一格一格卡
        if ((this.mainTick = (this.mainTick + 1) & 1)) return this.take();
        let faces: number[][] = [];
        try { faces = this.d.detect(c, now); } catch { faces = []; }
        this.onFaces(faces);
      } else if (typeof createImageBitmap === 'function') {
        this.busy = true; this.sentAt = now;
        const w = this.d.w;
        createImageBitmap(c)
          .then(bitmap => w.postMessage({ type: 'frame', bitmap, t: now, id: ++this.seq }, [bitmap]))
          .catch(() => { this.busy = false; });
      }
    }
    return this.take();
  }
  private take() {
    const f = this.fresh; this.fresh = false;
    return f;
  }
  private vw = 0; private vh = 0;

  private onFaces(faces: number[][]) {
    this.busy = false;
    const vw = this.vw, vh = this.vh;
    if (!vw || !vh) return;
    if (!faces.length && this.faces === 0) return;   // 一直都沒有臉：不用重畫
    const mw = vw >= vh ? MASK_LONG : Math.max(16, Math.round(MASK_LONG * vw / vh));
    const mh = vw >= vh ? Math.max(16, Math.round(MASK_LONG * vh / vw)) : MASK_LONG;
    const c = this.canvas;
    if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh; }
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, mw, mh);
    let frac = 0, blurPx = 2;
    for (const f of faces) {
      const P = (k: number): [number, number] => [f[k * 2] * mw, f[k * 2 + 1] * mh];
      const poly = (idx: number[], fill: string, grow = 0) => {
        g.beginPath();
        idx.forEach((k, i) => { const [x, y] = P(k); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.closePath();
        g.fillStyle = fill; g.fill();
        if (grow > 0) { g.lineWidth = grow; g.strokeStyle = fill; g.lineJoin = 'round'; g.stroke(); }
      };
      const [ax, ay] = P(234), [bx, by] = P(454);
      const faceW = Math.hypot(ax - bx, ay - by) || mw * 0.3;
      frac = Math.max(frac, Math.hypot((f[234 * 2] - f[454 * 2]) * vw, (f[234 * 2 + 1] - f[454 * 2 + 1]) * vh) / vw);
      blurPx = Math.max(blurPx, faceW * 0.045);
      // 外輪廓往內收一點：柔邊之後才不會磨到頭髮、背景
      poly(FACE_OVAL, '#fff');
      g.lineWidth = faceW * 0.04; g.strokeStyle = '#000'; g.lineJoin = 'round';
      g.beginPath(); FACE_OVAL.forEach((k, i) => { const [x, y] = P(k); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.stroke();
      poly(LEFT_EYE, '#000', faceW * 0.07);
      poly(RIGHT_EYE, '#000', faceW * 0.07);
      poly(LEFT_BROW, '#000', faceW * 0.045);
      poly(RIGHT_BROW, '#000', faceW * 0.045);
      poly(LIPS, '#000', faceW * 0.045);
      g.fillStyle = '#000';
      for (const k of NOSTRILS) { const [x, y] = P(k); g.beginPath(); g.ellipse(x, y, faceW * 0.045, faceW * 0.035, 0, 0, Math.PI * 2); g.fill(); }
    }
    if (frac > 0) this.faceFrac = frac;
    // 柔邊：三趟方塊模糊（≈ 高斯），半徑跟著臉的大小
    if (faces.length) this.feather(g, mw, mh, Math.round(blurPx / 1.7));
    if (faces.length) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const f of faces) for (let i = 0; i < f.length; i += 2) { const x = f[i], y = f[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const mx = (x1 - x0) * 0.12 + 0.01, my = (y1 - y0) * 0.12 + 0.01;
      this.box = [Math.max(0, x0 - mx), Math.max(0, y0 - my), Math.min(1, x1 + mx), Math.min(1, y1 + my)];
    }
    this.faces = faces.length;
    this.version++;
    this.fresh = true;
  }

  private feather(g: CanvasRenderingContext2D, w: number, h: number, r: number) {
    if (r < 1) return;
    const im = g.getImageData(0, 0, w, h), d = im.data, n = w * h;
    if (!this.buf || this.buf.length !== n) { this.buf = new Float32Array(n); this.tmp = new Float32Array(n); }
    const a = this.buf, t = this.tmp!;
    for (let i = 0; i < n; i++) a[i] = d[i * 4];
    const pass = (src: Float32Array, dst: Float32Array, horiz: boolean) => {
      const L = horiz ? w : h, M = horiz ? h : w, inv = 1 / (r * 2 + 1);
      for (let m = 0; m < M; m++) {
        const at = (k: number) => src[horiz ? m * w + Math.min(L - 1, Math.max(0, k)) : Math.min(L - 1, Math.max(0, k)) * w + m];
        let s = 0;
        for (let k = -r; k <= r; k++) s += at(k);
        for (let k = 0; k < L; k++) {
          dst[horiz ? m * w + k : k * w + m] = s * inv;
          s += at(k + r + 1) - at(k - r);
        }
      }
    };
    for (let it = 0; it < 3; it++) { pass(a, t, true); pass(t, a, false); }
    for (let i = 0; i < n; i++) { const v = a[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
  }
}

/** 拿到一個可以用的 FaceSkinMask（背景執行緒、模型都好了才給） */
export async function createFaceSkinMask(): Promise<FaceSkinMask | null> {
  const ok = await preloadFaceSkin();
  return ok && detector ? new FaceSkinMask(detector) : null;
}
