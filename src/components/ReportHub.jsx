// 統合報告ハブ（2026-08-15たきと指示「報告の入口を1つに統合。フォーム内でジャンルを切り替える」）
// ・モーダルは App.jsx に1つだけ常駐し、openReportHub()（lib/previewBus）でどこからでも開く
//   ＝旧FeedbackModalと同じ「常駐＋外部制御」方式（トリガーと同居させると☰を閉じた時に
//   アンマウントされて開かないバグの型・2026-07-14）
// ・保存経路は従来のまま：求人=job_reports／相手の人=profile_reports／この画面=feedback。
//   新しい書き込み経路は作らない（行動記録の憲法）。コメントの報告だけは、本文の凍結コピーを
//   取るためチャット画面（ChatViewの🚩＝該当コメントを選ぶ）が唯一の窓口＝ここでは案内のみ
// ・ジャンルの文脈（どの求人か・どの人か）が無いときは、タップ不能にせず「どこから送るか」を
//   説明する（タップ不能はやめる原則・2026-08-03）
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const GENRES = [
  { k: "job",     l: "求人" },
  { k: "person",  l: "相手の人" },
  { k: "comment", l: "コメント" },
  { k: "screen",  l: "この画面" },
];

// 選択肢＝事実の申告だけを並べる（運営の主観・おすすめ度を混ぜない＝2026-07-16あっせん回避）。
// 旧モーダル（JobSearchMapView／WorkerPreviewSheet／FeedbackModal）から移設・文言不変
const JOB_TARGET_FIELDS = ["報酬","勤務時間・休憩","危険情報","作業の説明","写真","場所・日程","その他"];
const JOB_ISSUE_TYPES = ["虚偽・誇大の疑い","最低賃金違反","差別的条件","連絡先の直書き・外部誘導","危険情報の欠落","個人情報・肖像権","不快・不適切な表現","その他"];
const PROFILE_REPORT_FIELDS = ["自己紹介", "質問への回答", "自己申告（経験・資格）", "写真・アイコン", "はたらいた記録", "その他"];
const PROFILE_REPORT_ISSUES = ["虚偽・誇大の疑い", "連絡先の直書き・外部誘導", "個人情報・肖像権", "差別的・不快な表現", "なりすましの疑い", "記録の食い違い", "その他"];
// feedbackテーブルのcategory CHECK制約と対応
const FEEDBACK_CATEGORIES = [
  { v:"confusing",   l:"分かりにくい" },
  { v:"broken",      l:"動かない" },
  { v:"typo",        l:"誤字・表示" },
  { v:"suggestion",  l:"提案" },
  { v:"other",       l:"その他" },
];

