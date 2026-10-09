// 選択状態は色ではなく aria-pressed で共有する。
// 掲載フローの見た目は listingFlow.css、その他の画面は従来の役割色を使う。
export function LFPillSelect({ options, value, values, onSelect, accent = "#00A86B", accentSoft }) {
  const soft = accentSoft || (accent === "#00A86B" ? "#E6F7EF" : "#FFF1E8");
  const isOn = (option) => Array.isArray(values) ? values.includes(option) : value === option;
  return (
    <div className="lf-pill-select" style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(option => (
        <button key={option} type="button" aria-pressed={isOn(option)} onClick={() => onSelect(option)} className="f-sans lf-pill-option" style={{
          padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
          borderColor: isOn(option) ? accent : "#EBEBEB",
          background: isOn(option) ? soft : "#fff", color: isOn(option) ? accent : "#222",
        }}>{option}</button>
      ))}
    </div>
  );
}
