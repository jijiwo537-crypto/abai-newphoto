/* 排序工具的「星芒」頁：30 種星芒並排看，選一個可以疊在照片上看實際效果，
   也可以把它的每個參數拿出來自己調、存成「我的星芒」。
   覺得可以的就勾「想加進去」，複製順序時一起帶出去（自訂的會連參數一起）。
   預覽黏在畫面上方（標題列下面）：往下捲去調參數、選別的星芒時一直看得到。 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { STAR_BURSTS, drawStarBurst, type StarBurstSpec } from '../utils/starBursts';
import { paramsToSpec, specToParams, type BurstParams, type RayGroup } from '../utils/starBurstParams';

const COLORS = [
  { c: '#ffffff', n: '白' },
  { c: '#ffe7a8', n: '暖黃' },
  { c: '#ffc2dd', n: '粉' },
  { c: '#bfe0ff', n: '冰藍' },
  { c: '#d8c4ff', n: '淡紫' },
];

/** 自訂的星芒存在這台裝置上 */
export const STORE_CUSTOM_BURST = 'abai-order-tool-starburst-custom-v1';
export type CustomBurst = { id: string; name: string; params: BurstParams };
export const loadCustomBursts = (): CustomBurst[] => {
  try { const v = JSON.parse(localStorage.getItem(STORE_CUSTOM_BURST) || '[]'); return Array.isArray(v) ? v.filter(x => x && x.id && x.params) : []; } catch { return []; }
};

/** 刪掉的現成星芒（id），一樣存在這台裝置上；複製順序時一起帶出去 */
export const STORE_DELETED_BURST = 'abai-order-tool-starburst-deleted-v1';
export const loadDeletedBursts = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(STORE_DELETED_BURST) || '[]'); return Array.isArray(v) ? v.filter(id => STAR_BURSTS.some(b => b.id === id)) : []; } catch { return []; }
};

/* 星芒是逐像素算的，一次算完全部會卡住畫面一下 —— 排隊一格一格算，每格之間讓畫面喘口氣 */
const queue: (() => void)[] = [];
let pumping = false;
const pump = () => {
  const job = queue.shift();
  if (!job) { pumping = false; return; }
  job();
  setTimeout(pump, 0);
};
const enqueue = (job: () => void) => { queue.push(job); if (!pumping) { pumping = true; setTimeout(pump, 0); } };

/** 一格的小圖：黑底上畫一顆，跟參考圖一樣 */
const Thumb = ({ spec, color }: { spec: StarBurstSpec; color: string }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const css = cv.clientWidth || 100, dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(css * dpr);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    let live = true;
    enqueue(() => { if (live) drawStarBurst(g, spec, cv.width / 2, cv.height / 2, cv.width * .92, color); });
    return () => { live = false; };
  }, [spec, color]);
  return <canvas ref={ref} className="block w-full aspect-square rounded-[10px]" />;
};

/** 一列滑桿：名稱、滑桿、數值 */
const Row = ({ label, value, min, max, step = 1, onChange, unit = '' }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) => (
  <div className="flex items-center gap-2 py-1">
    <span className="text-[11px] text-white/60 w-[64px] shrink-0">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
      onChange={e => onChange(Number(e.target.value))} className="flex-1 min-w-0 accent-white" style={{ touchAction: 'pan-y' }} />
    <span className="text-[11px] tabular-nums w-10 text-right text-white/85">{value}{unit}</span>
  </div>
);

/** 一個可以收起來的參數區塊 */
const Section: React.FC<{ title: string; on?: boolean; children: React.ReactNode; open: boolean; onToggle: () => void }> = ({ title, on, children, open, onToggle }) => (
  <div className="border-t border-white/10">
    <button onClick={onToggle} className="w-full flex items-center justify-between py-2.5 text-left">
      <span className="text-[12px] font-bold text-white/85">{title}{on === false && <span className="ml-1.5 text-[10px] font-normal text-white/35">（關）</span>}</span>
      <span className="text-[11px] text-white/40">{open ? '收起' : '展開'}</span>
    </button>
    {open && <div className="pb-2">{children}</div>}
  </div>
);

