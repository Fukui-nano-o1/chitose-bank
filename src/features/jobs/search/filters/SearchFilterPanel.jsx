// さがすの絞り込みUI（第2次構造改革2026-08-18で JobSearchMapView.jsx から分離）。
// ★ここは【入力と表示だけ】：どの求人が残るかを決める条件（searchActive・filteredList の3述語・
//   候補の生成）は親に残してある。この2部品は「選んだ内容を見せる」「選ばせる」しかしない。
// ★sections は親が自分のstateから組み立てて渡す＝状態の持ち主を動かさないための形。
//   { k, q, title, opts, sel, tog, label } の7キーは移設前の配列リテラルと同じ。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。

// 下部バー直上の浮遊ピル。適用中は条件の要約＋件数＋✕クリアを出す
export function SearchFab({ active, summary, count, onOpen, onClear }) {
  return (<>
    <button onClick={onOpen} className="cb-search-fab f-sans" style={{ display:"flex", alignItems:"center", gap:10, background:"#fff", border:"1px solid #DDD", borderRadius:32, padding:"11px 18px", boxShadow:"0 4px 16px rgba(0,0,0,0.18)", cursor:"pointer", textAlign:"left", boxSizing:"border-box" }}>
      <span style={{ fontSize:17, flexShrink:0 }}>🔍</span>
      <span style={{ minWidth:0, flex:1 }}>
        <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {active ? summary : "仕事をさがす"}
        </span>
        <span style={{ display:"block", fontSize:11, color:"#999", marginTop:2 }}>
          {active ? `${count}件の仕事` : "作物・地域・時期でしぼり込み"}
        </span>
      </span>
      {active && (
        <span role="button" aria-label="条件をクリア" onClick={(e)=>{ e.stopPropagation(); onClear(); }} style={{ flexShrink:0, width:28, height:28, borderRadius:"50%", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"#555" }}>✕</span>
      )}
    </button>
  </>);
}

// 検索パネル（半透明の暗幕・1つだけ開くアコーディオン・チップはタップの瞬間に一覧へ反映）
export function SearchFilterPanel({ open, onClose, sections, section, onSection, onClear, resultCount }) {
  if (!open) return null;
  return (<>
    <div className="fade-in cb-search-overlay" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(255,255,255,0.35)", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)", overflowY:"auto", WebkitOverflowScrolling:"touch", display:"flex" }}>{/* モザイク（すりガラス）処理（2026-07-27たきと指示）：暗幕では背景が見えすぎたためblurに。輪郭と件数の増減は伝わるが文字は読めない */}
      {/* margin:auto＝縦横中央（2026-07-27たきと指示）。中身が画面より高い時はflex+autoマージンで正しくスクロールできる */}
      {/* ★この包み(全幅)では止めない（2026-08-06）：ここでstopPropagationすると、カードとカードの
           隙間・左右の余白も「枠内」になり、枠外タップで閉じられなくなる。止めるのは白いカード自身だけ */}
      <div style={{ width:"100%", maxWidth:520, margin:"auto", padding:"calc(env(safe-area-inset-top, 0px) + 12px) 16px 24px", boxSizing:"border-box" }}>
      {/* ✕閉じるボタンは削除（2026-07-27たきと指示）：モザイク部分のタップで閉じられるため不要 */}
      <div style={{ display:"grid", gap:12, alignContent:"start" }}>
        {sections.map(sec => section === sec.k ? (
          <div key={sec.k} onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:20, boxShadow:"0 2px 10px rgba(0,0,0,0.07)", padding:"18px 18px 20px" }}>
            <p className="f-sans" style={{ fontSize:19, fontWeight:800, color:"#222", margin:"0 0 14px" }}>{sec.title}</p>
            {sec.opts.length === 0 ? (
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:0 }}>選べる条件がありません</p>
            ) : (
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {sec.opts.map(v => { const on = sec.sel.includes(v); return (
                  <button key={v} onClick={()=>sec.tog(v)} className="f-sans" style={{ padding:"9px 16px", borderRadius:24, fontSize:13, fontWeight:700, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{sec.label(v)}</button>
                ); })}
              </div>
            )}
          </div>
        ) : (
          <button key={sec.k} onClick={e=>{ e.stopPropagation(); onSection(sec.k); }} className="f-sans" style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, background:"#fff", border:"none", borderRadius:16, padding:"16px 18px", cursor:"pointer", boxShadow:"0 1px 6px rgba(0,0,0,0.06)" }}>
            <span style={{ fontSize:13, fontWeight:600, color:"#717171", flexShrink:0 }}>{sec.q}</span>
            <span style={{ fontSize:13, fontWeight:700, color:"#222", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sec.sel.length ? sec.sel.map(sec.label).join("・") : "指定なし"}</span>
          </button>
        ))}
      </div>
      {/* 下部バー：クリア／「N件を表示」（件数はチップ操作に合わせてリアルタイム更新） */}
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, marginTop:12, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 2px 10px rgba(0,0,0,0.15)" }}>
        <button onClick={onClear} className="f-sans" style={{ background:"none", border:"none", fontSize:14, fontWeight:700, color:"#222", textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>すべてクリア</button>
        <button onClick={onClose} className="f-sans" style={{ background:"#00A86B", color:"#fff", border:"none", borderRadius:12, padding:"12px 26px", fontSize:15, fontWeight:800, cursor:"pointer" }}>{resultCount}件を表示</button>
      </div>
      </div>
    </div>
  </>);
}
