import { BATCH_RAW_NOTE } from '../utils/batchLimit';
/* App 自己的相簿畫面（只在 App 裡出現，網頁版不會載入）。
 *
 * ‧ 從下面滑上來、收回去也是滑下去；標題點一下切換相簿（最近項目、個人收藏、影片…）。
 * ‧ 三欄方格、縮圖淡入，影片右下角標長度。
 * ‧ 只能選一張的地方點一下就完成；能選多張的地方點了出現號碼，照點的順序排。
 * ‧ 只開放部分照片時，上方有一條提示可以再多開放幾張；權限被拒時帶去設定，
 *   或改用系統的照片選擇器（那個不需要權限）。
 * 資料都從 utils/nativeGallery 來。 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type GalleryFilter, type LibraryAlbum, type LibraryAsset, type LibraryStatus, type PhotoLibraryApi,
  cachedThumb, exportAssets, prefetchThumbs, requestThumb, setThumbSource,
  isThumbDecoded, cachedFirstPage, rememberFirstPage, bigThumb, rawHeroThumb, rawAssetIds,
} from '../utils/nativeGallery';
import { haptic } from '../utils/haptics';
import { ImportSpinner } from './BusySpinner';
import { setRawImportHint } from '../utils/importHint';
import { beginImportHero, cancelImportHero, heroAllowed, beginToolEntrance, cancelToolEntrance } from '../utils/importHero';

const PAGE = 150;
export type PickMode = 'edit' | 'collage' | 'batch';
const PICK_MODES: [PickMode, string][] = [['edit', '編輯'], ['collage', '拼圖'], ['batch', '批量編輯']];
/** 簡易拼圖：一次 2～9 張 */
const COLLAGE_MIN = 2, COLLAGE_MAX = 9;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const CSS = `
@keyframes abg-pop { from { transform: scale(.86); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes abg-shimmer { 0% { opacity: .55 } 50% { opacity: .9 } 100% { opacity: .55 } }
@keyframes abg-spin { to { transform: rotate(360deg) } }
@keyframes abg-shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-5px) } 75% { transform: translateX(5px) } }
.abg-scroll { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; }
.abg-scroll::-webkit-scrollbar { display: none }
.abg-cell { position: relative; aspect-ratio: 1 / 1; overflow: hidden; background: #1c1c1e; -webkit-tap-highlight-color: transparent; }
.abg-cell img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .28s ease, transform .32s ${EASE}; -webkit-user-drag: none; user-select: none; -webkit-touch-callout: none; }
.abg-cell img.on { opacity: 1 }
.abg-cell .dim { position: absolute; inset: 0; background: rgba(0,0,0,.38); opacity: 0; transition: opacity .2s ease; pointer-events: none; }
.abg-cell.sel .dim { opacity: 1 }
@keyframes abg-check { from { transform: translate(-50%,-50%) scale(.6); opacity: 0 } to { transform: translate(-50%,-50%) scale(1); opacity: 1 } }
.abg-cell .chk { position: absolute; left: 50%; top: 50%; width: 30px; height: 30px; border-radius: 9999px; background: #fff; color: #000;
  display: flex; align-items: center; justify-content: center; transform: translate(-50%,-50%); box-shadow: 0 2px 10px rgba(0,0,0,.35);
  animation: abg-check .2s ${EASE}; pointer-events: none; }
.abg-cell .skel { position: absolute; inset: 0; background: #2c2c2e; animation: abg-shimmer 1.4s ease-in-out infinite; }
.abg-cell:active img.on { filter: brightness(.82) }
`;

