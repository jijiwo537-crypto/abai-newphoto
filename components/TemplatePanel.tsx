import React, { useRef, useState } from 'react';
import type { UserPreset } from '../utils/userPresets';

/* 「模板」分頁：先有介面、還沒有實際功能。
   一排 20 格可以左右滑；空的格子是虛線框，點下去選一張圖放進去看效果。
   放進去的圖存在這台裝置上（localStorage），下次打開還在。
   有圖的格子點一下是選中（之後套模板用）。這裡之後不是讓使用者新增／刪除的地方，
   目前只是開發階段放圖看效果，所以格子上不放刪除鈕。 */

export const TEMPLATE_SLOTS = 20;
const KEY = 'abai.templateSlots.v1';
/* 存的大小要「蓋滿」3:4 的格子：iPhone 13 Pro 上格子約 150 點高 × 3 倍 ＝ 450 實體像素，
   存 540×720 就清楚；舊版只存長邊 240，放大顯示時明顯糊。 */
const COVER_W = 540, COVER_H = 720;

const load = (): (string | null)[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(v)) return Array.from({ length: TEMPLATE_SLOTS }, (_, i) => (typeof v[i] === 'string' ? v[i] : null));
  } catch { /* 讀不到就當全空 */ }
  return Array(TEMPLATE_SLOTS).fill(null);
};
const save = (v: (string | null)[]) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 空間不夠就只留在這一次 */ } };

const toThumb = (file: File) => new Promise<string>((res, rej) => {
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => {
    const k = Math.min(1, Math.max(COVER_W / im.naturalWidth, COVER_H / im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
    const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    res(c.toDataURL('image/jpeg', 0.9));
  };
  im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('load')); };
  im.src = url;
});

type TemplatePanelProps = {
  presets: UserPreset[];
  activePresetId: string | null;
  previewSrc: string;
  onSavePreset: () => void;
  onApplyPreset: (preset: UserPreset) => void;
  onDeletePreset: (id: string) => void;
};

export const TemplatePanel: React.FC<TemplatePanelProps> = ({ presets, activePresetId, previewSrc, onSavePreset, onApplyPreset, onDeletePreset }) => {
  const [slots, setSlots] = useState(load);
  const [picked, setPicked] = useState<number | null>(null);
  const target = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const hold = useRef<{ timer: number; fired: boolean } | null>(null);
  const put = (i: number, v: string | null) => setSlots(prev => { const n = prev.slice(); n[i] = v; save(n); return n; });
  return (
    /* 欄位跟其他分頁一樣高（預覽大小、位置都不變）；格子撐滿這一塊，上下各留 12px，不留一大片空白 */
    <div className="w-full h-full flex items-stretch py-3" data-template-panel>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        try { const t = await toThumb(f); put(target.current, t); setPicked(target.current); } catch { /* 讀不到的格式就略過 */ }
      }} />
      <div className="w-full h-full flex items-stretch gap-2.5 px-4 pt-1.5 overflow-x-auto no-scrollbar touch-pan-x">
        <button data-preset-save onClick={onSavePreset} data-haptic="press" aria-label="保存當前預設"
          className="relative shrink-0 h-full aspect-[3/4] rounded-[10px] border border-dashed border-white/30 bg-white/[0.03] flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-transform">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.65)" strokeWidth="1.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          <span className="text-[9px] font-medium text-white/65 whitespace-nowrap">保存當前預設</span>
        </button>
        {presets.map(preset => (
          <button key={preset.id} data-preset-card={preset.id} data-haptic="tick"
            className="relative shrink-0 h-full aspect-[3/4] rounded-[10px] overflow-hidden bg-[#1a1a1a] active:scale-95 transition-transform"
            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
            onContextMenu={e => e.preventDefault()}
            onPointerDown={() => { const h = { timer: 0, fired: false }; h.timer = window.setTimeout(() => { h.fired = true; onDeletePreset(preset.id); }, 600); hold.current = h; }}
            onPointerUp={() => { if (hold.current) clearTimeout(hold.current.timer); }}
            onPointerLeave={() => { if (hold.current) clearTimeout(hold.current.timer); }}
            onPointerCancel={() => { if (hold.current) clearTimeout(hold.current.timer); }}
            onClick={() => { if (hold.current?.fired) { hold.current = null; return; } onApplyPreset(preset); }}>
            {previewSrc && <img src={previewSrc} alt="" className="w-full h-full object-cover" draggable={false} />}
            <span className="absolute inset-x-0 bottom-0 bg-black/65 py-1 text-[9px] font-semibold text-white">預設 {preset.n}</span>
            {activePresetId === preset.id && <span className="absolute inset-0 rounded-[10px] ring-2 ring-inset ring-white pointer-events-none" />}
          </button>
        ))}
        {slots.map((src, i) => (
          <div key={i} className="relative shrink-0 h-full aspect-[3/4]">
            <button data-template-slot={i} aria-label={src ? `模板 ${i + 1}` : `放入模板 ${i + 1} 的圖片`}
              onClick={() => { if (src) setPicked(i); else { target.current = i; input.current?.click(); } }}
              className={`relative w-full h-full rounded-[10px] overflow-hidden flex items-center justify-center transition-transform active:scale-95 ${src ? 'bg-[#1a1a1a]' : 'border border-dashed border-white/30 bg-white/[0.03]'}`}>
              {src
                ? <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="1.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>}
              {src && picked === i && <span className="absolute inset-0 rounded-[10px] ring-2 ring-inset ring-white pointer-events-none" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
