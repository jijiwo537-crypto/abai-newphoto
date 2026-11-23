import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { processImageFile } from '../utils/imageLoader';
import { RAW_ACCEPT } from '../utils/fileTypes';
import { isNative } from '../utils/native';
import { pickNativeFiles } from '../utils/nativePhotos';
import { prepareFiles, shareSheet } from '../utils/shareAll';
import { useNativeGlass } from '../utils/nativeGlass';
import { haptic } from '../utils/haptics';

/* ── 相機的相簿 ───────────────────────────────────────────────────────
 * 格狀列表：右上「選取」→ 點照片勾選 → 下面一條按鈕：愛心、分享、編輯、刪除（一次處理選到的全部）。
 * 左下圓鈕＝回相機（整頁往下滑走），右下圓鈕＝加照片。
 * 點一張照片：全螢幕看大圖（左右滑換張），下面：分享｜專業編輯、編輯、愛心｜刪除。
 * App 裡這些按鈕都是原生的液態玻璃按鈕（見 utils/nativeGlass）；網頁版用長得一樣的網頁按鈕。 */

interface GalleryOverlayProps {
  photos: string[];
  /** 小預覽；格狀列表從不解碼原解析度的照片 */
  thumbs?: Record<string, string>;
  onClose: () => void;
  /** 刪掉這幾張（index） */
  onDelete: (indices: number[]) => void;
  onImport: (srcs: string[]) => void;
  /** 編輯（相機的編輯；RAW 會先沖洗） */
  onEdit: (src: string, index: number) => void;
  /** 專業編輯（全部分頁：模板、人像、仿色…） */
  onProEdit?: (src: string, index: number) => void;
  /** 一次編輯好幾張 */
  onEditMany?: (indices: number[]) => void;
  /** 有 RAW 的那幾張（角落標一個 RAW） */
  rawShots?: Set<string>;
  favorites?: Set<string>;
  /** 把這幾張設成（取消）愛心 */
  onFavorite?: (srcs: string[], on: boolean) => void;
  /** 大圖右上的標籤（例如拍照時用的濾鏡「F3」） */
  labelOf?: (src: string) => string | null;
}

const CIRCLE = 56;

