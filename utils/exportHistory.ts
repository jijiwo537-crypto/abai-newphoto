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
    「我的」那一頁的歷史紀錄是 40 格，這裡就留 40 筆，剛好對得起來 ——
    留比格子多的話，多出來的那幾筆在畫面上根本點不到；
    留比格子少的話，後面那些格子就永遠是空的。
    （首頁那一排只有 10 格，那是快捷，不是全部。）
    每一筆存的是：原圖 ＋ 小縮圖 ＋ 主視覺用的大圖。 */
const MAX_ITEMS = 40;
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

/** 存進 IndexedDB 的圖檔：位元組 ＋ MIME。見下面 toBytes 的說明 */
interface Bytes { buf: ArrayBuffer; type: string }

interface ExportRecord extends ExportMeta {
  /**
   * 導出當下用的那張原圖。
   *
   * ⚠️ 存的是「位元組」不是 Blob。
   * Blob 可以直接丟進 IndexedDB，但 iOS 的 WebKit 對這件事一直有問題 ——
   * 寫的時候不會報錯，關掉 App 再打開（或空間吃緊時）讀回來卻是空的。
   * 而這一份程式對「讀不到原圖」的處理是：listExports 直接過濾掉那一筆、
   * loadExport 甚至會把它刪掉 —— 所以使用者看到的就是「導出了，
   * 歷史紀錄卻永遠是空的」，而且完全找不到原因。
   * ArrayBuffer 是最基本的可複製型別，各家瀏覽器都存得住，讀回來再組回 Blob。
   */
  photoBytes?: Bytes;
  /** 舊版存的是 Blob，讀得到就還是要能用（不再寫入新的） */
  photo?: Blob | null;
  /**
   * state 裡面引用到的其他圖檔。
   *
   * 拼圖一頁上可能有十幾張照片、仿色還有一張參考圖 —— 這些都不是「那一張原圖」，
   * 但少了它們就還原不回去。存的時候把 state 裡的圖片網址換成 `hist:<n>`，
   * 圖檔本身放這裡；讀回來再換回可用的網址。
   * 跟著整筆紀錄一起被刪掉，所以不會有孤兒檔案。
   */
  assets?: Record<string, Blob>;
  /** 同上：新版存位元組，舊版的 assets（Blob）還是讀得回來 */
  assetBytes?: Record<string, Bytes>;
}

/** Blob → 位元組。存進 IndexedDB 之前一律先過這一關 */
async function toBytes(b: Blob): Promise<Bytes> {
  return { buf: await b.arrayBuffer(), type: b.type || 'application/octet-stream' };
}
/** 位元組 → Blob。讀出來之後組回去，其他程式完全不用改 */
const fromBytes = (x?: Bytes | null): Blob | null =>
  x && x.buf ? new Blob([x.buf], { type: x.type || 'application/octet-stream' }) : null;
/** 兩種格式都吃：新版的位元組優先，舊版的 Blob 當退路 */
const recPhoto = (r: ExportRecord): Blob | null => fromBytes(r.photoBytes) || r.photo || null;

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

/** 真正去開資料庫。version 給 undefined＝「現在是第幾版就開第幾版」 */
function rawOpen(version?: number): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = version == null ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * 開資料庫。
 *
 * 這裡有一個會「永久壞掉」的坑，以前沒有處理：
 * 資料庫已經存在、但裡面**沒有** items 這個 store（上一次建到一半被中斷、
 * App 在升級當下被系統收掉、或早期版本留下來的殘骸）。這種狀態下版本號沒變，
 * onupgradeneeded 就永遠不會再跑一次 —— 於是每一次 db.transaction('items')
 * 都會丟例外、被 tx() 吞成 null，寫也寫不進去、讀也讀不出來，而且完全沒有錯誤訊息。
 * 使用者看到的就是「導出很正常，歷史紀錄永遠是空的」，重開 App 也不會好。
 *
 * 所以：先用「現在的版本」把它打開，發現沒有那個 store 就把版本加一、
 * 逼它跑一次升級把 store 補上。另外也不再寫死 open(DB_NAME, 1) ——
 * 萬一裝置上的版本比 1 高，指定 1 會直接失敗（VersionError）。
 */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    let db = await rawOpen();
    if (db && !db.objectStoreNames.contains(STORE)) {
      const next = db.version + 1;
      db.close();
      db = await rawOpen(next);
    }
    if (db && !db.objectStoreNames.contains(STORE)) return null;
    return db;
  })();
  return dbPromise;
}

/**
 * 給畫面用的狀態：資料庫通不通、裡面有幾筆。
 * 「一筆都沒有」跟「資料庫根本開不起來」看起來一樣，但原因天差地遠，
 * 分開回報才查得下去。
 */
