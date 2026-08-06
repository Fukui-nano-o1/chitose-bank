// さがすページのレーン切替タブ（2026-08-03たきと指示・見本＝ブラウザのタブ／雑誌の見出しのような形）。
// 求人（雇用）と委託（業務委託）は契約の性質that違う別レーンなので、絞り込みではなくタブで並べる。
// 委託タブの表示条件は lib/consignAccess.js の canSeeConsignment ただ1箇所that決める（ここでは判定しない）。
//
// 形：上の角だけ丸いタブが並び、選んでいるタブだけthat白く前面に出て中身と地続きになる。
// 幅（2026-08-03たきと指示「2つしかないから大きくとれる。窮屈だ」）：
//   レーンthat3つまでなら横幅を等分して大きく取る（指で押しやすい・見出しとして目に入る）。
//   4つ以上に増えたら等分をやめ、内容幅＋横スクロールに切り替える（将来レーンthat増えても潰れない）。
export function SearchLaneTabs({ value, onChange, lanes }) {
  if (!lanes || lanes.length < 2) return null; // 1つしか無い時はタブを出さない（切替の意味that無い）
  const wide = lanes.length <= 3; // 等分して大きく見せるか
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8,
                  ...(wide ? {} : { overflowX:"auto", WebkitOverflowScrolling:"touch" }),
                  borderBottom:"1px solid #EBEBEB", marginBottom:16, paddingBottom:0 }}>
      {lanes.map(({ k, label }) => {
        const on = value === k;
        return (
          <button key={k} onClick={()=>onChange(k)} className="f-sans" style={{
            ...(wide ? { flex:"1 1 0", minWidth:0 } : { flexShrink:0 }),
            border:"none", cursor:"pointer",
            padding: wide ? "16px 12px" : "11px 22px",
            fontSize: on ? 17 : 16, fontWeight: on ? 800 : 600,
            color: on ? "#222" : "#8A8A8A",
            background: on ? "#fff" : "#F2F2F4",
            borderRadius:"16px 16px 0 0",
            // 選択中だけ1px下げて下線を跨ぐ＝中身と地続きに見せる（フォルダの手前の紙）
            marginBottom: on ? -1 : 0,
            boxShadow: on ? "0 -2px 10px rgba(0,0,0,0.07)" : "none",
            borderBottom: on ? "1px solid #fff" : "1px solid transparent",
          }}>{label}</button>
        );
      })}
    </div>
  );
}