export const GalleryOverlay: React.FC<GalleryOverlayProps> = ({
  photos, thumbs = {}, onClose, onDelete, onImport, onEdit, onProEdit, onEditMany, rawShots, favorites, onFavorite, labelOf,
}) => {
  const [closing, setClosing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewer, setViewer] = useState<number | null>(null);
  const [closingViewer, setClosingViewer] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* 照片少了（刪掉）：選取、大圖的位置跟著修正 */
  useEffect(() => {
    setSelected(prev => new Set([...prev].filter(i => i < photos.length)));
    if (viewer !== null && viewer >= photos.length) setViewer(photos.length ? photos.length - 1 : null);
  }, [photos.length]);

  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 340);
  };

  const importFiles = async (files: File[]) => {
    const results = await Promise.all(files.map(async file => {
      try {
        const objectUrl = await processImageFile(file);
        return await new Promise<string>(resolve => {
          const img = new Image();
          /* 直接用讀進來的檔案，不整張畫進畫布重新編碼：48MP 照片超過手機畫布上限，直接匯入會空白或閃退 */
          img.onload = () => resolve(objectUrl);
          img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(''); };
          img.src = objectUrl;
        });
      } catch { return ''; }
    }));
    const ok = results.filter(Boolean);
    if (ok.length) onImport(ok);
  };
  const addPhotos = async () => {
    /* App 裡用原生的照片選擇器（原生按鈕按下去不算網頁的點擊，叫不出 <input type=file>） */
    if (isNative()) {
      try { const files = await pickNativeFiles(0, 'images'); if (files) { void importFiles(files); return; } } catch { /* 退回網頁選擇器 */ }
    }
    fileRef.current?.click();
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
  const addRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const favAll = selectedIdx.length > 0 && selectedIdx.every(i => favorites?.has(photos[i]));
  const grid = useNativeGlass('camera-gallery', !closing && viewer === null, () => [
    { kind: 'capsule', el: selectRef.current, buttons: [{ id: 'select', title: selecting ? '取消' : '選取' }] },
    ...(selecting ? [
      { kind: 'capsule' as const, el: actionsRef.current, buttons: [
        { id: 'fav', symbol: favAll ? 'heart.fill' : 'heart', tint: favAll ? 'pink' as const : 'white' as const, enabled: selectedIdx.length > 0 },
        { id: 'share', symbol: 'square.and.arrow.up', enabled: selectedIdx.length > 0 },
        { id: 'edit', symbol: 'slider.horizontal.3', enabled: selectedIdx.length > 0 },
        { id: 'delete', symbol: 'trash', enabled: selectedIdx.length > 0 },
      ] },
    ] : [
      { kind: 'circle' as const, id: 'back', symbol: 'chevron.down', el: backRef.current },
      { kind: 'circle' as const, id: 'add', symbol: 'plus', el: addRef.current },
    ]),
  ], id => {
    if (id === 'select') { setSelecting(v => !v); setSelected(new Set()); }
    else if (id === 'back') close();
    else if (id === 'add') void addPhotos();
    else if (id === 'fav') toggleFav(selectedIdx);
    else if (id === 'share') void share(selectedIdx);
    else if (id === 'edit') { if (selectedIdx.length) onEditMany ? onEditMany(selectedIdx) : onEdit(photos[selectedIdx[0]], selectedIdx[0]); }
    else if (id === 'delete') remove(selectedIdx);
  }, [selecting, selectedIdx.join(','), favAll, photos.length], 340);
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
      className={`fixed inset-0 bg-black z-50 flex flex-col transition-transform duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${closing ? 'translate-y-full' : 'animate-in slide-in-from-bottom duration-300'}`}>
      <header className="px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 flex justify-between items-center">
        <h2 className="text-lg font-semibold tracking-tight">{selecting ? (selectedIdx.length ? `已選取 ${selectedIdx.length} 張` : '選取照片') : `相簿 (${photos.length})`}</h2>
        <button ref={selectRef} onClick={() => { setSelecting(v => !v); setSelected(new Set()); }} disabled={!photos.length}
          className={`h-9 px-4 rounded-full bg-white/10 border border-white/15 backdrop-blur-xl text-[15px] font-semibold disabled:opacity-30 ${hideWeb}`}>
          {selecting ? '取消' : '選取'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {photos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-40">
            <Icon name="no_photography" className="text-6xl mb-4" />
            <p>尚未拍攝或導入任何照片</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-[3px]">
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
                    <span className="absolute left-1.5 top-1.5 pointer-events-none drop-shadow"><svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.9 3.8 4.3 7.3C19.5 16.4 12 21 12 21z" /></svg></span>
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

      {/* 下面：左邊回相機、右邊加照片（同樣大小、同一條線上）；選取時換成一條動作按鈕 */}
      <div className="absolute left-0 right-0 flex items-center justify-between px-6 pointer-events-none" style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 30px)', height: CIRCLE }}>
        {!selecting ? (
          <>
            <button ref={backRef} aria-label="回相機" onClick={close} className={`pointer-events-auto ${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <button ref={addRef} aria-label="加入照片" onClick={() => void addPhotos()} className={`pointer-events-auto ${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
              <Icon name="add" className="text-3xl text-white" />
            </button>
          </>
        ) : (
          <div ref={actionsRef} className={`pointer-events-auto mx-auto h-full w-[248px] rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-around px-2 ${hideWeb}`}>
            {([['fav', favAll ? 'favorite' : 'favorite_border', () => toggleFav(selectedIdx)],
               ['share', 'ios_share', () => void share(selectedIdx)],
               ['edit', 'tune', () => { if (selectedIdx.length) onEditMany ? onEditMany(selectedIdx) : onEdit(photos[selectedIdx[0]], selectedIdx[0]); }],
               ['delete', 'delete', () => remove(selectedIdx)]] as const).map(([id, icon, fn]) => (
              <button key={id} onClick={fn} disabled={!selectedIdx.length} className="w-12 h-12 flex items-center justify-center disabled:opacity-30 active:scale-90 transition-transform">
                <Icon name={icon} className="text-[24px] text-white" />
              </button>
            ))}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept={RAW_ACCEPT} multiple className="hidden"
        onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) void importFiles(files); }} />

      {viewer !== null && photos[viewer] && (
        <PhotoViewer
          photos={photos} thumbs={thumbs} index={viewer} closing={closingViewer}
          onIndex={setViewer}
          onClose={() => { setClosingViewer(true); window.setTimeout(() => { setViewer(null); setClosingViewer(false); }, 260); }}
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
  photos: string[]; thumbs: Record<string, string>; index: number; closing: boolean;
  onIndex: (i: number) => void; onClose: () => void;
  favorites?: Set<string>; labelOf?: (src: string) => string | null;
  onShare: (i: number) => void; onProEdit: (i: number) => void; onEdit: (i: number) => void;
  onFavorite: (i: number) => void; onDelete: (i: number) => void;
}> = ({ photos, thumbs, index, closing, onIndex, onClose, favorites, labelOf, onShare, onProEdit, onEdit, onFavorite, onDelete }) => {
  const pager = useRef<HTMLDivElement>(null);
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
  const fav = !!favorites?.has(src);
  const label = labelOf?.(src) ?? null;
  const glass = useNativeGlass('camera-viewer', !closing, () => [
    { kind: 'circle', id: 'share', symbol: 'square.and.arrow.up', el: shareRef.current },
    { kind: 'capsule', el: midRef.current, buttons: [
      { id: 'pro', symbol: 'wand.and.stars' },
      { id: 'edit', symbol: 'slider.horizontal.3' },
      { id: 'fav', symbol: fav ? 'heart.fill' : 'heart', tint: fav ? 'pink' : 'white' },
    ] },
    { kind: 'circle', id: 'delete', symbol: 'trash', el: delRef.current },
  ], id => {
    if (id === 'share') onShare(index);
    else if (id === 'pro') onProEdit(index);
    else if (id === 'edit') onEdit(index);
    else if (id === 'fav') onFavorite(index);
    else if (id === 'delete') onDelete(index);
  }, [index, fav], 240);
  const hideWeb = glass.native ? 'invisible' : '';
  const webCircle = 'rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-center active:scale-90 transition-transform';

  return (
    <div data-camera-viewer className={`fixed inset-0 z-[60] bg-black transition-opacity duration-[260ms] ${closing ? 'opacity-0' : 'animate-in fade-in zoom-in-95 duration-200'}`}>
      <div ref={pager} onScroll={onScroll} className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar">
        {photos.map((p, i) => (
          <div key={p} className="w-full h-full shrink-0 snap-center flex items-center justify-center" style={{ scrollSnapStop: 'always' }}>
            {Math.abs(i - index) <= 1
              ? <img src={p} alt="" className="max-w-full max-h-full object-contain allow-callout" draggable={false} />
              : thumbs[p] ? <img src={thumbs[p]} alt="" className="max-w-full max-h-full object-contain" /> : null}
          </div>
        ))}
      </div>
      <button aria-label="關閉" onClick={onClose}
        className="absolute left-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center active:scale-90 transition-transform"
        style={{ top: 'calc(max(env(safe-area-inset-top), 12px) + 4px)' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {label && (
        <span className="absolute right-4 h-10 px-4 rounded-full bg-white/10 backdrop-blur-xl flex items-center text-[15px] font-bold tracking-[0.04em] pointer-events-none"
          style={{ top: 'calc(max(env(safe-area-inset-top), 12px) + 4px)' }}>#{label}</span>
      )}
      <div className="absolute left-0 right-0 flex items-center justify-between px-6" style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 16px) + 30px)', height: CIRCLE }}>
        <button ref={shareRef} aria-label="分享" onClick={() => onShare(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="ios_share" className="text-[24px] text-white" />
        </button>
        <div ref={midRef} className={`h-full w-[188px] rounded-full bg-white/10 border border-white/15 backdrop-blur-xl flex items-center justify-around px-2 ${hideWeb}`}>
          <button aria-label="專業編輯" onClick={() => onProEdit(index)} className="w-12 h-12 flex items-center justify-center active:scale-90"><Icon name="auto_fix_high" className="text-[24px] text-white" /></button>
          <button aria-label="編輯" onClick={() => onEdit(index)} className="w-12 h-12 flex items-center justify-center active:scale-90"><Icon name="tune" className="text-[24px] text-white" /></button>
          <button aria-label="愛心" onClick={() => onFavorite(index)} className="w-12 h-12 flex items-center justify-center active:scale-90"><Icon name={fav ? 'favorite' : 'favorite_border'} className={`text-[24px] ${fav ? 'text-pink-400' : 'text-white'}`} /></button>
        </div>
        <button ref={delRef} aria-label="刪除" onClick={() => onDelete(index)} className={`${webCircle} ${hideWeb}`} style={{ width: CIRCLE, height: CIRCLE }}>
          <Icon name="delete" className="text-[24px] text-white" />
        </button>
      </div>
    </div>
  );
};
