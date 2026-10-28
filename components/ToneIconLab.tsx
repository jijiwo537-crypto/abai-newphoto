/* order.html 的「圖標」頁：分兩組各挑一對 —— 高光↔陰影 10 種、白色↔黑色 10 種。
   每一列都擺在跟 App「調節」一模一樣的按鈕裡，前面放原本的亮度、曝光、對比，看精緻度搭不搭。
   點一個圖示可以看它被選中（白底黑圖）的樣子；點「選這對」就勾選，複製時會一起帶出去。 */
import React, { useState } from 'react';
import { Icon } from './Icon';
import { CURRENT_HS, CURRENT_WB, HS_PAIRS, WB_PAIRS, type IconPair } from '../utils/toneIconSets';

export const STORE_TONE_ICON = 'abai-order-tool-tone-icon-v2';
export type ToneIconPick = { hs: string; wb: string };
export const loadToneIconPick = (): ToneIconPick => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_TONE_ICON) || '{}');
    return { hs: HS_PAIRS.some(p => p.id === v?.hs) ? v.hs : '', wb: WB_PAIRS.some(p => p.id === v?.wb) ? v.wb : '' };
  } catch { return { hs: '', wb: '' }; }
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

/** App「調節」列上的鄰居（一起擺才看得出精緻度搭不搭、跟亮度像不像） */
const NEIGHBORS = [['亮度', 'light_mode'], ['曝光', 'brightness_6'], ['對比', 'contrast']] as const;

const Row: React.FC<{ pair: IconPair; labels: [string, string] }> = ({ pair, labels }) => {
  const [on, setOn] = useState('a');
  const cell = (key: string, label: string, glyph: React.ReactNode) => (
    <button key={key} onClick={() => setOn(key)} className="flex flex-col items-center gap-1.5 shrink-0 w-10">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${on === key ? 'bg-white text-black scale-110' : 'bg-white/5 text-white/40'}`}>{glyph}</div>
      <span className={`text-[10px] font-bold ${on === key ? 'text-white' : 'text-white/40'}`}>{label}</span>
    </button>
  );
  return (
    <div className="flex justify-between py-2 px-0.5">
      {NEIGHBORS.map(([label, name]) => cell(name, label, <Icon name={name} className="text-lg" fill={on === name} />))}
      {cell('a', labels[0], <Glyph body={pair.a} />)}
      {cell('b', labels[1], <Glyph body={pair.b} />)}
    </div>
  );
};

const Section: React.FC<{ title: string; labels: [string, string]; current: IconPair; pairs: IconPair[]; picked: string; onPick: (id: string) => void }> =
  ({ title, labels, current, pairs, picked, onPick }) => (
    <div className="mt-5">
      <div className="text-[14px] font-bold">{title}</div>
      <div className="mt-2 rounded-2xl border border-white/10 p-3 opacity-70">
        <div className="text-[12px] font-bold text-white/70">對照：{current.name}</div>
        <Row pair={current} labels={labels} />
      </div>
      {pairs.map((p, i) => {
        const sel = picked === p.id;
        return (
          <div key={p.id} data-icon-pair={p.id} className={`mt-3 rounded-2xl border p-3 transition-colors ${sel ? 'border-[#7ab8ff] bg-[#7ab8ff]/10' : 'border-white/10 bg-white/[0.02]'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-bold">{i + 1}｜{p.name}</div>
                <div className="text-[11px] text-white/45 mt-0.5 leading-snug">{p.desc}</div>
              </div>
              <button onClick={() => onPick(sel ? '' : p.id)} className={`h-8 px-3 rounded-full text-[12px] font-bold shrink-0 active:scale-95 ${sel ? 'bg-[#7ab8ff] text-black' : 'bg-white/10 text-white/80'}`}>
                {sel ? '已選這對' : '選這對'}
              </button>
            </div>
            <Row pair={p} labels={labels} />
          </div>
        );
      })}
    </div>
  );

export const ToneIconLab: React.FC<{ picked: ToneIconPick; onPick: (p: ToneIconPick) => void }> = ({ picked, onPick }) => (
  <div className="pt-3">
    <div className="text-[11px] text-white/45 leading-relaxed">
      分兩組各挑一對：高光↔陰影、白色↔黑色。每一列就是 App「調節」那一排的樣子（前面三個是原本的亮度、曝光、對比，方便比較精緻度）。
      點圖示可以看被選中的樣子；兩組各按一次「選這對」，再按上面的「複製有改的」貼給 Claude。
    </div>
    <Section title="高光 ↔ 陰影" labels={['高光', '陰影']} current={CURRENT_HS} pairs={HS_PAIRS} picked={picked.hs} onPick={hs => onPick({ ...picked, hs })} />
    <Section title="白色 ↔ 黑色" labels={['白色', '黑色']} current={CURRENT_WB} pairs={WB_PAIRS} picked={picked.wb} onPick={wb => onPick({ ...picked, wb })} />
  </div>
);
