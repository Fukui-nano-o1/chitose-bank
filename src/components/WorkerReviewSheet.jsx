// 最終日の評価（働き手→農家）＝今回の仕事のふりかえり（2026-08-20たきと裁定で3問×3択に再設計）。
// ★この形は2箇所から開く：①応募状況ページ（#/profile/worker/approved）②今日ページの「仕事の評価」。
//   同じ入力が枝分かれしないよう、設問と保存はこの1部品に集約する。
// ★対称設計にしすぎない（たきと裁定）：働き手側が測るのは人柄より【求人の信頼性】＝
//   ①求人に書かれていた内容と実際は一致していたか ②報酬は約束どおり支払われたか ③また働きたいか。
// ★公開自由記述は置かない（2026-08-20たきと裁定・泥沼の回避）。
// 保存は reviews の1行だけ。真実は3択の新列（match_level/pay_status/want_again_choice）に持ち、
//   既存 boolean（as_described/paid_as_posted/want_again）は互換の影として同時に立てる
//   ＝公開バッジ（reviews_public_badges）と信頼カードがそのまま動く。
// DBの壁：trg_reviews_party_consistency（当事者と向きの一致）＋trg_reviews_phase_gate
//   （worker_to_farmer は working 以上）が最後の担保。
// ★モジュールレベル定義を維持すること（親内定義はフォーカス消失バグの元・CLAUDE.md）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";
import { FinalReviewSheet } from "./FinalReviewSheet";

// 設問（3問・すべて3択）。k は reviews の列名と1対1。
// ★選択肢を変える時は DBのCHECK制約（reviews_match_level_check 等）と対で直すこと
const WORKER_FINAL_QUESTIONS = [
  { k:"match_level", label:"求人に書かれていた内容と、実際の仕事は一致していましたか", choices:[
    { v:"matched",  l:"一致していた" },
    { v:"partly",   l:"一部違った" },
    { v:"differed", l:"大きく違った" },
  ]},
  { k:"pay_status", label:"報酬は約束どおり支払われましたか", choices:[
    { v:"paid",   l:"支払われた" },
    { v:"unpaid", l:"未払い" },
    { v:"other",  l:"その他" },
  ]},
  { k:"want_again_choice", label:"またこの農家の仕事をしたいですか", choices:[
    { v:"yes",     l:"はい" },
    { v:"neutral", l:"どちらともいえない" },
    { v:"no",      l:"いいえ" },
  ]},
];

// app＝{ id, farmer_id }（応募のID と 相手＝農家のauth_id）。meId＝自分のauth_id。
// dayCount＝実働日数（分かる時だけ・客観データの見出しに出す）。
// onDone(applicationId)＝保存できた時に親へ知らせる（一覧から消す・祝祭を出すのは親の仕事）。
export function WorkerReviewSheet({ app, meId, dayCount, onDone, onClose }) {
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  // 開き直したら前回の入力を持ち越さない（別の応募の評価に前の答えが残らないように）
  useEffect(() => { setAnswers({}); }, [app?.id]);
  const submit = async () => {
    if (!app || submitting) return;
    if (WORKER_FINAL_QUESTIONS.some(q => !answers[q.k])) return;
    setSubmitting(true);
    try {
      const wc = answers.want_again_choice;
      const { error } = await supabase.from("reviews").insert({
        application_id: app.id, reviewer_id: meId, reviewee_id: app.farmer_id,
        direction: "worker_to_farmer",
        match_level: answers.match_level, pay_status: answers.pay_status, want_again_choice: wc,
        // 互換の影（公開バッジ・信頼カードの材料）。はい→true／いいえ→false／どちらとも→null
        as_described: answers.match_level === "matched",
        paid_as_posted: answers.pay_status === "paid",
        want_again: wc === "yes" ? true : wc === "no" ? false : null,
      });
      if (error) { fbError(); alert("評価の保存に失敗しました：" + error.message); setSubmitting(false); return; }
      fbSuccess();
      onDone(app.id);
    } catch { alert("処理に失敗しました。"); }
    setSubmitting(false);
  };
  if (!app) return null;
  return (
    <FinalReviewSheet
      app={app}
      title="今回の仕事のふりかえり"
      intro="これで今回の仕事は終わりになります。答えは3つだけです。"
      dayCount={dayCount}
      questions={WORKER_FINAL_QUESTIONS}
      answers={answers}
      onAnswer={(k, v)=>setAnswers(prev => ({ ...prev, [k]: v }))}
      submitting={submitting}
      onSubmit={submit}
      onClose={onClose}
      confirmNote="送信すると、あとから直すことはできません。肯定的な答えだけが農園のページに表示されます（否定的な答えは公開されませんが、記録には残ります）。"
    />
  );
}
