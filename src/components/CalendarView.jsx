// 読み書き両用カレンダー（分割・段階2後半・2026-07-24）：求人フローの日程入力と詳細表示で共有。
import { useState, useEffect } from "react";
import { ymdLocal } from "../lib/utils";

// 読み書き両用カレンダー（モジュールレベル・入力側と詳細表示側で共有）
export function CalendarView({ start: startProp, end: endProp, readOnly = false, onSelect, accent = "#00A86B", accentSoft = "#E6F7EF", hideHints = false }) {
  // start/end は Date でも文字列でも受ける（2026-08-03クラッシュ修理の恒久ガード）：
  // viewCacheのlocalStorage化でDateがJSON経由の文字列として復元され、getFullYear()で
  // 全画面エラーになった。型で落ちず、不正値はnull＝当月表示に倒す
  const toDateCV = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; };
  const start = toDateCV(startProp), end = toDateCV(endProp);
  const WD_CV = ["日","月","火","水","木","金","土"];
  const isSameDayCV = (a, b) => a && b && ymdLocal(a) === ymdLocal(b);
  const todayYmdCV = ymdLocal(new Date());
  const initY = start ? start.getFullYear() : new Date().getFullYear();
  const initM = start ? start.getMonth() : new Date().getMonth();
  const [cvYear, setCvYear] = useState(initY);
  const [cvMonth, setCvMonth] = useState(initM);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (start) { setCvYear(start.getFullYear()); setCvMonth(start.getMonth()); }
  }, [start ? start.getTime() : null]);

  // ── readOnly（求人詳細）: 期間分の月を展開表示（ConfCalendar 6191-6233と同方式） ──
  // start未指定のreadOnly呼び出し(未実装プレースホルダー画面)は従来の単月表示にフォールバック
  if (readOnly && start) {
    const end2 = end || start;
    const months = [];
    let y = start.getFullYear(), m = start.getMonth();
    const ey = end2.getFullYear(), em = end2.getMonth();
    while (y < ey || (y === ey && m <= em)) {
      months.push({ y, m });
      if (m === 11) { y++; m = 0; } else m++;
      if (months.length > 12) break; // 安全弁
    }
    const LIMIT = 3;
    const shown = expanded ? months : months.slice(0, LIMIT);
    const remaining = months.length - LIMIT;
    const renderMonth = ({ y, m }) => {
      const firstDay = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < firstDay; i++) cells.push(null);
      for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);
      return (
        <div key={`${y}-${m}`} style={{ marginBottom:8 }}>
          <div style={{ textAlign:"center", marginBottom:6 }}>
            <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222" }}>{y}年{m+1}月</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:1 }}>
            {WD_CV.map(wd => <div key={wd} style={{ textAlign:"center", fontSize:10, color:"#B0B0B0", padding:"2px 0" }}>{wd}</div>)}
            {cells.map((dd, i) => {
              if (!dd) return <div key={`e${i}`} />;
              const dt = new Date(y, m, dd);
              const isStart = isSameDayCV(dt, start);
              const isEnd = isSameDayCV(dt, end2);
              const inRange = start && end2 && dt > start && dt < end2;
              const isToday = ymdLocal(dt) === todayYmdCV;
              return (
                <div key={dd} style={{
                  padding:"5px 2px", borderRadius:6, fontSize:13, textAlign:"center",
                  background: (isStart||isEnd) ? accent : inRange ? accentSoft : "transparent",
                  color: (isStart||isEnd) ? "#fff" : inRange ? accent : "#222",
                  fontWeight: (isStart||isEnd) ? 700 : 400,
                  boxShadow: isToday && !(isStart||isEnd) ? `inset 0 0 0 1.5px ${accent}` : "none",
                }}>{dd}</div>
              );
            })}
          </div>
        </div>
      );
    };
    return (
      <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:14, marginTop:8 }}>
        {shown.map(renderMonth)}
        {!expanded && remaining > 0 && (
          <button onClick={() => setExpanded(true)} style={{ width:"100%", padding:"10px", borderRadius:10, border:"1px solid #EBEBEB", background:"#F7F7F7", fontSize:13, color:accent, fontWeight:600, cursor:"pointer" }}>
            すべての月を表示（残り{remaining}ヶ月）
          </button>
        )}
      </div>
    );
  }

  // ── 従来の単月+月送り（求人作成の日付選択・クリック挙動を維持） ──
  const firstDay = new Date(cvYear, cvMonth, 1).getDay();
  const daysInMonth = new Date(cvYear, cvMonth + 1, 0).getDate();
  const prevMo = () => { if (cvMonth===0){ setCvYear(y=>y-1); setCvMonth(11);} else setCvMonth(m=>m-1); };
  const nextMo = () => { if (cvMonth===11){ setCvYear(y=>y+1); setCvMonth(0);} else setCvMonth(m=>m+1); };
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let dd = 1; dd <= daysInMonth; dd++) cells.push(dd);
  return (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:14, marginTop:8 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <button onClick={prevMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:14 }}>{"‹"}</button>
        <span className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222" }}>{cvYear}年{cvMonth+1}月</span>
        <button onClick={nextMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:14 }}>{"›"}</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:8 }}>
        {WD_CV.map(wd => <div key={wd} style={{ textAlign:"center", fontSize:10, color:"#B0B0B0", padding:"3px 0" }}>{wd}</div>)}
        {cells.map((dd, i) => {
          if (!dd) return <div key={`e${i}`} />;
          const dt = new Date(cvYear, cvMonth, dd);
          const isStart = isSameDayCV(dt, start);
          const isEnd = isSameDayCV(dt, end);
          const inRange = start && end && dt > start && dt < end;
          const isToday = ymdLocal(dt) === todayYmdCV;
          return (
            <button key={dd} onClick={readOnly ? undefined : () => onSelect && onSelect(dt)} style={{
              padding:"7px 2px", borderRadius:8, border:"none", cursor: readOnly ? "default" : "pointer", fontSize:13, textAlign:"center",
              background: (isStart||isEnd) ? accent : inRange ? accentSoft : "transparent",
              color: (isStart||isEnd) ? "#fff" : inRange ? accent : "#222",
              fontWeight: (isStart||isEnd) ? 700 : 400,
              boxShadow: isToday && !(isStart||isEnd) ? `inset 0 0 0 1.5px ${accent}` : "none",
            }}>{dd}</button>
          );
        })}
      </div>
      {!readOnly && !hideHints && <p className="f-sans" style={{ fontSize:10, color:"#B0B0B0", marginTop:6, textAlign:"center" }}>終了日を選ばない場合は、1日募集として扱います</p>}
      {/* 期間募集の予告（2026-07-24）：農家に仕組みを先に伝える。終了日ありの期間求人の時だけ表示 */}
      {!readOnly && !hideHints && end && start && ymdLocal(end) !== ymdLocal(start) && (
        <p className="f-sans" style={{ fontSize:11, color:"#0B6B4F", background:"#F0F7F4", border:"1px solid #CDE9DD", borderRadius:8, padding:"8px 10px", marginTop:8, lineHeight:1.6 }}>期間で募集すると、応募者が「来られる日」を選んで応募します。</p>
      )}
    </div>
  );
}
