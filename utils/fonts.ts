/**
 * 文字圖層可用的字體。
 *
 * 全部走 Google Fonts，但**不會**一次載入 —— CJK 字體一個就好幾 MB，
 * 全部預載會直接讓 app 卡死。改成用到哪一個才插入那一個 <link>，
 * 字體選單則靠 IntersectionObserver 捲到哪裡載到哪裡。
 *
 * 每一類都把最常用的排在前面，並盡量避開長得幾乎一樣的家族。
 */

export type FontCategory = 'zh' | 'en' | 'ja' | 'ko';

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: '英文' },
  { id: 'ja', label: '日文' },
  { id: 'ko', label: '韓文' },
];

/** 每個字體要預覽的範例字，用該語言自己的字才看得出差別。 */
export const FONT_SAMPLE: Record<FontCategory, string> = {
  zh: '阿白',
  en: 'ABAI',
  ja: 'みかん',
  ko: '오렌지',
};

export interface FontDef {
  /** CSS font-family 名稱，同時也是 Google Fonts 的家族名 */
  name: string;
  category: FontCategory;
  /** 顯示用的中文別名 */
  label: string;
}

const zh: [string, string][] = [
  // Google Fonts 上真的有完整繁體字身的家族。ZCOOL / 馬善政 / 志莽 這類
  // 只有簡體字身，打繁體會缺字退回預設字體，所以整組拿掉。
  ['Noto Sans TC', '思源黑體'],
  ['Noto Serif TC', '思源宋體'],
  ['LXGW WenKai TC', '霞鶩文楷'],
  ['Chocolate Classical Sans', '巧克力黑體'],
  ['Cactus Classical Serif', '仙人掌明體'],
  ['LXGW WenKai Mono TC', '霞鶩文楷 等寬'],
  ['Huninn', '粉圓體'],
  ['Iansui', '芫荽'],
  // 可愛的圓體。字身是日系的，常用漢字都有；
  // 極少數只有繁體才會用到的字會退回思源黑體。
  ['Zen Maru Gothic', '圓體'],
];

const en: [string, string][] = [
  // 熱門與有個性的排前面；經典的襯線／無襯線保留，
  // 但把一整批長得差不多的通用無襯線（Inter、Roboto、Open Sans、Lato、
  // Work Sans、Karla、Mulish、Figtree…）拿掉。
  ['Bebas Neue', 'Bebas Neue'],
  ['Anton', 'Anton'],
  ['Playfair Display', 'Playfair Display'],
  ['Montserrat', 'Montserrat'],
  ['Pacifico', 'Pacifico'],
  ['Lobster', 'Lobster'],
  ['Dancing Script', 'Dancing Script'],
  ['Great Vibes', 'Great Vibes'],
  ['Caveat', 'Caveat'],
  ['Permanent Marker', 'Permanent Marker'],
  ['Abril Fatface', 'Abril Fatface'],
  ['Archivo Black', 'Archivo Black'],
  ['Bungee', 'Bungee'],
  ['Monoton', 'Monoton'],
  ['Press Start 2P', 'Press Start 2P'],
  // 立體投影與速度感斜體，兩款都很有個性
  ['Bungee Shade', 'Bungee Shade'],
  ['Faster One', 'Faster One'],
  ['Audiowide', 'Audiowide'],
  ['Orbitron', 'Orbitron'],
  ['Titan One', 'Titan One'],
  ['Alfa Slab One', 'Alfa Slab One'],
  ['Chewy', 'Chewy'],
  ['Amatic SC', 'Amatic SC'],
  ['Shadows Into Light', 'Shadows Into Light'],
  ['Indie Flower', 'Indie Flower'],
  ['Satisfy', 'Satisfy'],
  // 經典襯線
  ['EB Garamond', 'EB Garamond'],
  ['Cormorant Garamond', 'Cormorant Garamond'],
  ['Libre Baskerville', 'Libre Baskerville'],
  ['Merriweather', 'Merriweather'],
  ['Lora', 'Lora'],
  ['Spectral', 'Spectral'],
  ['Vollkorn', 'Vollkorn'],
  ['Cinzel', 'Cinzel'],
  ['Marcellus', 'Marcellus'],
  ['DM Serif Display', 'DM Serif Display'],
  ['Bitter', 'Bitter'],
  // 經典／有辨識度的無襯線與等寬
  ['Oswald', 'Oswald'],
  ['Raleway', 'Raleway'],
  ['Josefin Sans', 'Josefin Sans'],
  ['Quicksand', 'Quicksand'],
  ['Comfortaa', 'Comfortaa'],
  ['Righteous', 'Righteous'],
  ['Fredoka', 'Fredoka'],
  ['Space Grotesk', 'Space Grotesk'],
  ['Courier Prime', 'Courier Prime'],
  ['JetBrains Mono', 'JetBrains Mono'],
  ['IBM Plex Mono', 'IBM Plex Mono'],
];

