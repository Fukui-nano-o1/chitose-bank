// 汎用トグルスイッチ（分割・段階2で切り出し・2026-07-24）：プロフィール編集・保険ページ等で共用。
// accent=ON時の色（既定は緑・委託の黒テーマ用に差し替え可・2026-07-31）
export function ToggleSwitch({ checked, onChange, label, accent = "#00A86B" }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0" }}>
      <span className="f-sans" style={{ fontSize:14, color:"#222" }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          width:48, height:28, borderRadius:14, flexShrink:0,
          border:"none", padding:3, cursor:"pointer",
          background: checked ? accent : "#CCC",
          transition:"background .15s",
        }}
      >
        <div style={{
          width:22, height:22, borderRadius:"50%", background:"#fff",
          transform: checked ? "translateX(20px)" : "translateX(0px)",
          transition:"transform .15s",
        }} />
      </button>
    </div>
  );
}
