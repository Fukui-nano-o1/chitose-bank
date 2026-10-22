import { CalendarView } from "../../../../components/CalendarView";
import { LFWizCard } from "../../../../components/ui";
import { calendarDateToYmd } from "../../../../lib/calendarDate.js";
import { dateLabel } from "../jobInputCodec.js";
import { isMultiDaySchedule, validHeadcount, validSchedule } from "../listingNavigation.js";
import { lfStyles } from "../lfStyles.js";

// 入力はすべて親で保持する。ページの切替・再マウントで別の値を作らない。
export function StepSchedule({ start, end, setStart, setEnd, holidays }) {
  return <>
    <h2 className="f-sans" style={lfStyles.stepTitle}>いつ来てほしいですか？</h2>
    <p className="f-sans" style={lfStyles.subtitle}>開始日と終了日を選びます。1日だけなら、開始日だけで次へ進めます。</p>
    <LFWizCard>
      <p className="f-sans" role="status" aria-live="polite">{dateLabel(start, end)}</p>
      <CalendarView start={start} end={end} holidays={holidays} onSelect={date => {
        if (!start || end) { setStart(date); setEnd(null); }
        else if (date >= start) setEnd(date);
        else { setStart(date); setEnd(null); }
      }} />
      {!validSchedule(start, end) && <p className="listing-input-hint">カレンダーで開始日を選んでください。</p>}
    </LFWizCard>
  </>;
}

export function StepHolidays({ start, end, holidays, setHolidays, onEditSchedule }) {
  const multiple = isMultiDaySchedule(start, end);
  const startDay = calendarDateToYmd(start), endDay = calendarDateToYmd(end);
  const disabled = date => !multiple || calendarDateToYmd(date) <= startDay || calendarDateToYmd(date) >= endDay;
  return <>
    <h2 className="f-sans" style={lfStyles.stepTitle}>期間内の休日はありますか？</h2>
    <p className="f-sans" style={lfStyles.subtitle}>休日にする日を選びます。休日がなければ、そのまま次へ進めます。</p>
    <LFWizCard>
      <p className="f-sans">{dateLabel(start, end)}</p>
      {multiple ? <>
        <CalendarView start={start} end={end} holidays={holidays} hideHints selectionMode="holidays" isDateDisabled={disabled}
          onSelect={date => {
            if (disabled(date)) return;
            const selected = calendarDateToYmd(date);
            setHolidays(previous => previous.includes(selected) ? previous.filter(day => day !== selected) : [...previous, selected].sort());
          }} />
        <p className="listing-input-hint">開始日・終了日・期間外の日は休日にできません。選んだ日をもう一度押すと解除します。</p>
        <p role="status" aria-live="polite" className="listing-input-hint">{holidays.length ? `休日：${holidays.length}日` : "休日は選択されていません。"}</p>
      </> : <p role="status" className="listing-input-hint">{start ? "1日だけの日程では、休日の設定は不要です。" : "先に作業日程を選んでください。"}</p>}
      <button type="button" className="listing-back" onClick={onEditSchedule}>日程を変更する</button>
    </LFWizCard>
  </>;
}

export function StepHeadcount({ count, setCount }) {
  return <>
    <h2 className="f-sans" style={lfStyles.stepTitle}>何人に来てほしいですか？</h2>
    <p className="f-sans" style={lfStyles.subtitle}>採用したい人数を入力してください。</p>
    <LFWizCard>
      <div className="listing-count-row">
        <label htmlFor="listing-headcount">採用人数</label>
        <div className="listing-counter">
          <button type="button" aria-label="採用人数を減らす" disabled={Number(count) <= 1} onClick={() => setCount(String(Math.max(1, Number(count) - 1)))}>−</button>
          <input id="listing-headcount" type="number" min="1" step="1" inputMode="numeric" value={count}
            onChange={event => setCount(event.target.value)} placeholder="人数" aria-describedby="listing-headcount-hint"
            aria-invalid={count !== "" && !validHeadcount(count) ? "true" : undefined} />
          <button type="button" aria-label="採用人数を増やす" onClick={() => setCount(String((Math.max(0, Number(count)) || 0) + 1))}>+</button>
        </div>
      </div>
      <p id="listing-headcount-hint" className="listing-input-hint">1人以上の整数を入力してください。</p>
    </LFWizCard>
  </>;
}
