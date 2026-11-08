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
} from '../utils/nativeGallery';
import { haptic } from '../utils/haptics';
import { ImportSpinner } from './BusySpinner';

const PAGE = 150;
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
.abg-cell.sel img { transform: scale(.9); }
.abg-cell .ring { position: absolute; inset: 0; border: 2px solid #fff; opacity: 0; transition: opacity .2s ease; pointer-events: none; }
.abg-cell.sel .ring { opacity: 1 }
.abg-cell .skel { position: absolute; inset: 0; background: #2c2c2e; animation: abg-shimmer 1.4s ease-in-out infinite; }
.abg-cell:active img.on { filter: brightness(.82) }
`;

const fmtDuration = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60), sec = t % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/* 一格照片。縮圖等它真的出現在畫面附近才去要 */
const Cell = React.memo(function Cell({ a, order, multi, onTap }: {
  a: LibraryAsset; order: number; multi: boolean; onTap: (a: LibraryAsset) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState(() => cachedThumb(a.id));
  const [loaded, setLoaded] = useState(false);
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
    <button ref={ref} type="button" className={`abg-cell${sel ? ' sel' : ''}`} onClick={() => onTap(a)}
      aria-label={a.video ? `影片 ${fmtDuration(a.duration)}` : '照片'} aria-pressed={sel}>
      {!loaded && <span className="skel" />}
      {url && <img src={url} alt="" draggable={false} className={loaded ? 'on' : ''} onLoad={() => setLoaded(true)} />}
      {a.video && (
        <span className="absolute left-0 right-0 bottom-0 h-7 flex items-end justify-end px-1.5 pb-1 text-[11px] font-semibold text-white pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)' }}>
          {fmtDuration(a.duration)}
        </span>
      )}
      <span className="ring" />
      {multi && (
        <span className="absolute top-1.5 right-1.5 w-[22px] h-[22px] rounded-full flex items-center justify-center pointer-events-none"
          style={sel
            ? { background: '#fff', color: '#000', animation: 'abg-pop .18s ease-out', boxShadow: '0 1px 4px rgba(0,0,0,.35)' }
            : { border: '1.5px solid rgba(255,255,255,.9)', background: 'rgba(0,0,0,.18)', boxShadow: '0 0 2px rgba(0,0,0,.4)' }}>
          {sel && <span className="text-[12px] font-black leading-none">{order}</span>}
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
}> = ({ api, limit, filter, onClose }) => {
  const multi = limit !== 1;
  const [shown, setShown] = useState(false);              // 滑上來的動畫
  const [status, setStatus] = useState<LibraryStatus | 'checking'>('checking');
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [album, setAlbum] = useState<LibraryAlbum>({ id: 'recents', title: '最近項目', count: 0, cover: '' });
  const [albumOpen, setAlbumOpen] = useState(false);
  const [items, setItems] = useState<LibraryAsset[]>([]);
  const [total, setTotal] = useState(-1);
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
    setTimeout(() => onClose(files), 360);
  }, [onClose]);

  useLayoutEffect(() => { setThumbSource(api); }, [api]);
  useLayoutEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);

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
      setItems(prev => reset ? r.items : [...prev, ...r.items]);
    } catch {
      if (gen === genRef.current && reset) { setItems([]); setTotal(0); }
    } finally {
      if (gen === genRef.current) loadingRef.current = false;
    }
  }, [api, album.id, filter, items.length]);

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
    setExporting(true);
    try {
      const files = await exportAssets(ids);
      haptic('success');
      close(files);
    } catch (e: any) {
      exportingRef.current = false;
      setExporting(false);
      haptic('error');
      alert(`照片讀不進來：${String(e?.message ?? e ?? '請再試一次')}`);
    }
  }, [close]);

  /* 用 ref 記目前選了哪些：點一下不會讓上千格全部重畫 */
  const pickedRef = useRef<string[]>([]);
  const onTap = useCallback((a: LibraryAsset) => {
    if (exportingRef.current) return;
    if (!multi) { haptic('tick'); void finish([a.id]); return; }
    const prev = pickedRef.current;
    let next: string[];
    if (prev.includes(a.id)) next = prev.filter(x => x !== a.id);
    else if (limit > 0 && prev.length >= limit) { haptic('error'); setShake(n => n + 1); return; }
    else next = [...prev, a.id];
    haptic('tick');
    pickedRef.current = next;
    setPicked(next);
  }, [multi, limit, finish]);

  const order = useMemo(() => { const m = new Map<string, number>(); picked.forEach((id, i) => m.set(id, i + 1)); return m; }, [picked]);

  const chooseAlbum = (a: LibraryAlbum) => {
    haptic('tick');
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
    transition: `transform .42s ${EASE}`,
  };

  return (
    <div className="fixed inset-0 z-[10000] select-none" style={{ WebkitUserSelect: 'none' }}>
      <style>{CSS}</style>
      <div className="absolute inset-0 bg-black" style={{ opacity: shown ? 0.6 : 0, transition: 'opacity .36s ease' }} />
      <div className="absolute inset-0 flex flex-col bg-black text-white" style={sheet}>
        {/* 上方：取消／相簿名稱／完成 */}
        <div ref={headerRef} className="relative z-20 shrink-0 bg-black/85 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="h-12 px-2 grid grid-cols-[1fr_auto_1fr] items-center">
            <button type="button" className="justify-self-start h-10 px-3 text-[16px] text-white/90 active:opacity-50"
              onClick={() => { haptic('tick'); close([]); }}>取消</button>
            <button type="button" disabled={!ok} onClick={() => { haptic('tick'); setAlbumOpen(v => !v); }}
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
                <button type="button" disabled={!picked.length || exporting} onClick={() => void finish(picked)}
                  className="h-8 px-4 rounded-full text-[14px] font-bold"
                  style={{
                    background: picked.length ? '#fff' : 'rgba(255,255,255,.14)', color: picked.length ? '#000' : 'rgba(255,255,255,.4)',
                    transition: `background .25s ease, color .25s ease, transform .25s ${EASE}`,
                    transform: picked.length ? 'scale(1)' : 'scale(.96)',
                    animation: shake ? 'abg-shake .3s ease' : undefined,
                  }} key={shake}>
                  完成
                </button>
              )}
            </div>
          </div>
          {status === 'limited' && (
            <div className="px-4 pb-2.5 flex items-center gap-3 text-[12.5px] text-white/65">
              <span className="flex-1 leading-snug">你只開放了部分照片給 ABAI。</span>
              <button type="button" className="shrink-0 h-7 px-3 rounded-full bg-white/15 text-white text-[12.5px] font-semibold active:opacity-60"
                onClick={() => { haptic('tick'); void api.manageLimited().then(() => reload()); }}>選更多照片</button>
            </div>
          )}
          {multi && limit > 1 && ok && (
            <div className="px-4 pb-2 text-[11.5px] text-white/40">最多可選 {limit} 張</div>
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
                {items.map(a => <Cell key={a.id} a={a} order={order.get(a.id) ?? 0} multi={multi} onTap={onTap} />)}
                {total < 0 && Array.from({ length: 24 }, (_, i) => (
                  <span key={`s${i}`} className="abg-cell"><span className="skel" style={{ animationDelay: `${(i % 6) * 60}ms` }} /></span>
                ))}
              </div>
              <div ref={sentinelRef} className="h-px" />
              {total > 0 && items.length >= total && (
                <div className="py-6 text-center text-[13px] text-white/35">
                  {total.toLocaleString()} {filter === 'videos' ? '部影片' : filter === 'images' ? '張照片' : '個項目'}
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
