/* 相機的人臉磨皮：找臉 → 畫出「只有皮膚」的範圍。
 *
 * 找臉用 Google MediaPipe 的 Face Landmarker（每張臉 468 個點，手機上即時）。
 * 模型與執行檔都放在自己網站上（public/models、建置時複製的 mediapipe/），不連外部網路。
 * 第一次開磨皮時才下載（模型約 3.7MB），之後瀏覽器會快取。
 *
 * 範圍：臉的外輪廓整塊填白，眼睛（含睫毛一圈）、眉毛、嘴唇挖掉。
 * 畫在一張小畫布上（長邊 192），柔邊交給著色器取樣時做（見 Viewfinder 的磨皮那一趟）。
 * 座標是相機原始畫面（沒鏡像）的比例座標，跟影像貼圖一一對應。 */

type Landmark = { x: number; y: number };
type Landmarker = { detectForVideo: (v: HTMLVideoElement, t: number) => { faceLandmarks: Landmark[][] }; close: () => void };

/** 臉的外輪廓（照順序繞一圈） */
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];

let loading: Promise<Landmarker | null> | null = null;

/** 載入（只載一次）。GPU 不行就退回 CPU；都不行回 null（相機照常，只是沒有磨皮） */
export function loadFaceLandmarker(): Promise<Landmarker | null> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
      const base = new URL('./', document.baseURI).href;
      const fileset = await FilesetResolver.forVisionTasks(base + 'mediapipe');
      const make = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + 'models/face_landmarker.task', delegate },
        runningMode: 'VIDEO', numFaces: 4,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { return await make('GPU') as unknown as Landmarker; }
      catch { return await make('CPU') as unknown as Landmarker; }
    } catch {
      loading = null;   // 下次再試（例如剛剛沒網路）
      return null;
    }
  })();
  return loading;
}

/** 每一格畫面：找臉、把皮膚範圍畫到 mask 上。faces＝這一格找到幾張臉 */
export class FaceSkinMask {
  readonly canvas = document.createElement('canvas');
  faces = 0;
  /** 最大那張臉的寬度佔畫面寬度的比例（磨皮的半徑跟著臉的大小走） */
  faceFrac = 0.3;
  /** 每畫一次加一，貼圖要不要重傳看這個 */
  version = 0;
  private lastT = -1;
  constructor(private lm: Landmarker) {}

  update(video: HTMLVideoElement, now: number): boolean {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return false;
    // 時間戳一定要遞增，同一格不重算
    const t = Math.max(now, this.lastT + 1);
    if (t === this.lastT) return false;
    this.lastT = t;
    let res: { faceLandmarks: Landmark[][] };
    try { res = this.lm.detectForVideo(video, t); } catch { return false; }
    const faces = res.faceLandmarks || [];
    const long = 192;
    const mw = vw >= vh ? long : Math.max(16, Math.round(long * vw / vh));
    const mh = vw >= vh ? Math.max(16, Math.round(long * vh / vw)) : long;
    const c = this.canvas;
    if (c.width !== mw || c.height !== mh) { c.width = mw; c.height = mh; }
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, mw, mh);
    if (!faces.length && this.faces === 0) return false;   // 一直都沒有臉：不用重傳
    for (const f of faces) {
      const poly = (idx: number[], fill: string, grow = 0) => {
        g.beginPath();
        idx.forEach((k, i) => { const p = f[k]; if (!p) return; const x = p.x * mw, y = p.y * mh; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.closePath();
        g.fillStyle = fill; g.fill();
        if (grow > 0) { g.lineWidth = grow; g.strokeStyle = fill; g.lineJoin = 'round'; g.stroke(); }
      };
      // 臉的尺寸（給挖洞時往外擴用：睫毛、眉毛邊緣、唇線）
      const a = f[234], b = f[454];
      const faceW = a && b ? Math.hypot((a.x - b.x) * mw, (a.y - b.y) * mh) : mw * 0.3;
      poly(FACE_OVAL, '#fff');
      poly(LEFT_EYE, '#000', faceW * 0.05);
      poly(RIGHT_EYE, '#000', faceW * 0.05);
      poly(LEFT_BROW, '#000', faceW * 0.035);
      poly(RIGHT_BROW, '#000', faceW * 0.035);
      poly(LIPS, '#000', faceW * 0.03);
    }
    let frac = 0;
    for (const f of faces) { const a = f[234], b = f[454]; if (a && b) frac = Math.max(frac, Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh) / vw); }
    if (frac > 0) this.faceFrac = frac;
    this.faces = faces.length;
    this.version++;
    return true;
  }
}
