/* 字體「下載一次、永久可用」：
   使用者選一個字體時，把那個字體的全部字身檔（中文字體是拆成很多小份的，也全部抓）下載下來，
   存進本機資料庫（IndexedDB）。之後打開 App，用到這個字體時直接從本機登記，不用網路、不用等。
   ‧ 每一小份存成檔案（Blob；iOS 放在儲存空間，不佔記憶體）。
   ‧ 登記時只給瀏覽器「每一份的本機網址＋它涵蓋哪些字」，真的用到哪些字才讀那幾份 ——
     不會把整個字體（中文字體 3～20MB，解開更大）一次塞進記憶體（以前會讓 iPhone 閃退、進專案很卡）。
   哪些字體已下載另外記在 localStorage，按鈕可以同步知道要不要顯示「下載」圖示。 */

const DB = 'abai-fonts-v2', STORE = 'faces', LIST_KEY = 'abai-fonts-downloaded-v2';
type Face = { desc: FontFaceDescriptors; blob?: Blob; buf?: ArrayBuffer };
// 舊版（整份讀進記憶體的那版）的資料：丟掉，重新下載成新格式
try { if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('abai-fonts'); localStorage.removeItem('abai-fonts-downloaded-v1'); } catch { /* */ }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
const idb = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => db().then(d => new Promise<T>((res, rej) => {
  const t = d.transaction(STORE, mode); const q = fn(t.objectStore(STORE));
  q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error);
}));

/* ── 已下載清單（同步） ── */
const downloaded = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; } })());
const saveList = () => { try { localStorage.setItem(LIST_KEY, JSON.stringify([...downloaded])); } catch { /* 私密模式 */ } };
const downloading = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());
export const onFontStoreChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const isFontDownloaded = (family: string) => downloaded.has(family);
export const isFontDownloading = (family: string) => downloading.has(family);

/* 啟動時核對一次：本機資料庫被系統清掉的話，清單也要拿掉（按鈕才會重新顯示下載） */
if (typeof indexedDB !== 'undefined' && downloaded.size) {
  idb<IDBValidKey[]>('readonly', s => s.getAllKeys()).then(keys => {
    const have = new Set(keys.map(String)); let changed = false;
    for (const f of [...downloaded]) if (!have.has(f)) { downloaded.delete(f); changed = true; }
    if (changed) { saveList(); emit(); }
  }).catch(() => {});
}

/* ── 解析 @font-face ── */
function parseFaces(css: string, base: string) {
  const pick = (body: string, k: string) => { const m = body.match(new RegExp(k + '\\s*:\\s*([^;]+);?')); return m ? m[1].trim() : ''; };
  const out: { url: string; desc: FontFaceDescriptors }[] = [];
  for (const rule of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
    const src = pick(rule, 'src'); const m = src.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/);
    if (!m) continue;
    const desc: FontFaceDescriptors = { style: pick(rule, 'font-style') || 'normal', weight: pick(rule, 'font-weight') || '400', display: 'swap' };
    const ur = pick(rule, 'unicode-range'); if (ur) desc.unicodeRange = ur;
    try { out.push({ url: new URL(m[2], base).href, desc }); } catch { /* 壞網址略過 */ }
  }
  return out;
}

async function fetchAll(list: { url: string; desc: FontFaceDescriptors }[]): Promise<Face[]> {
  const out: Face[] = new Array(list.length); let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const k = i++; const r = await fetch(list[k].url);
      if (!r.ok) throw new Error('font ' + r.status);
      out[k] = { desc: list[k].desc, blob: await r.blob() };
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
  return out;
}

const registered = new Set<string>();
function register(family: string, faces: Face[]) {
  if (registered.has(family)) return;
  for (const f of faces) {
    try {
      const blob = f.blob || new Blob([f.buf!], { type: 'font/woff2' });
      document.fonts.add(new FontFace(family, `url("${URL.createObjectURL(blob)}")`, f.desc));
    } catch { /* 單一字身壞掉不影響其他 */ }
  }
  registered.add(family);
}

/** 已下載的字體：從本機登記（不用網路）。成功回 true。 */
export async function loadStoredFont(family: string): Promise<boolean> {
  if (registered.has(family)) return true;
  if (!downloaded.has(family) || typeof indexedDB === 'undefined') return false;
  try {
    const rec = await idb<{ faces: Face[] } | undefined>('readonly', s => s.get(family));
    if (!rec?.faces?.length) { downloaded.delete(family); saveList(); emit(); return false; }
    register(family, rec.faces);
    return true;
  } catch { return false; }
}

export type FontSource = { url?: string; css?: string; google?: string };
const pending = new Map<string, Promise<boolean>>();
/** 下載整個字體並存到本機（只做一次）。成功回 true。 */
export function downloadFont(family: string, src: FontSource, opts: { register?: boolean } = {}): Promise<boolean> {
  if (downloaded.has(family)) return loadStoredFont(family);
  const hit = pending.get(family); if (hit) return hit;
  downloading.add(family); emit();
  const p = (async () => {
    try {
      let list: { url: string; desc: FontFaceDescriptors }[];
      if (src.url) list = [{ url: src.url, desc: { style: 'normal', weight: '400', display: 'swap' } }];
      else {
        const cssUrl = src.css || src.google!;
        const r = await fetch(cssUrl); if (!r.ok) return false;
        list = parseFaces(await r.text(), cssUrl);
      }
      if (!list.length) return false;
      const faces = await fetchAll(list);
      if (opts.register !== false) register(family, faces);
      /* 存檔：先存成檔案（Blob）；這台裝置的資料庫不收檔案的話，改存成資料（壓縮的原檔大小，不解開） */
      let saved = false;
      try { await idb('readwrite', s => s.put({ faces }, family)); saved = true; } catch { /* 改用下面的方式 */ }
      if (!saved) {
        try {
          const bufs = await Promise.all(faces.map(async f => ({ desc: f.desc, buf: await f.blob!.arrayBuffer() })));
          await idb('readwrite', s => s.put({ faces: bufs }, family)); saved = true;
        } catch { /* 存不進去：這次照樣能用，下次再下載 */ }
      }
      if (saved) { downloaded.add(family); saveList(); }
      return true;
    } catch { return false; }
    finally { downloading.delete(family); pending.delete(family); emit(); }
  })();
  pending.set(family, p);
  return p;
}
