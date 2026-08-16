/**
 * 導出紀錄。
 *
 * 每次真的把圖存出去就記一筆：原圖 + 當時那個工具的參數 + 一張小縮圖。
 * 首頁的「最近輸出」讀這裡；點進去就是把原圖與參數餵回工具，
 * 回到那張圖導出當下的編輯狀態（跟「接續上次」走同一條還原路徑）。
 *
 * 原圖是 Blob、縮圖是很小的 data URL，都放 IndexedDB；
 * localStorage 只放一個版本印記，首頁第一次繪製前就知道要不要留位子。
 */

const DB_NAME = 'abai-exports';
const DB_VERSION = 1;
const STORE = 'items';
const STAMP_KEY = 'abai:exports';
/** 留最近幾筆就好，超過的連原圖一起丟掉。
    「我的」那一頁的歷史紀錄是 20 格，這裡就留 20 筆，剛好對得起來 ——
    留比格子多的話，多出來的那幾筆在畫面上根本點不到。
    每一筆存的是：原圖 ＋ 小縮圖 ＋ 主視覺用的大圖。 */
const MAX_ITEMS = 20;
/** 縮圖的長邊（首頁那一排 5 格用的） */
const THUMB_MAX = 320;
/**
 * 主視覺用的長邊。
 * 首頁最上面那一塊是整個螢幕寬，320px 的縮圖放大上去會糊掉 ——
 * 所以另外存一張大的，只有那一塊會用到。
 * 小圖留著不動：那一排 5 格只有 62px 寬，用大圖去解碼很浪費記憶體。
 */
const HERO_MAX = 1080;

export type ExportTool = 'editor' | 'beauty' | 'collage' | 'layout' | 'match';

export interface ExportMeta {
  id: string;
  tool: ExportTool;
  at: number;
  /** 小張的預覽圖（data URL），首頁那一排 5 格直接拿來顯示 */
  thumb: string;
  /**
   * 大張的預覽圖（data URL），首頁最上面那一塊主視覺用。
   * 舊的紀錄沒有這一欄，畫面那邊會自動退回用 thumb（只是會糊一點）。
   */
  hero?: string;
  /** 工具自己的參數，形狀由工具決定 */
  state: any;
  /** 原圖的內容雜湊。同一張照片重複導出時用它把舊的那筆換掉 */
  photoKey?: string;
  /** 這一筆存得到原圖嗎。存不到的話點開來沒東西可載，首頁就不要顯示它 */
  hasPhoto?: boolean;
}

interface ExportRecord extends ExportMeta {
  /** 導出當下用的那張原圖 */
  photo: Blob | null;
  /**
   * state 裡面引用到的其他圖檔。
   *
   * 拼圖一頁上可能有十幾張照片、仿色還有一張參考圖 —— 這些都不是「那一張原圖」，
   * 但少了它們就還原不回去。存的時候把 state 裡的圖片網址換成 `hist:<n>`，
   * 圖檔本身放這裡；讀回來再換回可用的網址。
   * 跟著整筆紀錄一起被刪掉，所以不會有孤兒檔案。
   */
  assets?: Record<string, Blob>;
}

/** state 裡哪些欄位放的是圖片網址 */
const SRC_KEYS = new Set(['src', 'url', 'origSrc', 'referenceSrc', 'imageSrc', 'thumb']);

/** 把 state 裡的圖片網址抽出來變成 hist: 參考，圖檔另外收在 assets */
async function externalize(value: any, assets: Record<string, Blob>, seen: Map<string, string>): Promise<any> {
  if (Array.isArray(value)) return Promise.all(value.map(v => externalize(v, assets, seen)));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (SRC_KEYS.has(k) && typeof v === 'string' && v && !v.startsWith('hist:')) {
        let ref = seen.get(v);
        if (!ref) {
          try {
            const blob = await (await fetch(v)).blob();
            ref = `hist:${Object.keys(assets).length}`;
            assets[ref.slice(5)] = blob;
            seen.set(v, ref);
          } catch { ref = ''; }
        }
        out[k] = ref;
      } else {
        out[k] = await externalize(v, assets, seen);
      }
    }
    return out;
  }
  return value;
}

