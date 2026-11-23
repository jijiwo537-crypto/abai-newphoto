import React, { useEffect, useRef, useState } from 'react';
import { LiveRange } from './LiveRange';
import { Icon } from './Icon';
import { haptic } from '../utils/haptics';
import { developRaw, type RawDevelop, type RawLook } from '../utils/nativeCamera';

/* ── 沖洗（底片模式拍的 RAW）─────────────────────────────────────────
 * 底片模式拍照時刻意少曝光、保護亮部；這裡從 RAW 原始資料重新沖一次，改曝光、色溫。
 * 拍照當下的濾鏡、特效、裁切、日期在沖洗時就套上去（看到的就是成品的樣子）。
 * 滑桿拖動時只改數字，放手才重沖（沖一張要一點時間，邊拖邊沖會卡）。
 * 新的預覽沖好後淡入蓋上舊的，中間不閃、不轉圈。 */

export interface RawDevelopSheetProps {
  rawPath: string;
  /** 拍的時候少曝光了幾格（曝光的預設值就是把它沖回來） */
  protectEV: number;
  /** 拍照當下的樣子（濾鏡、特效、裁切、日期） */
  look: RawLook | null;
  onCancel: () => void;
  /** 沖好了：原尺寸的成品 */
  onDone: (url: string) => void;
  /** 測試頁用：換掉真正的解碼（網頁版沒有原生 RAW 解碼） */
  developer?: typeof developRaw;
}

type Tool = 'exposure' | 'temp';
const TEMP_MIN = 2500, TEMP_MAX = 10000;