const fmtDuration = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60), sec = t % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/* 一格照片。縮圖等它真的出現在畫面附近才去要 */
const Cell = React.memo(function Cell({ a, order, multi, onTap, raw = false }: {
  a: LibraryAsset; order: number; multi: boolean; onTap: (a: LibraryAsset) => void; raw?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState(() => cachedThumb(a.id));
  /* 已經預熱（解碼好）的縮圖：一出現就直接顯示，不淡入、不先顯示灰色 */
  const [instant] = useState(() => !!cachedThumb(a.id) && isThumbDecoded(a.id));
  const [loaded, setLoaded] = useState(instant);
  useEffect(() => {
    if (url) return;
    const el = ref.current;
    if (!el) return;
    let cancel: (() => void) | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (!cancel) cancel = requestThumb(a.id, setUrl); }
      else if (cancel) { cancel(); cancel = null; }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => { io.disconnect(); cancel?.(); };
  }, [a.id, url]);
  const sel = order > 0;
  return (
    <button ref={ref} type="button" data-asset={a.id} className={`abg-cell${sel ? ' sel' : ''}`} onClick={() => onTap(a)}
      aria-label={a.video ? `影片 ${fmtDuration(a.duration)}` : '照片'} aria-pressed={sel}>
      {!loaded && <span className="skel" />}
      {url && <img src={url} alt="" draggable={false} className={loaded ? 'on' : ''} style={instant ? { transition: 'none' } : undefined} onLoad={() => setLoaded(true)} />}
      {a.video && (
        <span className="absolute left-0 right-0 bottom-0 h-7 flex items-end justify-end px-1.5 pb-1 text-[11px] font-semibold text-white pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)' }}>
          {fmtDuration(a.duration)}
        </span>
      )}
      {/* RAW 照片：左下角標 RAW（跟照片 App 一樣） */}
      {raw && !a.video && (
        <span className="absolute left-1.5 bottom-1.5 px-1 h-[15px] rounded-[4px] bg-black/55 text-white text-[9px] font-bold leading-[15px] tracking-[0.04em] pointer-events-none">RAW</span>
      )}
      {/* 選中：照片稍微變暗、正中間一個勾（沒有外框、不縮小） */}
      <span className="dim" />
      {multi && sel && (
        <span className="chk" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      )}
    </button>
  );
});

const AlbumCover: React.FC<{ id: string }> = ({ id }) => {
  const [url, setUrl] = useState(() => cachedThumb(id));
  useEffect(() => { if (!url && id) return requestThumb(id, setUrl); }, [id, url]);
  return (
    <span className="w-14 h-14 rounded-lg overflow-hidden bg-[#2c2c2e] shrink-0">
      {url && <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />}
    </span>
  );
};

const Spinner: React.FC = () => (
  <span className="inline-block w-8 h-8 rounded-full border-[3px] border-white/20 border-t-white" style={{ animation: 'abg-spin .8s linear infinite' }} />
);

