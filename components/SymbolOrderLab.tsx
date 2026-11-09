/* 排序工具的「符號」頁：長按一顆約 0.3 秒，浮起來後拖到新位置放開；也可以新增、刪除符號。
   預覽用 App「新增符號」同一套按鈕（SymbolGlyph＋同樣的樣式），放在 iPhone 13 Pro 的寬度裡
   （390 點寬、左右各 16 點邊距 ＝ 內容 358 點），排成幾排、哪裡換行都跟手機上一樣。
   注意：電腦沒有 iPhone 的字型（PingFang），符號寬度會略有不同；用 iPhone 打開這頁最準。 */
import React, { useEffect, useRef, useState } from 'react';
import { SymbolGlyph } from './GridLayoutTool';
import { SYMBOLS } from '../utils/symbols';
import { packSymbols } from '../utils/symbolPack';

const STORE = 'abai-order-tool-symbols-v2';
const HOLD_MS = 280;
const CAT_STORE = 'abai-order-tool-symbol-cats-v1';
const CAT_COLORS = ['#ff5a5a', '#ffb02e', '#4cd964', '#3fa9ff', '#c77dff'];
/** App 目前清單的指紋：App 的清單換了，這頁存著的舊編輯就作廢、回到 App 目前的樣子 */
const SIG = (() => { let h = 0; for (const c of SYMBOLS.join('\u0001')) h = (h * 31 + c.codePointAt(0)!) | 0; return h; })();
/** 存的是整份清單（符號本身），新增、刪除、換順序都在裡面 */
const loadList = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v && Array.isArray(v.list) && v.sig === SIG && v.list.every((s: unknown) => typeof s === 'string')) return v.list;
  } catch { /* 私密模式 */ }
  return SYMBOLS.slice();
};
/** 複製出去的清單用 \uXXXX 寫：組合附加符號在複製貼上時才不會被改壞（同 utils/symbols.ts 的理由） */
const escapeSym = (s: string) => JSON.stringify(s).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export function SymbolOrderLab({ onToast }: { onToast: (s: string) => void }) {
  const [list, setList] = useState<string[]>(loadList);
  const [drag, setDrag] = useState<{ sym: string; pointerId: number; dx: number; dy: number; x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef(drag); dragRef.current = drag;
  const hold = useRef<{ x: number; y: number; pointerId: number; timer: number } | null>(null);
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ list, sig: SIG })); } catch { /* 私密模式 */ }
  }, [list]);
  const changed = list.length !== SYMBOLS.length || list.some((v, i) => v !== SYMBOLS[i]);
  const added = list.filter(s => !SYMBOLS.includes(s)).length, removed = SYMBOLS.filter(s => !list.includes(s)).length;
  /* 分類：最多 5 類。用符號本身的內容記（不是位置），App 換順序也不會跑掉 */
  const [cats, setCats] = useState<{ names: string[]; of: Record<string, number> }>(() => {
    try { const v = JSON.parse(localStorage.getItem(CAT_STORE) || 'null'); if (v && Array.isArray(v.names) && v.of) return v; } catch { /* 私密模式 */ }
    return { names: ['', '', '', '', ''], of: {} };
  });
  useEffect(() => { try { localStorage.setItem(CAT_STORE, JSON.stringify(cats)); } catch { /* 私密模式 */ } }, [cats]);
  /** 手上拿的工具：-1＝沒拿（點符號沒反應）；0～4＝分類；-2＝橡皮擦（取消分類）；-3＝刪除符號 */
  const [brush, setBrush] = useState(-1);
  const draggedRef = useRef(false);
  const tagged = list.filter(s => cats.of[s] !== undefined).length;
  const onTap = (sym: string) => {
    if (draggedRef.current) { draggedRef.current = false; return; }
    if (brush === -3) { if (!SYMBOLS.includes(sym)) setExtraGone(g => (g.includes(sym) ? g : [...g, sym])); setList(l => l.filter(s => s !== sym)); onToast('已刪除（下面「已刪除」區點一下可以加回來）'); return; }
    if (brush === -1) return;
    setCats(c => {
      const of = { ...c.of };
      if (brush === -2 || of[sym] === brush) delete of[sym]; else of[sym] = brush;
      return { ...c, of };
    });
  };
  /** 在這裡誤刪、還沒交出去的符號：App 清單裡有、這裡刪掉的，加上自己新增後又刪掉的（已經從 App 拿掉的不列） */
  const [extraGone, setExtraGone] = useState<string[]>([]);
  const gone = [...SYMBOLS, ...extraGone].filter((s, i, a) => a.indexOf(s) === i && !list.includes(s));
  const restore = (sym: string) => { setList(l => (l.includes(sym) ? l : [...l, sym])); onToast('已加回清單最後面'); };
  /* 新增：貼上或打字，加在最後面（再拖到想要的位置） */
  const [draft, setDraft] = useState('');
  const addSym = () => {
    const s = draft.trim();
    if (!s) return;
    if (list.includes(s)) { onToast('清單裡已經有這個符號'); return; }
    setList(l => [...l, s]); setDraft('');
    onToast('已加在最後面，長按可以拖到想要的位置');
  };
  // 拖曳中不讓頁面跟著捲動（iOS 要在 touchmove 上 preventDefault，而且不能是 passive）
  useEffect(() => {
    const block = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);

  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };
  const onDown = (e: React.PointerEvent, sym: string) => {
    if (dragRef.current) return;
    const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, pointerId = e.pointerId;
    cancelHold();
    hold.current = { x: sx, y: sy, pointerId, timer: window.setTimeout(() => {
      hold.current = null;
      try { el.setPointerCapture(pointerId); } catch { /* 舊瀏覽器 */ }
      navigator.vibrate?.(8);
      draggedRef.current = true;
      setDrag({ sym, pointerId, dx: sx - r.left, dy: sy - r.top, x: sx, y: sy, w: r.width, h: r.height });
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
      .find(n => n && list[Number(n.dataset.sym)] !== d.sym);
    if (!target) return;
    const to = list[Number(target.dataset.sym)];
    setList(o => {
      const a = o.slice(), from = a.indexOf(d.sym), at = a.indexOf(to);
      if (from < 0 || at < 0) return o;
      a.splice(from, 1); a.splice(at, 0, d.sym);
      return a;
    });
  };
  const onUp = (e: React.PointerEvent) => { cancelHold(); if (dragRef.current?.pointerId === e.pointerId) setDrag(null); };

  /* 自動排列：用「這台手機」實際畫出來的按鈕寬度排（見 utils/symbolPack）。
     分類裡名字有「邊框」的那一類放最下面、有「顏文字」的放中間，其他的放上面 */
  const gridRef = useRef<HTMLDivElement>(null);
  const [packing, setPacking] = useState(false);
  const autoPack = () => {
    const grid = gridRef.current;
    if (!grid) return;
    /* 類名繁簡都認（顏／颜、邊／边），也認「表情」 */
    const norm = (n: string) => n.replace(/颜/g, '顏').replace(/边/g, '邊').replace(/\s/g, '');
    const catOf = (...words: string[]) => cats.names.findIndex(n => words.some(w => norm(n).includes(w)));
    const kc = catOf('顏文字', '表情'), bc = catOf('邊框');
    if (kc < 0 && list.some(sym => cats.of[sym] !== undefined)) {
      alert('找不到「顏文字」這一類：請把顏文字那一類的名字改成「顏文字」，自動排列才知道哪些要排在一起。');
      return;
    }
    if (bc < 0 && kc < 0 && !confirm('沒有找到名字叫「邊框」或「顏文字」的分類，要把全部當成同一區排嗎？')) return;
    setPacking(true);
    setTimeout(() => {
      try {
        const els = Array.from(grid.querySelectorAll('[data-sym]')) as HTMLElement[];
        const widths = list.map((_, i) => els.find(e => Number(e.dataset.sym) === i)?.getBoundingClientRect().width ?? 0);
        const group = list.map(sym => (cats.of[sym] === bc ? 2 : cats.of[sym] === kc ? 1 : 0));
        const cs = getComputedStyle(grid);
        const { order, rowGaps } = packSymbols({ widths, group, cap: grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), gap: parseFloat(cs.columnGap) || 6, tries: 600 });
        setList(order.map(i => list[i]));
        const big = rowGaps.slice(0, -1).filter(g => g > 60).length;
        onToast(`已依這台手機的寬度排好（顏文字＝${cats.names[kc] || '—'}、邊框＝${bc >= 0 ? cats.names[bc] : '—'}）：${rowGaps.length} 排，最大空白 ${Math.round(Math.max(0, ...rowGaps.slice(0, -1)))} 點${big ? `（${big} 排超過 60 點，多是只放得下一顆的長邊框）` : ''}`);
      } finally { setPacking(false); }
    }, 30);
  };

  const copyText = () => [
    '【ABAI 符號清單 v2】請把「新增符號」改成這份清單（照這個順序；新增、刪除都已經算進去）：',
    `共 ${list.length} 顆（新增 ${added}、刪除 ${removed}）`,
    '[',
    ...list.map(s => `  ${escapeSym(s)},`),
    ']',
    ...(tagged ? ['', '【分類】（數字＝上面清單的第幾顆，從 0 開始）', ...cats.names.map((n, k) => {
      const ids = list.map((s, i) => (cats.of[s] === k ? i : -1)).filter(i => i >= 0);
      return ids.length ? `第${k + 1}類「${n || '未命名'}」：${ids.join(',')}` : '';
    }).filter(Boolean), `未分類：${list.map((s, i) => (cats.of[s] === undefined ? i : -1)).filter(i => i >= 0).join(',')}`] : []),
  ].join('\n');
  const copy = async () => {
    const t = copyText();
    try { await navigator.clipboard.writeText(t); }
    catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); }
    onToast('已複製符號清單');
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[11px] text-white/45 leading-relaxed">預覽＝iPhone 13 Pro 的寬度。請用 iPhone 打開這頁再按「自動排列」：每顆的寬度看字型，要用手機的才準。</p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => { if (!changed || confirm('回到 App 目前的清單？（新增、刪除、排序都會復原）')) { setList(SYMBOLS.slice()); onToast('已回到 App 目前的清單'); } }}
            className="h-8 px-3 rounded-full border border-white/15 text-[12px] text-white/70">重設</button>
          <button onClick={autoPack} disabled={packing}
            className="h-8 px-3 rounded-full border border-white/30 text-[12px] text-white">{packing ? '排列中…' : '自動排列'}</button>
          <button onClick={copy} disabled={!changed && !tagged}
            className={`h-8 px-3 rounded-full text-[12px] font-bold ${changed || tagged ? 'bg-white text-black' : 'bg-white/10 text-white/35'}`}>複製清單</button>
        </div>
      </div>
      {/* 新增／刪除 */}
      <div className="mb-3 rounded-2xl border border-white/10 p-3">
        <p className="text-[11px] text-white/45 mb-2">新增：貼上符號後按「加入」（會放在最後面）。刪除：按「刪除模式」再點符號。目前 {list.length} 顆{added || removed ? `（新增 ${added}、刪除 ${removed}）` : ''}</p>
        <div className="flex gap-2">
          <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSym(); }} placeholder="貼上新的符號"
            className="flex-1 min-w-0 h-9 px-3 rounded-full bg-white/5 border border-white/15 text-[13px] text-white outline-none placeholder:text-white/35" />
          <button onClick={addSym} disabled={!draft.trim()}
            className={`h-9 px-3 rounded-full text-[12px] font-bold ${draft.trim() ? 'bg-white text-black' : 'bg-white/10 text-white/35'}`}>加入</button>
          <button onClick={() => setBrush(b => (b === -3 ? -1 : -3))}
            className={`h-9 px-3 rounded-full border text-[12px] ${brush === -3 ? 'border-[#ff5a5a] text-[#ff5a5a] bg-[#ff5a5a22]' : 'border-white/15 text-white/60'}`}>{brush === -3 ? '刪除中…（再按結束）' : '刪除模式'}</button>
        </div>
      </div>
      {gone.length > 0 && (
        <div className="mb-3 rounded-2xl border border-white/10 p-3">
          <p className="text-[11px] text-white/45 mb-2">已刪除（{gone.length}）：點一下加回清單最後面</p>
          <div className="flex flex-wrap gap-1.5">
            {gone.map(sym => (
              <button key={sym} onClick={() => restore(sym)}
                className="min-h-9 px-2 py-1 max-w-full rounded-[10px] bg-white/5 border border-dashed border-white/25 inline-flex items-center justify-center text-white/60">
                <span style={{ filter: 'grayscale(1) brightness(0) invert(1)', opacity: .6 }}><SymbolGlyph text={sym} base={12} /></span>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* 分類：先點上面一類（可以改名字），再點下面的符號 —— 點一下加入、再點一下取消。長按拖曳照常可以用 */}
      <div className="mb-3 rounded-2xl border border-white/10 p-3">
        <p className="text-[11px] text-white/45 mb-2">分類（最多 5 類）：先選一類，再點符號。已分類 {tagged} / {list.length}</p>
        <div className="flex flex-wrap gap-2">
          {cats.names.map((n, k) => (
            <div key={k} onClick={() => setBrush(b => (b === k ? -1 : k))}
              className="flex items-center gap-1.5 h-9 pl-2 pr-1 rounded-full border cursor-pointer"
              style={{ borderColor: brush === k ? CAT_COLORS[k] : 'rgba(255,255,255,.15)', background: brush === k ? CAT_COLORS[k] + '33' : 'transparent' }}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: CAT_COLORS[k] }} />
              <input value={n} placeholder={`第${k + 1}類`} onClick={e => { e.stopPropagation(); setBrush(k); }}
                onChange={e => { const v = e.target.value; setCats(c => { const names = c.names.slice(); names[k] = v; return { ...c, names }; }); }}
                className="w-20 border-0 p-0 bg-transparent text-[12px] text-white outline-none placeholder:text-white/35" />
              <span className="text-[10px] text-white/40 pr-1">{list.filter(s => cats.of[s] === k).length}</span>
            </div>
          ))}
          <button onClick={() => setBrush(b => (b === -2 ? -1 : -2))}
            className={`h-9 px-3 rounded-full border text-[12px] ${brush === -2 ? 'border-white text-white' : 'border-white/15 text-white/60'}`}>橡皮擦</button>
          <button onClick={() => { if (confirm('清掉所有分類？')) setCats(c => ({ ...c, of: {} })); }}
            className="h-9 px-3 rounded-full border border-white/15 text-[12px] text-white/60">清除分類</button>
        </div>
      </div>
      {/* 手機框：390 寬（外框線各 1 點另外算，所以是 392）、內容左右各 16 ＝ 358 */}
      {/* 固定 390 寬：在手機上會吃掉頁面左右的留白、剛好等於螢幕寬；在電腦上置中 */}
      <div className="rounded-[28px] border border-white/15 bg-black overflow-hidden" style={{ width: 392, marginLeft: 'calc((100% - 392px) / 2)' }}>
        <div className="pt-1" style={{ padding: '12px 16px 24px' }}>
          <span className="text-[10px] font-bold text-[#888] uppercase tracking-widest">新增符號</span>
          <div ref={gridRef} className="flex flex-wrap gap-1.5 pb-4 mt-3">
            {list.map((sym, i) => (
              <button key={sym} data-sym={i}
                onPointerDown={e => onDown(e, sym)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                onContextMenu={e => e.preventDefault()} onClick={() => onTap(sym)}
                style={{ boxShadow: brush === -3 ? 'inset 0 0 0 1px #ff5a5a88' : cats.of[sym] !== undefined ? `inset 0 0 0 2px ${CAT_COLORS[cats.of[sym]]}` : undefined, opacity: drag?.sym === sym ? .25 : 1, WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', touchAction: drag ? 'none' : 'manipulation' }}
                className={`min-h-11 px-3 py-1 max-w-full overflow-visible rounded-[10px] bg-white/5 border inline-flex items-center justify-center text-white/85 ${SYMBOLS.includes(sym) ? 'border-white/10' : 'border-dashed border-white/50'}`}>
                {/* 跟 App 同一層濾鏡：整片轉白（彩色 emoji 也一樣） */}
                <span style={{ filter: 'grayscale(1) brightness(0) invert(1)' }}><SymbolGlyph text={sym} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {drag && (
        <div style={{ position: 'fixed', left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w, height: drag.h, pointerEvents: 'none', zIndex: 50, filter: 'grayscale(1) brightness(0) invert(1)' }}
          className="rounded-[10px] bg-white/15 border border-white/40 inline-flex items-center justify-center text-white shadow-2xl">
          <SymbolGlyph text={drag.sym} />
        </div>
      )}
    </div>
  );
}