export async function exportsStatus(): Promise<{ ok: boolean; rows: number; usable: number }> {
  const db = await openDb();
  if (!db) return { ok: false, rows: 0, usable: 0 };
  const all = await tx<ExportRecord[]>('readonly', s => s.getAll() as IDBRequest<ExportRecord[]>);
  if (!all) return { ok: false, rows: 0, usable: 0 };
  return { ok: true, rows: all.length, usable: all.filter(r => !!(r.photoBytes?.buf || r.photo)).length };
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
    let thumb = await makeThumb(outUrl, THUMB_MAX, 0.72, outBlob);
    /* 主視覺那張做不出來也沒關係，畫面會退回用小圖 */
    let hero = thumb ? await makeThumb(outUrl, HERO_MAX, 0.86, outBlob) : null;
    let photo: Blob | null = null;
    if (srcUrl) {
      try { photo = await (await fetch(srcUrl)).blob(); } catch { photo = null; }
    }

    /* 縮圖做不出來時的兩層退路。
       手機（尤其 iOS）把幾千萬像素的成品 drawImage 進 canvas 時會靜靜地失敗 ——
       不丟錯，就是給你一張全黑的圖（所以上面有 looksBlank 在擋）。
       以前遇到這種情況是「整筆不記」，結果就是使用者導出了、歷史紀錄卻永遠是空的，
       而且完全沒有跡象。現在改成：
         ① 改拿「原圖」去縮 —— 相簿來的 JPEG 通常比成品好解得多
         ② 兩條都不行也照樣把這一筆記下來（thumb 留空），
            首頁那一格會畫成一塊素色的磚，點下去照樣開得回作品。
       少一張縮圖，總比整段歷史紀錄消失好。 */
    if (!thumb && photo) {
      const srcUrlObj = URL.createObjectURL(photo);
      try {
        thumb = await makeThumb(srcUrlObj, THUMB_MAX, 0.72, photo);
        if (thumb) hero = await makeThumb(srcUrlObj, HERO_MAX, 0.86, photo);
      } finally { URL.revokeObjectURL(srcUrlObj); }
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
      thumb: thumb || '',
      /* 做不出來就不要寫進去（undefined 存進 IndexedDB 沒意義），
         畫面那邊會自動退回用 thumb */
      ...(hero ? { hero } : {}),
      state: saveState,
      photoKey,
      hasPhoto: true,
      /* 存位元組，不存 Blob（見 ExportRecord.photoBytes 的說明） */
      photoBytes: await toBytes(photo),
      assetBytes: Object.fromEntries(
        await Promise.all(Object.entries(assets).map(async ([k, v]) => [k, await toBytes(v)] as const)),
      ),
    };
    /* 寫進去。這裡有一個一直存在的盲點：tx() 失敗時是**回傳 null**，不是丟例外，
       所以 `await tx(...)` 包在 try/catch 裡完全攔不到 —— 空間不夠時這一筆就
       靜靜地沒寫進去，使用者看到的是「導出了，但歷史紀錄那一格永遠是空的」，
       而且沒有任何跡象。要看回傳值才知道成不成功（put 成功會回傳 key）。

       確認失敗之後一步一步退：
         ① 先丟掉最佔空間的那一欄（主視覺用的大圖，一張一百多 KB），
            畫面會自動退回用小縮圖，只是主視覺糊一點
         ② 還是不行就從最舊的一筆開始刪，騰出位子再試（最多騰五次）
       全部都失敗才放棄，那時候是真的一點空間都沒有了。 */
    const write = async () => (await tx('readwrite', st => st.put(rec))) != null;

    let saved = await write();

    if (!saved && rec.hero) {
      delete (rec as any).hero;
      saved = await write();
    }

    for (let i = 0; !saved && i < 5; i++) {
      const all = await tx<ExportRecord[]>('readonly', st => st.getAll() as IDBRequest<ExportRecord[]>);
      const oldest = (all || []).filter(r => r.id !== rec.id).sort((a, b) => (a.at || 0) - (b.at || 0))[0];
      if (!oldest) break;
      await tx('readwrite', st => st.delete(oldest.id));
      saved = await write();
    }

    if (!saved) return;
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
    .filter(r => !!(r.photoBytes?.buf || r.photo))
    // state 裡還是 hist: 參考 —— 首頁只用得到縮圖，真的要還原時才走 loadExport
    .map(({ id, tool, at, thumb, hero, photoKey }) => ({ id, tool, at, thumb, hero, state: null, photoKey, hasPhoto: true }));
}

/** 還原用：連原圖一起拿出來 */
export async function loadExport(id: string): Promise<{ meta: ExportMeta; src: string } | null> {
  const rec = await tx<ExportRecord>('readonly', s => s.get(id) as IDBRequest<ExportRecord>);
  const photo = rec ? recPhoto(rec) : null;
  if (!rec || !photo) {
    // 開不起來的紀錄就順手清掉，磚塊才不會一直留在首頁讓人白點
    if (rec) { await tx('readwrite', s => s.delete(id)); emitChanged(); }
    return null;
  }
  const { photo: _p, assets, assetBytes, ...meta } = rec as any;
  /* state 裡的 hist: 參考換回可以直接用的網址（拼圖的每一張、仿色的參考圖…）。
     新版存的是位元組，先組回 Blob；舊版的紀錄本來就是 Blob，直接用。 */
  const assetMap: Record<string, Blob> = assets || {};
  if (assetBytes) {
    for (const [k, v] of Object.entries(assetBytes as Record<string, Bytes>)) {
      const b = fromBytes(v);
      if (b) assetMap[k] = b;
    }
  }
  meta.state = Object.keys(assetMap).length ? internalize(meta.state, assetMap, new Map()) : meta.state;
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
