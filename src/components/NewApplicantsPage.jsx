// 新着の応募ページ（#/new-applicants・2026-08-05たきと指示「応募を受けた農家さん専用のページ。
// 応募を受けた直後からサイトに入るとトップ画面がこのページになる」）。
//
// ■役割：応募が届いた雇い手が、サイトを開いた瞬間に最初に見る面。未対応の応募（status='applied'）が
//   1件でもあれば App.jsx のトップページ着地がここへ送る（まもなく開始ページ #/admin/upcoming と同じ作法）。
//   決めてしまえば（承認・見送り）該当がゼロになり、着地は自然に止む＝記録から導出（表示用の別状態を持たない）。
// ■【読み取り専用】：承認・見送り・採用の実行は応募者シート（FarmerDashboard の renderApplicantCard）が
//   唯一の窓口ので、このページは「見せる」と「そこへ送る」だけに徹する。書き込みの入口を増やさない
//   （＝ゲート・記録・二重予約警告などの担保を1箇所に保つ）。
// ■本名・連絡先は出さない：契約成立前ので ContractPartyName / ContractEmergencyContact は置かない
//   （2026-07-30裁定(B)・2026-08-03緊急連絡先＝どちらも採用成立後の当事者間のみ）。
// ■データ：既存RPC2本（my_farm_applicants・my_farm_jobs／どちらもSECURITY INVOKER＝RLSそのまま）を
//   並列で1往復。新しいDBオブジェクトは作らない。
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { photoThumb, fmtJstShort } from "../lib/utils";
import { getCache, setCache } from "../lib/viewCache";
import { Dots, NoticeJumpText } from "./ui";
import { AvailDatesChips } from "./DateChips";
import { WorkerTrustCard } from "./TrustCards";

// 応募者シートを開くための着地フラグ（応募者ページ側 FarmerDashboard が cb_openApplicantId を消費する）。
// 今日ページの cb_completeAppId / cb_agreeAppId と同じ作法＝どの応募のシートを開くかだけを渡す
function goApplicantSheet(applicationId) {
  try {
    sessionStorage.setItem("cb_appFilter", "applied");
    sessionStorage.setItem("cb_openApplicantId", applicationId);
  } catch {}
  window.location.hash = "/profile/employer/applicants";
}

// お祝いの花びら（記録キー cb_celebratedApps＝一度見た応募では舞わない）。
// はじめて見る応募が含まれる時だけ舞う＝再訪では静か。※モジュールレベル定義を維持すること
function Petals({ ids }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      const seen = new Set(JSON.parse(localStorage.getItem("cb_celebratedApps") || "[]"));
      if (ids.some(id => id && !seen.has(id))) {
        setOn(true);
        ids.forEach(id => { if (id) seen.add(id); });
        localStorage.setItem("cb_celebratedApps", JSON.stringify([...seen].slice(-200)));
      }
    } catch { setOn(true); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 初回の判定のみ（再描画で舞い直さない）
  if (!on) return null;
  return (
    <div aria-hidden style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
      <style>{`@keyframes cbPetalFall{0%{transform:translateY(0) rotate(0deg);opacity:0}12%{opacity:1}100%{transform:translateY(360px) rotate(230deg);opacity:0}}`}</style>
      {Array.from({ length: 14 }).map((_, i) => (
        <span key={i} style={{ position:"absolute", top:-24, left: ((i * 29 + 7) % 96) + "%", fontSize: 13 + (i % 3) * 4, opacity:0, animation: `cbPetalFall ${1.9 + (i % 5) * 0.25}s ease-in ${(i % 7) * 0.13}s forwards` }}>🌸</span>
      ))}
    </div>
  );
}

