/* animation-tuner.html：調整「動畫預設值」的小工具。
   整頁就是真正的創意拼圖（sandbox：不存草稿、不進首頁紀錄），動畫的繪製、滑桿刻度、
   預設值都直接呼叫 App 裡同一份程式（motionPickPatch／motionUi／motionKindLists），
   所以看到的效果與數字跟 App 完全一樣。
   用法：在動畫頁照平常選動畫、拖滑桿；跟目前預設值不一樣的組合會自動記下來，
   按「複製」把文字貼給 Claude，就會照這些數字改進 App。 */
import './styles.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  CollageTool, MO_DEFAULT, PATTERN_MO_DEFAULT, moOf, motionKindLists, motionPickPatch, motionTargetCtxOf, motionUi,
  type MoCfg, type MotionTargetCtx,
} from './components/CollageTool';
import { FRAME_SCATTER } from './utils/frameShapes';

type Phase = 'in' | 'idle';
type Rec = { key: string; target: string; phase: Phase; id: string; name: string; def: Record<string, number>; now: Record<string, number> };
const STORE = 'abai-animation-tuner-v1';
const FIELD_NAME: Record<string, string> = { delay: '起始', inSpeed: '速度', amp: '幅度', speed: '速度' };
/* 只有速度、沒有幅度滑桿的常駐動畫（跟 App 面板一致） */
const NO_AMP = new Set(['lab-P-L02', 'lab-T-L04']);

const targetName = (c: MotionTargetCtx) => c.pattern ? '圖案' : c.sym ? '符號' : c.type === 'text' ? '文字'
  : c.type === 'image' ? '圖片' : c.scatter ? '散落邊框' : c.glint ? '星芒' : c.grid ? '網格圖形' : c.line ? '線條' : '圖形';

