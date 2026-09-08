/**
 * 「跳出應用、回來還在」用的草稿。
 *
 * 經典拼圖有自己那一份（collageDraft.ts，版面比較複雜）；
 * 這裡是給編輯、美顏、單張拼貼共用的：照片存進 IndexedDB，
 * 各工具自己的參數存成一包 JSON。localStorage 只放一個時間戳，
 * App 一開始就能同步知道要不要問「要不要繼續上次的編輯」。
 *
 * 相機刻意不存（照使用者要求）。
 */

const DB_NAME = 'abai-tools';
/* 版本不再寫死（見下面 openDb 的說明），保留常數只為了文件用途 */
const DB_VERSION = 1;
const STORE = 'draft';
const BLOB_KEY = 'photo';
const META_KEY = 'meta';
const FLAG_KEY = 'abai:tool-draft';
/** 太久以前的就不要問了 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ToolKind = 'editor' | 'beauty' | 'collage';

export interface ToolDraftMeta {
  tool: ToolKind;
  savedAt: number;
  /** 各工具自己的參數，形狀由工具決定 */
  state: any;
}

export interface LoadedToolDraft extends ToolDraftMeta {
  /** 還原出來的照片網址（object URL） */
  src: string;
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
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * 開資料庫。
 *
 * 這裡本來有一個「永遠不會好」的坑，而且它一直都在發生：
 * index.html 的暖機那一段會先跑 `indexedDB.open('abai-tools')`（不帶版本），
 * 那一下就把資料庫**建成第 1 版、而且裡面一個 store 都沒有**。
 * 等這裡再用 `open(DB_NAME, 1)` 打開時版本沒變 → onupgradeneeded 不會跑
 * → draft 這個 store 永遠不存在 → 每一次 db.transaction('draft') 都丟例外、
 * 被 tx() 吞成 null。使用者看到的就是「離開再回來，草稿永遠不見」，
 * 而且完全沒有錯誤訊息，重開 App 也不會好。
 *
 * 修法跟 exportHistory.ts 完全一樣（那邊踩過同一個坑）：
 * 先用「現在的版本」開，發現沒有那個 store 就把版本加一、逼它跑一次升級補上；
 * 也不再寫死版本 1 —— 萬一裝置上的版本比 1 高，指定 1 會直接 VersionError。
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

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(db => {
    if (!db) return null;
    return new Promise<T | null>(resolve => {
      try {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        let result: T | null = null;
        req.onsuccess = () => { result = req.result as T; };
        req.onerror = () => { /* transaction handlers below settle the promise */ };
        t.oncomplete = () => resolve(result);
        t.onerror = () => resolve(null);
        t.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** 同步就問得到：有沒有一份還沒過期的草稿 */
export function hasDraft(): boolean {
  return draftTime() > 0;
}

/** 草稿存檔的時間（沒有就是 0）。跟經典拼圖那一份比誰比較新時會用到。 */
export function draftTime(): number {
  try {
    const raw = localStorage.getItem(FLAG_KEY);
    if (!raw) return 0;
    const t = Number(raw);
    if (!t || Date.now() - t > MAX_AGE_MS) return 0;
    return t;
  } catch {
    return 0;
  }
}

/** 目前草稿是哪一個工具的（給首頁的詢問視窗顯示用） */
export function draftTool(): ToolKind | null {
  try {
    const raw = localStorage.getItem(FLAG_KEY + ':tool');
    return raw === 'editor' || raw === 'beauty' || raw === 'collage' ? raw : null;
  } catch {
    return null;
  }
}

let saving = false;
let queued: { tool: ToolKind; src: string | null; state: any } | null = null;

/* 創意拼圖的 state 內還可能有多張浮動圖片。它們同樣是 blob: 網址，
   不能原封不動塞進 meta，否則重開 App 後物件仍可選、內容卻完全透明。 */
let assetSeq = 0;
const storedAssets = new Map<string, string>();

async function storeStateAsset(src: string): Promise<string | null> {
  const cached = storedAssets.get(src);
  if (cached) {
    const hit = await tx<Blob>('readonly', s => s.get(cached) as IDBRequest<Blob>);
    if (hit instanceof Blob && hit.size > 0) return cached;
    storedAssets.delete(src);
  }
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    if (!blob.size) return null;
    const key = `asset:${Date.now().toString(36)}-${assetSeq++}`;
    const written = await tx<IDBValidKey>('readwrite', s => s.put(blob, key));
    if (written == null) return null;
    const verified = await tx<Blob>('readonly', s => s.get(key) as IDBRequest<Blob>);
    if (!(verified instanceof Blob) || !verified.size) return null;
    storedAssets.set(src, key);
    return key;
  } catch {
    return null;
  }
}

async function externalizeState(value: any, seen = new Map<string, string>()): Promise<any> {
  if (Array.isArray(value)) return Promise.all(value.map(v => externalizeState(v, seen)));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [key, raw] of Object.entries(value)) {
      if ((key === 'src' || key === 'url' || key === 'origSrc') && typeof raw === 'string' && raw) {
        if (raw.startsWith('idbtool:')) { out[key] = raw; continue; }
        let stored = seen.get(raw);
        if (!stored) {
          stored = await storeStateAsset(raw) || undefined;
          if (stored) seen.set(raw, stored);
        }
        if (!stored) throw new Error('tool-draft-asset-persistence-failed');
        out[key] = `idbtool:${stored}`;
      } else {
        out[key] = await externalizeState(raw, seen);
      }
    }
    return out;
  }
  return value;
}

async function internalizeState(value: any, urls = new Map<string, string>()): Promise<any> {
  if (Array.isArray(value)) return Promise.all(value.map(v => internalizeState(v, urls)));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [key, raw] of Object.entries(value)) {
      if ((key === 'src' || key === 'url' || key === 'origSrc')
          && typeof raw === 'string' && raw.startsWith('idbtool:')) {
        const id = raw.slice(8);
        let url = urls.get(id);
        if (!url) {
          const blob = await tx<Blob>('readonly', s => s.get(id) as IDBRequest<Blob>);
          if (blob instanceof Blob && blob.size > 0) {
            url = URL.createObjectURL(blob);
            urls.set(id, url);
          }
        }
        if (!url) throw new Error('tool-draft-asset-missing');
        out[key] = url;
      } else {
        out[key] = await internalizeState(raw, urls);
      }
    }
    return out;
  }
  return value;
}

/**
 * 存一份草稿。同一時間只留一份（最後動的那個工具）。
 * src 給 null 就沿用上一次存的那張照片，只更新參數 —— 照片沒換的時候不用重存一次。
 * 反過來 state 給 null 也一樣是「沿用上一次的參數」，只換照片。
 */
export async function saveDraft(tool: ToolKind, src: string | null, state: any): Promise<void> {
  if (saving) {
    /* 佇列只有一格，以前是直接覆蓋 —— 那會把「還沒寫進去的那張照片」蓋掉。
       實際發生過的順序：選完照片的那一次存檔被排進佇列，緊接著的參數自動存檔
       （src 是 null）把整格換掉，結果草稿只有參數、沒有照片，
       「繼續上次的編輯」回來就是一片空白。
       改成合併：照片與參數各自保留最新的非 null 值，誰都不會被對方蓋掉。 */
    queued = {
      tool,
      src: src ?? queued?.src ?? null,
      state: state ?? queued?.state ?? null,
    };
    return;
  }
  saving = true;
  try {
    if (src) {
      let stored = false;
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        if (blob.size > 0) {
          const written = await tx<IDBValidKey>('readwrite', s => s.put(blob, BLOB_KEY));
          const verified = written == null ? null
            : await tx<Blob>('readonly', s => s.get(BLOB_KEY) as IDBRequest<Blob>);
          stored = verified instanceof Blob && verified.size > 0;
        }
      } catch { /* handled below */ }
      /* 讀不到照片時絕不能照樣更新 meta/旗標，否則會把上一份可用草稿
         變成「物件可選、圖片全透明」的壞草稿。 */
      if (!stored) return;
    } else {
      const existing = await tx<Blob>('readonly', s => s.get(BLOB_KEY) as IDBRequest<Blob>);
      if (!(existing instanceof Blob) || !existing.size) return;
    }
    /* state 給 null 的意思跟 src 一樣是「不要動它」（見上面的說明）。
       以前是不分青紅皂白直接寫進去，於是「只存照片」那一次
       （state 是 null）會把先前存好的參數清成 null。 */
    const prev = state == null
      ? await tx<ToolDraftMeta>('readonly', s => s.get(META_KEY) as IDBRequest<ToolDraftMeta>)
      : null;
    /* 只沿用「同一個工具」的參數。跨工具不能沿用 —— 上一份是編輯的參數、
       這一次存的是創意拼圖，接回去會是另一個工具看不懂的東西。
       （正常流程離開工具時會 clearDraft，但硬關掉 App 的話舊的那份會留著。） */
    const keep = prev && prev.tool === tool ? prev : null;
    let persistedState = keep?.state ?? null;
    if (state != null) {
      try { persistedState = await externalizeState(state); }
      catch { return; }
    }
    const meta: ToolDraftMeta = { tool, savedAt: Date.now(), state: persistedState };
    const metaWritten = await tx<IDBValidKey>('readwrite', s => s.put(meta, META_KEY));
    if (metaWritten == null) return;
    try {
      localStorage.setItem(FLAG_KEY, String(meta.savedAt));
      localStorage.setItem(FLAG_KEY + ':tool', tool);
    } catch { /* 私密瀏覽會擋 */ }
  } finally {
    saving = false;
    const next = queued;
    queued = null;
    if (next) saveDraft(next.tool, next.src, next.state);
  }
}

