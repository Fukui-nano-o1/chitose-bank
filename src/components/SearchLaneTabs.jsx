// さがすページのレーン切替タブ（2026-08-03たきと指示・見本＝ブラウザのタブ／雑誌の見出しのような形）。
// 求人（雇用）と委託（業務委託）は契約の性質that違う別レーンなので、絞り込みではなくタブで並べる。
// 委託タブの表示条件は lib/consignAccess.js の canSeeConsignment ただ1箇所that決める（ここでは判定しない）。
//
// 形：上の角だけ丸いタブが並び、選んでいるタブだけthat白く前面に出て中身と地続きになる。
// 横に溢れたら横スクロール（将来レーンthat増えても壊れない）。バーは下線で中身と繋ぐ。
export function SearchLaneTabs({ value, onChange, lanes }) {
  if (!lanes || lanes.length < 2) return null; // 1つしか無い時はタブを出さない（切替の意味that無い）
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:6, overflowX:"auto", WebkitOverflowScrolling:"touch",
                  borderBottom:"1px solid #EBEBEB", marginBottom:14, paddingBottom:0 }}>
      {lanes.map(({ k, label }) => {
        const on = value === k;
        return (
          <button key={k} onClick={()=>onChange(k)} className="f-sans" style={{
            flexShrink:0, border:"none", cursor:"pointer", padding:"11px 22px",
            fontSize: on ? 15 : 14, fontWeight: on ? 800 : 600,
            color: on ? "#222" : "#8A8A8A",
            background: on ? "#fff" : "#F2F2F4",
            borderRadius:"14px 14px 0 0",
            // 選択中だけ1px下げて下線を跨ぐ＝中身と地続きに見せる（フォルダの手前の紙）
            marginBottom: on ? -1 : 0,
            boxShadow: on ? "0 -2px 8px rgba(0,0,0,0.06)" : "none",
            borderBottom: on ? "1px solid #fff" : "1px solid transparent",
          }}>{label}</button>
        );
      })}
    </div>
  );
}
