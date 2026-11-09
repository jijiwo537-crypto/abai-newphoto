/* 排序工具的「符號」頁：長按一顆約 0.3 秒，浮起來後拖到新位置放開。
   預覽用 App「新增符號」同一套按鈕（SymbolGlyph＋同樣的樣式），放在 iPhone 13 Pro 的寬度裡
   （390 點寬、左右各 16 點邊距 ＝ 內容 358 點），排成幾排、哪裡換行都跟手機上一樣。
   注意：電腦沒有 iPhone 的字型（PingFang），符號寬度會略有不同；用 iPhone 打開這頁最準。 */
import React, { useEffect, useRef, useState } from 'react';
import { SymbolGlyph, symbolStretches } from './GridLayoutTool';
import { SYMBOLS } from '../utils/symbols';

const STORE = 'abai-order-tool-symbols-v1';
const HOLD_MS = 280;
const CAT_STORE = 'abai-order-tool-symbol-cats-v1';
const CAT_COLORS = ['#ff5a5a', '#ffb02e', '#4cd964', '#3fa9ff', '#c77dff'];
/** 存的是「目前 App 順序裡的位置」排成的新順序；App 的清單變了就作廢 */
/** 用整串內容（含順序）算指紋：清單換了順序或內容，舊的拖曳結果就作廢 —— 以前只比總長度，換順序後還在套舊的排法，所以看起來跟 App 不一樣 */
const SIG = (() => { let h = 0; for (const c of SYMBOLS.join('\u0001')) h = (h * 31 + c.codePointAt(0)!) | 0; return h; })();
const loadOrder = (): number[] => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v && Array.isArray(v.order) && v.order.length === SYMBOLS.length && v.sig === SIG) return v.order;
  } catch { /* 私密模式 */ }
  return SYMBOLS.map((_, i) => i);
};

