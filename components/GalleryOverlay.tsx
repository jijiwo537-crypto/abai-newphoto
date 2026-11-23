import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { prepareFiles, shareSheet } from '../utils/shareAll';
import { useNativeGlass } from '../utils/nativeGlass';
import { haptic } from '../utils/haptics';

/* ── 相機的相簿 ───────────────────────────────────────────────────────
 * 格狀列表：右上勾選鈕 → 點照片勾選 → 下面一條按鈕：愛心、分享、編輯、刪除。
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

const CIRCLE = 48;

/** 沖洗圖示：三條對稱調節線，沒有角落裝飾線。 */
const RawEditIcon: React.FC<{ size?: number }> = ({ size = 21 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" />
    <circle cx="9" cy="7.5" r="2" fill="#151515" />
    <circle cx="15" cy="12" r="2" fill="#151515" />
    <circle cx="10.5" cy="16.5" r="2" fill="#151515" />
  </svg>
);

export const GalleryOverlay: React.FC<GalleryOverlayProps> = ({
  photos, thumbs = {}, onClose, onDelete, onEdit, onProEdit, onEditMany, rawShots, suspended = false, favorites, onFavorite, labelOf,
}) => {
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
    const urls = idx.map(i => photos[i]).filter(Boolean);
    if (!urls.length) return;
    const files = await prepareFiles(urls, 'abai');
    await shareSheet(files);
  };
  const remove = (idx: number[]) => {
    if (!idx.length) return;
    if (!window.confirm(idx.length > 1 ? `刪除這 ${idx.length} 張照片？` : '刪除這張照片？')) return;
    haptic('press');
    onDelete(idx);
    setSelected(new Set());
    if (idx.length > 1 || photos.length <= 1) setSelecting(false);
  };
  const toggleFav = (idx: number[]) => {
    const srcs = idx.map(i => photos[i]).filter(Boolean);
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
  const favAll = selectedIdx.length > 0 && selectedIdx.every(i => favorites?.has(photos[i]));
  const grid = useNativeGlass('camera-gallery', !closing && !suspended && viewer === null, () => [
    { kind: 'circle', shape: 'roundedSquare', id: 'select', el: selectRef.current, symbol: selecting ? 'xmark' : 'checkmark', enabled: photos.length > 0 },
    ...(selecting ? [
      { kind: 'capsule' as const, el: actionsRef.current, buttons: [
        { id: 'fav', symbol: favAll ? 'heart.fill' : 'heart', tint: 'white' as const, enabled: selectedIdx.length > 0 },
        { id: 'share', symbol: 'square.and.arrow.up', enabled: selectedIdx.length > 0 },
        { id: 'edit', symbol: 'slider.horizontal.3', enabled: selectedIdx.length > 0 },
        { id: 'delete', symbol: 'trash', enabled: selectedIdx.length > 0 },
      ] },
    ] : [
      { kind: 'circle' as const, id: 'back', symbol: 'camera', el: backRef.current },
    ]),
  ], id => {
    if (id === 'select') { setSelecting(v => !v); setSelected(new Set()); }
    else if (id === 'back') close();
    else if (id === 'fav') toggleFav(selectedIdx);
    else if (id === 'share') void share(selectedIdx);
    else if (id === 'edit') { if (selectedIdx.length) onEditMany ? onEditMany(selectedIdx) : onEdit(photos[selectedIdx[0]], selectedIdx[0]); }
    else if (id === 'delete') remove(selectedIdx);
  }, [selecting, selectedIdx.join(','), favAll, photos.length], 420);
  const hideWeb = grid.native ? 'invisible' : '';

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
      <header className="px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2 h-[calc(max(env(safe-area-inset-top),12px)+48px)] flex justify-end items-center">
        <button ref={selectRef} onClick={() => { setSelecting(v => !v); setSelected(new Set()); }} disabled={!photos.length}
          aria-label={selecting ? '取消選取' : '選取照片'}
          className={`w-9 h-9 rounded-[11px] bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-center disabled:opacity-30 ${hideWeb}`}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {selecting ? <path d="M5.5 5.5l13 13m0-13-13 13" /> : <path d="m4.5 12.5 5 5 10-11" />}
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pb-28">
        {photos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-40">
            <Icon name="no_photography" className="text-6xl mb-4" />
            <p>尚未拍攝或導入任何照片</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-[2px]">
            {photos.map((src, idx) => {
              const on = selected.has(idx);
              return (
                <button key={src} onClick={() => tapPhoto(idx)} aria-label={`照片 ${idx + 1}`}
                  className="relative aspect-square overflow-hidden bg-white/10 active:opacity-80">
                  {thumbs[src] && <img src={thumbs[src]} decoding="async" alt="" className={`w-full h-full object-cover transition-transform duration-200 ${on ? 'scale-[0.92] rounded-[6px]' : ''}`} />}
                  {rawShots?.has(src) && (
                    <span className="absolute left-1 bottom-1 px-1.5 py-[2px] rounded-[5px] bg-black/55 backdrop-blur-md text-[9px] font-bold tracking-[0.06em] text-white/90 pointer-events-none">RAW</span>
                  )}
                  {favorites?.has(src) && (
                    <span className="absolute left-2 top-2 pointer-events-none drop-shadow-[0_1px_3px_rgba(0,0,0,.6)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 21.1 10.6 20C5.1 15.5 2 12.8 2 9.3 2 6.4 4.3 4 7.2 4c1.8 0 3.6.9 4.8 2.3C13.2 4.9 15 4 16.8 4 19.7 4 22 6.4 22 9.3c0 3.5-3.1 6.2-8.6 10.7L12 21.1Z" /></svg></span>
                  )}
                  {selecting && (
                    <span className={`absolute right-1.5 bottom-1.5 w-[22px] h-[22px] rounded-full border-[1.5px] flex items-center justify-center pointer-events-none ${on ? 'bg-[#0a84ff] border-white' : 'border-white/90 bg-black/20'}`}>
                      {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 下面回相機；選取時換成整批操作按鈕。 */}
      <div className="absolute left-0 right-0 flex items-center justify-between px-6 pointer-events-none" style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 30px)', height: CIRCLE }}>
        {!selecting ? (
          <>
            <button ref={backRef} aria-label="回相機" onClick={close} className={`pointer-events-auto ${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
              <Icon name="photo_camera" className="text-[22px] text-white" />
            </button>
          </>
        ) : (
          <div ref={actionsRef} className={`pointer-events-auto mx-auto h-full w-[248px] rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-around px-2 ${hideWeb}`}>
            {([['fav', favAll ? 'favorite' : 'favorite_border', () => toggleFav(selectedIdx)],
               ['share', 'ios_share', () => void share(selectedIdx)],
               ['edit', 'tune', () => { if (selectedIdx.length) onEditMany ? onEditMany(selectedIdx) : onEdit(photos[selectedIdx[0]], selectedIdx[0]); }],
               ['delete', 'delete', () => remove(selectedIdx)]] as const).map(([id, icon, fn]) => (
              <button key={id} onClick={fn} disabled={!selectedIdx.length} className="w-12 h-12 flex items-center justify-center disabled:opacity-30 active:scale-90 transition-transform">
                <Icon name={icon} className="text-[22px] text-white" />
              </button>
            ))}
          </div>
        )}
      </div>

      {viewer !== null && photos[viewer] && (
        <PhotoViewer
          photos={photos} thumbs={thumbs} index={viewer} closing={closingViewer} suspended={suspended} rawShots={rawShots}
          onIndex={setViewer}
          onClose={() => { setClosingViewer(true); window.setTimeout(() => { setViewer(null); setClosingViewer(false); }, 310); }}
          favorites={favorites}
          labelOf={labelOf}
          onShare={i => void share([i])}
          onProEdit={i => (onProEdit ?? onEdit)(photos[i], i)}
          onEdit={i => onEdit(photos[i], i)}
          onFavorite={i => toggleFav([i])}
          onDelete={i => remove([i])}
        />
      )}
    </div>
  );
};

/* ── 大圖 ───────────────────────────────────────────────────────────
 * 黑底、照片置中，左右滑換張。下面：分享（圓）｜專業編輯、編輯、愛心（膠囊）｜刪除（圓）。右上：濾鏡標籤 */
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
  const glass = useNativeGlass('camera-viewer', !closing && !suspended && !dragging, () => [
    { kind: 'circle', id: 'share', symbol: 'square.and.arrow.up', el: shareRef.current },
    { kind: 'capsule', el: midRef.current, buttons: [
      ...(isRaw ? [{ id: 'pro', symbol: 'abai.raw' }] : []),
      { id: 'edit', symbol: 'slider.horizontal.3' },
      { id: 'fav', symbol: fav ? 'heart.fill' : 'heart', tint: 'white' },
    ] },
    { kind: 'circle', id: 'delete', symbol: 'trash', el: delRef.current },
  ], id => {
    if (id === 'share') onShare(index);
    else if (id === 'pro') onProEdit(index);
    else if (id === 'edit') onEdit(index);
    else if (id === 'fav') onFavorite(index);
    else if (id === 'delete') onDelete(index);
  }, [index, fav, isRaw], 240);
  const hideWeb = glass.native ? 'invisible' : '';
  const webCircle = 'rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-center active:scale-90 transition-transform';

  return (
    <div ref={root} data-camera-viewer className={`fixed inset-0 z-[60] bg-black transition-[transform,opacity] duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${closing ? 'translate-y-full opacity-0' : 'animate-in fade-in duration-300'}`}>
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
      <button aria-label="關閉" onClick={onClose}
        className="absolute left-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center active:scale-90 transition-transform"
        style={{ top: 'calc(max(env(safe-area-inset-top), 12px) - 2px)' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {label && (
        <span className="absolute right-4 h-10 px-4 rounded-full bg-white/10 backdrop-blur-xl flex items-center text-[15px] font-bold tracking-[0.04em] pointer-events-none"
          style={{ top: 'calc(max(env(safe-area-inset-top), 12px) - 2px)' }}>#{label}</span>
      )}
      <div className="absolute left-0 right-0 flex items-center justify-between px-6" style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 18px)', height: CIRCLE }}>
        <button ref={shareRef} aria-label="分享" onClick={() => onShare(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="ios_share" className="text-[21px] text-white" />
        </button>
        <div ref={midRef} className={`h-full ${isRaw ? 'w-[150px]' : 'w-[106px]'} rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-around px-1 ${hideWeb}`}>
          {isRaw && <button aria-label="RAW 編輯" onClick={() => onProEdit(index)} className="w-11 h-11 flex items-center justify-center text-white active:opacity-65"><RawEditIcon /></button>}
          <button aria-label="編輯" onClick={() => onEdit(index)} className="w-11 h-11 flex items-center justify-center active:opacity-65"><Icon name="tune" className="text-[21px] text-white" /></button>
          <button aria-label="愛心" onClick={() => onFavorite(index)} className="w-11 h-11 flex items-center justify-center active:opacity-65"><Icon name={fav ? 'favorite' : 'favorite_border'} className="text-[21px] text-white" /></button>
        </div>
        <button ref={delRef} aria-label="刪除" onClick={() => onDelete(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="delete" className="text-[21px] text-white" />
        </button>
      </div>
    </div>
  );
};
