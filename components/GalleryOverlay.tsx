import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { prepareFiles, shareSheet } from '../utils/shareAll';
import { useNativeGlass } from '../utils/nativeGlass';
import { haptic } from '../utils/haptics';
import { setStatusBarHidden } from '../utils/native';

/* ── 相機的相簿 ───────────────────────────────────────────────────────
 * 格狀列表：越新的越下面（打開時停在最底），右上圓形勾選鈕 → 點照片勾選 → 下面一條按鈕：愛心、分享、編輯、刪除。
 * 元件內的 index 一律是「畫面上的順序」（舊→新）；交給外面之前才換回 photos 的 index（新→舊）。
 * 左下圓鈕＝回相機（整頁往下滑走）。
 * 點一張照片：全螢幕看大圖（左右滑換張、向下滑關閉）；RAW 照片才顯示 RAW 沖洗入口。
 * App 裡這些按鈕都是原生的液態玻璃按鈕（見 utils/nativeGlass）；網頁版用長得一樣的網頁按鈕。 */

interface GalleryOverlayProps {
  photos: string[];
  /** 小預覽；格狀列表從不解碼原解析度的照片 */
  thumbs?: Record<string, string>;
  onClose: () => void;
  /** 開始往下滑走的那一刻（onClose 要等滑完才呼叫） */
  onCloseStart?: () => void;
  /** 刪掉這幾張（index） */
  onDelete: (indices: number[]) => void;
  /** 編輯（相機的編輯；RAW 會先沖洗） */
  onEdit: (src: string, index: number) => void;
  /** 專業編輯（全部分頁：模板、人像、仿色…） */
  onProEdit?: (src: string, index: number) => void;
  /** 一次編輯好幾張 */
  onEditMany?: (indices: number[]) => void;
  /** 有 RAW 的那幾張（角落標一個 RAW） */
  rawShots?: Set<string>;
  /** 編輯頁覆蓋相簿時，暫停原生按鈕。 */
  suspended?: boolean;
  favorites?: Set<string>;
  /** 把這幾張設成（取消）愛心 */
  onFavorite?: (srcs: string[], on: boolean) => void;
  /** 大圖右上的標籤（例如拍照時用的濾鏡「F3」） */
  labelOf?: (src: string) => string | null;
}

/** 相簿左下回相機的圓鈕 */
const BACK_CIRCLE = 54;
/** 大圖下面的圓鈕、膠囊高度 */
const CIRCLE = 49;

