import { NavIcon } from "../../../../components/NavIcons";
import { LISTING_STAGE_INFO, listingFrameState } from "../flowSteps.js";
import "../listingControls.css";

export const LISTING_STAGES = LISTING_STAGE_INFO;
export function listingStage(step) { return listingFrameState(step).stage; }

export function ListingHeader({ step, saving, busy, onSave, onExit, autoHidden = false }) {
  const frame = listingFrameState(step);
  const canSave = !frame.intro && typeof onSave === "function";
  const onAction = canSave ? onSave : onExit;
  const actionLabel = canSave ? (saving ? "保存中…" : "保存して終了") : frame.intro ? "終了" : "閉じる";
  return (
    <header className={`listing-header${autoHidden ? " listing-review-bar-collapsed" : ""}`}>
      <span className="listing-brand">chitose-bank</span>
      <span className="listing-header-title">求人の掲載</span>
      <button type="button" className="listing-save" onClick={onAction} disabled={busy || typeof onAction !== "function"}>
        {actionLabel}
      </button>
    </header>
  );
}

export function ListingIntro() {
  return (
    <div className="listing-intro" data-guide="flow-intro">
      <div>
        <p className="listing-eyebrow">求人の掲載</p>
        <h1>あなたの仕事を、<br />必要としている人へ。</h1>
        <p className="listing-intro-description">3つのステップで、求人をつくりましょう。</p>
      </div>
      <ol className="listing-stage-list">
        {LISTING_STAGES.map((stage, index) => (
          <li key={stage.title}>
            <span className="listing-stage-number">{index + 1}</span>
            <div><h2>{stage.title}</h2><p>{stage.description}</p></div>
            <NavIcon name={stage.icon} size={32} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ListingDetailsIntro({ crop, task, region, dates, wage }) {
  return (
    <div className="listing-intro listing-details-intro">
      <div>
        <p className="listing-eyebrow">ステップ2</p>
        <h1>仕事の様子を<br />伝えましょう。</h1>
        <p className="listing-intro-description">写真や説明で、働く一日をイメージしやすく。<br />詳しい情報は、あとからでも追加できます。</p>
      </div>
      <div className="listing-outline">
        <p className="listing-eyebrow">ここまでの入力内容</p>
        <h2>{[crop, task].filter(Boolean).join("の") || "作成中の求人"}</h2>
        <dl>
          <div><dt>場所</dt><dd>{region || "未入力"}</dd></div>
          <div><dt>日程</dt><dd>{dates}</dd></div>
          <div><dt>日給</dt><dd>{wage > 0 ? `${wage.toLocaleString()}円` : "未入力"}</dd></div>
        </dl>
      </div>
    </div>
  );
}

export function ListingFooter({ step, canNext, busy, uploading, returnToConfirm, editingOpen, publishDisabled = false, onBack, onNext, onSkipDetails, onPublish, hidden, nextLabel, backLabel, autoHidden = false }) {
  const frame = listingFrameState(step);
  return (
    <footer className={`listing-footer${autoHidden ? " listing-review-bar-collapsed" : ""}`} hidden={hidden}>
      <ol className="listing-progress" aria-label="求人掲載の進捗">
        {LISTING_STAGES.map((item, index) => (
          <li key={item.title} aria-current={index === frame.stage ? "step" : undefined}>
            <span className="listing-progress-track" aria-hidden="true"><span style={{ width: `${frame.progress[index] * 100}%` }} /></span>
            <span className="listing-progress-label">{index + 1}<span>{item.title}</span></span>
          </li>
        ))}
      </ol>
      <div className="listing-footer-actions">
        <button type="button" className="listing-back" onClick={onBack} disabled={busy}>{backLabel || (frame.intro ? "閉じる" : returnToConfirm ? "確認に戻る" : "戻る")}</button>
        <div className="listing-forward">
          {!returnToConfirm && frame.skipDetails && (
            <button type="button" className="listing-skip" onClick={onSkipDetails} disabled={busy}>あとで追加</button>
          )}
          <button type="button" className="listing-next"
            onClick={frame.review ? onPublish : onNext}
            disabled={!frame.valid || busy || (frame.review ? publishDisabled : !canNext)} data-guide="flow-next">
            {uploading ? "アップロード中…" : busy ? "保存中…" : nextLabel || (frame.intro ? "はじめる" : frame.review ? (editingOpen ? "変更を保存" : "掲載する") : returnToConfirm ? "確認に戻る" : frame.lastDetail ? "確認へ" : "次へ")}
          </button>
        </div>
      </div>
    </footer>
  );
}
