import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from './Icon';
import { exportsStatus, subscribeExports, type ExportMeta } from '../utils/exportHistory';
import {
  type AuthUser, isAuthReady, authErrText, getUser, onAuthChange,
  signUpWithPassword, signInWithPassword, sendPasswordReset,
  sendEmailOtp, verifyEmailOtp, signInWithProvider, signOut, deleteAccount,
} from '../utils/auth';
import { loadAvatar, saveAvatarFromFile, removeAvatar } from '../utils/avatar';

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

/* ── 暫時的：拿來看效果用的示意圖 ──────────────────────────────
   主視覺、橫幅、模板格子都可以自己挑一張圖看看排起來長什麼樣。
   圖縮小後存在這台裝置的 localStorage，不會上傳任何地方。
   之後接上真的資料時，把 preview 這一整組（常數、狀態、那顆 input、
   以及各處的 onClick）拿掉就行，版面完全不用動。 */
const PREVIEW_KEY = (k: string) => `abai:preview:${k}`;
/** 橫幅本來自己一格，換成統一的鍵之後把舊的搬過來，已經挑過的圖不會不見 */
const PROMO_BG_KEY = 'abai:promoBg';
/** 各處示意圖縮到多大（長邊）。模板格子小、又有 12 格，就存小一點 */
const PREVIEW_MAX: Record<string, number> = { hero: 1080, promo: 1080 };
const previewMaxOf = (k: string) => PREVIEW_MAX[k] ?? 720;

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

/* 驗證碼長度。
   OTP_LEN ＝ Supabase 後台設定的位數（預設 6）。打滿這個數字就自動送出，
             使用者不用再按一次「登入」。
   OTP_MAX ＝ 輸入框最多收幾位。後台的 OTP Length 可以調到 10，萬一哪天改了
             設定，多出來的位數也不會被輸入框吃掉，手動按登入照樣過得去。
   正不正確一律交給伺服器判斷，前端只管長度。 */
const OTP_LEN = 6;
const OTP_MAX = 10;

interface Account { kind: 'phone' | 'email'; id: string; at: number; photo: string | null }

/** 顯示用的名字：信箱就取 @ 前面那一段，手機號就整串 */
const displayName = (a: Account): string =>
  a.kind === 'email' ? (a.id.split('@')[0] || a.id) : a.id;

/** 把登入中的使用者換成畫面用的格式 */
const toAccount = (u: AuthUser | null): Account | null =>
  u ? { kind: 'email', id: u.email || u.id, at: u.createdAt, photo: u.photo } : null;

/**
 * 頭貼。優先序：
 *   ① 自己上傳的（存在這台裝置）—— 使用者親手挑的，最優先
 *   ② 第三方帶過來的（Google 有；Apple 與 Email 不給）
 *   ③ 名字第一個字做的字母頭貼 —— 讓沒有照片的帳號也長得像個帳號，
 *      而不是一律灰色人形。底色由名字算出來，同一個帳號永遠同一個顏色。
 *
 * ② 是外部網址，載不出來（沒網路、被擋掉）就自動退回 ③。
 */
const LETTER_HUES = [212, 340, 24, 152, 268, 46, 190, 320];

