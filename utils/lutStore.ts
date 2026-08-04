/**
 * 解好的濾鏡查色表存在 IndexedDB。
 *
 * 濾鏡檔本身是一張 512×512 的方塊圖，每次用都要「下載 → 解碼 PNG → 重排成
 * size³ 的查色表」。下載那一段瀏覽器的 HTTP 快取幫得上忙，但解碼與重排每次
 * 開 App 都要重跑一遍（24 顆就是 24 次），第一次點濾鏡就會卡在那裡。
 *
 * 解好的表直接收進 IndexedDB：之後不論換照片、關掉再開、還是換到拼圖，
 * 都是從本機讀一塊 ArrayBuffer 回來，不再碰網路也不用重新解碼。
 */

const DB = 'abai-lut';
const STORE = 'luts';
const VERSION = 1;

type Row = { id: string; url: string; size: number; buf: ArrayBuffer };

let dbPromise: Promise<IDBDatabase | null> | null = null;

const open = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
};

/** 讀出這顆濾鏡解好的表；沒有、或是網址換過了就回 null（會重新下載一次） */
export async function loadCachedLut(id: string, url: string): Promise<{ data: Uint8ClampedArray; size: number } | null> {
  const db = await open();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const row = req.result as Row | undefined;
        // 網址換了代表濾鏡檔換了，舊的表就不能用
        if (!row || row.url !== url || !row.buf) return resolve(null);
        resolve({ data: new Uint8ClampedArray(row.buf), size: row.size });
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** 把解好的表收起來（失敗就算了，下次再解一次而已） */
export async function saveCachedLut(id: string, url: string, data: Uint8ClampedArray, size: number): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    // slice 是為了拿到一塊獨立的 ArrayBuffer（原本那塊還在用）
    tx.objectStore(STORE).put({ id, url, size, buf: data.slice().buffer } as Row);
  } catch { /* 空間不足之類的就跳過 */ }
}
