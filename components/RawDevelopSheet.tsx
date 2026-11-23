import React, { useEffect, useRef, useState } from 'react';
import { LiveRange } from './LiveRange';
import { haptic } from '../utils/haptics';
import { developRaw, type RawDevelop } from '../utils/nativeCamera';

/* ── 重新沖洗（底片模式拍的 RAW）───────────────────────────────────
 * 底片模式拍照時刻意少曝光、保護亮部；這裡從 RAW 原始資料重新沖一次，
 * 可以改曝光、色溫（跟 Dazz 的「重新沖洗以獲得不同的曝光和色溫」一樣）。
 * 預覽用長邊 1400 的快速解碼，滑桿一動就重沖（同一時間只有一次在跑，排隊的只留最新的值）；
 * 按「沖洗」才用原尺寸、完整品質解碼，交給編輯頁。 */

export interface RawDevelopSheetProps {
  rawPath: string;
  /** 拍的時候少曝光了幾格（曝光滑桿的預設值就是把它沖回來） */
  protectEV: number;
  onCancel: () => void;
  /** 沖好了：原尺寸的圖 */
  onDone: (url: string) => void;
  /** 測試頁用：換掉真正的解碼（網頁版沒有原生 RAW 解碼） */
  developer?: typeof developRaw;
}

const TEMP_MIN = 2500, TEMP_MAX = 10000;

export const RawDevelopSheet: React.FC<RawDevelopSheetProps> = ({ rawPath, protectEV, onCancel, onDone, developer = developRaw }) => {
  const [exposure, setExposure] = useState(protectEV);
  /** null＝還不知道拍攝當下的色溫（第一次預覽回來才知道） */
  const [temp, setTemp] = useState<number | null>(null);
  const [asShot, setAsShot] = useState<number | null>(null);
  const asShotRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [failed, setFailed] = useState(false);

  /* 同一時間只沖一張；滑桿拖動時排隊的只留最新的值 */
  const busy = useRef(false);
  const queued = useRef<RawDevelop | null>(null);
  const alive = useRef(true);
  const shownUrl = useRef<string | null>(null);
  useEffect(() => () => {
    alive.current = false;
    if (shownUrl.current) URL.revokeObjectURL(shownUrl.current);
  }, []);

  const run = async (dev: RawDevelop) => {
    if (busy.current) { queued.current = dev; return; }
    busy.current = true; setRendering(true);
    const r = await developer(rawPath, dev, true);
    busy.current = false;
    if (!alive.current) { if (r) URL.revokeObjectURL(r.url); return; }
    if (r) {
      if (shownUrl.current) URL.revokeObjectURL(shownUrl.current);
      shownUrl.current = r.url;
      setPreview(r.url);
      if (asShotRef.current === null && r.asShotTemperature) {
        const k = Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, r.asShotTemperature)));
        asShotRef.current = k; setAsShot(k); setTemp(t => t ?? k);
      }
    } else if (!shownUrl.current) setFailed(true);
    const next = queued.current; queued.current = null;
    if (next) void run(next); else setRendering(false);
  };

  useEffect(() => { void run({ exposure }); /* 第一次：拍攝當下的白平衡 */ }, []);
  const develop = (e: number, t: number | null) => void run({ exposure: e, temperature: t ?? undefined });

  const finish = async () => {
    if (finishing) return;
    setFinishing(true); haptic('press');
    const r = await developer(rawPath, { exposure, temperature: temp ?? undefined }, false);
    if (!alive.current) { if (r) URL.revokeObjectURL(r.url); return; }
    if (r) onDone(r.url);
    else { setFinishing(false); setFailed(true); }
  };

  const evText = `${exposure > 0.049 ? '+' : ''}${exposure.toFixed(1)}`;
  return (
    <div className="fixed inset-0 z-[300] bg-black flex flex-col text-white select-none" data-raw-develop>
      <header className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] h-[calc(max(env(safe-area-inset-top),12px)+48px)] shrink-0">
        <button onClick={onCancel} disabled={finishing} className="h-9 px-2 text-[15px] text-white/75 active:opacity-60">取消</button>
        <span className="text-[15px] font-semibold tracking-[0.04em]">重新沖洗</span>
        <button onClick={() => void finish()} disabled={finishing || failed || !preview}
          className="h-9 px-3.5 rounded-full bg-white text-black text-[14px] font-semibold disabled:opacity-40 active:scale-95 transition-transform">
          {finishing ? '沖洗中…' : '沖洗'}
        </button>
      </header>

      <div className="flex-1 min-h-0 relative flex items-center justify-center px-4">
        {preview && <img src={preview} alt="RAW 預覽" className="max-w-full max-h-full object-contain rounded-[10px]" draggable={false} />}
        {(rendering || finishing) && !failed && (
          <div className="absolute top-3 right-6 w-5 h-5 rounded-full border-2 border-white/25 border-t-white animate-spin" aria-label="沖洗中" />
        )}
        {failed && <p className="text-white/60 text-[13px]">這張 RAW 沖不出來，請直接編輯照片</p>}
      </div>

      <div className="shrink-0 px-6 pt-5 pb-[max(env(safe-area-inset-bottom),28px)] flex flex-col gap-5">
        <div>
          <div className="flex justify-between text-[11px] font-bold text-white/55 tracking-[0.14em] mb-2">
            <span>曝光</span>
            <button className="text-white tabular-nums tracking-normal" onClick={() => { setExposure(protectEV); develop(protectEV, temp); }}>{evText}</button>
          </div>
          <LiveRange ariaLabel="曝光" min={-3} max={3} step={0.1} value={exposure} disabled={finishing}
            onValue={v => { setExposure(v); develop(v, temp); }} />
        </div>
        <div>
          <div className="flex justify-between text-[11px] font-bold text-white/55 tracking-[0.14em] mb-2">
            <span>色溫</span>
            <button className="text-white tabular-nums tracking-normal" onClick={() => { if (asShot !== null) { setTemp(asShot); develop(exposure, asShot); } }}>
              {temp === null ? '—' : `${temp}K`}
            </button>
          </div>
          <LiveRange ariaLabel="色溫" min={TEMP_MIN} max={TEMP_MAX} step={50} value={temp ?? 5500} disabled={finishing || temp === null}
            onValue={v => { setTemp(v); develop(exposure, v); }} />
        </div>
        <p className="text-[11px] text-white/40 leading-relaxed">
          底片模式拍照時少曝光了 {protectEV} 格保護亮部，曝光預設 +{protectEV} 就是沖回正常亮度。點數值回到預設。
        </p>
      </div>
    </div>
  );
};