export const NativeGallery: React.FC<{
  api: PhotoLibraryApi; limit: number; filter: GalleryFilter; onClose: (files: File[] | null) => void;
  /** 有上限但不寫出「最多可選 N 張」 */
  quiet?: boolean;
  /** 不顯示去背（有透明像素）的照片：大部分工具不收去背圖 */
  noAlpha?: boolean;
  /** 導入單張時播放大過場（從主頁進編輯、美顏、仿色才有） */
  hero?: string;
  /** 選到 RAW 時最多幾張（0＝不限）。點的當下就問系統這張是不是 RAW */
  rawLimit?: number;
  /** 點下去就直接進工具（點陣文字）：相簿立刻收起來、不顯示「匯入中」轉圈，
      先把縮圖交給工具（onInstant），原檔在背景拿好再交出去；拿不到時 onInstantFail */
  onInstant?: (thumb: string | null) => void;
  onInstantFail?: () => void;
  /** 編輯的導入相簿：標題下面多一排「編輯／拼圖／批量編輯」。
      編輯＝點一下就進（單張）；拼圖＝選 2～9 張進簡易拼圖；批量編輯＝照原本的多選（上限 limit）。
      選好時用 onMode 告訴呼叫端是哪一種 */
  modes?: boolean;
  initialMode?: PickMode;
  onMode?: (mode: PickMode) => void;
}> = ({ api, limit: baseLimit, filter, onClose, noAlpha = false, hero, quiet = false, rawLimit: baseRawLimit = 0, onInstant, onInstantFail, modes = false, initialMode = 'edit', onMode }) => {
  const [mode, setModeState] = useState<PickMode>(initialMode);
  /* 這一種模式能選幾張：編輯 1 張、拼圖最多 9 張、批量照呼叫端給的上限 */
  const limit = !modes ? baseLimit : mode === 'edit' ? 1 : mode === 'collage' ? COLLAGE_MAX : baseLimit;
  const rawLimit = !modes || mode === 'batch' ? baseRawLimit : 0;
  const minPick = modes && mode === 'collage' ? COLLAGE_MIN : 1;
  const multi = limit !== 1;
  const [shown, setShown] = useState(false);              // 滑上來的動畫
  const [status, setStatus] = useState<LibraryStatus | 'checking'>('checking');
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [album, setAlbum] = useState<LibraryAlbum>({ id: 'recents', title: '最近項目', count: 0, cover: '' });
  const [albumOpen, setAlbumOpen] = useState(false);
  /* 先用預熱（或上一次打開）記下的第一頁畫出來，新的清單回來再換上 */
  const [items, setItems] = useState<LibraryAsset[]>(() => cachedFirstPage(filter)?.items ?? []);
  /* 哪幾張是 RAW（左下角標 RAW）：每載入一頁就問一次新出現的那幾張 */
  const [rawSet, setRawSet] = useState<Set<string>>(() => new Set());
  const rawAsked = useRef(new Set<string>());
  useEffect(() => {
    const ids = items.filter(a => !a.video && !rawAsked.current.has(a.id)).map(a => a.id);
    if (!ids.length) return;
    ids.forEach(id => rawAsked.current.add(id));
    /* 不在換頁時取消：已經問過的那幾張不會再問，結果回來一定要收 */
    void rawAssetIds(ids).then(found => { if (found.size) setRawSet(prev => { const n = new Set(prev); found.forEach(id => n.add(id)); return n; }); });
  }, [items]);
  const [total, setTotal] = useState(() => cachedFirstPage(filter)?.total ?? -1);
  const itemsRef = useRef<LibraryAsset[]>(items);
  /* 去背判斷：原生先標出「檔案類型可能透明」的那些（PNG…），這些先不顯示，
     問過原生確認不是去背圖才放出來（截圖之類的一般 PNG 會晚一點點出現）。
     分頁照「已經拿到幾張」算，不受隱藏影響。 */
  const [alphaFlags, setAlphaFlags] = useState<Record<string, boolean>>({});
  const canCheckAlpha = !!api.alphaFlags;
  itemsRef.current = items;
  const visibleItems = useMemo(() => !noAlpha ? items
    : items.filter(a => !a.maybeAlpha || (canCheckAlpha ? alphaFlags[a.id] === false : true)),
  [items, noAlpha, alphaFlags, canCheckAlpha]);
  const [picked, setPicked] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [shake, setShake] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const genRef = useRef(0);
  const closedRef = useRef(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(56);
  const exportingRef = useRef(false);

  const title = filter === 'videos' ? '選擇影片' : filter === 'images' ? '選擇照片' : '選擇照片或影片';

  /* 收起來：先滑下去再把結果交出去 */
  const close = useCallback((files: File[] | null) => {
    if (closedRef.current) return;
    closedRef.current = true;
    /* 選好了：不要往下滑（滑動中轉圈會跟著移動），直接交出去，
       接手的匯入畫面是同一個位置、同一款的黑底轉圈 */
    if (files && files.length) { onClose(files); return; }
    setShown(false);
    setTimeout(() => onClose(files), 480);
  }, [onClose]);

  useLayoutEffect(() => { setThumbSource(api); }, [api]);
  /* 滑上來之前先等第一屏的縮圖都準備好（預熱過的話幾乎是立刻），最多等 0.6 秒 ——
     使用者看到的相簿一出來就是完整的，不是一片灰再一格一格出現 */
  useLayoutEffect(() => {
    const t0 = performance.now();
    let r = 0;
    const tick = () => {
      const first = itemsRef.current.slice(0, 18);
      const ready = first.length > 0 && first.every(a => isThumbDecoded(a.id));
      if (ready || performance.now() - t0 > 600) { setShown(true); return; }
      r = requestAnimationFrame(tick);
    };
    r = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r);
  }, []);

  /* 權限：還沒問過就問；問過就照結果走 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let { status: s } = await api.access();
        if (s === 'notDetermined') s = (await api.request()).status;
        if (alive) setStatus(s);
      } catch { if (alive) setStatus('denied'); }
    })();
    return () => { alive = false; };
  }, [api]);

  const loadPage = useCallback(async (reset: boolean) => {
    if (loadingRef.current && !reset) return;
    loadingRef.current = true;
    const gen = reset ? ++genRef.current : genRef.current;
    try {
      const offset = reset ? 0 : items.length;
      const r = await api.assets({ album: album.id, filter, offset, limit: PAGE });
      if (gen !== genRef.current) return;
      setTotal(r.total);
      if (reset) prefetchThumbs(r.items.slice(0, 60).map(a => a.id));
      // 記下第一頁：下次打開相簿直接用它先畫
      if (reset && album.id === 'recents') rememberFirstPage(filter, r);
      setItems(prev => reset ? r.items : [...prev, ...r.items]);
      if (noAlpha && api.alphaFlags) {
        const ids = r.items.filter(a => a.maybeAlpha).map(a => a.id);
        if (ids.length) api.alphaFlags({ ids }).then(({ flags }) => {
          if (gen === genRef.current) setAlphaFlags(prev => ({ ...prev, ...flags }));
        }).catch(() => {
          // 查不到就當作不是去背圖（不能讓照片永遠不出現）
          if (gen === genRef.current) setAlphaFlags(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, false])) }));
        });
      }
    } catch {
      if (gen === genRef.current && reset) { setItems([]); setTotal(0); }
    } finally {
      if (gen === genRef.current) loadingRef.current = false;
    }
  }, [api, album.id, filter, items.length, noAlpha]);

  const ok = status === 'authorized' || status === 'limited';

  const reload = useCallback(() => {
    void loadPage(true);
    api.albums({ filter }).then(r => setAlbums(r.albums)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, filter, album.id]);

  /* 換相簿或剛拿到權限：從頭載入 */
  useEffect(() => {
    if (!ok) return;
    scrollRef.current?.scrollTo({ top: 0 });
    reload();
  }, [ok, reload]);

  /* 開放的照片範圍變了（例如在「管理」裡多選了幾張）：重新載入，已選的保留 */
  useEffect(() => {
    if (!ok) return;
    let handle: { remove: () => Promise<void> } | null = null;
    let alive = true;
    api.addListener('libraryChanged', () => reload()).then(h => { if (alive) handle = h; else void h.remove(); }).catch(() => {});
    return () => { alive = false; void handle?.remove(); };
  }, [api, ok, reload]);

  /* 滑到底就再拿下一頁 */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !ok) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && total > items.length) void loadPage(false);
    }, { root: scrollRef.current, rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ok, total, items.length, loadPage]);

  const finish = useCallback(async (ids: string[]) => {
    if (!ids.length || exportingRef.current) return;
    exportingRef.current = true;
    if (modes) onMode?.(modeRef.current);
    if (onInstant) {
      /* 直接進工具：相簿往下收、工具同時打開（帶著這張的縮圖），原檔在背景拿 */
      closedRef.current = true;
      onInstant(cachedThumb(ids[0]) ?? null);
      setShown(false);
      const t0 = performance.now();
      try {
        const files = await exportAssets(ids);
        /* 收起來的動畫跑完再拆掉相簿 */
        await new Promise(r => setTimeout(r, Math.max(0, 480 - (performance.now() - t0))));
        onClose(files);
      } catch (e: any) {
        haptic('error');
        onInstantFail?.();
        alert(`照片讀不進來：${String(e?.message ?? e ?? '請再試一次')}`);
        onClose([]);
      }
      return;
    }
    /* 從主頁導入單張：小縮圖放大、之後飛到工具裡照片的位置（見 utils/importHero） */
    /* 單張 RAW：不播過場（RAW 要先解析一段時間，飛完會停在那裡等），改成直接顯示「解析 RAW」的載入畫面 */
    /* 選到的照片裡有 RAW（單張或批量）：轉圈的字改成「正在解析RAW」 */
    const raws = await rawAssetIds(ids);
    const isRaw = ids.length === 1 && raws.has(ids[0]);
    if (raws.size) setRawImportHint(true);
    if (hero && ids.length === 1 && !isRaw && heroAllowed()) {
      const cell = scrollRef.current?.querySelector<HTMLElement>(`[data-asset="${window.CSS.escape(ids[0])}"]`);
      const a = itemsRef.current.find(x => x.id === ids[0]);
      const thumb = cachedThumb(ids[0]);
      if (cell && thumb && a && !a.video) beginImportHero(hero, cell.getBoundingClientRect(), thumb, a.w && a.h ? a.w / a.h : undefined, async () => (await bigThumb(ids[0])) ?? await rawHeroThumb(ids[0]));
    } else if (hero && ids.length === 1 && isRaw && heroAllowed()) {
      /* 單張 RAW：沒有飛行過場，但工具介面一樣分層進場（照片沖好出現的那一刻開播） */
      const a = itemsRef.current.find(x => x.id === ids[0]);
      beginToolEntrance(hero, a && a.w && a.h ? a.w / a.h : undefined);
    }
    setExporting(true);
    try {
      const files = await exportAssets(ids);
      close(files);
    } catch (e: any) {
      cancelImportHero();
      cancelToolEntrance();
      setRawImportHint(false);
      exportingRef.current = false;
      setExporting(false);
      haptic('error');
      alert(`照片讀不進來：${String(e?.message ?? e ?? '請再試一次')}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, hero, modes, onMode, onInstant, onInstantFail, onClose]);

  /* 用 ref 記目前選了哪些：點一下不會讓上千格全部重畫 */
  const pickedRef = useRef<string[]>([]);
  /* 含 RAW 時的上限：哪幾張是 RAW 問過就記著（點的當下問一次，很快） */
  const rawOfRef = useRef<Map<string, boolean>>(new Map());
  const checkingRef = useRef(false);
  const [rawNote, setRawNote] = useState(0);
  const isRawAsset = async (id: string) => {
    if (rawOfRef.current.has(id)) return rawOfRef.current.get(id)!;
    let r = false;
    try { r = !!api.rawIds && ((await api.rawIds({ ids: [id] })).raw || []).includes(id); } catch { /* 問不到就當作不是 */ }
    rawOfRef.current.set(id, r);
    return r;
  };
  const onTap = useCallback(async (a: LibraryAsset) => {
    if (exportingRef.current || checkingRef.current) return;
    if (!multi) { void finish([a.id]); return; }
    const prev = pickedRef.current;
    let next: string[];
    if (prev.includes(a.id)) next = prev.filter(x => x !== a.id);
    else if (limit > 0 && prev.length >= limit) { haptic('error'); setShake(n => n + 1); return; }
    else {
      next = [...prev, a.id];
      if (rawLimit > 0 && next.length > rawLimit) {
        checkingRef.current = true;
        try {
          const hasRaw = (await isRawAsset(a.id)) || prev.some(id => rawOfRef.current.get(id));
          if (hasRaw) { haptic('error'); setShake(n => n + 1); setRawNote(n => n + 1); return; }
        } finally { checkingRef.current = false; }
      } else if (rawLimit > 0) void isRawAsset(a.id);   // 先問好，之後要判斷時就是現成的
      if (pickedRef.current !== prev) return;
    }
    pickedRef.current = next;
    setPicked(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, limit, rawLimit, finish]);
  /* 「含 RAW 最多 10 張」的提示：擋下來時出現 2 秒 */
  useEffect(() => { if (!rawNote) return; const t = window.setTimeout(() => setRawNote(0), 2200); return () => window.clearTimeout(t); }, [rawNote]);

  /* 換模式：已經選的清掉（單張／拼圖／批量的上限不一樣，留著會超過或不合規則） */
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setMode = (m: PickMode) => {
    if (m === modeRef.current || exportingRef.current) return;
    haptic('tick');
    modeRef.current = m;
    pickedRef.current = [];
    setPicked([]);
    setRawNote(0);
    setModeState(m);
  };

  const order = useMemo(() => { const m = new Map<string, number>(); picked.forEach((id, i) => m.set(id, i + 1)); return m; }, [picked]);

  const chooseAlbum = (a: LibraryAlbum) => {
    setAlbumOpen(false);
    if (a.id === album.id) return;
    setItems([]); setTotal(-1);
    setAlbum(a);
  };

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const sheet: React.CSSProperties = {
    transform: shown ? 'translateY(0)' : 'translateY(100%)',
    /* 上來 0.56 秒、下去 0.46 秒（原本 0.42 秒太快） */
    transition: `transform ${shown ? '.56s' : '.46s'} ${EASE}`,
  };

  return (
    <div className="fixed inset-0 z-[10000] select-none" style={{ WebkitUserSelect: 'none' }}>
      <style>{CSS}</style>
      <div className="absolute inset-0 bg-black" style={{ opacity: shown ? 0.6 : 0, transition: `opacity ${shown ? '.48s' : '.4s'} ease` }} />
      <div className="absolute inset-0 flex flex-col bg-black text-white" style={sheet}>
        {/* 上方：返回（ㄑ）／相簿名稱／完成 */}
        <div ref={headerRef} className="relative z-20 shrink-0 bg-black/85 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="h-12 px-2 grid grid-cols-[1fr_auto_1fr] items-center">
            <button type="button" aria-label="返回" className="justify-self-start h-10 w-11 flex items-center justify-center text-white/90 active:opacity-50"
              onClick={() => close([])}>
              {/* 沒有橫條的箭頭（像注音的ㄑ） */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <button type="button" disabled={!ok} onClick={() => setAlbumOpen(v => !v)}
              className="h-10 px-3 flex items-center gap-1.5 active:opacity-60 max-w-[52vw]">
              <span className="text-[16px] font-semibold truncate">{ok ? album.title : title}</span>
              {ok && (
                <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 opacity-80"
                  style={{ transform: albumOpen ? 'rotate(180deg)' : 'none', transition: `transform .3s ${EASE}` }}>
                  <path d="M2 4.2 6 8l4-3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <div className="justify-self-end pr-1">
              {multi && ok && (
                <button type="button" disabled={picked.length < minPick || exporting} onClick={() => void finish(picked)}
                  className="h-8 px-4 rounded-full text-[14px] font-bold"
                  style={{
                    background: picked.length >= minPick ? '#fff' : 'rgba(255,255,255,.14)', color: picked.length >= minPick ? '#000' : 'rgba(255,255,255,.4)',
                    transition: `background .25s ease, color .25s ease, transform .25s ${EASE}`,
                    transform: picked.length >= minPick ? 'scale(1)' : 'scale(.96)',
                    animation: shake ? 'abg-shake .3s ease' : undefined,
                  }} key={shake}>
                  完成
                </button>
              )}
            </div>
          </div>
          {/* 編輯的導入相簿：三種導入方式。沒有按鈕外框，就是三個字：沒選的淡、選中的亮 */}
          {modes && ok && (
            <div className="h-9 px-6 grid grid-cols-3 items-center" role="tablist" aria-label="導入方式" data-pick-modes>
              {PICK_MODES.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} data-pick-mode={id} disabled={exporting}
                  onClick={() => setMode(id)}
                  className="h-9 text-[14px] font-semibold active:opacity-60"
                  style={{ color: mode === id ? '#fff' : 'rgba(255,255,255,.38)', transition: 'color .22s ease' }}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {status === 'limited' && (
            <div className="px-4 pb-2.5 flex items-center gap-3 text-[12.5px] text-white/65">
              <span className="flex-1 leading-snug">你只開放了部分照片給 ABAI。</span>
              <button type="button" className="shrink-0 h-7 px-3 rounded-full bg-white/15 text-white text-[12.5px] font-semibold active:opacity-60"
                onClick={() => { haptic('tick'); void api.manageLimited().then(() => reload()); }}>選更多照片</button>
            </div>
          )}
          {multi && limit > 1 && ok && !quiet && !(modes && mode === 'collage') && (
            <div className="px-4 pb-2 text-[11.5px] text-white/40">{`最多可選 ${limit} 張`}</div>
          )}
          {modes && mode === 'collage' && ok && (
            <div className="px-4 pb-2 text-center text-[11.5px] text-white/40">{`選 ${COLLAGE_MIN}～${COLLAGE_MAX} 張照片`}</div>
          )}
          {/* 含 RAW 時擋下來：說明為什麼不能再選 */}
          {rawNote > 0 && (
            <div key={rawNote} className="px-4 pb-2 text-[12px] font-semibold text-[#ffb3a7]" role="status">{BATCH_RAW_NOTE}</div>
          )}
        </div>

        {/* 相簿清單：從標題下方展開 */}
        <div className="absolute left-0 right-0 bottom-0 z-10 bg-black/95 backdrop-blur-xl abg-scroll"
          style={{
            top: headerH, paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            opacity: albumOpen ? 1 : 0, transform: albumOpen ? 'translateY(0)' : 'translateY(-14px)',
            pointerEvents: albumOpen ? 'auto' : 'none', transition: `opacity .26s ease, transform .36s ${EASE}`,
          }}>
          <div className="py-2">
            {albums.map((a, i) => (
              <button key={a.id} type="button" onClick={() => chooseAlbum(a)}
                className="w-full flex items-center gap-3.5 px-4 py-2 text-left active:bg-white/10"
                style={{ opacity: albumOpen ? 1 : 0, transform: albumOpen ? 'none' : 'translateY(-6px)',
                  transition: `opacity .3s ease ${Math.min(i, 12) * 22}ms, transform .4s ${EASE} ${Math.min(i, 12) * 22}ms` }}>
                <AlbumCover id={a.cover} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[16px] font-medium truncate">{a.title}</span>
                  <span className="block text-[13px] text-white/45 mt-0.5">{a.count.toLocaleString()}</span>
                </span>
                {a.id === album.id && (
                  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 9.5 7.5 13 14 5.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 照片方格 */}
        <div ref={scrollRef} className="flex-1 min-h-0 abg-scroll">
          {status === 'checking' && <div className="h-full flex items-center justify-center"><Spinner /></div>}

          {(status === 'denied' || status === 'restricted') && (
            <div className="h-full flex flex-col items-center justify-center px-10 text-center">
              <svg width="56" height="56" viewBox="0 0 56 56" className="opacity-80 mb-5">
                <rect x="7" y="11" width="42" height="34" rx="6" fill="none" stroke="#fff" strokeWidth="2.4" />
                <circle cx="20" cy="24" r="4" fill="none" stroke="#fff" strokeWidth="2.4" />
                <path d="M9 41 21 31l8 7 7-6 11 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
              </svg>
              <div className="text-[18px] font-bold mb-2">ABAI 還不能看到你的相簿</div>
              <div className="text-[14px] text-white/55 leading-relaxed mb-7">
                {status === 'restricted' ? '這支手機的限制設定不允許讀取照片。' : '到「設定 → ABAI → 照片」選「完整取用」或「受限取用」，就能在這裡直接挑照片。'}
              </div>
              {status === 'denied' && (
                <button type="button" className="h-12 px-8 rounded-full bg-white text-black text-[15px] font-black active:scale-95 transition-transform mb-3"
                  onClick={() => { haptic('tick'); void api.openSettings(); }}>打開設定</button>
              )}
              <button type="button" className="h-11 px-6 rounded-full text-[14px] text-white/80 active:opacity-50"
                onClick={() => { haptic('tick'); close(null); }}>改用系統的照片選擇器</button>
            </div>
          )}

          {ok && total === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-white/45 text-[15px] gap-3">
              <span>{filter === 'videos' ? '這裡沒有影片' : '這裡沒有照片'}</span>
              {status === 'limited' && (
                <button type="button" className="h-10 px-5 rounded-full bg-white/15 text-white text-[14px] font-semibold"
                  onClick={() => void api.manageLimited().then(() => reload())}>選更多照片</button>
              )}
            </div>
          )}

          {ok && total !== 0 && (
            <>
              <div className="grid grid-cols-3 gap-[2px]">
                {visibleItems.map(a => <Cell key={a.id} a={a} order={order.get(a.id) ?? 0} multi={multi} onTap={onTap} raw={rawSet.has(a.id)} />)}
                {total < 0 && Array.from({ length: 24 }, (_, i) => (
                  <span key={`s${i}`} className="abg-cell"><span className="skel" style={{ animationDelay: `${(i % 6) * 60}ms` }} /></span>
                ))}
              </div>
              <div ref={sentinelRef} className="h-px" />
              {total > 0 && items.length >= total && (
                <div className="py-6 text-center text-[13px] text-white/35">
                  {(noAlpha ? visibleItems.length : total).toLocaleString()} {filter === 'videos' ? '部影片' : filter === 'images' ? '張照片' : '個項目'}
                </div>
              )}
              <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }} />
            </>
          )}
        </div>

        {/* 把原檔拿出來的時候 */}
        {/* 讀原檔時：跟接下來匯入畫面一模一樣的黑底轉圈，兩段接起來看起來就是同一個 */}
        {exporting && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black">
            <ImportSpinner belowStatusBar />
          </div>
        )}
      </div>
    </div>
  );
};
