import { Avatar } from "../../../components/ui";
import { NavIcon } from "../../../components/NavIcons";
import { WorkDaysStrip } from "../../../components/WorkDaysStrip";
import ContractEmergencyContact from "../../../components/ContractEmergencyContact";
import {
  appPhaseKey, appPhaseLabelNow, appPhaseColorNow, APP_PHASE_DESC,
  calFmtDate, dayReportOpen, isFinalWorkDone, isWorkWindowOpen,
  photoThumb, workDaysStripData, ymdLocal,
} from "../../../lib/utils";
import "./ApplicantCard.css";

// 表示だけを担当する。採用・保険・評価・通知書は既存の窓口へ応募IDを渡す。
export function ApplicantCard({
  application: app, job = {}, jobNumber, profile, needsAttention = false,
  reviewed = false, hiddenCount = 0, progress,
  onOpenWorker, onOpenJob, onOpenDetails, onChat, onHire, onInsurance,
  onReview, onReport, onNotice,
}) {
  const phase = app ? appPhaseKey(app) : null;
  const closed = ["rejected", "expired", "canceled"].includes(phase);
  const canChat = ["interview", "contracted", "working", "completed"].includes(phase);
  const canReadNotice = ["contracted", "working", "completed"].includes(phase);
  const title = [job.crop, job.task].filter(Boolean).join(" ") || `求人 #${jobNumber}`;
  const name = profile?.nickname || "未設定";
  const photo = photoThumb(job.photos?.[0]);
  const entry = { ...app, date_start: job.date_start, date_end: job.date_end, holidays: job.holidays, work_time: job.work_time };
  const phaseLabel = app ? appPhaseLabelNow(app, entry) : null;
  const phaseColor = app ? appPhaseColorNow(app, entry) : "#717171";
  const schedule = workDaysStripData(app, job);
  const today = ymdLocal(new Date());
  const focusDay = schedule.days.find(day => day >= today) || schedule.days.at(-1);
  const multiDay = schedule.days.length > 1;
  const dateLabel = focusDay ? calFmtDate(focusDay) : "日程を確認してください";
  const datePrefix = multiDay ? (focusDay === today ? "今日 " : focusDay > today ? "次回 " : "最終日 ") : "";

  // 従来のカードと同じ順序・同じ共通関数で操作を判定する。
  // 日程の「表示」は希望日も見るが、評価可否は契約上の最終日で判定する。
  let action = null;
  let doneText = null;
  if (phase === "applied") {
    action = { label: "応募内容を確認", onClick: () => onOpenDetails(app) };
  } else if (phase === "interview") {
    action = { label: "採用する", onClick: () => onHire(app) };
  } else if (phase === "completed") {
    if (app.attended === false) doneText = "欠勤記録済み";
    else if (reviewed) doneText = "評価済み";
    else action = { label: "評価する", onClick: () => onReview(app) };
  } else if (phase === "contracted" || phase === "working") {
    if (isFinalWorkDone(app, job)) {
      if (reviewed) doneText = "評価済み";
      else action = { label: "評価する", onClick: () => onReview(app) };
    } else if (phase !== "working" && !app.started_at) {
      if (app.insurance_prepared_at) doneText = "保険 報告済み";
      else action = { label: "保険の報告", onClick: () => onInsurance(app.id) };
    } else {
      action = { label: "今日の記録", disabled: !dayReportOpen(app, job), onClick: () => onReport(app) };
    }
  }

  return (
    <article className="cb-app-jobcard applicant-card f-sans" data-application-id={app?.id}
      aria-label={app ? `${name}さんの応募・求人 #${jobNumber}` : `求人 #${jobNumber}`}>
      {app && <div className="applicant-card-person-row">
          <button type="button" className="applicant-card-person" onClick={() => onOpenWorker(app.worker_id)}
            aria-label={`${name}さんのプロフィールを見る`}>
            <Avatar url={profile?.avatar_url} name={name} size={48} />
            <span className="applicant-card-identity">
              <span className="applicant-card-name">{name}<span>さん</span></span>
              <span className="applicant-card-status-row">
                <span className="applicant-card-status" style={{ "--phase-color": phaseColor }}>
                  <span aria-hidden="true" />{phaseLabel}
                </span>
                {needsAttention && !closed && <span className="applicant-card-attention">要対応</span>}
              </span>
            </span>
          </button>
          {!closed && phase !== "completed" && <button type="button" className="applicant-card-detail"
            onClick={() => onOpenDetails(app)}>応募詳細<span aria-hidden="true"> ›</span></button>}
        </div>}

      <div className="applicant-card-schedule">
        <div className="applicant-card-schedule-label"><NavIcon name="calendar" size={16} />
          {schedule.label}{multiDay && <span>全{schedule.days.length}日</span>}
        </div>
        <div className="applicant-card-when">
          <strong>{datePrefix}{focusDay ? <time dateTime={focusDay}>{dateLabel}</time> : dateLabel}</strong>
          {job.work_time && <span>{job.work_time}</span>}
        </div>
        {multiDay && <details className="applicant-card-dates">
          <summary>すべての日程を見る</summary>
          <WorkDaysStrip days={schedule.days} label={schedule.label} accent="#008A58" />
        </details>}
      </div>

      <button type="button" className="applicant-card-job" onClick={() => onOpenJob(jobNumber)}
        aria-label={`${title}・求人 #${jobNumber}を見る`}>
        {photo ? <img src={photo} alt="" loading="lazy" decoding="async" />
          : <span className="applicant-card-job-placeholder" aria-hidden="true"><NavIcon name="postJob" size={24} /></span>}
        <span className="applicant-card-job-copy"><strong>{title}</strong><span>求人 #{jobNumber}</span></span>
        <span aria-hidden="true">›</span>
      </button>

      {!app ? <p className="applicant-card-empty">{hiddenCount > 0
        ? "この求人の応募者は、絞り込みで非表示になっています。"
        : "この求人への応募はまだありません。"}</p>
        : closed ? <p className="applicant-card-closed">{APP_PHASE_DESC[phase]}</p>
        : <div className="applicant-card-actions">
          {phase === "applied" && <p className="applicant-card-hint">プロフィールと来られる日を確認して、承認・見送りを決めます。</p>}
          {doneText && <p className="applicant-card-done"><NavIcon name="tick" size={15} />{doneText}</p>}
          <div className="applicant-card-action-row">
            {action && <button type="button" className="applicant-card-primary" disabled={!!action.disabled}
              onClick={action.onClick}>{action.label}</button>}
            {canChat && <button type="button" className="applicant-card-secondary" onClick={() => onChat(app.id)}>
              <NavIcon name="chats" size={17} />チャット</button>}
          </div>
          {action?.disabled && <p className="applicant-card-hint">記録できるのは作業開始から終了の3時間後までです。</p>}
          {canReadNotice && <>
            <ContractEmergencyContact applicationId={app.id} asButton style={{ margin: 0 }} workWindow={isWorkWindowOpen(app)} />
            <button type="button" className="applicant-card-notice" onClick={() => onNotice(app.id)}>
              <NavIcon name="book" size={18} /><span>労働条件通知書</span><span aria-hidden="true">›</span>
            </button>
          </>}
          {progress && <details className="applicant-card-progress">
            <summary>応募の進み具合</summary>
            {progress}
          </details>}
        </div>}
    </article>
  );
}
