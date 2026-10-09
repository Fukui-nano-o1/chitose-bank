import { useRef, useState } from "react";

// 24時間表記と5分単位のドラッグ操作。分単位の正確な設定は時刻入力で補完する。
export function WorkTimeClock({ startHour, startMinute, endHour, endMinute, onStart, onEnd }) {
  const [active, setActive] = useState("start");
  const [phase, setPhase] = useState("hour");
  const dragging = useRef(false);
  const values = { start: [startHour,startMinute], end: [endHour,endMinute] };
  const [hour,minute] = values[active].map(Number);
  const setTime = active === "start" ? onStart : onEnd;
  const display = (h,m) => `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  const move = event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const angle = (Math.atan2(x,-y) + Math.PI * 2) % (Math.PI * 2);
    if (phase === "minute") setTime(String(hour),String(Math.round(angle / (Math.PI * 2) * 12) % 12 * 5).padStart(2,"0"));
    else { const h = Math.round(angle / (Math.PI * 2) * 12) % 12; setTime(String(h + (hour >= 12 ? 12 : 0)),String(minute).padStart(2,"0")); }
  };
  const angle = (phase === "hour" ? hour % 12 / 12 : minute / 60) * Math.PI * 2;
  const x = 150 + 103 * Math.sin(angle), y = 150 - 103 * Math.cos(angle);
  return <section className="listing-clock">
    <strong>勤務時間</strong>
    <p>時計の針を動かして時刻を選んでください。</p>
    <div className="listing-clock-times">
      {[[ "start","開始時間",startHour,startMinute ],[ "end","終了時間",endHour,endMinute ]].map(([key,label,h,m]) =>
        <button type="button" key={key} aria-pressed={active === key} onClick={() => { setActive(key); setPhase("hour"); }}><small>{label}</small><b>{display(h,m)}</b></button>)}
    </div>
    <div className="listing-clock-modes"><button type="button" aria-pressed={phase === "hour"} onClick={() => setPhase("hour")}>時</button><button type="button" aria-pressed={phase === "minute"} onClick={() => setPhase("minute")}>分</button><button type="button" onClick={() => setTime(String((hour+12)%24),String(minute).padStart(2,"0"))}>{hour >= 12 ? "午後" : "午前"}（切替）</button></div>
    <svg className="listing-clock-face" viewBox="0 0 300 300" role="slider" tabIndex={0} aria-label={active === "start" ? "勤務開始時刻" : "勤務終了時刻"} aria-valuemin={0} aria-valuemax={phase === "hour" ? 23 : 59} aria-valuenow={phase === "hour" ? hour : minute} onKeyDown={e => { if(e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft"){e.preventDefault();const d=e.key === "ArrowUp" || e.key === "ArrowRight" ? 1:-1;if(phase === "hour")setTime(String((hour+d+24)%24),String(minute).padStart(2,"0"));else setTime(String((minute+d*5+60)%60).padStart(2,"0"));} }} onPointerDown={e=>{dragging.current=true;e.currentTarget.setPointerCapture(e.pointerId);move(e);}} onPointerMove={e=>{if(dragging.current)move(e);}} onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}}>
      <circle cx="150" cy="150" r="145" fill="#f7f7f7" stroke="#ddd"/>
      {Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return <text key={i} x={150+103*Math.sin(a)} y={155-103*Math.cos(a)} textAnchor="middle" fontSize="16" fill="#222">{phase === "hour" ? (i || 12) : String(i*5).padStart(2,"0")}</text>;})}
      <line x1="150" y1="150" x2={x} y2={y} stroke="#222" strokeWidth="5" strokeLinecap="round"/><circle cx={x} cy={y} r="13" fill="#222"/><circle cx="150" cy="150" r="6" fill="#222"/><circle cx="150" cy="150" r="145" fill="transparent"/>
    </svg>
    <label className="listing-clock-exact">正確な時刻を入力 <input type="time" aria-label={active === "start" ? "開始時刻を直接入力" : "終了時刻を直接入力"} value={display(hour,minute)} onChange={e=>{const [h,m]=e.target.value.split(":");if(h !== undefined && m !== undefined)setTime(String(Number(h)),m);}} /></label>
    <p className="listing-clock-summary">{display(startHour,startMinute)} 〜 {display(endHour,endMinute)}</p>
  </section>;
}
