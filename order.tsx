/* order.html：排「圖案」與「圖形」順序的小工具。
   長按一顆約 0.3 秒 → 它會浮起來 → 拖到想要的位置放開。
   排好之後按「複製順序」，把文字貼給 Claude，就會照這個順序改進 App。
   圖示用的是 App 裡同一套畫法（PatternIcon／ShapeGlyph／HoleGlyph），看到的就是選單上的樣子。 */
import './styles.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { PatternIcon } from './components/PatternIcon';
import { ShapeGlyph, HoleGlyph, shapePickerSections } from './components/GridLayoutTool';
import { PATTERN_ORDER, SHAPE_SECTIONS, type ShapeSection } from './utils/pickerOrder';

/** 新做好、還沒排過位置的項目 —— 格子右上角會有一個小點 */
const NEW_IDS = new Set<string>(['star-rounded', 'p-star-double', 'p-blur-star', 'p-blur-star-rounded', 'p-blur-cross-star', 'p-blur-sparkle4', 'p-blur-heart', 'music-eighth', 'music-beamed', 'music-sixteenth', 'music-clef', 'question', 'burst-dash', 'spinner', 'hole-question', 'burst-dash-f', 'spinner-f', 'hole-music-eighth', 'hole-music-beamed', 'hole-music-sixteenth', 'hole-music-clef']);
const STORE = 'abai-order-tool-v1';
/** 「這個圖形也想當圖案用」的清單（圖形的 id）。存在這台裝置上，複製順序時一起帶出去 */
const STORE_ADD = 'abai-order-tool-shape-as-pattern-v1';
const ADD_PREFIX = 'shape:';
const allShapeItems = () => shapePickerSections().flatMap(([, items]) => items as any[]);
const asPatternItem = (shape: any) => ({ id: ADD_PREFIX + shape.id, fromShape: shape });
/** 已經正式變成圖案的圖形（之前用「加到圖案」選過的，就不要再重複出現一次） */
const patternIdOfShape = (shapeId: string) => {
  const kind = shapeId.replace(/-f$/, '');
  return kind === 'star-rounded' ? 'star-rounded' : kind.startsWith('hole-music-') ? kind.slice(5) : 'p-' + kind;
};
const ALREADY_PATTERN = (shapeId: string) => PATTERN_ORDER.includes(patternIdOfShape(shapeId));
const loadAdded = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_ADD) || '[]'); return Array.isArray(v) ? v.filter((id: string) => !ALREADY_PATTERN(id)) : []; } catch { return []; } };
const HOLD_MS = 280;

type Group = { key: string; label: string; cols: number; items: any[] };

const defaultGroups = (): Group[] => {
  const sections = shapePickerSections();
  return [
    { key: 'pattern', label: '圖案（創意拼圖）', cols: 5, items: PATTERN_ORDER.map(id => ({ id, pattern: true })) },
    ...SHAPE_SECTIONS.map(([key], i) => ({ key, label: `圖形・${sections[i][0]}`, cols: 6, items: [...sections[i][1]] })),
  ];
};

const load = (base0: Group[]): Group[] => {
  // 先把「加到圖案」的那些圖形接在圖案那一區的最後面，再照存下來的順序排
  const shapes = new Map(allShapeItems().map(it => [it.id, it]));
  const added = loadAdded().filter(id => shapes.has(id));
  const base = base0.map(g => g.key !== 'pattern' ? g : { ...g, items: [...g.items, ...added.map(id => asPatternItem(shapes.get(id)))] });
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null') as Record<string, string[]> | null;
    if (!saved) return base;
    return base.map(g => {
      const order = saved[g.key]; if (!order) return g;
      // 存下來的「shape:圖形」如果已經正式變成圖案，就當成那個圖案的位置
      const rank = new Map(order.map((id, i) => [id.startsWith(ADD_PREFIX) && ALREADY_PATTERN(id.slice(ADD_PREFIX.length)) ? patternIdOfShape(id.slice(ADD_PREFIX.length)) : id, i]));
      return { ...g, items: [...g.items].sort((a, b) => (rank.get(a.id) ?? 1e6 + g.items.indexOf(a)) - (rank.get(b.id) ?? 1e6 + g.items.indexOf(b))) };
    });
  } catch { return base; }
};

const Icon = ({ it }: { it: any }): React.ReactElement => it.fromShape ? <Icon it={it.fromShape} /> : it.pattern ? <PatternIcon s={it.id} />
  : it.hole ? <HoleGlyph s={it.hole} filled={it.filled} /> : <ShapeGlyph item={it} />;

type Drag = { group: string; id: string; pointerId: number; dx: number; dy: number; x: number; y: number; w: number; h: number };

