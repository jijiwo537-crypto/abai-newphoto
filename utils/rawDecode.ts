/**
 * 相機 RAW 的**真解碼**（去馬賽克 ＋ 白平衡 ＋ 亮部回復）。
 *
 * 跟「抽內嵌 JPEG」差在哪
 * ─────────────────────────────────────────────────────────────
 * 每個 RAW 檔裡都埋了一張相機自己沖好的 JPEG，抽出來又快又不會錯，
 * 所以那條路留著當退路。但那張已經是**8-bit、已經去完馬賽克、
 * 白平衡也已經定死**的成品 —— RAW 真正值錢的地方（爆掉的天空還能拉回來、
 * 事後改色溫、12～14 bit 的階調）在那張裡面全都沒有了。
 *
 * 這一支走的是 LibRaw：直接讀感光元件的馬賽克資料，自己做去馬賽克，
 * 套相機記錄的白平衡，並在亮部做回復。Lightroom、Capture One 打開 RAW
 * 時做的就是這一段（它們用自己的解碼器，數學細節不同，但步驟是同一套）。
 *
 * 幾件實務上很重要的事
 * ─────────────────────────────────────────────────────────────
 * ① **在 Web Worker 裡跑**（libraw-wasm 自己開的）。一張 45MP 的 RAW
 *    解起來要好幾秒，跑在主執行緒上整個 App 會凍住。
 * ② **wasm 是動態載入的**（約 2MB）。只有真的開 RAW 檔的人才會下載到，
 *    一般 JPEG 使用者一個位元組都不會付。
 * ③ **先給預覽、再換全解碼**：內嵌的那張 JPEG 幾乎是瞬間就有，先讓使用者
 *    看到東西；真解碼跑完再換掉。這是專業軟體的標準做法。
 * ④ 太大的檔案會先用半尺寸解（記憶體是手機上真正的天花板：
 *    一張 45MP 的 16-bit RGB 就是 270MB，直接解會被系統殺掉）。
 */

import { isRawFile } from './fileTypes';

/** 解出來的像素超過這個數就改用半尺寸（記憶體保護）。24MP 左右。 */
const FULL_SIZE_MAX_PX = 24_000_000;

export interface RawInfo {
  width: number;
  height: number;
  camera: string;
  iso: number;
  shutter: number;
  aperture: number;
  /** 真的走了 LibRaw（false ＝ 用內嵌預覽頂著） */
  demosaiced: boolean;
}

/** 這一次解碼要怎麼解 —— 之後接「RAW 調整面板」時就是改這裡 */
export interface RawDecodeOptions {
  /** 用相機記錄的白平衡（預設 true）。false 則用自動白平衡。 */
  useCameraWb?: boolean;
  /** 亮部處理：0 夾掉、1 不夾、2 混合、3~9 回復（預設 2） */
  highlight?: number;
  /** 曝光補償，線性倍率（1 ＝ 不動）。0.25~8。 */
  expShift?: number;
  /** 去馬賽克品質：0 線性、1 VNG、2 PPG、3 AHD（預設 3） */
  quality?: number;
  /** 關掉自動亮度（想要完全照相機曝光時設 true） */
  noAutoBright?: boolean;
}

let libRawMod: any = null;
let libRawLoading: Promise<any> | null = null;

/** 動態載入 wasm。同時有好幾張要解時也只會載一次。 */
async function getLibRaw(): Promise<any> {
  if (libRawMod) return libRawMod;
  if (!libRawLoading) {
    libRawLoading = import('libraw-wasm')
      .then(m => { libRawMod = (m as any).default || m; return libRawMod; })
      .catch(err => { libRawLoading = null; throw err; });
  }
  return libRawLoading;
}

/** 這台裝置／這個瀏覽器跑得動嗎（要有 WebAssembly 與 module worker） */
export const rawDecodeSupported = (): boolean => {
  try {
    return typeof WebAssembly === 'object' && typeof Worker === 'function';
  } catch { return false; }
};

/**
 * 把 LibRaw 給的像素（16-bit 或 8-bit、3 或 4 通道）畫成一張畫布。
 *
 * LibRaw 的 dcraw_process 輸出**已經套過 sRGB 的階調曲線**（gamm 預設就是
 * sRGB 的 0.45/4.5），所以 16→8 只要取高位元組，不需要再做一次 gamma。
 */
