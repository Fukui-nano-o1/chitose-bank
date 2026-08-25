// 受け取った評価（利用規約 第8条・2026-08-07たきと承認）。
// 肯定的な選択項目（trueのみ）＋公開コメントを表示する（コメントの承認制は2026-08-23に廃止＝即時公開。
// 運営が非表示にしたものだけ落ちる＝判定はDB側 reviews_public_badges）。
// 公開判定（双方の評価が揃うか完了から3日）はDB側 reviews_public_badges が担保＝ここは表示のみ。
// 個々の評価者は出さない（誰がどう評価したかは出さない＝推薦・選別の回避）。
// ★作者側にはこの部品を出さない（自分が書いた評価は MyReviewsOfWorker でそのまま見える）。
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
    { k: "entrust", label: "安心して任せられた", legacy: true },
    { k: "on_time", label: "時間どおり", legacy: true },
    { k: "as_described", label: "聞いていたとおり", legacy: true },
    { k: "followed_instructions", label: "指示どおり", legacy: true },
  ],
  // 2026-08-20に3問×3択へ再設計（求人と一致・報酬は約束どおり・また働きたい）。
  // safety_care/on_time/instructions_clear は旧データ用に残す（>0の時だけ出る）
  worker_to_farmer: [
    { k: "want_again", label: "また働きたい", icon:"star" },
    { k: "as_described", label: "求人のとおりだった" },
    { k: "paid_as_posted", label: "報酬は約束どおり" },
    { k: "safety_care", label: "安全に配慮", legacy: true },
    { k: "on_time", label: "時間どおり", legacy: true },
    { k: "instructions_clear", label: "教え方が分かりやすい", legacy: true },
  ],
};

// 空（まだ公開できる評価が無い）の時は「まだ評価はありません」と明記する
// （2026-08-24たきと指示「評価は件数関係なく表示させろ。空ならまだないと明記」）。
// ★2026-08-08の「何も描かない」は撤回：評価が独立した面（タブ）になり、空だと面ごと白紙に見えるため。
// 公開判定の仕組み自体は不変（DB側 reviews_public_badges）。
// ★hideEmpty/onEmptyChange の2propは廃止のまま（親が中央固定で描いていた層ごと削除済み）
// jobNumber（任意・2026-08-25）：求人ページから求人者の評価を出すときに渡す。求人ページの
// クライアントは求人者のauth UIDを知らない（farmer_idは誰にも出さない）ため、求人No.で引く窓口
// job_employer_reviews に切り替える。返る中身・開示範囲・見た目は同じ（窓口が違うだけ）
// showAllItems（任意・2026-08-25たきと指示「全ての評価を表示」）：件数0の項目も並べ、
// いま評価される全項目を見せる。旧設問（legacy＝2026-08-20の再設計で使わなくなった問い）だけは
// 0のとき出さない＝いま存在しない問いを「0件」として並べない。
// ★注意：総数が2件以上あるのに0の項目that並ぶと「誰も肯定しなかった」＝否定的な評価が読み取れる。
//   利用規約 第8条2（否定的な評価は他の利用者に表示されない）との緊張so、この prop を使う場所を
//   増やすときは必ず確認を取ること（現在の使用箇所＝求人詳細の求人者情報のみ）
// preloaded（任意・2026-08-25）：親that既に同じ内容を引いている時に渡す＝同じ往復を2回しない。
// 求人詳細の求人者情報カードthat、上の数字（また働きたい）と下の評価欄で同じ値を使うために渡している。
// ★渡された時はここでは引かない（数字that食い違わない）。null（読み込み中）はそのまま読み込み中として描く
export function ReceivedReviews({ userId, direction, jobNumber, showAllItems, preloaded }) {
  const [data, setData] = useState(preloaded !== undefined ? preloaded : null); // null=読み込み中 / {ok,badges,comments,total} / {ok:false}
  useEffect(() => {
    if (preloaded !== undefined) { setData(preloaded); return; }
    let cancelled = false;
    setData(null);
    (async () => {
      try {
        const { data: res } = jobNumber
          ? await supabase.rpc("job_employer_reviews", { p_job_number: jobNumber })
          : await supabase.rpc("reviews_public_badges", { p_user_id: userId, p_direction: direction });
        if (!cancelled) setData(res && res.ok ? res : { ok: false });
      } catch { if (!cancelled) setData({ ok: false }); }
    })();
    return () => { cancelled = true; };
  }, [userId, direction, jobNumber, preloaded]);

  const defs = BADGE_DEFS[direction] || [];
  const badges = (data && data.badges) || {};
  const shown = showAllItems
    ? defs.filter(d => !d.legacy || (badges[d.k] || 0) > 0) // 0件の項目も並べる（旧設問は0なら出さない）
    : defs.filter(d => (badges[d.k] || 0) > 0);
  const comments = Array.isArray(data && data.comments) ? data.comments : [];
  // 空の判定は「実際に届いた評価があるか」で見る（showAllItemsでは0件の項目that並ぶため、
  // shown.lengthでは常に非空になり「まだ評価はありません」that出せなくなる）
  const hasAny = defs.some(d => (badges[d.k] || 0) > 0) || comments.length > 0;
  const isEmpty = data !== null && !hasAny;
  // 働き手宛＝農家からの評価＝緑／農家宛＝働き手からの評価＝橙（役割色の規約2026-07-22）
  const AC = direction === "farmer_to_worker" ? "#00A86B" : "#F76B1C";

  return (
    <div>
      {/* 見出し「🌟 受け取った評価」は削除（2026-08-07たきと指示・タブ名「評価」が見出しを兼ねる） */}
      {data === null ? (
        <p className="f-sans" style={{ fontSize: 12, color: "#999", padding: "12px 0" }}>読み込み中<Dots /></p>
      ) : (
        <>
          {/* まだ1件も届いていない時の明記。showAllItemsではこの下に全項目（0件）that並ぶ＝
              「何が評価されるのか」は見えたまま、まだ無いことも隠さない */}
          {isEmpty && (
            <p className="f-sans" style={{ fontSize: 12, color: "#999", padding: showAllItems ? "0 0 8px" : "12px 0", margin: 0 }}>まだ評価はありません</p>
          )}
          {shown.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: comments.length > 0 ? 12 : 0 }}>
              {shown.map(d => {
                const n = badges[d.k] || 0;
                // 0件は控えめな見た目（届いた評価と見分けがつくように）
                return (
                  <span key={d.k} className="f-sans" style={{ fontSize: 12, fontWeight: 600, color: n > 0 ? "#222" : "#B0B0B0", background: n > 0 ? "#F0F7F4" : "#FAFAFA", border: "1px solid " + (n > 0 ? "#CDE9DD" : "#EBEBEB"), borderRadius: 20, padding: "4px 11px" }}>
                    {d.icon && <NavIconInline name={d.icon} size={12} />}{d.label} <b style={{ color: n > 0 ? AC : "#C4C4C4" }}>{n}</b>
                  </span>
                );
              })}
            </div>
          )}
          {hasAny && shown.length > 0 && (
            /* 集計である旨の明記（利用規約 第8条3）。旧・信頼カードの「働き手の最終回答を集計」の
               役目をここが引き継ぐ（2026-08-24に一致の集計ごとカードから消したため）。この1行を外さないこと */
            <p className="f-sans" style={{ fontSize: 10, color: "#B0B0B0", margin: comments.length > 0 ? "0 0 10px" : 0 }}>相手の回答を数えたものです（運営者が認定した事実ではありません）</p>
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