const AvatarView: React.FC<{
  local: string | null;
  account: Account | null;
  size: number;
}> = ({ local, account, size }) => {
  const [remoteBad, setRemoteBad] = useState(false);
  const remote = account?.photo || null;
  useEffect(() => { setRemoteBad(false); }, [remote]);

  const src = local || (!remoteBad ? remote : null);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setRemoteBad(true)}
        className="w-full h-full object-cover"
        draggable={false}
      />
    );
  }

  if (account) {
    const name = displayName(account).trim();
    const ch = (name[0] || '?').toUpperCase();
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hue = LETTER_HUES[h % LETTER_HUES.length];
    return (
      <span
        className="w-full h-full flex items-center justify-center font-bold text-white select-none"
        style={{
          fontSize: Math.round(size * 0.42),
          background: `linear-gradient(140deg, hsl(${hue} 46% 42%), hsl(${(hue + 26) % 360} 44% 30%))`,
        }}
      >
        {ch}
      </span>
    );
  }

  /* Material Symbols 的大小就是 font-size，所以用外面這層帶進去（Icon 會繼承） */
  return (
    <span className="leading-none" style={{ fontSize: Math.round(size * 0.5) }}>
      <Icon name="person" />
    </span>
  );
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
  /** 模板那一段的「排版盒」（外層，不會動）—— 量位置要看它，不能看會位移的那層 */
  const libBoxRef = useRef<HTMLDivElement>(null);
  /** 視差的重算函式（放 ref 是為了讓上面的 effect 也叫得到） */
  const applyRef = useRef<() => void>(() => {});
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
  /** 帳號設定那一頁（點頭像列右邊的箭頭進去），登出與刪除帳號都收在裡面 */
  const [acctOpen, setAcctOpen] = useState(false);
  /** 登出前再問一次 */
  const [outOpen, setOutOpen] = useState(false);

  /* --- 頭貼 ---
     只存在這台裝置（localStorage），不會上傳雲端。換帳號就換一張。 */
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarErr, setAvatarErr] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatar(account ? loadAvatar(account.id) : null);
    setAvatarErr('');
  }, [account?.id]);

  const pickAvatar = async (f?: File | null) => {
    if (!f || !account) return;
    setAvatarErr('');
    try { setAvatar(await saveAvatarFromFile(account.id, f)); }
    catch (e: any) { setAvatarErr(e?.message || '這張圖片讀不進來'); }
  };

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

  /* --- 「等伺服器」的狀態，一定要有辦法自己走出來 ---
     原本只要進了 busy，畫面上每一顆按鈕都跟著鎖住；只要那個請求沒有回來
     （網路斷了、第三方登入視窗被關掉、伺服器卡住），就再也沒有東西會把
     step 換回去 —— 使用者看到的就是「所有按鈕都按不動」。
     現在每次進 busy 都會記下「失敗要退回哪一頁」並上一個 25 秒的鬧鐘，
     時間到就自己退回去、留一句話說明；成功／失敗都會把鬧鐘關掉。 */
  const busyRef = useRef<{ back: 'id' | 'code'; oauth: boolean } | null>(null);
  const busyTimer = useRef<any>(null);

  const endBusy = () => {
    busyRef.current = null;
    if (busyTimer.current) { clearTimeout(busyTimer.current); busyTimer.current = null; }
  };

  const beginBusy = (back: 'id' | 'code' = 'id', oauth = false) => {
    endBusy();
    busyRef.current = { back, oauth };
    setStep('busy');
    busyTimer.current = setTimeout(() => {
      const b = busyRef.current;
      if (!b) return;
      endBusy();
      setStep(b.back);
      setLoginErr(b.oauth ? '這次登入沒有完成，再試一次看看' : '連線好像卡住了，再試一次看看');
    }, 25000);
  };

  /* 第三方登入會把整個瀏覽器帶去別的網站。使用者中途按返回／關掉那個分頁時，
     回到這裡不會有任何事件通知我們「它失敗了」—— 所以自己在畫面重新被看到的
     那一刻檢查：還停在 busy 而且還沒登入，就把畫面放回去。 */
  useEffect(() => {
    const back = () => {
      const b = busyRef.current;
      if (!b || !b.oauth) return;
      if (document.visibilityState !== 'visible') return;
      endBusy();
      setStep('id');
      setLoginErr('這次登入沒有完成，再試一次看看');
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('pageshow', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('pageshow', back);
      if (busyTimer.current) clearTimeout(busyTimer.current);
    };
  }, []);

  /* 登入成功（不管走哪條路）就把鬧鐘關掉，免得等一下才響、又跳出一句錯誤 */
  useEffect(() => { if (account) endBusy(); }, [account]);

  const openLogin = () => {
    endBusy();
    setStep('id'); setIdInput(''); setPw(''); setCode('');
    setLoginErr(''); setLoginNote(''); setCooldown(0); setMode('otp'); setEmailOpen(false);
    autoTried.current = '';   // 重開登入頁＝全新的一次，之前試過的驗證碼不算數
    setLoginOpen(true);
  };

  /** 統一的錯誤處理：把英文訊息換成中文，並把畫面收回可操作的狀態 */
  const fail = (e: any, back: 'id' | 'code' = 'id') => {
    endBusy();
    setLoginErr(authErrText(e));
    setStep(back);
  };

  /** 驗證碼那條路：寄六位數到信箱（沒帳號就順便建一個） */
  const sendCode = async () => {
    if (!isAuthReady) { setLoginErr('後端尚未設定'); return; }
    if (!idOk) { setLoginErr('請輸入正確的電子郵件'); return; }
    setLoginErr(''); setLoginNote(''); beginBusy('id');
    try {
      await sendEmailOtp(idInput);
      endBusy();
      setStep('code'); setCooldown(60);
    } catch (e) { fail(e); }
  };

  const submitCode = async (value = code) => {
    if (value.length < OTP_LEN) { setLoginErr(`請輸入信裡的 ${OTP_LEN} 位數驗證碼`); return; }
    setLoginErr(''); beginBusy('code');
    try {
      await verifyEmailOtp(idInput, value);
      endBusy();
      setLoginOpen(false);
    } catch (e) { fail(e, 'code'); }
  };

  /* 打滿位數就自動送出，不用再按「登入」。
     autoTried 記住「這一組數字已經自動試過了」——不然驗證失敗回到 code
     這一頁時，長度還是滿的，會無限重試。使用者改動任何一位就會變成新的
     組合，那時候才允許再自動送一次。 */
  const autoTried = useRef('');
  useEffect(() => {
    if (step !== 'code') return;
    if (code.length !== OTP_LEN) return;
    if (autoTried.current === code) return;
    autoTried.current = code;
    submitCode(code);
  }, [code, step]);

  /** 密碼那條路：先試登入，沒有這個帳號就註冊 */
  const submitPassword = async (intent: 'in' | 'up') => {
    if (!isAuthReady) { setLoginErr('後端尚未設定'); return; }
    if (!idOk) { setLoginErr('請輸入正確的電子郵件'); return; }
    if (!pwOk) { setLoginErr('密碼至少要 6 個字'); return; }
    setLoginErr(''); setLoginNote(''); beginBusy('id');
    try {
      if (intent === 'in') { await signInWithPassword(idInput, pw); endBusy(); setLoginOpen(false); return; }
      const r = await signUpWithPassword(idInput, pw);
      endBusy();
      if (r.needVerify) { setStep('id'); setLoginNote('驗證信寄出去了，去信箱點一下就完成註冊'); }
      else setLoginOpen(false);
    } catch (e) { fail(e); }
  };

  const forgotPw = async () => {
    if (!idOk) { setLoginErr('請先輸入你的電子郵件'); return; }
    setLoginErr(''); beginBusy('id');
    try { await sendPasswordReset(idInput); endBusy(); setStep('id'); setLoginNote('重設密碼的信寄出去了'); }
    catch (e) { fail(e); }
  };

  const oauth = async (p: 'google' | 'apple') => {
    if (!isAuthReady) { setLoginErr('後端尚未設定'); return; }
    setLoginErr(''); beginBusy('id', true);
    try { await signInWithProvider(p); }   // 會跳走，回來時 onAuthChange 接手
    catch (e) { fail(e); }
  };

  const logout = () => {
    signOut().catch(() => {});
    setAccount(null);
    setOutOpen(false);
    setAcctOpen(false);
  };

  /** 刪除帳號（App Store 規定一定要能在 App 裡刪） */
  const removeAccount = async () => {
    setDelBusy(true);
    const id = account?.id;
    try {
      await deleteAccount();
      /* 帳號都刪了，本機這張頭貼也不用留 */
      if (id) removeAvatar(id);
      setAccount(null); setAvatar(null); setDelOpen(false); setAcctOpen(false);
    }
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
   * 點「模板」要捲到哪裡 —— 靈感區的頂端。
   *
   * 以前這裡要多算一段：廣告版位是「絕對定位往下多長 50px」的，那一截
   * 會蓋在 libRef 上面，捲到定位之後搜尋欄上方還看得到它的下緣。
   * 版位拿掉之後沒有東西會蓋過來了，直接捲到 libRef 的頂端就對。
   */
  const libScrollTop = (sc: HTMLDivElement) => {
    /* 模板那一段在排版上已經往上挪了 lift，畫面上再由動畫補回 lift×(1 − y/range)。
       所以它貼齊上緣的時候：
         top − y + lift × (1 − y / range) = 0
         → y = (top + lift) ÷ (1 + lift / range)
       沒有視差（關了動態效果）時 lift 是 0，算出來就是原本的值。 */
    const top = libBoxRef.current?.offsetTop ?? sc.clientHeight;
    const range = sc.clientHeight || 1;
    const lift = liftPx(sc);
    return Math.max(0, Math.round((top + lift) / (1 + lift / range)));
  };

  /** 讀 --lib-lift 的實際像素。它寫成 calc()，要用一個暫時的元素讓瀏覽器算完再讀。 */
  const liftPx = (sc: HTMLElement) => {
    const v = getComputedStyle(sc).getPropertyValue('--lib-lift').trim();
    if (!v) return 0;
    const n = parseFloat(v);
    if (!Number.isNaN(n) && /^[\d.]+px$/.test(v)) return n;
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;height:${v}`;
    sc.appendChild(probe);
    const h2 = probe.getBoundingClientRect().height;
    probe.remove();
    return h2 || 0;
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
    if (navSettle.current) { clearTimeout(navSettle.current); navSettle.current = null; }
    navLockRef.current = id;
    sc.scrollTo({ top: id === 'lib' ? libScrollTop(sc) : 0, behavior: 'smooth' });
  }, []);

  /** 分頁高亮的延遲切換計時器（捲動停下來才換，途中不重繪） */
  const navSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navSettle.current) clearTimeout(navSettle.current); }, []);

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
    // 直接改了捲動位置，視差要立刻跟上（用 ref 取用，因為它在下面才定義）
    applyRef.current();
  }, [nav]);

  /** 捲到哪裡就亮哪一個分頁。
      主視覺不用在這裡動 —— 它現在就在捲動內容裡，瀏覽器自己會捲，
      跟品牌字與其他東西完全同一拍。捲過第一屏它就自然離開畫面了，
      所以也不需要再淡出。 */
  /* ── 到頂／到底就不要再拖 ────────────────────────────────────────
     iOS 的橡皮筋是 Safari 自己在做的，`overscroll-behavior: none` 只擋得住
     「把捲動傳給外層」，擋不了這一格自己彈 —— 所以只能自己攔：
     已經在最上面還想往下拉、或已經在最下面還想往上推，就不讓那一下生效。
     中間任何位置都不管，正常捲動的手感一個字都沒動到。

     必須用原生的 addEventListener 並指定 passive: false ——
     React 掛的 touchmove 是被動的，被動的 listener 呼叫 preventDefault 沒有用。 */
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let y0 = 0, atTop = false, atBottom = false, armed = false;

    const block = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;      // 雙指縮放之類的不要碰
      const dy = (e.touches[0]?.clientY ?? 0) - y0;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault();
    };
    const disarm = () => {
      if (!armed) return;
      armed = false;
      sc.removeEventListener('touchmove', block as any);
    };
    const down = (e: TouchEvent) => {
      y0 = e.touches[0]?.clientY ?? 0;
      atTop = sc.scrollTop <= 0;
      atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
      /* 關鍵：**只有這一下真的從最上／最下開始**，才掛那個非被動的監聽器。
         非被動的 touchmove 會讓瀏覽器每一格都要先等 JS 回話，捲動就從
         合成執行緒被拉回主執行緒 —— 快速滑動時的頓挫多半是這樣來的。
         中間任何位置起手都不掛，捲動就走原本最快的那條路。 */
      if (atTop || atBottom) {
        armed = true;
        sc.addEventListener('touchmove', block, { passive: false });
      }
    };
    sc.addEventListener('touchstart', down, { passive: true });
    sc.addEventListener('touchend', disarm, { passive: true });
    sc.addEventListener('touchcancel', disarm, { passive: true });
    return () => {
      disarm();
      sc.removeEventListener('touchstart', down);
      sc.removeEventListener('touchend', disarm);
      sc.removeEventListener('touchcancel', disarm);
    };
  }, []);

  /* ── 往下滑的視差 ────────────────────────────────────────────────
     模板那一段照捲軸原速往上，修圖這一屏只走 45% 的速度 ——
     捲了 y，它自己往下補 0.55y，看起來就是「慢半拍地被留在後面」。
     同時整片慢慢淡掉，捲到大約三分之二屏就完全不見。

     **優先交給 CSS 的捲動時間軸**（styles.css 裡的 .home-hero）：
     整段動畫由合成執行緒照捲動位置自己算，主執行緒完全不參與 ——
     這正是抖動的解法。原本是 JS 監聽捲動、再排進 requestAnimationFrame 改
     transform：捲動跑在合成執行緒、算式跑在主執行緒，中間又壓了一格 rAF，
     兩邊只要差一格，畫面上就是「圖跟著手指抖一下」。

     這裡只剩兩件事：把「一屏有多高」量好寫成 --hero-range 給 CSS 用；
     以及在不支援的瀏覽器上落回 JS 版 —— 那時候刻意**同步**寫 style，
     不進 rAF（排進下一格＝固定慢捲動一格，就是會看到抖的那一格）。 */
  const heroRef = useRef<HTMLDivElement>(null);
  /** 主視覺裡的照片。它比整屏再慢一層，JS 那條路也要跟著畫 */
  const artRef = useRef<HTMLDivElement>(null);
  const cssTimeline = useRef(false);
  const reduceMotion = useRef(false);
  useEffect(() => {
    try {
      cssTimeline.current = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()');
      reduceMotion.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch { /* 舊瀏覽器 */ }
  }, []);

  /** 把「一屏有多高」寫給 CSS 動畫用。值沒變就不要寫 ——
      改動這個變數會讓兩支捲動動畫重新計算範圍，能省就省。 */
  const rangeWritten = useRef(-1);
  /** 捲動中不改 --hero-range，把這件事押後到停下來再做（見下面的說明） */
  const scrollingUntil = useRef(0);
  const rangePending = useRef(false);
  const syncRange = useCallback((force = false) => {
    const sc = scrollRef.current;
    if (!sc) return;
    const h = sc.clientHeight;
    if (h === rangeWritten.current) { rangePending.current = false; return; }
    /* 捲動途中先不要寫。
       iOS 在快速滑動時會收起／展開網址列，那一下 clientHeight 會變 ——
       --hero-range 一改，兩支捲動動畫的範圍、每一格的位移、還有模板那個
       負的 margin-top 全部同時改一次，畫面上就是「東西跳一下又回來」。
       押後到停下來（260ms 沒有新的捲動事件）再寫，滑動途中的幾何完全不動。 */
    if (!force && performance.now() < scrollingUntil.current) {
      rangePending.current = true;
      return;
    }
    rangePending.current = false;
    rangeWritten.current = h;
    sc.style.setProperty('--hero-range', `${h}px`);
  }, []);

  const applyParallax = useCallback(() => {
    const sc = scrollRef.current, el = heroRef.current;
    if (!sc || !el) return;
    if (cssTimeline.current) return;          // 交給 CSS，JS 一個字都不用寫
    if (reduceMotion.current) {
      el.style.transform = ''; el.style.opacity = '';
      el.style.pointerEvents = ''; el.style.visibility = '';
      if (libRef.current) libRef.current.style.transform = '';
      if (artRef.current) artRef.current.style.transform = '';
      return;
    }
    const h = sc.clientHeight || 1;
    // 夾在 0～可捲上限之間：iOS 橡皮筋期間讀到的值可能超出範圍，
    // 直接拿去算會讓圖案往回彈一下。
    const y = Math.min(Math.max(0, sc.scrollTop), Math.max(0, sc.scrollHeight - h));
    /* 位移在「捲滿一屏」就封頂，跟 CSS 那一版的 animation-range 完全一致。
       0.26＝修圖那一屏走 74% 的速度。

       它跟模板那一段的 0.35 相加＝ 0.61，就是兩者互相靠近的速度：
       靜止時歷史紀錄離模板的黑色遮罩還有 14px（靠下面那個 pb-[55px] 撐開），
       捲 23px 才會碰到、捲 128px 第二排被蓋滿。
       規格是「靜止時不擋到就好」，捲動中被追上是正常的。 */
    el.style.transform = `translate3d(0, ${(Math.min(y, h) * 0.26).toFixed(2)}px, 0)`;
    /* 主視覺裡的照片在上面那層之外再慢一層（整體走 68%）＋輕輕推近。
       數字跟 styles.css 的 .home-hero-art 完全一樣，兩條路長得一模一樣。 */
    const art = artRef.current;
    if (art) {
      const p = Math.min(1, Math.min(y, h) / h);
      art.style.transform = `translate3d(0, ${(p * h * 0.06).toFixed(2)}px, 0) scale(${(1 + p * 0.05).toFixed(4)})`;
    }
    // 模板那一段：一開始往下位移 +lift，隨捲動收回 0（等於比捲軸快 0.35 屏）
    const lib = libRef.current;
    if (lib) {
      const lift = liftPx(sc);
      lib.style.transform = `translate3d(0, ${((1 - Math.min(1, y / h)) * lift).toFixed(2)}px, 0)`;
    }
    /* 淡出的節奏：前 6% 完全不動（手指才剛碰到就整片變淡會很躁），
       之後到 45.98% 才淡完 —— 全透明的位置訂在 y = 360px（一屏 783 的 45.98%），
       比「模板上緣碰到『編輯／相機』那一排上緣」的 450px 再提早 90px。
       用 smoothstep 收頭尾，不是直線：直線的淡出在開始與結束那兩下
       看得出「開關感」。 */
    const t = Math.min(1, Math.max(0, (y / h - 0.06) / 0.3998));
    const fade = t * t * (3 - 2 * t);
    const o = 1 - fade;
    el.style.opacity = o.toFixed(3);
    // 淡到快看不見時就不該再吃得到點擊
    el.style.pointerEvents = o < 0.35 ? 'none' : '';
    /* 這裡刻意**不**設 visibility: hidden（原本全透明時會設）。
       visibility 一翻回 visible，這一整層要重新光柵化；從模板很快滑回修圖
       的那一下正好撞上這個切換，那一格來不及畫好，就會先用上一格的位置貼出來
       —— 畫面上就是「修圖的東西先掉到下面一點，然後又自己歸位」。
       整段都留著（透明度 0）合成層就一直在，沒有那一格。
       透明度 0 的層不必畫內容，成本可以忽略；擋點擊已經由 pointer-events 做了。 */
    if (el.style.visibility) el.style.visibility = '';
  }, []);
  applyRef.current = applyParallax;

  /* ── JS 版專用：捲動期間改用每一格自己去讀捲動位置 ──────────────────
     iOS（Safari）目前還不支援 CSS 的捲動時間軸，所以手機上跑的是這條路。
     而 iOS 在慣性滑動期間，**scroll 事件的頻率遠低於畫面更新的頻率**：
     只在收到事件時才改 transform，圖案就會一格一格地追捲動，
     慣性快結束、最後一個事件進來時再一次補到位 —— 看起來就是
     「到頂前後往下頓一下、像要回彈」。

     改成：捲動一開始就啟動一個每格都跑的迴圈，直接讀當下的捲動位置來畫；
     停下來 220ms 之後再收掉。這樣圖案跟捲動永遠是同一格的資料。
     支援 CSS 捲動時間軸的瀏覽器完全不會進到這裡。 */
  const pumpRaf = useRef<number | null>(null);
  const pumpIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pump = useCallback(() => {
    applyParallax();
    pumpRaf.current = requestAnimationFrame(pump);
  }, [applyParallax]);
  const kickPump = useCallback(() => {
    if (cssTimeline.current || reduceMotion.current) return;
    if (pumpRaf.current == null) pumpRaf.current = requestAnimationFrame(pump);
    if (pumpIdle.current) clearTimeout(pumpIdle.current);
    pumpIdle.current = setTimeout(() => {
      pumpIdle.current = null;
      if (pumpRaf.current != null) { cancelAnimationFrame(pumpRaf.current); pumpRaf.current = null; }
      applyParallax();               // 收工前再對一次，確保停在正確的位置
    }, 220);
  }, [pump, applyParallax]);
  useEffect(() => () => {
    if (pumpRaf.current != null) cancelAnimationFrame(pumpRaf.current);
    if (pumpIdle.current) clearTimeout(pumpIdle.current);
  }, []);

  /* 只在「第一次畫出來」與「尺寸變了」時重算。
     原本連分頁切換也重算 —— 那會在剛滑到頂的那一刻多寫一次 CSS 變數，
     等於在最不該打擾的時間點去動兩支捲動動畫的範圍。 */
  useLayoutEffect(() => { syncRange(); applyParallax(); }, [syncRange, applyParallax]);
  useEffect(() => {
    const on = () => { syncRange(); applyParallax(); };
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, [syncRange, applyParallax]);

  /** 捲動停下來之後才做的事（目前只有補寫 --hero-range） */
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (scrollIdle.current) clearTimeout(scrollIdle.current); }, []);

  const onScroll = useCallback(() => {
    // 標記「現在正在捲」，這段時間內不准改動任何會影響幾何的 CSS 變數
    scrollingUntil.current = performance.now() + 260;
    if (scrollIdle.current) clearTimeout(scrollIdle.current);
    scrollIdle.current = setTimeout(() => {
      scrollIdle.current = null;
      if (rangePending.current) { syncRange(true); applyParallax(); }
    }, 280);
    /* 先同步畫一次再啟動每格的迴圈：只靠迴圈的話，這一次捲動要等到
       下一個畫面更新才會反映，等於固定慢一格。 */
    applyParallax();
    kickPump();
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
    /* 分頁高亮延到「停下來」再換。
       原本是一過半屏就 setNav，那會在滑到一半時整棵首頁重繪一次 ——
       正好落在從模板快速滑回修圖的那一刻，看起來就是卡一下。
       捲動途中完全不碰 React，停 120ms 才換，手感上察覺不到延遲。 */
    if (next === navRef.current) {
      if (navSettle.current) { clearTimeout(navSettle.current); navSettle.current = null; }
      return;
    }
    if (navSettle.current) clearTimeout(navSettle.current);
    navSettle.current = setTimeout(() => { navSettle.current = null; setNav(next); }, 120);
  }, [kickPump, applyParallax, syncRange]);

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

  /* 歷史紀錄 —— 點一張就回到它導出當下的編輯狀態，沒導出過的位子留空格。
     本來在首頁第一屏，現在搬到「我的」；抽成一個變數，之後想放回去或
     兩邊都放都只要引用它。 */
  /* ── 暫時的：示意圖（主視覺／橫幅／模板格子共用一套）──────────── */
  const previewInputRef = useRef<HTMLInputElement>(null);
  const previewKeyRef = useRef<string>('');
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const next: Record<string, string> = {};
      const keys = ['hero', 'promo', ...Array.from({ length: LIB_TEMPLATES.length }, (_, i) => `lib${i}`)];
      for (const k of keys) {
        const v = localStorage.getItem(PREVIEW_KEY(k));
        if (v) next[k] = v;
      }
      // 橫幅以前存在自己那一格，搬過來（只搬一次，新的那格沒東西才搬）
      if (!next.promo) {
        const old = localStorage.getItem(PROMO_BG_KEY);
        if (old) { next.promo = old; try { localStorage.setItem(PREVIEW_KEY('promo'), old); } catch {} }
      }
      setPreviews(next);
    } catch { /* 私密瀏覽會擋 */ }
  }, []);

  /** 點某一格 → 記住是哪一格，再叫出檔案選擇器（整頁共用同一顆 input） */
  const pickPreview = (key: string) => {
    previewKeyRef.current = key;
    previewInputRef.current?.click();
  };

  const takePreview = async (f?: File | null) => {
    const key = previewKeyRef.current;
    if (!f || !key) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('decode failed'));
        i.src = url;
      });
      const sw = img.naturalWidth || 1, sh = img.naturalHeight || 1;
      // 縮小再存 —— 原圖直接塞 localStorage 會爆掉（上限大約 5MB）
      const s = Math.min(1, previewMaxOf(key) / Math.max(sw, sh));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(sw * s));
      cv.height = Math.max(1, Math.round(sh * s));
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      const data = cv.toDataURL('image/jpeg', 0.86);
      setPreviews(prev => ({ ...prev, [key]: data }));
      try { localStorage.setItem(PREVIEW_KEY(key), data); }
      catch { /* 空間不夠或被擋就算了，畫面上還是看得到這一次的結果 */ }
    } catch { /* 這張讀不進來就維持原狀 */ }
    finally { URL.revokeObjectURL(url); }
  };

  /* 歷史紀錄的狀態。「一筆都沒有」跟「資料庫開不起來」看起來一模一樣，
     所以在「我的」那一頁寫一行出來 —— 出問題時看得出是哪一種。 */
  const [histStat, setHistStat] = useState<{ ok: boolean; rows: number; usable: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => { exportsStatus().then(r => { if (alive) setHistStat(r); }).catch(() => {}); };
    read();
    const off = subscribeExports(read);
    return () => { alive = false; off(); };
  }, []);

  /** 主視覺要畫哪一張：自己挑的最優先，沒挑就用最近一張作品（大圖優先） */
  const heroSrc = previews.hero || recent[0]?.hero || recent[0]?.thumb || null;

  /** 整頁共用的那顆檔案選擇器（掛在最外層，見 return 最下面） */
  const previewInput = (
    <input
      ref={previewInputRef}
      type="file"
      accept="image/*"
      data-preview-pick=""
      className="hidden"
      onChange={e => { takePreview(e.target.files?.[0]); e.target.value = ''; }}
    />
  );

  /* 「立即訂閱」還沒接金流，按下去淡入一行「敬請期待」再淡出。
     用一個遞增的 key 讓連按也會重新播一次動畫，不會卡在原地。 */
  const [soonKey, setSoonKey] = useState(0);
  const soonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (soonTimer.current) clearTimeout(soonTimer.current); }, []);
  const showSoon = () => {
    setSoonKey(k => k + 1);
    if (soonTimer.current) clearTimeout(soonTimer.current);
    soonTimer.current = setTimeout(() => { soonTimer.current = null; setSoonKey(0); }, 1500);
  };

  /** 「立即使用」「查看全部」右邊那顆小箭頭，兩處共用 */
  const pillArrow = (
    <span
      className="material-symbols-outlined text-[15px]"
      style={{ fontVariationSettings: "'FILL' 0, 'wght' 500, 'opsz' 20" }}
    >
      chevron_right
    </span>
  );

  /**
   * 歷史紀錄的格子。首頁放 10 格（每排五個、兩排），「我的」那一頁也是 10 格。
   * 格子是正方形。
   * 兩邊是同一顆元件、同一份資料，只有格數不一樣。
   * 空的位子畫虛線框加一個加號，點下去就直接去挑照片 ——
   * 本來只是灰底，看不出來可以做什麼。
   */
  const historyGrid = (slots: number) => (
    <div className="grid grid-cols-5 gap-2">
      {Array.from({ length: slots }, (_, i) => {
        const item = recent[i];
        if (!item) {
          return (
            <button
              key={`slot-${i}`}
              onClick={onImportPhoto}
              aria-label="匯入照片"
              className="aspect-square rounded-[10px] border border-dashed border-white/15 flex items-center justify-center text-white/25 active:scale-[0.97] transition-transform duration-300"
            >
              <Icon name="add" className="text-[20px]" />
            </button>
          );
        }
          /* 縮圖偶爾會做不出來（手機解不動那張成品）。那時候不要掛一張破圖，
             畫成一塊素色的磚就好 —— 這一筆照樣點得開。 */
          const src = item.thumb || item.hero || '';
          return (
            <button
              key={item.id}
              onClick={() => onOpenRecent?.(item.id)}
              title={`${timeAgo(item.at)}導出`}
              className={`relative aspect-square rounded-[10px] overflow-hidden border border-white/10 p-0 active:scale-[0.97] transition-transform duration-300 ${src ? '' : 'bg-white/[0.07] flex items-center justify-center text-white/25'}`}
            >
              {src
                ? <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
                : <Icon name="image" className="text-[18px]" />}
            </button>
          );
      })}
    </div>
  );

  /** 首頁那一排：標題 ＋「查看全部」＋ 5 格 */
  const historySection = (
    <div>
      {/* 標題那一排：右邊多一顆「查看全部」。
           標題本身收斂一點 —— 它只是一行分區標籤，主角是下面那排縮圖，
           字級 14→12、字重 black→bold、白色降到 55%，不要壓過作品。 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-bold tracking-[0.14em] text-white/55">歷史紀錄</span>
        <button
          onClick={() => goNav('me')}
          className="flex items-center gap-0.5 text-[11px] tracking-[0.08em] text-white/35 active:scale-95 transition-transform"
        >
          查看全部
          {pillArrow}
        </button>
      </div>
      {historyGrid(10)}
    </div>
  );

  return (
    <div className="w-full h-screen bg-black text-white font-sans flex flex-col overflow-hidden relative">
      {/* 主視覺搬到捲動區裡面去了（見下面）。標題列整個拿掉了 ——
           品牌字與聯絡鈕都在首頁那一頁裡，所以主視覺上面不再壓著任何一條。 */}

      {/* --- 內容 ---
           設計稿是 overflow:hidden，但那是在 844 高的框裡量的；矮一點的機型會被切掉，
           所以改成可捲動＋藏捲軸（設計稿本來就掛了 no-sb）。 */}
      {/* --- 修圖／模板 與 我的 ---
           兩頁疊在同一格裡，換頁時左右滑過去（以前是直接抽換，畫面會硬跳一下）。
           外面這一層負責「有多大」，裡面兩頁各自 absolute inset-0 疊著；
           分頁列不在這一層裡，所以它不會跟著滑。 */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
      {/* --- 個人檔案（我）--- */}
      {(
        /* 上面那條標題列拿掉了，這裡自己補回它原本的高度（safe-area + 62px），
           這一頁的東西才會留在原來的位置，不會整組往上跑。
           不在「我的」的時候整頁移到右邊等著，而且不吃點擊。 */
        <div
          style={{
            transform: nav === 'me' ? 'translate3d(0,0,0)' : 'translate3d(100%,0,0)',
            transition: 'transform 560ms cubic-bezier(0.22,1,0.36,1)',
            willChange: 'transform',
          }}
          className={`no-scrollbar absolute inset-0 z-[6] overflow-y-auto px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+62px)] box-border bg-black ${nav === 'me' ? '' : 'pointer-events-none'}`}
        >
          {/* 登入入口。
              整列不再是一顆大按鈕 —— 只有右邊那顆箭頭會有反應，
              點頭貼或名字都不會誤觸（登入前後都是同一顆，長相也一樣）。 */}
          <div className="w-full flex items-center gap-4 pt-3 pb-5 text-left">
            <span className="w-[68px] h-[68px] shrink-0 rounded-full overflow-hidden bg-white/[0.05] border border-white/[0.14] flex items-center justify-center text-white/30">
              <AvatarView local={avatar} account={account} size={68} />
            </span>
            {/* 登入後只剩一行名字，讓它自己跟頭貼上下置中（外層已經 items-center）。
                名字那一行不要用 leading-none —— 行高等於字級的話，g、y、p 這種
                有下伸部的字母會超出行框，再被 truncate 的 overflow:hidden 切掉半截。
                leading-[1.34] 剛好把上伸部與下伸部都框進來。 */}
            <span className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="text-[24px] font-bold tracking-[0.02em] leading-[1.34] truncate">
                {account ? displayName(account) : '立即登入'}
              </span>
              {!account && (
                <span className="text-[11px] text-white/35">登入後可同步你的作品與偏好</span>
              )}
            </span>
            <button
              onClick={() => { account ? setAcctOpen(true) : openLogin(); }}
              aria-label={account ? '帳號設定' : '登入'}
              className="shrink-0 w-11 h-11 -mr-2.5 rounded-full flex items-center justify-center text-white/35 active:text-white active:scale-90 transition-[color,transform]"
            >
              <Icon name="chevron_right" className="text-[20px]" />
            </button>
          </div>

          {/* 會員方案。還沒接金流 —— 按下去淡入一行「敬請期待」再淡出。
               外層加 relative，那行字用絕對定位掛在卡片下面：
               走版面流的話它一出現就會把下面的東西往下頂一下。 */}
          <div className="relative">
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
            <button
              onClick={showSoon}
              className="shrink-0 h-9 px-5 rounded-full bg-white text-black text-[12px] font-black tracking-[0.08em] flex items-center active:scale-95 transition-transform duration-300"
            >
              立即訂閱
            </button>
          </div>

          {/* 淡入 → 停一下 → 淡出。key 每按一次就換，連按也會重新播 */}
          <AnimatePresence>
            {soonKey > 0 && (
              <motion.p
                key={soonKey}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                className="absolute top-full left-0 right-0 mt-3 text-center text-[12px] tracking-[0.22em] text-white/55 pointer-events-none"
              >
                敬請期待
              </motion.p>
            )}
          </AnimatePresence>
          </div>

          {/* 歷史紀錄（完整版）——首頁那一排的「查看全部」就是跳到這裡。
               10 格、每排五個（兩排）；還沒導出過的位子留空格，點下去直接去挑照片。 */}
          <div className="mt-8">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[12px] font-bold tracking-[0.14em] text-white/55">歷史紀錄</span>
              {/* 小小一行狀態。正常時就是「已存 N 筆」；
                   資料庫開不起來時會直接說出來，不會再靜靜地什麼都不顯示。 */}
              <span className="text-[10px] tracking-[0.1em] text-white/25">
                {histStat == null ? ''
                  : !histStat.ok ? '無法讀取紀錄'
                  : histStat.rows === histStat.usable ? `已存 ${histStat.rows} 筆`
                  : `已存 ${histStat.rows} 筆・${histStat.rows - histStat.usable} 筆缺原圖`}
              </span>
            </div>
            {historyGrid(10)}
          </div>

          {/* 登出與刪除帳號都收進帳號設定那一頁了（點上面那列右邊的箭頭） */}
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
        style={{
          overscrollBehavior: 'none',
          /* 兩頁一起平移：「我的」從右邊進來多少，這一頁就往左讓開多少，
             看起來是整條橫向的軌道在滑，而不是新的一頁蓋在舊的上面。 */
          transform: nav === 'me' ? 'translate3d(-100%,0,0)' : 'translate3d(0,0,0)',
          transition: 'transform 560ms cubic-bezier(0.22,1,0.36,1)',
          willChange: 'transform',
        }}
        className={`home-scroll no-scrollbar absolute inset-0 z-[5] overflow-y-auto box-border pb-[21px] ${nav === 'me' ? 'pointer-events-none' : ''}`}
      >
      {/* 這一疊是靠上半屏的 flex-1 撐著、貼著下緣排的，底部留白加大就等於整組一起往上。
           用 min-h 而不是 h：矮的機型內容會比這個高度還高，寫死高度會被切掉；
           撐開的話最多就是搜尋欄再往下一點，反正它本來就要在第一屏外面。 */}
      {/* pb 50 → 42：整疊往下 8px。
           廣告版位看得到的下緣與分頁列上緣原本差 24px，減三分之一就是 16px，
           所以整疊往下挪 8px。這一疊是貼著下緣排的，pb 少 8 就等於整組下移 8。
           主視覺與品牌字不在這個流裡（絕對定位），所以它們各自也加了同樣的 8px。 */}
      <div
        ref={heroRef}
        /* z-0：模板那一段是 z-[1]，往上滑的時候會蓋過這一屏（這一屏正在淡出）。
           這一層背景是透明的，不會反過來遮住模板。
           這裡有 transform／opacity，本來就是自己的堆疊環境，
           所以裡面那些 z-10 完全不受影響，排版也一個像素都沒動。
           home-hero：位移與淡出的動畫都掛在這個名字上（styles.css）。 */
        style={{ willChange: 'transform, opacity' }}
        /* 下面的內距是「整疊往上移多少」的調節閥：上半屏是 flex-1 吃剩餘高度的，
           這裡每多 1px，上半屏就矮 1px、下面那一疊連同品牌字就整組往上 1px。

           兩個貼著上半屏「下緣」排的東西會跟著動：品牌字那一組，以及主視覺
           下緣那道漸層。漸層不該跟著跑，所以它自己往下推了同樣的量補回來。
           右上角的聯絡鈕貼著上半屏「頂端」，不受這個數字影響，要動它得自己挪。

           這個 55 還有第二個工作：模板那一段的黑色遮罩，上緣比模板自己的
           頂端再高 41px；這一格的下緣＝模板的頂端，所以留白少於 41 的話，
           靜止時最後一排縮圖就已經踩進遮罩的羽化裡了。
           55 － 41 ＝ 靜止時還有 14px 的餘裕。

           ── min-h 為什麼是「一屏 ＋ 59px」而不是「一屏」──────────────
           歷史紀錄從一排變兩排，多了 72px。這一格如果還是剛好一屏，
           多出來的 72px 只能從上半屏挖 —— 主視覺、ABAI、下緣那道漸層
           就會整組往上 72px，那太多了。
           所以改成讓這一格比一屏高 59px：多出來的 72px 裡，59px 由這一格
           自己長高吸收（長出來的部分是最下面那段留白，落在畫面外，
           看不到也不影響任何東西），只剩 13px 由上半屏讓出來。
           結果：ABAI／主視覺／下緣漸層的位置一個像素都沒變（13px 剛好被
           「立即使用」上下間距各縮三分之一省下來的量抵銷掉），
           下面那一疊只往上 13px。 */
        className="home-hero relative z-0 min-h-[calc(100%_+_59px)] px-5 pb-[55px] flex flex-col box-border"
      >
        {/* --- 上半屏 ---
             參考圖上半是一整塊主視覺，品牌字壓在它的左下角。
             這一塊用 flex-1 把「一屏扣掉下面那一疊」剩下的高度全部吃掉 ——
             不管機型多高多矮，第一屏永遠剛剛好一屏，下面那一疊不會被擠出去，
             也不會反過來壓到上面（以前是 mt-auto 貼著下緣排，長一點就會打架）。
             -mx-5 是把它撐回滿版：文字與按鈕有 20px 邊界，主視覺沒有。 */}
        {/* 上下限放寬到「正常手機都碰不到」：碰到上限的話，多出來的高度就會掉到
             最下面變成一塊死留白，縮圖到分頁列的間距就不等於歷史紀錄的上緣間距了。
             52vh 只是防止極端視窗把主視覺撐得太誇張。 */}
        <div
          role="button"
          aria-label="換一張主視覺"
          onClick={() => pickPreview('hero')}
          className="relative shrink-0 flex-1 min-h-[130px] max-h-[52vh] -mx-5 overflow-hidden"
        >

          {/* 主視覺：預設用「最近一張作品」（參考圖上面那張照片就是歷史紀錄
               第一格的同一張）。點一下可以自己挑一張示意圖蓋過去，看排版效果。
               左邊那道壓黑的漸層已經拿掉了，照片整個滿版；
               下緣那道還留著 —— 它負責把照片收進黑色、跟下面那一排按鈕接起來，
               順便讓壓在上面的品牌字讀得到（品牌字剛好落在那一段裡）。 */}
          {heroSrc && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
              {/* 照片自己再慢一層（見 styles.css 的 .home-hero-art）：
                   上面那一屏已經只走 40% 的速度，照片在它裡面再往下補一點，
                   整體只走 30%，同時輕輕推近 —— 兩層速度差就是深度的來源。
                   上下各多留 10% 的餘裕，位移與推近時邊緣才不會露出空白。 */}
              <div ref={artRef} className="home-hero-art absolute -inset-y-[10%] inset-x-0 will-change-transform">
                <img src={heroSrc} alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
              {/* 下緣多長 1px、左右也各多 1px：這道漸層的邊本來剛好壓在
                   overflow-hidden 的裁切線上，父層捲動時是連續（帶小數）的位移，
                   兩條邊落在同一個位置就會在某些格子上抗鋸齒出一條淺色的縫。
                   讓漸層的邊超出裁切線，就永遠不會有那條縫。 */}
              <div
                className="absolute -inset-x-px -bottom-[4px] h-[calc(52%+4px)]"
                style={{ background: 'linear-gradient(to top,#000 0%,rgba(0,0,0,.92) 20%,rgba(0,0,0,.66) 44%,rgba(0,0,0,.3) 70%,rgba(0,0,0,0) 100%)' }}
              />
            </div>
          )}

          {/* 上面那排分頁字拿掉了 —— 分頁只留螢幕最下面那一條。
               它本來是絕對定位的，拿掉之後主視覺與品牌字的位置一個像素都沒動，
               只有聯絡鈕跟著往上補回原來的高度（本來是讓給那排字才往下的）。 */}

          {/* 聯絡鈕：圖示沒換，只是照參考圖改成細框的小圓。 */}
          <button
            onClick={e => { e.stopPropagation(); setContactOpen(true); }}
            aria-label="聯絡方式"
            className="absolute right-5 z-20 w-[34px] h-[34px] rounded-full border border-white/25 flex items-center justify-center text-white/75 hover:border-white/45 active:scale-95 transition-[border-color,transform] duration-300"
            /* 14 → 11：整頁往上 3px，這一顆也跟著（見下面那一疊的說明） */
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 11px)' }}
          >
            <Icon name="mail" className="text-[16px]" />
          </button>

          {/* 品牌字 ＋「立即使用」：照參考圖靠左、貼在主視覺左下角，
               字級與間距也照參考圖的比例縮到位（以前置中、而且大了快一倍）。
               字型、顏色、字重、文字內容都沒動。
               中間那行副標拿掉了，所以按鈕的上緣間距補回它原本佔的位置。 */}
          <div
            onClick={e => e.stopPropagation()}
            className="absolute left-5 right-5 bottom-[7px] flex flex-col items-start select-none"
          >
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="font-serif leading-none tracking-tight font-medium"
              style={{ fontSize: 'clamp(46px, 14.6vw, 62px)' }}
            >
              ABAI
            </motion.h1>
            <button
              onClick={onImportPhoto}
              className="mt-[12px] h-[27px] pl-4 pr-3 rounded-full bg-white text-black text-[11px] font-black tracking-[0.06em] flex items-center gap-0.5 active:scale-95 transition-transform duration-300"
            >
              立即使用
              {pillArrow}
            </button>
          </div>
        </div>

        {/* 編輯 / 相機 —— 圖示與文字沒動，高度跟下面那排四個工具對齊（都是 75）。
 */}
        <div className="relative z-10 mt-[8px] shrink-0 flex gap-2">
          <button
            onClick={onImportPhoto}
            className="flex-1 h-[75px] rounded-[13px] bg-white text-black border-none flex items-center justify-center gap-[9px] p-3.5 active:scale-[0.98] transition-transform duration-300"
          >
            <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 0, 'wght' 400, 'opsz' 24" }}>
              add_photo_alternate
            </span>
            <span className="text-sm font-black tracking-[0.06em]">編輯</span>
          </button>
          <button
            onClick={onOpenCamera}
            className="flex-1 h-[75px] rounded-[13px] bg-white/[0.06] border border-white/10 text-white flex items-center justify-center gap-[9px] p-3.5 hover:bg-white/[0.12] hover:border-white/20 active:scale-[0.98] transition-[background-color,border-color,transform] duration-300"
          >
            <Icon name="photo_camera" className="text-[24px] text-white/75" />
            <span className="text-sm font-black tracking-[0.06em]">相機</span>
          </button>
        </div>

        {/* 四個工具 —— 一樣只有尺寸照參考圖放大（64→75），圖示與文字沒換 */}
        <div className="relative z-10 mt-[11px] shrink-0 flex gap-2">
          {TOOL_TILES.map(t => (
            <button
              key={t.key}
              onClick={tileAction[t.key]}
              className="flex-1 min-w-0 h-[75px] rounded-[13px] bg-white/[0.06] border border-white/10 text-white flex flex-col items-center justify-center gap-[9px] hover:bg-white/[0.12] hover:border-white/20 active:scale-[0.98] transition-[background-color,border-color,transform] duration-300"
            >
              <Icon name={t.icon} className="text-[22px] text-white/70" />
              <span className="text-[10px] font-bold tracking-[0.06em] text-white/75 whitespace-nowrap">{t.label}</span>
            </button>
          ))}
        </div>

        {/* 新增：橫幅。按鈕沿用「立即使用」那一顆，沒有新的設計語言。

             ⚠️ 暫時的：點這張卡片就可以換一張底圖，純粹拿來看效果。
             沒有上傳／替換／刪除那幾顆小鈕了 —— 卡片本身就是那顆鈕，
             而且只能換、不能清空。圖只存在這台裝置的 localStorage，
             不會上傳任何地方。之後接上真的活動資料時，把 promoBg 這一組
             （狀態、input、卡片上的 onClick）拿掉就行，其他部分不用動。 */}
        <div
          role="button"
          aria-label="換一張橫幅底圖"
          onClick={() => pickPreview('promo')}
          className="relative z-10 mt-[14px] shrink-0 rounded-[14px] border border-white/[0.08] overflow-hidden text-left active:scale-[0.995] transition-transform duration-300"
          style={{ background: previews.promo ? undefined : 'rgba(255,255,255,.03)' }}
        >
          {previews.promo && (
            <>
              <img src={previews.promo} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
              {/* 由左往右收黑：字壓在左邊，右邊完全乾淨。
                   右端一定要收到「全透明」，不能停在 rgba(0,0,0,.12) ——
                   那 12% 會像一層灰紗蓋在整張圖右半邊上。
                   中間照 smoothstep 取樣，透明度曲線沒有折角，看不到帶狀邊。 */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(to right,'
                    + 'rgba(0,0,0,.88) 0%,rgba(0,0,0,.855) 8%,rgba(0,0,0,.789) 16%,rgba(0,0,0,.69) 24%,'
                    + 'rgba(0,0,0,.57) 32%,rgba(0,0,0,.44) 40%,rgba(0,0,0,.31) 48%,rgba(0,0,0,.19) 56%,'
                    + 'rgba(0,0,0,.092) 64%,rgba(0,0,0,.025) 72%,rgba(0,0,0,0) 80%,rgba(0,0,0,0) 100%)',
                }}
              />
            </>
          )}
          <div className="relative px-[18px] py-4">
            <p className="text-[16px] font-black tracking-[0.04em] text-white">全新濾鏡上線</p>
            <p className="mt-1.5 text-[11px] tracking-[0.14em] text-white/45">一鍵調出質感氛圍</p>
            <button
              /* 這顆在卡片裡面，要擋住冒泡 —— 不然按它會順便叫出換圖 */
              onClick={e => { e.stopPropagation(); onImportPhoto(); }}
              className="mt-3 h-[26px] pl-4 pr-3 rounded-full bg-white text-black text-[11px] font-black tracking-[0.06em] flex items-center gap-0.5 active:scale-95 transition-transform duration-300"
            >
              立即使用
              {pillArrow}
            </button>
          </div>
        </div>

        {/* 歷史紀錄 —— 點一張就回到它導出當下的編輯狀態。
             照參考圖：標題放大、右邊多一顆「查看全部」，格子改成直式，
             還沒導出過的位子改成虛線框加一個加號。 */}
        {/* 這一格的 mt 與上面那個 pb 是一組的（加起來 48）：
             mt 加多少，pb 就要減多少，歷史紀錄才會單純上下移動，
             不會把上半屏連帶拉高或壓扁。 */}
        <div className="relative z-10 mt-[12px] shrink-0">{historySection}</div>
      </div>

      {/* --- 靈感 ---
           接在第一屏下面，往下滑才看得到。 */}
      {/* 捲動區現在頂到畫面最上面，所以這一段自己要留出瀏海／狀態列的高度 */}
      {/* 廣告版位下緣到搜尋欄的間隔，對齊搜尋欄到第一排模板的 12px（mb-3）。
           版位是絕對定位往下多長 50px 的，扣掉這一段自己的 pb-[21px]，
           上緣留白 20px 是 12px、26px 就是 18px（12px 再多 0.5 倍）。
           只動這一段的頂端留白，第一屏（含廣告版位）一個像素都不會移動。 */}
      {/* 外面這一層是「排版盒」，裡面那一層才會動。
          ‧ 負的上外距：排版上先把這一段往上挪 --lib-lift，可捲的長度就短掉同樣的量。
          ‧ overflow: clip：裡面那層一開始是往下位移 +lift 的，不夾掉的話那一截會把
            可捲的長度撐長，捲到底時瀏覽器再把你夾回去 —— 那就是「滑到底會回朔」。
            夾掉之後可捲長度從頭到尾都是同一個數字。被夾掉的是模板最下面那一截，
            那時候它離畫面還很遠；等你真的捲到下面，位移早就收回 0 了，什麼都不會少。 */}
      <div ref={libBoxRef} style={{ marginTop: 'calc(var(--lib-lift, 0px) * -1)', overflow: 'clip' }}>
      <div ref={libRef} className="home-lib relative z-[1] px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+14px)]">
        {/* 模板這一段的底：一整片黑，往下滑的時候修圖那一屏就不會透過來重疊。
             上緣要羽化 43px（照 smoothstep 每 3px 取一站，曲線兩端都是平的、
             中間沒有折角，所以看不到帶狀邊）。往上多長 34px，
             純黑那一點落在這一段內 9px 處，離搜尋欄上緣還有 17px。

             這一層以前掛 zIndex:-1 —— 負的 z-index 子層在「會動的父層」裡會自己
             變成一個合成層，捲動時兩層的邊各自四捨五入，就會閃出一條線。
             現在改成：這一層不指定 z-index，下面的內容包一層 relative；
             兩個都是 z-index auto，就照 DOM 順序畫，內容自然蓋在它上面，
             不用負值也就沒有那條縫。 */}
        <div
          className="absolute -inset-x-px bottom-0 pointer-events-none"
          style={{
            /* 上緣跟著瀏海走，不再是寫死的 -34。
               搜尋欄在這一段的 (瀏海高 + 14) 處，羽化長 43px、從這一層的頂端算起，
               所以頂端訂在 (瀏海高 + 2 − 43) —— 羽化結束的位置永遠落在
               搜尋欄上方 12px，不管有沒有瀏海都一樣近。
               以前寫死 -34，在有瀏海的手機上羽化會停在搜尋欄上面 50 幾 px，
               中間隔著一大段純黑，那就是「遮罩離搜尋欄太遠」。 */
            top: 'calc(env(safe-area-inset-top, 0px) - 41px)',
            background:
              'linear-gradient(to bottom,'
              + 'rgba(0,0,0,0) 0px,rgba(0,0,0,.014) 3px,rgba(0,0,0,.053) 6px,rgba(0,0,0,.113) 9px,'
              + 'rgba(0,0,0,.19) 12px,rgba(0,0,0,.28) 15px,rgba(0,0,0,.379) 18px,rgba(0,0,0,.483) 21px,'
              + 'rgba(0,0,0,.587) 24px,rgba(0,0,0,.688) 27px,rgba(0,0,0,.781) 30px,rgba(0,0,0,.863) 33px,'
              + 'rgba(0,0,0,.929) 36px,rgba(0,0,0,.976) 39px,rgba(0,0,0,.994) 41px,#000 43px)',
          }}
        />
        {/* 內容包一層 relative，才會畫在上面那一層黑底之上（兩邊都不用 z-index） */}
        <div className="relative">
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
              {libList.filter((_, i) => i % 2 === col).map(t => {
                const key = `lib${LIB_TEMPLATES.indexOf(t)}`;
                const img = previews[key];
                return (
                  /* 還沒接真的模板資料，所以每一格都可以自己放一張示意圖看效果。
                     之後接上真的資料時，把 onClick 與 previews 這一段拿掉就好。 */
                  <button
                    key={t.name}
                    onClick={() => pickPreview(key)}
                    aria-label={`${t.name}：換一張示意圖`}
                    className={`relative rounded-[14px] overflow-hidden flex items-end text-left active:scale-[0.99] transition-transform duration-300 ${img ? 'border border-white/10' : EMPTY_TILE}`}
                    style={{ aspectRatio: t.ratio }}
                  >
                    {img && (
                      <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                    )}
                    <span
                      className="relative w-full text-left px-3 py-2.5 text-[11px] font-black tracking-[0.08em] text-white/70"
                      style={{ background: 'linear-gradient(to top,rgba(0,0,0,.8),rgba(0,0,0,0))' }}
                    >
                      {t.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        </div>
      </div>
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

      {previewInput}

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
            /* 背景一律可以點掉。原本 busy 時連這裡也不給關，請求一卡住就真的
               出不去了；離開本來就代表「這次不登了」，順手把等待狀態一起收掉。 */
            onClick={() => { endBusy(); setStep('id'); setLoginOpen(false); }}
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
                    // 卡在等待時按這顆＝「不等了」，把畫面放回信箱那一頁
                    if (step === 'busy') { endBusy(); setStep('id'); setLoginErr(''); return; }
                    if (step === 'code') { setStep('id'); return; }
                    if (emailOpen) { setEmailOpen(false); setLoginErr(''); setLoginNote(''); return; }
                    setLoginOpen(false);
                  }}
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
                      {/* 往上 0.5px：跟 Apple 那顆一樣，用 relative top 微調，
                          不佔版面所以水平位置不會被牽動。 */}
                      <svg viewBox="0 0 48 48" className="w-[17px] h-[17px] shrink-0 relative top-[-0.5px]">
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
                    onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_MAX)); setLoginErr(''); }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={'•'.repeat(OTP_LEN)}
                    disabled={step === 'busy'}
                    /* 字距從 0.5em 收到 0.32em：8～10 位的時候 0.5em 會擠到框外面 */
                    className="w-full h-[52px] px-4 rounded-[12px] bg-white/[0.05] border border-white/10 outline-none focus:border-white/30 text-center text-[22px] font-bold tabular-nums tracking-[0.32em] indent-[0.32em] text-white placeholder:text-white/20 transition-colors"
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
                    onClick={() => submitCode()}
                    disabled={code.length < OTP_LEN || step === 'busy'}
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

      {/* --- 帳號設定 ---
           點頭像那一列右邊的箭頭進來，整頁從右邊滑進來（跟 iOS 的次頁一樣）。
           登出與刪除帳號都收在這裡，不要擺在「我的」首頁上。 */}
      <AnimatePresence>
        {acctOpen && account && (
          <motion.div
            key="acct"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 z-[65] bg-black flex flex-col"
          >
            {/* 標題列：返回鍵跟「我的」那一頁的內距對齊 */}
            <div className="shrink-0 flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top,0px)+14px)] pb-3">
              <button
                onClick={() => setAcctOpen(false)}
                aria-label="返回"
                className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-white/60 hover:text-white active:scale-90 transition-[color,transform]"
              >
                <Icon name="arrow_back" className="text-[20px]" />
              </button>
              <p className="text-[17px] font-bold tracking-[0.02em]">帳號</p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 pb-10">
              {/* --- 頭貼 ---
                  只存在這台裝置，不會上傳雲端，所以下面那行小字要講清楚。 */}
              <div className="mt-2 flex flex-col items-center">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative w-[96px] h-[96px] active:scale-[0.97] transition-transform"
                >
                  {/* 圓形裁切放在裡面這一層 —— 掛在外層的話，右下角那顆相機
                      也會被 overflow:hidden 沿著圓周切掉一半。 */}
                  <span className="w-full h-full rounded-full overflow-hidden bg-white/[0.05] border border-white/[0.14] flex items-center justify-center text-white/30">
                    <AvatarView local={avatar} account={account} size={96} />
                  </span>
                  {/* 還沒上傳才掛那顆加號，當作「這裡可以放東西」的提示。
                      上傳之後就拿掉 —— 頭貼本身已經是最好的說明，不用再壓一顆按鈕在上面。
                      （不管有沒有加號，點頭貼都能重選一張。）
                      往內縮 2px，圓心才會落在圓周上（正角落是在圓外面）。 */}
                  {!avatar && !account.photo && (
                    <span className="absolute right-[2px] bottom-[2px] w-[30px] h-[30px] rounded-full bg-white text-black border-[3px] border-black flex items-center justify-center">
                      <Icon name="add" className="text-[16px]" />
                    </span>
                  )}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { pickAvatar(e.target.files?.[0]); e.target.value = ''; }}
                />
                {avatarErr && <p className="mt-3 text-[11px] text-white/50">{avatarErr}</p>}
              </div>

              {/* 這一頁才把完整信箱寫出來（外面那一列只放名字） */}
              <div className="mt-7 rounded-[16px] bg-white/[0.05] border border-white/10 px-5 py-4">
                <p className="text-[11px] tracking-[0.1em] text-white/35">電子郵件</p>
                <p className="mt-1.5 text-[15px] font-bold leading-[1.34] break-all">{account.id}</p>
              </div>

              <button
                onClick={() => setOutOpen(true)}
                className="mt-6 w-full h-[50px] rounded-[14px] bg-white/[0.07] border border-white/10 text-[14px] font-bold tracking-[0.04em] text-white active:scale-[0.985] transition-transform"
              >
                登出
              </button>

              {/* App Store 審核指南 5.1.1(v)：App 內能註冊，就必須能在 App 內刪除帳號 */}
              <button
                onClick={() => setDelOpen(true)}
                className="mt-2.5 w-full h-[50px] rounded-[14px] border border-white/10 text-[14px] font-bold tracking-[0.04em] text-white/40 active:scale-[0.985] transition-transform"
              >
                刪除帳號
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- 登出：按錯很煩，所以再問一次 --- */}
      <AnimatePresence>
        {outOpen && (
          <motion.div
            key="out"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOutOpen(false)}
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
              <p className="text-[15px] font-black tracking-[0.04em] text-white">確認登出帳號</p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setOutOpen(false)}
                  className="flex-1 h-[46px] rounded-[12px] bg-white/[0.06] border border-white/10 text-[13px] font-bold text-white/70 active:scale-[0.98] transition-transform"
                >
                  取消
                </button>
                <button
                  onClick={logout}
                  className="flex-1 h-[46px] rounded-[12px] bg-white text-black text-[13px] font-black active:scale-[0.98] transition-transform"
                >
                  登出
                </button>
              </div>
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
              <p className="text-[15px] font-black tracking-[0.04em] text-white">確認刪除帳號</p>
              <p className="mt-2 text-[12px] leading-relaxed text-white/45">刪除後會員資料無法復原</p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setDelOpen(false)}
                  disabled={delBusy}
                  className="flex-1 h-[46px] rounded-[12px] bg-white/[0.06] border border-white/10 text-[13px] font-bold text-white/70 active:scale-[0.98] transition-transform disabled:opacity-30"
                >
                  取消
                </button>
                <button
                  onClick={removeAccount}
                  disabled={delBusy}
                  className="flex-1 h-[46px] rounded-[12px] bg-white text-black text-[13px] font-black active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
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
