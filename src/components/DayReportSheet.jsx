// その日の記録（遅刻・欠勤・相手に会えない）の入力シート（2026-08-19新設）。
// ★たきと指示「最終日だけ全体的な評価を入力。これは全ての工程の終了を意味する。
//   それ以外は遅刻や欠勤、農家が来ていないとかの入力にする」＝評価フローの中日側がこれ。
// ★この形は2箇所から開く：①今日ページの「今日の記録」の箱 ②今日ページの緊急連絡のシート。
//   同じ入力が枝分かれしないよう、フォームと保存はこの1部品に集約する
//   （種別を足す時は lib/utils の *_DAY_REPORT_KINDS ＝ attendance_events.kind の CHECK と対で直す）。
// 保存するのは attendance_events の1行だけ＝作業全体の出欠（applications.attended）には触れない。
//   出欠と完了は最終日の評価（submit_farmer_review／complete_work）が決める。
// DBの壁：attendance_events は当事者RLS（actor_id = auth.uid() かつ その応募の当事者）＝
//   画面はその手前の案内に徹する。相手への通知・運営への警報は trg_notify_attendance が撃つ。
//
// ★2面構成（2026-08-23たきと指示「説明文と選択肢に分けよう。横にスライド。指に追従」）：
//   1枚目＝説明だけ／2枚目＝選択肢と送信。指に1:1で追従し、離した時に近い方の面へ収まる。
//   ネイティブの横スクロール（scroll-snap）は使えない：この部品が置かれる今日ページ・
//   お仕事タブのページャは touch-action:"pan-y" ので、その中の overflow-x は丸ごと死ぬ
//   （touch-action は祖先との積・lib/hDrag.js の冒頭に同じ理由が書いてある）。ので transform を自前で書く。
//   規則は DragSheet・hDrag と揃える：①8px動くまで軸を決めない ②1ジェスチャで軸は1回だけ
//   （縦と決まったら以後ノータッチ＝面の中の縦スクロールに完全に譲る）③横は preventDefault して
//   rAFで1フレーム1回だけ描く（will-change＋transition:none の滑らか3点セット）。
// ★シートの高さは2面とも固定：面ごとに高さが変わるとボタンが動き、続けてタップした指が
//   黒幕に落ちて閉じる（2026-08-16の誤タップと同型）。中身だけ面の内側でスクロールさせる。
// ★モジュールレベル定義を維持すること：親の中で定義すると再レンダーごとに再マウントされ、
//   textarea のフォーカス・入力中の下書きが消える（LandingFlowのフォーカス消失バグと同族）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { fbSuccess, fbError } from "../lib/feedback";
import { dayReportKinds, ymdLocal } from "../lib/utils";

