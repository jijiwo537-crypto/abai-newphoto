import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ASPECT_PRESETS,
  CropRect,
  DEFAULT_GEO,
  FULL_CROP,
  GeoParams,
  cropFitsQuad,
  fitCropInsideQuad,
  isGeoIdentity,
  outputQuad,
  stageAndWarp,
} from '../utils/compose';

const Icon: React.FC<{ name: string; className?: string; fill?: boolean }> = ({ name, className = '', fill }) => (
  <span
    className={`material-symbols-outlined ${className}`}
    style={{ fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 300, 'GRAD' 0, 'opsz' 24` }}
  >
    {name}
  </span>
);

type Tab = 'crop' | 'angle' | 'flip' | 'keystone';

/** 工作底圖的邊長上限。夠大到看得出梯形校正的細節，又不會讓每次拖曳都卡住。 */
const STAGE_MAX = 1400;
/** 拖曳過程中的工作解析度 */
const LIVE_MAX = 560;
/** 角度與翻轉的按鈕列共用同一個垂直位置，兩個頁籤切換時按鈕才不會跳 */
// 角度／翻轉兩排按鈕的位置：對齊裁切分頁的比例按鈕（86px 列高、按鈕 36px，置中即 25）
const BUTTON_ROW_TOP = (86 - 36) / 2;

/* 構圖這一層要對齊「編輯」的預覽區 —— 那一格上面是編輯器的標題列（h-14＝56），
   下面是它的分頁列（77）。三個工具都用同一組數字，裁切框的位置與大小才會一致。 */
const HEADER_H = 56;
const FOOTER_H = 77;

interface ComposeStudioProps {
  image: HTMLImageElement;
  geo: GeoParams;
  onChange: (geo: GeoParams) => void;
  onApply: () => void;
  onCancel: () => void;
  /**
   * 疊在第幾層。預設 70。
   *
   * 這一層必須蓋過「所在工具自己的標題列」，不然照片上緣會被那條列擋住。
   * 經典拼圖的標題列比 70 低，所以用預設值就好；
   * 創意拼圖的標題列是 z-100，要傳一個比它大的值進來。
   */
  zIndex?: number;
}

const HANDLES = [
  { id: 'tl', x: 0, y: 0 }, { id: 'tr', x: 1, y: 0 },
  { id: 'bl', x: 0, y: 1 }, { id: 'br', x: 1, y: 1 },
  { id: 't', x: 0.5, y: 0 }, { id: 'b', x: 0.5, y: 1 },
  { id: 'l', x: 0, y: 0.5 }, { id: 'r', x: 1, y: 0.5 },
] as const;

type HandleId = typeof HANDLES[number]['id'] | 'move';

/** 拖曳裁切框時的最小邊長（normalized）。 */
const MIN_CROP = 0.08;

/**
 * 給 Tailwind 的瀏覽器版 JIT 預熱用的 class 清單。
 *
 * 這個 App 掛的是 cdn.tailwindcss.com（index.html），它是在瀏覽器裡跑的 JIT：
 * 規則是「在 DOM 上看到那個 class 才產生」的，而且是非同步補上去的。
 * 構圖是整個 App 唯一用到底下大部分 class 的地方，所以第一次打開構圖時，
 * 這些 class 全都還沒有規則，瀏覽器會先畫一幀「沒有樣式」的畫面：
 *   壓暗層 rgba(0,0,0,0) → 0.6（照片先全亮再暗下去）
 *   裁切框 rgb(229,231,235) → rgba(255,255,255,0.9)（先是淺灰再變白）
 *   三分格線 寬 0 → 1px
 *   比例鍵 24×19 → 54×36
 * 這就是「第一次進構圖會閃一下、第二次就正常」的原因。
 *
 * 編輯器一開就把這串掛在一個看不見的節點上，JIT 會先把規則產生好，
 * 使用者真的點構圖時就已經齊全了。
 * 改 ComposeStudio 的 class 時這串要一起更新（scratchpad/warm.js 可以重新產生）。
 */
export const COMPOSE_WARMUP_CLASSES =
  '[&>*]:shrink-0 absolute bg-black bg-white bg-white/25 bg-white/[0.06] block ' +
  'border border-t border-white border-white/10 border-white/90 bottom-0 compose-slider ' +
  'duration-200 flex flex-1 flex-col font-black font-bold gap-1 gap-1.5 gap-2 gap-3 h-9 h-full ' +
  'h-px hover:text-white inset-0 items-center justify-between justify-center left-0 left-1/3 ' +
  'left-2/3 material-symbols-outlined max-w-2xl max-w-3xl max-w-md md:px-10 min-h-0 mx-auto ' +
  'no-scrollbar overflow-hidden overflow-x-auto pointer-events-none px-2 px-3.5 px-4 px-5 py-1 relative right-0 ' +
  'rotate-90 rounded-full select-none shadow-[0_1px_4px_rgba(0,0,0,0.6)] shrink-0 tabular-nums ' +
  'text-[10px] text-[11px] text-[9px] text-base text-black text-right text-white text-white/15 ' +
  'text-white/20 text-white/35 text-white/50 text-white/60 text-white/70 text-xl top-0 top-1/3 ' +
  'top-2/3 tracking-[0.15em] tracking-[0.1em] tracking-[0.2em] ' +
  'transition-[background-color,color,border-color] transition-colors uppercase w-12 w-14 ' +
  'w-full w-px';

export const ComposeStudio: React.FC<ComposeStudioProps> = ({ image, geo, onChange, onApply, onCancel, zIndex = 70 }) => {
  const [tab, setTab] = useState<Tab>('crop');
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  /** 拖滑桿或縮放時先用低解析度重算，不然每動一格都要重取樣整張圖，看起來就是一幀一幀的 */
  const [live, setLive] = useState(false);

  const geoRef = useRef(geo);
  useEffect(() => { geoRef.current = geo; }, [geo]);

  // 底圖只跟翻轉/鏡像/角度/梯形有關，跟裁切框無關，所以裁切拖曳不會重畫。
  const baseKey = `${geo.quarter}|${geo.angle}|${geo.flipH}|${geo.flipV}|${geo.keyV}|${geo.keyH}|${geo.zoom}|${geo.offset?.x}|${geo.offset?.y}|${live}`;
  const baseCanvas = useMemo(() => {
    if (!image) return null;
    return stageAndWarp(image, image.naturalWidth || image.width, image.naturalHeight || image.height, geo, live ? LIVE_MAX : STAGE_MAX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, baseKey]);

  // 底圖畫到螢幕上，並算出裁切框要疊在哪裡。
  // 用 useLayoutEffect：stageSize 還是 0 的時候舞台沒有寬高，畫布會用自己的
  // 原始尺寸撐開（量到第一幀是 374×809，下一幀才縮成 238×516，看起來就是閃一下）。
  // layout effect 在繪製前就把尺寸算好，那一幀根本不會被畫出來。
  useLayoutEffect(() => {
    const wrap = stageWrapRef.current;
    const cvs = canvasRef.current;
    if (!wrap || !cvs || !baseCanvas) return;

    const fit = () => {
      const box = wrap.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const s = Math.min(box.width / baseCanvas.width, box.height / baseCanvas.height);
      // round 而不是 floor：floor 會比一般預覽算出來的少 1px
      const w = Math.max(1, Math.round(baseCanvas.width * s));
      const h = Math.max(1, Math.round(baseCanvas.height * s));
      cvs.width = baseCanvas.width;
      cvs.height = baseCanvas.height;
      const ctx = cvs.getContext('2d')!;
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(baseCanvas, 0, 0);
      setStageSize({ w, h });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [baseCanvas]);

  const activeRatio = useMemo(() => {
    const p = ASPECT_PRESETS.find(a => a.id === geo.aspect);
    if (!p) return null;
    if (p.id === 'orig' && baseCanvas) return baseCanvas.width / baseCanvas.height;
    return p.ratio;
  }, [geo.aspect, baseCanvas]);

  // 旋轉或梯形校正之後畫面四角會空出來，裁切框不能框到那裡
  const quad = useMemo(() => {
    if (!image) return [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][];
    return outputQuad(image.naturalWidth || image.width, image.naturalHeight || image.height, geo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, baseKey]);

  const setGeo = useCallback((patch: Partial<GeoParams>) => {
    onChange({ ...geoRef.current, ...patch });
  }, [onChange]);

  // 底圖形狀一改變就把裁切框收回有效範圍，維持鎖定的比例
  useEffect(() => {
    if (!baseCanvas) return;
    const g = geoRef.current;
    if (cropFitsQuad(quad, g.crop)) return;
    const fitted = fitCropInsideQuad(quad, g.crop, baseCanvas.width, baseCanvas.height, activeRatio);
    onChange({ ...g, crop: fitted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quad, baseCanvas]);

  // 換比例時把裁切框重新塞成合法的最大置中矩形
  const applyAspect = useCallback((id: string) => {
    const g = geoRef.current;
    const preset = ASPECT_PRESETS.find(a => a.id === id);
    if (!preset || !baseCanvas) { if (preset) onChange({ ...geoRef.current, aspect: id }); return; }
    if (id === 'free') { onChange({ ...g, aspect: id }); return; }
    const ratio = id === 'orig' ? baseCanvas.width / baseCanvas.height : preset.ratio;
    if (ratio === null) { onChange({ ...g, aspect: id }); return; }
    const full: CropRect = { x: 0, y: 0, w: 1, h: 1 };
    onChange({ ...g, aspect: id, crop: fitCropInsideQuad(quad, full, baseCanvas.width, baseCanvas.height, ratio) });
  }, [onChange, baseCanvas, quad]);

  // ---- 裁切框拖曳 ----
  const dragRef = useRef<{ id: HandleId; startX: number; startY: number; start: CropRect; baseOffset?: { x: number; y: number } } | null>(null);
  const pinchRef = useRef<{ startDist: number; startCrop: CropRect } | null>(null);

  const onHandleDown = (id: HandleId) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 有些瀏覽器會擋，忽略即可 */ }
    dragRef.current = {
      id, startX: e.clientX, startY: e.clientY,
      start: { ...geoRef.current.crop },
      baseOffset: { ...(geoRef.current.offset || { x: 0, y: 0 }) },
    };
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || stageSize.w === 0 || stageSize.h === 0) return;
    e.preventDefault();
    const dx = (e.clientX - d.startX) / stageSize.w;
    const dy = (e.clientY - d.startY) / stageSize.h;
    const s = d.start;
    let { x, y, w, h } = s;

    if (d.id === 'move') {
      x = Math.max(0, Math.min(1 - w, s.x + dx));
      y = Math.max(0, Math.min(1 - h, s.y + dy));
    } else {
      const left = d.id.includes('l');
      const right = d.id.includes('r');
      const top = d.id === 't' || d.id === 'tl' || d.id === 'tr';
      const bottom = d.id === 'b' || d.id === 'bl' || d.id === 'br';
      const isCorner = d.id.length === 2;

      if (activeRatio === null || stageSize.w === 0 || stageSize.h === 0) {
        /* 不鎖比例：每一條邊各自跟著手指走，對面那條邊釘住不動。
           夾的是「這條邊能走到哪」，所以撞到畫面邊緣就停在那裡，
           再怎麼拖也不會把對面那條邊推出去。 */
        if (left) { const nx = Math.max(0, Math.min(s.x + s.w - MIN_CROP, s.x + dx)); w = s.x + s.w - nx; x = nx; }
        if (right) { w = Math.max(MIN_CROP, Math.min(1 - s.x, s.w + dx)); }
        if (top) { const ny = Math.max(0, Math.min(s.y + s.h - MIN_CROP, s.y + dy)); h = s.y + s.h - ny; y = ny; }
        if (bottom) { h = Math.max(MIN_CROP, Math.min(1 - s.y, s.h + dy)); }
      } else {
        /* 鎖比例。這裡以前有兩個毛病，都改掉了：

           ① 頂到邊之後繼續拖，框會從「對角」長出去。
              原因是算完新的寬高之後，收尾是把「位置」夾回畫面內
              （x = clamp(x, 0, 1-w)）—— 一旦超出去，被推走的就是那個
              本來該釘死不動的角。正確的做法是夾「大小」：先算出這個
              錨點在畫面裡最多能長多大，再把寬高限制在那之內，
              錨點就永遠不動。

           ② 拖四個角時只認左右、不認上下。
              原因是舊寫法看到 left||right 就只用寬度去推高度，dy 整個
              沒用到 —— 手指往下拉沒反應、只有左右滑才會變大小，
              角也就跟著跑掉、不在手指底下了。
              現在改成把手指投影到那條對角線上（正交投影），
              角會盡可能貼著手指走，斜著拉也順。 */
        const nRatio = activeRatio * (stageSize.h / stageSize.w);

        // 錨點：拖哪一邊／哪一角，對面那個就釘住（單邊則是另一軸維持置中）
        const ax = right ? s.x : left ? s.x + s.w : s.x + s.w / 2;
        const ay = bottom ? s.y : top ? s.y + s.h : s.y + s.h / 2;
        // 被拖的那一邊／那一角現在被手指帶到哪裡（絕對位置，不是累積量）
        const px = (right ? s.x + s.w : left ? s.x : s.x + s.w / 2) + dx;
        const py = (bottom ? s.y + s.h : top ? s.y : s.y + s.h / 2) + dy;

        let want: number;
        if (isCorner) {
          // 對角線方向是 (1, 1/nRatio)，把手指的位移投影上去
          const tx = Math.abs(px - ax), ty = Math.abs(py - ay);
          const k = 1 / nRatio;
          want = (tx + ty * k) / (1 + k * k);
        } else if (left || right) {
          want = Math.abs(px - ax);
        } else {
          want = Math.abs(py - ay) * nRatio;
        }

        // 這個錨點在畫面裡最多能長多大（橫豎各算一次，取小的）
        const maxWx = right ? 1 - ax : left ? ax : 2 * Math.min(ax, 1 - ax);
        const maxHy = bottom ? 1 - ay : top ? ay : 2 * Math.min(ay, 1 - ay);
        const lo = Math.max(MIN_CROP, MIN_CROP * nRatio);
        const hi = Math.max(lo, Math.min(maxWx, maxHy * nRatio));

        w = Math.min(Math.max(want, lo), hi);
        h = w / nRatio;
        x = right ? ax : left ? ax - w : ax - w / 2;
        y = bottom ? ay : top ? ay - h : ay - h / 2;
      }
    }

    const next = { x, y, w, h };
    // 不讓使用者把框拖到旋轉/校正後空出來的角落
    if (!cropFitsQuad(quad, next)) return;
    setGeo({ crop: next });
  };

  const onHandleUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* 同上 */ }
    dragRef.current = null;
  };


  // 雙指縮放影像（框固定）
  const onStageTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length < 2) return;
    dragRef.current = null;   // 兩指落下就取消單指的平移
    pinchRef.current = {
      startDist: Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      ) || 1,
      startCrop: { ...geoRef.current.crop },
    };
  };

  const onStageTouchMove = (e: React.TouchEvent) => {
    const pz = pinchRef.current;
    if (!pz || e.touches.length < 2) return;
    if (e.cancelable) e.preventDefault();
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    // 以框的中心等比縮放裁切框；比例鎖著的話兩邊一起走，超出畫面就停住
    const k = d / pz.startDist;
    const c = pz.startCrop;
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    let w = Math.max(MIN_CROP, c.w * k);
    let h = Math.max(MIN_CROP, c.h * k);
    if (w > 1) { h *= 1 / w; w = 1; }
    if (h > 1) { w *= 1 / h; h = 1; }
    setGeo({ crop: {
      x: Math.max(0, Math.min(1 - w, cx - w / 2)),
      y: Math.max(0, Math.min(1 - h, cy - h / 2)),
      w, h,
    } });
  };

  const onStageTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) return;
    pinchRef.current = null;
  };

  const cropStyle = {
    left: `${geo.crop.x * 100}%`,
    top: `${geo.crop.y * 100}%`,
    width: `${geo.crop.w * 100}%`,
    height: `${geo.crop.h * 100}%`,
  };

  const dirty = !isGeoIdentity(geo);

  const sliderRow = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onVal: (v: number) => void,
    onReset: () => void
  ) => (
    <div className="flex items-center gap-3 w-full max-w-md mx-auto px-5">
      <span className="text-[10px] font-bold tracking-[0.15em] text-white/50 w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onVal(parseFloat(e.target.value))}
        onPointerDown={() => setLive(true)}
        onPointerUp={() => setLive(false)}
        onPointerCancel={() => setLive(false)}
        onTouchStart={() => setLive(true)}
        onTouchEnd={() => setLive(false)}
        className="compose-slider flex-1"
      />
      <button
        onClick={onReset}
        className={`text-[11px] font-bold tabular-nums w-12 text-right shrink-0 transition-colors ${value === 0 ? 'text-white/35' : 'text-white'}`}
      >
        {value > 0 ? `+${value}` : value}
      </button>
    </div>
  );

  return (
    /* 這一整層的版面尺寸全部走 inline style，不走 class ——
       這個 App 掛的是 Tailwind 的瀏覽器版 JIT（cdn.tailwindcss.com），
       第一次看到某個 class 才會即時產生規則，中間至少會畫一幀「沒有那條規則」的畫面。
       構圖是唯一用到 pt-[15px]／h-[41px]／h-[86px]／max-h-[calc(100vh-340px)]／z-[70] 的地方，
       所以只有第一次進來會抖：量到照片先是 60,56,295,639（大一圈、高 15px），
       下一幀才變成正確的 79,71,257,556 —— 看起來就是「從上往下掉」。
       inline style 不經過樣式表，第一幀就是對的。 */
    /* 用 fixed ＋ 固定的上下留白，而不是 absolute inset-0。
       原因：inset-0 是「填滿呼叫端給的那個盒子」，而三個工具給的盒子不一樣 ——
       「編輯」給的是預覽區（上面還有它自己 56px 高的標題列、下面是 77px 的分頁列），
       兩個拼圖工具給的是整個螢幕。同一張照片因此在「編輯」落在 y≈90、
       在「經典拼圖」卻落在 y≈33，差了一整條標題列。

       改成固定 top:56 / bottom:77 之後，三個工具拿到的盒子完全一樣 ——
       而那個盒子正好就是「編輯」原本的預覽區，所以編輯這一支一個像素都沒變，
       另外兩支則對齊到它。上下讓出來的部分會露出各工具自己的標題列與分頁列，
       跟「編輯」的行為一致。 */
    <div
      className="fixed left-0 right-0 bg-black flex flex-col"
      style={{ zIndex, top: HEADER_H, bottom: FOOTER_H }}
    >
      <style>{`
        .compose-slider { -webkit-appearance: none; appearance: none; height: 2px; border-radius: 2px; background: rgba(255,255,255,0.18); outline: none; touch-action: none; }
        .compose-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.5); cursor: pointer; }
        .compose-slider::-moz-range-thumb { width: 16px; height: 16px; border: none; border-radius: 50%; background: #fff; cursor: pointer; }
      `}</style>


      {/* 舞台的可用高度＝預覽區 − 下面三列 = 100vh − 340px，跟一般預覽的
           maxHeight: calc(100vh - 340px) 完全一樣（下面三列合計 191px 就是為了湊這個）。
           上下不留內距，高度才會剛好相等；再往下推 15px，中心就跟一般預覽對齊
           —— 那 15px 是一般預覽在它自己的預覽區裡置中所產生的固定偏移，跟螢幕高度無關。 */}
      {/* 上方要留出瀏海／狀態列的高度。
           這一層是 absolute inset-0 的全螢幕覆蓋層（z-70），會蓋掉工具本身的
           標題列，所以安全區得自己留 —— 沒留的話，照片比較高的時候，
           上緣就會伸進瀏海底下被擋住（正是「進構圖時上面被裁到」）。
           那 15px 是原本讓中心跟一般預覽對齊的固定偏移，照舊加在後面。 */}
      <div
        className="flex-1 min-h-0 px-5 md:px-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 15px)' }}
      >
        {/* 高度用跟一般預覽同一條上限夾住，兩邊算出來的尺寸才會一模一樣
             （不夾的話 flex-1 的可用高會因為底部欄的小數而差 1px） */}
        {/* 兩指縮放掛在最外面這一層，不是掛在裁切框上。
             以前只有裁切框自己接得到，所以框拖小之後，兩指放在框外面
             （壓暗的那一圈、甚至照片旁邊的黑邊）捏了完全沒反應 ——
             但那正是框小的時候手指最自然會放的位置。
             現在整個預覽區都算數：觸控事件會從裁切框、從角上的把手一路冒泡
             到這裡，所以框裡框外走的是同一套處理，不會重複也不會打架。
             touchAction 要一起搬上來，不然瀏覽器會先把兩指當成自己的縮放收走。 */}
        <div
          ref={stageWrapRef}
          className="w-full h-full flex items-center justify-center"
          /* 高度上限也要扣掉剛剛讓出去的安全區，不然舞台會比實際可用空間高，
             多出來的部分一樣會頂到瀏海。
             另外 100vh 在手機瀏覽器是「網址列收起來時」的高度（偏大），
             改用 100dvh 才是當下真正看得到的高度。 */
          style={{
            maxHeight: 'calc(100dvh - 340px - env(safe-area-inset-top, 0px))',
            touchAction: 'none',
          }}
          onTouchStart={onStageTouchStart}
          onTouchMove={onStageTouchMove}
          onTouchEnd={onStageTouchEnd}
          onTouchCancel={onStageTouchEnd}
        >
        {/* 在框外面按下去也能搬裁切框。
             以前只有框「裡面」接得到手勢，框拖小之後想再挪位置，
             手指非得先戳進那一小塊才行。落在框上或角上時，那邊自己會
             stopPropagation，所以走不到這裡 —— 兩種操作不會打架。 */}
        <div
          className="relative select-none"
          style={{ width: stageSize.w || undefined, height: stageSize.h || undefined, touchAction: 'none' }}
          onPointerDown={onHandleDown('move')}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <canvas ref={canvasRef} className="w-full h-full block" />

          {/* 裁切框外面壓暗。
               本來是拿四塊 bg-black/60 拼出來的，四塊的邊界都落在同一個小數座標上，
               但各自四捨五入的結果不見得接得起來：差一點就漏出一條亮線，疊一點就變成
               一條更暗的線（0.6 疊 0.6 是 0.84）。拖動時兩種狀態交替出現，
               看起來就是「遮罩旁邊有條線在閃」。
               改成一塊剛好貼在裁切框上、什麼都不畫的元素，用外擴陰影把外圍壓暗 ——
               只上色一次、完全沒有接縫，怎麼拖都不會有線。外層 overflow-hidden
               負責把那圈很大的陰影收在舞台裡。 */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute" style={{ ...cropStyle, boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' }} />
          </div>

          {/* 裁切框 */}
          <div
            className="absolute border border-white/90"
            data-geo={`${geo.zoom}|${(geo.offset?.x ?? 0).toFixed(3)}|${(geo.offset?.y ?? 0).toFixed(3)}`}
            style={{ ...cropStyle, touchAction: 'none' }}
            onPointerDown={onHandleDown('move')}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          >
            {/* 三分格線 */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/25" />
              <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/25" />
              <div className="absolute top-1/3 left-0 right-0 h-px bg-white/25" />
              <div className="absolute top-2/3 left-0 right-0 h-px bg-white/25" />
            </div>

            {HANDLES.map(hd => {
              const corner = hd.id.length === 2;
              return (
                <div
                  key={hd.id}
                  onPointerDown={onHandleDown(hd.id)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className="absolute"
                  style={{
                    left: `${hd.x * 100}%`,
                    top: `${hd.y * 100}%`,
                    width: corner ? 34 : 30,
                    height: corner ? 34 : 30,
                    transform: 'translate(-50%, -50%)',
                    touchAction: 'none',
                    cursor: corner ? 'nwse-resize' : (hd.id === 't' || hd.id === 'b' ? 'ns-resize' : 'ew-resize'),
                  }}
                >
                  <div
                    className="absolute bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
                    style={corner
                      // 直角緊貼裁切框的四個角，不再以角為中心往外浮出去
                      ? {
                          width: 20, height: 20,
                          left: hd.x === 0 ? '50%' : undefined,
                          right: hd.x === 1 ? '50%' : undefined,
                          top: hd.y === 0 ? '50%' : undefined,
                          bottom: hd.y === 1 ? '50%' : undefined,
                          clipPath: 'polygon(0 0, 100% 0, 100% 3px, 3px 3px, 3px 100%, 0 100%)',
                          rotate: `${hd.id === 'tl' ? 0 : hd.id === 'tr' ? 90 : hd.id === 'br' ? 180 : 270}deg`,
                        }
                      : {
                          left: '50%', top: '50%',
                          width: (hd.id === 't' || hd.id === 'b') ? 22 : 3,
                          height: (hd.id === 't' || hd.id === 'b') ? 3 : 22,
                          transform: 'translate(-50%, -50%)',
                        }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>

      <div className="shrink-0">
      <header className="shrink-0 flex items-center justify-between px-5 w-full max-w-3xl mx-auto" style={{ height: 41 }}>
        <button
          onClick={onCancel}
          className="text-[11px] font-bold tracking-[0.2em] text-white/50 hover:text-white transition-colors px-2 py-1"
        >
          取消
        </button>
        <button
          onClick={() => onChange({ ...DEFAULT_GEO, crop: { ...FULL_CROP }, offset: { x: 0, y: 0 } })}
          disabled={!dirty}
          className={`text-[11px] font-bold tracking-[0.2em] px-2 py-1 transition-colors ${dirty ? 'text-white/60 hover:text-white' : 'text-white/15'}`}
        >
          重設
        </button>
        <button
          onClick={onApply}
          className="text-[11px] font-black tracking-[0.2em] text-white px-2 py-1"
        >
          完成
        </button>
      </header>
        <div className="flex items-center" style={{ height: 86 }}>
          {tab === 'crop' && (
            <div className="w-full flex overflow-x-auto no-scrollbar px-4">
              <div className="flex gap-2 mx-auto">
              {ASPECT_PRESETS.map(a => (
                <button
                  key={a.id}
                  onClick={() => applyAspect(a.id)}
                  className={`shrink-0 h-9 px-3.5 rounded-full text-[11px] font-bold tracking-[0.1em] border transition-[background-color,color,border-color] duration-200 ${
                    geo.aspect === a.id
                      ? 'bg-white text-black border-white'
                      : 'bg-white/[0.06] text-white/60 border-white/10 hover:text-white'
                  }`}
                >
                  {a.label}
                </button>
              ))}
              </div>
            </div>
          )}

          {tab === 'angle' && (
            <div className="w-full h-full relative">
              <div className="absolute left-0 right-0" style={{ top: -4 }}>
                {sliderRow('角度', geo.angle, -45, 45, 1, v => setGeo({ angle: v }), () => setGeo({ angle: 0 }))}
              </div>
              <div className="absolute left-0 right-0 flex justify-center gap-2" style={{ top: BUTTON_ROW_TOP }}>
                <button
                  onClick={() => setGeo({ quarter: (geo.quarter + 3) % 4 })}
                  className="h-9 px-3.5 rounded-full bg-white/[0.06] border border-white/10 text-white/70 hover:text-white text-[11px] font-bold tracking-[0.1em] flex items-center gap-1.5"
                >
                  <Icon name="rotate_left" className="text-base" />逆時針 90°
                </button>
                <button
                  onClick={() => setGeo({ quarter: (geo.quarter + 1) % 4 })}
                  className="h-9 px-3.5 rounded-full bg-white/[0.06] border border-white/10 text-white/70 hover:text-white text-[11px] font-bold tracking-[0.1em] flex items-center gap-1.5"
                >
                  <Icon name="rotate_right" className="text-base" />順時針 90°
                </button>
              </div>
            </div>
          )}

          {tab === 'flip' && (
            <div className="w-full h-full relative">
              <div className="absolute left-0 right-0 flex justify-center gap-2 px-4 [&>*]:shrink-0" style={{ top: BUTTON_ROW_TOP }}>
              <button
                onClick={() => setGeo({ flipH: !geo.flipH })}
                className={`shrink-0 h-9 px-3.5 rounded-full text-[11px] font-bold tracking-[0.1em] border flex items-center gap-1.5 transition-[background-color,color,border-color] duration-200 ${
                  geo.flipH ? 'bg-white text-black border-white' : 'bg-white/[0.06] text-white/60 border-white/10'
                }`}
              >
                <Icon name="flip" className="text-base" />水平翻轉
              </button>
              <button
                onClick={() => setGeo({ flipV: !geo.flipV })}
                className={`shrink-0 h-9 px-3.5 rounded-full text-[11px] font-bold tracking-[0.1em] border flex items-center gap-1.5 transition-[background-color,color,border-color] duration-200 ${
                  geo.flipV ? 'bg-white text-black border-white' : 'bg-white/[0.06] text-white/60 border-white/10'
                }`}
              >
                <Icon name="flip" className="text-base rotate-90" />垂直翻轉
              </button>
              </div>
            </div>
          )}

          {tab === 'keystone' && (
            <div className="w-full flex flex-col gap-3">
              {sliderRow('垂直', geo.keyV, -100, 100, 1, v => setGeo({ keyV: v }), () => setGeo({ keyV: 0 }))}
              {sliderRow('水平', geo.keyH, -100, 100, 1, v => setGeo({ keyH: v }), () => setGeo({ keyH: 0 }))}
            </div>
          )}
        </div>

        {/* 這一排是構圖的小分類，接在編輯器的分頁列上面 —— 不是螢幕最底下那一排，
             所以不用留 safe-area 的空間，留了會多出一塊黑的。 */}
        {/* 41 + 86 + 64 = 191，就是舞台可用高＝100vh − 340px 的由來，
             所以這三列的高度都要在第一幀就成立 —— 一律走 inline style。 */}
        <div className="border-t border-white/10 bg-black" style={{ height: 64 }}>
          <div className="flex h-full w-full max-w-2xl mx-auto">
          {([
            ['crop', 'crop', '裁切'],
            ['angle', 'rotate_90_degrees_ccw', '角度'],
            ['flip', 'flip', '翻轉'],
            ['keystone', 'transform', '梯形'],
          ] as [Tab, string, string][]).map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-200 ${tab === id ? 'text-white' : 'text-white/20'}`}
            >
              {/* 梯形那顆自己畫。Material Symbols 的 transform 是四支箭頭，
                   跟「梯形校正」對不太起來。改成真的畫一個上窄下寬的梯形，
                   就是由下往上拍建築物會看到的那個形狀。
                   20px 是為了對齊旁邊三顆的 text-xl（字型圖示是 1em）；
                   選到的時候填滿、沒選到的時候只有外框，跟 Icon 的 fill 一致。 */}
              {id === 'keystone' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
                  <path
                    d="M8 5.5H16L20 18.5H4Z"
                    fill={tab === id ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <Icon name={icon} className="text-xl" fill={tab === id} />
              )}
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">{label}</span>
            </button>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
};
