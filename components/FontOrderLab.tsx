/* 排序工具的「字體」頁：App 目前的字體＋網路上找來的候選字體，全部預覽。
   長按約 0.3 秒浮起來後拖到新位置；按「刪除」再點字體就移到下面「已刪除」（點一下可加回來）。
   排好按「複製字體清單」，貼給 Claude 就會照這個順序、只留下沒刪的放進 App。 */
import React, { useEffect, useRef, useState } from 'react';
import { FONTS, FONT_CATEGORIES, FONT_SAMPLE, FontCategory, ensureFont } from '../utils/fonts';
import { FONT_CANDIDATES, FontCandidate } from '../utils/fontCandidates';

const STORE = 'abai-order-tool-fonts-v1';
const HOLD_MS = 280;

type Item = { name: string; label: string; isNew: boolean; css?: string; url?: string };
const allOf = (cat: FontCategory): Item[] => {
  const cur = FONTS.filter(f => f.category === cat).map(f => ({ name: f.name, label: f.label, isNew: false }));
  const have = new Set(cur.map(c => c.name));
  const extra = FONT_CANDIDATES.filter((c: FontCandidate) => c.cat === cat && !have.has(c.name))
    .map(c => ({ name: c.name, label: c.label, isNew: true, css: c.css, url: c.url }));
  return [...cur, ...extra];
};
type Saved = Record<string, { list: string[]; gone: string[] }>;
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };

