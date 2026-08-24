/**
 * 影片來源。
 *
 * 整張拼圖的繪製只認一件事：`ctx.drawImage(來源, …)`。
 * 而 `drawImage` 本來就吃 `<video>`，所以這裡的目標不是「多開一條影片管線」，
 * 而是**把一段影片包成一個長得跟 `<img>` 一模一樣的東西** ——
 * 有 `width` / `height`、有 `src`、畫得上去。包好之後，畫布那邊
 * 一行都不必為影片改寫，位置、旋轉、形狀、描邊、發光、動畫、導出全部照舊。
 *
 * 只有兩件事是影片才有的，也只有這兩件要特別處理：
 *   ① 它的內容會變 —— 所有「參數沒變就沿用上一張」的快取都要多吃一個
 *      `videoToken()`（見下面）。
 *   ② 它要有人推著走 —— 畫布不會自己重畫，得有一支迴圈跟著影格重畫。
 */

/** 檔案選擇器要接受的影片格式 */
export const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.ogv,.3gp';

/* 有些系統（尤其相簿匯出的 .mov）給的 MIME 是空的，只好退回看副檔名 */
const VIDEO_EXT = /\.(mp4|m4v|mov|qt|webm|ogv|ogg|3gp|3g2|avi|mkv)$/i;

/** 這個檔案是不是影片 */
export const isVideoFile = (f: File | null | undefined): boolean => {
  if (!f) return false;
  if (f.type) return f.type.startsWith('video/');
  return VIDEO_EXT.test(f.name || '');
};

/** 這個來源是不是影片（拿來分岔的唯一判斷，全 App 都用這一支） */
export const isVideoEl = (x: any): x is HTMLVideoElement =>
  !!x && typeof HTMLVideoElement !== 'undefined' && x instanceof HTMLVideoElement;

/**
 * 「現在是第幾格」的號碼牌。
 *
 * 拼圖裡到處都是「參數沒變就把上一張貼回去」的快取（洞裡的底圖、遮罩、
 * 物件的效果圖…），鑰匙都是那些參數本身。影片的參數從頭到尾不會變，
 * 但內容每一格都不一樣 —— 不多給一個會變的東西，畫面就會定格在第一幀。
 *
 * 用「播放時間（毫秒）」而不是「跑一個計數器」：暫停的時候它不會變，
 * 所以暫停時那些快取一樣全部命中，一格都不會白算。
 */
export const videoToken = (x: any): number =>
  isVideoEl(x) ? Math.round((x.currentTime || 0) * 1000) : 0;

/** 一組來源裡所有的影片（重複的只留一份） */
export const videosIn = (sources: any[]): HTMLVideoElement[] => {
  const out: HTMLVideoElement[] = [];
  for (const s of sources) if (isVideoEl(s) && out.indexOf(s) < 0) out.push(s);
  return out;
};

/** 這一組來源合起來的號碼牌 —— 直接串進快取鑰匙用 */
export const videoTokenOf = (sources: any[]): string => {
  const v = videosIn(sources);
  return v.length ? v.map(videoToken).join(',') : '';
};

/* ── 影片要掛在文件上 ────────────────────────────────────────────────
   iOS 對「沒有掛進畫面的 <video>」很不客氣：解碼器可能根本不會動，
   drawImage 就一直畫出同一格（或全黑）。掛進去、但擺在一個 1×1 的角落，
   使用者看不到，解碼器卻會照常工作。
   opacity 不能寫 0 —— 完全透明的元素在部分裝置上跟 display:none 同一個待遇。 */
let stage: HTMLDivElement | null = null;
const hostOf = (): HTMLDivElement => {
  if (stage && stage.isConnected) return stage;
  stage = document.createElement('div');
  stage.setAttribute('data-abai-video-stage', '');
  stage.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;'
    + 'opacity:0.01;pointer-events:none;z-index:-1;contain:strict';
  document.body.appendChild(stage);
  return stage;
};

/**
 * 讀一段影片，回傳一個「畫得上去、而且長得像 <img>」的元素。
 *
 * 一定要等到 `loadeddata`（readyState ≥ 2）才算好：只等 `loadedmetadata`
 * 的話寬高有了、第一格卻還沒解出來，那時候 drawImage 畫出來是空白的。
 */
