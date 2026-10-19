import React, { useLayoutEffect, useRef } from 'react';

/* 所有照片編輯介面最下面那一排分類（濾鏡、調節…）共用的樣子：
   只有文字、選中的下面有一條短底線；文字放在 44px 那一列，下面再留 26px，
   手指不用貼著螢幕最下緣（iPhone 的橫條）去按。左右各留 12px，最邊邊那兩顆不會貼著螢幕邊。
   EDIT_BAR_H 是這一排的總高（不含上緣 1px 細線），構圖舞台、控制區高度都靠它對齊。 */
export const EDIT_BAR_ROW = 44;
export const EDIT_BAR_PAD = 26;
export const EDIT_BAR_H = EDIT_BAR_ROW + EDIT_BAR_PAD;

/** 一排分類。scroll：可以左右滑、一次看到 7 個（主頁進來的編輯用） */
export const EditBar: React.FC<{ children: React.ReactNode; scroll?: boolean; className?: string }> = ({ children, scroll, className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);
  /* 選中的那一顆不在畫面裡（或貼著邊）就把它捲到中間。
     只在「選中的換了」才量：編輯器每 render 一次都去讀 offsetLeft 會逼瀏覽器當場重排，切分頁就慢一拍 */
  const lastOnRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!scroll || !el) return;
    const on = el.querySelector('[data-edit-tab-on="1"]') as HTMLElement | null; if (!on) return;
    const id = on.getAttribute('data-edit-tab');
    if (id === lastOnRef.current) return;
    lastOnRef.current = id;
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < el.scrollLeft + on.offsetWidth * 0.5 || r > el.scrollLeft + el.clientWidth - on.offsetWidth * 0.5) {
      el.scrollTo({ left: l - (el.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
    }
  });
  return (
    <div ref={ref} data-edit-bar
      className={`flex border-t border-white/10 bg-black shrink-0 box-content ${scroll ? 'pl-3 overflow-x-auto overflow-y-hidden no-scrollbar touch-pan-x scroll-px-3' : 'px-3'} ${className}`}
      style={{ height: EDIT_BAR_ROW, paddingBottom: EDIT_BAR_PAD }}>
      {children}
      {/* 捲動容器右邊的 padding 在 Safari 不算進可捲範圍：用一個空格子撐出右側距離 */}
      {scroll && <span aria-hidden className="shrink-0 w-3" />}
    </div>
  );
};

export const EditBarTab: React.FC<{ active: boolean; label: string; onClick: () => void; scroll?: boolean; id?: string }> = ({ active, label, onClick, scroll, id }) => (
  <button onClick={onClick} data-edit-tab={id} data-edit-tab-on={active ? '1' : '0'}
    style={scroll ? { width: 'calc((100% - 12px) / 7)' } : undefined}
    className={`relative h-full flex items-center justify-center transition-colors duration-200 ${scroll ? 'shrink-0' : 'flex-1'} ${active ? 'text-white' : 'text-white/50'}`}>
    <span className="text-[12.5px] font-normal tracking-[0.04em] whitespace-nowrap">{label}</span>
    <span aria-hidden className={`absolute left-1/2 bottom-[4px] -ml-[9px] w-[18px] h-[2px] rounded-full bg-white transition-[opacity,transform] duration-200 ${active ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'}`} />
  </button>
);