const ja: [string, string][] = [
  ['Noto Sans JP', 'ノトサンス'],
  ['Noto Serif JP', 'ノト明朝'],
  ['M PLUS Rounded 1c', '丸ゴシック'],
  ['Zen Maru Gothic', 'ゼン丸ゴシック'],
  ['Zen Kaku Gothic New', 'ゼン角ゴシック'],
  ['Zen Old Mincho', 'ゼン明朝'],
  ['Zen Antique', 'ゼンアンティーク'],
  ['Zen Antique Soft', 'ゼンアンティーク軟'],
  ['Kosugi', '小杉ゴシック'],
  ['Kosugi Maru', '小杉丸'],
  ['Sawarabi Gothic', 'さわらびゴシック'],
  ['Sawarabi Mincho', 'さわらび明朝'],
  ['Shippori Mincho', 'しっぽり明朝'],
  ['Shippori Antique', 'しっぽりアンティーク'],
  ['Klee One', 'クレー'],
  ['Yusei Magic', '游星マジック'],
  ['Hachi Maru Pop', 'はちまるポップ'],
  ['Potta One', 'ポッタ'],
  ['RocknRoll One', 'ロックンロール'],
  ['Reggae One', 'レゲエ'],
  ['DotGothic16', 'ドットゴシック'],
  ['Train One', 'トレイン'],
  ['Stick', 'スティック'],
  ['Kaisei Decol', '解星デコール'],
  ['Kaisei Opti', '解星オプティ'],
  ['Kaisei HarunoUmi', '解星 春の海'],
  ['Kaisei Tokumin', '解星 特ミン'],
  ['BIZ UDPGothic', 'BIZ UD ゴシック'],
  ['BIZ UDPMincho', 'BIZ UD 明朝'],
  ['M PLUS 1p', 'M PLUS 1p'],
  ['M PLUS 1', 'M PLUS 1'],
  ['M PLUS 2', 'M PLUS 2'],
  ['Rampart One', 'ランパート'],
  ['Mochiy Pop One', 'もちぃポップ'],
  ['New Tegomin', 'ニューテゴミン'],
  ['Yuji Syuku', '佑字 肅'],
  ['Yuji Boku', '佑字 木'],
  ['Hina Mincho', 'ひな明朝'],
];

const ko: [string, string][] = [
  ['Noto Sans KR', '노토 산스'],
  ['Noto Serif KR', '노토 세리프'],
  ['Nanum Gothic', '나눔고딕'],
  ['Nanum Myeongjo', '나눔명조'],
  ['Black Han Sans', '검은고딕'],
  ['Do Hyeon', '도현'],
  ['Jua', '주아'],
  ['Gothic A1', '고딕 A1'],
  ['Nanum Pen Script', '나눔손글씨 펜'],
  ['Nanum Brush Script', '나눔손글씨 붓'],
  ['Gaegu', '개구'],
  ['Sunflower', '해바라기'],
  ['Song Myung', '송명'],
  ['Cute Font', '큐트'],
  ['Dokdo', '독도'],
  ['East Sea Dokdo', '동해독도'],
  ['Gamja Flower', '감자꽃'],
  ['Hi Melody', '하이멜로디'],
  ['Poor Story', '푸어스토리'],
  ['Single Day', '싱글데이'],
  ['Stylish', '스타일리시'],
  ['Yeon Sung', '연성'],
  ['Kirang Haerang', '기랑해랑'],
  ['Gugi', '구기'],
  ['Hahmlet', '함렛'],
  ['IBM Plex Sans KR', 'IBM Plex Sans KR'],
  ['Nanum Gothic Coding', '나눔고딕코딩'],
  ['Dongle', '동글'],
  ['Gowun Dodum', '고운돋움'],
  ['Gowun Batang', '고운바탕'],
];