/** RAW 沖洗圖示：一格底片（上下兩排齒孔）。App 裡用的是同造型的 SF Symbol「film」 */
const RawEditIcon: React.FC<{ size?: number }> = ({ size = 21 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="3" width="15" height="18" rx="2.4" />
    <path d="M8.5 3v18M15.5 3v18" />
    <g fill="currentColor" stroke="none"><rect x="5.6" y="5.9" width="1.8" height="2.2" rx=".5" /><rect x="5.6" y="10.9" width="1.8" height="2.2" rx=".5" /><rect x="5.6" y="15.9" width="1.8" height="2.2" rx=".5" /><rect x="16.6" y="5.9" width="1.8" height="2.2" rx=".5" /><rect x="16.6" y="10.9" width="1.8" height="2.2" rx=".5" /><rect x="16.6" y="15.9" width="1.8" height="2.2" rx=".5" /></g>
  </svg>
);

/* 選取的樣子跟其他功能導入照片（NativeGallery）一樣：照片縮小、白框、右上角照點的順序標號碼 */
const SEL_CSS = `
@keyframes cg-pop { from { transform: scale(.86); opacity: 0 } to { transform: scale(1); opacity: 1 } }
.cg-cell, .cg-cell img { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; -webkit-tap-highlight-color: transparent; }
.cg-cell img { transition: transform .32s cubic-bezier(0.32,0.72,0,1); }
.cg-cell.sel img { transform: scale(.9); }
.cg-cell .ring { position: absolute; inset: 0; border: 2px solid #fff; opacity: 0; transition: opacity .2s ease; pointer-events: none; }
.cg-cell.sel .ring { opacity: 1 }
`;

export const GalleryOverlay: React.FC<GalleryOverlayProps> = ({
  photos, thumbs = {}, onClose, onCloseStart, onDelete, onEdit, onProEdit, onEditMany, rawShots, suspended = false, favorites, onFavorite, labelOf,
}) => {
  /* 畫面上的順序：舊的在上、新的在下（photos 本身是新→舊） */
  const shown = useMemo(() => [...photos].reverse(), [photos]);
  const orig = (d: number) => photos.length - 1 - d;
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewer, setViewer] = useState<number | null>(null);
  const [closingViewer, setClosingViewer] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, []);

  /* 照片少了（刪掉）：選取、大圖的位置跟著修正 */
  useEffect(() => {
    setSelected(prev => new Set([...prev].filter(i => i < photos.length)));
    if (viewer !== null && viewer >= photos.length) setViewer(photos.length ? photos.length - 1 : null);
  }, [photos.length]);

  const close = () => {
    if (closing) return;
    setClosing(true);
    onCloseStart?.();
    window.setTimeout(onClose, 380);
  };

  const share = async (idx: number[]) => {
    const urls = idx.map(i => shown[i]).filter(Boolean);
    if (!urls.length) return;
    const files = await prepareFiles(urls, 'abai');
    await shareSheet(files);
  };
  const remove = (idx: number[]) => {
    if (!idx.length) return;
    if (!window.confirm(idx.length > 1 ? `刪除這 ${idx.length} 張照片？` : '刪除這張照片？')) return;
    haptic('press');
    onDelete(idx.map(orig));
    setSelected(new Set());
    if (idx.length > 1 || photos.length <= 1) setSelecting(false);
  };
  const toggleFav = (idx: number[]) => {
    const srcs = idx.map(i => shown[i]).filter(Boolean);
    if (!srcs.length || !onFavorite) return;
    const allOn = srcs.every(s => favorites?.has(s));
    haptic('tick');
    onFavorite(srcs, !allOn);
  };
  const selectedIdx = [...selected].sort((a, b) => a - b);

  /* ── 原生按鈕 ── */
  const backRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const favAll = selectedIdx.length > 0 && selectedIdx.every(i => favorites?.has(shown[i]));
  /** 多選編輯：照拍的先後（舊→新）交出去 */
  const editSelected = () => {
    if (!selectedIdx.length) return;
    if (onEditMany) onEditMany(selectedIdx.map(orig));
    else onEdit(shown[selectedIdx[0]], orig(selectedIdx[0]));
  };
  const grid = useNativeGlass('camera-gallery', !closing && !suspended && viewer === null, () => [
    { kind: 'circle', id: 'select', el: selectRef.current, symbol: selecting ? 'xmark' : 'checkmark.square', pointSize: selecting ? 17 : 20, enabled: photos.length > 0 },
    ...(selecting ? [
      { kind: 'capsule' as const, el: actionsRef.current, buttons: [
        { id: 'fav', symbol: favAll ? 'heart.fill' : 'heart', tint: 'white' as const, enabled: selectedIdx.length > 0 },
        { id: 'share', symbol: 'square.and.arrow.up', enabled: selectedIdx.length > 0 },
        { id: 'edit', symbol: 'slider.horizontal.3', enabled: selectedIdx.length > 0 },
        { id: 'delete', symbol: 'trash', enabled: selectedIdx.length > 0 },
      ] },
    ] : [
      { kind: 'circle' as const, id: 'back', symbol: 'camera', pointSize: 22, el: backRef.current },
    ]),
  ], id => {
    if (id === 'select') { setSelecting(v => !v); setSelected(new Set()); }
    else if (id === 'back') close();
    else if (id === 'fav') toggleFav(selectedIdx);
    else if (id === 'share') void share(selectedIdx);
    else if (id === 'edit') editSelected();
    else if (id === 'delete') remove(selectedIdx);
  }, [selecting, selectedIdx.join(','), favAll, photos.length], 420);
  const hideWeb = grid.native ? 'invisible' : '';

  /* 打開時停在最底（最新的那幾張），跟系統相簿一樣 */
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  /* 新拍的照片加進來（在最下面）：本來就在底部的話跟著停在底部 */
  const prevCount = useRef(photos.length);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && photos.length > prevCount.current && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
    prevCount.current = photos.length;
  }, [photos.length]);

  const tapPhoto = (i: number) => {
    if (selecting) {
      haptic('tick');
      setSelected(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
      return;
    }
    setViewer(i);
  };

  const webCircle = 'rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-center active:scale-90 transition-transform shadow-2xl';

  /* 掛在 body 上：相機頁（.safe-top）從狀態列下面才開始，放在裡面的話照片捲不到螢幕最上面 */
  return createPortal(
    <div data-camera-gallery
      className={`fixed inset-0 bg-black text-white z-50 transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${closing || !entered ? 'translate-y-full' : 'translate-y-0'}`}>

      <style>{SEL_CSS}</style>
      {/* 上方沒有黑色遮罩：照片捲上去會一路滑到螢幕最上面，沒有模糊漸層。
          44pt 的圓鈕浮在照片上面，貼著狀態列下緣、靠右 20pt */}
      <header className="absolute left-0 right-0 top-0 z-20 pr-5 pl-5 flex justify-end items-start pointer-events-none" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button ref={selectRef} onClick={() => { setSelecting(v => !v); setSelected(new Set()); }} disabled={!photos.length}
          aria-label={selecting ? '取消選取' : '選取照片'}
          className={`pointer-events-auto w-11 h-11 rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-center disabled:opacity-30 ${hideWeb}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {selecting ? <path d="M6.5 6.5l11 11m0-11-11 11" /> : <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="m8 12.3 2.8 2.8L16.2 9" /></>}
          </svg>
        </button>
      </header>
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto no-scrollbar" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 54px)', paddingBottom: `calc(max(env(safe-area-inset-bottom), 16px) + ${BACK_CIRCLE + 56}px)` }}>
        {photos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-40">
            <Icon name="no_photography" className="text-6xl mb-4" />
            <p>尚未拍攝或導入任何照片</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-[2px]">
            {shown.map((src, idx) => {
              const order = selecting ? [...selected].indexOf(idx) + 1 : 0;
              const on = order > 0;
              return (
                <button key={src} data-cg-idx={idx} onClick={() => tapPhoto(idx)} aria-label={`照片 ${idx + 1}`}
                  className={`cg-cell${on ? ' sel' : ''} relative aspect-square overflow-hidden bg-white/10`}>
                  {thumbs[src] && <img src={thumbs[src]} decoding="async" alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />}
                  <span className="ring" />
                  {rawShots?.has(src) && (
                    <span className="absolute left-1 bottom-1 px-1.5 py-[2px] rounded-[5px] bg-black/55 backdrop-blur-md text-[9px] font-bold tracking-[0.06em] text-white/90 pointer-events-none">RAW</span>
                  )}
                  {favorites?.has(src) && (
                    <span className="absolute left-2 top-2 pointer-events-none drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 21.1 10.6 20C5.1 15.5 2 12.8 2 9.3 2 6.4 4.3 4 7.2 4c1.8 0 3.6.9 4.8 2.3C13.2 4.9 15 4 16.8 4 19.7 4 22 6.4 22 9.3c0 3.5-3.1 6.2-8.6 10.7L12 21.1Z" /></svg></span>
                  )}
                  {selecting && (
                    <span className="absolute top-1.5 right-1.5 w-[22px] h-[22px] rounded-full flex items-center justify-center pointer-events-none"
                      style={on
                        ? { background: '#fff', color: '#000', animation: 'cg-pop .18s ease-out', boxShadow: '0 1px 4px rgba(0,0,0,.35)' }
                        : { border: '1.5px solid rgba(255,255,255,.9)', background: 'rgba(0,0,0,.18)', boxShadow: '0 0 2px rgba(0,0,0,.4)' }}>
                      {on && <span className="text-[12px] font-black leading-none">{order}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 下面回相機；選取時換成整批操作按鈕。 */}
      {/* 多選時的膠囊比回相機鈕低：跟螢幕底部的空隙只留一半 */}
      <div className="absolute left-0 right-0 flex items-center justify-between px-6 pointer-events-none" style={{ bottom: selecting ? 'calc(max(env(safe-area-inset-bottom), 16px) / 2 + 15px)' : 'calc(max(env(safe-area-inset-bottom), 16px) + 36px)', height: BACK_CIRCLE }}>
        {!selecting ? (
          <>
            <button ref={backRef} aria-label="回相機" onClick={close} className={`pointer-events-auto ${webCircle} ${hideWeb}`} style={{ width: BACK_CIRCLE, height: BACK_CIRCLE }}>
              <Icon name="photo_camera" className="text-[25px] text-white" />
            </button>
          </>
        ) : (
          <div ref={actionsRef} className={`pointer-events-auto mx-auto h-[48px] w-[248px] rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-around px-2 ${hideWeb}`}>
            {([['fav', favAll ? 'favorite' : 'favorite_border', () => toggleFav(selectedIdx)],
               ['share', 'ios_share', () => void share(selectedIdx)],
               ['edit', 'tune', editSelected],
               ['delete', 'delete', () => remove(selectedIdx)]] as const).map(([id, icon, fn]) => (
              <button key={id} onClick={fn} disabled={!selectedIdx.length} className="w-12 h-12 flex items-center justify-center disabled:opacity-30 active:scale-90 transition-transform">
                <Icon name={icon} className="text-[22px] text-white" />
              </button>
            ))}
          </div>
        )}
      </div>

      {viewer !== null && shown[viewer] && (
        <PhotoViewer
          photos={shown} thumbs={thumbs} index={viewer} closing={closingViewer} suspended={suspended} rawShots={rawShots}
          onIndex={setViewer}
          onClose={() => { setClosingViewer(true); window.setTimeout(() => { setViewer(null); setClosingViewer(false); }, 310); }}
          onDismissed={() => setViewer(null)}
          cellOf={i => scrollRef.current?.querySelector<HTMLElement>(`[data-cg-idx="${i}"]`) ?? null}
          favorites={favorites}
          labelOf={labelOf}
          onShare={i => void share([i])}
          onProEdit={i => (onProEdit ?? onEdit)(shown[i], orig(i))}
          onEdit={i => onEdit(shown[i], orig(i))}
          onFavorite={i => toggleFav([i])}
          onDelete={i => remove([i])}
        />
      )}
    </div>,
    document.body,
  );
};

/* ── 大圖 ───────────────────────────────────────────────────────────
 * 整個螢幕黑底（狀態列收起來）、照片置中，左右滑換張、往下滑關閉。
 * 下面：分享（圓）｜RAW 沖洗、編輯、愛心（膠囊）｜刪除（圓），貼近螢幕底部、左右對稱。右上：濾鏡標籤。
 * 掛在 body 上：相機頁（.safe-top）從狀態列下面才開始，放在裡面的話蓋不到最上面那一條。 */
const PhotoViewer: React.FC<{
  photos: string[]; thumbs: Record<string, string>; index: number; closing: boolean; suspended?: boolean; rawShots?: Set<string>;
  onIndex: (i: number) => void; onClose: () => void;
  /** 下滑關閉：圖已經飛回格子裡了，直接拿掉大圖 */
  onDismissed: () => void;
  /** 相簿裡這一張的格子（飛回去的目標） */
  cellOf: (i: number) => HTMLElement | null;
  favorites?: Set<string>; labelOf?: (src: string) => string | null;
  onShare: (i: number) => void; onProEdit: (i: number) => void; onEdit: (i: number) => void;
  onFavorite: (i: number) => void; onDelete: (i: number) => void;
}> = ({ photos, thumbs, index, closing, suspended = false, rawShots, onIndex, onClose, onDismissed, cellOf, favorites, labelOf, onShare, onProEdit, onEdit, onFavorite, onDelete }) => {
  const pager = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  /* 下滑關閉：只動那一張圖（不動整頁，所以不會抖）。base＝圖沒變形時的位置 */
  const drag = useRef<{ x: number; y: number; active: boolean; id: number; img?: HTMLImageElement | null; base?: DOMRect; dx: number; dy: number; s: number; t0: number; vy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState(false);
  /* 打開：相簿裡的小圖放大到大圖的位置（除了圖都是黑的），就定位後才出現按鈕、換成原圖 */
  const [opening, setOpening] = useState(true);
  const ghost = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const cell = cellOf(index), g = ghost.current, src = photos[index];
    const tsrc = thumbs[src] || src;
    if (!cell || !g) { setOpening(false); return; }
    let alive = true;
    const cellImg = cell.querySelector('img') as HTMLImageElement | null;
    /* 畫質：原圖很快就能解好（相機剛拍的、已經快取的）就直接用原圖飛；來不及才先用小縮圖，落地後再柔和地換成原圖 */
    const im = new Image(); im.src = tsrc;
    const full = new Image(); full.src = src;
    const fullReady = full.decode().then(() => true, () => false);
    const go = async () => {
      const useFull = await Promise.race([fullReady, new Promise<boolean>(r => setTimeout(() => r(false), 220))]);
      if (!alive) return;
      const pic = useFull ? full : im;
      const W = window.innerWidth, H = window.innerHeight;
      const ar = (pic.naturalWidth && pic.naturalHeight) ? pic.naturalWidth / pic.naturalHeight : (im.naturalWidth / Math.max(1, im.naturalHeight)) || 1;
      let w = W, h = W / ar; if (h > H) { h = H; w = H * ar; }
      const B = { left: (W - w) / 2, top: (H - h) / 2, width: w, height: h };
      g.src = useFull ? src : tsrc;
      Object.assign(g.style, { left: `${B.left}px`, top: `${B.top}px`, width: `${w}px`, height: `${h}px`, visibility: 'visible', opacity: '1' });
      const C = cell.getBoundingClientRect();
      const k = Math.max(C.width / w, C.height / h);
      const ix = Math.max(0, (w - C.width / k) / 2), iy = Math.max(0, (h - C.height / k) / 2);
      const tx = C.left + C.width / 2 - (B.left + w / 2), ty = C.top + C.height / 2 - (B.top + h / 2);
      if (cellImg) cellImg.style.visibility = 'hidden';
      const dur = 420;
      bg.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur * 0.7, easing: 'ease-out' });
      await g.animate([{ transform: `translate3d(${tx}px,${ty}px,0) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` }, { transform: 'none', clipPath: 'inset(0px)' }],
        { duration: dur, easing: EASE }).finished.catch(() => {});
      if (cellImg) cellImg.style.visibility = '';
      if (!alive) return;
      /* 落地：底下的大圖（原圖）解好才露出來，替身再用 0.22 秒淡掉 —— 沒有閃一下，畫質是慢慢變清楚 */
      await fullReady;
      const pageImg = curImg();
      await pageImg?.decode?.().catch(() => {});
      if (!alive) return;
      setOpening(false);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!alive || !ghost.current) return;
      await ghost.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
      if (alive && ghost.current) ghost.current.style.visibility = 'hidden';
    };
    im.decode().then(go, go);
    return () => { alive = false; if (cellImg) cellImg.style.visibility = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const EASE = 'cubic-bezier(0.32,0.72,0,1)';
  const curImg = () => pager.current?.children[index]?.querySelector('img') as HTMLImageElement | null;
  const dragScale = (dy: number) => 1 - 0.38 * Math.min(1, Math.max(0, dy) / (window.innerHeight * 0.55));
  const startDrag = (d: NonNullable<typeof drag.current>) => {
    d.active = true;
    d.img = curImg();
    if (d.img) { d.img.style.transform = ''; d.base = d.img.getBoundingClientRect(); d.img.style.willChange = 'transform'; }
    if (pager.current) pager.current.style.overflowX = 'hidden';
    setDragging(true);
  };
  const moveDrag = (d: NonNullable<typeof drag.current>, dx: number, dy: number) => {
    const now = performance.now();
    d.vy = (dy - d.dy) / Math.max(1, now - d.t0); d.t0 = now;
    d.dx = dx; d.dy = dy < 0 ? dy * 0.3 : dy; d.s = dragScale(dy);
    if (d.img) d.img.style.transform = `translate3d(${d.dx}px,${d.dy}px,0) scale(${d.s})`;
  };
  const endDrag = (d: NonNullable<typeof drag.current>, cancel: boolean) => {
    const img = d.img;
    const v = performance.now() - d.t0 > 120 ? 0 : d.vy;   // 停住一下才放手＝沒有甩
    const dismiss = !cancel && (d.dy > 110 || (d.dy > 40 && v > 0.5));
    const cell = dismiss ? cellOf(index) : null;
    if (!img || !d.base) { if (dismiss) onClose(); else { setDragging(false); if (pager.current) pager.current.style.overflowX = ''; } return; }
    const from = { transform: img.style.transform || 'none', clipPath: 'inset(0px)' };
    if (!dismiss) {
      img.animate([from, { transform: 'translate3d(0,0,0) scale(1)', clipPath: 'inset(0px)' }], { duration: 320, easing: EASE }).finished.then(() => {
        img.style.transform = ''; img.style.willChange = '';
        if (pager.current) pager.current.style.overflowX = '';
        setDragging(false);
      }).catch(() => {});
      return;
    }
    /* 鬆手：縮小的圖飛回相簿裡這一張的格子（裁成正方形），黑底同時淡掉、露出相簿 */
    setFlying(true);
    cell?.scrollIntoView({ block: 'nearest' });
    const B = d.base, C = cell?.getBoundingClientRect();
    const cellImg = cell?.querySelector('img') as HTMLImageElement | null;
    if (cellImg) cellImg.style.visibility = 'hidden';
    let to: Keyframe;
    if (C && C.width > 0) {
      const k = Math.max(C.width / B.width, C.height / B.height);
      const ix = Math.max(0, (B.width - C.width / k) / 2), iy = Math.max(0, (B.height - C.height / k) / 2);
      const tx = C.left + C.width / 2 - (B.left + B.width / 2), ty = C.top + C.height / 2 - (B.top + B.height / 2);
      to = { transform: `translate3d(${tx}px,${ty}px,0) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` };
    } else to = { transform: `translate3d(${d.dx}px,${window.innerHeight}px,0) scale(${d.s * 0.8})`, clipPath: 'inset(0px)', opacity: 0 };
    const dur = 420;
    bg.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.85, easing: 'ease-out', fill: 'forwards' });
    img.animate([from, to], { duration: dur, easing: EASE, fill: 'forwards' }).finished.catch(() => {}).finally(() => {
      if (cellImg) cellImg.style.visibility = '';
      onDismissed();
    });
  };
  const shareRef = useRef<HTMLButtonElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const delRef = useRef<HTMLButtonElement>(null);
  /* 打開時直接停在點到的那一張（不要從第一張滑過去） */
  useEffect(() => {
    const el = pager.current; if (!el) return;
    el.scrollLeft = index * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    const el = pager.current; if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== index && i >= 0 && i < photos.length) onIndex(i);
  };
  const src = photos[index];
  const isRaw = !!rawShots?.has(src);
  const fav = !!favorites?.has(src);
  const label = labelOf?.(src) ?? null;
  /* 看大圖時收起狀態列；進編輯（suspended）、關掉時放回來 */
  const barHidden = !closing && !suspended;
  useEffect(() => { void setStatusBarHidden(barHidden); }, [barHidden]);
  useEffect(() => () => { void setStatusBarHidden(false); }, []);
  const glass = useNativeGlass('camera-viewer', !closing && !suspended && !dragging && !opening, () => [
    { kind: 'circle', id: 'share', symbol: 'square.and.arrow.up', pointSize: 21, el: shareRef.current },
    { kind: 'capsule', el: midRef.current, pad: 0, buttons: [
      ...(isRaw ? [{ id: 'pro', symbol: 'abai.film', pointSize: 21 }] : []),
      { id: 'edit', symbol: 'slider.horizontal.3', pointSize: 21 },
      { id: 'fav', symbol: fav ? 'heart.fill' : 'heart', tint: 'white', pointSize: 21 },
    ] },
    { kind: 'circle', id: 'delete', symbol: 'trash', pointSize: 21, el: delRef.current },
  ], id => {
    if (id === 'share') onShare(index);
    else if (id === 'pro') onProEdit(index);
    else if (id === 'edit') onEdit(index);
    else if (id === 'fav') onFavorite(index);
    else if (id === 'delete') onDelete(index);
  }, [index, fav, isRaw], 240);
  const hideWeb = glass.native ? 'invisible' : '';
  const webCircle = 'rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-center active:scale-90 transition-transform';

  return createPortal(
    <div ref={root} data-camera-viewer className={`fixed inset-0 z-[60] text-white select-none transition-opacity duration-[300ms] ${closing ? 'opacity-0' : ''}`}>
      <div ref={bg} className="absolute inset-0 bg-black pointer-events-none" />
      <img ref={ghost} alt="" aria-hidden className="fixed z-[5] pointer-events-none object-contain" style={{ visibility: 'hidden', transformOrigin: 'center', willChange: 'transform' }} />
      <div ref={pager} onScroll={onScroll} className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        style={{ touchAction: 'pan-x', opacity: opening ? 0 : 1 }}
        onPointerDown={e => {
          if (e.pointerType !== 'touch' || drag.current || flying) return;
          drag.current = { x: e.clientX, y: e.clientY, active: false, id: e.pointerId, dx: 0, dy: 0, s: 1, t0: performance.now(), vy: 0 };
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.active) {
            if (dy > 10 && dy > Math.abs(dx) * 1.2) { startDrag(d); d.x = e.clientX; d.y = e.clientY - 1; }
            else return;
          }
          moveDrag(d, e.clientX - d.x, e.clientY - d.y);
        }}
        onPointerUp={e => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          if (d.active) endDrag(d, false);
        }}
        onPointerCancel={e => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          if (d.active) endDrag(d, true);
        }}>
        {photos.map((p, i) => (
          <div key={p} className="w-full h-full shrink-0 snap-center flex items-center justify-center" style={{ scrollSnapStop: 'always' }}>
            {/* 一律撐滿整塊、照比例縮放：小縮圖也是一樣大（之前縮圖照原尺寸顯示，從編輯回來時會突然變很小） */}
            {!suspended && Math.abs(i - index) <= 1
              ? <img src={p} alt="" className="w-full h-full object-contain allow-callout" draggable={false} />
              : thumbs[p] ? <img src={thumbs[p]} alt="" className="w-full h-full object-contain" draggable={false} /> : null}
          </div>
        ))}
      </div>
      {/* 拖的時候畫面上只有圖：標籤、按鈕都收起來 */}
      {label && !dragging && !opening && (
        <span className="absolute right-6 h-[26px] px-[9px] rounded-full bg-white/[0.14] backdrop-blur-xl flex items-center text-white text-[13px] font-bold tracking-[0.03em] leading-none pointer-events-none"
          style={{ top: 'max(calc(env(safe-area-inset-top) - 22px), 10px)' }}>#{label}</span>
      )}
      <div className={`absolute left-0 right-0 flex items-center justify-between px-[34px] transition-opacity duration-200 ${dragging || opening ? 'opacity-0 pointer-events-none' : ''}`} style={{ bottom: 'max(calc(env(safe-area-inset-bottom) - 5px), 14px)', height: CIRCLE }}>
        <button ref={shareRef} aria-label="分享" onClick={() => onShare(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="ios_share" className="text-[23px] text-white" />
        </button>
        <div ref={midRef} className={`h-full ${isRaw ? 'w-[166px]' : 'w-[118px]'} rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-around px-0 ${hideWeb}`}>
          {isRaw && <button aria-label="RAW 沖洗" onClick={() => onProEdit(index)} className="w-10 h-10 flex items-center justify-center text-white active:opacity-65"><RawEditIcon size={25} /></button>}
          <button aria-label="編輯" onClick={() => onEdit(index)} className="w-10 h-10 flex items-center justify-center active:opacity-65"><Icon name="tune" className="text-[23px] text-white" /></button>
          <button aria-label="愛心" onClick={() => onFavorite(index)} className="w-10 h-10 flex items-center justify-center active:opacity-65"><Icon name={fav ? 'favorite' : 'favorite_border'} className="text-[23px] text-white" /></button>
        </div>
        <button ref={delRef} aria-label="刪除" onClick={() => onDelete(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="delete" className="text-[23px] text-white" />
        </button>
      </div>
    </div>,
    document.body,
  );
};
