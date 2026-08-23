/**
 * 經典拼圖裡的照片調整。
 *
 * 直接沿用「編輯」那一套像素管線（processPixels ＋ 同一批 LUT 濾鏡），
 * 兩邊調同一個數值就會得到同一個結果，不會有兩套色彩邏輯。
 * 這裡只取需要的部分：調節（不含曲線）＋濾鏡＋柔光＋模糊。
 */
import {
  processPixels,
  generateBaseCorrectionLut,
  generateCurveLut,
  fastBlur,
  hslToRgb,
  generateNoisePattern,
  DEFAULT_PARAMS,
  type EditorParams,
} from '../components/ImageEditor';
import { applyGlEffects, hasActiveFx } from './glEffects';
import { bakeColorLut, bakedToTexture } from './lutBake';
import { LutGpu } from './lutGpu';
import { loadCachedLut, saveCachedLut } from './lutStore';

/* ── 拼圖的 GPU 顏色鏈 ────────────────────────────────────────────────
   上一版我寫壞過一次：每被呼叫一次就重新上傳整張圖、烤兩次 65³ 的表、
   還另外配置兩張畫布。拖滑桿時這支是**每一幀**都被呼叫的，
   等於每幀多背這些成本，比原本的 CPU 還慢 —— 主人回報「超級卡」就是這個。

   這一版把三件事補上：
     ① 來源貼圖依「這張圖的內容」快取，同一張只上傳一次
     ② 用 33³ 而不是 65³（烤 2.2ms vs 16ms；色差 4 vs 3 色階，肉眼都分不出）
     ③ 兩張中間畫布重用，不每幀重新配置
   顏色仍然是直接呼叫現有的 processPixels 去烤，公式一行都沒重寫。 */
let gpuInst: LutGpu | null | undefined;
const getGpu = (): LutGpu | null => {
  if (gpuInst === undefined) {
    try { gpuInst = LutGpu.create(); } catch { gpuInst = null; }
  }
  /* 掉了就把它清掉，下一次呼叫會建一個新的 —— 不能一掉就永久退回 CPU */
  if (gpuInst && gpuInst.lost) {
    gpuInst = undefined;
    gpuSrcKey = '';
    return null;
  }
  return gpuInst || null;
};
let gpuSrcKey = '';
/* 每個來源物件的固定編號。用 WeakMap，圖片被回收時這裡也跟著消失。 */
let srcSeq = 0;
const srcIds = new WeakMap<object, string>();
const srcToken = (o: any): string => {
  if (!o || typeof o !== 'object') return 'x';
  let id = srcIds.get(o);
  if (!id) { id = 's' + (++srcSeq); srcIds.set(o, id); }
  return id;
};
/* ── 來源像素快取 ────────────────────────────────────────────────────
   拖調整滑桿時，每動一格都要把同一張圖重新跑一次管線。變的只有「參數」，
   來源那張圖從頭到尾一模一樣 —— 但以前每一格都要重做
   drawImage → getImageData → 複製一份，實測光這三步就佔掉整段拖曳
   將近四成的時間，而且每格丟掉一兩 MB 給垃圾回收。

   這裡把「畫下去、讀回來」的結果留著，同一張圖同一個尺寸就直接重用。
   processPixels 只讀來源、不改來源，算出來的像素一個位元都沒變。

   只有呼叫端明講 cacheSource 才會走這條 —— 來源如果是每次重畫的畫布，
   內容會變，那就不能快取。 */
type SrcPx = { px: Uint8ClampedArray; scratch: ImageData | null; plain: Uint8ClampedArray | null };
const srcPxCache = new Map<string, SrcPx>();
const SRC_PX_KEEP = 3;
const putSrcPx = (k: string, v: SrcPx) => {
  srcPxCache.delete(k);
  srcPxCache.set(k, v);
  while (srcPxCache.size > SRC_PX_KEEP) {
    const oldest = srcPxCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    srcPxCache.delete(oldest);
  }
};
let gpuC0: HTMLCanvasElement | null = null;
let gpuC1: HTMLCanvasElement | null = null;
const reuse = (c: HTMLCanvasElement | null, w: number, h: number) => {
  const cv = c || document.createElement('canvas');
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return cv;
};