// 応募1件のカード。上段＝左に求人のトップ写真（タイトル・#No.を下部に重ねる＝緊急連絡ページ・
// ステータスページと同じ作法）／右にこの応募の段階・届いた時刻・仕事の日程。
// 下段＝応募者の信頼カード（顔・名前・実績・自己申告）と来られる日、そして決めるための導線
function ApplicantCard({ app, job, profile, trust }) {
  const title = [job.crop, job.task].filter(Boolean).join(" ") || `求人 #${app.job_number}`;
  const photo = photoThumb(job.photos?.[0]);
  const openJob = () => {
    try { sessionStorage.setItem("cb_jobBackTo", "/new-applicants"); } catch {}
    window.location.hash = "/work/job/" + app.job_number;
  };
  return (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"stretch" }}>
        <button onClick={openJob} aria-label="求人を見る" className="f-sans"
          style={{ flexShrink:0, width:104, aspectRatio:"3 / 4", padding:0, border:"none", borderRight:"1px solid #F0F0F0", background:"#F2F2F2", cursor:"pointer", position:"relative", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, textAlign:"left" }}>
          {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "🌱"}
          <span style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 8px 7px", background:"linear-gradient(transparent, rgba(0,0,0,0.72))", boxSizing:"border-box" }}>
            <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>{title}</span>
            <span style={{ display:"block", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.82)", marginTop:1, textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>#{app.job_number}</span>
          </span>
        </button>
        {/* 右＝「いつ応募がが届いたか」だけ（2026-08-11たきと指示：応募中チップ・求人の日程/勤務時間は削除）。
            日程はタップ先の求人詳細がが持つ＝同じ事実を2画面に置かない。
            応募者の顔・名前は下の信頼カードがが持つ（応募者シートと同じ＝出どころを二重に持たない） */}
        <div style={{ flex:1, minWidth:0, padding:"14px 16px", display:"flex", flexDirection:"column", justifyContent:"center", gap:4 }}>
          <span className="f-sans" style={{ fontSize:11, color:"#999" }}>応募が届いた日</span>
          <span className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222" }}>{fmtJstShort(app.created_at)}</span>
        </div>
      </div>
      <div style={{ padding:"12px 14px 14px", borderTop:"1px solid #F5F5F5" }}>
        {/* 応募者の情報＝応募者ページのシートと同じ部品（公開してよい項目だけを出す唯一のソース）。
            本名・連絡先は契約成立後の当事者間のみので、ここには出さない（2026-07-30裁定(B)・2026-08-03） */}
        <WorkerTrustCard profile={profile || {}} trust={trust} />
        {/* 来られる日（期間求人・すり合わせの起点）。'any'・未宣言は部品側で非表示 */}
        <div style={{ marginTop:10 }}><AvailDatesChips value={app.available_dates} /></div>
        <div style={{ display:"grid", gap:8, marginTop:10 }}>
          <button onClick={()=>goApplicantSheet(app.id)} className="f-sans"
            style={{ padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>
            内容を見て決める（承認・見送り）→
          </button>
          <button onClick={openJob} className="f-sans"
            style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#555", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>
            応募があった求人を見る
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewApplicantsPage() {
  // 前回内容があれば読み込み中を出さず即描画し、裏で最新に差し替える（viewCacheのSWR・2026-08-02）
  const [state, setState] = useState(() => getCache("newApplicants") ?? null); // null=読み込み中 | {apps,profiles,trust,jobs} | "error"
  const load = useCallback(async () => {
    try {
      // 依存の無い2本は並列（rpcのthenableはPromise.resolveで包む・2026-07-26教訓）
      const [{ data: bundle, error }, { data: jobsBundle }] = await Promise.all([
        Promise.resolve(supabase.rpc("my_farm_applicants")),
        Promise.resolve(supabase.rpc("my_farm_jobs")),
      ]);
      if (error || !bundle) { setState(prev => (prev && typeof prev === "object") ? prev : "error"); return; }
      // 新着＝まだ決めていない応募だけ（承認・見送りを済ませたものはここから消える）。届いた順に新しい方から
      const apps = (bundle.apps || []).filter(a => a.status === "applied")
        .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
      const profiles = {}; (bundle.profiles || []).forEach(wp => { profiles[wp.auth_id] = wp; });
      const trust = {}; Object.entries(bundle.trust || {}).forEach(([wid, v]) => { if (v && v.ok) trust[wid] = v; });
      const jobs = {};
      (jobsBundle?.jobs || []).forEach(j => {
        jobs[j.job_number] = { crop:j.crop, task:j.task, photos:j.photos, date_start:j.date_start, date_end:j.date_end, date_label:j.date_label, work_time:j.work_time };
      });
      const next = { apps, profiles, trust, jobs };
      setCache("newApplicants", next);
      // 応募者ページと同じキャッシュにも配って、そちらの初回描画も速くする（同じ形・同じ中身）
      setCache("farm:wp", profiles);
      setState(next);
    } catch { setState(prev => (prev && typeof prev === "object") ? prev : "error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const apps = (state && typeof state === "object") ? state.apps : [];

  return (
    // 左右を広く取る（2026-08-11たきと指示）＝最大幅を広げ、左右の余白を6pxまで詰める。
    // 下部バー・☰・サイトフッターは出さない（cb-new-applicants-page＝appStyles）ので下の余白も詰める
    <div className="appear cb-new-applicants-page" style={{ maxWidth:900, margin:"0 auto", padding:"20px 6px 28px" }}>
      {state === null && (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
      )}
      {state === "error" && (
        <p className="f-sans" style={{ textAlign:"center", color:"#E24B4A", fontSize:13, padding:"48px 0" }}>読み込みに失敗しました。ページを開き直してください</p>
      )}

      {state && typeof state === "object" && (apps.length === 0 ? (
        // 空でも説明を明記する（2026-08-03たきと指示「なにもなければ説明文を明記」）
        <div style={{ textAlign:"center", padding:"56px 8px" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📩</div>
          <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:"0 0 8px" }}>いま新しい応募はありません</p>
          <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, margin:"0 auto", maxWidth:420 }}>
            あなたの求人に応募が届くと、このページが最初に開きます。ここで応募者を見て、承認するか見送るかを決めます。
          </p>
          <button onClick={()=>{ window.location.hash = "/profile/employer/applicants"; }} className="f-sans"
            style={{ marginTop:20, padding:"11px 20px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>
            応募者ページへ →
          </button>
        </div>
      ) : (
        <>
          <div style={{ position:"relative", padding:"6px 0 18px" }}>
            <Petals ids={apps.map(a => a.id)} />
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", textAlign:"center", margin:"0 0 6px" }}>
              <NoticeJumpText text={`🎉 ${apps.length}件の応募が届きました`} />
            </p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", lineHeight:1.8, margin:0 }}>
              応募者を見て、承認するか見送るかを決めてください。<br />承認すると、チャットで面接に進めます。
            </p>
          </div>
          <div style={{ display:"grid", gap:14 }}>
            {apps.map(a => (
              <ApplicantCard key={a.id} app={a} job={state.jobs[a.job_number] || {}}
                profile={state.profiles[a.worker_id]} trust={state.trust[a.worker_id]} />
            ))}
          </div>
          <button onClick={()=>{ window.location.hash = "/profile/employer"; }} className="f-sans"
            style={{ display:"block", margin:"22px auto 0", background:"none", border:"none", fontSize:12, fontWeight:700, color:"#999", textDecoration:"underline", cursor:"pointer" }}>
            あとで見る
          </button>
        </>
      ))}
    </div>
  );
}
