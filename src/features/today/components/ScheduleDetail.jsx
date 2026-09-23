import { Suspense, useEffect, useState } from "react";
import { lazyChunk } from "../../../app/chunkReload";
import { NavIconInline } from "../../../components/NavIcons";
import { APP_PHASE_LABEL, APP_PHASE_DESC, APP_PHASE_COLOR, CHAT_LIST_STATUSES, ROLE_GREEN, ROLE_ORANGE, calFmtDate, photoThumb, workDaysStripData } from "../../../lib/utils";
import { schedulePath, schedulePhase } from "../schedule";
import { useScheduleEntries } from "../useScheduleEntries";
import "./ScheduleDetail.css";

const LaborConditionsNotice = lazyChunk(() => import("../../../components/LaborConditionsNotice"));

export function ScheduleDetail({ me, role, applicationId }) {
  const { entries, loading, error, reload } = useScheduleEntries();
  const [noticeOpen, setNoticeOpen] = useState(false);
  // マイページ下部から開いても、予定詳細の先頭へ着地させる。
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [applicationId]);
  // 求人番号では照合しない。同じ求人の別の相手へすり替わるのを防ぐ。
  const entry = entries.find(e => e.relation === "application" && e.my_role === role && e.application_id === applicationId);
  const home = role === "farmer" ? "/profile/employer" : "/profile/worker";
  const phase = entry ? schedulePhase(entry) : null;
  const { days, label } = workDaysStripData(entry, entry);
  const photo = photoThumb(entry?.photos?.[0]);
  const hasNotice = entry?.terms_confirmed_worker_at && entry?.terms_confirmed_farmer_at;
  const openJob = () => {
    try { sessionStorage.setItem("cb_jobBackTo", schedulePath(role, applicationId)); } catch {}
    window.location.hash = "/work/job/" + entry.job_number;
  };
  const openApplicant = () => {
    try {
      sessionStorage.setItem("cb_appFilter", phase);
      sessionStorage.setItem("cb_openApplicantId", applicationId);
    } catch {}
    window.location.hash = "/profile/employer/applicants";
  };

  return (
    <section className="schedule-detail f-sans" style={{ "--schedule-accent": role === "farmer" ? ROLE_GREEN : ROLE_ORANGE }} aria-labelledby="schedule-heading">
      <header className="schedule-header">
        <button type="button" className="schedule-back" aria-label="マイページに戻る" onClick={() => { window.location.hash = home; }}>‹</button>
        <h1 id="schedule-heading">予定の詳細</h1>
      </header>

      {error && <div className="schedule-feedback" role="status">
        <p>{entry ? "最新の予定を取得できませんでした。前回の内容を表示しています。" : "予定を読み込めませんでした。通信状況を確認して、もう一度お試しください。"}</p>
        <button type="button" onClick={reload}>再読み込み</button>
      </div>}
      {!entry ? <p className="schedule-empty" role="status">{loading ? "予定を読み込み中…" : error ? "" : "この予定は表示できません。取り消しなどで予定が変わった可能性があります。マイページから最新の予定をご確認ください。"}</p> : <>
        <div className="schedule-summary">
          <div>
            <span className="schedule-phase" style={{ color: APP_PHASE_COLOR[phase] }}>{APP_PHASE_LABEL[phase]}</span>
            <h2>{[entry.crop, entry.task].filter(Boolean).join(" ") || "作業の予定"}</h2>
            <p className="schedule-muted">求人 #{entry.job_number}{entry.town ? ` · ${entry.town}` : ""}</p>
          </div>
          {photo && <img className="schedule-photo" src={photo} alt="" />}
        </div>
        <p className="schedule-phase-description">{APP_PHASE_DESC[phase]}</p>

        <section className="schedule-section" aria-labelledby="schedule-dates-heading">
          <h2 id="schedule-dates-heading">{label}</h2>
          <div className="schedule-facts">
            <NavIconInline name="calendar" size={22} />
            <div>
              <p className="schedule-value">{days.length ? days.slice(0, 3).map(calFmtDate).join("・") : "日程を確認中"}</p>
              {days.length > 3 && <details className="schedule-all-dates"><summary>すべての日程（{days.length}日）</summary><p>{days.map(calFmtDate).join("・")}</p></details>}
              {["applied", "interview"].includes(phase) && <p className="schedule-muted">採用前の予定です。日程はチャットで確認してください。</p>}
            </div>
          </div>
          <div className="schedule-facts">
            <NavIconInline name="clock" size={22} />
            <div><p className="schedule-muted">勤務時間</p><p className="schedule-value">{entry.work_time || "勤務時間を確認中"}</p></div>
          </div>
        </section>

        <section className="schedule-section" aria-labelledby="schedule-partner-heading">
          <div className="schedule-partner">
            <span className="schedule-avatar"><NavIconInline name="profile" size={26} /></span>
            <div><p className="schedule-muted">{role === "farmer" ? "働き手" : "募集主"}</p><h2 id="schedule-partner-heading">{entry.partner_name || "お名前を確認中"}</h2></div>
          </div>
          {CHAT_LIST_STATUSES.includes(entry.application_status) && <a className="schedule-message" href={`#/chat/${applicationId}`} data-prefetch-route={`/chat/${applicationId}`}>
            <NavIconInline name="chats" size={20} />メッセージを送る
          </a>}
        </section>

        <section className="schedule-section" aria-label="関連する情報">
          {role === "farmer" && <button type="button" className="schedule-link" onClick={openApplicant}><span>応募内容・採用の手続きを確認</span><span aria-hidden="true">›</span></button>}
          {hasNotice && <button type="button" className="schedule-link" onClick={() => setNoticeOpen(true)}><span>労働条件通知書を確認</span><span aria-hidden="true">›</span></button>}
          <button type="button" className="schedule-link" onClick={openJob}><span>求人の内容を見る</span><span aria-hidden="true">›</span></button>
        </section>
        {noticeOpen && hasNotice && <Suspense fallback={<p role="status">通知書を読み込み中…</p>}><LaborConditionsNotice me={me} role={role} applicationId={applicationId} onClose={() => setNoticeOpen(false)} /></Suspense>}
      </>}
    </section>
  );
}
