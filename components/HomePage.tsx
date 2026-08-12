import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from './Icon';
import { ThreeBackground } from './ThreeBackground';
import type { ExportMeta } from '../utils/exportHistory';
import {
  type AuthUser, isAuthReady, authErrText, getUser, onAuthChange,
  signUpWithPassword, signInWithPassword, sendPasswordReset,
  sendEmailOtp, verifyEmailOtp, signInWithProvider, signOut, deleteAccount,
} from '../utils/auth';

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
 * 每一格都是 3:4 直式 —— 兩欄的格子一樣高、逐排對齊，
 * 第一格頂端齊、最後一格底部也齊，不會有一欄凸出來。
 */
const TILE_RATIO = '3 / 4';
const LIB_TEMPLATES: { name: string; ratio: string }[] = Array.from({ length: 12 }, (_, i) => ({
  name: `模板 ${String(i + 1).padStart(2, '0')}`,
  ratio: TILE_RATIO,
}));

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

/** 把登入中的使用者換成畫面用的格式 */
const toAccount = (u: AuthUser | null): Account | null =>
  u ? { kind: 'email', id: u.email || u.id, at: u.createdAt } : null;

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
     真的帳號系統（Supabase）。四條路：Email 驗證碼、Email＋密碼、
     Google、Apple。登入狀態由 SDK 保管，重開 App 還在。 */
  const [account, setAccount] = useState<Account | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  /** id＝輸入信箱那一頁｜code＝輸入驗證碼｜busy＝正在等伺服器 */
  const [step, setStep] = useState<'id' | 'code' | 'busy'>('id');
  /** 用驗證碼還是用密碼 */
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  const [idInput, setIdInput] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginNote, setLoginNote] = useState('');
  const [cooldown, setCooldown] = useState(0);
  /** 用信箱登入的那一區要不要展開（預設收起來，畫面才乾淨） */
  const [emailOpen, setEmailOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  /* 開 App 先問一次「現在誰登入著」，之後靠 onAuthChange 跟著變 ——
     第三方登入導回來、token 自動換新、在別的分頁登出，都會走到這裡。 */
  useEffect(() => {
    let alive = true;
    getUser().then(u => { if (alive) setAccount(toAccount(u)); }).catch(() => {});
    const off = onAuthChange(u => setAccount(toAccount(u)));
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const idOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(idInput.trim());
  const pwOk = pw.length >= 6;

  const openLogin = () => {
    setStep('id'); setIdInput(''); setPw(''); setCode('');
    setLoginErr(''); setLoginNote(''); setCooldown(0); setMode('otp'); setEmailOpen(false);
    setLoginOpen(true);
  };

  /** 統一的錯誤處理：把英文訊息換成中文，並把畫面收回可操作的狀態 */
  const fail = (e: any, back: 'id' | 'code' = 'id') => {
    setLoginErr(authErrText(e));
    setStep(back);
  };

  /** 驗證碼那條路：寄六位數到信箱（沒帳號就順便建一個） */
  const sendCode = async () => {
    if (!isAuthReady) { setLoginErr('後端尚未設定'); return; }
    if (!idOk) { setLoginErr('請輸入正確的電子郵件'); return; }
    setLoginErr(''); setLoginNote(''); setStep('busy');
    try {
      await sendEmailOtp(idInput);
      setStep('code'); setCooldown(60);
    } catch (e) { fail(e); }
  };

  const submitCode = async () => {
    if (code.length !== 6) { setLoginErr('請輸入 6 位數驗證碼'); return; }
    setLoginErr(''); setStep('busy');
    try {
      await verifyEmailOtp(idInput, code);
      setLoginOpen(false);
    } catch (e) { fail(e, 'code'); }
  };

  /** 密碼那條路：先試登入，沒有這個帳號就註冊 */
  const submitPassword = async (intent: 'in' | 'up') => {
    if (!isAuthReady) { setLoginErr('後端尚未設定'); return; }
    if (!idOk) { setLoginErr('請輸入正確的電子郵件'); return; }
    if (!pwOk) { setLoginErr('密碼至少要 6 個字'); return; }
    setLoginErr(''); setLoginNote(''); setStep('busy');
    try {
      if (intent === 'in') { await signInWithPassword(idInput, pw); setLoginOpen(false); return; }
      const r = await signUpWithPassword(idInput, pw);
      if (r.needVerify) { setStep('id'); setLoginNote('驗證信寄出去了，去信箱點一下就完成註冊'); }
      else setLoginOpen(false);
    } catch (e) { fail(e); }
  };

  const forgotPw = async () => {
    if (!idOk) { setLoginErr('請先輸入你的電子郵件'); return; }
    setLoginErr(''); setStep('busy');
    try { await sendPasswordReset(idInput); setStep('id'); setLoginNote('重設密碼的信寄出去了'); }
    catch (e) { fail(e); }
  };

  const oauth = async (p: 'google' | 'apple') => {
    if (!isAuthReady) { setLoginErr('後端尚未設定'); return; }
    setLoginErr(''); setStep('busy');
    try { await signInWithProvider(p); }   // 會跳走，回來時 onAuthChange 接手
    catch (e) { fail(e); }
  };

  const logout = () => { signOut().catch(() => {}); setAccount(null); };

  /** 刪除帳號（App Store 規定一定要能在 App 裡刪） */
  const removeAccount = async () => {
    setDelBusy(true);
    try { await deleteAccount(); setAccount(null); setDelOpen(false); }
    catch (e) { alert(authErrText(e)); }
    finally { setDelBusy(false); }
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
            <>
              <button
                onClick={logout}
                className="mt-6 w-full h-[46px] rounded-[12px] bg-white/[0.05] border border-white/10 text-[12px] font-bold tracking-[0.1em] text-white/60 hover:bg-white/[0.1] active:scale-[0.98] transition-[background-color,transform] duration-300"
              >
                登出
              </button>
              {/* App Store 審核指南 5.1.1(v)：App 內能註冊，就必須能在 App 內刪除帳號 */}
              <button
                onClick={() => setDelOpen(true)}
                className="mt-3 w-full h-[46px] rounded-[12px] border border-white/10 text-[12px] font-bold tracking-[0.1em] text-white/35 hover:text-white/60 active:scale-[0.98] transition-[color,transform] duration-300"
              >
                刪除帳號
              </button>
            </>
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
              className="w-full max-w-[430px] rounded-t-[24px] bg-[#141414] border-t border-x border-white/10 px-6 pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+44px)]"
            >
              {/* 標題列：只有一顆關閉／返回，標題留白讓版面乾淨 */}
              <div className="flex items-start justify-between mb-6">
                <div className="pl-1.5 pt-1.5">
                  <p className="text-[22px] font-black tracking-[0.02em] text-white leading-tight">
                    {step === 'code' ? '輸入驗證碼' : '登入'}
                  </p>
                  {step === 'code' && (
                    <p className="mt-1.5 text-[12px] text-white/35 leading-relaxed">
                      驗證碼寄到 <span className="text-white/60">{idInput.trim()}</span>
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    // 驗證碼 → 回信箱畫面；信箱畫面 → 回三顆按鈕；再按才是關閉
                    if (step === 'code') { setStep('id'); return; }
                    if (emailOpen) { setEmailOpen(false); setLoginErr(''); setLoginNote(''); return; }
                    setLoginOpen(false);
                  }}
                  disabled={step === 'busy'}
                  aria-label={(step === 'code' || emailOpen) ? '上一步' : '關閉'}
                  className="shrink-0 w-8 h-8 -mr-1 -mt-0.5 rounded-full flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.06] active:scale-90 transition-[color,background-color,transform] disabled:opacity-30"
                >
                  <Icon name={(step === 'code' || emailOpen) ? 'arrow_back' : 'close'} className="text-[18px]" />
                </button>
              </div>

              {/* 三個畫面（三顆按鈕／信箱／驗證碼）共用同一個最小高度，
                  切換的時候整片登入欄不會忽然縮一截。
                  170px＝三顆 50px 的按鈕加上兩個 10px 間距，也就是最高的那個狀態。 */}
              <div className="min-h-[170px]">
              {step === 'id' || step === 'busy' ? (
                <>
                  {/* ── 主要入口：Apple 與 Google ──────────────────────
                      一鍵登入放最上面（大多數人會用這個），Email 放下面。
                      iOS 上架規定：只要有 Google，就一定要有 Sign in with Apple。 */}
                  {!emailOpen && (
                  <>
                  <button
                    onClick={() => oauth('apple')}
                    disabled={step === 'busy'}
                    className="w-full h-[50px] rounded-[14px] bg-white text-black text-[15px] font-bold tracking-[0.01em] active:scale-[0.985] transition-transform disabled:opacity-30 flex items-center justify-center gap-2.5"
                  >
                    {/* Apple 官方標誌。viewBox 是 384×512，標誌只佔其中 364×448，
                        所以方框 B 畫出來只有 0.711B 寬、0.875B 高；Google 的 48×48
                        幾乎填滿，17px 方框就實打實畫出 15.3×15.6。
                        方框要 24px 畫出來才會是 17.1×21.0，跟 Google 那顆一樣大。

                        但方框直接放 24px 的話，它就比 Google 的 17px 多佔 7px 版面，
                        整組（圖示＋間距＋文字）被推著往右跑，字就跟 Google 那行對不齊。
                        所以外面套一個 17px 的框，讓 24px 的圖示溢出去畫：
                        看起來一樣大，但佔的版面跟 Google 完全相同 → 兩行字自動同一個中心。 */}
                    <span className="w-[17px] h-[17px] flex items-center justify-center shrink-0" aria-hidden>
                      {/* 往上 2.5px：蘋果的標誌上面那片葉子細、下面果身重，
                          幾何置中看起來會偏低，提一點才會跟旁邊的字齊平。 */}
                      <svg viewBox="0 0 384 512" className="w-[24px] h-[24px] shrink-0 relative top-[-2.5px]" fill="currentColor">
                        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
                      </svg>
                    </span>
                    使用 Apple 帳號登入
                  </button>
                  <button
                    onClick={() => oauth('google')}
                    disabled={step === 'busy'}
                    className="mt-2.5 w-full h-[50px] rounded-[14px] bg-white/[0.07] border border-white/10 text-white text-[15px] font-bold tracking-[0.01em] active:scale-[0.985] transition-transform disabled:opacity-30 flex items-center justify-center gap-2.5"
                  >
                    {/* Google 官方四色標誌 */}
                    <span className="w-[17px] h-[17px] flex items-center justify-center shrink-0" aria-hidden>
                      <svg viewBox="0 0 48 48" className="w-[17px] h-[17px] shrink-0">
                        <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.9-1.6 4.7-4.5 6.6l-.04.3 6.5 5 .5.05c4.1-3.8 6.5-9.4 6.5-15.1z"/>
                        <path fill="#34A853" d="M24 46c5.9 0 10.9-1.9 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3 0-6.7 5.2-.1.3C8 41.1 15.4 46 24 46z"/>
                        <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l0-.3-6.8-5.3-.2.1C2.9 17.1 2 20.4 2 24s.9 6.9 2.5 9.9l7-5.4z"/>
                        <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.500 29.9 2 24 2 15.4 2 8 6.9 4.5 14.1l7 5.4C13.3 14.3 18.2 10.6 24 10.6z"/>
                      </svg>
                    </span>
                    使用 Google 帳號登入
                  </button>

                  {/* 點下去之後整片換成信箱登入的畫面（上面三顆會收起來） */}
                  <button
                    onClick={() => { setEmailOpen(true); setLoginErr(''); setLoginNote(''); }}
                    disabled={step === 'busy'}
                    className="mt-2.5 w-full h-[50px] rounded-[14px] bg-white/[0.07] border border-white/10 text-white text-[15px] font-bold tracking-[0.01em] active:scale-[0.985] transition-transform disabled:opacity-30 flex items-center justify-center gap-2.5"
                  >
                    <span className="w-[17px] h-[17px] flex items-center justify-center shrink-0" aria-hidden>
                      <Icon name="mail" className="text-[17px] leading-none" />
                    </span>
                    使用電子郵件登入
                  </button>
                  </>
                  )}

                  {emailOpen && (
                    <div>
                      <input
                        value={idInput}
                        onChange={e => { setIdInput(e.target.value); setLoginErr(''); setLoginNote(''); }}
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        placeholder="電子郵件"
                        className="w-full h-[50px] px-4 rounded-[14px] bg-white/[0.05] border border-white/10 outline-none focus:border-white/25 text-[15px] text-white placeholder:text-white/20 transition-colors"
                      />
                      {/* 只留驗證碼這一條路：不用記密碼，也不會有忘記密碼那些分支 */}
                      <button
                        onClick={sendCode}
                        disabled={!idOk || step === 'busy'}
                        className="mt-2.5 w-full h-[50px] rounded-[14px] bg-white text-black text-[15px] font-bold tracking-[0.02em] disabled:opacity-20 active:scale-[0.985] transition-[opacity,transform] duration-200 flex items-center justify-center gap-2"
                      >
                        {step === 'busy'
                          ? <><span className="w-4 h-4 rounded-full border-2 border-black/25 border-t-black animate-spin" />請稍候</>
                          : '寄送驗證碼'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
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
                      onClick={() => { setCooldown(60); sendEmailOtp(idInput).catch(e => setLoginErr(authErrText(e))); }}
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
              </div>

              {loginErr &&<p className="mt-3 text-center text-[11px] text-white/50">{loginErr}</p>}
              {!loginErr && loginNote && <p className="mt-3 text-center text-[11px] text-white/45">{loginNote}</p>}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- 刪除帳號：不可逆，所以一定要再問一次 --- */}
      <AnimatePresence>
        {delOpen && (
          <motion.div
            key="del"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => !delBusy && setDelOpen(false)}
            className="absolute inset-0 z-[70] flex items-center justify-center px-8 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-[320px] rounded-[20px] bg-[#141414] border border-white/10 p-6"
            >
              <p className="text-[14px] font-black tracking-[0.06em] text-white">確定要刪除帳號？</p>
              <p className="mt-2 text-[12px] leading-relaxed text-white/45">
                帳號與雲端資料會被永久刪除，無法復原。手機裡已經存好的照片不受影響。
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setDelOpen(false)}
                  disabled={delBusy}
                  className="flex-1 h-[46px] rounded-[12px] bg-white/[0.06] border border-white/10 text-[12px] font-bold tracking-[0.08em] text-white/70 active:scale-[0.98] transition-transform disabled:opacity-30"
                >
                  取消
                </button>
                <button
                  onClick={removeAccount}
                  disabled={delBusy}
                  className="flex-1 h-[46px] rounded-[12px] bg-white text-black text-[12px] font-black tracking-[0.08em] active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {delBusy
                    ? <><span className="w-4 h-4 rounded-full border-2 border-black/25 border-t-black animate-spin" />刪除中</>
                    : '刪除'}
                </button>
              </div>
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