function OrderTool() {
  const base = useMemo(defaultGroups, []);
  const [groups, setGroups] = useState<Group[]>(() => load(base));
  const [tab, setTab] = useState<'pattern' | 'shape'>('pattern');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toast, setToast] = useState('');
  /** 開著的時候，在「圖形」那一頁點一下圖形 → 加進圖案（再點一下取消） */
  const [addMode, setAddMode] = useState(false);
  const patternIds = new Set((groups.find(g => g.key === 'pattern')?.items || []).map(i => i.id));
  const toggleAsPattern = (shape: any) => {
    const pid = ADD_PREFIX + shape.id;
    setGroups(gs => gs.map(g => g.key !== 'pattern' ? g
      : g.items.some(i => i.id === pid) ? { ...g, items: g.items.filter(i => i.id !== pid) }
      : { ...g, items: [...g.items, asPatternItem(shape)] }));
    flash(patternIds.has(pid) ? '已從圖案移除' : '已加到圖案（在「圖案」那一頁的最後面）');
  };
  const hold = useRef<{ timer: number; x: number; y: number; pointerId: number } | null>(null);
  const dragRef = useRef<Drag | null>(null); dragRef.current = drag;

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(groups.map(g => [g.key, g.items.map(i => i.id)])))); } catch {}
    try { localStorage.setItem(STORE_ADD, JSON.stringify((groups.find(g => g.key === 'pattern')?.items || []).filter(i => i.fromShape).map(i => i.fromShape.id))); } catch {}
  }, [groups]);

  // 拖曳中不讓頁面跟著捲動（iOS 要在 touchmove 上 preventDefault，而且不能是 passive）
  useEffect(() => {
    const block = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);

  const changed = (g: Group) => {
    const b = base.find(x => x.key === g.key)!;
    return g.items.length !== b.items.length || g.items.some((it, i) => b.items[i]?.id !== it.id);
  };

  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };

  const onDown = (e: React.PointerEvent, group: string, id: string) => {
    if (dragRef.current) return;
    const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, pointerId = e.pointerId;
    cancelHold();
    hold.current = { x: sx, y: sy, pointerId, timer: window.setTimeout(() => {
      hold.current = null;
      try { el.setPointerCapture(pointerId); } catch {}
      navigator.vibrate?.(8);
      setDrag({ group, id, pointerId, dx: sx - r.left, dy: sy - r.top, x: sx, y: sy, w: r.width, h: r.height });
    }, HOLD_MS) };
  };

  const onMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (h && h.pointerId === e.pointerId && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) cancelHold();
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.preventDefault();
    setDrag({ ...d, x: e.clientX, y: e.clientY });
    // 手指底下是哪一格（同一區裡），就把拖著的這顆插到那一格的位置
    const target = document.elementsFromPoint(e.clientX, e.clientY)
      .map(n => (n as HTMLElement).closest?.('[data-cell]') as HTMLElement | null)
      .find(n => n && n.dataset.group === d.group && n.dataset.cell !== d.id);
    if (!target) return;
    const to = target.dataset.cell!;
    setGroups(gs => gs.map(g => {
      if (g.key !== d.group) return g;
      const items = g.items.slice(), from = items.findIndex(i => i.id === d.id), at = items.findIndex(i => i.id === to);
      if (from < 0 || at < 0) return g;
      const [it] = items.splice(from, 1); items.splice(at, 0, it);
      return { ...g, items };
    }));
  };

  const onUp = (e: React.PointerEvent) => {
    cancelHold();
    if (dragRef.current?.pointerId === e.pointerId) setDrag(null);
  };

  const text = () => {
    const lines = ['【ABAI 排序 v1】'];
    for (const g of groups) lines.push(`${g.label}${changed(g) ? '（有改）' : ''}`, g.items.map(i => i.id).join(', '));
    const added = (groups.find(g => g.key === 'pattern')?.items || []).filter(i => i.fromShape);
    if (added.length) lines.push('要加到圖案的圖形（上面圖案順序裡 shape: 開頭的就是這些）', added.map(i => i.fromShape.id).join(', '));
    return lines.join('\n');
  };
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 1600); };
  const copy = async () => {
    const t = text();
    try { await navigator.clipboard.writeText(t); flash('已複製，貼給 Claude 就好'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flash('已複製，貼給 Claude 就好'); } catch { flash('複製失敗，請長按下方文字複製'); }
      ta.remove();
    }
  };
  const reset = () => { if (confirm('回到 App 目前的順序？（加到圖案的圖形也會清掉）')) setGroups(base.map(g => ({ ...g, items: [...g.items] }))); };

  const shown = groups.filter(g => tab === 'pattern' ? g.key === 'pattern' : g.key !== 'pattern');
  const dragged = drag && groups.find(g => g.key === drag.group)?.items.find(i => i.id === drag.id);
  const anyChanged = groups.some(changed);

  return (
    <div className="min-h-[100dvh] bg-black text-white select-none" style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}>
      <div className="sticky top-0 z-20 bg-black/95 backdrop-blur border-b border-white/10" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-[560px] mx-auto px-4 pt-3 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] font-bold tracking-wide">排序工具</div>
              <div className="text-[11px] text-white/45 mt-0.5">長按一顆，浮起來後拖到新位置放開</div>
            </div>
            <div className="flex gap-2">
              <button onClick={reset} className="h-9 px-3 rounded-full border border-white/15 text-[12px] text-white/70 active:scale-95">重設</button>
              <button onClick={copy} className={`h-9 px-4 rounded-full text-[13px] font-bold active:scale-95 ${anyChanged ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>複製順序</button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 p-1 rounded-full bg-white/[0.06]">
            {(['pattern', 'shape'] as const).map(k => (
              <button key={k} onClick={() => setTab(k)} className={`h-8 rounded-full text-[13px] font-bold transition-colors ${tab === k ? 'bg-white text-black' : 'text-white/55'}`}>
                {k === 'pattern' ? '圖案' : '圖形（兩個工具共用）'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="max-w-[560px] mx-auto px-4 pb-16" style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        {tab === 'shape' && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <div className="text-[11px] text-white/55 leading-snug">{addMode ? '點一下圖形就加到圖案，再點一下取消' : '想讓某些圖形也能當圖案用？'}</div>
            <button onClick={() => setAddMode(v => !v)}
              className={`shrink-0 h-8 px-3 rounded-full text-[12px] font-bold active:scale-95 ${addMode ? 'bg-[#9fd3a8] text-black' : 'border border-white/20 text-white/80'}`}>
              {addMode ? '完成' : '加到圖案'}
            </button>
          </div>
        )}
        {shown.map(g => (
          <section key={g.key} className="mt-5">
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-[11px] font-bold text-white/50 tracking-widest">{g.label}</div>
              {changed(g) && <div className="text-[10px] text-[#9fd3a8]">已調整</div>}
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))` }}>
              {g.items.map((it, i) => {
                const lifted = drag?.group === g.key && drag.id === it.id;
                return (
                  <div key={it.id} data-cell={it.id} data-group={g.key}
                    onPointerDown={e => { if (!(addMode && g.key !== 'pattern')) onDown(e, g.key, it.id); }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                    onClick={() => { if (addMode && g.key !== 'pattern' && !dragRef.current) toggleAsPattern(it); }}
                    onContextMenu={e => e.preventDefault()}
                    title={it.label || it.id}
                    className={`relative h-12 rounded-[10px] border flex items-center justify-center text-white/85 transition-[opacity,border-color] duration-150 ${lifted ? 'opacity-25 border-dashed border-white/40' : g.key !== 'pattern' && patternIds.has(ADD_PREFIX + it.id) ? 'border-[#9fd3a8]/70 bg-[#9fd3a8]/10' : 'border-white/10 bg-white/5'}`}
                    style={{ touchAction: drag ? 'none' : 'manipulation' }}>
                    <span className="pointer-events-none flex items-center justify-center"><Icon it={it} /></span>
                    <span className="pointer-events-none absolute left-1 top-0.5 text-[8px] text-white/30 tabular-nums">{i + 1}</span>
                    {NEW_IDS.has(it.id) && <span className="pointer-events-none absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-[#9fd3a8]" />}
                    {g.key !== 'pattern' && patternIds.has(ADD_PREFIX + it.id) && <span className="pointer-events-none absolute right-0.5 bottom-0.5 px-1 rounded-[4px] bg-[#9fd3a8] text-black text-[8px] font-bold leading-[12px]">圖案</span>}
                    {it.fromShape && <span className="pointer-events-none absolute right-0.5 bottom-0.5 px-1 rounded-[4px] bg-white/15 text-white/70 text-[8px] font-bold leading-[12px]">圖形</span>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <details className="mt-8 text-[11px] text-white/40">
          <summary className="cursor-pointer">要複製的文字（按鈕不能用時，長按這裡複製）</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all select-text p-3 rounded-lg bg-white/5" style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>{text()}</pre>
        </details>
      </div>
      {drag && dragged && (
        <div className="fixed z-50 pointer-events-none rounded-[10px] border border-white bg-[#222] flex items-center justify-center text-white shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
          style={{ left: 0, top: 0, width: drag.w, height: drag.h, transform: `translate3d(${drag.x - drag.dx}px, ${drag.y - drag.dy}px, 0) scale(1.12)` }}>
          <Icon it={dragged} />
        </div>
      )}
      {toast && <div className="fixed left-1/2 -translate-x-1/2 bottom-8 z-50 px-4 py-2 rounded-full bg-white text-black text-[13px] font-bold">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<OrderTool />);
