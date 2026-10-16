/* 排序工具的「邊框」頁：新的五種邊框先在這裡看效果，挑好再加進 App。
   每一顆都用 App 裡同一支畫法（utils/frameShapes.ts）畫在示範照片上，
   「範圍」跟 App 的滑桿一樣是 0～100，顏色可以切換。 */
import React, { useEffect, useRef, useState } from 'react';
import { FRAME_ITEMS, paintFrameShape, frameRangeDefault, FRAME_SPEED, FRAME_SCATTER, SCATTER_KINDS_DEFAULT, SCATTER_CHOICES, FRAME_SLIDERS, type FrameParams } from '../utils/frameShapes';
import { shapePathD, ShapeGlyph } from './GridLayoutTool';

export { FRAME_SLIDERS };
export const STORE_FRAME_KINDS = 'abai-order-tool-frame-kinds-v1';
export const loadScatterKinds = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_FRAME_KINDS) || 'null'); return Array.isArray(v) && v.length ? v : SCATTER_KINDS_DEFAULT; } catch { return SCATTER_KINDS_DEFAULT; } };
const shapeD = (kind: string, w: number, h: number) => shapePathD(kind, w, h);

/** 還沒加進 App、要先在這裡試的那幾種 */
export const LAB_FRAMES = FRAME_ITEMS.filter(i => i.kind !== 'mist-frame');
export const STORE_FRAME_PICK = 'abai-order-tool-frame-pick-v1';
export const STORE_FRAME_RANGE = 'abai-order-tool-frame-range-v1';
export const loadFramePicks = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_FRAME_PICK) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export const loadFrameRanges = (): Record<string, number> => { try { const v = JSON.parse(localStorage.getItem(STORE_FRAME_RANGE) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

const COLORS = ['#FFFFFF', '#111111', '#F4A6C0', '#A8C3E6', '#F6D365'];

const paintSample = (g: CanvasRenderingContext2D, w: number, h: number, img: HTMLImageElement | null) => {
  if (img) {
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  }
  const lg = g.createLinearGradient(0, 0, w, h);
  lg.addColorStop(0, '#f4a6a0'); lg.addColorStop(.5, '#f7d9a8'); lg.addColorStop(1, '#8fb9d8');
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
  for (const [x, y, r, c] of [[.3, .3, .2, '#ffffff55'], [.72, .62, .26, '#3a5f8a66'], [.38, .8, .16, '#e8735a66']] as const) {
    g.fillStyle = c; g.beginPath(); g.arc(x * w, y * h, r * w, 0, Math.PI * 2); g.fill();
  }
};

const Preview: React.FC<{ kind: string; params: FrameParams; color: string; img: HTMLImageElement | null }> = ({ kind, params, color, img }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1), W = cv.clientWidth * dpr, H = cv.clientHeight * dpr;
    cv.width = Math.max(1, Math.round(W)); cv.height = Math.max(1, Math.round(H));
    const g = cv.getContext('2d')!;
    paintSample(g, cv.width, cv.height, img);
    paintFrameShape(g, kind, cv.width, cv.height, color, { ...params, shapeD });
  }, [kind, JSON.stringify(params), color, img]);
  return <canvas ref={ref} className="w-full rounded-[10px] block" style={{ aspectRatio: '3 / 4' }} />;
};

export function FrameLab({ photo, onPickPhoto, picked, onTogglePick, ranges, onRange }: {
  photo: File | null; onPickPhoto: (f: File | null) => void;
  picked: string[]; onTogglePick: (id: string) => void;
  ranges: Record<string, number>; onRange: (id: string, v: number) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [kinds, setKinds] = useState<string[]>(loadScatterKinds);
  useEffect(() => { try { localStorage.setItem(STORE_FRAME_KINDS, JSON.stringify(kinds)); } catch {} }, [kinds]);
  useEffect(() => {
    if (!photo) { setImg(null); return; }
    const u = URL.createObjectURL(photo), im = new Image();
    im.onload = () => setImg(im); im.src = u;
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[11px] text-white/55 leading-snug">新的邊框先在這裡看效果。勾「想加進去」，再按右上角複製給 Claude。</div>
        <button onClick={() => fileRef.current?.click()} className="shrink-0 h-8 px-3 rounded-full border border-white/20 text-[12px] font-bold text-white/80 active:scale-95">換照片</button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onPickPhoto(e.target.files?.[0] || null)} />
      </div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] text-white/50">顏色</span>
        {COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)} aria-label={c}
            className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-white' : 'border-white/15'}`} style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {LAB_FRAMES.map(f => {
          const range = ranges[f.id] ?? frameRangeDefault(f.kind), on = picked.includes(f.id);
          const extra = FRAME_SLIDERS[f.kind] || [];
          const params: FrameParams = { range };
          for (const sl of extra) (params as any)[sl.key] = ranges[`${f.id}.${sl.key}`] ?? sl.def;
          if (f.kind === FRAME_SCATTER) params.kinds = kinds;
          const row = (label: string, v: number, set: (v: number) => void) => (
            <div key={label} className="mt-1.5 flex items-center gap-2">
              <span className="text-[10px] text-white/50 shrink-0 w-12">{label}</span>
              <input type="range" min={0} max={100} step={1} value={v} onChange={e => set(Number(e.target.value))} className="flex-1 min-w-0 accent-white" />
              <span className="text-[10px] tabular-nums w-6 shrink-0 text-right">{v}</span>
            </div>
          );
          return (
            <div key={f.id} data-frame-card={f.id} className={`rounded-[12px] border p-2 ${on ? 'border-[#9fd3a8] bg-[#9fd3a8]/10' : 'border-white/10 bg-white/[0.03]'}`}>
              <Preview kind={f.kind} params={params} color={color} img={img} />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[12px] font-bold">{f.label}</span>
                <button onClick={() => onTogglePick(f.id)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-bold active:scale-95 ${on ? 'bg-[#9fd3a8] text-black' : 'border border-white/20 text-white/75'}`}>
                  {on ? '已勾選' : '想加進去'}
                </button>
              </div>
              {row('範圍', range, v => onRange(f.id, v))}
              {extra.map(sl => row(sl.label, (params as any)[sl.key], v => onRange(`${f.id}.${sl.key}`, v)))}
              {f.kind === FRAME_SCATTER && (
                <div className="mt-2 grid grid-cols-6 gap-1" data-scatter-kinds>
                  {SCATTER_CHOICES.map(k => {
                    const sel = kinds.includes(k);
                    return (
                      <button key={k} aria-label={k} onClick={() => setKinds(p => sel ? (p.length > 1 ? p.filter(x => x !== k) : p) : [...p, k])}
                        className={`aspect-square rounded-[8px] flex items-center justify-center ${sel ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70'}`}>
                        <ShapeGlyph item={{ id: k, kind: k, filled: true } as any} size={16} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
