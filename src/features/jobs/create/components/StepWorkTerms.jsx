import { OVERTIME_OPTIONS } from "../../../../lib/utils";
import { digitsOnly } from "../jobInputCodec";
import { LFWageCompare } from "./LFParts";
import { ListingChoiceCards } from "./ListingChoiceCards";
import { lfStyles } from "../lfStyles";

const timeValue = (hour, minute) => hour !== "" && minute !== "" ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : "";
export function StepWorkTime({ startHour, startMinute, endHour, endMinute, onStart, onEnd, label, raw, workHours }) {
  return <>
    <h2 style={lfStyles.stepTitle}>勤務時間を決めましょう</h2>
    <p style={lfStyles.subtitle}>作業を始める時間と、終える時間を入力してください。</p>
    <div className="listing-topic-fields">
      <div className="listing-work-time-fields">
        <label>開始時間<input type="time" aria-label="勤務開始時間" value={timeValue(startHour, startMinute)} onChange={e => onStart(e.target.value)} /></label>
        <label>終了時間<input type="time" aria-label="勤務終了時間" value={timeValue(endHour, endMinute)} onChange={e => onEnd(e.target.value)} /></label>
      </div>
      <p className="listing-condition-note">{label || "勤務時間は未入力です。開始時間と終了時間を入力してください。"}</p>
      {raw && !startHour && <p role="alert" className="listing-condition-error">保存されている勤務時間を時刻として読み取れません。元の値を保持しています。掲載前に開始時間と終了時間を入力してください。</p>}
      {workHours <= 0 && <p role="alert" className="listing-condition-error">開始時間と終了時間を入力し、終了は開始より後に設定してください。</p>}
    </div>
  </>;
}
const BREAK_OPTIONS = ["なし", ...Array.from({ length: 24 }, (_, i) => `${(i + 1) * 5}分`)];
export function StepBreakTime({ value, onChange }) {
  return <>
    <h2 style={lfStyles.stepTitle}>休憩時間を決めましょう</h2>
    <p style={lfStyles.subtitle}>1日の勤務時間に含まれる、休憩時間の合計を選んでください。</p>
    <div className="listing-topic-fields">
      <label className="listing-condition-field">休憩時間を選択
        <select aria-label="休憩時間" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">選択してください</option>
          {value && !BREAK_OPTIONS.includes(value) && <option value={value}>{value}</option>}
          {BREAK_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      {!value && <p className="listing-condition-warning">休憩時間を選んでください。</p>}
    </div>
  </>;
}
export function StepOvertime({ policy, setPolicy, detail, setDetail }) {
  return <>
    <h2 style={lfStyles.stepTitle}>時間外労働はありますか？</h2>
    <p style={lfStyles.subtitle}>設定した勤務時間を超えて、作業をお願いする可能性があるかを選んでください。</p>
    <div className="listing-topic-fields">
      <ListingChoiceCards label="時間外労働の有無" options={OVERTIME_OPTIONS} value={policy} onChange={setPolicy} />
      {policy === "あり" && <label className="listing-condition-field">時間外労働の目安
        <input aria-label="時間外労働の目安" value={detail} onChange={e => setDetail(e.target.value)} placeholder="例：繁忙期は1日30分〜1時間程度" maxLength={100} />
      </label>}
      {!policy && <p className="listing-condition-warning">時間外労働の有無を選んでください。</p>}
      {policy === "あり" && !detail.trim() && <p className="listing-condition-warning">目安の時間を入力してください。</p>}
    </div>
  </>;
}
export function StepDailyWage({ input, setInput, wage, timeLabel, workHours, breakTime, breakMinutes, violation, unknownWage, minWage, prefecture, wageNotice, onEditTime, onEditBreak, average, count }) {
  // 表示のみ。既存validateMinWageと同じ計算用休憩を使い、入力値・保存値は補完しない。
  const calculationBreak = Math.max(breakMinutes, workHours > 8 ? 60 : workHours > 6 ? 45 : 0);
  const hours = workHours - calculationBreak / 60;
  const ready = workHours > 0 && breakTime !== "" && hours > 0;
  return <>
    <h2 style={lfStyles.stepTitle}>日給を決めましょう</h2>
    <p style={lfStyles.subtitle}>1日の報酬を入力してください。勤務時間と休憩時間をもとに、最低賃金を確認します。</p>
    <div className="listing-topic-fields">
      <dl className="listing-wage-summary">
        <div><dt>勤務時間</dt><dd>{timeLabel || "未入力"}<button type="button" className="listing-condition-help" onClick={onEditTime}>勤務時間を変更</button></dd></div>
        <div><dt>休憩時間</dt><dd>{breakTime || "未入力"}<button type="button" className="listing-condition-help" onClick={onEditBreak}>休憩時間を変更</button></dd></div>
        {ready && <div><dt>判定に使う実働時間</dt><dd>{Number(hours.toFixed(2))}時間</dd></div>}
        {ready && wage > 0 && <div><dt>時給換算</dt><dd>約{Math.floor(wage / hours).toLocaleString()}円 / 時間</dd></div>}
      </dl>
      {ready && calculationBreak !== breakMinutes && <p className="listing-condition-note">現在の最低賃金チェックでは、休憩{calculationBreak}分として換算します。入力した休憩時間は変更していません。</p>}
      <label className="listing-condition-field">日給（円）<span className="listing-condition-pay"><input aria-label="日給" inputMode="numeric" value={input} onChange={e => setInput(digitsOnly(e.target.value))} placeholder="9000" /><span>円 / 日</span></span></label>
      <p className="listing-condition-note">各作業日の終了後に、現金で支払います。</p>
      {input !== "" && (!Number.isSafeInteger(wage) || wage <= 0) && <p role="alert" className="listing-condition-error">日給は1円以上の整数で入力してください。</p>}
      {!ready && <p role="alert" className="listing-condition-error">勤務時間と休憩時間を確認してください。上の変更ボタンから入力できます。</p>}
      <LFWageCompare type="日給" value={wage} avg={average} count={count} />
      {violation && !unknownWage && <p role="alert" className="listing-condition-error">{prefecture || "この地域"}の最低賃金（時給{minWage ? minWage.toLocaleString() : "―"}円）を下回っています。この金額では掲載できません</p>}
      {wageNotice}
    </div>
  </>;
}
