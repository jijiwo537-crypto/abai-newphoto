/**
 * Supabase 連線。
 *
 * 兩個值放在環境變數裡（不要寫死在程式碼裡，也不要放進版控）：
 *   VITE_SUPABASE_URL       專案網址，長得像 https://xxxxxxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY  匿名金鑰（anon public key）
 *
 * anon key 本來就是「可以公開」的那一把（它會出現在瀏覽器裡），真正的權限
 * 是靠資料庫的 Row Level Security 在管。**絕對不要**把 service_role key
 * 放進前端 —— 那一把能繞過所有權限，只能放在伺服器端（見 Edge Function）。
 *
 * 沒設定的時候不讓整個 App 掛掉：isAuthReady 會是 false，登入按鈕會告訴
 * 使用者「尚未設定」，其他功能照常用。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isAuthReady = !!(url && anonKey);

export const supabase: SupabaseClient | null = isAuthReady
  ? createClient(url!, anonKey!, {
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
