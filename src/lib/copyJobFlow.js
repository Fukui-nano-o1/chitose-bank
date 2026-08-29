// 求人のコピー→編集フローへ、の唯一のレール（2026-08-29たきと報告「コピーから入ると保存されない」の根治）。
// 【何が起きていたか】コピーの入口が4画面にあり、どれも copy_job の応答待ち（冷えたDBで数秒）の間
// ボタンが生きたままだった。画面に何も起きないので利用者が押し直し、1タップ＝1行のRPCが
// タップの数だけ下書きを量産（実測：4.5秒に4行）。作成中に同一の下書きが並び、編集の入っていない
// 複製を開くと「保存されていない」ように見えていた（保存そのものは成功していた）。
// 【守り】①モジュール変数の錠前＝どの画面のコピーボタンから呼んでも1つの実行しか通さない
// ②実行中は全画面の目隠し「コピーしています…」＝手応えが出るので押し直しが起きない
// （目隠し自体もタップを受け止める＝二重の壁）。
// ★コピーの入口を新しく作る時は必ずこの関数を使う（自前で copy_job を撃たない）。
import { supabase } from "./supabase";
import { fbError, fbSuccess } from "./feedback";

let inFlight = false;

// 全画面の目隠し（textContentのみ＝HTML直挿入の禁止・2026-08-02規則に適合）。
// 保存中オーバーレイと同じ役目の最小版。戻り値＝片付け関数
function showBusyVeil(msg) {
  try {
    const el = document.createElement("div");
    el.className = "f-sans";
    el.textContent = msg;
    Object.assign(el.style, {
      position: "fixed", inset: "0", zIndex: "11900",
      background: "rgba(0,0,0,0.45)", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "15px", fontWeight: "700",
    });
    document.body.appendChild(el);
    return () => { try { document.body.removeChild(el); } catch {} };
  } catch { return () => {}; }
}

// jobNumber の求人をコピーして編集フロー（#/work/edit/{新No.}）を開く。
// opts.presetDates … カレンダーの「この日にコピー」用：{ date_start, date_end, holidays } を
//   sessionStorage の受け渡しに重ねる（DBの下書きは copy_job の仕様どおり日程なしのまま＝
//   画面に入れた日は編集フローの保存で入る）
// opts.quietDates … dates_cleared の案内を出さない（presetDates で日を入れて渡す時用）
// 返り値：{ ok } または { busy:true }（実行中の再タップ＝黙って無視）
export async function copyJobToEdit(jobNumber, opts = {}) {
  if (inFlight) return { busy: true };
  inFlight = true;
  const hideVeil = showBusyVeil("コピーしています…");
  try {
    const { data, error } = await supabase.rpc("copy_job", { p_job_number: jobNumber });
    if (error || !data?.ok) {
      fbError();
      alert("コピーに失敗しました：" + (data?.reason || error?.message || "不明"));
      return { ok: false };
    }
    try {
      if (data.job) {
        const job = opts.presetDates ? { ...data.job, ...opts.presetDates } : data.job;
        sessionStorage.setItem("cb_editJobPrefill", JSON.stringify(job));
      }
    } catch {}
    if (data.dates_cleared && !opts.quietDates) {
      alert("コピーしました。作業日程は引き継がないため空になっています。確認ページの「日程」から新しい日を選んでください。");
    }
    fbSuccess();
    window.location.hash = "/work/edit/" + data.job_number; // 新しい下書きを編集フローで開く
    return { ok: true, jobNumber: data.job_number };
  } finally {
    hideVeil();
    inFlight = false;
  }
}
