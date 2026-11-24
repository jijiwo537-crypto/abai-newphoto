/* 「動畫時長」面板：測試網站網址加上 ?motion 才會出現（左下角的「動畫」按鈕）。
   列出所有介面過場動畫：在哪裡看得到、預覽、拖滑桿調整時長。調整的值存在這台裝置，App 立刻照新的值播；
   「複製設定」把調整過的值複製成一段文字，貼給開發者改成新的預設值。 */
import React, { useMemo, useRef, useState } from 'react';
import { MotionStage, type MotionStageApi } from './MotionStage';
import { isNative } from '../utils/native';
import { MOTION_ITEMS, ms, setMotion, resetMotion, motionOverrides, type MotionItem } from '../utils/motionTimings';

const FLAG = 'abai-motion-tuner';
/** 只在測試網站（網頁版）網址加上 ?motion 時出現；App（正式版）裡永遠沒有 */
export function motionTunerEnabled() {
  if (isNative()) return false;
  try {
    if (/[?&]motion\b/.test(location.search)) { localStorage.setItem(FLAG, '1'); return true; }
    return localStorage.getItem(FLAG) === '1';
  } catch { return false; }
}

export function MotionTuner() {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const stage = useRef<MotionStageApi>(null);
  const [slow, setSlow] = useState(1);
  const groups = useMemo(() => {
    const m = new Map<string, MotionItem[]>();
    for (const it of MOTION_ITEMS) { if (!m.has(it.group)) m.set(it.group, []); m.get(it.group)!.push(it); }
    return [...m.entries()];
  }, []);
  const set = (id: string, v: number | null) => { setMotion(id, v); force(n => n + 1); };
  const copy = async () => {
    const o = motionOverrides();
    const lines = MOTION_ITEMS.filter(it => o[it.id] != null).map(it => `${it.group}／${it.label}（${it.id}）：${it.def} → ${o[it.id]} ms`);
    const text = lines.length ? `動畫時長調整：\n${lines.join('\n')}` : '動畫時長：都沒有調整';
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  const changed = Object.keys(motionOverrides()).length;
  return (
    <>
      <button onClick={() => setOpen(true)} data-motion-tuner
        className="fixed left-2 bottom-24 z-[2147483600] h-9 px-3 rounded-full bg-[#ff9f0a] text-black text-[12px] font-bold shadow-lg active:scale-95">
        動畫{changed ? `（${changed}）` : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-[2147483601] bg-black/70 flex flex-col" onClick={() => setOpen(false)}>
          <div className="h-[100dvh] bg-[#151515] rounded-t-3xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-3 pb-1">
              <h2 className="text-white font-bold text-[15px]">動畫時長</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setSlow(v => (v === 1 ? 3 : 1))} className={`shrink-0 whitespace-nowrap h-8 px-3 rounded-full text-[12px] ${slow > 1 ? 'bg-[#ff9f0a] text-black font-bold' : 'bg-white/10 text-white/80'}`}>慢動作 ×3</button>
                <button onClick={() => setOpen(false)} className="shrink-0 whitespace-nowrap text-white/70 text-[13px] px-2">關閉</button>
              </div>
            </div>
            {/* 情境預覽：照 App 的版面重現每個過場，用的就是下面目前的時長 */}
            <div className="px-4 pb-2 pt-1 border-b border-white/10">
              <MotionStage ref={stage} slow={slow} />
            </div>
            <div className="overflow-y-auto px-4 pb-4">
              {groups.map(([g, items]) => (
                <section key={g} className="mt-3">
                  <h3 className="text-white/60 text-[12px] font-bold tracking-wider px-1 mb-1.5">{g}</h3>
                  {items.map(it => {
                    const v = ms(it.id), dirty = v !== it.def;
                    return (
                      <div key={it.id} className="rounded-2xl bg-white/[0.06] p-3 mb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-white text-[13px] font-medium">{it.label}</div>
                            <div className="text-white/45 text-[11px] mt-0.5">位置：{it.where}</div>
                          </div>
                          <button onClick={() => stage.current?.play(it.id)} className="h-8 px-3 shrink-0 whitespace-nowrap rounded-full bg-white/15 text-white text-[12px] active:scale-95">預覽</button>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <input type="range" min={0} max={1500} step={10} value={v} onChange={e => set(it.id, Number(e.target.value))} className="flex-1 accent-[#ff9f0a]" aria-label={it.label} />
                          <input type="number" min={0} max={5000} step={10} value={v} onChange={e => set(it.id, Number(e.target.value) || 0)}
                            className="w-16 h-8 rounded-lg bg-black/40 text-white text-[13px] text-right px-2" />
                          <span className="text-white/50 text-[11px]">ms</span>
                          <button disabled={!dirty} onClick={() => set(it.id, null)} className={`text-[11px] px-2 h-8 rounded-full ${dirty ? 'text-[#ff9f0a]' : 'text-white/25'}`}>預設 {it.def}</button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
            <div className="flex gap-2 px-4 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-white/10">
              <button onClick={() => { resetMotion(); force(n => n + 1); }} className="h-11 px-4 rounded-full bg-white/10 text-white text-[13px]">全部重設</button>
              <button onClick={copy} className="flex-1 h-11 rounded-full bg-[#ff9f0a] text-black font-bold text-[14px]">{copied ? '已複製，貼給我即可' : '複製設定'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
