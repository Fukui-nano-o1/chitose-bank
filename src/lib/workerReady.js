// 仮応募（第15弾・2026-07-30たきと指示）：応募の意思を先に預かり、本人のプロフィールが
// そろった瞬間に本応募へ昇格させる。その「そろったか」の唯一の基準は DB の
// is_worker_profile_ready(uid)。ここでは同じ条件を"どの項目が足りないか"の表示用に分解するだけで、
// 可否の判定そのものはサーバー（promote_my_pending_applications）が持つ＝二重定義にしない。
//
// ★2026-08-17たきと指示「プロフィール設定条件は必要最低限。①ニックネーム②緊急連絡先③居住地
//   ④自己紹介のみだ。」＝条件を4項目に整理した（移動手段・農作業の経験は条件から外した）。
//
// DB側の条件（写し・変更時は必ず両方直す＝migration 20260817100444）：
//   worker_profiles:     nickname / residence_city が空でない、かつ pr または pr_pending が空でない
//   emergency_contacts:  name または phone が空でない
// ※運営の自由記述（自己紹介）審査は条件に含まれない＝審査は応募をブロックしない（本弾の原則）。
//   pr_pending（審査待ち）でも条件は満たす。
// ※本人情報の登録（account_holders）は【この4項目とは別】の前提として残る（2026-08-17たきと裁定①）。
//   18歳未満の登録拒否と規約・プラポリの同意記録の唯一の場所so、未登録なら応募ボタンが #/account へ送り、
//   DB側も promote_my_pending_applications が not_registered で昇格を止める。ここには並べない
//   （プロフィールの項目ではなく、その手前の登録so、チェックリストに混ぜない）。
import { supabase } from "./supabase";

// 各項目の表示名と直し先。to() は遷移先ハッシュを返す（該当の入力欄を開いた状態で着地させる）
export const WORKER_READY_ITEMS = [
  { k: "nickname", label: "ニックネーム", hint: "農家に表示される名前です",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "nickname"); } catch {} return "/profile/worker/profile"; } },
  { k: "emergency", label: "緊急連絡先", hint: "作業中の事故に備えます。既定はご本人です",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "emergency"); } catch {} return "/profile/worker/profile"; } },
  { k: "residence_city", label: "お住まいの市町村", hint: "番地は公開されません",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "residence"); } catch {} return "/profile/worker/profile"; } },
  { k: "pr", label: "自己紹介", hint: "ひとことで大丈夫です",
    to: () => { try { sessionStorage.setItem("cb_wkOpenBox", "pr"); } catch {} return "/profile/worker/profile"; } },
];

const filled = (v) => !!(v && String(v).trim());

// 足りない項目を返す。{ ready, missing:[{k,label,hint,to}] }
// ready は DB の is_worker_profile_ready をそのまま使う（表示と判定の食い違いを作らない）
export async function fetchWorkerReady() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ready: false, missing: WORKER_READY_ITEMS, loggedIn: false };
  const uid = session.user.id;
  const [readyRes, wpRes, emgRes] = await Promise.all([
    supabase.rpc("is_worker_profile_ready", { p_uid: uid }).then(r => r, () => ({ data: null })),
    supabase.from("worker_profiles").select("nickname,residence_city,pr,pr_pending").eq("auth_id", uid).maybeSingle().then(r => r, () => ({ data: null })),
    supabase.from("emergency_contacts").select("name,phone").eq("auth_id", uid).maybeSingle().then(r => r, () => ({ data: null })),
  ]);
  const wp = wpRes.data || {};
  const emg = emgRes.data || {};
  const has = {
    nickname: filled(wp.nickname),
    emergency: filled(emg.name) || filled(emg.phone),
    residence_city: filled(wp.residence_city),
    pr: filled(wp.pr) || filled(wp.pr_pending),
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