/** 反過來：hist: 參考換回可以直接用的網址 */
function internalize(value: any, assets: Record<string, Blob>, urls: Map<string, string>): any {
  if (Array.isArray(value)) return value.map(v => internalize(v, assets, urls));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (SRC_KEYS.has(k) && typeof v === 'string' && v.startsWith('hist:')) {
        const key = v.slice(5);
        let url = urls.get(key);
        if (!url) {
          const blob = assets[key];
          if (blob) { url = URL.createObjectURL(blob); urls.set(key, url); }
        }
        out[k] = url || '';
      } else {
        out[k] = internalize(v, assets, urls);
      }
    }
    return out;
  }
  return value;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(db => {
    if (!db) return null;
    return new Promise<T | null>(resolve => {
      try {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * 紀錄變動的通知。
 * 寫入是非同步的，而離開工具後首頁馬上就重讀了 —— 沒有這個通知的話，
 * 剛剛那一筆會等到下次進出首頁才看得到。
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeExports(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emitChanged() {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch { /* 某個訂閱者壞掉不能拖累其他人 */ }
  }
}

/** 同步就問得到：有沒有導出紀錄（首頁決定要不要留位子用） */
export function hasExports(): boolean {
  try { return Number(localStorage.getItem(STAMP_KEY) || 0) > 0; } catch { return false; }
}

function stamp() {
  try { localStorage.setItem(STAMP_KEY, String(Date.now())); } catch { /* 私密瀏覽會擋 */ }
}

/** 目標尺寸：長邊縮到 max */
function fitThumb(w: number, h: number, max = THUMB_MAX) {
  const s = Math.min(1, max / Math.max(w || 1, h || 1));
  return { w: Math.max(1, Math.round((w || 1) * s)), h: Math.max(1, Math.round((h || 1) * s)) };
}

/**
 * 畫出來的東西是不是整片全黑／全透明。
 * 手機（尤其 iOS）把幾千萬像素的原圖 drawImage 進 canvas 時會靜靜地失敗，
 * 不丟錯，就是給你一張全黑的圖 —— 只能自己抽樣檢查。
 */
function looksBlank(cv: HTMLCanvasElement): boolean {
  try {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 0; i < d.length; i += 4 * 37) {
      if (d[i + 3] > 8 && (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8)) return false;
    }
    return true;
  } catch {
    return false;   // 讀不到就別亂判死
  }
}

function encode(cv: HTMLCanvasElement, q = 0.72): string {
  return cv.toDataURL('image/jpeg', q);
}

/** 路線 A：createImageBitmap 直接解碼＋縮圖，不用先配一張原尺寸的點陣圖 */
async function thumbViaBitmap(blob: Blob, max = THUMB_MAX, q = 0.72): Promise<string | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let probe: ImageBitmap | null = null;
  let small: ImageBitmap | null = null;
  try {
    probe = await createImageBitmap(blob);
    const { w, h } = fitThumb(probe.width, probe.height, max);
    probe.close?.();
    probe = null;
    // resizeWidth/Height 讓瀏覽器在解碼階段就縮，記憶體尖峰低很多
    try {
      small = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } as any);
    } catch {
      small = await createImageBitmap(blob);
    }
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d')!.drawImage(small, 0, 0, w, h);
    small.close?.();
    small = null;
    return looksBlank(cv) ? null : encode(cv, q);
  } catch {
    return null;
  } finally {
    probe?.close?.();
    small?.close?.();
  }
}

/** 路線 B：<img> 解碼，並且分段縮 —— 一次縮太多倍手機也容易畫失敗 */
async function thumbViaImage(url: string, max = THUMB_MAX, q = 0.72): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode failed'));
      i.src = url;
    });
    if (img.decode) { try { await img.decode(); } catch { /* 有些瀏覽器會拒絕，onload 已經夠 */ } }
    let sw = img.naturalWidth || img.width;
    let sh = img.naturalHeight || img.height;
    const target = fitThumb(sw, sh, max);
    let src: CanvasImageSource = img;
    // 每一步最多砍一半，直到接近目標大小
    while (sw > target.w * 2 && sh > target.h * 2) {
      const nw = Math.max(target.w, Math.round(sw / 2));
      const nh = Math.max(target.h, Math.round(sh / 2));
      const step = document.createElement('canvas');
      step.width = nw; step.height = nh;
      step.getContext('2d')!.drawImage(src, 0, 0, nw, nh);
      if (looksBlank(step)) return null;
      src = step; sw = nw; sh = nh;
    }
    const cv = document.createElement('canvas');
    cv.width = target.w; cv.height = target.h;
    cv.getContext('2d')!.drawImage(src, 0, 0, target.w, target.h);
    return looksBlank(cv) ? null : encode(cv, q);
  } catch {
    return null;
  }
}

