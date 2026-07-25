// Supabaseクライアント（分割・段階1・2026-07-24）：全ファイル共通の単一クライアント。
// ここ以外で createClient しない（複数クライアントは認証状態の分裂を招く）。
import { createClient } from "@supabase/supabase-js";

// 全リクエスト共通のタイムアウト（2026-07-25）：モバイル回線の電波切替等でfetchが無応答のまま
// OSタイムアウト（約60秒）まで待ち続け、リロードが50秒白画面になる事象の根治。
// 15秒＝圧縮済み写真(数百KB)のアップロードにも十分な余裕。非対応ブラウザは従来どおり
const fetchWithTimeout = (url, options = {}) => {
  try {
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout && !options.signal) {
      return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    }
  } catch {}
  return fetch(url, options);
};

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  global: { fetch: fetchWithTimeout },
});