const gpuColorChain = (
  ctx: CanvasRenderingContext2D, getSrc: () => Uint8ClampedArray | null, w: number, h: number,
  p: EditorParams, lut: { data: Uint8ClampedArray; size: number } | null,
  amount: number, baseLut: Uint8Array, srcKey: string,
): boolean => {
  const g = getGpu();
  if (!g || !g.fits(w, h)) return false;
  try {
    /* 只有「換了一張圖」才需要把像素讀出來上傳貼圖。
       拖滑桿時圖沒換，貼圖早就在 GPU 上了 —— 以前照樣每一格
       getImageData 一次再複製一份（1600×1200 就是兩趟 7.7MB），
       那是白花的，而且是連 GPU 這條快路都躲不掉的固定成本。 */
    if (gpuSrcKey !== srcKey) {
      const src = getSrc();
      if (!src || !g.setSource(src, w, h)) return false;
      gpuSrcKey = srcKey;
    }
    const paint = (film: Uint8ClampedArray | null, filmSize: number, into: HTMLCanvasElement) => {
      const baked = bakeColorLut(
        (a, d, ww, hh) => processPixels(a, d, ww, hh, p, film, filmSize, baseLut, null, false, IDENTITY_CURVE_LUTS),
        33,
      );
      if (!g.setLut(bakedToTexture(baked), 33)) return false;
      const drawn = g.draw();
      if (!drawn) return false;
      // GPU 的畫布下一次 draw 就會被蓋掉，先拓到自己的畫布上
      into.getContext('2d')!.drawImage(drawn, 0, 0);
      return true;
    };
    const needBlend = !!lut && amount < 1;
    gpuC0 = reuse(gpuC0, w, h);
    if (needBlend && !paint(null, 0, gpuC0)) return false;
    gpuC1 = reuse(gpuC1, w, h);
    if (!paint(lut ? lut.data : null, lut ? lut.size : 0, gpuC1)) return false;
    ctx.clearRect(0, 0, w, h);
    if (needBlend) ctx.drawImage(gpuC0, 0, 0);
    ctx.save();
    if (needBlend) ctx.globalAlpha = amount;
    ctx.drawImage(gpuC1, 0, 0);
    ctx.restore();
    return true;
  } catch {
    return false;
  }
};

/** 圖層上存的參數，全部都是可選的，沒動過就不存 */
export interface PhotoFx {
  /** 濾鏡（LUT）id，'none' 或未設定＝原始 */
  lut?: string;
  /** 濾鏡強度 0~100，預設 100 */
  lutAmount?: number;
  brightness?: number;
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  temp?: number;
  tint?: number;
  sat?: number;
  vib?: number;
  /** 柔光 0~100 */
  soft?: number;
  /** 柔光只作用在比這個亮度更亮的地方 0~95，預設 70 */
  softThreshold?: number;
  /** 柔光擴散 20~100，預設 100 */
  softRadius?: number;
  /** 柔光色相 0~100，0 = 不染色 */
  softColor?: number;
  /** 模糊 0~100 */
  blur?: number;
  /** 光暈強度 0~100 */
  fringeIntensity?: number;
  /** 光暈擴散 0~100，預設 10 */
  fringeSize?: number;
  /** 光暈範圍 0~100，預設 100 */
  fringeFeather?: number;
  /** 光暈色相 0~360，預設 8 */
  fringeHue?: number;
  /** 漏光強度 0~100 */
  leakOpacity?: number;
  /** 漏光角度 0~360，預設 45 */
  leakAngle?: number;
  /** 漏光色相 0~360，預設 15 */
  leakHue?: number;
  /** 噪點 0~100 */
  colorNoise?: number;
  /** 暗角 0~200 */
  vignette?: number;
  /* GLSL 特效（動態模糊、色散、螢幕……）的強度與細項參數。
     鍵名跟 utils/glEffects.ts 的 FX_DEFS 完全一致，沒帶到的參數在著色器那邊
     自己會退回預設值，所以這裡照樣是「沒動過就不存」。 */
  [k: `fx${string}`]: number | undefined;
}