/**
 * 把導出的成品縮成小圖。
 * 先把 data URL 換成 Blob —— 一張一兩千萬像素的 PNG data URL 是幾十 MB 的字串，
 * 直接餵給 <img> 在手機上很容易爆掉（畫出來就是全黑）。
 * 兩條路線都試，兩條都拿不到就不要硬塞一張黑圖進紀錄。
 */
async function makeThumb(
  outUrl: string,
  max = THUMB_MAX,
  q = 0.72,
  /** 已經抓好的 blob。同一張圖要出兩個尺寸時傳進來，就不用再 fetch 一次 */
  ready?: Blob | null,
): Promise<string | null> {
  let blob: Blob | null = ready ?? null;
  if (!blob) {
    try { blob = await (await fetch(outUrl)).blob(); } catch { blob = null; }
  }

  if (blob) {
    const a = await thumbViaBitmap(blob, max, q);
    if (a) return a;
    const objUrl = URL.createObjectURL(blob);
    try {
      const b = await thumbViaImage(objUrl, max, q);
      if (b) return b;
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }
  return await thumbViaImage(outUrl, max, q);
}

/**
 * 原圖的內容雜湊 —— 「同一張照片」就是靠這個認的。
 * 每次匯入產生的 object URL 都不一樣，只能看內容。
 */
async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // 非安全來源沒有 crypto.subtle，退回夠用的 FNV-1a（配上長度一起比）
    const u8 = new Uint8Array(buf);
    let h = 0x811c9dc5;
    const step = Math.max(1, Math.floor(u8.length / 65536));
    for (let i = 0; i < u8.length; i += step) {
      h ^= u8[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `f${u8.length.toString(16)}-${h.toString(16)}`;
  }
}

/**
 * 記一筆導出。
 * outUrl 是導出的成品（拿來做縮圖），srcUrl 是導出時用的原圖（還原時餵回工具）。
 * 存不進去就安靜放棄 —— 導出本身不能因為記錄失敗而壞掉。
 */
export async function addExport(
  tool: ExportTool,
  outUrl: string,
  srcUrl: string | null,
  state: any,
  /**
   * 「這是同一件作品」的判斷依據。預設是原圖的內容雜湊（一張照片一筆），
   * 但拼圖是好幾張照片拼起來的，沒有「那一張原圖」——
   * 那邊改用一個開工具時產生的 id，同一次拼圖不管存幾次都只留最新的一筆。
   */
  key?: string,
): Promise<void> {
  try {
    /* 成品只抓一次 blob，大小兩張共用 —— 導出的 data URL 動輒幾十 MB，
       fetch 兩次是實打實的成本。 */
    let outBlob: Blob | null = null;
    try { outBlob = await (await fetch(outUrl)).blob(); } catch { outBlob = null; }
    const thumb = await makeThumb(outUrl, THUMB_MAX, 0.72, outBlob);
    if (!thumb) return;   // 縮圖做不出來就不要記，免得首頁掛一張全黑的格子
    /* 主視覺那張做不出來也沒關係，畫面會退回用小圖 */
    const hero = await makeThumb(outUrl, HERO_MAX, 0.86, outBlob);
    let photo: Blob | null = null;
    if (srcUrl) {
      try { photo = await (await fetch(srcUrl)).blob(); } catch { photo = null; }
    }
    /* 原圖拿不到（object URL 已經失效之類）就退而求其次，改存導出的成品。
       沒有原圖的紀錄在首頁會是一塊「看得到但點不開」的死磚 —— 那正是使用者
       回報的問題。成品至少還原得回一張圖，只是編輯已經烘進去了，
       所以參數不能再套一次（會變成套兩遍），這一筆的 state 就清掉。 */
    let bakedIn = false;
    if (!photo) {
      try { photo = await (await fetch(outUrl)).blob(); bakedIn = !!photo; } catch { photo = null; }
    }
    if (!photo) return;   // 兩條路都拿不到就整筆不要記，不要留死磚
    const photoKey = key || await hashBlob(photo);
    // 同一張照片只留最新的那一次導出 —— 舊的先刪掉
    if (photoKey) {
      const all = await tx<ExportRecord[]>('readonly', s => s.getAll() as IDBRequest<ExportRecord[]>);
      for (const old of (all || [])) {
        if (old.photoKey === photoKey) await tx('readwrite', s => s.delete(old.id));
      }
    }
    const assets: Record<string, Blob> = {};
    let saveState: any = null;
    if (state && !bakedIn) {
      saveState = await externalize(JSON.parse(JSON.stringify(state)), assets, new Map());
    }
    const rec: ExportRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool,
      at: Date.now(),
      thumb,
      /* 做不出來就不要寫進去（undefined 存進 IndexedDB 沒意義），
         畫面那邊會自動退回用 thumb */
      ...(hero ? { hero } : {}),
      state: saveState,
      photoKey,
      hasPhoto: true,
      photo,
      assets,
    };
    await tx('readwrite', s => s.put(rec));
    stamp();
    await prune();
    emitChanged();
  } catch { /* 記錄失敗不影響導出 */ }
}

