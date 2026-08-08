import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from './Icon';
import { ThreeBackground } from './ThreeBackground';
import type { ExportMeta } from '../utils/exportHistory';

const CONTACT_EMAIL = 'chi888969930522@gmail.com';
const CONTACT_IG = 'abai_is.perfect';
const CONTACT_IG_URL = 'https://www.instagram.com/abai_is.perfect/';

interface HomePageProps {
  onOpenCamera: () => void;
  onImportPhoto: () => void;
  onImportToCollage: () => void;
  onOpenLayout: () => void;
  onOpenBeauty: () => void;
  onOpenMatch: () => void;
  /** 導出紀錄，新的在前面 */
  recent?: ExportMeta[];
  onOpenRecent?: (id: string) => void;
}

/** Material Symbols 沒有 IG 的標誌，自己畫：圓角方框 + 鏡頭圓 + 右上角那點 */
const InstagramGlyph: React.FC<{ className?: string }> = ({ className = 'w-[18px] h-[18px]' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5.4" stroke="currentColor" strokeWidth="1.9" />
    <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="1.9" />
    <circle cx="17.2" cy="6.8" r="1.15" fill="currentColor" />
  </svg>
);

/** 「3 小時前」這種相對時間。剛存的就寫「剛剛」 */
const timeAgo = (at: number): string => {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return '剛剛';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
};

/** 還沒有內容的格子：跟上面那排功能按鈕同一個底色，不要另外畫斜線 */
const EMPTY_TILE = 'bg-white/[0.06] border border-white/10';

const TOOL_TILES = [
  { icon: 'layers', label: '創意拼圖', key: 'collage' },
  { icon: 'grid_view', label: '經典拼圖', key: 'layout' },
  { icon: 'magic_button', label: '美顏', key: 'beauty' },
  { icon: 'colorize', label: '仿色', key: 'match' },
] as const;

/**
 * 模板庫先放空版位看效果。
 * 比例故意排得很不規則（直式、方形、橫式混著），版面才不會像一格一格的表格。
 *
 * 排列是「左、右、左、右…」，所以偶數格在左欄、奇數格在右欄。
 * 左欄用到的六個比例與右欄完全相同（只是順序不一樣），
 * 兩欄的總高度因此一模一樣 —— 第一格頂端齊、最後一格底部也齊，不會有一欄凸出來。
 */
const RATIOS = ['9 / 16', '4 / 3', '1 / 1', '3 / 4', '16 / 9', '5 / 4'];
const LIB_TEMPLATES: { name: string; ratio: string }[] = Array.from({ length: 12 }, (_, i) => ({
  name: `模板 ${String(i + 1).padStart(2, '0')}`,
  // 右欄從第 4 個比例開始輪，兩欄拿到的是同一組六個、順序不同
  ratio: RATIOS[(Math.floor(i / 2) + (i % 2 ? 3 : 0)) % RATIOS.length],
}));

const ACCOUNT_KEY = 'abai:account';

interface Account { kind: 'phone' | 'email'; id: string; at: number }

/** 顯示用：手機留頭尾、信箱只留第一個字 */
const maskId = (a: Account): string => {
  if (a.kind === 'phone') {
    const d = a.id.replace(/\D/g, '');
    return d.length <= 5 ? d : `${d.slice(0, 4)}***${d.slice(-3)}`;
  }
  const [u, host = ''] = a.id.split('@');
  return `${u.slice(0, 1)}${'*'.repeat(Math.max(2, u.length - 1))}@${host}`;
};

const readAccount = (): Account | null => {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw);
    return a && a.id ? a : null;
  } catch { return null; }
};

/* 分頁列只有文字、沒有圖示 —— 三個字並排本來就分得出來，
   少一排圖示這條列也矮一點，畫面看起來更乾淨。 */
const NAV_ITEMS = [
  { id: 'home', label: '修圖' },
  { id: 'lib', label: '模板' },
  { id: 'me', label: '我的' },
] as const;

