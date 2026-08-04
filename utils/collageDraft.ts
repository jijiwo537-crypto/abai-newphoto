/**
 * 經典拼圖的自動存檔。
 *
 * 照片在記憶體裡是 blob: 網址，重新整理就失效，所以圖檔本身要存進 IndexedDB，
 * 版面資料只留「idb:<id>」這種參考。localStorage 只放一個小旗標，
 * App 一開始就能用同步的方式知道要不要接續上次。
 */

const DB_NAME = 'abai-collage';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';
const STORE_META = 'meta';
const META_KEY = 'draft';
const FLAG_KEY = 'abai:collage-draft';
/** 太久以前的草稿就不要自動接續了 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CollageDraft {
  savedAt: number;
  pages: any[];
  floatingImages: any[];
  selectedRatio: string;
  isLandscape: boolean;
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
        if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(db => {
    if (!db) return null;
    return new Promise<T | null>(resolve => {
      try {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** 同步就能問到的旗標：App 啟動時用它決定要不要問「要不要繼續上次的編輯」。 */
export function hasDraft(): boolean {
  return draftTime() > 0;
}

/** 草稿存檔的時間（沒有就是 0）。跟其他工具的草稿比誰比較新時會用到。 */
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

/** 同一張照片只存一次：blob 網址 → IndexedDB 的 key */
const savedSrc = new Map<string, string>();
let blobSeq = 0;

async function putBlob(src: string): Promise<string | null> {
  const hit = savedSrc.get(src);
  if (hit) return hit;
  try {
    const blob = await (await fetch(src)).blob();
    const id = `b${Date.now().toString(36)}-${blobSeq++}`;
    await tx(STORE_BLOBS, 'readwrite', s => s.put(blob, id));
    savedSrc.set(src, id);
    return id;
  } catch {
    return null;
  }
}

/** 把版面裡所有的圖檔換成 idb: 參考，順便把 blob 存進去 */
async function externalize(value: any, seen: Map<string, string>): Promise<any> {
  if (Array.isArray(value)) return Promise.all(value.map(v => externalize(v, seen)));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'src' || k === 'url' || k === 'origSrc') && typeof v === 'string' && v && !v.startsWith('idb:')) {
        let id = seen.get(v);
        if (!id) {
          const stored = await putBlob(v);
          if (stored) { id = stored; seen.set(v, stored); }
        }
        out[k] = id ? `idb:${id}` : '';
      } else {
        out[k] = await externalize(v, seen);
      }
    }
    return out;
  }
  return value;
}

async function internalize(value: any, urls: Map<string, string>): Promise<any> {
  if (Array.isArray(value)) return Promise.all(value.map(v => internalize(v, urls)));
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'src' || k === 'url' || k === 'origSrc') && typeof v === 'string' && v.startsWith('idb:')) {
        const id = v.slice(4);
        let url = urls.get(id);
        if (!url) {
          const blob = await tx<Blob>(STORE_BLOBS, 'readonly', s => s.get(id) as IDBRequest<Blob>);
          if (blob) {
            url = URL.createObjectURL(blob);
            urls.set(id, url);
          }
        }
        out[k] = url || '';
      } else {
        out[k] = await internalize(v, urls);
      }
    }
    return out;
  }
  return value;
}

let saving = false;
let queued: CollageDraft | null = null;

export async function saveDraft(draft: Omit<CollageDraft, 'savedAt'>): Promise<void> {
  const payload: CollageDraft = { ...draft, savedAt: Date.now() };
  if (saving) { queued = payload; return; }
  saving = true;
  try {
    const seen = new Map<string, string>();
    const data = await externalize(payload, seen);
    await tx(STORE_META, 'readwrite', s => s.put(data, META_KEY));
    try { localStorage.setItem(FLAG_KEY, String(payload.savedAt)); } catch { /* 私密瀏覽會擋 */ }
  } finally {
    saving = false;
    const next = queued;
    queued = null;
    if (next) saveDraft(next);
  }
}

export async function loadDraft(): Promise<CollageDraft | null> {
  if (!hasDraft()) return null;
  const raw = await tx<CollageDraft>(STORE_META, 'readonly', s => s.get(META_KEY) as IDBRequest<CollageDraft>);
  if (!raw) return null;
  if (Date.now() - (raw.savedAt || 0) > MAX_AGE_MS) return null;
  return internalize(raw, new Map());
}

export async function clearDraft(): Promise<void> {
  savedSrc.clear();
  try { localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ }
  await tx(STORE_META, 'readwrite', s => s.delete(META_KEY));
  await tx(STORE_BLOBS, 'readwrite', s => s.clear());
}
