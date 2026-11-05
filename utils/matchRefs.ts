/* 仿色的參考圖庫：可以放很多張、隨時切換、可以刪除。
   存在瀏覽器自己的資料庫（IndexedDB）裡 —— 離開仿色、換別的照片、關掉 app 再開，都還在。
   存進去之前縮到長邊 1600（仿色只看顏色統計，AI 也只跑 384 的小圖，存原檔只是浪費空間與記憶體）。
   所有用到的地方共用同一份清單（見 useMatchRefs）。 */
import { useEffect, useState } from 'react';

export type MatchRef = { id: string; url: string };

const DB = 'abai-match-refs', STORE = 'refs', LONG = 1600, MAX_REFS = 40;
let list: MatchRef[] = [];
let loaded: Promise<void> | null = null;
const subs = new Set<(l: MatchRef[]) => void>();
const emit = () => { const l = list.slice(); subs.forEach(f => f(l)); };

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    const q = f(s);
    t.oncomplete = () => { db.close(); res(q ? (q as IDBRequest<T>).result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}

function ensureLoaded() {
  if (!loaded) loaded = (async () => {
    try {
      const rows = (await tx<any[]>('readonly', s => s.getAll())) || [];
      rows.sort((a, b) => b.t - a.t);   // 新的在前面
      list = rows.map(r => ({ id: r.id, url: URL.createObjectURL(r.blob) }));
    } catch { list = []; }
    emit();
  })();
  return loaded;
}

/** 縮到長邊 LONG、存成 JPEG（品質 0.92：顏色統計看不出差別） */
async function shrink(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const W = im.naturalWidth, H = im.naturalHeight, k = Math.min(1, LONG / Math.max(W, H));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.92));
    c.width = c.height = 0;
    return b || file;
  } finally { URL.revokeObjectURL(url); }
}

/** 加進圖庫（可以一次很多張），回傳加進去的那些（排在最前面） */
export async function addMatchRefs(files: Blob[]): Promise<MatchRef[]> {
  await ensureLoaded();
  const added: MatchRef[] = [];
  const t0 = Date.now() + files.length;
  for (const [i, f] of files.entries()) {
    let blob: Blob;
    try { blob = await shrink(f); } catch { continue; }   // 讀不出來的檔案（不是圖）略過
    const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    try { await tx('readwrite', s => { s.put({ id, blob, t: t0 - i /* 照選的順序排（第一張在最前面） */ }); }); } catch { /* 存不進去（私密瀏覽）：這次還是能用 */ }
    added.push({ id, url: URL.createObjectURL(blob) });
  }
  list = [...added, ...list];
  // 太多張就把最舊的拿掉
  while (list.length > MAX_REFS) { const old = list.pop()!; URL.revokeObjectURL(old.url); tx('readwrite', s => { s.delete(old.id); }).catch(() => {}); }
  emit();
  return added;
}

export async function removeMatchRef(id: string) {
  await ensureLoaded();
  const r = list.find(x => x.id === id);
  list = list.filter(x => x.id !== id);
  emit();
  if (r) setTimeout(() => URL.revokeObjectURL(r.url), 3000);   // 畫面上可能還在用，晚一點再放掉
  try { await tx('readwrite', s => { s.delete(id); }); } catch { /* noop */ }
}

export function useMatchRefs(): MatchRef[] {
  const [l, setL] = useState<MatchRef[]>(list);
  useEffect(() => { subs.add(setL); ensureLoaded().then(() => setL(list.slice())); return () => { subs.delete(setL); }; }, []);
  return l;
}
