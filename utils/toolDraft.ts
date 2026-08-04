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

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
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

/**
 * 存一份草稿。同一時間只留一份（最後動的那個工具）。
 * src 給 null 就沿用上一次存的那張照片，只更新參數 —— 照片沒換的時候不用重存一次。
 */
export async function saveDraft(tool: ToolKind, src: string | null, state: any): Promise<void> {
  if (saving) { queued = { tool, src, state }; return; }
  saving = true;
  try {
    if (src) {
      try {
        const blob = await (await fetch(src)).blob();
        await tx('readwrite', s => s.put(blob, BLOB_KEY));
      } catch { /* 讀不到就只存參數 */ }
    }
    const meta: ToolDraftMeta = { tool, savedAt: Date.now(), state };
    await tx('readwrite', s => s.put(meta, META_KEY));
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
  if (!meta) return null;
  if (Date.now() - (meta.savedAt || 0) > MAX_AGE_MS) return null;
  const blob = await tx<Blob>('readonly', s => s.get(BLOB_KEY) as IDBRequest<Blob>);
  if (!blob) return null;
  return { ...meta, src: URL.createObjectURL(blob) };
}

export async function clearDraft(): Promise<void> {
  try {
    localStorage.removeItem(FLAG_KEY);
    localStorage.removeItem(FLAG_KEY + ':tool');
  } catch { /* ignore */ }
  await tx('readwrite', s => s.delete(META_KEY));
  await tx('readwrite', s => s.delete(BLOB_KEY));
}