export async function loadDraft(): Promise<LoadedToolDraft | null> {
  if (!hasDraft()) return null;
  const meta = await tx<ToolDraftMeta>('readonly', s => s.get(META_KEY) as IDBRequest<ToolDraftMeta>);
  const blob = await tx<Blob>('readonly', s => s.get(BLOB_KEY) as IDBRequest<Blob>);
  if (!meta || Date.now() - (meta.savedAt || 0) > MAX_AGE_MS
      || !(blob instanceof Blob) || !blob.size) {
    try {
      localStorage.removeItem(FLAG_KEY);
      localStorage.removeItem(FLAG_KEY + ':tool');
    } catch { /* ignore */ }
    return null;
  }
  try {
    const restoredState = await internalizeState(meta.state);
    return { ...meta, state: restoredState, src: URL.createObjectURL(blob) };
  } catch {
    try {
      localStorage.removeItem(FLAG_KEY);
      localStorage.removeItem(FLAG_KEY + ':tool');
    } catch { /* ignore */ }
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  /* 明確選「放棄」時，不能讓已排隊的自動存檔在清除後又寫回來。 */
  queued = null;
  while (saving) await new Promise(resolve => setTimeout(resolve, 0));
  queued = null;
  storedAssets.clear();
  try {
    localStorage.removeItem(FLAG_KEY);
    localStorage.removeItem(FLAG_KEY + ':tool');
  } catch { /* ignore */ }
  await tx('readwrite', s => s.delete(META_KEY));
  await tx('readwrite', s => s.delete(BLOB_KEY));
}
