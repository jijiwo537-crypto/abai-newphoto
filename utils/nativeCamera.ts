/* 原生相機（專業模式，對應 ios/App/App/NativeCameraPlugin.swift）。
 * 4800 萬像素、ProRAW、零快門延遲、相機控制按鈕。網頁版每一支都回 null。 */
import { nativePlugin, fileSrc, rememberNativeFile, rememberNativePath } from './nativeBridge';
import { nativeImage } from './nativeImage';

export type CameraMenuItem =
  | { id: string; type: 'toggle'; title: string; symbol: string; value: boolean }
  | { id: string; type: 'choice'; title: string; symbol: string; value: string; options: { label: string; value: string }[] };

export interface NativeCameraApi {
  available(): Promise<{ available: boolean; proRAW: boolean; raw?: boolean }>;
  /** 開著 RAW：每一張都完整多張合成（關掉為了速度降品質的選項） */
  setRawMode?(o: { on: boolean }): Promise<void>;
  start(o: { position: 'back' | 'front'; x: number; y: number; w: number; h: number; radius?: number; lut?: string; amount?: number; proRAW?: boolean }): Promise<{ proRAW: boolean; raw?: boolean; turns?: number; minZoom?: number; maxZoom?: number; maxWidth: number; maxHeight: number; flash?: boolean; screenFlash?: boolean }>;
  stop(): Promise<void>;
  setRect(o: { x: number; y: number; w: number; h: number; radius?: number }): Promise<void>;
  capture(o: { flash: 'off' | 'on' | 'auto'; raw?: boolean; turns?: number; opticalZoom?: number }): Promise<{ path: string; width: number; height: number; rawPath?: string; zoomApplied?: number; location?: { lat: number; lon: number; alt?: number; time?: number } }>;
  /** 日期戳記（null＝不印），觀景窗右下角；zoom＝小框構圖的倍率（字印在框的右下角、照框的大小） */
  setDate(o: { date: string | null; zoom?: number }): Promise<void>;
  /** 觀景窗整個藏起來（相簿、RAW 沖洗蓋在上面時） */
  setPreviewHidden?(o: { hidden: boolean }): Promise<void>;
  /** 觀景窗現在這一格（離開相機的過場用） */
  snapshot(): Promise<{ path: string }>;
  /** 水平儀：開著時送 level 事件 { roll（度）, flat } */
  setLevel(o: { on: boolean }): Promise<void>;
  /** 位置：開著時拍照會帶 location，寫進照片的 GPS */
  setLocation(o: { on: boolean }): Promise<{ authorized?: boolean; denied?: boolean }>;
  /** 原生設定選單（iOS 26 起是液態玻璃）。改了送 menu { id, value }，關掉送 menuClosed */
  showMenu(o: { anchor: { x: number; y: number; w: number; h: number }; bounds?: { x: number; y: number; w: number; h: number }; items: CameraMenuItem[] }): Promise<void>;
  setZoom(o: { uiZoom?: number; factor?: number }): Promise<{ factor: number }>;
  focus(o: { x: number; y: number }): Promise<void>;
  setExposureBias(o: { ev: number }): Promise<void>;
  setWhiteBalance(o: { kelvin?: number; auto?: boolean }): Promise<void>;
  setFx(o: { soft: number; blur: number; lowfi: number }): Promise<void>;
  setLut(o: { lut: string; amount?: number }): Promise<void>;
  addListener(event: 'shutter' | 'zoom' | 'orientation' | 'level' | 'menu' | 'menuClosed', cb: (data: any) => void): Promise<{ remove: () => void }>;
}

export const nativeCamera = () => nativePlugin<NativeCameraApi>('NativeCamera');

/** './luts/f3.webp' → 'f3.webp'（原生端用 App 內建的同一份檔案）；原始＝'' */
export const lutFileName = (url: string | undefined | null) => (url ? url.split('/').pop()!.split('?')[0] : '');