function toCanvas(img: { width: number; height: number; colors: number; bits: number; data: any }): HTMLCanvasElement | null {
  const { width: w, height: h, colors, bits, data } = img;
  if (!w || !h || !data) return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (!g) return null;
  const out = g.createImageData(w, h);
  const dst = out.data;
  const n = w * h;
  const shift = bits === 16 ? 8 : 0;
  if (colors >= 3) {
    for (let i = 0, s = 0, d = 0; i < n; i++, s += colors, d += 4) {
      dst[d] = data[s] >> shift;
      dst[d + 1] = data[s + 1] >> shift;
      dst[d + 2] = data[s + 2] >> shift;
      dst[d + 3] = 255;
    }
  } else {
    // 單色感光元件（少見，但真的有）
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      const v = data[i] >> shift;
      dst[d] = dst[d + 1] = dst[d + 2] = v;
      dst[d + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return cv;
}

const settingsOf = (o: RawDecodeOptions | undefined, halfSize: boolean) => ({
  useCameraWb: o?.useCameraWb !== false,
  useAutoWb: o?.useCameraWb === false,
  outputColor: 1,                     // sRGB
  outputBps: 16,                      // 16-bit 出來，我們自己降到 8（見 toCanvas）
  highlight: o?.highlight ?? 2,       // 2 ＝ 亮部混合，肉眼上最自然
  userQual: o?.quality ?? 3,          // 3 ＝ AHD，畫質與速度的平衡點
  noAutoBright: o?.noAutoBright ?? false,
  halfSize,
  ...(o?.expShift ? { expCorrec: true, expShift: o.expShift } : {}),
});

/**
 * 真的把一個 RAW 檔解開。
 *
 * @returns 一張畫好的畫布 ＋ 基本資訊；解不出來就回 null（呼叫端走內嵌預覽）
 */
export async function decodeRaw(
  file: File,
  opts?: RawDecodeOptions,
): Promise<{ canvas: HTMLCanvasElement; info: RawInfo } | null> {
  if (!rawDecodeSupported()) return null;
  let lib: any = null;
  try {
    const LibRaw = await getLibRaw();
    const bytes = new Uint8Array(await file.arrayBuffer());
    lib = new LibRaw();

    /* 先只讀 metadata，才知道要不要走半尺寸。open 本身很便宜（不解像素）。 */
    await lib.open(bytes, settingsOf(opts, false));
    const meta = await lib.metadata(false);
    const px = (meta?.width || 0) * (meta?.height || 0);
    const half = px > FULL_SIZE_MAX_PX;
    if (half) {
      /* 尺寸超標：換成半尺寸重開一次。長寬各砍一半 ＝ 記憶體只剩四分之一，
         而 24MP 以上的照片在手機上本來就會被下游再縮一次。 */
      lib.dispose();
      lib = new LibRaw();
      await lib.open(bytes, settingsOf(opts, true));
    }

    const img = await lib.imageData();
    if (!img) return null;
    const canvas = toCanvas(img);
    if (!canvas) return null;
    return {
      canvas,
      info: {
        width: canvas.width,
        height: canvas.height,
        camera: [meta?.camera_make, meta?.camera_model].filter(Boolean).join(' ').trim(),
        iso: meta?.iso_speed || 0,
        shutter: meta?.shutter || 0,
        aperture: meta?.aperture || 0,
        demosaiced: true,
      },
    };
  } catch {
    return null;
  } finally {
    try { lib?.dispose(); } catch { /* 收不掉就算了 */ }
  }
}

/** 超過這個像素數就改用高品質 JPEG（理由見 decodeRawToUrl） */
const LOSSLESS_MAX_PX = 12_000_000;

/**
 * 解完之後直接給一條網址。解不出來回 null。
 *
 * 格式的取捨：**小張用 PNG（無損），大張用 JPEG 0.95**。
 * 專業檔案當然想要全程無損，但一張 24MP 的照片編成 PNG 在手機上動輒
 * 好幾十 MB、也要好幾秒 —— 而它接下來要走的整條路（預覽、調整、存歷史）
 * 本來就是 8-bit，最後還會再編一次 JPEG。在那種情況下堅持 PNG 只是多花
 * 時間與記憶體，換不到看得出來的畫質。真正該無損的地方是「匯出」，那條路
 * 沒有經過這裡。
 */
export async function decodeRawToUrl(file: File, opts?: RawDecodeOptions): Promise<string | null> {
  const r = await decodeRaw(file, opts);
  if (!r) return null;
  const { canvas } = r;
  const lossless = canvas.width * canvas.height <= LOSSLESS_MAX_PX;
  const url = await new Promise<string | null>(resolve => {
    try {
      canvas.toBlob(
        b => resolve(b ? URL.createObjectURL(b) : null),
        lossless ? 'image/png' : 'image/jpeg',
        lossless ? undefined : 0.95,
      );
    } catch { resolve(null); }
  });
  /* 畫布用完就放掉（一張 24MP 的畫布是 96MB） */
  canvas.width = canvas.height = 0;
  return url;
}

export { isRawFile };
