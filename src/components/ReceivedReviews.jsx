// 受け取った評価（利用規約 第8条・2026-08-07たきと承認）。
// 肯定的な選択項目（trueのみ）＋審査を通った公開コメントだけを表示する。
// 公開判定（双方の評価が揃うか完了から3日）はDB側 reviews_public_badges が担保＝ここは表示のみ。
// 個々の評価者は出さない（誰がどう評価したかは出さない＝推薦・選別の回避）。
// ★審査を感じさせない：作者側にはこの部品を出さない（自分の評価は MyReviewsOfWorker でそのまま見える）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Dots } from "./ui";
import { NavIconInline } from "./NavIcons";

// 方向ごとの肯定バッジ定義（falseは公開しない＝第8条2）。順序＝表示順。
// ★入力の設問（農家→働き手＝FarmerDashboard の FARMER_FINAL_QUESTIONS＋FARMER_TRAIT_TAGS／
//   働き手→農家＝WorkerReviewSheet の WORKER_FINAL_QUESTIONS）と、DBの reviews_public_badges の列挙と、
//   ここの3箇所は対で直すこと。どれか1つでも欠けると「入力できるのに誰にも表示されない」になる
const BADGE_DEFS = {
  // 2026-08-20に3問×3択＋特記タグへ再設計。trait_*＝肯定タグの集計（否定タグは公開されない）。
  // entrust/on_time/followed_instructions は旧データ用に残す（>0の時だけ出る）
  farmer_to_worker: [
    { k: "want_again", label: "また呼びたい", icon:"star" },
    { k: "completed_work", label: "予定どおり完了" },
    { k: "trait_careful", label: "丁寧だった" },
    { k: "trait_fast", label: "作業が早かった" },
    { k: "trait_attentive", label: "指示をよく確認した" },
    { k: "trait_safe", label: "安全に作業した" },
    { k: "entrust", label: "安心して任せられた" },
    { k: "on_time", label: "時間どおり" },
    { k: "as_described", label: "聞いていたとおり" },
    { k: "followed_instructions", label: "指示どおり" },
  ],
  // 2026-08-20に3問×3択へ再設計（求人と一致・報酬は約束どおり・また働きたい）。
  // safety_care/on_time/instructions_clear は旧データ用に残す（>0の時だけ出る）
  worker_to_farmer: [
    { k: "want_again", label: "また働きたい", icon:"star" },
    { k: "as_described", label: "求人のとおりだった" },
    { k: "paid_as_posted", label: "報酬は約束どおり" },
    { k: "safety_care", label: "安全に配慮" },
    { k: "on_time", label: "時間どおり" },
    { k: "instructions_clear", label: "教え方が分かりやすい" },
  ],
};

// 空（まだ公開できる評価が無い）の時は「まだ評価はありません」と明記する
// （2026-08-24たきと指示「評価は件数関係なく表示させろ。空ならまだないと明記」）。
// ★2026-08-08の「何も描かない」は撤回：評価が独立した面（タブ）になり、空だと面ごと白紙に見えるため。
// 公開判定の仕組み自体は不変（DB側 reviews_public_badges）。
// ★hideEmpty/onEmptyChange の2propは廃止のまま（親が中央固定で描いていた層ごと削除済み）
export function ReceivedReviews({ userId, direction }) {
  const [data, setData] = useState(null); // null=読み込み中 / {ok,badges,comments,total} / {ok:false}
  useEffect(() => {
    let cancelled = false;
    setData(null);
    (async () => {
      try {
        const { data: res } = await supabase.rpc("reviews_public_badges", { p_user_id: userId, p_direction: direction });
        if (!cancelled) setData(res && res.ok ? res : { ok: false });
      } catch { if (!cancelled) setData({ ok: false }); }
    })();
    return () => { cancelled = true; };
  }, [userId, direction]);

  const defs = BADGE_DEFS[direction] || [];
  const badges = (data && data.badges) || {};
  const shown = defs.filter(d => (badges[d.k] || 0) > 0);
  const comments = Array.isArray(data && data.comments) ? data.comments : [];
  const isEmpty = data !== null && shown.length === 0 && comments.length === 0;
  // 働き手宛＝農家からの評価＝緑／農家宛＝働き手からの評価＝橙（役割色の規約2026-07-22）
  const AC = direction === "farmer_to_worker" ? "#00A86B" : "#F76B1C";

  return (
    <div>
      {/* 見出し「🌟 受け取った評価」は削除（2026-08-07たきと指示・タブ名「評価」が見出しを兼ねる） */}
      {data === null ? (
        <p className="f-sans" style={{ fontSize: 12, color: "#999", padding: "12px 0" }}>読み込み中<Dots /></p>
      ) : isEmpty ? (
        <p className="f-sans" style={{ fontSize: 12, color: "#999", padding: "12px 0", margin: 0 }}>まだ評価はありません</p>
      ) : (
        <>
          {shown.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: comments.length > 0 ? 12 : 0 }}>
              {shown.map(d => (
                <span key={d.k} className="f-sans" style={{ fontSize: 12, fontWeight: 600, color: "#222", background: "#F0F7F4", border: "1px solid #CDE9DD", borderRadius: 20, padding: "4px 11px" }}>
                  {d.icon && <NavIconInline name={d.icon} size={12} />}{d.label} <b style={{ color: AC }}>{badges[d.k]}</b>
                </span>
              ))}
            </div>
          )}
          {comments.map((c, i) => (
            <div key={i} className="f-sans" style={{ borderTop: i === 0 ? "none" : "1px solid #EEE", padding: i === 0 ? "0 0 6px" : "8px 0 6px" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#222", lineHeight: 1.7, overflowWrap: "break-word", wordBreak: "break-word" }}>{c.comment}</p>
              <p style={{ margin: "2px 0 0", fontSize: 10, color: "#B0B0B0" }}>{c.date}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