/** 拍一張：原生全解析度拍照 → 原生端套濾鏡、裁成畫面比例（16 位元流程）→ 回傳網頁可用的網址 */
export async function captureNative(o: {
  flash: 'off' | 'on' | 'auto'; raw: boolean; lut: string; aspect: number; zoom: number;
  /** 手機怎麼拿（0 直、1 頂端朝左、3 頂端朝右）：橫拿拍出橫的照片 */
  turns?: number;
  /** 目前鏡頭的介面倍率（1＝主鏡頭）。有小框（zoom > 1）時拍照那一下鏡頭直接變焦到「倍率 × 框」，不是事後裁切 */
  baseZoom?: number;
  /** 濾鏡強度 0～1（每顆濾鏡的最大強度，跟編輯頁一致） */
  amount?: number;
  /** 相機特效（0～1），拍出來的照片跟觀景窗看到的一樣 */
  fx?: { soft: number; blur: number; lowfi: number };
  /** 色溫（跟觀景窗一樣的公式），拍出來的照片跟看到的一樣 */
  kelvin?: number;
  /** 底片模式（RAW）：拍的時候少曝光了幾格保護亮部，成品照片沖回這麼多格（亮部柔收） */
  develop?: number;
  /** 日期戳記的字 */
  date?: string | null;
  /** 保留原始圖片：沒開 RAW 時，沒套濾鏡的原圖也留下來（originalPath，呼叫端存完要刪） */
  keepOriginal?: boolean;
}): Promise<{ url: string; path: string; cleanPath?: string; rawPath?: string; renderedPath?: string; originalPath?: string; cropZoom: number; /** 有日期時：沒印日期的同一張（編輯用這張，存檔時再印） */ cleanUrl?: string } | null> {
  const cam = await nativeCamera(), img = await nativeImage();
  if (!cam || !img) return null;
  /* 小框：鏡頭真的變焦過去拍（清楚）；變不到的部分才用裁切補 */
  const wantOptical = o.zoom > 1.001 && o.baseZoom ? o.baseZoom * o.zoom : undefined;
  const shot = await cam.capture({ flash: o.flash, raw: o.raw, turns: o.turns ?? 0, opticalZoom: wantOptical });
  const cropZoom = wantOptical && shot.zoomApplied ? Math.max(1, wantOptical / shot.zoomApplied) : o.zoom;
  /* 開 RAW：成品從 RAW 沖（我們的 RAW 引擎、原尺寸完整品質，先照畫面比例、小框裁好），存成 16 位元無損的中間檔，
     再套濾鏡、特效 —— 不是從系統壓好的 HEIC 套。沖不出來才退回 HEIC */
  let src = shot.path, fromRaw = '';
  if (o.raw && shot.rawPath) {
    const rd = await rawDev();
    const cropLook: RawLook = { lut: '', amount: 0, aspect: o.aspect, zoom: cropZoom, fx: { soft: 0, blur: 0, lowfi: 0 }, date: null };
    try { if (rd?.developFull) fromRaw = (await rd.developFull({ path: shot.rawPath, params: rawParams({ exposure: o.develop || 0, highlights: 0, shadows: 0 }), look: cropLook, format: 'tiff16' })).path; }
    catch { fromRaw = ''; }
    if (fromRaw) src = fromRaw;
  }
  const out = await img.render({
    path: src, lut: o.lut || undefined, amount: o.amount ?? 1,
    /* 從 RAW 沖的已經裁好了 */
    aspect: fromRaw ? 0 : o.aspect, zoom: fromRaw ? 1 : cropZoom, fx: o.fx, kelvin: o.kelvin,
    develop: fromRaw ? undefined : (o.develop || undefined), gps: shot.location || undefined,
    format: 'jpeg', quality: 0.95,
  });
  if (fromRaw) img.remove({ path: fromRaw }).catch(() => {});
  /* 保留原始圖片（沒開 RAW）：系統拍的那張原圖留給呼叫端存相簿；不然就刪 */
  const originalPath = o.keepOriginal && !shot.rawPath ? shot.path : undefined;
  if (!originalPath) img.remove({ path: shot.path }).catch(() => {});
  /* 日期：先留一張沒印的（之後編輯都改這張，日期不會被調色、濾鏡影響），再從它印出成品 */
  let cleanPath: string | undefined;
  if (o.date) {
    const stamped = await img.render({ path: out.path, date: o.date, gps: shot.location || undefined, format: 'jpeg', quality: 0.95 });
    cleanPath = out.path;
    out.path = stamped.path;
  }
  /* 收進相機相簿資料夾（不會被系統清暫存清掉、App 更新也還在），直接用檔案網址顯示：
     網頁不用把整張照片讀進記憶體，編輯存檔也能走原生 */
  const keep = async (p?: string) => {
    if (!p) return undefined;
    try { return img.persist ? (await img.persist({ path: p })).path : p; } catch { return p; }
  };
  const mainPath = (await keep(out.path))!;
  const keptClean = await keep(cleanPath);
  const keptRaw = await keep(shot.rawPath);
  const url = fileSrc(mainPath); rememberNativePath(url, mainPath);
  let cleanUrl: string | undefined;
  if (keptClean) { cleanUrl = fileSrc(keptClean); rememberNativePath(cleanUrl, keptClean); }
  return { url, path: mainPath, cleanPath: keptClean, rawPath: keptRaw, renderedPath: keptRaw ? mainPath : undefined, originalPath, cropZoom, cleanUrl };
}

