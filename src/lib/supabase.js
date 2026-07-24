// Supabaseクライアント（分割・段階1・2026-07-24）：全ファイル共通の単一クライアント。
// ここ以外で createClient しない（複数クライアントは認証状態の分裂を招く）。
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