export const ADJUST_KEYS = [
  ['brightness', '亮度'],
  ['exposure', '曝光'],
  ['contrast', '對比'],
  ['highlights', '高光'],
  ['shadows', '陰影'],
  ['temp', '色溫'],
  ['tint', '色調'],
  ['sat', '飽和度'],
  ['vib', '自然飽和度'],
] as const;

/** 有沒有動過任何一項；沒動過就完全不用跑管線 */
export const hasPhotoFx = (fx?: PhotoFx) => {
  if (!fx) return false;
  if (fx.lut && fx.lut !== 'none') return true;
  if (fx.soft || fx.blur || fx.colorNoise || fx.vignette || fx.leakOpacity || fx.fringeIntensity) return true;
  if (hasActiveFx(fx)) return true;
  return ADJUST_KEYS.some(([k]) => !!fx[k]);
};

/* ── LUT 載入 ───────────────────────────────────────────────────────
   跟編輯那邊同一種格式：8×8 排列的方塊圖，解出來是 size³ 的查色表。 */
type LutData = { data: Uint8ClampedArray; size: number };
const lutCache = new Map<string, LutData>();
const lutPending = new Map<string, Promise<LutData | null>>();

/* ── 重活的排程 ────────────────────────────────────────────────────
   解一顆濾鏡＝一次 512×512 的 getImageData ＋ 一輪 64³ 的搬運迴圈，
   量到大約 8ms 的同步運算。24 顆一起在背景解，就是 190ms 的主執行緒佔用。
   這些工作本身沒有急迫性（解好會存進 IndexedDB，第二次開 App 就不用再解），
   但只要有一顆卡在手指正在拖的那幾格，畫面就會掉一格 —— 那正是
   「第一次新增符號之後拖起來很卡」的原因：那時候 24 顆正好在背景解。

   所以動手之前先等兩件事：
     ① 使用者的手指沒有在畫面上（工具會呼叫 deferHeavyWork 把時間往後推）
     ② 瀏覽器這一格有空（requestIdleCallback）
   使用者真的點下某一顆濾鏡時走 eager，不等，維持原本的反應速度。 */
let heavyBusyUntil = 0;
/** 「現在正在跟畫面互動，重活先等一下」。拖曳時每一格呼叫一次就好，成本是一次賦值。 */
export function deferHeavyWork(ms = 350): void {
  const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + ms;
  if (t > heavyBusyUntil) heavyBusyUntil = t;
}

const nap = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** 等到「手指放開」而且「這一格有空」。最多等 waitMs，免得永遠等不到 */
async function whenIdle(waitMs = 4000): Promise<void> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const deadline = now() + waitMs;
  while (now() < heavyBusyUntil && now() < deadline) await nap(80);
  const ric = (globalThis as any).requestIdleCallback;
  if (typeof ric !== 'function') { await nap(0); return; }
  await new Promise<void>(res => ric(() => res(), { timeout: Math.max(0, deadline - now()) }));
}

export function getLoadedLut(id?: string): LutData | null {
  if (!id || id === 'none') return null;
  return lutCache.get(id) || null;
}