/** 編輯完的圖重新印上日期（日期是「光加上去」的：畫面變暗，字自然更清楚）。沒有原生或失敗回 null */
export async function stampDateOnto(url: string, date: string): Promise<string | null> {
  const img = await nativeImage();
  if (!img) return null;
  let tmp = '', out = '';
  try {
    const blob = await (await fetch(url)).blob();
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(blob); });
    tmp = (await img.writeTemp({ data: b64, ext: blob.type.includes('png') ? 'png' : 'jpg' })).path;
    out = (await img.render({ path: tmp, date, format: 'jpeg', quality: 0.95 })).path;
    const b = await (await fetch(fileSrc(out))).blob();
    return URL.createObjectURL(new Blob([b], { type: 'image/jpeg' }));
  } catch { return null; }
  finally { for (const p of [tmp, out]) if (p) img.remove({ path: p }).catch(() => {}); }
}

/** RAW 拍攝時刻意少曝光幾格保護亮部。ProRAW 用品質優先時多張合成本身就保護了亮部，再少曝光只會讓暗部多雜訊：跟原相機一樣正常曝光 */
export const RAW_PROTECT_EV = 0;

export interface RawDevelop {
  /** 曝光（EV）；色溫（K）、色調：不給＝拍攝當下的白平衡 */
  exposure: number; temperature?: number; tint?: number;
}

/** 拍照當下的「樣子」：重新沖洗時照樣套上（濾鏡、特效、裁切、日期），沖出來跟相機拍的一致 */
export interface RawLook {
  lut: string; amount: number; aspect: number; zoom: number;
  fx?: { soft: number; blur: number; lowfi: number };
  date?: string | null;
}

/** 相機拍的 RAW（DNG 檔路徑）→ 沖成一張圖：iOS 內建的 RAW 解碼（從感光元件的原始資料算，亮部、暗部留得比一般照片多），
 *  再套上拍照當下的濾鏡、特效、裁切、日期（跟拍照同一支原生程式）。
 *  preview：沖洗時的即時預覽（長邊 1400、快速模式）。回傳網址與拍攝當下的白平衡；沒有原生解碼或失敗回 null */