export const RawDevelopSheet: React.FC<RawDevelopSheetProps> = ({ rawPath, protectEV, look, onCancel, onDone, developer = developRaw }) => {
  const [tool, setTool] = useState<Tool>('exposure');
  const [exposure, setExposure] = useState(protectEV);
  /** null＝還不知道拍攝當下的色溫（第一張預覽回來才知道） */
  const [temp, setTemp] = useState<number | null>(null);
  const asShot = useRef<number | null>(null);
  /* 兩層預覽：底下是目前的、上面是剛沖好的（淡入後換到底下） */
  const [frames, setFrames] = useState<{ base: string | null; top: string | null }>({ base: null, top: null });
  const [finishing, setFinishing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [entered, setEntered] = useState(false);

  const devRef = useRef<RawDevelop>({ exposure: protectEV });
  /* 放手（onCommit）跟最後一次 onValue 在同一個事件裡，state 還沒更新 —— 最新的值放這裡 */
  const latest = useRef<{ exposure: number; temp: number | null }>({ exposure: protectEV, temp: null });
  const busy = useRef(false), queued = useRef<RawDevelop | null>(null), alive = useRef(true);
  const urls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => { cancelAnimationFrame(t); alive.current = false; urls.current.forEach(u => URL.revokeObjectURL(u)); };
  }, []);

  /* 同一時間只沖一張；排隊的只留最新的設定 */
  const run = async (dev: RawDevelop) => {
    if (busy.current) { queued.current = dev; return; }
    busy.current = true;
    const r = await developer(rawPath, dev, look, true);
    busy.current = false;
    if (!alive.current) { if (r) URL.revokeObjectURL(r.url); return; }
    if (r) {
      urls.current.add(r.url);
      setFrames(f => ({ base: f.base, top: r.url }));
      if (asShot.current === null && r.asShotTemperature) {
        const k = Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, r.asShotTemperature)) / 50) * 50;
        asShot.current = k; setTemp(t => t ?? k);
        if (latest.current.temp === null) latest.current.temp = k;
        devRef.current = { ...devRef.current, temperature: devRef.current.temperature ?? k };
      }
    } else setFailed(f => f || !frames.base);
    const next = queued.current; queued.current = null;
    if (next) void run(next);
  };
  useEffect(() => { void run(devRef.current); }, []);

  /* 上面那層淡入完成：換到底下，舊的那張收掉 */
  const settle = () => setFrames(f => {
    if (!f.top) return f;
    if (f.base && f.base !== f.top) { URL.revokeObjectURL(f.base); urls.current.delete(f.base); }
    return { base: f.top, top: null };
  });

  const commit = (patch: Partial<RawDevelop>) => {
    devRef.current = { ...devRef.current, ...patch };
    void run(devRef.current);
  };

  const finish = async () => {
    if (finishing || failed) return;
    setFinishing(true); haptic('press');
    const r = await developer(rawPath, devRef.current, look, false);
    if (!alive.current) { if (r) URL.revokeObjectURL(r.url); return; }
    if (r) onDone(r.url); else { setFinishing(false); setFailed(true); }
  };

  const evText = `${exposure > 0.049 ? '+' : exposure < -0.049 ? '−' : ''}${Math.abs(exposure).toFixed(1)}`;
  const tempText = temp === null ? '—' : `${temp}K`;
  const reset = () => {
    haptic('detentMajor');
    if (tool === 'exposure') { latest.current.exposure = protectEV; setExposure(protectEV); commit({ exposure: protectEV }); }
    else if (asShot.current !== null) { latest.current.temp = asShot.current; setTemp(asShot.current); commit({ temperature: asShot.current }); }
  };
  const changed = { exposure: Math.abs(exposure - protectEV) > 0.04, temp: temp !== null && asShot.current !== null && temp !== asShot.current };

  return (
    <div data-raw-develop
      className={`fixed inset-0 z-[300] bg-black flex flex-col text-white select-none transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
      <header className="shrink-0 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),10px)] h-[calc(max(env(safe-area-inset-top),10px)+52px)]">
        <button aria-label="取消" onClick={onCancel} disabled={finishing}
          className="w-9 h-9 rounded-full bg-white/[0.08] flex items-center justify-center active:scale-90 transition-transform">
          <Icon name="close" className="text-[20px] text-white/85" />
        </button>
        <button onClick={() => void finish()} disabled={finishing || failed || !(frames.base || frames.top)}
          className="h-9 px-4 rounded-full bg-white text-black text-[14px] font-semibold disabled:opacity-35 active:scale-95 transition-[transform,opacity]">
          完成
        </button>
      </header>

      <div className="flex-1 min-h-0 relative mx-4 my-2">
        {frames.base && <img src={frames.base} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" />}
        {frames.top && <img key={frames.top} src={frames.top} alt="" draggable={false} onAnimationEnd={settle}
          className="absolute inset-0 w-full h-full object-contain animate-[developIn_220ms_ease-out_forwards]" />}
        {failed && !frames.base && <div className="absolute inset-0 flex items-center justify-center"><Icon name="image" className="text-[40px] text-white/25" /></div>}
      </div>

      <div className={`shrink-0 px-6 pb-[max(env(safe-area-inset-bottom),22px)] transition-opacity duration-200 ${finishing ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* 數值：點一下回到預設 */}
        <button onClick={reset} className="block mx-auto mb-2 text-[22px] font-light tabular-nums tracking-[-0.01em] text-white active:opacity-60">
          {tool === 'exposure' ? evText : tempText}
        </button>
        <div className="relative h-[30px] mb-6">
          {/* 中間的刻度（曝光 0 的位置／拍攝當下的色溫） */}
          {tool === 'exposure'
            ? <span aria-hidden className="absolute top-1/2 w-[2px] h-[14px] -ml-px -translate-y-1/2 rounded-full bg-white/35" style={{ left: `calc(13px + (100% - 26px) * ${(protectEV + 3) / 6})` }} />
            : asShot.current !== null && <span aria-hidden className="absolute top-1/2 w-[2px] h-[14px] -ml-px -translate-y-1/2 rounded-full bg-white/35" style={{ left: `calc(13px + (100% - 26px) * ${(asShot.current - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)})` }} />}
          {tool === 'exposure' ? (
            <div key="ev"><LiveRange ariaLabel="曝光" min={-3} max={3} step={0.1} value={exposure} height={30}
              className="premium-slider develop-slider w-full"
              onValue={v => { latest.current.exposure = v; setExposure(v); }}
              onCommit={() => commit({ exposure: Math.round(latest.current.exposure * 10) / 10 })} /></div>
          ) : (
            <div key="temp"><LiveRange ariaLabel="色溫" min={TEMP_MIN} max={TEMP_MAX} step={50} value={temp ?? 5500} height={30} disabled={temp === null}
              className="premium-slider develop-slider develop-slider-temp w-full"
              onValue={v => { latest.current.temp = v; setTemp(v); }}
              onCommit={() => commit({ temperature: latest.current.temp ?? undefined })} /></div>
          )}
        </div>
        <div className="flex justify-center gap-10">
          {([['exposure', 'exposure', '曝光'], ['temp', 'device_thermostat', '色溫']] as const).map(([id, icon, label]) => (
            <button key={id} onClick={() => { if (tool !== id) { haptic('tick'); setTool(id); } }}
              className={`relative flex flex-col items-center gap-1 w-14 transition-colors duration-200 ${tool === id ? 'text-white' : 'text-white/40'}`}>
              <Icon name={icon} className="text-[24px]" />
              <span className="text-[11px] font-medium tracking-[0.06em]">{label}</span>
              <span aria-hidden className={`absolute -bottom-2 w-1 h-1 rounded-full bg-white transition-opacity ${changed[id] ? 'opacity-100' : 'opacity-0'}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