export function loadLut(
  id: string,
  url: string,
  /** true＝使用者正在等這一顆（點了濾鏡卡片），不排隊直接解 */
  eager = false,
): Promise<LutData | null> {
  if (!url || id === 'none') return Promise.resolve(null);
  const hit = lutCache.get(id);
  if (hit) return Promise.resolve(hit);
  const pending = lutPending.get(id);
  if (pending) return pending;

  const task = (async (): Promise<LutData | null> => {
    // 先問本機：以前解過的表直接讀回來，不用下載也不用重新解碼
    const cached = await loadCachedLut(id, url);
    if (cached) { lutCache.set(id, cached); return cached; }
    return new Promise<LutData | null>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { (async () => {
      // 背景預載：等手指放開、等這一格有空，才做這一塊同步運算
      if (!eager) await whenIdle();
      try {
        const size = img.width === img.height ? img.width / 8 : 64;
        const size2 = size * size;
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, img.width, img.height).data;
        const data = new Uint8ClampedArray(size * size * size * 3);
        for (let b = 0; b < size; b++) {
          for (let g = 0; g < size; g++) {
            for (let r = 0; r < size; r++) {
              const blockX = (b % 8) * size;
              const blockY = ((b / 8) | 0) * size;
              const pxIdx = ((blockY + g) * img.width + (blockX + r)) * 4;
              const lutIdx = (b * size2 + g * size + r) * 3;
              data[lutIdx] = px[pxIdx];
              data[lutIdx + 1] = px[pxIdx + 1];
              data[lutIdx + 2] = px[pxIdx + 2];
            }
          }
        }
        const out = { data, size };
        lutCache.set(id, out);
        saveCachedLut(id, url, data, size);
        resolve(out);
      } catch {
        resolve(null);
      }
    })(); };
    img.onerror = () => resolve(null);
    img.src = url;
    });
  })();
  lutPending.set(id, task);
  return task;
}

/* ── 套用 ──────────────────────────────────────────────────────────── */

const IDENTITY_CURVE_LUTS = {
  rgb: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
  r: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
  g: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
  b: generateCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }] as any),
};

const toParams = (fx: PhotoFx): EditorParams => ({
  ...DEFAULT_PARAMS,
  brightness: fx.brightness || 0,
  exposure: fx.exposure || 0,
  contrast: fx.contrast || 0,
  highlights: fx.highlights || 0,
  shadows: fx.shadows || 0,
  temp: fx.temp || 0,
  tint: fx.tint || 0,
  sat: fx.sat || 0,
  vib: fx.vib || 0,
  lutAmount: fx.lutAmount ?? 100,
});

/**
 * 把「這一組調整的整條顏色鏈」烤成一顆 33³ 查色表，交給 GPU 用。
 *
 * 為什麼要獨立出這一支：影片。
 * ────────────────────────────────────────────────────────────────
 * applyPhotoFx 的第一個動作是 `drawImage(來源, …)` 把來源畫進 2D 畫布。
 * 來源是圖片時那是一次性的；來源是**影片**時，那是每一格都要付的錢，
 * 而且貴得離譜 —— 實測一段 1080p 的影片，光是這一個 drawImage 就要 20.9ms
 * （手機等級的 CPU），一秒 30 格根本不可能。
 *
 * 但這裡有個關鍵：整條顏色鏈是純粹的 RGB→RGB 函數（見 lutBake 的說明），
 * 所以它可以整條收進一顆表。表烤好之後，影片那一格根本不需要進 CPU ——
 * 直接把影格上成 GPU 材質、查一次表就畫完了（實測 4.9ms，而且不佔主執行緒）。
 *
 * 顏色從哪裡來：**還是 processPixels 那一份 CPU 程式碼**，一行都沒有重寫。
 * 這一支只是餵它 33³ 個格點而已，所以影片跟照片套同一顆濾鏡，顏色是同一個。
 *
 * lutAmount（濾鏡強度）也直接烤進去：兩顆表本身就是純查表函數，
 * 「先各查一次再按比例混」跟「先把兩顆表按比例混再查一次」結果完全一樣，
 * 所以這裡混表、只留一顆，GPU 那邊就只要一個 draw call。
 *
 * @returns 給 sampler3D 用的 RGBA8 資料與邊長；沒有任何顏色調整時回 null
 *          （呼叫端看到 null 就知道「原樣顯示就好」，連查表都不必）。
 */
