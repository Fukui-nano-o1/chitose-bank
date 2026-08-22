// 日程チップ（分割・段階2で切り出し・2026-07-24）：応募者カード・返事待ちカード・チャット文脈カード・確認カードで共用。
import { calFmtDate } from "../lib/utils";
import { NavIconInline } from "./NavIcons";
// 働く日（確定）行（応募者カード・返事待ちカード・チャット文脈カード・確認カード共用・2026-07-24）。
// value＝applications.agreed_dates：["YYYY-MM-DD",...]（農家が確定した働く日・濃い緑）／null（未確定=非表示）
export function AgreedDatesRow({ value, fs = 12 }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <div className="f-sans" style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center", margin:"0 0 8px" }}>
      <span style={{ fontSize:fs, color:"#0B6B4F", fontWeight:700 }}><NavIconInline name="calendar" size={fs} style={{ verticalAlign:"-2px", marginRight:3 }} />働く日</span>
      {value.slice().sort().map(d => (
        <span key={d} style={{ fontSize:fs, fontWeight:700, color:"#fff", background:"#00A86B", borderRadius:20, padding:"3px 10px" }}>{calFmtDate(d)}</span>
      ))}
    </div>
  );
}
// 来られる日チップ（応募者カード・返事待ちカード・チャット文脈カード共用・2026-07-24）。
// value＝applications.available_dates：["YYYY-MM-DD",...]（特定日・列挙）のみ表示。
// 'any'（期間中いつでもOK）は非表示（2026-07-24たきと指示：全期間working前提ので表示不要）。null（単日）も非表示
// ★agreed（働く日＝agreed_dates）が決まっていたら、来られる日は出さない（2026-08-18たきと指示
//   「働く日と来られる日が重複している。働く日に統一」）＝農家が働く日を確定した後は同じ日付が
//   二重に並ぶだけので、確定した働く日に一本化する。未確定の間は従来どおり出す（判断の材料）。
//   判定はこの部品1箇所＝出す画面ごとに条件が枝分かれしない
export function AvailDatesChips({ value, agreed, fs = 12 }) {
  if (Array.isArray(agreed) && agreed.length > 0) return null;
  const dates = Array.isArray(value) ? value : [];
  if (dates.length === 0) return null;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center", margin:"0 0 8px" }}>
      <span className="f-sans" style={{ fontSize:fs, color:"#717171", fontWeight:600 }}>来られる日</span>
      {dates.slice().sort().map(d => (
        <span key={d} className="f-sans" style={{ fontSize:fs, fontWeight:700, color:"#0B6B4F", background:"#E6F7EE", border:"1px solid #CDE9DD", borderRadius:20, padding:"3px 10px" }}>{calFmtDate(d)}</span>
      ))}
    </div>
  );
}