/** 新的在前面。只回 meta，不把原圖 Blob 一起拉出來 */
export async function listExports(): Promise<ExportMeta[]> {
  const all = await tx<ExportRecord[]>('readonly', s => s.getAll() as IDBRequest<ExportRecord[]>);
  if (!all) return [];
  return all
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    // 舊版本可能留下沒有原圖的紀錄 —— 那種點開來是沒有反應的，直接不要列出來
    .filter(r => !!r.photo)
    // state 裡還是 hist: 參考 —— 首頁只用得到縮圖，真的要還原時才走 loadExport
    .map(({ id, tool, at, thumb, hero, photoKey }) => ({ id, tool, at, thumb, hero, state: null, photoKey, hasPhoto: true }));
}

/** 還原用：連原圖一起拿出來 */
export async function loadExport(id: string): Promise<{ meta: ExportMeta; src: string } | null> {
  const rec = await tx<ExportRecord>('readonly', s => s.get(id) as IDBRequest<ExportRecord>);
  if (!rec || !rec.photo) {
    // 開不起來的紀錄就順手清掉，磚塊才不會一直留在首頁讓人白點
    if (rec) { await tx('readwrite', s => s.delete(id)); emitChanged(); }
    return null;
  }
  const { photo, assets, ...meta } = rec;
  // state 裡的 hist: 參考換回可以直接用的網址（拼圖的每一張、仿色的參考圖…）
  meta.state = assets ? internalize(meta.state, assets, new Map()) : meta.state;
  return { meta, src: URL.createObjectURL(photo) };
}

async function prune(): Promise<void> {
  const all = await tx<ExportRecord[]>('readonly', s => s.getAll() as IDBRequest<ExportRecord[]>);
  if (!all || all.length <= MAX_ITEMS) return;
  const doomed = all.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(MAX_ITEMS);
  for (const d of doomed) await tx('readwrite', s => s.delete(d.id));
}

export async function clearExports(): Promise<void> {
  try { localStorage.removeItem(STAMP_KEY); } catch { /* ignore */ }
  await tx('readwrite', s => s.clear());
  emitChanged();
}
