import React, { useEffect, useRef, useState } from 'react';
import { GSlider, ResetIcon, type Ev } from './controls';
import { normGrade, freshGrade, SLICES, SLICE_SPEC, isSliceVecNeutral, type ColorGrade, type SliceId } from '../../utils/colorGrade';
import { scopeColour } from '../../utils/grade/common';

/* 色彩切片面板（DaVinci Resolve 19 的 ColorSlice）：
 *   上排：全域、紅、膚色、黃、綠、青、藍、洋紅（圓點就是那一片的顏色），右邊是「顯示範圍」（按住）與重置。
 *   全域：密度、密度深度、飽和度、飽和度平衡、飽和度深度。
 *   每一片：中心、色相、飽和度、密度。
 * 按住「顯示範圍」：只顯示目前這一片會影響到的地方（範圍外變灰），放手就恢復，不會存進作品。 */

let lastSel: SliceId | 'global' = 'global';

export const SlicePanel = React.memo(function SlicePanel({ grade, onStart, onChange, onCommit, onPreview }: {
  grade: ColorGrade | undefined;
  onStart: () => void; onChange: (g: ColorGrade) => void; onCommit: () => void;
  /** 暫時的預覽（不進復原紀錄）；null ＝ 結束預覽 */
  onPreview: (g: ColorGrade | null) => void;
}) {
  const [sel, setSelS] = useState<SliceId | 'global'>(lastSel);
  const setSel = (s: SliceId | 'global') => { lastSel = s; setSelS(s); };
  const [g, setG] = useState(() => normGrade(grade));
  const gRef = useRef(g);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) { const n = normGrade(grade); gRef.current = n; setG(n); } }, [grade]);
  const ev: Ev = { onStart: () => { dragging.current = true; onStart(); }, onEnd: () => { dragging.current = false; onCommit(); } };
  const push = (ng: ColorGrade) => { gRef.current = ng; setG(ng); onChange(ng); };
  const sl = g.slice;
  const setGlobal = (k: 'density' | 'depth' | 'sat' | 'balance' | 'satDepth', v: number) => push({ ...gRef.current, slice: { ...gRef.current.slice, [k]: v } });
  const setVec = (id: SliceId, k: 'center' | 'hue' | 'sat' | 'den', v: number) => {
    const s = gRef.current.slice;
    push({ ...gRef.current, slice: { ...s, vec: { ...s.vec, [id]: { ...s.vec[id], [k]: v } } } });
  };
  const reset = () => {
    ev.onStart();
    if (sel === 'global') push({ ...gRef.current, slice: freshGrade().slice });
    else { const s = gRef.current.slice; push({ ...gRef.current, slice: { ...s, vec: { ...s.vec, [sel]: freshGrade().slice.vec[sel] } } }); }
    ev.onEnd();
  };
  const showRange = (on: boolean) => {
    if (!on) { onPreview(null); return; }
    const idx = SLICES.findIndex(s => s.id === sel);
    onPreview({ ...gRef.current, view: { slice: idx } });
  };
  const globalTouched = Math.abs(sl.density) > 1e-6 || Math.abs(sl.sat - 1) > 1e-6 || Math.abs(sl.depth - 0.5) > 1e-6 || Math.abs(sl.balance - 0.5) > 1e-6 || Math.abs(sl.satDepth - 0.5) > 1e-6;
  const d = sel === 'global' ? null : SLICES.find(s => s.id === sel)!;
  return (
    <div className="w-full h-full flex flex-col px-4 pt-[8px] pb-[6px]" data-slice-panel>
      <div className="flex items-center gap-[6px] h-[40px]">
        <button onClick={() => setSel('global')} data-slice={'global'}
          className={`relative shrink-0 h-[26px] px-[9px] rounded-[7px] text-[11px] border ${sel === 'global' ? 'bg-white text-black border-white' : 'bg-[#1b1b1b] text-white/70 border-white/10'}`}>
          全域{globalTouched && <span className="absolute -right-[2px] -top-[2px] w-[6px] h-[6px] rounded-full bg-white border border-black/40" />}
        </button>
        <div className="flex-1 flex items-center justify-between">
          {SLICES.map(s => {
            const on = sel === s.id;
            const touched = !isSliceVecNeutral(sl.vec[s.id]) || Math.abs(sl.vec[s.id].center) > 1e-6;
            const col = scopeColour(s.base + (sl.vec[s.id].center || 0), s.id === 'skin' ? 0.16 : 0.3);
            return (
              <button key={s.id} onClick={() => setSel(s.id)} data-slice={s.id} className="flex flex-col items-center gap-[2px] w-[30px]">
                <span className="block w-[20px] h-[20px] rounded-full" style={{ border: `3px solid ${col}`, background: on ? col : 'transparent' }} />
                <span className={`text-[9.5px] leading-none whitespace-nowrap ${on ? 'text-white' : 'text-white/45'}`}>{s.label}</span>
                <span className={`w-[4px] h-[4px] rounded-full bg-white ${touched ? 'opacity-100' : 'opacity-0'}`} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between h-[24px] mt-[2px]">
        <span className="text-[10.5px] text-white/40">{d ? `${d.label}切片` : '全域'}</span>
        <div className="flex items-center gap-2">
          {d && (
            <button data-slice-show
              onPointerDown={e => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); showRange(true); }}
              onPointerUp={() => showRange(false)} onPointerCancel={() => showRange(false)}
              className="h-[22px] px-[8px] rounded-[6px] text-[10.5px] bg-[#1b1b1b] border border-white/15 text-white/75 active:bg-white active:text-black select-none touch-none">
              按住顯示範圍
            </button>
          )}
          <button onClick={reset} className="w-[24px] h-[22px] flex items-center justify-center" aria-label="重置"><ResetIcon on /></button>
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-center">
        {sel === 'global' ? (<>
          <GSlider label="密度" value={sl.density} spec={SLICE_SPEC.density} onChange={v => setGlobal('density', v)} {...ev} />
          <GSlider label="密度深度" value={sl.depth} spec={SLICE_SPEC.depth} onChange={v => setGlobal('depth', v)} {...ev} />
          <GSlider label="飽和度" value={sl.sat} spec={SLICE_SPEC.gsat} onChange={v => setGlobal('sat', v)} {...ev} />
          <GSlider label="飽和平衡" value={sl.balance} spec={SLICE_SPEC.balance} onChange={v => setGlobal('balance', v)} {...ev} />
          <GSlider label="飽和深度" value={sl.satDepth} spec={SLICE_SPEC.satDepth} onChange={v => setGlobal('satDepth', v)} {...ev} />
        </>) : (<>
          <GSlider label="中心" value={sl.vec[d!.id].center} unit="°" spec={{ ...SLICE_SPEC.center, min: -d!.centerMax, max: d!.centerMax }} onChange={v => setVec(d!.id, 'center', v)} {...ev} />
          <GSlider label="色相" value={sl.vec[d!.id].hue} unit="°" spec={SLICE_SPEC.hue} onChange={v => setVec(d!.id, 'hue', v)} {...ev} />
          <GSlider label="飽和度" value={sl.vec[d!.id].sat} spec={SLICE_SPEC.sat} onChange={v => setVec(d!.id, 'sat', v)} {...ev} />
          <GSlider label="密度" value={sl.vec[d!.id].den} spec={SLICE_SPEC.den} onChange={v => setVec(d!.id, 'den', v)} {...ev} />
        </>)}
      </div>
    </div>
  );
});