export const HomePage: React.FC<HomePageProps> = ({
  onOpenCamera, onImportPhoto, onImportToCollage, onOpenLayout, onOpenBeauty, onOpenMatch,
  recent = [], onOpenRecent,
}) => {
  const [nav, setNav] = useState<string>('home');
  const [libQuery, setLibQuery] = useState('');
  const [contactOpen, setContactOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  /* 首頁與靈感是同一條捲軸的上下兩段：往下滑就到靈感，搜尋欄剛好在第一屏外面。 */
  const scrollRef = useRef<HTMLDivElement>(null);
  const libRef = useRef<HTMLDivElement>(null);
  /* 廣告版位。點「模板」捲下去的時候要以「它看得到的下緣」為準 ——
     那一塊是絕對定位往下多長 50px 的，只捲到 libRef 的話，它多出來的
     那一截（連同圓角的邊）還會留在畫面最上面。 */
  const adBoxRef = useRef<HTMLDivElement>(null);
  const adFillRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  /* 在「我」的時候捲軸那一頁是藏起來的，捲動事件不能反過來改分頁 */
  const navRef = useRef(nav);
  useEffect(() => { navRef.current = nav; }, [nav]);

  /* --- 登入 ---
     沒有後端，帳號就存在這台裝置上（localStorage）。流程與畫面照真的做：
     輸入手機／信箱 → 驗證碼 → 登入中 → 登入完成，之後可以登出。
     只收識別碼與驗證碼，不收密碼。 */
  const [account, setAccount] = useState<Account | null>(readAccount);
  const [loginOpen, setLoginOpen] = useState(false);
  const [step, setStep] = useState<'id' | 'code' | 'busy'>('id');
  const [kind, setKind] = useState<'phone' | 'email'>('phone');
  const [idInput, setIdInput] = useState('');
  const [code, setCode] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const idOk = kind === 'phone'
    ? /^09\d{8}$/.test(idInput.replace(/\D/g, ''))
    : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(idInput.trim());

  const openLogin = () => {
    setStep('id'); setIdInput(''); setCode(''); setLoginErr(''); setCooldown(0);
    setLoginOpen(true);
  };

  const sendCode = () => {
    if (!idOk) { setLoginErr(kind === 'phone' ? '請輸入 10 碼手機號碼' : '請輸入正確的電子郵件'); return; }
    setLoginErr(''); setStep('code'); setCooldown(60);
  };

  const submitCode = () => {
    if (code.length !== 6) { setLoginErr('請輸入 6 位數驗證碼'); return; }
    setLoginErr(''); setStep('busy');
    // 沒有後端可以驗，這裡就是等一下再讓它成功
    setTimeout(() => {
      const a: Account = { kind, id: kind === 'phone' ? idInput.replace(/\D/g, '') : idInput.trim(), at: Date.now() };
      try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)); } catch { /* 私密瀏覽會擋 */ }
      setAccount(a);
      setLoginOpen(false);
    }, 900);
  };

  const logout = () => {
    try { localStorage.removeItem(ACCOUNT_KEY); } catch { /* ignore */ }
    setAccount(null);
  };

  /** 從「我」切回來時要定位到哪裡（直接跳，不能用捲動動畫） */
  const jumpRef = useRef<string | null>(null);
  /* 點了分頁之後、平滑捲動還在跑的那段時間，鎖住亮的是哪一顆。
     不鎖的話：點「模板」→ 馬上亮模板 → 捲動途中還沒過半屏，
     捲動處理器算出來是「修圖」就把它蓋回去 → 到了才又變回模板，
     看起來就是點一下閃一下。捲到目標（或使用者自己動了捲軸）就解鎖。 */
  const navLockRef = useRef<string | null>(null);

  /**
   * 點「模板」要捲到哪裡。
   *
   * 以前是捲到 libRef 的頂端，但廣告版位是「絕對定位往下多長 50px」的，
   * 那多出來的一截（含圓角的邊線）會蓋在 libRef 上面 —— 捲到定位之後，
   * 搜尋欄上方還看得到那一塊的下緣跟它的邊。
   * 改成量那一塊「真正看得到的下緣」在哪，捲到它剛好出畫面為止，
   * 再多 1px 保證連邊都不會留下（次像素繪製時邊線會佔到半個像素）。
   */
  const libScrollTop = (sc: HTMLDivElement) => {
    const fallback = libRef.current?.offsetTop ?? sc.clientHeight;
    const fill = adFillRef.current;
    if (!fill) return fallback;
    const scTop = sc.getBoundingClientRect().top;
    const bottom = fill.getBoundingClientRect().bottom;
    return Math.max(fallback, Math.round(sc.scrollTop + (bottom - scTop)) + 1);
  };

  /** 分頁列：首頁／靈感是同一條捲軸的兩個位置，「我」才是換頁 */
  const goNav = useCallback((id: string) => {
    const fromMe = navRef.current === 'me';
    setNav(id);
    if (id === 'me') return;
    if (fromMe) {
      // 捲動區在「我」的時候是藏起來的，還停在離開時的位置。
      // 這裡交給下面的 layout effect 在畫出來之前直接定位 ——
      // 用 scrollTo 的話會看到它從下面滑上來。
      jumpRef.current = id;
      return;
    }
    const sc = scrollRef.current;
    if (!sc) return;
    navLockRef.current = id;
    sc.scrollTo({ top: id === 'lib' ? libScrollTop(sc) : 0, behavior: 'smooth' });
  }, []);

  /* 使用者自己碰捲軸就立刻解鎖 —— 平滑捲動被打斷時不能一直鎖著 */
  const releaseNavLock = useCallback(() => { navLockRef.current = null; }, []);

  /* 在瀏覽器畫出來之前就把位置設好，所以看不到任何位移 */
  useLayoutEffect(() => {
    const target = jumpRef.current;
    if (target == null) return;
    jumpRef.current = null;
    const sc = scrollRef.current;
    if (!sc) return;
    sc.scrollTop = target === 'lib' ? libScrollTop(sc) : 0;
  }, [nav]);

  /** 捲到哪裡就亮哪一個分頁。
      主視覺不用在這裡動 —— 它現在就在捲動內容裡，瀏覽器自己會捲，
      跟品牌字與其他東西完全同一拍。捲過第一屏它就自然離開畫面了，
      所以也不需要再淡出。 */
  const onScroll = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const h = sc.clientHeight || 1;
    if (navRef.current === 'me') return;
    const next = sc.scrollTop > h * 0.5 ? 'lib' : 'home';
    // 捲動途中不要跟著跳，捲到目標了才解鎖交還控制權
    if (navLockRef.current) {
      if (next === navLockRef.current) navLockRef.current = null;
      return;
    }
    if (next !== navRef.current) setNav(next);
  }, []);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
    } catch {
      // 沒有剪貼簿權限（或不是安全來源）就退回選取複製
      const ta = document.createElement('textarea');
      ta.value = CONTACT_EMAIL;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* 真的不行就算了 */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const libList = LIB_TEMPLATES.filter(t => !libQuery.trim() || t.name.includes(libQuery.trim()));

  const tileAction: Record<string, () => void> = {
    collage: onImportToCollage,
    layout: onOpenLayout,
    beauty: onOpenBeauty,
    match: onOpenMatch,
  };

  return (
    <div className="w-full h-screen bg-black text-white font-sans flex flex-col overflow-hidden relative">
      {/* 主視覺搬到捲動區裡面去了（見下面）。標題列整個拿掉了 ——
           品牌字與聯絡鈕都在首頁那一頁裡，所以主視覺上面不再壓著任何一條。 */}

      {/* --- 內容 ---
           設計稿是 overflow:hidden，但那是在 844 高的框裡量的；矮一點的機型會被切掉，
           所以改成可捲動＋藏捲軸（設計稿本來就掛了 no-sb）。 */}
      {/* --- 個人檔案（我）--- */}
      {nav === 'me' && (
        /* 上面那條標題列拿掉了，這裡自己補回它原本的高度（safe-area + 62px），
           這一頁的東西才會留在原來的位置，不會整組往上跑。 */
        <div className="no-scrollbar relative z-[5] flex-1 min-h-0 overflow-y-auto px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+62px)] box-border">
          {/* 登入入口。已登入就換成帳號本身 */}
          <button
            onClick={() => { if (!account) openLogin(); }}
            className="w-full flex items-center gap-4 pt-3 pb-5 text-left active:opacity-70 transition-opacity duration-200"
          >
            <span className="w-[68px] h-[68px] shrink-0 rounded-full bg-white/[0.05] border border-white/[0.14] flex items-center justify-center text-white/30">
              <Icon name="person" className="text-[34px]" />
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="text-[24px] font-bold tracking-[0.02em] leading-none truncate">
                {account ? maskId(account) : '立即登入'}
              </span>
              <span className="text-[11px] text-white/35">
                {account ? '已登入' : '登入後可同步你的作品與偏好'}
              </span>
            </span>
            {!account && (
              <span className="shrink-0 flex items-center gap-1 h-8 pl-3 pr-2 rounded-full bg-white/[0.06] border border-white/10">
                <span className="text-[12px] font-bold tabular-nums text-white/80">0</span>
                <Icon name="chevron_right" className="text-[16px] text-white/35" />
              </span>
            )}
          </button>

          {/* 會員方案。沒有接金流，按鈕先不做事 */}
          <div
            className="rounded-[16px] overflow-hidden border border-white/[0.14] px-5 pt-[18px] pb-4 flex items-center gap-3"
            style={{ background: 'linear-gradient(120deg,#2b2b2b 0%,#1a1a1a 46%,#242424 100%)' }}
          >
            <span className="flex-1 min-w-0 flex flex-col gap-1.5">
              <span className="flex items-center gap-2">
                <Icon name="diamond" className="text-[20px] text-white/90" />
                <span className="font-serif text-[22px] leading-none tracking-tight">ABAI PRO</span>
              </span>
              <span className="text-[11px] text-white/45">
                {account ? '解鎖全部權益' : '登入即可解鎖全部權益'}
              </span>
            </span>
            <span className="shrink-0 h-9 px-5 rounded-full bg-white text-black text-[12px] font-black tracking-[0.08em] flex items-center">
              立即訂閱
            </span>
          </div>

          {account && (
            <button
              onClick={logout}
              className="mt-6 w-full h-[46px] rounded-[12px] bg-white/[0.05] border border-white/10 text-[12px] font-bold tracking-[0.1em] text-white/60 hover:bg-white/[0.1] active:scale-[0.98] transition-[background-color,transform] duration-300"
            >
              登出
            </button>
          )}
        </div>
      )}

      {/* --- 首頁 ＋ 靈感：同一條捲軸的上下兩段 ---
           第一段固定就是一屏（h-full），所以沒有往下滑的時候看不到靈感的搜尋欄；
           往下滑就接著是搜尋欄與模板。 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={releaseNavLock}
        onWheel={releaseNavLock}
        onTouchStart={releaseNavLock}
        /* 這個內距是拿來抵銷分頁列高度變化的：分頁列一矮，這一格就多長，
           貼著下緣排的那一疊東西就會跟著移動。內距補回同樣的量，可用高度不變，
           主頁上面所有東西就都待在原位。
           拿掉圖示時分頁列矮了 26px；字級 9→12px 之後又高回 5px，所以是 26-5=21。 */
        className={`no-scrollbar relative z-[5] flex-1 min-h-0 overflow-y-auto box-border pb-[21px] ${nav === 'me' ? 'hidden' : 'block'}`}
      >
      {/* 這一疊是靠 mt-auto 貼著下緣排的，底部留白加大就等於整組一起往上。
           用 min-h-full 而不是 h-full：矮的機型內容會比一屏高，寫死高度會被切掉；
           撐開的話最多就是搜尋欄再往下一點，反正它本來就要在第一屏外面。 */}
      {/* pb 50 → 42：整疊往下 8px。
           廣告版位看得到的下緣與分頁列上緣原本差 24px，減三分之一就是 16px，
           所以整疊往下挪 8px。這一疊是貼著下緣排的，pb 少 8 就等於整組下移 8。
           主視覺與品牌字不在這個流裡（絕對定位），所以它們各自也加了同樣的 8px。 */}
      <div className="relative min-h-full px-6 pb-[42px] flex flex-col gap-[22px] box-border">
        {/* --- 主視覺 ---
             設計稿這裡是一個等著放圖的插槽，App 本來就有的 3D 背景剛好是它的主視覺，
             就讓它填這一格。下緣那道漸層負責把圖收進純黑，跟下面的內容接起來。
             高度用 vh 收斂：設計稿是 390×844 的固定框，小螢幕照抄 328px 會吃掉太多。

             它跟品牌字放在同一個容器裡（都是這一頁的絕對定位子節點），
             所以往下滑時是瀏覽器自己在捲，跟品牌字、跟所有東西完全同步。
             以前它掛在捲動區外面、靠 onScroll 去改 transform，捲動事件永遠慢一拍，
             看起來就是「3D 物件的移動方式跟別的東西不一樣」。
             絕對定位的容器塊是父層的 padding box，所以 left/right 0 就是整個寬度，
             不會被 px-6 縮進去。

             層次：這一塊放 z-0，下面幾排按鈕各自加 relative z-10 壓在它上面。
             不能用 z-index -1 —— 手機（尤其 iOS）的捲動區會自己合成一層，
             負的 z-index 會被畫到那一層後面，整顆 3D 球就看不見了。 */}
        <div
          ref={heroRef}
          className="absolute top-[8px] left-0 right-0 h-[38vh] min-h-[200px] max-h-[328px] bg-black z-0"
        >
          {/* 「我」那一頁不要 3D 物件 */}
          {nav !== 'me' && <ThreeBackground />}
          <div
            className="absolute inset-x-0 bottom-[-2px] h-10 pointer-events-none"
            style={{
              background:
                'linear-gradient(to top,#000 0%,rgba(0,0,0,.94) 16%,rgba(0,0,0,.82) 32%,rgba(0,0,0,.6) 48%,rgba(0,0,0,.38) 63%,rgba(0,0,0,.18) 78%,rgba(0,0,0,.05) 90%,rgba(0,0,0,0) 100%)',
            }}
          />
        </div>

        {/* 品牌字：這一屏的主標題，壓在 3D 球的正中心。
             用絕對定位所以不佔版面（下面幾排按鈕的位置完全不受影響），
             但它在捲動區裡面，所以往下滑會跟著滑走。
             top 就是主視覺的中心：主視覺高 clamp(200px,38vh,328px)、從畫面最上面算起，
             這裡是從捲動區上緣算，所以要扣掉標題列（safe-area + 62px）。 */}
        {/* 聯絡鈕：跟品牌字一樣待在首頁這一頁裡，往下滑會跟著滑走。
             絕對定位所以不佔版面，下面幾排按鈕的位置不受影響。 */}
        <button
          onClick={() => setContactOpen(true)}
          aria-label="聯絡方式"
          className="absolute right-6 w-[38px] h-[38px] rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/70 hover:bg-white/[0.12] hover:border-white/20 active:scale-95 transition-[background-color,border-color,transform] duration-300"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
        >
          <Icon name="mail" className="text-[19px]" />
        </button>

        {/* translateY(-50%) 要放在外層這個「不是 motion」的節點上 ——
             motion 會自己寫 transform，放在它身上會被蓋掉（量到標題偏低 35px）。
             捲動區現在從畫面最上面開始，所以 top 就是主視覺的中心，不用再扣標題列。 */}
        <div
          className="absolute left-0 right-0 flex justify-center pointer-events-none select-none"
          style={{
            // 主視覺的中心：它自己往下挪了 8px，這裡跟著加同樣的 8px
            top: 'calc(clamp(200px, 38vh, 328px) / 2 + 8px)',
            transform: 'translateY(-50%)',
          }}
        >
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="font-serif leading-none tracking-tight font-medium"
            style={{ fontSize: 'clamp(60px, 22vw, 94px)' }}
          >
            ABAI
          </motion.h1>
        </div>

        {/* 編輯 / 相機 —— 用 -mx-2 往外撐，邊緣比其他區塊更靠近螢幕邊 */}
        <div className="relative z-10 flex gap-2.5 -mx-2 mt-auto">
          <button
            onClick={onImportPhoto}
            className="flex-1 h-[70px] rounded-[12px] bg-white text-black border-none flex items-center justify-center gap-[9px] p-3.5 active:scale-[0.98] transition-transform duration-300"
          >
            <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 0, 'wght' 400, 'opsz' 24" }}>
              add_photo_alternate
            </span>
            <span className="text-sm font-black tracking-[0.06em]">編輯</span>
          </button>
          <button
            onClick={onOpenCamera}
            className="flex-1 h-[70px] rounded-[12px] bg-white/[0.06] border border-white/10 text-white flex items-center justify-center gap-[9px] p-3.5 hover:bg-white/[0.12] hover:border-white/20 active:scale-[0.98] transition-[background-color,border-color,transform] duration-300"
          >
            <Icon name="photo_camera" className="text-[24px] text-white/75" />
            <span className="text-sm font-black tracking-[0.06em]">相機</span>
          </button>
        </div>

        {/* 四個工具 */}
        <div className="relative z-10 -mt-3">
          <div className="flex gap-2.5 -mx-2">
            {TOOL_TILES.map(t => (
              <button
                key={t.key}
                onClick={tileAction[t.key]}
                className="flex-1 min-w-0 h-[64px] rounded-[11px] bg-white/[0.06] border border-white/10 text-white flex flex-col items-center justify-center gap-[7px] hover:bg-white/[0.12] hover:border-white/20 active:scale-[0.98] transition-[background-color,border-color,transform] duration-300"
              >
                <Icon name={t.icon} className="text-[20px] text-white/70" />
                <span className="text-[9px] font-bold tracking-[0.08em] text-white/75 whitespace-nowrap">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 歷史紀錄 —— 點一張就回到它導出當下的編輯狀態。
             還沒導出過的位子留斜線底。 */}
        <div className="relative z-10 -mt-3">
          <div className="flex items-baseline mb-2.5">
            <span className="text-[10px] font-bold tracking-[0.24em] text-white/40 ml-1">歷史紀錄</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[0, 1, 2, 3, 4].map(i => {
              const item = recent[i];
              if (!item) {
                return <div key={`slot-${i}`} className={`aspect-square rounded-lg ${EMPTY_TILE}`} />;
              }
              return (
                <button
                  key={item.id}
                  onClick={() => onOpenRecent?.(item.id)}
                  title={`${timeAgo(item.at)}導出`}
                  className="relative aspect-square rounded-lg overflow-hidden border border-white/10 p-0 active:scale-[0.97] transition-transform duration-300"
                >
                  <img src={item.thumb} alt="" className="w-full h-full object-cover" draggable={false} />
                </button>
              );
            })}
          </div>
        </div>

        {/* 廣告版位 —— 原本兩格預設模板併成一整塊，之後放廣告圖。
             外框（佔版面的那個）維持 342/147：這一疊是靠 mt-auto 貼著下緣排的，
             外框一長高，上面每一排就會跟著往上跑。所以真正的版位用絕對定位往下
             多長 —— 看得到的格子變長了，版面上佔的高度卻沒變，
             上面幾排按鈕一個像素都不會動。
             50px 是量出來的：版位下緣到分頁列上緣原本有 42px，多長 24px 之後
             還留 13px 的空隙，不會貼到分頁列。 */}
        <div className="relative z-10 -mt-1.5">
          <div ref={adBoxRef} className="relative aspect-[342/147]">
            {/* 左右各往外撐 8px，跟上面那幾排按鈕的 -mx-2 對齊。
                 撐的是「看得到的那一塊」而不是外框 —— 外框一變寬，
                 aspect-[342/147] 就會跟著變高，這一疊是靠 mt-auto 貼著下緣排的，
                 上面每一排按鈕就會整個往上跑。用 -inset-x-2 只動視覺，
                 版面佔的高度一個像素都沒變。 */}
            <div ref={adFillRef} className={`absolute -inset-x-2 top-0 bottom-[-50px] rounded-[14px] overflow-hidden ${EMPTY_TILE}`} />
          </div>
        </div>
      </div>

      {/* --- 靈感 ---
           接在第一屏下面，往下滑才看得到。 */}
      {/* 捲動區現在頂到畫面最上面，所以這一段自己要留出瀏海／狀態列的高度 */}
      {/* 廣告版位下緣到搜尋欄的間隔，對齊搜尋欄到第一排模板的 12px（mb-3）。
           版位是絕對定位往下多長 50px 的，扣掉這一段自己的 pb-[21px]，
           上緣留白 20px 是 12px、26px 就是 18px（12px 再多 0.5 倍）。
           只動這一段的頂端留白，第一屏（含廣告版位）一個像素都不會移動。 */}
      <div ref={libRef} className="px-6 pb-4 pt-[26px]">
        {/* 搜尋欄 —— 還沒接真的模板資料，先做成純前端的字串過濾 */}
        <div className="flex items-center gap-2 h-11 px-3.5 mb-3 rounded-full bg-white/[0.06] border border-white/10">
          <Icon name="search" className="text-[18px] text-white/40 shrink-0" />
          <input
            value={libQuery}
            onChange={e => setLibQuery(e.target.value)}
            placeholder="搜尋模板"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-white placeholder:text-white/30"
          />
          {libQuery && (
            <button onClick={() => setLibQuery('')} aria-label="清除" className="shrink-0 text-white/40 active:scale-90 transition-transform">
              <Icon name="close" className="text-[16px]" />
            </button>
          )}
        </div>
        {/* 兩欄各自往下排（不是 CSS multi-column）：這樣兩欄的第一格頂端一定齊。
             兩欄的比例是同一組、只是順序不同，所以兩欄加起來一樣高，最後一格底部也齊。 */}
        <div className="flex gap-3">
          {[0, 1].map(col => (
            <div key={col} className="flex-1 min-w-0 flex flex-col gap-3">
              {libList.filter((_, i) => i % 2 === col).map(t => (
                <div
                  key={t.name}
                  className={`relative rounded-[14px] overflow-hidden flex items-end ${EMPTY_TILE}`}
                  style={{ aspectRatio: t.ratio }}
                >
                  <span
                    className="w-full text-left px-3 py-2.5 text-[11px] font-black tracking-[0.08em] text-white/70"
                    style={{ background: 'linear-gradient(to top,rgba(0,0,0,.8),rgba(0,0,0,0))' }}
                  >
                    {t.name}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      </div>

      {/* --- 底部分頁 ---
           首頁／靈感是同一條捲軸的兩個位置，點下去就捲過去；「我」才是換頁。 */}
      <div
        className="relative z-[5] flex px-6 pt-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] border-t border-white/[0.08] shrink-0"
        style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      >
        {NAV_ITEMS.map(n => {
          const on = nav === n.id;
          return (
            <button
              key={n.id}
              onClick={() => goNav(n.id)}
              className="flex-1 bg-transparent border-none flex flex-col items-center py-1.5"
            >
              <span className={`text-[12px] tracking-[0.16em] ${on ? 'font-black text-white' : 'font-bold text-white/35'}`}>
                {n.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* --- 登入 ---
           沒有後端可以驗，所以驗證碼收到就算過，帳號存在這台裝置上。
           畫面與流程都照真的做，之後接上伺服器只要換掉 sendCode／submitCode 兩支。 */}
      <AnimatePresence>
        {loginOpen && (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => step !== 'busy' && setLoginOpen(false)}
            className="absolute inset-0 z-[60] flex items-end justify-center bg-black/75 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-[430px] rounded-t-[24px] bg-[#141414] border-t border-x border-white/10 px-6 pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]"
            >
              <div className="flex items-center justify-between mb-5">
                <span className="text-[10px] font-bold tracking-[0.24em] text-white/40 ml-0.5">
                  {step === 'id' ? '' : '輸入驗證碼'}
                </span>
                <button
                  onClick={() => step === 'code' ? setStep('id') : setLoginOpen(false)}
                  disabled={step === 'busy'}
                  aria-label={step === 'code' ? '上一步' : '關閉'}
                  className="w-7 h-7 -mr-1 rounded-full flex items-center justify-center text-white/40 hover:text-white active:scale-90 transition-transform disabled:opacity-30"
                >
                  <Icon name={step === 'code' ? 'arrow_back' : 'close'} className="text-[18px]" />
                </button>
              </div>

              {step === 'id' ? (
                <>
                  {/* 手機 / 電子郵件 */}
                  <div className="flex p-1 mb-4 rounded-full bg-white/[0.06] border border-white/10">
                    {([['phone', '手機號碼'], ['email', '電子郵件']] as const).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => { setKind(k); setIdInput(''); setLoginErr(''); }}
                        className={`flex-1 h-9 rounded-full text-[12px] font-bold tracking-[0.06em] transition-[background-color,color] duration-200 ${
                          kind === k ? 'bg-white text-black' : 'text-white/50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={idInput}
                    onChange={e => { setIdInput(e.target.value); setLoginErr(''); }}
                    inputMode={kind === 'phone' ? 'numeric' : 'email'}
                    autoComplete={kind === 'phone' ? 'tel' : 'email'}
                    placeholder={kind === 'phone' ? '09xx xxx xxx' : 'abaiiiii@gmail.com'}
                    className="w-full h-[52px] px-4 rounded-[12px] bg-white/[0.05] border border-white/10 outline-none focus:border-white/30 text-[15px] text-white placeholder:text-white/25 transition-colors"
                  />
                  <button
                    onClick={sendCode}
                    disabled={!idOk}
                    className="mt-4 w-full h-[52px] rounded-[12px] bg-white text-black text-[13px] font-black tracking-[0.1em] disabled:opacity-25 active:scale-[0.98] transition-[opacity,transform] duration-200"
                  >
                    取得驗證碼
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-4 text-[12px] text-white/40">
                    帳號 <span className="text-white/70">{kind === 'phone' ? idInput.replace(/\D/g, '') : idInput.trim()}</span>
                  </p>
                  <input
                    value={code}
                    onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setLoginErr(''); }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    disabled={step === 'busy'}
                    className="w-full h-[52px] px-4 rounded-[12px] bg-white/[0.05] border border-white/10 outline-none focus:border-white/30 text-center text-[22px] font-bold tabular-nums tracking-[0.5em] text-white placeholder:text-white/20 transition-colors"
                  />
                  <div className="mt-3 flex justify-center">
                    <button
                      onClick={() => setCooldown(60)}
                      disabled={cooldown > 0 || step === 'busy'}
                      className="text-[11px] text-white/45 disabled:text-white/20 tracking-[0.06em]"
                    >
                      {cooldown > 0 ? `重新取得（${cooldown}）` : '重新取得驗證碼'}
                    </button>
                  </div>
                  <button
                    onClick={submitCode}
                    disabled={code.length !== 6 || step === 'busy'}
                    className="mt-4 w-full h-[52px] rounded-[12px] bg-white text-black text-[13px] font-black tracking-[0.1em] disabled:opacity-25 active:scale-[0.98] transition-[opacity,transform] duration-200 flex items-center justify-center gap-2"
                  >
                    {step === 'busy' ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-black/25 border-t-black animate-spin" />
                        登入中
                      </>
                    ) : '登入'}
                  </button>
                </>
              )}

              {loginErr && <p className="mt-3 text-center text-[11px] text-white/50">{loginErr}</p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- 聯絡方式 --- */}
      <AnimatePresence>
        {contactOpen && (
          <motion.div
            key="contact"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setContactOpen(false)}
            className="absolute inset-0 z-[60] flex items-center justify-center px-8 bg-black/75 backdrop-blur-sm"
          >
            <div className="relative w-full max-w-[320px] flex flex-col items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 4 }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full rounded-[24px] bg-[#141414] border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <span className="text-[10px] font-bold tracking-[0.24em] text-white/40 ml-2.5">聯絡方式</span>
                <button
                  onClick={() => setContactOpen(false)}
                  aria-label="關閉"
                  className="w-7 h-7 -mr-1 rounded-full flex items-center justify-center text-white/40 hover:text-white active:scale-90 transition-transform"
                >
                  <Icon name="close" className="text-[18px]" />
                </button>
              </div>

              <div className="px-5 pb-5 flex flex-col gap-2">
                {/* 電子郵件 —— 點下去複製。複製成功的回饋在整張卡下面，卡裡不放東西 */}
                <button
                  onClick={copyEmail}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.05] border border-white/10 text-left hover:bg-white/[0.1] active:scale-[0.98] transition-[background-color,transform] duration-300"
                >
                  <span className="w-9 h-9 shrink-0 rounded-full bg-white/[0.08] flex items-center justify-center text-white/70">
                    <Icon name="mail" className="text-[18px]" />
                  </span>
                  {/* 不用 truncate：窄螢幕寧可換行也不要把地址藏起來 */}
                  <span className="flex-1 min-w-0 text-[12px] leading-snug text-white/90 break-all">{CONTACT_EMAIL}</span>
                </button>

                {/* Instagram —— 點下去開連結 */}
                <a
                  href={CONTACT_IG_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] active:scale-[0.98] transition-[background-color,transform] duration-300"
                >
                  <span className="w-9 h-9 shrink-0 rounded-full bg-white/[0.08] flex items-center justify-center text-white/70">
                    <InstagramGlyph />
                  </span>
                  <span className="flex-1 min-w-0 text-[12px] leading-snug text-white/90 break-all">{CONTACT_IG}</span>
                </a>
              </div>
            </motion.div>

            {/* 複製成功的回饋：絕對定位掛在卡片下面，不佔版面高度 ——
                 用 flow 排的話它一出現就會把整張卡往上頂。 */}
            <AnimatePresence>
              {copied && (
                <motion.div
                  key="copied"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-full left-0 right-0 mt-3 text-center text-[11px] tracking-[0.14em] text-white/45 pointer-events-none"
                >
                  已複製
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
