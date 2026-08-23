// LandingFlow 共有UI部品（第2次構造改革2026-08-17で LandingFlow.jsx から分離）。
// ★【絶対】モジュールレベル定義を維持すること。LandingFlow 内に定義し直すと再レンダリングの
//   たびに関数参照が変わり、React が別コンポーネントと判定してアンマウントし input の
//   フォーカスが失われる（既知のバグ）。移設でもこの性質は変わらない＝1ファイル1モジュール定義。
// ★LFPhotoReorderStrip のタッチ挙動（長押し350ms・10px判定・native touchmove・passive:false）は
//   実機で何度も踏んだ末の形。触らないこと。
import { NavIconInline } from "../../../../components/NavIcons";

import { useState, useEffect, useRef } from "react";
import { photoThumb } from "../../../../lib/utils";

// ── LandingFlow 共有UIヘルパー（モジュールレベル定義でフォーカス消失バグを防ぐ）───
// 注意：これらを LandingFlow 内に定義すると再レンダリングのたびに関数参照が変わり
// React が別コンポーネントと判定してアンマウントし input のフォーカスが失われる。

// 写真並び替えストリップ（2026-08-03たきと指示「長押しでスワイプ。タップ機能削除せず」）：
// ◀▶タップは従来どおり。加えてサムネを長押し（350ms・動かさず）するとドラッグモードに入り、
// 指を左右に動かすと通過したサムネの位置へ入れ替わる。離すと確定。
// ・長押し前に10px以上動いたら長押し取消＝従来の横スクロールに譲る（スクロールと衝突しない）
// ・【重要・2026-08-03修理】タッチの追従は native touchmove で行う（pointermoveに頼らない）。
//   pointermove方式は「長押しはできるが動かない」で失敗した。原因は3つ：
//   (1) 長押し後に指を動かすとブラウザがスクロール判定して pointercancel を飛ばし、
//       それでドラッグを終了していた（pointercancelでは終了しない設計に変更）
//   (2) touchmoveをpreventDefaultすると pointermove の配送が止まる実装がある
//   (3) touch-action は指を置いた時点の値で決まるので、長押し成立後に none にしても遅い
//   長押しは350ms静止が条件＝成立時点でスクロールは未開始ので、その後のtouchmoveは
//   cancelable＝preventDefaultでスクロールを止められる（TodayPage横スワイプと同じ技法）
// ・端に近づいたらストリップを自動スクロール（はみ出した写真へも運べる）
export function LFPhotoReorderStrip({ photos, setPhotos }) {
  const [dragIdx, setDragIdx] = useState(null);
  const dragIdxRef = useRef(null);
  const stripRef = useRef(null);
  const pressTimer = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });
  const moveRef = useRef(null); // 最新のhandleDragMove（[]依存のnativeリスナーから呼ぶため）
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };
  const movePhoto = (i, dir) => setPhotos(prev => { const j = i + dir; if (j < 0 || j >= prev.length) return prev; const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  const endDrag = () => { cancelPress(); if (dragIdxRef.current != null) { dragIdxRef.current = null; setDragIdx(null); } };

  const handleDragMove = (clientX) => {
    const strip = stripRef.current;
    if (!strip || dragIdxRef.current == null) return;
    // 端の自動スクロール（±36px圏内）
    const sr = strip.getBoundingClientRect();
    if (clientX < sr.left + 36) strip.scrollLeft -= 10;
    else if (clientX > sr.right - 36) strip.scrollLeft += 10;
    // 指に一番近いサムネ（中心との距離）へ移動。ドラッグ中の札はscale(1.1)で広がるため、
    // 「範囲に入ったか」でなく「中心が最も近いか」で判定する（重なりでの取りこぼしを防ぐ）
    const kids = Array.from(strip.children);
    let best = -1, bestD = Infinity;
    for (let k = 0; k < kids.length; k++) {
      const r = kids[k].getBoundingClientRect();
      const d = Math.abs(clientX - (r.left + r.width / 2));
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0 && best !== dragIdxRef.current) {
      const from = dragIdxRef.current;
      setPhotos(prev => { const next = [...prev]; const [it] = next.splice(from, 1); next.splice(best, 0, it); return next; });
      dragIdxRef.current = best;
      setDragIdx(best);
    }
  };
  moveRef.current = handleDragMove;

  // タッチ：追従・スクロール抑止・終了をすべてnativeイベントで完結させる（passive:false）
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (dragIdxRef.current == null) {
        // 長押し成立前に動いた＝スクロール意図ので長押しを取消（pointermoveが来ない端末の保険）
        if (pressTimer.current && (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10)) cancelPress();
        return;
      }
      if (e.cancelable) e.preventDefault(); // ドラッグ中は画面・ストリップのスクロールを止める
      moveRef.current?.(t.clientX);
    };
    const onTouchEnd = () => endDrag();
    strip.addEventListener("touchmove", onTouchMove, { passive: false });
    strip.addEventListener("touchend", onTouchEnd);
    strip.addEventListener("touchcancel", onTouchEnd);
    return () => {
      strip.removeEventListener("touchmove", onTouchMove);
      strip.removeEventListener("touchend", onTouchEnd);
      strip.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // マウス（PC）：window で pointermove を追う。pointercancelでは終了しない
  // （タッチのスクロール判定でcancelが飛ぶため。タッチの終了はtouchend/touchcancelが担う）
  useEffect(() => {
    if (dragIdx == null) return;
    const onMove = (e) => { if (e.pointerType !== "touch") moveRef.current?.(e.clientX); };
    const onUp = () => endDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelPress(), []); // アンマウント時にタイマー掃除

  return (
    <div>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 8px" }}>写真の並び替え（先頭が求人カードの表紙になります）。◀▶か、長押しして指で動かしても並び替えできます</p>
      <div ref={stripRef} style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4, WebkitOverflowScrolling:"touch" }}>
        {photos.map((p, i) => (
          <div key={i} style={{ flexShrink:0, width:76 }}>
            <div
              onPointerDown={(e) => {
                if (e.pointerType === "mouse" && e.button !== 0) return;
                startPos.current = { x: e.clientX, y: e.clientY };
                cancelPress();
                pressTimer.current = setTimeout(() => {
                  pressTimer.current = null;
                  dragIdxRef.current = i;
                  setDragIdx(i);
                  try { navigator.vibrate?.(10); } catch {}
                }, 350);
              }}
              onPointerMove={(e) => {
                // 長押し成立前に動いたら取消＝スクロール意図（成立後の追従はtouchmove／window pointermoveが担う）
                if (dragIdxRef.current == null && pressTimer.current) {
                  if (Math.abs(e.clientX - startPos.current.x) > 10 || Math.abs(e.clientY - startPos.current.y) > 10) cancelPress();
                }
              }}
              onPointerUp={cancelPress}
              /* pointercancelでは【ドラッグを終了しない】（タッチのスクロール判定で飛ぶため。
                 これで終了していたのが「長押しできるが動かない」の主因）。タイマー掃除だけ行う */
              onPointerCancel={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                position:"relative", width:76, height:76, borderRadius:8, overflow:"hidden",
                border: dragIdx === i ? "2px solid #00A86B" : i === 0 ? "2px solid #00A86B" : "1px solid #EBEBEB",
                transform: dragIdx === i ? "scale(1.1)" : "none",
                boxShadow: dragIdx === i ? "0 6px 16px rgba(0,0,0,0.25)" : "none",
                transition: "transform .12s ease, box-shadow .12s ease",
                zIndex: dragIdx === i ? 2 : 1,
                touchAction: dragIdx != null ? "none" : undefined,
                WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
              }}
            >
              <img loading="lazy" draggable={false} src={photoThumb(p)} alt={`写真${i + 1}`} style={{ width:"100%", height:"100%", objectFit:"cover", pointerEvents:"none" }} />
              {i === 0 && <span className="f-sans" style={{ position:"absolute", top:4, left:4, fontSize:9, fontWeight:700, color:"#fff", background:"#00A86B", borderRadius:6, padding:"1px 5px" }}>表紙</span>}
            </div>
            <div style={{ display:"flex", gap:4, marginTop:4 }}>
              <button onClick={() => movePhoto(i, -1)} disabled={i === 0} aria-label="前へ" className="f-sans" style={{ flex:1, padding:"6px 0", fontSize:13, fontWeight:700, background:"#fff", color: i === 0 ? "#D0D0D0" : "#00A86B", border:"1px solid #EBEBEB", borderRadius:6, cursor: i === 0 ? "default" : "pointer" }}>◀</button>
              <button onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1} aria-label="次へ" className="f-sans" style={{ flex:1, padding:"6px 0", fontSize:13, fontWeight:700, background:"#fff", color: i === photos.length - 1 ? "#D0D0D0" : "#00A86B", border:"1px solid #EBEBEB", borderRadius:6, cursor: i === photos.length - 1 ? "default" : "pointer" }}>▶</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LFMultiPill({ options, values, onToggle }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
      {options.map(o => {
        const sel = values.includes(o);
        return (
          <button key={o} onClick={() => onToggle(o)} className="f-sans" style={{
            padding:"7px 14px", borderRadius:20, fontSize:12, cursor:"pointer", fontWeight:600, border:"2px solid",
            borderColor: sel ? "#00A86B" : "#EBEBEB",
            background: sel ? "#E6F7EF" : "#fff", color: sel ? "#00A86B" : "#222",
          }}>{o}</button>
        );
      })}
    </div>
  );
}

export function LFWageNote() {
  return (
    <div style={{ padding:"8px 12px", background:"#FEF3E2", borderRadius:8, border:"1px solid #F5A62333", marginTop:8 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#F5A623" }}><NavIconInline name="alert" size={11} style={{ verticalAlign:"-1.5px" }} />報酬は最低賃金を下回らないように設定してください</p>
    </div>
  );
}
// LFPrivacyNote（本名・電話番号・詳細住所は初期表示しません…）は全廃（2026-08-08たきと指示
// 「削除。何度も警告しているよね？」）：同じ警告が複数ページで繰り返されていた。
// 公開範囲の事実の説明は step3「集合場所の公開範囲とは？」に一本化済み
export function LFWageCompare({ type, value, avg, count }) {
  if (!value || value <= 0) return null;
  const median = Math.round(avg * 0.97);
  if (count < 5) return <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6 }}>まだ同条件のデータが少ないため、平均は表示できません。</p>;
  const diff = value - avg;
  return (
    <div style={{ marginTop:8, padding:"10px 12px", background:"#F7F7F7", borderRadius:8 }}>
      <p className="f-sans" style={{ fontSize:11, color:"#717171" }}>
        この経歴・作業内容の平均{type}：<span className="f-mono" style={{ fontWeight:700, color:"#222" }}>{avg.toLocaleString()}円</span>　中央値：{median.toLocaleString()}円　件数：{count}件
      </p>
      <p className="f-sans" style={{ fontSize:11, fontWeight:600, marginTop:4, color: diff >= 0 ? "#00A86B" : "#F5A623" }}>
        あなたの希望{type}：{value.toLocaleString()}円　平均より {diff >= 0 ? "+" : ""}{diff.toLocaleString()}円{diff < 0 ? "（応募が集まりにくい可能性があります）" : ""}
      </p>
    </div>
  );
}
export function LFFakeFilterRow() {
  return (
    <div style={{ display:"flex", gap:6, marginBottom:12, overflowX:"auto", scrollbarWidth:"none" }}>
      {["地域","作物","作業","日付","経験","報酬","移動手段"].map(f => (
        <span key={f} style={{ flexShrink:0, padding:"6px 12px", background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, fontSize:11, color:"#717171" }}>{f}</span>
      ))}
    </div>
  );
}
