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
const CIRCLE = 46;

/** RAW 沖洗圖示：一格底片（上下兩排齒孔）。App 裡用的是同造型的 SF Symbol「film」 */
const RawEditIcon: React.FC<{ size?: number }> = ({ size = 21 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
    <path d="M3 8.5h18M3 15.5h18M7.5 4.5v4M12 4.5v4M16.5 4.5v4M7.5 15.5v4M12 15.5v4M16.5 15.5v4" />
  </svg>
);

/* 選取的樣子跟其他功能導入照片（NativeGallery）一樣：照片縮小、白框、右上角照點的順序標號碼 */
const SEL_CSS = `
@keyframes cg-pop { from { transform: scale(.86); opacity: 0 } to { transform: scale(1); opacity: 1 } }
.cg-cell img { transition: transform .32s cubic-bezier(0.32,0.72,0,1); }
.cg-cell.sel img { transform: scale(.9); }
.cg-cell .ring { position: absolute; inset: 0; border: 2px solid #fff; opacity: 0; transition: opacity .2s ease; pointer-events: none; }
.cg-cell.sel .ring { opacity: 1 }
`;

export const GalleryOverlay: React.FC<GalleryOverlayProps> = ({
  photos, thumbs = {}, onClose, onDelete, onEdit, onProEdit, onEditMany, rawShots, suspended = false, favorites, onFavorite, labelOf,
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

  return (
    <div data-camera-gallery
      className={`fixed inset-0 bg-black z-50 flex flex-col transition-transform duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${closing || !entered ? 'translate-y-full' : 'translate-y-0'}`}>
      {/* 相機頁（.safe-top）已經從狀態列下面開始，這裡不再多留一次安全區域：
          44pt 的圓鈕貼著狀態列下緣、靠右 20pt，下面留 10pt 就是照片 */}
      <header className="shrink-0 pr-5 pl-5 pb-[10px] flex justify-end items-start">
        <button ref={selectRef} onClick={() => { setSelecting(v => !v); setSelected(new Set()); }} disabled={!photos.length}
          aria-label={selecting ? '取消選取' : '選取照片'}
          className={`w-11 h-11 rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-center disabled:opacity-30 ${hideWeb}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {selecting ? <path d="M6.5 6.5l11 11m0-11-11 11" /> : <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="m8 12.3 2.8 2.8L16.2 9" /></>}
          </svg>
        </button>
      </header>

      <style>{SEL_CSS}</style>
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar" style={{ paddingBottom: `calc(max(env(safe-area-inset-bottom), 16px) + ${BACK_CIRCLE + 56}px)` }}>
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
                <button key={src} onClick={() => tapPhoto(idx)} aria-label={`照片 ${idx + 1}`}
                  className={`cg-cell${on ? ' sel' : ''} relative aspect-square overflow-hidden bg-white/10 active:opacity-80`}>
                  {thumbs[src] && <img src={thumbs[src]} decoding="async" alt="" className="w-full h-full object-cover" />}
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
      <div className="absolute left-0 right-0 flex items-center justify-between px-6 pointer-events-none" style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 36px)', height: BACK_CIRCLE }}>
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
          favorites={favorites}
          labelOf={labelOf}
          onShare={i => void share([i])}
          onProEdit={i => (onProEdit ?? onEdit)(shown[i], orig(i))}
          onEdit={i => onEdit(shown[i], orig(i))}
          onFavorite={i => toggleFav([i])}
          onDelete={i => remove([i])}
        />
      )}
    </div>
  );
};

/* ── 大圖 ───────────────────────────────────────────────────────────
 * 整個螢幕黑底（狀態列收起來）、照片置中，左右滑換張、往下滑關閉。
 * 下面：分享（圓）｜RAW 沖洗、編輯、愛心（膠囊）｜刪除（圓），貼近螢幕底部、左右對稱。右上：濾鏡標籤。
 * 掛在 body 上：相機頁（.safe-top）從狀態列下面才開始，放在裡面的話蓋不到最上面那一條。 */
const PhotoViewer: React.FC<{
  photos: string[]; thumbs: Record<string, string>; index: number; closing: boolean; suspended?: boolean; rawShots?: Set<string>;
  onIndex: (i: number) => void; onClose: () => void;
  favorites?: Set<string>; labelOf?: (src: string) => string | null;
  onShare: (i: number) => void; onProEdit: (i: number) => void; onEdit: (i: number) => void;
  onFavorite: (i: number) => void; onDelete: (i: number) => void;
}> = ({ photos, thumbs, index, closing, suspended = false, rawShots, onIndex, onClose, favorites, labelOf, onShare, onProEdit, onEdit, onFavorite, onDelete }) => {
  const pager = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
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
  const glass = useNativeGlass('camera-viewer', !closing && !suspended && !dragging, () => [
    { kind: 'circle', id: 'share', symbol: 'square.and.arrow.up', pointSize: 17, el: shareRef.current },
    { kind: 'capsule', el: midRef.current, pad: 0, buttons: [
      ...(isRaw ? [{ id: 'pro', symbol: 'film', pointSize: 17 }] : []),
      { id: 'edit', symbol: 'slider.horizontal.3', pointSize: 17 },
      { id: 'fav', symbol: fav ? 'heart.fill' : 'heart', tint: 'white', pointSize: 17 },
    ] },
    { kind: 'circle', id: 'delete', symbol: 'trash', pointSize: 17, el: delRef.current },
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
    <div ref={root} data-camera-viewer className={`fixed inset-0 z-[60] bg-black text-white select-none transition-[transform,opacity] duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${closing ? 'translate-y-full opacity-0' : 'animate-in fade-in duration-300'}`}>
      <div ref={pager} onScroll={onScroll} className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        style={{ touchAction: 'pan-x' }}
        onPointerDown={e => { if (e.pointerType === 'touch') drag.current = { x: e.clientX, y: e.clientY, active: false }; }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.active && dy > 12 && dy > Math.abs(dx) * 1.2) { d.active = true; setDragging(true); }
          if (d.active && root.current) root.current.style.transform = `translate3d(0,${Math.max(0, dy)}px,0)`;
        }}
        onPointerUp={e => {
          const d = drag.current; drag.current = null;
          if (!d?.active) return;
          if (e.clientY - d.y > 95) { if (root.current) root.current.style.transform = 'translate3d(0,100%,0)'; onClose(); }
          else { if (root.current) root.current.style.transform = ''; setDragging(false); }
        }}
        onPointerCancel={() => { drag.current = null; if (root.current) root.current.style.transform = ''; setDragging(false); }}>
        {photos.map((p, i) => (
          <div key={p} className="w-full h-full shrink-0 snap-center flex items-center justify-center" style={{ scrollSnapStop: 'always' }}>
            {!suspended && Math.abs(i - index) <= 1
              ? <img src={p} alt="" className="max-w-full max-h-full object-contain allow-callout" draggable={false} />
              : thumbs[p] ? <img src={thumbs[p]} alt="" className="max-w-full max-h-full object-contain" /> : null}
          </div>
        ))}
      </div>
      {label && (
        <span className="absolute right-6 h-[26px] px-[9px] rounded-full bg-white/[0.14] backdrop-blur-xl flex items-center text-white text-[13px] font-bold tracking-[0.03em] leading-none pointer-events-none"
          style={{ top: 'max(calc(env(safe-area-inset-top) - 22px), 10px)' }}>#{label}</span>
      )}
      <div className="absolute left-0 right-0 flex items-center justify-between px-[34px]" style={{ bottom: 'max(calc(env(safe-area-inset-bottom) - 5px), 14px)', height: CIRCLE }}>
        <button ref={shareRef} aria-label="分享" onClick={() => onShare(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="ios_share" className="text-[19px] text-white" />
        </button>
        <div ref={midRef} className={`h-full ${isRaw ? 'w-[157px]' : 'w-[112px]'} rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-around px-0 ${hideWeb}`}>
          {isRaw && <button aria-label="RAW 沖洗" onClick={() => onProEdit(index)} className="w-10 h-10 flex items-center justify-center text-white active:opacity-65"><RawEditIcon size={19} /></button>}
          <button aria-label="編輯" onClick={() => onEdit(index)} className="w-10 h-10 flex items-center justify-center active:opacity-65"><Icon name="tune" className="text-[19px] text-white" /></button>
          <button aria-label="愛心" onClick={() => onFavorite(index)} className="w-10 h-10 flex items-center justify-center active:opacity-65"><Icon name={fav ? 'favorite' : 'favorite_border'} className="text-[19px] text-white" /></button>
        </div>
        <button ref={delRef} aria-label="刪除" onClick={() => onDelete(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="delete" className="text-[19px] text-white" />
        </button>
      </div>
    </div>,
    document.body,
  );
};