// app＝{ id }（応募のID）。meId＝自分のauth_id。role＝"farmer" | "worker"（選択肢が変わる）。
// workDate＝この記録が指す作業日（"YYYY-MM-DD"／省略時は今日）。
// onDone(applicationId)＝保存できた時に親へ知らせる（一覧から消す・祝祭を出すのは親の仕事）。
export function DayReportSheet({ app, meId, role, workDate, onClose, onDone }) {
  const [kind, setKind] = useState("");
  const [detail, setDetail] = useState("");   // 内訳（選択式・kindにsubがある時だけ必須）
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(0);        // 0=説明 / 1=選択肢
  const viewRef = useRef(null);               // 面の窓（ここでタッチを拾う）
  const trackRef = useRef(null);              // 2面を並べた帯（これを動かす）
  const pageRef = useRef(0); pageRef.current = page;
  // 開き直したら前回の選択を持ち越さない（別の日・別の相手の記録に前の入力が残らないように）
  useEffect(() => { setKind(""); setDetail(""); setReason(""); setPage(0); }, [app?.id]);
  const kinds = dayReportKinds(role);
  const day = workDate || ymdLocal(new Date());
  const selKind = kinds.find(k => k.v === kind);
  const needsDetail = !!selKind?.sub;

  // ── 指連動の横スライド（面の窓に直接張る。Reactのハンドラでは passive:false にできない）──
  useEffect(() => {
    const view = viewRef.current, track = trackRef.current;
    if (!view || !track) return;
    let sx = 0, sy = 0, axis = null, tracking = false, w = 1, dxNow = 0, raf = 0;
    const paint = () => { raf = 0; track.style.transform = `translateX(${-pageRef.current * w + dxNow}px)`; };
    const onStart = ev => {
      if (!ev.touches || ev.touches.length !== 1) { tracking = false; return; }
      sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; axis = null; tracking = true;
    };
    const onMove = ev => {
      if (!tracking) return;
      const dx = ev.touches[0].clientX - sx, dy = ev.touches[0].clientY - sy;
      if (!axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;   // 8px動くまで判定保留
        if (Math.abs(dy) >= Math.abs(dx)) { tracking = false; return; } // 縦＝面の中のスクロールに譲る
        axis = "h"; w = view.clientWidth || 1;
        track.style.transition = "none"; track.style.willChange = "transform";
      }
      if (ev.cancelable) ev.preventDefault();
      // 端では抵抗（1面目の右・2面目の左は行き止まり＝ゴムのように少しだけ動く）
      const raw = dx;
      const over = (pageRef.current === 0 && raw > 0) || (pageRef.current === 1 && raw < 0);
      dxNow = over ? raw * 0.25 : Math.max(-w, Math.min(w, raw));
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const settle = next => {
      track.style.willChange = "";
      track.style.transition = "transform .28s ease";
      dxNow = 0;
      if (next !== pageRef.current) setPage(next);           // Reactの値に戻す（transformはstyleで描く）
      else track.style.transform = `translateX(${-pageRef.current * w}px)`;
    };
    const onEnd = () => {
      if (!tracking) return;
      const a = axis; axis = null; tracking = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (a !== "h") return;
      // しきい値＝幅の30%か80pxの小さい方（指を離した位置で決める・速度は見ない）
      const far = Math.abs(dxNow) > Math.min(80, w * 0.3);
      settle(far ? (dxNow < 0 ? 1 : 0) : pageRef.current);
    };
    const onCancel = () => { if (tracking) { tracking = false; axis = null; settle(pageRef.current); } };
    view.addEventListener("touchstart", onStart, { passive: true });
    view.addEventListener("touchmove", onMove, { passive: false });
    view.addEventListener("touchend", onEnd, { passive: true });
    view.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      view.removeEventListener("touchstart", onStart);
      view.removeEventListener("touchmove", onMove);
      view.removeEventListener("touchend", onEnd);
      view.removeEventListener("touchcancel", onCancel);
    };
  }, [app?.id]);

  const submit = async () => {
    if (!app || !kind || submitting) return;
    if (needsDetail && !detail) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("attendance_events").insert({
        application_id: app.id, actor_id: meId, kind,
        detail: needsDetail ? detail : null,
        reason: reason.trim() || null, work_date: day,
      });
      if (error) { fbError(); alert("記録の保存に失敗しました：" + error.message); setSubmitting(false); return; }
      fbSuccess();
      onDone(app.id);
    } catch { alert("処理に失敗しました。"); }
    setSubmitting(false);
  };
  if (!app) return null;
  const dayLabel = (() => {
    const d = new Date(day + "T00:00:00");
    return isNaN(d) ? day : `${d.getMonth() + 1}/${d.getDate()}`;
  })();
  const ready = !!kind && (!needsDetail || !!detail);
  const paneStyle = { width:"50%", boxSizing:"border-box", padding:"0 24px", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" };

  return (
    <div onClick={()=>{ if (!submitting) onClose(); }} className="cb-lock-scroll"
      style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={ev=>ev.stopPropagation()}
        style={{ background:"#fff", borderRadius:16, maxWidth:420, width:"100%",
          height:"min(76vh, 560px)", maxHeight:"100%", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* 見出し（面をまたいで動かさない＝いまどの記録の話かを見失わせない） */}
        <div style={{ padding:"20px 24px 10px", flexShrink:0 }}>
          <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{dayLabel} の記録</p>
        </div>

        {/* 面の窓：ここでタッチを拾い、中の帯を指に追従させる */}
        <div ref={viewRef} style={{ flex:1, overflow:"hidden", minHeight:0 }}>
          <div ref={trackRef}
            style={{ display:"flex", width:"200%", height:"100%", transform:`translateX(-${page * 50}%)`, transition:"transform .28s ease" }}>
            {/* ── 1枚目：説明だけ ── */}
            <div style={paneStyle}>
              <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:"0 0 14px" }}>
                その日に起きたことを記録します。相手にお知らせが届き、記録として残ります。
              </p>
              <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:"0 0 14px" }}>
                何もなかった日は、記録しなくて大丈夫です。
              </p>
              <p className="f-sans" style={{ fontSize:14, color:"#444", lineHeight:1.9, margin:"0 0 18px" }}>
                作業全体の評価は、最終の作業日にお願いします。
              </p>
              <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:0 }}>指で横にスライドしても、次に進めます</p>
            </div>

            {/* ── 2枚目：選択肢と送信 ── */}
            <div style={paneStyle}>
              <div style={{ display:"grid", gap:8, marginBottom:14 }}>
                {kinds.map(k => {
                  const on = kind === k.v;
                  return (
                    <div key={k.v}>
                      <button onClick={()=>{ setKind(k.v); setDetail(""); }} className="f-sans"
                        style={{ display:"block", width:"100%", textAlign:"left", padding:"12px 14px", borderRadius:12, cursor:"pointer", boxSizing:"border-box",
                          border: on ? "2px solid #E24B4A" : "1px solid #EBEBEB", background: on ? "#FFF5F5" : "#fff" }}>
                        <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{k.l}</span>
                        <span style={{ display:"block", fontSize:12, color:"#717171", lineHeight:1.6, marginTop:3 }}>{k.d}</span>
                      </button>
                      {/* 内訳（選択式）：何が違ったか・どう終わったかを構造化して残す（detail列）。
                          自由記述に埋めない＝あとで「求人票と現実の一致」を集計できるデータになる */}
                      {on && k.sub && (
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6, margin:"8px 2px 0" }}>
                          {k.sub.map(sc => {
                            const son = detail === sc.v;
                            return (
                              <button key={sc.v} onClick={()=>setDetail(sc.v)} className="f-sans"
                                style={{ padding:"8px 12px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer",
                                  border: son ? "2px solid #E24B4A" : "1px solid #DDD",
                                  background: son ? "#E24B4A" : "#fff", color: son ? "#fff" : "#555" }}>{sc.l}</button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3}
                placeholder="状況を一言（任意・相手に届きます）"
                className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box", marginBottom:16 }} />
            </div>
          </div>
        </div>

        {/* 面の目印（タップでも移動できる＝タップ不能にしない・2026-08-03の原則）と操作 */}
        <div style={{ flexShrink:0, padding:"10px 24px 18px" }}>
          <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:10 }}>
            {[0, 1].map(i => (
              <button key={i} onClick={()=>setPage(i)} aria-label={i === 0 ? "説明" : "記録することを選ぶ"}
                style={{ width: page === i ? 18 : 7, height:7, borderRadius:4, border:"none", padding:0, cursor:"pointer",
                  background: page === i ? "#E24B4A" : "#E0E0E0", transition:"width .2s ease, background .2s ease" }} />
            ))}
          </div>
          {page === 0 ? (
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={onClose} disabled={submitting} className="f-sans"
                style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
              <button onClick={()=>setPage(1)} className="f-sans"
                style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>記録することを選ぶ →</button>
            </div>
          ) : (
            <div style={{ display:"flex", gap:8, justifyContent:"space-between", alignItems:"center" }}>
              <button onClick={()=>setPage(0)} disabled={submitting} className="f-sans"
                style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 戻る</button>
              {/* ★押せないボタンにしない（2026-08-03の原則）：未選択なら薄くして理由を添える */}
              <button onClick={submit} disabled={submitting} className="f-sans"
                style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (submitting || !ready) ? 0.5 : 1 }}>
                {submitting ? "送信中..." : "記録する"}
              </button>
            </div>
          )}
          {page === 1 && !ready && (
            <p className="f-sans" style={{ fontSize:11, color:"#B54A0E", textAlign:"right", margin:"8px 0 0" }}>
              {kind ? "何が違ったかを選んでください" : "記録することを選んでください"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