export const loadVideoEl = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const el = document.createElement('video');
    /* muted 是自動播放的唯一條件（所有瀏覽器都一樣）。
       defaultMuted 也要設 —— Safari 看的是這個屬性，不是那個欄位。 */
    el.muted = true;
    (el as any).defaultMuted = true;
    el.loop = true;
    el.autoplay = true;
    el.playsInline = true;
    (el as any).webkitPlaysinline = true;
    el.preload = 'auto';
    el.setAttribute('muted', '');
    el.setAttribute('playsinline', '');
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      try { el.remove(); } catch { /* 本來就不在上面 */ }
      reject(new Error('video load failed'));
    };
    const ready = () => {
      if (settled) return;
      const w = el.videoWidth, h = el.videoHeight;
      if (!w || !h) return fail();
      settled = true;
      /* 這兩行就是「長得像 <img>」的全部 —— 管線讀的是 width / height，
         設好之後它跟一張圖再也分不出來。（元素不在畫面上，設了也不影響版面。） */
      el.width = w;
      el.height = h;
      el.play().catch(() => { /* 擋下來就先停著，之後互動時再播 */ });
      resolve(el);
    };
    el.addEventListener('error', fail, { once: true });
    el.addEventListener('loadeddata', ready, { once: true });
    hostOf().appendChild(el);
    el.src = url;
    // 已經有資料就不必等事件（同一條網址讀第二次時會走這裡）
    if (el.readyState >= 2) ready();
  });

/**
 * 把 <video> 放回那個 1×1 的角落。
 *
 * 借去別的地方掛（例如直接讓它自己在版面上播）之後，一定要用這支還回來 ——
 * **不能只做 removeChild**。規格寫得很清楚：媒體元素一離開文件就會被暫停，
 * 而暫停之後沒有人會再去播它，畫面就停在最後一格不動了。
 * 這裡是同一個工作階段內「拔起來、立刻插回去」，中間沒有回到穩定狀態，
 * 所以那條暫停規則不會觸發，播放完全不受影響。
 */
export const parkVideoEl = (el: any) => {
  if (!isVideoEl(el)) return;
  try {
    el.style.cssText = '';
    hostOf().appendChild(el);
  } catch { /* 放不回去也不能讓畫面掛掉 */ }
};

/** 收掉一段影片：停下來、解掉解碼器、從角落拿走 */
export const releaseVideoEl = (el: any) => {
  if (!isVideoEl(el)) return;
  try {
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.remove();
  } catch { /* 收不掉就算了，不能影響流程 */ }
};

/** 全部從頭開始播（導出影片時用：錄下來的第一格就要是第一格） */
export const rewindVideos = async (list: HTMLVideoElement[]) => {
  await Promise.all(list.map(v => new Promise<void>(res => {
    try {
      if (Math.abs(v.currentTime) < 0.01) { res(); return; }
      const on = () => { v.removeEventListener('seeked', on); res(); };
      v.addEventListener('seeked', on);
      v.currentTime = 0;
      // 有些格式 seek 不會回報，給一個上限免得卡住整個導出
      setTimeout(() => { v.removeEventListener('seeked', on); res(); }, 400);
    } catch { res(); }
  })));
};

/** 一起播 */
export const playVideos = (list: HTMLVideoElement[]) => {
  list.forEach(v => { try { if (v.paused) v.play().catch(() => { /* 擋下來就算了 */ }); } catch { /* 同上 */ } });
};

/** 一起停。看不到畫面的時候一定要停 —— 解碼器不會因為沒人看就自己休息。 */
export const pauseVideos = (list: HTMLVideoElement[]) => {
  list.forEach(v => { try { if (!v.paused) v.pause(); } catch { /* 停不了就算了 */ } });
};

