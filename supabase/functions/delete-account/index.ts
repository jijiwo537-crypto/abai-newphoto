/**
 * 刪除帳號（Supabase Edge Function，跑在伺服器端）。
 *
 * 為什麼一定要有這一支：
 *   App Store 審核指南 5.1.1(v) —— App 內能註冊，就必須能在 App 內刪除帳號。
 *   而前端拿的是 anon key，照設計刪不掉使用者（不然任何人都能刪別人的帳號），
 *   所以刪除只能放在伺服器端，用 service_role key 執行。
 *
 * 安全性：
 *   ① 一定要帶著呼叫者自己的 access token（前端 supabase.functions.invoke 會自動帶）
 *   ② 用那個 token 反查「你是誰」，然後只刪「你自己」——
 *      呼叫端沒有任何辦法指定要刪別人。
 *
 * 部署（在你的電腦上執行一次就好）：
 *   npx supabase login
 *   npx supabase link --project-ref <你的專案 ref>
 *   npx supabase functions deploy delete-account
 *   （SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 是平台內建的環境變數，不用自己設）
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: '沒有登入' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ① 先用呼叫者自己的 token 問「你是誰」
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: me, error: meErr } = await asUser.auth.getUser();
    if (meErr || !me?.user) {
      return new Response(JSON.stringify({ error: '登入狀態無效' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ② 用管理權限刪掉「他自己」——id 來自上一步，呼叫端指定不了別人
    const admin = createClient(url, serviceKey);
    const { error: delErr } = await admin.auth.admin.deleteUser(me.user.id);
    if (delErr) throw delErr;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
