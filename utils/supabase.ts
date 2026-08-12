/**
 * Supabase 連線。
 *
 * ── 設定值從哪來 ────────────────────────────────────────────────
 * 下面直接寫了預設值，所以什麼都不設定也能用。
 * 想覆蓋的話就設環境變數，環境變數優先：
 *   VITE_SUPABASE_URL   專案網址，長得像 https://xxxxxxxx.supabase.co
 *   金鑰，下面三個名字都吃：
 *     VITE_SUPABASE_PUBLISHABLE_KEY  新版後台給的（sb_publishable_...）
 *     VITE_SUPABASE_ANON_KEY         舊版後台給的（eyJhbGci... 很長那串）
 *     VITE_SUPABASE_KEY              有些人習慣這樣命名
 *
 * 為什麼要吃三個名字：Supabase 2025 年改版之後，後台的「Connect」按鈕
 * 產生出來的是 PUBLISHABLE_KEY，舊文件寫的則是 ANON_KEY。兩把作用一樣。
 *
 * ── 為什麼可以直接寫在程式碼裡 ─────────────────────────────────
 * publishable（舊名 anon）這把金鑰本來就是「設計成公開」的：它一定會被
 * 打包進網頁的 JS，任何人打開開發者工具都看得到，這是它正常的運作方式。
 * 真正的權限是靠資料庫的 Row Level Security 在管，不是靠藏這把金鑰。
 * 所以寫在這裡跟放在環境變數裡，安全性上沒有差別，只是少一堆設定步驟。
 *
 * **但 service_role / sb_secret_ 那一把完全是另一回事**，它能繞過所有
 * 權限，絕對不可以出現在前端，只能放在伺服器端（見
 * supabase/functions/delete-account）。
 *
 * 沒設定的時候不讓整個 App 掛掉：isAuthReady 會是 false，登入按鈕會告訴
 * 使用者「尚未設定」，其他功能照常用。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* 預設值。要換專案的話改這兩行就好。 */
const DEFAULT_URL = 'https://jckvrssjsvkvtbelxnco.supabase.co';
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_OTS-0CizDbjMiYDD4Zq1-g_Zdp0RB3r';

const env = (import.meta as any).env || {};

/** 去掉前後空白與有些人會順手加上的引號，再去掉網址結尾多打的斜線 */
const clean = (v: unknown): string => String(v ?? '').trim().replace(/^["']|["']$/g, '');

const url = (clean(env.VITE_SUPABASE_URL) || DEFAULT_URL).replace(/\/+$/, '');
const publishableKey =
  clean(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_KEY) ||
  DEFAULT_PUBLISHABLE_KEY;

export const isAuthReady = !!(url && publishableKey);

/* 萬一有人把 service_role 貼進前端，開發時就在主控台大聲喊一次。
   （新版叫 sb_secret_...，舊版的 JWT 裡會寫 "role":"service_role"） */
if (
  publishableKey.startsWith('sb_secret_') ||
  (publishableKey.startsWith('eyJ') && publishableKey.includes('c2VydmljZV9yb2xl'))
) {
  console.error(
    '[supabase] 前端不能放 service_role / secret key！請換成 publishable（anon）那一把。',
  );
}

export const supabase: SupabaseClient | null = isAuthReady
  ? createClient(url, publishableKey, {
      auth: {
        /* 登入狀態存在 localStorage，重開 App 還在。
           App 包成原生之後這一段一樣有效（WebView 也有 localStorage）。 */
        persistSession: true,
        autoRefreshToken: true,
        /* 第三方登入回來時網址會帶著 token，SDK 自己收下來再把網址清乾淨。 */
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;