/* ── 影片的「這一格」先落到一張普通畫布上 ────────────────────────────────
   把 <video> 直接畫進拼圖的畫布很貴，而且貴得很不直覺：

     ‧ 拼圖的畫布是 Display P3 的（見 utils/colorSpace），
     ‧ 畫上去的時候還帶著旋轉與縮放，
     ‧ 而影片解出來的那一格是 YUV、不是 RGB。

   三件事湊在一起，Skia 每一次 drawImage 都得重做「YUV → P3 ＋ 幾何變換」，
   一條快速路徑都走不到。實測**一次 13.9 毫秒**、佔掉整個畫面 42% 的時間 ——
   那就是「導入影片之後格數掉下來」的全部原因，跟圖案、遮罩、濾鏡都無關。

   改成兩段：影片先「原尺寸、不縮放、普通 sRGB」地畫進一張自己的畫布
   （這是瀏覽器最擅長、也最短的那條路），之後所有人都拿那張畫布當來源。
   畫布對畫布的 drawImage 是純記憶體搬移，同樣的縮放旋轉只要 0.06 毫秒。

   同一格只會落一次（拿播放時間當號碼牌），所以一格裡被畫幾次都不會多花；
   畫布掛在 WeakMap 上，影片被回收時它自己跟著走。 */
const frameCache = new WeakMap<HTMLVideoElement, { cv: HTMLCanvasElement; tok: number }>();

/**
 * 拿這段影片「現在這一格」的畫布。
 * 不是影片（或第一格還沒解出來）就原樣回傳 —— 所以呼叫端可以無腦包在外面，
 * 圖片那條路一個位元組都不會變。
 *
 * freeze = true：手上已經有一張夠大的就直接用，**不要**去落新的一格。
 * 手指正在畫面上拖的時候用這個。落一格 1080p 在手機等級的 CPU 上要 45 毫秒，
 * 而拖曳中畫面每一格都會重畫 —— 那 45 毫秒就直接排在使用者那一下的前面
 * （實測拖曳的輸入延遲 p90 從 16 毫秒變成 70 毫秒）。
 * 拖的那一兩秒裡影格停著沒有人會發現，手感差別卻是立刻看得出來的。
 */
export const videoFrame = (el: any, maxPx = 0, freeze = false): CanvasImageSource => {
  if (!isVideoEl(el)) return el;
  const vw = el.videoWidth | 0, vh = el.videoHeight | 0;
  if (!vw || !vh || el.readyState < 2) return el;
  /* maxPx：這一格最後會被畫成多大。一段 1080p 的影片顯示在 268px 的框裡，
     落格時就直接落成 308px 就好 —— 落成 1920px 再讓每一次 drawImage 去做
     高品質縮圖，等於同一件事做很多遍，而且每一遍都比這一次貴。
     不傳就是原尺寸（底圖那一路要畫得很大，不能先縮）。 */
  const k = maxPx > 0 ? Math.min(1, maxPx / Math.max(vw, vh)) : 1;
  const w = Math.max(1, Math.round(vw * k)), h = Math.max(1, Math.round(vh * k));
  let e = frameCache.get(el);
  if (!e) { e = { cv: document.createElement('canvas'), tok: -1 }; frameCache.set(el, e); }
  const cv = e.cv;
  const tok = videoToken(el);
  /* 什麼時候要重畫這一格：
       ① 影格換了（正常的播放）—— 順便換成這一次要的尺寸；
       ② 這一次要得比手上這張大（例如影片停下來、預覽切回完整倍率）。
     反過來，「同一格、只是這次要得比較小」就**不要重畫**，直接把手上這張
     交出去讓呼叫端自己縮 —— 離開工具時要做一張縮圖，那一下如果照著小尺寸
     重新落一次格，等於把 1080p 的影格再解一次（實測那一下佔掉整個離開時間
     的四分之一）。 */
  const needBigger = cv.width < w || cv.height < h;
  /* 拖曳中：手上那張夠大就直接交出去。夠不夠大是硬條件 ——
     沒有的話畫出來會是糊的，那不能省。 */
  if (freeze && e.tok >= 0 && !needBigger) return cv;
  if (e.tok !== tok || needBigger) {
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    // alpha:false —— 影片沒有透明度，關掉這一項瀏覽器可以少做一次混色
    const g = cv.getContext('2d', { alpha: false });
    if (!g) return el;
    g.imageSmoothingQuality = 'high';
    try { g.drawImage(el, 0, 0, w, h); } catch { return el; }
    e.tok = tok;
  }
  return cv;
};

/** 這幾段影片裡最長的那一段有幾秒（讀不到就 0） */
export const longestDuration = (list: HTMLVideoElement[]): number => {
  let d = 0;
  for (const v of list) {
    const n = v.duration;
    if (Number.isFinite(n) && n > d) d = n;
  }
  return d;
};