export const FONTS: FontDef[] = [
  ...zh.map(([name, label]) => ({ name, label, category: 'zh' as const })),
  ...en.map(([name, label]) => ({ name, label, category: 'en' as const })),
  ...ja.map(([name, label]) => ({ name, label, category: 'ja' as const })),
  ...ko.map(([name, label]) => ({ name, label, category: 'ko' as const })),
];

export const DEFAULT_FONT = 'Noto Sans TC';

const requested = new Map<string, Promise<void>>();
/** CSS 已經下載完的家族。要「同步」知道能不能直接量字寬時用。 */
const cssDone = new Set<string>();

/**
 * 需要時才把某個字體的 <link> 塞進 head。重複呼叫不會重複載入。
 * 回傳的 Promise 在那份 CSS 真的下載完（或失敗）之後才 resolve ——
 * CSS 還沒到的時候 @font-face 根本還不存在，這時候去問 document.fonts.check
 * 會拿到「可以」的假答案（其實是配到系統的退回字體）。
 */
export function ensureFont(family: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const hit = requested.get(family);
  if (hit) return hit;
  const p = new Promise<void>(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') +
      ':wght@400;700&display=swap';
    const done = () => { cssDone.add(family); resolve(); };
    link.onload = done;
    link.onerror = done;
    document.head.appendChild(link);
  });
  requested.set(family, p);
  return p;
}

/** 這個家族的 CSS 下載完了沒（同步版）。 */
export function fontCssLoaded(family: string) {
  return cssDone.has(family);
}

/** 家族名 → 有沒有真正的斜體字身。沒有這個 key 代表還沒問過。 */
const italicSupport = new Map<string, boolean>();
const italicPending = new Map<string, Promise<boolean>>();

/**
 * 載入某個字體的斜體字身，順便問出「這個家族到底有沒有斜體」。
 *
 * Google Fonts 對沒有斜體的家族會直接回 400，所以用 <link> 的 load / error
 * 就能得到答案。斜體刻意用「另一個」<link>：就算失敗也只是這一份沒載到，
 * 正體那一份不受影響。沒有斜體字身時瀏覽器會自己歪一個假斜體出來，那不是
 * 真的斜體，所以問不到的家族就不該給使用者這個選項。
 */
export function ensureItalic(family: string): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const known = italicSupport.get(family);
  if (known !== undefined) return Promise.resolve(known);
  const pending = italicPending.get(family);
  if (pending) return pending;
  const p = new Promise<boolean>(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') +
      ':ital,wght@1,400;1,700&display=swap';
    link.onload = () => { italicSupport.set(family, true); resolve(true); };
    link.onerror = () => { italicSupport.set(family, false); link.remove(); resolve(false); };
    document.head.appendChild(link);
  });
  italicPending.set(family, p);
  return p;
}

/** 已經問到的答案；還沒問過回 undefined（給 UI 判斷要不要先藏起來）。 */
export function knownItalic(family: string) {
  return italicSupport.get(family);
}

/** 匯出前要確定字體真的下載完了，否則 canvas 會用退回字體畫出去。 */
export async function waitForFont(family: string, weight = 400, italic = false) {
  ensureFont(family);
  if (italic) await ensureItalic(family);
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 64px "${family}"`);
    await document.fonts.ready;
  } catch {
    /* 載不到就讓瀏覽器自己退回預設字體 */
  }
}

/** 預覽與匯出要用同一組 font shorthand，文字才會落在同一個位置。 */
export function fontStack(family?: string) {
  return `"${family || DEFAULT_FONT}", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
}
