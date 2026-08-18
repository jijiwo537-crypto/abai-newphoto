/**
 * 帳號系統。畫面只跟這一支打交道，換後端只要改這裡。
 *
 * 支援四種登入：
 *   ① Email + 密碼（註冊／登入）
 *   ② Email 驗證碼（六位數，不用記密碼）
 *   ③ Google
 *   ④ Sign in with Apple
 *
 * 兩件 App Store 的硬規定，這裡都有對應：
 *   · 有第三方登入就必須有 Sign in with Apple（審核指南 4.8）
 *   · App 內能註冊就必須能在 App 內刪除帳號（5.1.1(v)）→ deleteAccount()
 */
import { supabase, isAuthReady } from './supabase';
import { isNative, APP_SCHEME } from './native';

export { isAuthReady };

/**
 * 信件裡的連結要按得開。
 *
 * 包成 App 之後 location.origin 會變成 `capacitor://localhost` —— 把它寫進
 * 驗證信裡，使用者在信箱點下去只會得到一個打不開的網址。所以原生環境改用
 * 網頁版的正式網址（環境變數 VITE_SITE_URL，見 env.example）。
 *
 * 網頁版永遠走 else 那半邊，跟以前完全一樣。
 */
const WEB_ORIGIN = String((import.meta as any).env?.VITE_SITE_URL ?? '').replace(/\/+$/, '');
const emailRedirect = (): string =>
  isNative() && WEB_ORIGIN ? `${WEB_ORIGIN}/` : `${location.origin}${location.pathname}`;

export interface AuthUser {
  id: string;
  email: string;
  /** 這個帳號是用什麼方式建立的（顯示用） */
  provider: 'email' | 'google' | 'apple' | string;
  createdAt: number;
  /**
   * 第三方帳號自己帶過來的大頭照網址。
   * Google 一定有；Apple 與 Email 驗證碼**不會給**（Apple 從來不提供照片，
   * Email 那條路更是連問都沒問過），所以那兩種會是 null，畫面上要有備案。
   */
  photo: string | null;
};

/** 不同供應商放大頭照的欄位名不一樣，全部試一遍 */
const photoOf = (u: any): string | null => {
  const m = u?.user_metadata || {};
  const v = m.avatar_url || m.picture || m.photoURL || null;
  return typeof v === 'string' && /^https?:\/\//.test(v) ? v : null;
};

const toUser = (u: any): AuthUser | null => {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || u.user_metadata?.email || '',
    provider: u.app_metadata?.provider || 'email',
    createdAt: u.created_at ? Date.parse(u.created_at) : Date.now(),
    photo: photoOf(u),
  };
};

/** 把 Supabase 的英文錯誤換成看得懂的中文 */
export const authErrText = (e: any): string => {
  const m = String(e?.message || e || '').toLowerCase();
  if (m.includes('invalid login credentials')) return '帳號或密碼不對';
  if (m.includes('email not confirmed')) return '請先到信箱點開驗證信';
  if (m.includes('user already registered') || m.includes('already been registered')) return '這個信箱已經註冊過了，直接登入吧';
  if (m.includes('password should be at least')) return '密碼至少要 6 個字';
  if (m.includes('token has expired') || m.includes('expired')) return '驗證碼過期了，請重新取得';
  if (m.includes('invalid') && m.includes('token')) return '驗證碼不對';
  if (m.includes('rate limit') || m.includes('too many')) return '太頻繁了，等一下再試';
  if (m.includes('network') || m.includes('fetch')) return '連不上伺服器，檢查一下網路';
  return '出了點問題，請再試一次';
};

/** 現在登入的是誰（沒登入回 null） */
export const getUser = async (): Promise<AuthUser | null> => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return toUser(data.user);
};

/** 監看登入狀態：登入、登出、換頁回來、token 自動更新都會叫一次 */
export const onAuthChange = (cb: (u: AuthUser | null) => void): (() => void) => {
  if (!supabase) { cb(null); return () => {}; }
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(toUser(session?.user)));
  return () => data.subscription.unsubscribe();
};

/* ── ① Email + 密碼 ─────────────────────────────────────────────── */

/** 註冊。信箱驗證有開的話會寄一封驗證信，這時候還不算登入。 */
export const signUpWithPassword = async (email: string, password: string) => {
  if (!supabase) throw new Error('尚未設定後端');
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: emailRedirect() },
  });
  if (error) throw error;
  // session 有值＝不需要驗證信、已經直接登入；null＝要去收信
  return { needVerify: !data.session, user: toUser(data.user) };
};

export const signInWithPassword = async (email: string, password: string) => {
  if (!supabase) throw new Error('尚未設定後端');
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return toUser(data.user);
};

/** 忘記密碼：寄一封重設信 */
export const sendPasswordReset = async (email: string) => {
  if (!supabase) throw new Error('尚未設定後端');
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: emailRedirect(),
  });
  if (error) throw error;
};

/* ── ② Email 驗證碼（六位數） ───────────────────────────────────── */

/**
 * 寄六位數驗證碼到信箱。沒有這個帳號就順便建一個（shouldCreateUser）——
 * 所以「註冊」與「登入」對使用者來說是同一條路，不用先選。
 */
export const sendEmailOtp = async (email: string) => {
  if (!supabase) throw new Error('尚未設定後端');
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
};