export function bakePhotoFxLut(fx?: PhotoFx): { tex: Uint8Array; size: number } | null {
  if (!fx || !hasPhotoFx(fx)) return null;
  const p = toParams(fx);
  const film = getLoadedLut(fx.lut);
  const amt = (fx.lutAmount ?? 100) / 100;
  const baseLut = new Uint8Array(256);
  generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, baseLut);
  const bake = (f: LutData | null) => bakeColorLut(
    (a, d, ww, hh) => processPixels(
      a, d, ww, hh, p, f ? f.data : null, f ? f.size : 0, baseLut, null, false, IDENTITY_CURVE_LUTS,
    ),
    33,
  );
  const withFilm = bake(film);
  /* 強度 100% 或根本沒挑濾鏡：一顆表就夠 */
  if (!film || amt >= 1) return { tex: bakedToTexture(withFilm), size: 33 };
  const noFilm = bake(null);
  const a = withFilm.data, b = noFilm.data;
  const mixed = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) mixed[i] = b[i] + (a[i] - b[i]) * amt;
  return { tex: bakedToTexture({ size: 33, data: mixed }), size: 33 };
}

/**
 * 把調整套到來源圖上，回傳一張畫好的 canvas。
 * w / h 是要輸出的像素大小（呼叫端自己決定預覽用小張、匯出用大張）。
 */