export function SymbolOrderLab({ onToast }: { onToast: (s: string) => void }) {
  const [order, setOrder] = useState<number[]>(loadOrder);
  const [drag, setDrag] = useState<{ idx: number; pointerId: number; dx: number; dy: number; x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef(drag); dragRef.current = drag;
  const hold = useRef<{ x: number; y: number; pointerId: number; timer: number } | null>(null);
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ order, sig: SIG })); } catch { /* 私密模式 */ }
  }, [order]);
  const changed = order.some((v, i) => v !== i);
  /* 分類：最多 5 類。用符號本身的內容記（不是位置），App 換順序也不會跑掉 */
  const [cats, setCats] = useState<{ names: string[]; of: Record<string, number> }>(() => {
    try { const v = JSON.parse(localStorage.getItem(CAT_STORE) || 'null'); if (v && Array.isArray(v.names) && v.of) return v; } catch { /* 私密模式 */ }
    return { names: ['', '', '', '', ''], of: {} };
  });
  useEffect(() => { try { localStorage.setItem(CAT_STORE, JSON.stringify(cats)); } catch { /* 私密模式 */ } }, [cats]);
  /** 目前拿在手上的分類（-1＝沒拿，點符號不會分類；-2＝橡皮擦） */
  const [brush, setBrush] = useState(-1);
  const draggedRef = useRef(false);
  const tagged = Object.keys(cats.of).length;
  const onTap = (idx: number) => {
    if (draggedRef.current) { draggedRef.current = false; return; }
    if (brush === -1) return;
    const key = SYMBOLS[idx];
    setCats(c => {
      const of = { ...c.of };
      if (brush === -2 || of[key] === brush) delete of[key]; else of[key] = brush;
      return { ...c, of };
    });
  };
  // 拖曳中不讓頁面跟著捲動（iOS 要在 touchmove 上 preventDefault，而且不能是 passive）
  useEffect(() => {
    const block = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);

  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };
  const onDown = (e: React.PointerEvent, idx: number) => {
    if (dragRef.current) return;
    const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, pointerId = e.pointerId;
    cancelHold();
    hold.current = { x: sx, y: sy, pointerId, timer: window.setTimeout(() => {
      hold.current = null;
      try { el.setPointerCapture(pointerId); } catch { /* 舊瀏覽器 */ }
      navigator.vibrate?.(8);
      draggedRef.current = true;
      setDrag({ idx, pointerId, dx: sx - r.left, dy: sy - r.top, x: sx, y: sy, w: r.width, h: r.height });
    }, HOLD_MS) };
  };
  const onMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (h && h.pointerId === e.pointerId && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) cancelHold();
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.preventDefault();
    setDrag({ ...d, x: e.clientX, y: e.clientY });
    const target = document.elementsFromPoint(e.clientX, e.clientY)
      .map(n => (n as HTMLElement).closest?.('[data-sym]') as HTMLElement | null)
      .find(n => n && Number(n.dataset.sym) !== d.idx);
    if (!target) return;
    const to = Number(target.dataset.sym);
    setOrder(o => {
      const a = o.slice(), from = a.indexOf(d.idx), at = a.indexOf(to);
      if (from < 0 || at < 0) return o;
      a.splice(from, 1); a.splice(at, 0, d.idx);
      return a;
    });
  };
  const onUp = (e: React.PointerEvent) => { cancelHold(); if (dragRef.current?.pointerId === e.pointerId) setDrag(null); };

  const copyText = () => [
    '【ABAI 符號順序 v1】請把「新增符號」改成這個順序（數字是目前 App 清單裡的第幾顆，從 0 開始）：',
    order.join(','),
    ...(tagged ? ['', '【分類】（同一類的放在一起；數字同上）', ...cats.names.map((n, k) => {
      const ids = order.filter(i => cats.of[SYMBOLS[i]] === k);
      return ids.length ? `第${k + 1}類「${n || '未命名'}」：${ids.join(',')}` : '';
    }).filter(Boolean), `未分類：${order.filter(i => cats.of[SYMBOLS[i]] === undefined).join(',')}`] : []),
  ].join('\n');
  const copy = async () => {
    const t = copyText();
    try { await navigator.clipboard.writeText(t); }
    catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); }
    onToast(tagged ? '已複製符號順序與分類' : '已複製符號順序');
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[11px] text-white/45 leading-relaxed">預覽＝iPhone 13 Pro 的寬度。電腦沒有 iPhone 的字型，用 iPhone 打開這頁最準。</p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => { setOrder(SYMBOLS.map((_, i) => i)); onToast('已回到 App 目前的順序'); }}
            className="h-8 px-3 rounded-full border border-white/15 text-[12px] text-white/70">重設</button>
          <button onClick={copy} disabled={!changed && !tagged}
            className={`h-8 px-3 rounded-full text-[12px] font-bold ${changed || tagged ? 'bg-white text-black' : 'bg-white/10 text-white/35'}`}>複製順序</button>
        </div>
      </div>
      {/* 分類：先點上面一類（可以改名字），再點下面的符號 —— 點一下加入、再點一下取消。長按拖曳照常可以用 */}
      <div className="mb-3 rounded-2xl border border-white/10 p-3">
        <p className="text-[11px] text-white/45 mb-2">分類（最多 5 類）：先選一類，再點符號。已分類 {tagged} / {SYMBOLS.length}</p>
        <div className="flex flex-wrap gap-2">
          {cats.names.map((n, k) => (
            <div key={k} onClick={() => setBrush(b => (b === k ? -1 : k))}
              className="flex items-center gap-1.5 h-9 pl-2 pr-1 rounded-full border cursor-pointer"
              style={{ borderColor: brush === k ? CAT_COLORS[k] : 'rgba(255,255,255,.15)', background: brush === k ? CAT_COLORS[k] + '33' : 'transparent' }}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: CAT_COLORS[k] }} />
              <input value={n} placeholder={`第${k + 1}類`} onClick={e => { e.stopPropagation(); setBrush(k); }}
                onChange={e => { const v = e.target.value; setCats(c => { const names = c.names.slice(); names[k] = v; return { ...c, names }; }); }}
                className="w-20 border-0 p-0 bg-transparent text-[12px] text-white outline-none placeholder:text-white/35" />
              <span className="text-[10px] text-white/40 pr-1">{Object.values(cats.of).filter(v => v === k).length}</span>
            </div>
          ))}
          <button onClick={() => setBrush(b => (b === -2 ? -1 : -2))}
            className={`h-9 px-3 rounded-full border text-[12px] ${brush === -2 ? 'border-white text-white' : 'border-white/15 text-white/60'}`}>橡皮擦</button>
          <button onClick={() => { if (confirm('清掉所有分類？')) setCats(c => ({ ...c, of: {} })); }}
            className="h-9 px-3 rounded-full border border-white/15 text-[12px] text-white/60">清除分類</button>
        </div>
      </div>
      {/* 手機框：390 寬、內容左右各 16 */}
      {/* 固定 390 寬：在手機上會吃掉頁面左右的留白、剛好等於螢幕寬；在電腦上置中 */}
      <div className="rounded-[28px] border border-white/15 bg-black overflow-hidden" style={{ width: 390, marginLeft: 'calc((100% - 390px) / 2)' }}>
        <div className="pt-1" style={{ padding: '12px 16px 24px' }}>
          <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">新增符號</span>
          {/* 跟 App 同一層濾鏡：整片轉白（彩色 emoji 也一樣） */}
          <div className="flex flex-wrap gap-1.5 pb-4 mt-3">
            {order.map(idx => (
              <button key={idx} data-sym={idx}
                onPointerDown={e => onDown(e, idx)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                onContextMenu={e => e.preventDefault()} onClick={() => onTap(idx)}
                style={{ boxShadow: cats.of[SYMBOLS[idx]] !== undefined ? `inset 0 0 0 2px ${CAT_COLORS[cats.of[SYMBOLS[idx]]]}` : undefined, opacity: drag?.idx === idx ? .25 : 1, WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', touchAction: drag ? 'none' : 'manipulation' }}
                className={`${symbolStretches(SYMBOLS[idx]) ? 'grow ' : ''}min-h-11 px-3 py-1 max-w-full overflow-visible rounded-[10px] bg-white/5 border border-white/10 inline-flex items-center justify-center text-white/85`}>
                <span style={{ filter: 'grayscale(1) brightness(0) invert(1)' }}><SymbolGlyph text={SYMBOLS[idx]} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {drag && (
        <div style={{ position: 'fixed', left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w, height: drag.h, pointerEvents: 'none', zIndex: 50, filter: 'grayscale(1) brightness(0) invert(1)' }}
          className="rounded-[10px] bg-white/15 border border-white/40 inline-flex items-center justify-center text-white shadow-2xl">
          <SymbolGlyph text={SYMBOLS[drag.idx]} />
        </div>
      )}
    </div>
  );
}
