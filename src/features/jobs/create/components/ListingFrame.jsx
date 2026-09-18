import { NavIcon } from "../../../../components/NavIcons";

export const LISTING_STAGES = [
  { title: "基本情報", description: "作物・作業・場所と、日程・勤務条件を決めます。", icon: "edit" },
  { title: "仕事の詳細", description: "写真や説明を加えて、当日の仕事を伝えます。", icon: "camera" },
  { title: "確認・掲載", description: "働き手に見える内容を確認して、募集を始めます。", icon: "tick" },
];

export function listingStage(step) {
  return step >= 11 ? 2 : step >= 6 ? 1 : 0;
}

export function ListingHeader({ step, saving, busy, onSave, onExit }) {
  return (
    <header className="listing-header">
      <span className="listing-brand">chitose-bank</span>
      <span className="listing-header-title">求人の掲載</span>
      <button type="button" className="listing-save" onClick={step === 0 ? onExit : onSave} disabled={busy}>
        {saving ? "保存中…" : step === 0 ? "終了" : "保存して終了"}
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

export function ListingFooter({ step, canNext, busy, uploading, returnToConfirm, editingOpen, onBack, onNext, onSkipDetails, onPublish, hidden }) {
  const stage = listingStage(step);
  const progress = [Math.min(step / 6, 1), Math.max(0, Math.min((step - 6) / 5, 1)), step >= 11 ? 0.5 : 0];
  return (
    <footer className="listing-footer" hidden={hidden}>
      <ol className="listing-progress" aria-label="求人掲載の進捗">
        {LISTING_STAGES.map((item, index) => (
          <li key={item.title} aria-current={index === stage ? "step" : undefined}>
            <span className="listing-progress-track" aria-hidden="true"><span style={{ width: `${progress[index] * 100}%` }} /></span>
            <span className="listing-progress-label">{index + 1}<span>{item.title}</span></span>
          </li>
        ))}
      </ol>
      <div className="listing-footer-actions">
        <button type="button" className="listing-back" onClick={onBack} disabled={busy}>{step === 0 ? "閉じる" : returnToConfirm ? "確認に戻る" : "戻る"}</button>
        <div className="listing-forward">
          {!returnToConfirm && step >= 6 && step <= 10 && (
            <button type="button" className="listing-skip" onClick={onSkipDetails} disabled={busy}>あとで追加</button>
          )}
          <button type="button" className={`listing-next${step === 11 ? " listing-publish" : ""}`}
            onClick={step === 11 ? onPublish : onNext}
            disabled={busy || (step !== 11 && !canNext)} data-guide="flow-next">
            {uploading ? "アップロード中…" : step === 0 ? "はじめる" : step === 11 ? (editingOpen ? "変更を保存" : "掲載する") : returnToConfirm ? "確認に戻る" : step === 10 ? "確認へ" : "次へ"}
          </button>
        </div>
      </div>
    </footer>
  );
}
