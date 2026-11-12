/* order.html 的「主頁」頁：修圖首頁那 7 顆灰色功能鍵（相機、創意拼圖、跨頁拼圖、美顏、仿色、藝術效果、點陣文字）
   的 5 種材質／樣式方案。版面、尺寸跟 App 裡完全一樣，只換外觀，挑好跟我說是哪一個。 */
import React, { useState } from 'react';
import { Icon } from './Icon';

type Skin = { id: string; name: string; note: string; tile: React.CSSProperties; icon: string; label: string; cardExtra?: React.CSSProperties; accent?: boolean };

const SKINS: Skin[] = [
  { id: 'A', name: 'A 霧面玻璃', note: '半透明白霧＋背景模糊，上緣一條細高光，沒有框線。輕、通透。',
    tile: { background: 'rgba(255,255,255,.075)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12)' },
    icon: 'text-white/80', label: 'text-white/80' },
  { id: 'B', name: 'B 深色實心', note: '跟新的儲存選單同一系：接近黑的實心底、沒有框線，最沉穩、最乾淨。',
    tile: { background: '#121214' }, icon: 'text-white/75', label: 'text-white/70' },
  { id: 'C', name: 'C 細線框', note: '幾乎透明，只留一圈很細的線，最輕盈、最極簡。',
    tile: { background: 'transparent', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.16)' }, icon: 'text-white/70', label: 'text-white/70' },
  { id: 'D', name: 'D 立體漸層', note: '由上往下的深灰漸層＋上緣高光＋底部陰影，像實體按鍵，有厚度。',
    tile: { background: 'linear-gradient(180deg,#2a2a2e 0%,#18181b 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10), 0 6px 14px rgba(0,0,0,.45)' },
    icon: 'text-white/85', label: 'text-white/80' },
  { id: 'E', name: 'E 彩色微光', note: '深色底，每個功能的圖示帶自己的顏色，背後一圈淡淡的同色光暈，比較活潑。',
    tile: { background: '#111113' }, icon: '', label: 'text-white/75', accent: true },
];

const ACCENT: Record<string, string> = { camera: '#7ab8ff', collage: '#ff8fb1', layout: '#8be3c4', beauty: '#ffc56b', match: '#b79bff', art: '#ff9f6b', dot: '#6fd3ff' };
const TOOLS = [
  { k: 'collage', icon: 'layers', label: '創意拼圖' }, { k: 'layout', icon: 'grid_view', label: '跨頁拼圖' },
  { k: 'beauty', icon: 'magic_button', label: '美顏' }, { k: 'match', icon: 'colorize', label: '仿色' },
];

const tileStyle = (s: Skin, key: string): React.CSSProperties => s.accent
  ? { ...s.tile, backgroundImage: `radial-gradient(120% 90% at 50% 35%, ${ACCENT[key]}22 0%, transparent 60%)`, boxShadow: `inset 0 0 0 1px ${ACCENT[key]}1f` }
  : s.tile;
const iconStyle = (s: Skin, key: string): React.CSSProperties | undefined => s.accent ? { color: ACCENT[key] } : undefined;

function Preview({ s }: { s: Skin }) {
  return (
    <div className="rounded-2xl p-3 bg-black" style={{ backgroundImage: 'radial-gradient(80% 60% at 70% 0%, rgba(90,110,255,.25), transparent 70%), radial-gradient(60% 50% at 0% 100%, rgba(255,120,160,.18), transparent 70%)' }}>
      <div className="flex gap-2">
        <div className="flex-1 h-[75px] rounded-[13px] bg-white text-black flex items-center justify-center gap-[9px]">
          <Icon name="add_photo_alternate" className="text-[24px]" /><span className="text-sm font-black tracking-[0.06em]">編輯</span>
        </div>
        <div className="flex-1 h-[75px] rounded-[13px] flex items-center justify-center gap-[9px] text-white" style={tileStyle(s, 'camera')}>
          <span style={iconStyle(s, 'camera')}><Icon name="photo_camera" className={`text-[24px] ${s.icon}`} /></span><span className="text-sm font-black tracking-[0.06em]">相機</span>
        </div>
      </div>
      <div className="mt-[11px] flex gap-2">
        {TOOLS.map(t => (
          <div key={t.k} className="flex-1 min-w-0 h-[75px] rounded-[13px] flex flex-col items-center justify-center gap-[9px] text-white" style={tileStyle(s, t.k)}>
            <span style={iconStyle(s, t.k)}><Icon name={t.icon} className={`text-[22px] ${s.icon}`} /></span>
            <span className={`text-[10px] font-bold tracking-[0.06em] whitespace-nowrap ${s.label}`}>{t.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-[14px] flex gap-2">
        {[['art', '藝術效果', '一鍵套用藝術風格'], ['dot', '點陣文字', '將圖片轉點陣圖案']].map(([k, t, sub]) => (
          <div key={k} className="relative flex-1 min-w-0 rounded-[14px] overflow-hidden text-left" style={tileStyle(s, k)}>
            <div className="px-[14px] pt-7 pb-4">
              <span className="relative -top-1 block text-[16px] font-black tracking-[0.04em] text-white" style={s.accent ? { color: ACCENT[k] } : undefined}>{t}</span>
              <span className="block text-[11px] tracking-[0.04em] text-white/65 truncate">{sub}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-white/80">立即使用 <Icon name="chevron_right" className="text-[14px]" /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeButtonLab({ onToast }: { onToast: (m: string) => void }) {
  const [picked, setPicked] = useState<string>(() => { try { return localStorage.getItem('abai:homeSkinPick') || ''; } catch { return ''; } });
  const pick = (id: string) => { setPicked(id); try { localStorage.setItem('abai:homeSkinPick', id); } catch { /* 沒關係 */ } onToast(`已選 ${id}，回到對話告訴我就會套用到 App`); };
  return (
    <div className="flex flex-col gap-5 mt-2">
      <div className="text-[11px] text-white/45 leading-relaxed">修圖首頁那 7 顆灰色功能鍵的 5 種樣式。尺寸、位置跟 App 裡一樣，背景加了一點顏色，方便看出透明／模糊的效果。點「選這個」記下來，再回到對話告訴我是哪一個。</div>
      {SKINS.map(s => (
        <div key={s.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold">{s.name}</div>
              <div className="text-[11px] text-white/45 mt-0.5 leading-relaxed pr-3">{s.note}</div>
            </div>
            <button onClick={() => pick(s.id)} className={`h-8 px-3 shrink-0 rounded-full text-[12px] font-bold ${picked === s.id ? 'bg-white text-black' : 'bg-white/10 text-white/80'}`}>{picked === s.id ? '已選' : '選這個'}</button>
          </div>
          <Preview s={s} />
        </div>
      ))}
    </div>
  );
}