export function applyPhotoFx(
  source: CanvasImageSource,
  w: number,
  h: number,
  fx: PhotoFx,
  /** cacheSource：來源是固定不變的圖，像素可以留著重用。
   *  fast：手指還在滑桿上的那幾格，顏色鏈用最近鄰取樣（跟編輯頁互動時同一招）。
   *        手一停呼叫端會用 fast=false 重算一張，停下來看到的、匯出的都是完整版。
   *  out：畫在呼叫端給的這張畫布上，不要每次都開一張新的。
   *       來源是影片的時候一秒要跑幾十次，每次開一張幾百萬像素的畫布，
   *       手機的畫布記憶體幾秒就會被系統收走（＝閃退回主畫面）。
   *       尺寸一樣就直接沿用，連 width 都不重設（重設等於重新配置一次）。 */
  opts?: { cacheSource?: boolean; fast?: boolean; out?: HTMLCanvasElement },
): HTMLCanvasElement {
  const out = opts?.out || document.createElement('canvas');
  const oW = Math.max(1, Math.round(w)), oH = Math.max(1, Math.round(h));
  /* 尺寸沒變就一個字都不要寫 —— 寫 width 等於重新配置一張畫布，
     那正是「來源是影片」時每一格都會發生、又完全不必要的那一次配置。 */
  const resized = out.width !== oW || out.height !== oH;
  if (resized) { out.width = oW; out.height = oH; }
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  /* 沿用上一輪那張畫布時，裡面的東西還在。下面的 drawImage 是「整張鋪滿」，
     不透明的來源會自己蓋掉，但去背的 PNG 會疊在舊的上面 —— 所以要先清乾淨。
     剛換過尺寸的畫布本來就是空的，那一趟就不必清。 */
  if (!resized && opts?.out) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, oW, oH);
  }
  const px = hasPhotoFx(fx);
  const ck = opts?.cacheSource ? `${srcToken(source)}|${out.width}x${out.height}` : '';
  const hit = ck ? srcPxCache.get(ck) : undefined;
  /* 有快取而且等一下整張都會被 putImageData 蓋掉，就連這一次 drawImage
     都可以省。沒有要跑管線時當然還是得把原圖畫上去。 */
  if (!hit || !px) ctx.drawImage(source, 0, 0, out.width, out.height);
  if (!px) return out;

  const p = toParams(fx);
  const lut = getLoadedLut(fx.lut);
  /* 像素改成「真的要用才讀」。走 GPU 而且貼圖已經在上面時，
     這兩行完全不會執行 —— 省掉每一格一次 getImageData ＋ 一次整份複製。 */
  let img: ImageData | null = null;
  let src: Uint8ClampedArray | null = null;
  const readPixels = () => {
    if (src) return src;
    if (hit) { src = hit.px; return src; }
    img = ctx.getImageData(0, 0, out.width, out.height);
    src = new Uint8ClampedArray(img.data);
    if (ck) putSrcPx(ck, { px: src, scratch: null, plain: null });
    return src;
  };

  const baseLut = new Uint8Array(256);
  generateBaseCorrectionLut(p.exposure, p.contrast, p.brightness, baseLut);
  let gpuOk = false;

  /* 先試 GPU。這條路完全不需要把像素讀回來 ——
     後面的噪點、模糊、柔光全部在畫布上合成，沒有人要 dest 那份陣列。
     失敗就原封不動走下面的 CPU，成品一模一樣。 */
  /* 這裡本來也有一套校準（先各量一次 CPU 與 GPU、慢就退回）。拿掉了 ——
     軟體模擬的 GL 已經在 LutGpu.create() 就被擋掉，這裡不需要再猜一次；
     而只憑一次取樣下永久判斷，反而會在真手機上誤判成「不要用 GPU」。 */
  {
    const amt = (fx.lutAmount ?? 100) / 100;
    /* 來源鍵：來源物件的身分 ＋ 尺寸。以前是「尺寸＋四個取樣點」，
       但取樣點得先把整張像素讀出來 —— 為了算一把鑰匙付一次全圖回讀，
       正是上面要省掉的那一步。改成給每個來源物件一個固定編號（WeakMap），
       同一張圖重畫時鑰匙一樣，貼圖就不必重傳。 */
    const k = `${srcToken(source)}|${out.width}x${out.height}`;
    gpuOk = gpuColorChain(ctx, readPixels, out.width, out.height, p, lut, amt, baseLut, k);
  }

  if (!gpuOk) {

  readPixels();
  /* processPixels 每一顆像素的四個位元組都會寫（含 alpha 固定 255），
     所以拿一張暫存的 ImageData 來寫，跟拿剛讀回來的那張寫，結果一樣。
     有來源快取時就借那張暫存的，省掉每一格一次一兩 MB 的配置。 */
  const rec = ck ? srcPxCache.get(ck) : undefined;
  if (!img) {
    const sc = rec?.scratch;
    if (sc && sc.width === out.width && sc.height === out.height) img = sc;
    else { img = ctx.createImageData(out.width, out.height); if (rec) rec.scratch = img; }
  } else if (rec && !rec.scratch) rec.scratch = img;
  const dest = img!.data;

  const nearest = !!opts?.fast;
  processPixels(
    src!, dest, out.width, out.height, p,
    lut ? lut.data : null, lut ? lut.size : 0,
    baseLut, null, nearest, IDENTITY_CURVE_LUTS,
  );

  // 濾鏡強度：跟原本沒上濾鏡的結果混合
  const amount = (fx.lutAmount ?? 100) / 100;
  if (lut && amount < 1) {
    let plain = rec?.plain && rec.plain.length === src!.length ? rec.plain : null;
    if (!plain) { plain = new Uint8ClampedArray(src!.length); if (rec) rec.plain = plain; }
    processPixels(
      src!, plain, out.width, out.height, p,
      null, 0, baseLut, null, nearest, IDENTITY_CURVE_LUTS,
    );
    const inv = 1 - amount;
    for (let i = 0; i < dest.length; i += 4) {
      dest[i] = plain[i] * inv + dest[i] * amount;
      dest[i + 1] = plain[i + 1] * inv + dest[i + 1] * amount;
      dest[i + 2] = plain[i + 2] * inv + dest[i + 2] * amount;
    }
  }
  ctx.putImageData(img!, 0, 0);
  }

  // 特效的半徑是以 1080 長邊為基準，換算到目前這張的大小
  const scale = Math.max(out.width, out.height) / 1080;
  const W = out.width, H = out.height;

  // 噪點：彩色雜訊圖樣用 overlay 疊上去（跟編輯同一張圖樣、同一個濃度）
  if (fx.colorNoise) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = (fx.colorNoise / 100) * 0.63;
    const pat = ctx.createPattern(getNoisePattern(), 'repeat');
    if (pat) {
      ctx.scale(scale, scale);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W / scale, H / scale);
    }
    ctx.restore();
  }

  // 模糊
  if (fx.blur) {
    ctx.save();
    ctx.globalAlpha = (fx.blur / 240) * 1.5;
    const procScale = Math.min(1, 800 / Math.max(W, H));
    const tw = Math.max(1, (W * procScale) | 0);
    const th = Math.max(1, (H * procScale) | 0);
    const temp = document.createElement('canvas');
    temp.width = tw; temp.height = th;
    const tCtx = temp.getContext('2d', { willReadFrequently: true })!;
    tCtx.drawImage(out, 0, 0, tw, th);
    const tData = tCtx.getImageData(0, 0, tw, th);
    fastBlur(tData, tw, th, (fx.blur / 6) * scale * procScale * 1.5, null);
    tCtx.putImageData(tData, 0, 0);
    ctx.drawImage(temp, 0, 0, W, H);
    ctx.restore();
  }

  // 柔光：把亮部挑出來模糊之後用 screen 疊回去（含擴散與色相，跟編輯同款）
  if (fx.soft) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const softColor = fx.softColor ?? 0;
    ctx.globalAlpha = (fx.soft / 100) * (softColor > 0 ? 3.0 : 1.5);
    const procScale = Math.min(1, 800 / Math.max(W, H));
    const mw = Math.max(1, (W * procScale) | 0);
    const mh = Math.max(1, (H * procScale) | 0);
    const mask = document.createElement('canvas');
    mask.width = mw; mask.height = mh;
    const mCtx = mask.getContext('2d', { willReadFrequently: true })!;
    mCtx.drawImage(out, 0, 0, mw, mh);
    const cur = mCtx.getImageData(0, 0, mw, mh).data;
    const glow = mCtx.createImageData(mw, mh);
    const gd = glow.data;
    const threshold = ((fx.softThreshold ?? DEFAULT_PARAMS.softThreshold) / 100) * 255;
    let r_c = 0, g_c = 0, b_c = 0;
    if (softColor > 0) {
      const [tr, tg, tb] = hslToRgb(softColor / 100, 1.0, 0.5);
      r_c = tr; g_c = tg; b_c = tb;
    }
    for (let i = 0; i < cur.length; i += 4) {
      const lum = 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2];
      gd[i] = softColor > 0 ? r_c : cur[i];
      gd[i + 1] = softColor > 0 ? g_c : cur[i + 1];
      gd[i + 2] = softColor > 0 ? b_c : cur[i + 2];
      const diff = lum - threshold;
      gd[i + 3] = diff > 0 ? Math.min(255, diff * 5) : 0;
    }
    fastBlur(glow, mw, mh, ((fx.softRadius ?? 100) / 100) * 80 * scale * procScale, null);
    mCtx.putImageData(glow, 0, 0);
    ctx.drawImage(mask, 0, 0, W, H);
    ctx.restore();
  }

  // 漏光：斜向的彩色漸層用 screen 疊上去
  if (fx.leakOpacity) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const angle = fx.leakAngle ?? 45;
    const hue = fx.leakHue ?? 15;
    const rad = (angle - 180) * (Math.PI / 180);
    const r = Math.max(W, H) * 1.5;
    const cx = W / 2, cy = H / 2;
    const grad = ctx.createLinearGradient(
      cx + Math.cos(rad) * r, cy + Math.sin(rad) * r,
      cx - Math.cos(rad) * r, cy - Math.sin(rad) * r,
    );
    const [lr, lg, lb] = hslToRgb(hue / 360, 1.0, 0.5);
    grad.addColorStop(0, `rgba(${lr},${lg},${lb},${fx.leakOpacity / 100})`);
    grad.addColorStop(0.5, `rgba(${lr},${lg},${lb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 光暈：亮部暈開後只染在暗部旁邊，跟編輯同一套演算法
  if (fx.fringeIntensity) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const procScale = Math.min(1, 800 / Math.max(W, H));
    const hw = Math.max(1, (W * procScale) | 0);
    const hh = Math.max(1, (H * procScale) | 0);
    const hCanvas = document.createElement('canvas');
    hCanvas.width = hw; hCanvas.height = hh;
    const hCtx = hCanvas.getContext('2d', { willReadFrequently: true })!;
    hCtx.drawImage(out, 0, 0, hw, hh);
    const srcData = hCtx.getImageData(0, 0, hw, hh).data;
    const len = srcData.length;
    const highData = new Uint8ClampedArray(len);
    const threshold = 160;
    for (let i = 0; i < len; i += 4) {
      const luma = srcData[i] * 0.299 + srcData[i + 1] * 0.587 + srcData[i + 2] * 0.114;
      if (luma > threshold) {
        const intensity = Math.pow((luma - threshold) / (255 - threshold), 1.5);
        highData[i] = 255; highData[i + 1] = 255; highData[i + 2] = 255;
        highData[i + 3] = intensity * 255;
      }
    }
    const highImgData = new ImageData(highData, hw, hh);
    const maxBlur = hw * 0.08 * 0.8553125;
    fastBlur(highImgData, hw, hh, Math.max(1, maxBlur * ((fx.fringeSize ?? 10) / 100)), null);
    const glowImgData = new ImageData(new Uint8ClampedArray(len), hw, hh);
    const glowPixels = glowImgData.data;
    const blurred = highImgData.data;
    const [fR, fG, fB] = hslToRgb((fx.fringeHue ?? 8) / 360, 0.8, 0.35);
    const globalIntensity = (fx.fringeIntensity / 50) * 3.0;
    const falloffCurve = 1.0 + ((100 - (fx.fringeFeather ?? 100)) / 100) * 4.0;
    for (let i = 0; i < len; i += 4) {
      const alpha = blurred[i + 3] / 255;
      if (alpha > 0.005) {
        const luma = srcData[i] * 0.299 + srcData[i + 1] * 0.587 + srcData[i + 2] * 0.114;
        const darkMask = Math.pow(Math.max(0, 255 - luma) / 255, falloffCurve);
        const strength = Math.min(1.0, alpha * darkMask * globalIntensity);
        if (strength > 0.001) {
          glowPixels[i] = fR * strength;
          glowPixels[i + 1] = fG * strength;
          glowPixels[i + 2] = fB * strength;
          glowPixels[i + 3] = 255;
        }
      }
    }
    hCtx.putImageData(glowImgData, 0, 0);
    ctx.drawImage(hCanvas, 0, 0, W, H);
    ctx.restore();
  }

  // 暗角：放射狀漸層用 multiply 壓上去
  if (fx.vignette) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const v = document.createElement('canvas');
    v.width = W; v.height = H;
    const vCtx = v.getContext('2d')!;
    const grad = vCtx.createRadialGradient(W / 2, H / 2, W / 3, W / 2, H / 2, Math.max(W, H));
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1.0)');
    vCtx.fillStyle = grad;
    vCtx.fillRect(0, 0, W, H);
    const strength = fx.vignette / 100;
    ctx.globalAlpha = Math.min(1.0, strength * 0.8);
    ctx.drawImage(v, 0, 0, W, H);
    if (strength > 1.25) {
      ctx.globalAlpha = Math.min(1.0, (strength - 1.25) * 0.8);
      ctx.drawImage(v, 0, 0, W, H);
    }
    ctx.restore();
  }

  /* GLSL 特效接在整條管線的最後面，跟「編輯」那邊同一個順序、同一支函式，
     所以兩邊調同一個特效會得到同一張圖。全部都是 0 就整段跳過。 */
  if (hasActiveFx(fx)) applyGlEffects(ctx, W, H, fx);

  return out;
}

/** 噪點圖樣只做一次就重複用 */
let noisePattern: HTMLCanvasElement | null = null;
function getNoisePattern() {
  if (!noisePattern) noisePattern = generateNoisePattern('color');
  return noisePattern;
}
