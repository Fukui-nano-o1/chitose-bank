// 仮応募（第15弾・2026-07-30たきと指示）：応募の意思を先に預かり、本人のプロフィールが
// そろった瞬間に本応募へ昇格させる。その「そろったか」の唯一の基準は DB の
// is_worker_profile_ready(uid)。ここでは同じ条件を"どの項目が足りないか"の表示用に分解するだけで、
// 可否の判定そのものはサーバー（promote_my_pending_applications）が持つ＝二重定義にしない。
//
// DB側の条件（写し・変更時は必ず両方直す）：
//   worker_profiles: nickname / residence_city / transport が空でない
//                    かつ farm_experience が空でない or experience_entries が1件以上
//   account_holders: full_name が空でない
// ※運営の自由記述（自己紹介）審査は条件に含まれない＝審査は応募をブロックしない（本弾の原則）
import { supabase } from "./supabase";

// 各項目の表示名と直し先。to() は遷移先ハッシュを返す（該当の入力欄を開いた状態で着地させる）
export const WORKER_READY_ITEMS = [
  { k: "full_name", label: "お名前（本人確認）", hint: "新規登録の情報です",
    to: () => "/account" },
  { k: "nickname", label: "ニックネーム", hint: "農家に表示される名前です",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "nickname"); } catch {} return "/profile/worker/profile"; } },
  { k: "residence_city", label: "お住まいの市町村", hint: "番地は公開されません",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "residence"); } catch {} return "/profile/worker/profile"; } },
  { k: "transport", label: "移動手段", hint: "車・バイク・自転車・公共交通",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "transport"); } catch {} return "/profile/worker/profile"; } },
  { k: "experience", label: "農作業の経験", hint: "未経験でも「未経験」と書けます",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "exp"); } catch {} return "/profile/worker/profile"; } },
];

const filled = (v) => !!(v && String(v).trim());

// 足りない項目を返す。{ ready, missing:[{k,label,hint,to}] }
// ready は DB の is_worker_profile_ready をそのまま使う（表示と判定の食い違いを作らない）
export async function fetchWorkerReady() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ready: false, missing: WORKER_READY_ITEMS, loggedIn: false };
  const uid = session.user.id;
  const [readyRes, wpRes, ahRes] = await Promise.all([
    supabase.rpc("is_worker_profile_ready", { p_uid: uid }).then(r => r, () => ({ data: null })),
    supabase.from("worker_profiles").select("nickname,residence_city,transport,farm_experience,experience_entries").eq("auth_id", uid).maybeSingle().then(r => r, () => ({ data: null })),
    supabase.from("account_holders").select("full_name").eq("auth_id", uid).maybeSingle().then(r => r, () => ({ data: null })),
  ]);
  const wp = wpRes.data || {};
  const ah = ahRes.data || {};
  const has = {
    full_name: filled(ah.full_name),
    nickname: filled(wp.nickname),
    residence_city: filled(wp.residence_city),
    transport: filled(wp.transport),
    experience: filled(wp.farm_experience) || (Array.isArray(wp.experience_entries) && wp.experience_entries.length > 0),
  };
  const missing = WORKER_READY_ITEMS.filter(it => !has[it.k]);
  // RPCが取れなかった時だけ手元の判定に落とす（画面が真っ白にならないための保険）
  const ready = typeof readyRes.data === "boolean" ? readyRes.data : missing.length === 0;
  return { ready, missing, loggedIn: true };
}

// プロフィール保存の直後に呼ぶ。昇格した件数を返す（0なら何も起きなかった）
export async function promotePendingApplications() {
  try {
    const { data } = await supabase.rpc("promote_my_pending_applications");
    return (data && data.ok && Number(data.promoted)) || 0;
  } catch { return 0; }
}
