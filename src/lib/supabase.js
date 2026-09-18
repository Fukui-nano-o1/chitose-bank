// Supabaseクライアント（分割・段階1・2026-07-24）：全ファイル共通の単一クライアント。
// ここ以外で createClient しない（複数クライアントは認証状態の分裂を招く）。
import { createClient } from "@supabase/supabase-js";
import { createSupabaseFetch } from "./requestTransport";

// 全画面が同じ送信枠を共有する。RESTは1回の送信が待機を含め15秒、読み込み3本＋操作用の1枠。
const managedFetch = createSupabaseFetch({ supabaseUrl: import.meta.env.VITE_SUPABASE_URL });

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  global: { fetch: managedFetch },
});