export const verifyEmailOtp = async (email: string, code: string) => {
  if (!supabase) throw new Error('尚未設定後端');
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw error;
  return toUser(data.user);
};

/* ── ③④ 第三方登入 ─────────────────────────────────────────────── */

/** 授權完成後，系統瀏覽器要把使用者送回這個網址 —— 就是回到 App 本身 */
const NATIVE_REDIRECT = `${APP_SCHEME}://auth-callback`;

/**
 * 把系統瀏覽器帶回來的網址換成登入狀態。
 *
 * Supabase 預設走 PKCE，會在 query 帶一個 `code`；某些設定會走 implicit，
 * 把 token 放在 `#` 後面。兩種都接，不然換個設定就登不進去。
 *
 * 這裡刻意不用 `new URL()` —— 自訂協定（com.abai.photo://）在不同引擎上
 * 拆解的結果不完全一致，直接切字串反而最穩。
 */
const completeNativeSignIn = async (url: string) => {
  const query = new URLSearchParams((url.split('?')[1] ?? '').split('#')[0]);
  const hash = new URLSearchParams(url.split('#')[1] ?? '');

  const failed = query.get('error_description') || hash.get('error_description')
    || query.get('error') || hash.get('error');
  if (failed) throw new Error(failed);

  const code = query.get('code');
  if (code) {
    const { error } = await supabase!.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase!.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }
  throw new Error('登入回傳的網址裡沒有授權資訊');
};

/**
 * 包成 App 之後的第三方登入。
 *
 * 為什麼不能沿用網頁那條：Google 會直接擋掉「內嵌 WebView」發出的授權請求
 * （回 disallowed_useragent），使用者按下去只會看到一頁英文錯誤。這是 Google
 * 的政策，繞不過去，也不該繞。
 *
 * 正確的做法是把授權頁交給**系統瀏覽器**（iOS 上是 SFSafariViewController）：
 *   ① 先跟 Supabase 要授權網址，但叫它不要自己跳轉（skipBrowserRedirect）
 *   ② 用系統瀏覽器打開
 *   ③ 使用者授權完，Supabase 導向 com.abai.photo://auth-callback
 *   ④ iOS 認得這個協定，把 App 叫醒並送上網址 → 換成 session → 關掉瀏覽器
 *
 * 監聽器一定要在打開瀏覽器**之前**就掛好，不然授權秒過的時候會漏接。
 */
const nativeSignInWithProvider = async (provider: 'google' | 'apple') => {
  const { data, error } = await supabase!.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: NATIVE_REDIRECT,
      skipBrowserRedirect: true,
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('沒有取得授權網址');

  const [{ Browser }, { App }] = await Promise.all([
    import('@capacitor/browser'),
    import('@capacitor/app'),
  ]);

  let done: (v: void) => void;
  let fail: (e: any) => void;
  const finished = new Promise<void>((res, rej) => { done = res; fail = rej; });

  const urlSub = await App.addListener('appUrlOpen', async ({ url }) => {
    // 別的深連結不要理它
    if (!url || !url.startsWith(`${APP_SCHEME}://`)) return;
    try {
      await completeNativeSignIn(url);
      done();
    } catch (e) {
      fail(e);
    } finally {
      try { await Browser.close(); } catch { }
    }
  });

  // 使用者自己把瀏覽器收掉 ＝ 放棄登入。已經成功的話這個 resolve 不會有作用
  //（Promise 只認第一次），所以順序上不必擔心。
  const closeSub = await Browser.addListener('browserFinished', () => done());

  try {
    await Browser.open({ url: data.url, presentationStyle: 'popover' });
    await finished;
  } finally {
    await urlSub.remove();
    await closeSub.remove();
  }
};

/**
 * Google／Apple。網頁版是「跳過去授權、再導回來」，
 * 導回來的網址由 Supabase 後台的 Redirect URLs 決定。
 *
 * 包成 App 時走上面那支 nativeSignInWithProvider（系統瀏覽器）。
 * 呼叫這支的畫面不用改，兩邊的介面一樣。
 */
export const signInWithProvider = async (provider: 'google' | 'apple') => {
  if (!supabase) throw new Error('尚未設定後端');
  if (isNative()) return nativeSignInWithProvider(provider);
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${location.origin}${location.pathname}`,
      /* 每次都跳出「選擇帳號」。
         不加這個的話，瀏覽器裡只登著一個 Google 帳號時，Google 會判斷
         「反正只有一個」就直接放行，使用者完全沒有機會換帳號，也沒辦法
         用別的帳號登入。prompt=select_account 是 Google 官方的參數，
         強制它每次都把帳號清單顯示出來。
         Apple 沒有這個參數（它自己就會問），所以只加在 Google 上。 */
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) throw error;
};

/* ── 登出／刪除帳號 ─────────────────────────────────────────────── */

export const signOut = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

/**
 * 刪除帳號（App Store 5.1.1(v) 規定一定要有）。
 *
 * 前端拿的是 anon key，照設計就刪不掉使用者 —— 這是對的，不然任何人都能
 * 刪別人的帳號。真正的刪除放在 Supabase 的 Edge Function（伺服器端，
 * 拿 service_role key），它會先驗證呼叫者的身分，只允許刪「自己」。
 * 函式的程式碼在 supabase/functions/delete-account/index.ts。
 */
export const deleteAccount = async () => {
  if (!supabase) throw new Error('尚未設定後端');
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw error;
  await supabase.auth.signOut();
};