const selStyle = { width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" };
const taStyle = { width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:16, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" };

export default function ReportHub() {
  // st = { genre, job:{jobNumber,title}|null, worker:{workerId,name,source}|null }
  const [st, setSt] = useState(null);
  const [field, setField] = useState("");
  const [issue, setIssue] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const f = (e) => {
      const d = e.detail || {};
      setSt({ genre: d.genre || "screen", job: d.job || null, worker: d.worker || null });
      setField(""); setIssue(""); setDetail(""); setCategory(""); setSending(false); setDone(false);
    };
    window.addEventListener("cb:openReportHub", f);
    return () => window.removeEventListener("cb:openReportHub", f);
  }, []);

  if (!st) return null;
  const close = () => setSt(null);
  const switchGenre = (k) => {
    if (k === st.genre) return;
    setSt(s => ({ ...s, genre: k }));
    setField(""); setIssue(""); setDetail(""); setCategory(""); setDone(false);
  };

  const canSend =
    st.genre === "job"    ? !!(st.job && field && issue) :
    st.genre === "person" ? !!(st.worker && field && issue) :
    st.genre === "screen" ? !!category : false;

  const submit = async () => {
    if (sending || !canSend) return;
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSending(false); alert("報告にはログインが必要です。"); return; }
      let error = null;
      if (st.genre === "job") {
        ({ error } = await supabase.from("job_reports").insert({
          job_number: st.job.jobNumber,
          reporter_id: session.user.id,
          target_field: field,
          issue_type: issue,
          detail: detail.trim() || null,
        }));
      } else if (st.genre === "person") {
        ({ error } = await supabase.from("profile_reports").insert({
          target_worker_id: st.worker.workerId,
          reporter_id: session.user.id,
          source: st.worker.source || "profile",
          target_field: field,
          issue_type: issue,
          detail: detail.trim() || null,
        }));
      } else {
        ({ error } = await supabase.from("feedback").insert({
          reporter_id: session.user.id,
          page_hash: window.location.hash || "#/",
          category,
          body: detail.trim() || null,
          viewport: window.innerWidth,
        }));
      }
      setSending(false);
      if (error) { alert("報告の送信に失敗しました：" + error.message); return; }
      setDone(true);
      setTimeout(() => setSt(s => (s ? null : s)), 1600);
    } catch {
      setSending(false);
      alert("報告の送信に失敗しました。");
    }
  };

  // 文脈が無いジャンルは、正しい入口への案内を出す（送信ボタンは出さない）
  const guidance =
    st.genre === "job" && !st.job
      ? "求人の報告は、該当の求人ページを開いて、末尾の「⚑ この求人を報告する」から送れます。"
    : st.genre === "person" && !st.worker
      ? "人の報告は、その方のプロフィール（アイコンをタップして開くプレビュー）の末尾にある「⚑ この人を報告する」から送れます。"
    : st.genre === "comment"
      ? "コメントの報告は、証拠として本文をそのまま保存するため、チャット画面から行います。チャット右上の「🚩 報告する」を押して、該当のコメントを選んでください。"
    : null;

  const doneMsg = st.genre === "screen"
    ? "ありがとうございます。改善に使わせていただきます"
    : "報告を受け付けました。運営が確認します";

  return (
    <div onClick={close} style={{ position:"fixed", inset:0, zIndex:9900, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
        {done ? (
          <>
            <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0", margin:0 }}>{doneMsg}</p>
            <button onClick={close} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#222", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>閉じる</button>
          </>
        ) : (
          <>
            <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:10 }}>⚑ 報告する</p>
            {/* ジャンルの切り替えピル（応募者ページの絞り込みバーと同じ視覚文法） */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
              {GENRES.map(g => (
                <button key={g.k} type="button" onClick={() => switchGenre(g.k)} className="f-sans" style={{
                  padding:"7px 13px", borderRadius:20, fontSize:12, cursor:"pointer", border:"2px solid",
                  fontWeight: st.genre === g.k ? 700 : 600,
                  borderColor: st.genre === g.k ? "#222" : "#EBEBEB",
                  background:"#fff", color: st.genre === g.k ? "#222" : "#717171",
                }}>{g.l}</button>
              ))}
            </div>

            {guidance ? (
              <>
                <p className="f-sans" style={{ fontSize:13, color:"#333", lineHeight:1.8, background:"#F7F7F7", borderRadius:10, padding:"12px 14px", margin:"0 0 16px" }}>{guidance}</p>
                <div style={{ display:"flex", justifyContent:"flex-end" }}>
                  <button onClick={close} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>閉じる</button>
                </div>
              </>
            ) : (
              <>
                {st.genre === "job" && (
                  <>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px" }}>#{st.job.jobNumber}{st.job.title ? "・" + st.job.title : ""} の求人について</p>
                    <div style={{ display:"grid", gap:8, marginBottom:8 }}>
                      <select value={field} onChange={e=>setField(e.target.value)} className="f-sans" style={selStyle}>
                        <option value="">対象項目を選択</option>
                        {JOB_TARGET_FIELDS.map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={issue} onChange={e=>setIssue(e.target.value)} className="f-sans" style={selStyle}>
                        <option value="">問題の種類を選択</option>
                        {JOB_ISSUE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <textarea value={detail} onChange={e=>setDetail(e.target.value)} placeholder="詳細（任意）" rows={4} className="f-sans" style={taStyle} />
                    </div>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>報告は運営のみが確認します。求人の掲載者にはあなたの情報は伝わりません</p>
                  </>
                )}
                {st.genre === "person" && (
                  <>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px" }}>{st.worker.name ? st.worker.name + "さん・" : ""}{st.worker.source === "work_record" ? "はたらいた記録の面から" : "プロフィールの面から"}</p>
                    <div style={{ display:"grid", gap:8, marginBottom:8 }}>
                      <select value={field} onChange={e=>setField(e.target.value)} className="f-sans" style={selStyle}>
                        <option value="">対象項目を選択</option>
                        {PROFILE_REPORT_FIELDS.map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={issue} onChange={e=>setIssue(e.target.value)} className="f-sans" style={selStyle}>
                        <option value="">問題の種類を選択</option>
                        {PROFILE_REPORT_ISSUES.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <textarea value={detail} onChange={e=>setDetail(e.target.value)} placeholder="詳細（任意）" rows={4} className="f-sans" style={taStyle} />
                    </div>
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>報告は運営のみが確認します。相手にはあなたの情報は伝わりません</p>
                  </>
                )}
                {st.genre === "screen" && (
                  <>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
                      {FEEDBACK_CATEGORIES.map(c => (
                        <button key={c.v} type="button" onClick={() => setCategory(c.v)} className="f-sans" style={{
                          padding:"7px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", border:"2px solid",
                          borderColor: category===c.v ? "#00A86B" : "#EBEBEB",
                          background: category===c.v ? "#E6F7EF" : "#fff", color: category===c.v ? "#00A86B" : "#222",
                        }}>{c.l}</button>
                      ))}
                    </div>
                    <textarea value={detail} onChange={e => setDetail(e.target.value)} placeholder="どの部分が、どうでしたか？" rows={4}
                      className="f-sans" style={{ ...taStyle, marginBottom:8 }} />
                    <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>操作の記録としてページ名が運営に送られます</p>
                  </>
                )}
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={close} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submit} disabled={sending || !canSend} className="f-sans" style={{
                    padding:"9px 18px", fontSize:13, fontWeight:700, border:"none", borderRadius:10, cursor:"pointer",
                    background: canSend ? (st.genre === "screen" ? "#00A86B" : "#E24B4A") : "#EBEBEB",
                    color: canSend ? "#fff" : "#717171",
                  }}>{sending ? "送信中..." : "送信する"}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
