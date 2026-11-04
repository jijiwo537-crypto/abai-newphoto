/* 點陣文字：照片轉成可以複製貼上的點字圖案（見 utils/dotArt） */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Icon } from './Icon';
import { DOT_ART_DEFAULTS, DOT_ART_SHADE_THRESHOLD, generateDotArt, invertDotArt, prepareDotArtImage, warmLineArtModel, type DotArtResult, type DotArtSettings } from '../utils/dotArt';

interface Item { id: number; name: string; src: string; preview: string | null; results: DotArtResult[] | null; error?: string }

const Slider = ({ label, left, right, value, min, max, step, onChange, disabled, hint }: {
  label: string; left: string; right: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; disabled?: boolean; hint?: string;
}) => (
  <div className={`min-w-0 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
    <div className="flex justify-between items-center px-1 mb-1">
      <span className="text-[10px] font-black text-white/45 tracking-[0.12em]">{label}</span>
      <span className="text-[10px] leading-none tabular-nums font-bold bg-white/10 px-1.5 py-[4px] rounded">{step < 1 ? value.toFixed(2) : value}</span>
    </div>
    <div className="slider-wrap w-full" style={{ height: 16 }}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        className="premium-slider w-full" onChange={e => onChange(Number(e.target.value))} />
    </div>
    <div className="flex justify-between px-1 mt-1 text-[9px] text-white/30"><span>{left}</span><span>{right}</span></div>
    {hint && <p className="px-1 mt-1 text-[10px] leading-relaxed text-white/35">{hint}</p>}
  </div>
);

const ResultCard: React.FC<{ r: DotArtResult }> = ({ r }) => {
  const [inverted, setInverted] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = inverted ? invertDotArt(r.text) : r.text;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.top = '0';
      document.body.appendChild(t); t.focus(); t.select(); try { document.execCommand('copy'); } catch { /* 無法複製 */ } t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div data-dot-art-result={r.kind} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-white/45 tracking-[0.06em]">{r.width} 字寬 · {r.chars} 字元</span>
      </div>
      <div className="overflow-x-auto no-scrollbar rounded-lg bg-white text-black p-2">
        <pre data-dot-art-text className="m-0 leading-[1] whitespace-pre select-all" style={{ fontSize: 8, fontFamily: 'monospace' }}>{text}</pre>
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={copy} disabled={copied} className="flex-1 h-9 rounded-full bg-white text-black text-[11px] font-black tracking-[0.06em] flex items-center justify-center gap-1 active:scale-[0.98]">
          <Icon name={copied ? 'check' : 'content_copy'} className="text-[16px]" />{copied ? '已複製' : '複製'}
        </button>
        <button onClick={() => setInverted(v => !v)} aria-pressed={inverted} className="flex-1 h-9 rounded-full border border-white/15 text-white text-[11px] font-black tracking-[0.06em] flex items-center justify-center gap-1 active:scale-[0.98]">
          <Icon name="invert_colors" className="text-[16px]" />反轉
        </button>
      </div>
    </div>
  );
};

export function DotArtStudio({ onClose, initialFiles }: { onClose: () => void; initialFiles: File[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [s, setS] = useState<DotArtSettings>(DOT_ART_DEFAULTS);
  const [shade, setShade] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sourceVersion, setSourceVersion] = useState(0);
  const sources = useRef(new Map<number, HTMLCanvasElement>());
  const input = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => { warmLineArtModel(); }, []);
  const addFiles = async (files: File[]) => {
    const fresh: Item[] = [];
    for (const f of files) {
      const id = ++seqRef.current;
      try {
        const c = await prepareDotArtImage(f);
        sources.current.set(id, c);
        fresh.push({ id, name: f.name, src: c.toDataURL('image/png'), preview: null, results: null });
      } catch { fresh.push({ id, name: f.name, src: '', preview: null, results: null, error: '無法讀取這張圖片' }); }
    }
    setItems(fresh);
    setSourceVersion(v => v + 1);
  };
  useEffect(() => { if (initialFiles.length) addFiles(initialFiles); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const generate = async () => {
    if (busy || !items.length) return;
    setBusy('載入中（第一次會比較久）');
    try {
      for (const it of items) {
        const c = sources.current.get(it.id);
        if (!c) continue;
        const { preview, results } = await generateDotArt(c, s, label => setBusy(`產生中：${label}`));
        const url = preview.toDataURL('image/png');
        setItems(list => list.map(x => (x.id === it.id ? { ...x, preview: url, results } : x)));
      }
    } catch (e) {
      setItems(list => list.map(x => ({ ...x, error: '產生失敗，請再試一次' })));
      console.error('dot art failed', e);
    } finally { setBusy(null); }
  };
  const toggleShade = (on: boolean) => { setShade(on); setS(v => ({ ...v, threshold: on ? DOT_ART_SHADE_THRESHOLD : DOT_ART_DEFAULTS.threshold })); };
  const set = (k: keyof DotArtSettings) => (v: number) => setS(o => ({ ...o, [k]: v }));

  return (
    <div data-dot-art-studio className="fixed inset-0 z-[60] bg-black text-white flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="h-14 shrink-0 flex items-center justify-between px-4">
        <button aria-label="返回" onClick={onClose} className="p-2 -ml-2 text-[#aaa] active:scale-90"><ChevronLeft size={22} /></button>
        <span className="text-[13px] font-black tracking-[0.08em]">點陣文字</span>
        <button aria-label="換圖片" onClick={() => input.current?.click()} className="p-2 -mr-2 text-white/70 active:scale-90"><Icon name="add_photo_alternate" className="text-[22px]" /></button>
      </header>
      <input ref={input} hidden type="file" accept="image/*" multiple onChange={e => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) addFiles(f); }} />

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-[calc(24px+env(safe-area-inset-bottom))]" data-src-version={sourceVersion}>
        {/* 原圖 */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
          {items.map(it => (
            <div key={it.id} className="shrink-0 flex gap-2">
              {it.src && <img src={it.src} alt="" className="h-28 rounded-xl object-contain bg-white/[0.04]" />}
              {it.preview && <img src={it.preview} alt="" className="h-28 rounded-xl object-contain bg-white" />}
            </div>
          ))}
          {!items.length && (
            <button onClick={() => input.current?.click()} className="w-full h-28 rounded-xl border border-dashed border-white/20 text-white/50 text-[12px] font-bold">選擇圖片</button>
          )}
        </div>

        {/* 設定 */}
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
          <Slider label="大小" left="小一點" right="更精細" value={s.width} min={1} max={200} step={1} onChange={set('width')}
            hint="越大越精細；但太寬的點陣圖貼到窄的地方會被換行而變形，選看得清楚的最小尺寸就好。" />
          <Slider label="明暗" left="暗一點" right="亮一點" value={s.threshold} min={0.01} max={0.99} step={0.01} onChange={set('threshold')} />
          <Slider label="線條多寡" left="少一點" right="多一點" value={s.lines} min={0} max={20} step={1} onChange={set('lines')}
            hint="越高，照片裡細微的線條也會被畫出來；太高會出現雜亂的點。" />
          <Slider label="線條粗細" left="細一點" right="粗一點" value={s.thicken} min={0} max={10} step={1} onChange={set('thicken')} disabled={shade} />
          <label className="flex items-center justify-between px-1">
            <span className="text-[12px] font-bold text-white/80">陰影（灰階層次）</span>
            <input type="checkbox" checked={shade} onChange={e => toggleShade(e.target.checked)} className="w-5 h-5 accent-white" />
          </label>
        </div>

        <button onClick={generate} disabled={!!busy || !items.length}
          className="mt-4 w-full h-12 rounded-full bg-white text-black text-[13px] font-black tracking-[0.08em] disabled:opacity-40 active:scale-[0.99]">
          {busy || '產生點陣文字'}
        </button>

        {/* 結果 */}
        {items.map(it => it.error ? (
          <p key={it.id} className="mt-4 text-[12px] text-red-400">{it.error}</p>
        ) : it.results && (
          <div key={it.id} className="mt-6 space-y-6">
            {(['shade', 'line'] as const).map(kind => {
              const list = it.results!.filter(r => r.kind === kind);
              return (
                <section key={kind}>
                  <h3 className="text-[11px] font-black tracking-[0.12em] text-white/50 mb-2">{kind === 'shade' ? '陰影' : '線稿'}</h3>
                  {list.length ? <div className="space-y-3">{list.map((r, i) => <ResultCard key={i} r={r} />)}</div>
                    : <p className="text-[11px] text-white/40">這組設定產生的是空白，請調整明暗再試一次。</p>}
                </section>
              );
            })}
            <p className="text-[10px] leading-relaxed text-white/35">小提示：字寬越小越好用，能放進留言的字數限制，在小螢幕上也不會被換行弄亂。選還看得清楚的最小尺寸。</p>
          </div>
        ))}
        <p className="mt-8 text-[9px] leading-relaxed text-white/25">線稿模型：Informative Drawings（Caroline Chan，MIT License）</p>
      </div>
    </div>
  );
}
