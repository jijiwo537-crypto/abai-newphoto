/* order.html 的「圖標」頁：高光／陰影／白色／黑色的 10 種圖標方案，排在跟 App「調節」一模一樣的按鈕列裡給主人挑。
   點一個圖示可以看它被選中（白底黑圖）的樣子；點「選這組」就勾選，複製時會一起帶出去。 */
import React, { useState } from 'react';
import { Icon } from './Icon';
import { CURRENT_TONE_ICONS, TONE_ICON_SETS, type ToneIconSet } from '../utils/toneIconSets';

export const STORE_TONE_ICON = 'abai-order-tool-tone-icon-v1';
export const loadToneIconPick = (): string => {
  try { const v = localStorage.getItem(STORE_TONE_ICON) || ''; return TONE_ICON_SETS.some(s => s.id === v) ? v : ''; } catch { return ''; }
};

const maskOf = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}")`;

/** 跟 Icon 的內嵌圖一樣的畫法：SVG 當遮罩，顏色用 currentColor */
const Glyph: React.FC<{ body: string }> = ({ body }) => {
  const m = maskOf(body);
  return (
    <span className="inline-flex items-center justify-center text-lg" style={{ width: '1em', height: '1em' }}>
      <span aria-hidden style={{ display: 'block', width: '1em', height: '1em', backgroundColor: 'currentColor', WebkitMaskImage: m, maskImage: m, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' }} />
    </span>
  );
};

/** App「調節」列上，這四個前面的鄰居（一起擺才看得出搭不搭、跟亮度像不像） */
const NEIGHBORS = [['亮度', 'light_mode'], ['曝光', 'brightness_6'], ['對比', 'contrast']] as const;
const TONES = [['高光', 'tone_highlights'], ['陰影', 'tone_shadows'], ['白色', 'tone_whites'], ['黑色', 'tone_blacks']] as const;

const Row: React.FC<{ set: ToneIconSet }> = ({ set }) => {
  const [on, setOn] = useState<string>('tone_highlights');
  const cell = (key: string, label: string, glyph: React.ReactNode) => (
    <button key={key} onClick={e => { e.stopPropagation(); setOn(key); }} className="flex flex-col items-center gap-1.5 shrink-0 w-10">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${on === key ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40'}`}>{glyph}</div>
      <span className={`text-[10px] font-bold ${on === key ? 'text-white' : 'text-white/40'}`}>{label}</span>
    </button>
  );
  return (
    <div className="flex justify-between py-2 px-0.5">
      {NEIGHBORS.map(([label, name]) => cell(name, label, <Icon name={name} className="text-lg" fill={on === name} />))}
      {TONES.map(([label, key]) => cell(key, label, <Glyph body={set[key]} />))}
    </div>
  );
};

export const ToneIconLab: React.FC<{ picked: string; onPick: (id: string) => void }> = ({ picked, onPick }) => (
  <div className="pt-3">
    <div className="text-[11px] text-white/45 leading-relaxed">
      高光、陰影、白色、黑色的圖標 10 種方案。每一列就是 App「調節」那一排的樣子（前面三個是原本的亮度、曝光、對比，方便比較）。
      點圖示可以看被選中的樣子；喜歡哪組就按「選這組」，再按上面的「複製有改的」貼給 Claude。
    </div>
    <div className="mt-3 rounded-2xl border border-white/10 p-3 opacity-70">
      <div className="text-[12px] font-bold text-white/70">對照：{CURRENT_TONE_ICONS.name}</div>
      <Row set={CURRENT_TONE_ICONS} />
    </div>
    {TONE_ICON_SETS.map((s, i) => {
      const sel = picked === s.id;
      return (
        <div key={s.id} data-tone-set={s.id} className={`mt-3 rounded-2xl border p-3 transition-colors ${sel ? 'border-[#7ab8ff] bg-[#7ab8ff]/10' : 'border-white/10 bg-white/[0.02]'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-bold">方案 {i + 1}｜{s.name}</div>
              <div className="text-[11px] text-white/45 mt-0.5 leading-snug">{s.desc}</div>
            </div>
            <button onClick={() => onPick(sel ? '' : s.id)} className={`h-8 px-3 rounded-full text-[12px] font-bold shrink-0 active:scale-95 ${sel ? 'bg-[#7ab8ff] text-black' : 'bg-white/10 text-white/80'}`}>
              {sel ? '已選這組' : '選這組'}
            </button>
          </div>
          <Row set={s} />
        </div>
      );
    })}
  </div>
);
