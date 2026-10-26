import { TASK_CHANGE_OPTIONS, PLACE_CHANGE_OPTIONS } from "../../../../lib/utils";
import { ListingChoiceCards } from "./ListingChoiceCards";
import { lfStyles } from "../lfStyles";

export function StepTaskScope({ value, onChange }) {
  return <>
    <h2 style={lfStyles.stepTitle}>作業の変更の範囲を選びましょう</h2>
    <p style={lfStyles.subtitle}>募集期間の途中で、お願いする作業が変わる可能性のある範囲を選んでください。</p>
    <ListingChoiceCards label="作業の変更の範囲" options={TASK_CHANGE_OPTIONS} value={value} onChange={onChange} />
  </>;
}
export function StepPlaceScope({ value, onChange }) {
  return <>
    <h2 style={lfStyles.stepTitle}>場所の変更の範囲を選びましょう</h2>
    <p style={lfStyles.subtitle}>募集期間の途中で、働く場所が変わる可能性のある範囲を選んでください。</p>
    <ListingChoiceCards label="場所の変更の範囲" options={PLACE_CHANGE_OPTIONS} value={value} onChange={onChange} />
  </>;
}
const COMMUTE_OPTIONS = ["徒歩5分以内", "徒歩10分以内", "車5分以内", "車10分以内", "車20分以内"];
export function StepAccess({ station, setStation, commute, setCommute }) {
  return <>
    <h2 style={lfStyles.stepTitle}>集合場所への行き方を伝えましょう</h2>
    <p style={lfStyles.subtitle}>最寄り駅からの移動の目安を入力できます。任意の項目なので、あとから追加することもできます。</p>
    <div className="listing-topic-fields">
      <label className="listing-condition-field" htmlFor="listing-nearest-station">最寄り駅
        <input id="listing-nearest-station" value={station} onChange={e => setStation(e.target.value)} placeholder="例：阿波山川" />
      </label>
      <label className="listing-condition-field" htmlFor="listing-commute-time">駅からの移動時間
        <select id="listing-commute-time" value={commute} onChange={e => setCommute(e.target.value)}>
          <option value="">選択してください</option>
          {commute && !COMMUTE_OPTIONS.includes(commute) && <option value={commute}>{commute}</option>}
          {COMMUTE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  </>;
}