const holesGrid = () => {
  const out: any[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push({ id: `h${r}${c}`, x: 170 + c * 280, y: 170 + r * 280 });
  return out;
};
const T = { rot: 0, opacity: 100 };
const SCENES: { key: string; label: string; chip?: string; state: () => any }[] = [
  { key: 'pattern', label: '圖案', state: () => ({ holeCount: 9, holeType: 'star', holeSize: 40, holes: holesGrid(), objects: [] }) },
  { key: 'text', label: '文字', chip: 'ABAI動畫', state: () => ({ holeCount: 0, objects: [{ id: 'tx', type: 'text', text: 'ABAI動畫', color: '#FFFFFF', x: 150, y: 420, w: 700, h: 160, size: 120, ...T }] }) },
  { key: 'symbol', label: '符號', chip: '符號', state: () => ({ holeCount: 0, objects: [{ id: 'sy', type: 'text', text: '⋆.˚✮⋆˚.⋆', sym: '⋆.˚✮⋆˚.⋆', color: '#FFFFFF', x: 150, y: 420, w: 700, h: 160, size: 120, ...T }] }) },
  { key: 'image', label: '圖片', chip: '圖片', state: () => ({ holeCount: 0, objects: [{ id: 'im', type: 'image', src: '', x: 300, y: 300, w: 400, h: 400, ...T }] }) },
  { key: 'shape', label: '圖形', chip: '圖形', state: () => ({ holeCount: 0, objects: [{ id: 'sh', type: 'shape', kind: 'circle', filled: true, color: '#DCE7DB', x: 330, y: 330, w: 340, h: 340, lineW: 6, ...T }] }) },
  { key: 'grid', label: '網格圖形', chip: '圖形', state: () => ({ holeCount: 0, objects: [{ id: 'gr', type: 'shape', kind: 'grid-cross', filled: false, color: '#DCE7DB', x: 200, y: 250, w: 600, h: 500, lineW: 6, ...T }] }) },
  { key: 'line', label: '線條', chip: '圖形', state: () => ({ holeCount: 0, objects: [{ id: 'ln', type: 'shape', kind: 'wave', filled: false, color: '#DCE7DB', x: 150, y: 450, w: 700, h: 100, lineW: 6, ...T }] }) },
  { key: 'glint', label: '星芒', chip: '圖形', state: () => ({ holeCount: 0, objects: [{ id: 'gl', type: 'shape', kind: 'hole', hole: 'sb-cross-thin', filled: true, color: '#FFFFFF', x: 300, y: 300, w: 400, h: 400, lineW: 6, ...T }] }) },
  { key: 'scatter', label: '散落邊框', chip: '圖形', state: () => ({ holeCount: 0, objects: [{ id: 'sc', type: 'shape', kind: FRAME_SCATTER, filled: true, color: '#DCE7DB', x: 100, y: 100, w: 800, h: 800, lineW: 6, ...T }] }) },
];

/** 示範照片：漸層＋幾塊色塊，看得出圖案挖在照片上的樣子 */
const sampleCanvas = (a: string, b: string, c: string) => {
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 1200;
  const g = cv.getContext('2d')!;
  const lg = g.createLinearGradient(0, 0, 1200, 1200);
  lg.addColorStop(0, a); lg.addColorStop(.5, b); lg.addColorStop(1, c);
  g.fillStyle = lg; g.fillRect(0, 0, 1200, 1200);
  for (const [x, y, r, col] of [[300, 360, 240, '#ffffff44'], [880, 820, 320, '#1d2b4a55'], [420, 980, 180, '#e8735a55']] as const) {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return cv;
};
const toFile = (cv: HTMLCanvasElement, name: string) => new Promise<File>(r => cv.toBlob(b => r(new File([b!], name, { type: 'image/jpeg' })), 'image/jpeg', .9));

const loadRecs = (): Record<string, Rec> => { try { const v = JSON.parse(localStorage.getItem(STORE) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const saveRecs = (v: Record<string, Rec>) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* 私密模式：只是不保留 */ } };

const diffText = (r: Rec) => Object.keys(r.now).filter(k => r.now[k] !== r.def[k]).map(k => `${FIELD_NAME[k]} ${r.def[k]} → ${r.now[k]}`).join('，');

function App() {
  const [base, setBase] = useState<File | null>(null);
  const [imgSrc, setImgSrc] = useState('');
  const [scene, setScene] = useState(SCENES[1]);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);
  const [recs, setRecs] = useState<Record<string, Rec>>(loadRecs);
  const [live, setLive] = useState<{ title: string; rows: { label: string; def: number; now: number }[] } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { saveRecs(recs); }, [recs]);
  useEffect(() => {
    void toFile(sampleCanvas('#f4a6a0', '#f7d9a8', '#8fb9d8'), 'sample.jpg').then(setBase);
    void toFile(sampleCanvas('#2b5876', '#4e4376', '#f3904f'), 'object.jpg').then(f => setImgSrc(URL.createObjectURL(f)));
  }, []);

  const initialState = useMemo(() => {
    const st = scene.state();
    st.objects = st.objects.map((o: any) => o.type === 'image' ? { ...o, src: imgSrc } : o);
    return { layout: 'image-full', canvasRatio: '1:1', ...st };
  }, [scene, imgSrc, nonce]);

  /* 開好之後自動切到「動畫」分頁，物件場景再幫忙點選那個物件 */
  useEffect(() => {
    if (!base) return;
    let stop = false, tries = 0;
    const step = () => {
      if (stop || ++tries > 200) return;
      const tab = document.querySelector<HTMLButtonElement>('[data-creative-tab="motion"]');
      if (!tab) { setTimeout(step, 100); return; }
      if (tab.getAttribute('aria-selected') !== 'true' && !tab.dataset.tunerClicked) { tab.dataset.tunerClicked = '1'; tab.click(); }
      if (!scene.chip) return;
      const chip = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === scene.chip);
      if (chip) chip.click(); else setTimeout(step, 100);
    };
    const t = setTimeout(step, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [base, scene, nonce]);

  const onMotionChange = useCallback(({ objects, moShape, moTarget }: { objects: any[]; moShape: MoCfg; moTarget: string }) => {
    if (moTarget === 'link' || moTarget.startsWith('glow')) { setLive(null); return; }
    const obj = moTarget === 'shape' ? null : objects.find(o => o.id === moTarget);
    if (moTarget !== 'shape' && !obj) { setLive(null); return; }
    const ctx = motionTargetCtxOf(obj);
    const cfg: MoCfg = obj ? moOf(obj) : (moShape.idle === 'grid-wave' ? { ...moShape, idle: 'pattern-breathe' } : moShape);
    const start = ctx.pattern ? PATTERN_MO_DEFAULT : MO_DEFAULT;
    const now = motionUi(cfg, ctx);
    const { kinds, idleKinds } = motionKindLists(ctx);
    const nameOf = (list: { id: string; name: string }[], id: string) => list.find(k => k.id === id)?.name || id;
    const target = targetName(ctx);
    const found: Rec[] = [];
    if (cfg.in !== 'none') {
      const def = motionUi({ ...start, ...motionPickPatch({ in: cfg.in }, ctx, 'pop') } as MoCfg, ctx);
      found.push({ key: `${target}|in|${cfg.in}`, target, phase: 'in', id: cfg.in, name: nameOf(kinds, cfg.in),
        def: { delay: def.delay, inSpeed: def.inSpeed }, now: { delay: now.delay, inSpeed: now.inSpeed } });
    }
    if (cfg.idle !== 'none') {
      const def = motionUi({ ...start, ...motionPickPatch({ idle: cfg.idle }, ctx, cfg.in) } as MoCfg, ctx);
      const keys = NO_AMP.has(cfg.idle) ? ['speed'] : ['amp', 'speed'];
      found.push({ key: `${target}|idle|${cfg.idle}`, target, phase: 'idle', id: cfg.idle, name: nameOf(idleKinds, cfg.idle),
        def: Object.fromEntries(keys.map(k => [k, (def as any)[k]])), now: Object.fromEntries(keys.map(k => [k, (now as any)[k]])) });
    }
    setLive({
      title: target,
      rows: found.flatMap(r => Object.keys(r.now).map(k => ({ label: `${r.phase === 'in' ? '進場' : '常駐'} ${r.name}・${FIELD_NAME[k]}`, def: r.def[k], now: r.now[k] }))),
    });
    /* 跟預設不一樣才記下（或更新）；切回預設不會自動刪掉，避免換來換去把調好的弄丟 */
    setRecs(prev => {
      let next = prev;
      for (const r of found) {
        if (!Object.keys(r.now).some(k => r.now[k] !== r.def[k])) continue;
        const old = prev[r.key];
        if (old && JSON.stringify(old.now) === JSON.stringify(r.now)) continue;
        if (next === prev) next = { ...prev };
        next[r.key] = r;
      }
      return next;
    });
  }, []);

  const list = Object.values(recs).sort((a, b) => a.key.localeCompare(b.key, 'zh-Hant'));
  const copyText = [
    '請把以下動畫的預設值改成這樣（創意拼圖動畫面板上的數字，0～100）：',
    ...list.map(r => `- ${r.target}｜${r.phase === 'in' ? '進場' : '常駐'}｜${r.name}（${r.id}）：${diffText(r)}`),
  ].join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyText); }
    catch {
      const ta = document.createElement('textarea'); ta.value = copyText; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* 沒辦法就讓使用者自己選 */ }
      ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  if (!base || !imgSrc) return <div style={{ padding: 24, color: '#888', fontSize: 13 }}>準備中…</div>;
  const changedHere = live?.rows.filter(r => r.def !== r.now).length || 0;
  return (
    <>
      <CollageTool key={`${scene.key}-${nonce}`} sandbox initialFile={base} initialState={initialState}
        onMotionChange={onMotionChange} onHome={() => setOpen(true)} onImportNew={() => {}} />
      <button onClick={() => setOpen(true)} data-tuner-toggle
        style={{ position: 'fixed', left: 10, top: 'calc(env(safe-area-inset-top) + 62px)', zIndex: 2147483000 }}
        className="h-8 px-3 rounded-full bg-white text-black text-[12px] font-bold shadow-lg flex items-center gap-1.5">
        預設值{list.length > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-black text-white text-[11px] leading-5 text-center">{list.length}</span>}
        {changedHere > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[#ff7a59]" />}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2147483001, background: 'rgba(0,0,0,.55)' }}>
          <div onClick={e => e.stopPropagation()}
            className="absolute left-0 right-0 bottom-0 mx-auto max-w-[560px] bg-[#111] border-t border-white/10 rounded-t-[18px] text-white"
            style={{ maxHeight: '86dvh', overflowY: 'auto', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
            <div className="px-5 pt-4 pb-2 flex items-center justify-between sticky top-0 bg-[#111] z-10">
              <span className="text-[15px] font-bold">動畫預設值</span>
              <button onClick={() => setOpen(false)} className="text-white/50 text-[13px] px-2 py-1">關閉</button>
            </div>
            <div className="px-5">
              <p className="text-[11px] text-white/45 leading-relaxed mb-3">
                畫面就是 App 的創意拼圖（不會存草稿）。在動畫頁照平常選動畫、拖滑桿，
                跟目前預設不一樣的數字會自動記在下面。全部調好按「複製」，把文字貼給 Claude。
              </p>
              <p className="text-[11px] font-bold text-white/40 tracking-widest mb-2">示範物件</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {SCENES.map(s => (
                  <button key={s.key} onClick={() => { setScene(s); setNonce(n => n + 1); setOpen(false); }}
                    className={`h-8 px-3 rounded-[8px] border text-[12px] font-bold ${s.key === scene.key ? 'bg-white text-black border-white' : 'border-white/15 text-white/70'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              {live && live.rows.length > 0 && (
                <>
                  <p className="text-[11px] font-bold text-white/40 tracking-widest mb-2">目前選中的「{live.title}」</p>
                  <div className="rounded-[12px] bg-white/[.04] border border-white/10 mb-4">
                    {live.rows.map(r => (
                      <div key={r.label} className="flex items-center justify-between px-3 py-2 text-[12px] border-b border-white/5 last:border-0">
                        <span className="text-white/70">{r.label}</span>
                        <span className="tabular-nums">
                          <span className="text-white/40">預設 {r.def}</span>
                          <span className={`ml-3 font-bold ${r.def !== r.now ? 'text-[#ff9b80]' : 'text-white/80'}`}>現在 {r.now}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold text-white/40 tracking-widest">要修改的預設值（{list.length}）</p>
                {list.length > 0 && <button onClick={() => { if (confirm('清掉全部記錄？')) setRecs({}); }} className="text-[11px] text-white/40 px-1">全部清除</button>}
              </div>
              {list.length === 0 ? (
                <p className="text-[12px] text-white/35 mb-4">還沒有。調整任一個滑桿，跟預設不一樣就會出現在這裡。</p>
              ) : (
                <div className="rounded-[12px] bg-white/[.04] border border-white/10 mb-4">
                  {list.map(r => (
                    <div key={r.key} className="flex items-start gap-2 px-3 py-2.5 border-b border-white/5 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold">{r.target}｜{r.phase === 'in' ? '進場' : '常駐'}｜{r.name}</div>
                        <div className="text-[12px] text-[#ff9b80] tabular-nums mt-0.5">{diffText(r)}</div>
                      </div>
                      <button onClick={() => setRecs(p => { const n = { ...p }; delete n[r.key]; return n; })}
                        aria-label="刪除這一項" className="w-7 h-7 shrink-0 rounded-full text-white/40 text-[16px] leading-7">×</button>
                    </div>
                  ))}
                </div>
              )}
              <button disabled={!list.length} onClick={copy}
                className={`w-full h-11 rounded-[12px] text-[14px] font-bold ${list.length ? 'bg-white text-black' : 'bg-white/10 text-white/30'}`}>
                {copied ? '已複製' : '複製要修改的內容'}
              </button>
              {list.length > 0 && <pre className="mt-3 text-[11px] text-white/45 whitespace-pre-wrap break-words">{copyText}</pre>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
