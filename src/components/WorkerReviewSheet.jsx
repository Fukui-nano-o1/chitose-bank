// 仕事の全体的な評価（働き手→農園）の入力シート（2026-08-19新設・同日に1問1ページへ）。
// ★この形は2箇所から開く：①応募状況ページ（#/profile/worker/approved）②今日ページの「仕事の評価」。
//   同じ入力が枝分かれしないよう、設問と保存はこの1部品に集約する
//   （項目を足す時・文言を変える時はここだけを直す）。
// ★ページ送り・戻る・最終確認の機構は共有部品 ReviewWizard が持つ＝農家→働き手の評価
//   （FarmerDashboard の完了・評価）と同じ形になる。見た目や送り方を変えるならあちらを直す。
// 保存するのは reviews の1行だけ（打刻の署名は撃たない・2026-08-18「打刻の全面削除」）。
// DBの壁：trg_reviews_party_consistency（当事者と向きの一致）＋trg_reviews_phase_gate
//   （worker_to_farmer は working 以上）が最後の担保なので、画面はその手前の案内に徹する。
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされ、
//   textarea のフォーカス・入力中の下書きが消える（LandingFlowのフォーカス消失バグと同族）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";
import { ReviewWizard } from "./ReviewWizard";

// 全体の評価の設問（順＝表示順）。k は reviews の列名と1対1。
// ★列を足したら DBの reviews_public_badges の列挙と components/ReceivedReviews.jsx の
//   BADGE_DEFS.worker_to_farmer も同時に直すこと（直さないと入力できるのに誰にも表示されない）。
// ★肯定（はい）だけが相手に表示される（利用規約 第8条2）。いいえは公開されないが記録には残る。
// ★entrust / followed_instructions / completed_work は農家→働き手の評価語なので、この向きでは使わない。
const REVIEW_QUESTIONS = [
  { k:"want_again",         label:"また働きたい",             hint:"またこの農園で働きたいと思いましたか" },
  { k:"as_described",       label:"説明のとおりだった",       hint:"作業の内容・時間・場所が求人の説明どおりでしたか" },
  { k:"safety_care",        label:"安全に配慮されていた",     hint:"危険な場所や作業の説明・備えがありましたか" },
  { k:"on_time",            label:"時間どおりだった",         hint:"始まりと終わりが予定どおりでしたか" },
  { k:"instructions_clear", label:"教え方が分かりやすかった", hint:"何をどうすればよいか、分かるように教えてもらえましたか" },
  { k:"paid_as_posted",     label:"賃金が求人のとおりだった", hint:"金額・支払い方（当日の現金手渡し）が求人のとおりでしたか" },
];

const taStyle = { width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px",
  fontSize:16, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" };

// app＝{ id, farmer_id }（応募のID と 相手＝農家のauth_id）。meId＝自分のauth_id。
// onDone(applicationId)＝保存できた時に親へ知らせる（一覧から消す・祝祭を出すのは親の仕事）。
export function WorkerReviewSheet({ app, meId, onDone, onClose }) {
  const [answers, setAnswers] = useState({});          // { [k]: true|false }
  const [publicComment, setPublicComment] = useState("");
  const [privateMemo, setPrivateMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 開き直したら前回の入力を持ち越さない（別の応募の評価に前の答えが残らないように）
  useEffect(() => { setAnswers({}); setPublicComment(""); setPrivateMemo(""); }, [app?.id]);
  const submit = async () => {
    if (!app || submitting) return;
    if (REVIEW_QUESTIONS.some(q => answers[q.k] === undefined)) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("reviews").insert({
        application_id: app.id, reviewer_id: meId, reviewee_id: app.farmer_id,
        direction: "worker_to_farmer",
        ...Object.fromEntries(REVIEW_QUESTIONS.map(q => [q.k, answers[q.k]])),
        public_comment: publicComment.trim() || null, private_memo: privateMemo.trim() || null,
      });
      if (error) { fbError(); alert("評価の保存に失敗しました：" + error.message); setSubmitting(false); return; }
      fbSuccess();
      onDone(app.id);
    } catch { alert("処理に失敗しました。"); }
    setSubmitting(false);
  };
  if (!app) return null;
  return (
    <ReviewWizard
      title="仕事の評価"
      questions={REVIEW_QUESTIONS}
      answers={answers}
      onAnswer={(k, v)=>setAnswers(prev => ({ ...prev, [k]: v }))}
      resetKey={app.id}
      submitting={submitting}
      onSubmit={submit}
      onClose={onClose}
      lastPageTitle="ひとこと（任意）"
      lastPageHint="書かなくても送信できます。"
      lastPage={
        <>
          <textarea value={publicComment} onChange={e=>setPublicComment(e.target.value)}
            placeholder="農園について良かった点を一言（公開されます）" rows={3} className="f-sans" style={taStyle} />
          <textarea value={privateMemo} onChange={e=>setPrivateMemo(e.target.value)}
            placeholder="自分だけが見えるメモ" rows={3} className="f-sans" style={{ ...taStyle, marginTop:8 }} />
        </>
      }
      confirmNote="送信すると、この仕事は終わりになります。あとから直すことはできません。「はい」と答えた項目だけが農園に表示されます。"
      confirmExtra={
        <div style={{ padding:"9px 0" }}>
          <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"0 0 2px" }}>農園について一言（公開）</p>
          <p className="f-sans" style={{ fontSize:13, color: publicComment.trim() ? "#222" : "#B0B0B0", margin:0, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{publicComment.trim() || "（なし）"}</p>
        </div>
      }
    />
  );
}
