import { lfStyles } from "../lfStyles";
import { PUBLISH_CHECKS } from "../../../../lib/utils";
import { RECRUITER_FIELDS } from "../listingPublicationPages";

export function ListingRecruiterPage({ pageId, state }) {
  const field = RECRUITER_FIELDS[pageId];
  return <section className="listing-publication-section">
    <h2 className="f-sans" style={lfStyles.stepTitle}>{field.title}</h2>
    <p className="f-sans" style={lfStyles.subtitle}>{pageId === "smoking_policy" ? "働く場所の喫煙に関する設定を確認してください。" : "求人に表示する募集者情報です。登録済みの情報を使えます。"}</p>
    <p className="listing-condition-note">下部の保存ボタンでプロフィールに反映します。この設定はほかの求人にも使われます。ここでは求人を掲載しません。</p>
    {state.status === "loading" && <p role="status">登録情報を確認しています…</p>}
    {state.error && <p role="alert" className="listing-publication-error">{state.error}</p>}
    {state.status !== "ready" && <button type="button" className="listing-back" disabled={state.busy || state.status === "loading"} onClick={state.reload}>登録情報を再確認</button>}
    <fieldset disabled={state.busy} className="listing-publication-fields">
      {pageId === "smoking_policy" ? <>
        <div className="listing-choice-grid" role="group" aria-label={field.label}>
          {["禁煙（喫煙場所なし）", "喫煙場所あり"].map(value => <button key={value} type="button" className={`listing-choice-card${state.values.smoking_policy === value ? " is-selected" : ""}`} aria-pressed={state.values.smoking_policy === value} onClick={() => state.change("smoking_policy", value)}>{value}</button>)}
        </div>
        {state.values.smoking_policy && !["禁煙（喫煙場所なし）", "喫煙場所あり"].includes(state.values.smoking_policy) && <p>現在の登録：{state.values.smoking_policy}</p>}
        {state.values.smoking_policy === "喫煙場所あり" && <label className="listing-publication-label">喫煙場所の説明<input className="field f-sans" value={state.values.smoking_area} onChange={e => state.change("smoking_area", e.target.value)} maxLength={100} /></label>}
      </> : <>
        <label htmlFor={`listing-${pageId}`} className="listing-publication-label">{field.label}</label>
        <input id={`listing-${pageId}`} className="field f-sans" value={state.values[pageId]} onChange={e => state.change(pageId, e.target.value)} placeholder={field.placeholder} maxLength={field.maxLength} autoComplete="off" />
        <button type="button" className="listing-back" onClick={() => state.useRegistration(pageId)}>新規登録の情報から入力</button>
      </>}
      {state.draft[pageId] && state.status === "ready" && <button type="button" className="listing-back" onClick={() => state.useLatest(pageId)}>最新の登録内容を使う</button>}
    </fieldset>
  </section>;
}

export function ListingPublishConsent({ editingOpen, confirmed, onConfirm, issue, busy }) {
  return <section className="listing-publication-section">
    <h2 className="f-sans" style={lfStyles.stepTitle}>{editingOpen ? "変更内容を確認しましょう" : "掲載前に確認しましょう"}</h2>
    <p className="f-sans" style={lfStyles.subtitle}>{editingOpen ? "公開中の求人の内容を更新します。" : "同意して掲載すると、働き手に公開されます。"}</p>
    <ul className="listing-publication-checks">{PUBLISH_CHECKS.map(text => <li key={text}>{text}</li>)}</ul>
    {issue && <p role="alert" className="listing-publication-error">{issue}</p>}
    <label className="listing-publication-consent">
      <input id="listing-publish-confirmed" type="checkbox" checked={confirmed} disabled={busy} onChange={e => onConfirm(e.target.checked)} />
      <span>確認しました</span>
    </label>
    <p className="listing-condition-note">チェックを入れるだけでは掲載されません。下の「{editingOpen ? "変更を保存する" : "同意して掲載する"}」で確定します。</p>
  </section>;
}