export async function developRaw(rawPath: string, dev: RawDevelop = { exposure: 0 }, look: RawLook | null = null, preview = false):
  Promise<{ url: string; asShotTemperature?: number; asShotTint?: number } | null> {
  const dec = await nativePlugin<{ decodeFile(o: Record<string, unknown>): Promise<{ path: string; asShotTemperature?: number; asShotTint?: number }> }>('RawDecode');
  const img = await nativeImage();
  if (!dec || !img) return null;
  let decoded = '', rendered = '';
  try {
    const r = await dec.decodeFile({
      path: rawPath, exposure: dev.exposure, temperature: dev.temperature, tint: dev.tint,
      maxPixel: preview ? 1400 : 0, draft: preview,
    });
    decoded = r.path;
    let out = r.path;
    if (look) {
      const o = await img.render({
        path: r.path, lut: look.lut || undefined, amount: look.amount, aspect: look.aspect, zoom: look.zoom,
        fx: look.fx, date: look.date || undefined, format: 'jpeg', quality: preview ? 0.85 : 0.95,
      });
      rendered = o.path; out = o.path;
    }
    const blob = await (await fetch(fileSrc(out))).blob();
    return { url: URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' })), asShotTemperature: r.asShotTemperature, asShotTint: r.asShotTint };
  } catch { return null; }
  finally {
    for (const p of [decoded, rendered]) if (p) img.remove({ path: p }).catch(() => {});
  }
}


/* ── 即時 RAW 沖洗（ios/App/App/ABAIRawDevelop.swift）────────────────────
 * 原生預覽疊在網頁一塊透明的位置底下（punchThrough），拖滑桿時每一格送參數，原生端在 GPU 上即時重畫。 */
export interface RawEditParams {
  exposure: number; temperature?: number; tint?: number;
  contrast: number; highlights: number; shadows: number; whites: number; blacks: number;
  /** 清晰度（中間調的局部對比）-1～1 */
  clarity: number;
  vibrance: number; saturation: number;
  /** 細節（-1～1，0＝RAW 引擎對這台相機的預設）：銳化、明度降噪、色彩降噪 */
  sharpen: number; lumaNR: number; colorNR: number;
  /** 八個色相 × [色相, 飽和度, 明度]，各 -1～1 */
  hsl: number[];
  /** 256 格 × RGB，null＝直線 */
  curve: number[] | null;
}
interface RawEditorApi {
  /** params：第一格用的參數（原生先畫好第一格才回來，網頁收到再挖空） */
  openEditor(o: { path: string; x: number; y: number; w: number; h: number; look: RawLook | null; params?: Partial<RawEditParams> }): Promise<{ asShotTemperature: number; asShotTint: number }>;
  updateEditor(o: { params: RawEditParams; final: boolean }): Promise<void>;
  setEditorRect(o: { x: number; y: number; w: number; h: number }): Promise<void>;
  exportEditor(o: { params: RawEditParams }): Promise<{ path: string }>;
  closeEditor(): Promise<void>;
  dismissEditor(): Promise<void>;
  /** 畫面上那一格存成 JPEG（舊版原生沒有這支） */
  snapshotEditor?(): Promise<{ path?: string }>;
}
export const rawEditor = () => nativePlugin<RawEditorApi & { openEditor?: unknown }>('RawDecode')
  .then(p => (p && typeof (p as any).openEditor === 'function' ? p as RawEditorApi : null));
/* ── 一般編輯直接編 RAW（ios/App/App/RawDecodePlugin.swift 的 developPreview／developFull）──
 * 原生從 RAW 沖出一張圖（曝光、白平衡、高光、陰影都在 RAW 的資料上做），給編輯頁當底圖；其他調整照舊疊在上面。 */
export interface RawBaseParams { exposure: number; temperature?: number; tint?: number; highlights: number; shadows: number }
type RawDevApi = {
  developPreview?(o: { path: string; params: Partial<RawEditParams>; look: RawLook | null; maxPixel: number; final: boolean }): Promise<{ path: string; asShotTemperature: number; asShotTint: number }>;
  developFull?(o: { path: string; params: Partial<RawEditParams>; look: RawLook | null; format?: 'jpeg' | 'tiff16' }): Promise<{ path: string }>;
  developLinear?(o: { path: string; look: RawLook | null; w: number; h: number; bw: number; bh: number }): Promise<{ gpu: boolean; path?: string; basePath?: string; cubePath?: string; cubeSize?: number; lutAmount?: number; asShotTemperature: number; asShotTint: number }>;
  developPixels?(o: { path: string; params: Partial<RawEditParams>; look: RawLook | null; w: number; h: number; fw: number; fh: number }):
    Promise<{ path: string; fastPath: string; asShotTemperature: number; asShotTint: number }>;
};
const rawDev = () => nativePlugin<RawDevApi>('RawDecode');
const rawParams = (b: RawBaseParams): Partial<RawEditParams> => ({
  exposure: b.exposure, temperature: b.temperature, tint: b.tint, highlights: b.highlights, shadows: b.shadows,
  contrast: 0, whites: 0, blacks: 0, clarity: 0, vibrance: 0, saturation: 0, sharpen: 0, lumaNR: 0, colorNR: 0, hsl: Array(24).fill(0), curve: null,
});
/** 預覽大小（長邊 maxPixel）的沖洗結果：檔案網址＋拍攝當下的白平衡。沒有原生或失敗回 null */
export async function rawDevelopPreview(path: string, b: RawBaseParams, look: RawLook | null, maxPixel: number, final: boolean):
  Promise<{ url: string; path: string; asShotTemperature: number; asShotTint: number } | null> {
  const p = await rawDev();
  if (!p?.developPreview) return null;
  try { const r = await p.developPreview({ path, params: rawParams(b), look, maxPixel, final }); return { ...r, url: fileSrc(r.path) }; }
  catch { return null; }
}
/** 編輯頁的預覽（w×h）和拖曳代理（fw×fh）兩份未壓縮像素（RGBA8 sRGB，由上往下）。讀完就把暫存檔刪掉。失敗回 null */
export async function rawDevelopPixels(path: string, b: RawBaseParams, look: RawLook | null, w: number, h: number, fw: number, fh: number):
  Promise<{ pixels: Uint8ClampedArray; fast: Uint8ClampedArray | null; asShotTemperature: number; asShotTint: number } | null> {
  const p = await rawDev(), img = await nativeImage();
  if (!p?.developPixels) return null;
  let r: { path: string; fastPath: string; asShotTemperature: number; asShotTint: number } | null = null;
  try {
    r = await p.developPixels({ path, params: rawParams(b), look, w, h, fw, fh });
    const read = async (f: string) => new Uint8ClampedArray(await (await fetch(fileSrc(f))).arrayBuffer());
    const [pixels, fast] = await Promise.all([read(r.path), r.fastPath ? read(r.fastPath) : Promise.resolve(null)]);
    if (pixels.length !== w * h * 4 || (fast && fast.length !== fw * fh * 4)) return null;
    return { pixels, fast, asShotTemperature: r.asShotTemperature, asShotTint: r.asShotTint };
  } catch { return null; }
  finally { if (r) for (const f of [r.path, r.fastPath]) if (f) img?.remove({ path: f }).catch(() => {}); }
}
/** 網頁 GPU 即時沖洗用的線性資料（線性 Display P3 半精度浮點）。gpu＝false：拍照時套了濾鏡、特效，網頁算不了。失敗回 null */
export async function rawDevelopLinear(path: string, look: RawLook | null, w: number, h: number, bw: number, bh: number):
  Promise<{ gpu: false; asShotTemperature: number; asShotTint: number } | { gpu: true; lin: Uint16Array; base: Uint16Array; cube: { data: Float32Array; size: number; amount: number } | null; asShotTemperature: number; asShotTint: number } | null> {
  const p = await rawDev(), img = await nativeImage();
  if (!p?.developLinear) return null;
  let r: { gpu: boolean; path?: string; basePath?: string; cubePath?: string; cubeSize?: number; lutAmount?: number; asShotTemperature: number; asShotTint: number } | null = null;
  try {
    r = await p.developLinear({ path, look, w, h, bw, bh });
    if (!r.gpu || !r.path || !r.basePath) return { gpu: false, asShotTemperature: r.asShotTemperature, asShotTint: r.asShotTint };
    const buf = async (f: string) => (await fetch(fileSrc(f))).arrayBuffer();
    const [lb, bb, cb] = await Promise.all([buf(r.path), buf(r.basePath), r.cubePath ? buf(r.cubePath) : Promise.resolve(null)]);
    const lin = new Uint16Array(lb), base = new Uint16Array(bb);
    if (lin.length !== w * h * 4 || base.length !== bw * bh * 4) return null;
    /* 拍照時套的濾鏡色彩表（size³ 個 RGBA Float32）：GPU 照原生同一份表查 */
    let cube: { data: Float32Array; size: number; amount: number } | null = null;
    if (cb && r.cubeSize) {
      const data = new Float32Array(cb);
      if (data.length !== r.cubeSize ** 3 * 4) return null;
      cube = { data, size: r.cubeSize, amount: r.lutAmount ?? 1 };
    }
    return { gpu: true, lin, base, cube, asShotTemperature: r.asShotTemperature, asShotTint: r.asShotTint };
  } catch { return null; }
  finally { if (r) for (const f of [r.path, r.basePath, r.cubePath]) if (f) img?.remove({ path: f }).catch(() => {}); }
}
/** 原尺寸、完整品質（存檔用）：檔案網址。失敗回 null */
export async function rawDevelopFull(path: string, b: RawBaseParams, look: RawLook | null, format: 'jpeg' | 'tiff16' = 'jpeg'): Promise<string | null> {
  const p = await rawDev();
  if (!p?.developFull) return null;
  try { const r = await p.developFull({ path, params: rawParams(b), look, format }); const u = fileSrc(r.path); rememberNativePath(u, r.path); return u; }
  catch { return null; }
}

/** 沖洗畫面目前那一格 → 網頁用的網址（退場時當定格圖）；拿不到回 null */
export async function rawEditorSnapshot(): Promise<string | null> {
  const p = await rawEditor(); const img = await nativeImage();
  if (!p?.snapshotEditor) return null;
  try {
    const r = await p.snapshotEditor();
    if (!r?.path) return null;
    const blob = await (await fetch(fileSrc(r.path))).blob();
    img?.remove({ path: r.path }).catch(() => {});
    return URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
  } catch { return null; }
}
/** 輸出的檔案 → 網頁用的網址（讀完就把暫存檔刪掉） */
export async function rawEditorExport(params: RawEditParams): Promise<string | null> {
  const p = await rawEditor(); const img = await nativeImage();
  if (!p) return null;
  try {
    const r = await p.exportEditor({ params });
    const blob = await (await fetch(fileSrc(r.path))).blob();
    img?.remove({ path: r.path }).catch(() => {});
    return URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
  } catch { return null; }
}