/* 預覽字體：Google 只抓範例字（&text=，幾 KB）；其他來源插樣式表或登記字體檔。每個只做一次。 */
const asked = new Set<string>();
function loadPreview(it: Item, text: string, onReady: () => void) {
  if (asked.has(it.name)) { onReady(); return; }
  asked.add(it.name);
  const done = () => { document.fonts.load(`400 24px "${it.name}"`, text).catch(() => {}).finally(onReady); };
  if (!it.isNew) { ensureFont(it.name).then(done, onReady); return; }
  if (it.url) {
    new FontFace(it.name, `url("${it.url}")`).load().then(f => { document.fonts.add(f); onReady(); }, onReady);
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = it.css || ('https://fonts.googleapis.com/css2?family=' + encodeURIComponent(it.name).replace(/%20/g, '+')
    + '&text=' + encodeURIComponent(Array.from(new Set(Array.from(text))).join('')) + '&display=swap');
  link.onload = done; link.onerror = onReady;
  document.head.appendChild(link);
}

function Card({ it, sample, idx, dragging, deleting, onDown, onTap }: {
  it: Item; sample: string; idx: number; dragging: boolean; deleting: boolean; onDown: (e: React.PointerEvent, name: string) => void; onTap: (name: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { io.disconnect(); loadPreview(it, sample + it.label, () => setReady(true)); }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [it, sample]);
  return (
    <div ref={ref} data-font={it.name} onPointerDown={e => onDown(e, it.name)} onClick={() => onTap(it.name)}
      className={`relative h-[66px] rounded-xl border flex flex-col items-center justify-center px-1 transition-transform ${dragging ? 'scale-110 border-white bg-white/20 z-10' : deleting ? 'border-red-400/50 bg-red-500/10' : 'border-white/12 bg-white/[0.04]'}`}
      style={{ touchAction: 'manipulation' }}>
      <span className="pointer-events-none absolute left-1.5 top-0.5 text-[8px] text-white/30 tabular-nums">{idx + 1}</span>
      {it.isNew && <span className="pointer-events-none absolute right-1.5 top-1 text-[8px] font-bold text-[#7ab8ff]">新</span>}
      <span className={`pointer-events-none text-[20px] leading-tight transition-opacity ${ready ? 'opacity-100' : 'opacity-30'}`} style={{ fontFamily: `"${it.name}", sans-serif` }}>{sample}</span>
      <span className="pointer-events-none mt-0.5 w-full truncate text-center text-[9px] text-white/50" style={{ fontFamily: `"${it.name}", sans-serif` }}>{it.label}</span>
    </div>
  );
}

export function FontOrderLab({ onToast }: { onToast: (s: string) => void }) {
  const [cat, setCat] = useState<FontCategory>('zh');
  const [saved, setSaved] = useState<Saved>(load);
  const [deleting, setDeleting] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null); dragRef.current = drag;
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* 私密模式 */ } }, [saved]);

  const all = allOf(cat);
  const byName = new Map(all.map(i => [i.name, i]));
  const st = saved[cat];
  const gone = (st?.gone || []).filter(n => byName.has(n));
  const order = st ? [...st.list.filter(n => byName.has(n) && !gone.includes(n)), ...all.map(i => i.name).filter(n => !st.list.includes(n) && !gone.includes(n))] : all.map(i => i.name);
  const set = (list: string[], g: string[]) => setSaved(s => ({ ...s, [cat]: { list, gone: g } }));
  const orderRef = useRef(order); orderRef.current = order;
  const goneRef = useRef(gone); goneRef.current = gone;

  useEffect(() => {
    const stop = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  const onDown = (e: React.PointerEvent, name: string) => {
    if (deleting) return;
    const x = e.clientX, y = e.clientY;
    const cancel = () => { if (hold.current) clearTimeout(hold.current.timer); hold.current = null; cleanup(); };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) {
        if (hold.current && Math.hypot(ev.clientX - x, ev.clientY - y) > 8) cancel();
        return;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-font]') as HTMLElement | null;
      const target = el?.dataset.font;
      const cur = dragRef.current;
      if (!target || target === cur) return;
      const list = orderRef.current.filter(n => n !== cur);
      const ti = orderRef.current.indexOf(target), ci = orderRef.current.indexOf(cur);
      const at = list.indexOf(target) + (ti > ci ? 1 : 0);
      list.splice(at, 0, cur);
      set(list, goneRef.current);
    };
    const up = () => { cancel(); setDrag(null); };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    hold.current = { x, y, timer: window.setTimeout(() => { dragRef.current = name; setDrag(name); try { navigator.vibrate?.(10); } catch { /* */ } }, HOLD_MS) };
  };

  const tap = (name: string) => { if (deleting) set(orderRef.current.filter(n => n !== name), [...goneRef.current, name]); };
  const copy = async () => {
    const lines: string[] = ['【字體清單】（照順序；沒列出的＝刪除）'];
    for (const c of FONT_CATEGORIES) {
      const a = allOf(c.id), m = new Map(a.map(i => [i.name, i])), s = saved[c.id];
      const g = s?.gone || [];
      const o = s ? [...s.list.filter(n => m.has(n) && !g.includes(n)), ...a.map(i => i.name).filter(n => !s.list.includes(n) && !g.includes(n))] : a.map(i => i.name);
      lines.push(`\n[${c.id}] ${o.length} 個`);
      lines.push(o.map(n => `${n}${m.get(n)!.isNew ? '*' : ''}`).join(' | '));
    }
    const t = lines.join('\n');
    try { await navigator.clipboard.writeText(t); onToast('已複製，貼給 Claude 就好'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); onToast('已複製，貼給 Claude 就好'); } catch { onToast('複製失敗'); }
      ta.remove();
    }
  };
  const reset = () => { if (confirm('這一類回到原本的順序、清空刪除？')) setSaved(s => { const n = { ...s }; delete n[cat]; return n; }); };
  const sample = FONT_SAMPLE[cat];

  return (
    <div className="mt-3">
      <div className="grid grid-cols-4 gap-1 p-1 rounded-full bg-white/[0.06]">
        {FONT_CATEGORIES.map(c => (
          <button key={c.id} onClick={() => setCat(c.id)} className={`h-8 rounded-full text-[12px] font-bold ${cat === c.id ? 'bg-white text-black' : 'text-white/55'}`}>{c.label}</button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 text-[11px] text-white/45">共 {order.length} 個（藍色「新」＝候選），已刪 {gone.length}</div>
        <button onClick={() => setDeleting(d => !d)} className={`h-8 px-3 rounded-full text-[12px] font-bold ${deleting ? 'bg-red-500 text-white' : 'border border-white/15 text-white/70'}`}>{deleting ? '刪除中（點字體）' : '刪除'}</button>
        <button onClick={reset} className="h-8 px-3 rounded-full border border-white/15 text-[12px] text-white/70">重設</button>
        <button onClick={copy} className="h-8 px-3 rounded-full bg-white text-black text-[12px] font-bold">複製字體清單</button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {order.map((n, i) => <Card key={n} it={byName.get(n)!} sample={sample} idx={i} dragging={drag === n} deleting={deleting} onDown={onDown} onTap={tap} />)}
      </div>
      {gone.length > 0 && (
        <div className="mt-6">
          <div className="text-[12px] font-bold text-white/60 mb-2">已刪除（點一下加回最後面）</div>
          <div className="grid grid-cols-3 gap-2 opacity-60">
            {gone.map(n => (
              <button key={n} onClick={() => set([...order, n], gone.filter(g => g !== n))}
                className="h-[44px] rounded-xl border border-white/10 text-[11px] text-white/70 truncate px-1">{byName.get(n)!.label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 text-[10px] text-white/35 leading-relaxed">
        「（簡）」＝只有簡體字身，打繁體會有字變成預設字體。韓文候選多數來自 noonnu 免費商用字體；dafont 的字多半限個人使用、又只能下載壓縮檔，所以沒有直接放。
      </div>
    </div>
  );
}
