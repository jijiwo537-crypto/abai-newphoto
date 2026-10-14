/* 排序工具的「星芒」頁：30 種星芒並排看，選一個可以疊在照片上看實際效果，
   覺得可以的就勾「想加進去」，複製順序時一起帶出去。 */
import React, { useEffect, useRef, useState } from 'react';
import { STAR_BURSTS, drawStarBurst, type StarBurstSpec } from '../utils/starBursts';

const COLORS = [
  { c: '#ffffff', n: '白' },
  { c: '#ffe7a8', n: '暖黃' },
  { c: '#ffc2dd', n: '粉' },
  { c: '#bfe0ff', n: '冰藍' },
  { c: '#d8c4ff', n: '淡紫' },
];

/** 一格的小圖：黑底上畫一顆，跟參考圖一樣 */
const Thumb = ({ spec, color }: { spec: StarBurstSpec; color: string }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const css = cv.clientWidth || 100, dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(css * dpr);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    drawStarBurst(g, spec, cv.width / 2, cv.height / 2, cv.width * .92, color);
  }, [spec, color]);
  return <canvas ref={ref} className="block w-full aspect-square rounded-[10px]" />;
};

export function StarBurstLab({ photo, onPickPhoto, picked, onTogglePick }: {
  photo: File | null;
  onPickPhoto: (f: File) => void;
  picked: string[];
  onTogglePick: (id: string) => void;
}) {
  const [sel, setSel] = useState(STAR_BURSTS[0].id);
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(45);
  const [pos, setPos] = useState({ x: .5, y: .45 });
  const spec = STAR_BURSTS.find(s => s.id === sel)!;
  const input = useRef<HTMLInputElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!photo) { setImg(null); return; }
    const u = URL.createObjectURL(photo), im = new Image();
    im.onload = () => setImg(im); im.src = u;
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  // 照片預覽：照片蓋滿 3:4 的框，星芒用相加的方式疊上去
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const css = cv.clientWidth || 300, dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(css * dpr); cv.height = Math.round(css * 4 / 3 * dpr);
    const g = cv.getContext('2d')!, W = cv.width, H = cv.height;
    if (img) {
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      const lg = g.createLinearGradient(0, 0, W, H);
      lg.addColorStop(0, '#1c2440'); lg.addColorStop(.55, '#3b2f4f'); lg.addColorStop(1, '#0e1a2a');
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
    }
    drawStarBurst(g, spec, pos.x * W, pos.y * H, Math.min(W, H) * (size / 100) * 1.6, color);
  }, [img, spec, color, size, pos]);

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointermove' && !e.buttons && e.pointerType === 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };
  const on = picked.includes(sel);

  return (
    <>
      <div className="mt-4 rounded-[12px] border border-white/15 bg-white/[0.06] p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="text-[13px] font-bold">{STAR_BURSTS.indexOf(spec) + 1}. {spec.name}</div>
            <div className="text-[10px] text-white/40">點照片可以移動星芒的位置</div>
          </div>
          <button onClick={() => input.current?.click()} className="shrink-0 h-8 px-3 rounded-full bg-white text-black text-[12px] font-bold active:scale-95">{photo ? '換照片' : '導入照片'}</button>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPickPhoto(f); e.target.value = ''; }} />
        </div>
        <canvas ref={cvRef} data-starburst-preview onPointerDown={move} onPointerMove={move}
          className="block w-full rounded-[8px]" style={{ aspectRatio: '3 / 4', touchAction: 'none' }} />
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[11px] text-white/60 shrink-0">大小</span>
          <input type="range" min={5} max={100} value={size} onChange={e => setSize(Number(e.target.value))} className="flex-1 accent-white" style={{ touchAction: 'pan-y' }} aria-label="星芒大小" />
          <span className="text-[12px] tabular-nums w-7 text-right">{size}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-white/60 shrink-0">顏色</span>
          {COLORS.map(k => (
            <button key={k.c} onClick={() => setColor(k.c)} aria-label={k.n} title={k.n}
              className={`w-7 h-7 rounded-full border-2 ${color === k.c ? 'border-white' : 'border-transparent'}`} style={{ background: k.c }} />
          ))}
        </div>
        <button onClick={() => onTogglePick(sel)}
          className={`mt-3 w-full h-9 rounded-full text-[13px] font-bold active:scale-95 ${on ? 'bg-[#f2c46d] text-black' : 'border border-white/25 text-white/85'}`}>
          {on ? '✓ 想加進去（再點一下取消）' : '想加進去'}
        </button>
      </div>
      <section className="mt-5">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[11px] font-bold text-white/50 tracking-widest">星芒（{STAR_BURSTS.length} 種）</div>
          {picked.length > 0 && <div className="text-[10px] text-[#f2c46d]">想加進去 {picked.length} 個</div>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {STAR_BURSTS.map((s, i) => (
            <button key={s.id} data-starburst={s.id} onClick={() => { setSel(s.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`relative rounded-[12px] border p-1 text-left ${s.id === sel ? 'border-white' : picked.includes(s.id) ? 'border-[#f2c46d]/80' : 'border-white/10'}`}>
              <Thumb spec={s} color={color} />
              <div className="px-1 pt-1 pb-0.5 flex items-center justify-between">
                <span className="text-[10px] text-white/70 truncate">{i + 1}. {s.name}</span>
                {picked.includes(s.id) && <span className="text-[9px] px-1 rounded bg-[#f2c46d] text-black font-bold">要</span>}
              </div>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
