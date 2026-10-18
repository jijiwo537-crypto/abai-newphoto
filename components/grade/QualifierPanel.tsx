import React, { useEffect, useRef, useState } from 'react';
import { GSlider, Chip, ResetIcon, type Ev } from './controls';
import { normGrade, freshGrade, QUAL_SPEC, isQualRangeDefault, type ColorGrade, type Qual } from '../../utils/colorGrade';
import { scopeColour } from '../../utils/grade/common';

/* 限定器面板（DaVinci Resolve 的 HSL 限定器）。
 *
 *   上排：滴管（在畫面上點一下取樣）、＋（加入取樣）、－（排除取樣）、按住顯示範圍、黑白遮罩、反轉、重置。
 *   分頁：色相（中心、寬度、柔化、對稱）、飽和度、亮度（低、高、低柔化、高柔化）、
 *         遮罩（黑色裁切、白色裁切）、調整（範圍內的色相、飽和度、曝光、色溫、色調）。
 *   色相、飽和度、亮度的分頁上有開關，關掉＝那一項不限制。 */

export type PickMode = 'set' | 'add' | 'sub' | null;
type Tab = 'h' | 's' | 'l' | 'm' | 'c';
let lastTab: Tab = 'h';

const P = (min: number, max: number, def: number, digits = 1) => ({ def, min, max, digits, span: max - min });

export const QualifierPanel = React.memo(function QualifierPanel({ grade, pick, onPick, onStart, onChange, onCommit, onPreview }: {
  grade: ColorGrade | undefined; pick: PickMode;
  onPick: (m: PickMode) => void;
  onStart: () => void; onChange: (g: ColorGrade) => void; onCommit: () => void;
  onPreview: (g: ColorGrade | null) => void;
}) {
  const [tab, setTabS] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => { lastTab = t; setTabS(t); };
  const [g, setG] = useState(() => normGrade(grade));
  const gRef = useRef(g);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) { const n = normGrade(grade); gRef.current = n; setG(n); } }, [grade]);
  const ev: Ev = { onStart: () => { dragging.current = true; onStart(); }, onEnd: () => { dragging.current = false; onCommit(); } };
  const push = (q: Qual) => { const ng = { ...gRef.current, qual: q }; gRef.current = ng; setG(ng); onChange(ng); };
  const q = g.qual;
  const set = (k: keyof Qual, v: any) => push({ ...gRef.current.qual, [k]: v });
  const toggle = (k: keyof Qual) => { ev.onStart(); set(k, !gRef.current.qual[k]); ev.onEnd(); };
  const reset = () => { ev.onStart(); push(freshGrade().qual); ev.onEnd(); };
  const hold = (view: 1 | 2) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); onPreview({ ...gRef.current, view: { qual: view } }); },
    onPointerUp: () => onPreview(null), onPointerCancel: () => onPreview(null),
  });
  const hueCol = scopeColour(q.hc, 0.3);
  const tabs: [Tab, string, keyof Qual | null][] = [['h', '色相', 'useH'], ['s', '飽和度', 'useS'], ['l', '亮度', 'useL'], ['m', '遮罩', null], ['c', '調整', null]];
  const s = (label: string, k: keyof Qual, spec: { def: number; min: number; max: number; digits: number; span: number }, unit = '', accent?: string) => (
    <GSlider key={k} label={label} value={q[k] as number} spec={spec} unit={unit} accent={accent} onChange={v => set(k, v)} {...ev} />
  );
  const pickBtn = (m: Exclude<PickMode, null>, label: string) => (
    <Chip on={pick === m} onClick={() => onPick(pick === m ? null : m)} data-qual-pick={m}>{label}</Chip>
  );
  return (
    <div className="w-full h-full flex flex-col px-4 pt-[8px] pb-[6px]" data-qualifier-panel>
      <div className="flex items-center gap-[5px] h-[28px]">
        {pickBtn('set', '滴管')}{pickBtn('add', '＋')}{pickBtn('sub', '－')}
        <div className="flex-1" />
        <button {...hold(1)} data-qual-show className="h-[24px] px-[8px] rounded-[6px] text-[10.5px] bg-[#1b1b1b] border border-white/15 text-white/75 active:bg-white active:text-black select-none touch-none">按住看範圍</button>
        <button {...hold(2)} data-qual-matte className="h-[24px] px-[8px] rounded-[6px] text-[10.5px] bg-[#1b1b1b] border border-white/15 text-white/75 active:bg-white active:text-black select-none touch-none">黑白</button>
        <Chip on={q.invert} onClick={() => toggle('invert')} data-qual-invert>反轉</Chip>
        <button onClick={reset} className="w-[22px] h-[24px] flex items-center justify-center" aria-label="重置"><ResetIcon on /></button>
      </div>
      <div className="flex items-center gap-[5px] mt-[6px]">
        {tabs.map(([t, label, useKey]) => (
          <button key={t} onClick={() => setTab(t)} data-qual-tab={t}
            className={`relative flex-1 h-[24px] rounded-[6px] text-[11px] border ${tab === t ? 'bg-white text-black border-white' : 'bg-[#1b1b1b] text-white/65 border-white/10'} ${useKey && !q[useKey] ? 'line-through opacity-60' : ''}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col justify-center">
        {pick ? <div className="text-[10.5px] text-[#ffd34d] mb-[2px]">在畫面上點一下要{pick === 'set' ? '選取' : pick === 'add' ? '加入' : '排除'}的顏色</div>
          : tab === 'c' && isQualRangeDefault(q) ? <div className="text-[10.5px] text-white/40 mb-[2px]">還沒選範圍：先用滴管點畫面選顏色</div> : null}
        {tab === 'h' && <>
          {s('中心', 'hc', P(0, 360, 0), '°', hueCol)}
          {s('寬度', 'hw', P(0, 360, 360), '°')}
          {s('柔化', 'hs', P(0, 90, 0), '°')}
          {s('對稱', 'hsym', P(0, 100, 50))}
        </>}
        {tab === 's' && <>
          {s('低', 'slo', P(0, 100, 0))}{s('高', 'shi', P(0, 100, 100))}{s('低柔化', 'sls', P(0, 50, 0))}{s('高柔化', 'shs', P(0, 50, 0))}
        </>}
        {tab === 'l' && <>
          {s('低', 'llo', P(0, 100, 0))}{s('高', 'lhi', P(0, 100, 100))}{s('低柔化', 'lls', P(0, 50, 0))}{s('高柔化', 'lhs', P(0, 50, 0))}
        </>}
        {tab === 'm' && <>
          {s('黑色裁切', 'bclip', P(0, 100, 0))}
          {s('白色裁切', 'wclip', P(0, 100, 100))}
        </>}
        {tab === 'c' && <>
          {s('色相', 'hue', QUAL_SPEC.hue, '°')}{s('飽和度', 'sat', QUAL_SPEC.sat)}{s('曝光', 'exp', QUAL_SPEC.exp)}
          {s('色溫', 'temp', QUAL_SPEC.temp)}{s('色調', 'tint', QUAL_SPEC.tint)}
        </>}
        {(tab === 'h' || tab === 's' || tab === 'l') && (() => {
          const key = tab === 'h' ? 'useH' : tab === 's' ? 'useS' : 'useL';
          return (
            <div className="flex justify-end mt-[2px]">
              <button onClick={() => toggle(key)} data-qual-use={tab} className="text-[10.5px] text-white/55 px-1">{q[key] ? '這一項：啟用中（點一下關閉）' : '這一項：已關閉（點一下啟用）'}</button>
            </div>
          );
        })()}
      </div>
    </div>
  );
});
