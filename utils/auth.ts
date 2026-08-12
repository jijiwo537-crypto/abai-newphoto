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

export { isAuthReady };

export interface AuthUser {
  id: string;
  email: string;
  /** 這個帳號是用什麼方式建立的（顯示用） */
  provider: 'email' | 'google' | 'apple' | string;
  createdAt: number;
}

const toUser = (u: any): AuthUser | null => {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email || u.user_metadata?.email || '',
    provider: u.app_metadata?.provider || 'email',
    createdAt: u.created_at ? Date.parse(u.created_at) : Date.now(),
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
    options: { emailRedirectTo: `${location.origin}${location.pathname}` },
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
    redirectTo: `${location.origin}${location.pathname}`,
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

/**
 * Google／Apple。網頁版是「跳過去授權、再導回來」，
 * 導回來的網址由 Supabase 後台的 Redirect URLs 決定。
 *
 * 之後包成 App（Capacitor）時，這裡要改成原生流程：
 *   Apple → @capacitor-community/apple-sign-in 拿 identityToken，
 *           再呼叫 supabase.auth.signInWithIdToken({ provider:'apple', token })
 *   Google → @codetrix-studio/capacitor-google-auth 同理
 * 介面不用改，只有這一支的內容要換。
 */
export const signInWithProvider = async (provider: 'google' | 'apple') => {
  if (!supabase) throw new Error('尚未設定後端');
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