export function StarBurstLab({ photo, onPickPhoto, picked, onTogglePick, onChanged }: {
  /** 刪除或自訂的星芒變了（排序工具要更新底下那段要複製的文字） */
  onChanged?: () => void;
  photo: File | null;
  onPickPhoto: (f: File) => void;
  picked: string[];
  onTogglePick: (id: string) => void;
}) {
  const [customs, setCustoms] = useState<CustomBurst[]>(loadCustomBursts);
  useEffect(() => { try { localStorage.setItem(STORE_CUSTOM_BURST, JSON.stringify(customs)); } catch {} onChanged?.(); }, [customs]);
  const [deleted, setDeleted] = useState<string[]>(loadDeletedBursts);
  useEffect(() => { try { localStorage.setItem(STORE_DELETED_BURST, JSON.stringify(deleted)); } catch {} onChanged?.(); }, [deleted]);
  // 排序工具的「重設」：清掉刪除與自訂
  useEffect(() => {
    const onReset = () => { setDeleted([]); setCustoms([]); };
    window.addEventListener('abai-burst-reset', onReset);
    return () => window.removeEventListener('abai-burst-reset', onReset);
  }, []);
  const visible = STAR_BURSTS.filter(b => !deleted.includes(b.id));
  const customSpecs = useMemo(() => customs.map(c => ({ ...paramsToSpec(c.params, c.name), id: c.id })), [customs]);

  /** 選中的那一顆（現成的或我的星芒）＋目前的參數；edited＝已經改過、還沒存 */
  const [sel, setSel] = useState(STAR_BURSTS[0].id);
  const base = STAR_BURSTS.find(s => s.id === sel) || customSpecs.find(s => s.id === sel) || STAR_BURSTS[0];
  const baseParams = useMemo(() => customs.find(c => c.id === sel)?.params ?? specToParams(base), [sel, customs, base]);
  const [params, setParams] = useState<BurstParams>(baseParams);
  const [edited, setEdited] = useState(false);
  const choose = (id: string) => {
    setSel(id); setEdited(false);
    const c = customs.find(x => x.id === id);
    setParams(c ? c.params : specToParams(STAR_BURSTS.find(s => s.id === id) || STAR_BURSTS[0]));
  };
  const spec = useMemo(() => edited ? paramsToSpec(params, `${base.name}（改）`) : base, [edited, params, base]);

  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(45);
  const [pos, setPos] = useState({ x: .5, y: .5 });
  const input = useRef<HTMLInputElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ core: true, g0: true });
  const tog = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  useEffect(() => {
    if (!photo) { setImg(null); return; }
    const u = URL.createObjectURL(photo), im = new Image();
    im.onload = () => setImg(im); im.src = u;
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  /** 寬螢幕（≥768px）：左邊預覽、右邊調整 */
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  /* 預覽黏在標題列正下方：量標題列的高度（它會因為瀏海、字型而不同） */
  const [stickTop, setStickTop] = useState(0);
  useLayoutEffect(() => {
    const h = document.querySelector('[data-order-header]') as HTMLElement | null;
    if (!h) return;
    const upd = () => setStickTop(h.getBoundingClientRect().height);
    upd();
    const ro = new ResizeObserver(upd); ro.observe(h);
    return () => ro.disconnect();
  }, []);

  /* 畫預覽。拖大小滑桿：先拿算好的圖縮放頂著（fast）；拖參數滑桿：先用低解析度頂著（draft）；
     停 150ms 再算精確的那張重畫。 */
  const [exactTick, setExactTick] = useState(0);
  const settle = useRef(0);
  const lastKind = useRef<'fast' | 'draft'>('fast');
  const prevSpec = useRef(spec.id);
  useEffect(() => {
    lastKind.current = prevSpec.current !== spec.id && edited ? 'draft' : 'fast';
    prevSpec.current = spec.id;
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setExactTick(t => t + 1), 150);
    return () => window.clearTimeout(settle.current);
  }, [spec, color, size, edited]);
  const lastExact = useRef(-1);
  const [boxTick, setBoxTick] = useState(0);
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const ro = new ResizeObserver(() => setBoxTick(t => t + 1)); ro.observe(cv);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = Math.round((cv.clientWidth || 300) * dpr), H = Math.round((cv.clientHeight || 300) * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    if (img) {
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      const lg = g.createLinearGradient(0, 0, W, H);
      lg.addColorStop(0, '#1c2440'); lg.addColorStop(.55, '#3b2f4f'); lg.addColorStop(1, '#0e1a2a');
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
    }
    const exact = lastExact.current !== exactTick;
    lastExact.current = exactTick;
    drawStarBurst(g, spec, pos.x * W, pos.y * H, Math.round(Math.min(W, H) * (size / 100) * 1.6), color, 1, exact ? 'exact' : lastKind.current);
  }, [img, spec, color, size, pos, exactTick, boxTick]);

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === 'pointermove' && !e.buttons && e.pointerType === 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };

  const set = (patch: Partial<BurstParams>) => { setParams(p => ({ ...p, ...patch })); setEdited(true); };
  const setGroup = (i: number, patch: Partial<RayGroup>) => {
    setParams(p => { const gs = [...p.groups] as BurstParams['groups']; gs[i] = { ...gs[i], ...patch }; return { ...p, groups: gs }; });
    setEdited(true);
  };
  const setRing = (i: number, patch: Partial<BurstParams['rings'][0]>) => {
    setParams(p => { const rs = [...p.rings] as BurstParams['rings']; rs[i] = { ...rs[i], ...patch }; return { ...p, rings: rs }; });
    setEdited(true);
  };
  const isCustom = customs.some(c => c.id === sel);
  const saveNew = () => {
    const n = customs.length ? Math.max(...customs.map(c => Number(c.name.replace(/\D/g, '')) || 0)) + 1 : 1;
    const id = 'my-' + Date.now().toString(36);
    setCustoms(cs => [...cs, { id, name: `我的星芒 ${n}`, params }]);
    setSel(id); setEdited(false);
  };
  const saveOver = () => { setCustoms(cs => cs.map(c => c.id === sel ? { ...c, params } : c)); setEdited(false); };
  /** 刪除目前這顆：自訂的直接刪掉；現成的先收進「已刪除」（可以還原），選到下一顆 */
  const remove = () => {
    const isMine = customs.some(c => c.id === sel);
    if (isMine && !confirm('刪除這個自訂星芒？')) return;
    if (picked.includes(sel)) onTogglePick(sel);
    if (isMine) { setCustoms(cs => cs.filter(c => c.id !== sel)); choose(visible[0]?.id || STAR_BURSTS[0].id); return; }
    const i = visible.findIndex(b => b.id === sel);
    const next = visible[i + 1] || visible[i - 1];
    setDeleted(d => [...d, sel]);
    if (next) choose(next.id);
  };
  const restore = (id: string) => { setDeleted(d => d.filter(x => x !== id)); choose(id); };
  const revert = () => { setParams(baseParams); setEdited(false); };

  /** 一格：5 個一排的小格子，左下角是編號、右上角「要」＝想加進去 */
  // 用函式（不是元件）：每次重畫不會把整排小圖拆掉重建
  const cell = (s: StarBurstSpec, lb: string) => (
    <button key={s.id} data-starburst={s.id} onClick={() => choose(s.id)} title={s.name}
      className={`relative rounded-[10px] border p-0.5 ${s.id === sel ? 'border-white' : picked.includes(s.id) ? 'border-[#f2c46d]/80' : 'border-white/10'}`}>
      <Thumb spec={s} color={color} />
      <span className="pointer-events-none absolute left-1 bottom-0.5 text-[9px] tabular-nums text-white/55">{lb}</span>
      {picked.includes(s.id) && <span className="pointer-events-none absolute right-0.5 top-0.5 text-[8px] px-0.5 rounded bg-[#f2c46d] text-black font-bold leading-[11px]">要</span>}
    </button>
  );
  const on = picked.includes(sel);
  const label = edited ? `${base.name}（調整中）` : base.name;
  const groupName = ['主芒', '副芒', '第三組芒'];

  return (
    <div className="md:grid md:grid-cols-2 md:gap-6 md:items-start">
      {/* 預覽：手機上黏在標題列下面；寬螢幕上放左邊、黏住不動，右邊捲動調整 */}
      <div className="sticky z-10 -mx-4 px-4 pt-3 pb-2 bg-black md:mx-0 md:px-0 md:pt-4" style={{ top: stickTop }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0 text-[13px] font-bold truncate">{visible.findIndex(b => b.id === sel) >= 0 ? `${visible.findIndex(b => b.id === sel) + 1}. ` : ''}{label}</div>
          <button onClick={() => input.current?.click()} className="shrink-0 h-7 px-3 rounded-full bg-white text-black text-[11px] font-bold active:scale-95">{photo ? '換照片' : '導入照片'}</button>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPickPhoto(f); e.target.value = ''; }} />
        </div>
        <canvas ref={cvRef} data-starburst-preview onPointerDown={move} onPointerMove={move}
          className="block w-full rounded-[8px]" style={{ height: wide ? `calc(100dvh - ${stickTop + 190}px)` : 'min(36vh, 300px)', touchAction: 'none' }} />
        <div className="mt-1 text-[10px] text-white/35">點預覽可以移動星芒的位置</div>
      </div>

      {/* 右邊：所有調整 */}
      <div className="min-w-0 md:pt-2">

      <div className="mt-2 rounded-[12px] border border-white/15 bg-white/[0.06] px-3 pt-2 pb-3">
        <Row label="大小" value={size} min={5} max={100} onChange={setSize} />
        <div className="flex items-center gap-2 py-1">
          <span className="text-[11px] text-white/60 w-[64px] shrink-0">顏色</span>
          {COLORS.map(k => (
            <button key={k.c} onClick={() => setColor(k.c)} aria-label={k.n} title={k.n}
              className={`w-7 h-7 rounded-full border-2 ${color === k.c ? 'border-white' : 'border-transparent'}`} style={{ background: k.c }} />
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => onTogglePick(sel)} disabled={edited}
            className={`flex-1 h-9 rounded-full text-[13px] font-bold active:scale-95 disabled:opacity-35 ${on ? 'bg-[#f2c46d] text-black' : 'border border-white/25 text-white/85'}`}>
            {edited ? '調整過的要先存起來才能勾' : on ? '✓ 想加進去' : '想加進去'}
          </button>
          <button onClick={remove} disabled={edited || deleted.includes(sel)} aria-label="刪除這個星芒"
            className="shrink-0 h-9 px-4 rounded-full border border-[#ff7a7a]/60 text-[#ff9a9a] text-[13px] font-bold active:scale-95 disabled:opacity-35">刪除</button>
        </div>
      </div>

      {/* 自訂參數 */}
      <div className="mt-3 rounded-[12px] border border-white/15 bg-white/[0.04] px-3 pb-1" data-starburst-editor>
        <div className="flex items-center justify-between gap-2 pt-3 pb-2">
          <div>
            <div className="text-[13px] font-bold">自訂參數</div>
            <div className="text-[10px] text-white/40">從目前這顆開始調；長度、半徑以框的一半為 100</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {edited && <button onClick={revert} className="h-8 px-3 rounded-full border border-white/20 text-[11px] text-white/75 active:scale-95">還原</button>}
            {edited && isCustom && <button onClick={saveOver} className="h-8 px-3 rounded-full border border-white/30 text-[11px] font-bold active:scale-95">存回</button>}
            {(edited || !isCustom) && <button onClick={saveNew} className="h-8 px-3 rounded-full bg-[#7ab8ff] text-black text-[11px] font-bold active:scale-95">存成新的</button>}
          </div>
        </div>
        <Section title="光核" open={!!open.core} onToggle={() => tog('core')}>
          <Row label="光核大小" value={params.core} min={0} max={30} step={.5} onChange={v => set({ core: v })} />
          <Row label="柔光範圍" value={params.glow} min={0} max={80} step={.5} onChange={v => set({ glow: v })} />
          <Row label="柔光集中" value={params.glowConc ?? 20} min={0} max={100} onChange={v => set({ glowConc: v })} />
          <Row label="亮度" value={params.glowAlpha} min={0} max={200} onChange={v => set({ glowAlpha: v })} unit="%" />
        </Section>
        {params.groups.map((g, i) => (
          <Section key={i} title={groupName[i]} on={g.n > 0} open={!!open['g' + i]} onToggle={() => tog('g' + i)}>
            <Row label="條數" value={g.n} min={0} max={32} step={2} onChange={v => setGroup(i, { n: v })} />
            <Row label="長度" value={g.len} min={0} max={100} onChange={v => setGroup(i, { len: v })} />
            <Row label="橫的長度" value={g.aspect} min={10} max={200} onChange={v => setGroup(i, { aspect: v })} unit="%" />
            <Row label="粗細" value={g.w} min={4} max={150} onChange={v => setGroup(i, { w: v })} />
            <Row label="亮度" value={g.alpha} min={0} max={150} onChange={v => setGroup(i, { alpha: v })} unit="%" />
            <Row label="角度" value={g.rot} min={0} max={g.n > 0 ? Math.max(1, Math.floor(360 / g.n)) : 90} step={.5} onChange={v => setGroup(i, { rot: v })} unit="°" />
            <Row label="斷層深淺" value={g.gapDepth ?? 0} min={0} max={100} onChange={v => setGroup(i, { gapDepth: v })} unit="%" />
            <Row label="斷層位置" value={g.gapPos ?? 50} min={5} max={95} onChange={v => setGroup(i, { gapPos: v })} />
            <Row label="斷層寬度" value={g.gapW ?? 12} min={3} max={40} onChange={v => setGroup(i, { gapW: v })} />
          </Section>
        ))}
        <Section title="細芒" on={params.fineN > 0} open={!!open.fine} onToggle={() => tog('fine')}>
          <Row label="條數" value={params.fineN} min={0} max={96} step={4} onChange={v => set({ fineN: v })} />
          <Row label="長度" value={params.fineLen} min={0} max={100} onChange={v => set({ fineLen: v })} />
          <Row label="長短差" value={params.fineVar} min={0} max={100} onChange={v => set({ fineVar: v })} unit="%" />
          <Row label="粗細" value={params.fineW} min={4} max={60} onChange={v => set({ fineW: v })} />
          <Row label="亮度" value={params.fineAlpha} min={0} max={120} onChange={v => set({ fineAlpha: v })} unit="%" />
          <Row label="角度" value={params.fineRot} min={0} max={params.fineN > 0 ? Math.max(1, Math.floor(360 / params.fineN)) : 10} step={.25} onChange={v => set({ fineRot: v })} unit="°" />
        </Section>
        {params.rings.map((r, i) => (
          <Section key={i} title={`光環 ${i + 1}`} on={r.r > 0} open={!!open['r' + i]} onToggle={() => tog('r' + i)}>
            <Row label="半徑" value={r.r} min={0} max={90} onChange={v => setRing(i, { r: v })} />
            <Row label="粗細" value={r.w} min={10} max={300} onChange={v => setRing(i, { w: v })} />
            <Row label="亮度" value={r.alpha} min={0} max={120} onChange={v => setRing(i, { alpha: v })} unit="%" />
          </Section>
        ))}
 <Section title="整體發光" on={(params.bloomA ?? 0) > 0} open={!!open.bloom} onToggle={() => tog('bloom')}>
          <Row label="強度" value={params.bloomA ?? 0} min={0} max={150} onChange={v => set({ bloomA: v })} unit="%" />
          <Row label="範圍" value={params.bloomR ?? 30} min={5} max={80} onChange={v => set({ bloomR: v })} />
        </Section>
        <Section title="橫向光條" on={params.streakLen > 0} open={!!open.streak} onToggle={() => tog('streak')}>
          <Row label="長度" value={params.streakLen} min={0} max={100} onChange={v => set({ streakLen: v })} />
          <Row label="粗細" value={params.streakW} min={10} max={150} onChange={v => set({ streakW: v })} />
          <Row label="亮度" value={params.streakAlpha} min={0} max={150} onChange={v => set({ streakAlpha: v })} unit="%" />
        </Section>
      </div>

      {customSpecs.length > 0 && (
        <section className="mt-5">
          <div className="text-[11px] font-bold text-white/50 tracking-widest mb-2">我的星芒（{customSpecs.length}）</div>
          <div className="grid grid-cols-5 gap-1.5">
            {customSpecs.map((s, i) => cell(s, `我${i + 1}`))}
          </div>
        </section>
      )}
      <section className="mt-5">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[11px] font-bold text-white/50 tracking-widest">星芒（{visible.length} 種）</div>
          {picked.length > 0 && <div className="text-[10px] text-[#f2c46d]">想加進去 {picked.length} 個</div>}
        </div>
        <div className="text-[10px] text-white/35 -mt-1 mb-2">越像的排越近：十字 → 光條 → 多芒 → 閃光 → 放射／光球 → 光環</div>
        <div className="grid grid-cols-5 gap-1.5">
          {visible.map((s, i) => cell(s, String(i + 1)))}
        </div>
      </section>
      {deleted.length > 0 && (
        <section className="mt-5">
          <div className="text-[11px] font-bold text-white/50 tracking-widest mb-1">已刪除（{deleted.length}）</div>
          <div className="text-[10px] text-white/35 mb-2">點一下就還原</div>
          <div className="grid grid-cols-5 gap-1.5 opacity-60">
            {STAR_BURSTS.filter(b => deleted.includes(b.id)).map(s => (
              <button key={s.id} data-starburst-deleted={s.id} onClick={() => restore(s.id)} title={`還原 ${s.name}`}
                className="relative rounded-[10px] border border-dashed border-white/25 p-0.5">
                <Thumb spec={s} color={color} />
                <span className="absolute left-1 bottom-0.5 text-[9px] text-white/70">還原</span>
              </button>
            ))}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
