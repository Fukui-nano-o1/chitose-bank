// 採用の最終確認＋実行＋祝いの演出（2026-08-28に共有部品として切り出し）。
//
// ■なぜ1つの部品にするのか
// 採用の入口は複数あってよい（採用するページ／応募者シート／求人カード）が、
// 【確認に出すもの・二重予約の判定・実行・演出】は1箇所でなければ食い違う。
// 判定と文言は lib/hire（findDoubleBookingJob / doubleBookingWarning / HIRE_NAME_DISCLOSURE_NOTE）、
// 実行は confirm_terms＝人数上限・見送りの波及・権限・二重予約の壁はDB側が担保する。
// ★採用の確認を新しい場所に足す時は、必ずこの部品を使うこと（自前で confirm_terms を撃たない）。
//
// props:
//   app  … { application_id, partner_id, partner_name, partner_avatar, job_number,
//            crop, task, date_start, date_end, work_time }（null なら何も描かない）
//   meId … 農家（自分）の auth id。二重予約の下調べに使う
//   onClose(applicationId, hired) … 確認を閉じた時。hired=true なら採用が成立している
//   onHired(applicationId, data)  … 採用が成立した時（演出を閉じる前に呼ぶと親の再描画で演出が消えるため、
//                                   閉じた後に呼ぶ。data＝confirm_terms の返り値）
// ★モジュールレベル定義を維持すること（親の中で定義すると再レンダーのたびに作り直され、
//   確認カードが開き直る＝フォーカス消失バグの同族）
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { calFmtDate, ROLE_ORANGE, appPhaseKey, APP_PHASE_COLOR } from "../lib/utils";
import { findDoubleBookingJob, doubleBookingWarning, HIRE_NAME_DISCLOSURE_NOTE } from "../lib/hire";
import { Avatar, Dots } from "./ui";
import { NavIconInline } from "./NavIcons";

// 採用するページからの遷移の合図（応募者ページで該当のシートを開く）。ここに置くのは
// 「決める前に応募者ページで詳しく見る」の導線が両方の入口で同じになるようにするため
export const HIRE_SHEET_PATH = "/profile/employer/applicants";
export function markHireSheet(applicationId) {
  try {
    sessionStorage.setItem("cb_appFilter", "interview");                            // 着地先の絞り込みを「面接中」に
    if (applicationId) sessionStorage.setItem("cb_openApplicantId", applicationId);  // その応募のシートを自動展開
  } catch {}
}

export function HireConfirm({ app, meId, onClose, onHired }) {
  const [dup, setDup] = useState(null);          // 重なっている別の求人番号
  const [checking, setChecking] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [done, setDone] = useState(null);        // 採用の演出 { appId, name, jobNumber, extra, data }
  const appId = app?.application_id || null;

  // 開いたら二重予約の下調べ（応募者シート・採用するページと同じ判定＝lib/hire）
  useEffect(() => {
    if (!appId) { setDup(null); setChecking(false); return; }
    let cancelled = false;
    setDup(null); setChecking(true);
    (async () => {
      const d = meId ? await findDoubleBookingJob(meId, app.partner_id, app.job_number) : null;
      if (!cancelled) { setDup(d); setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app && !done) return null;

  const phase = appPhaseKey({ status: "approved" });
  const phaseColor = APP_PHASE_COLOR[phase];
  const titleOf = (t) => [t.crop, t.task].filter(Boolean).join(" ") || `求人 #${t.job_number}`;
  const dateOf = (t) => t.date_start
    ? (t.date_end && t.date_end !== t.date_start ? `${calFmtDate(t.date_start)}〜${calFmtDate(t.date_end)}` : calFmtDate(t.date_start))
    : "未設定";

  const runHire = async () => {
    if (!app || hiring) return;
    setHiring(true);
    // 二重予約はDB側 confirm_terms も同じ式で見張る（2026-08-06・警告の機構化）。警告を見て
    // OKした時（dupあり）だけ受諾フラグを渡す。下調べが取りこぼした時はDBが double_booked を
    // 返すので、確認カードに警告を出し直し、もう一度OKで受諾ありになる
    const { data, error } = await supabase.rpc("confirm_terms", {
      p_application_id: app.application_id, p_accept_double_booking: !!dup,
    });
    setHiring(false);
    if (!error && data?.reason === "double_booked") {
      setDup(data.dup_job); setChecking(false);
      alert("日程の重なる別の求人が見つかりました。警告の内容を確認のうえ、もう一度OKを押すと採用が確定します。");
      return;
    }
    if (error || !data?.ok) { alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    // 人数に達した場合、残りの応募はDB側（confirm_terms）が見送りにする。件数はそのまま伝える
    const closed = Array.isArray(data.closed_ids) ? data.closed_ids.length : 0;
    const extra = !data.filled ? "" : (closed > 0
      ? `募集人数に達したため、残りの応募 ${closed} 件は見送りになりました（お相手へ連絡済み）。`
      : "募集人数に達したため、この求人の募集は終了です。");
    setDone({ appId: app.application_id, name: app.partner_name, jobNumber: app.job_number, extra, data });
    onClose?.(app.application_id, true);   // 確認カードは閉じる（演出はこの部品がまだ出している）
  };

  // ★親へ知らせるのは演出を閉じた後（2026-08-06）：先に知らせると、親の再描画でこの部品がが
  //   消え、採用アニメーションが一瞬で消える
  const closeDone = () => {
    const d = done;
    setDone(null);
    if (d) onHired?.(d.appId, d.data);
  };

  return (
    <>
      <style>{`
@keyframes cbHireSeal{0%{transform:scale(.3) rotate(-18deg);opacity:0}45%{transform:scale(1.18) rotate(4deg);opacity:1}70%{transform:scale(.95) rotate(0)}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes cbHireRing{0%{transform:scale(.5);opacity:.55}100%{transform:scale(2.6);opacity:0}}
@keyframes cbHireBurst{0%{transform:translate(0,0) scale(.4);opacity:0}20%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
@keyframes cbHireText{0%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:1}}
`}</style>
      {/* ═══ 最終確認（画面内・ページ遷移しない） ═══
          OKを押した時だけ confirm_terms が走る。ここに出す情報は「後戻りできない判断」に必要なものだけ */}
      {app && !done && (
        <div onClick={()=>{ if (!hiring) onClose?.(appId, false); }} className="cb-lock-scroll"
          style={{ position:"fixed", inset:0, zIndex:9200, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={ev=>ev.stopPropagation()} style={{ width:"100%", maxWidth:420, maxHeight:"86vh", overflowY:"auto", background:"#fff", borderRadius:18, padding:"20px 18px calc(18px + env(safe-area-inset-bottom, 0px))", animation:"cbPop .18s ease" }}>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", textAlign:"center", margin:"0 0 4px" }}>最終確認</p>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 14px" }}>面接を終えてから決めてください</p>
            <div style={{ display:"flex", alignItems:"center", gap:12, background:"#F7F7F7", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
              <Avatar url={app.partner_avatar} name={app.partner_name || "？"} size={48} ring={phaseColor} bg={ROLE_ORANGE} />
              <div style={{ minWidth:0 }}>
                <p className="f-sans" style={{ fontSize:14, fontWeight:800, color:"#222", margin:0 }}>{app.partner_name ? app.partner_name + "さん" : "この方"}</p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"3px 0 0", overflow:"hidden", textOverflow:"ellipsis" }}>{titleOf(app)} <span style={{ color:"#999" }}>#{app.job_number}</span></p>
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"2px 0 0" }}><NavIconInline name="calendar" size={12} style={{ verticalAlign:"-1px" }} />{dateOf(app)}{app.work_time ? <>　<NavIconInline name="clock" size={12} style={{ verticalAlign:"-1px", marginRight:2 }} />{app.work_time}</> : ""}</p>
              </div>
            </div>
            {/* 二重予約の警告（lib/hire）。下調べ中はその旨を出す＝「警告が無い」のか
                「まだ調べ終わっていない」のかを取り違えさせない */}
            {checking ? (
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 10px" }}>日程の重なりを確認中<Dots /></p>
            ) : dup ? (
              <p className="f-sans" style={{ fontSize:12, color:"#B54A0E", background:"#FFF6EE", border:"1px solid #F3D3B5", borderRadius:10, padding:"10px 12px", lineHeight:1.7, margin:"0 0 10px" }}>{doubleBookingWarning(dup)}</p>
            ) : null}
            {/* 契約成立＝本名の相互開示の明示（2026-07-30たきと裁定(B)・採用confirmに必ず入れる） */}
            <p className="f-sans" style={{ fontSize:12, color:"#555", background:"#F7F7F7", borderRadius:10, padding:"10px 12px", lineHeight:1.7, margin:"0 0 16px" }}>{HIRE_NAME_DISCLOSURE_NOTE}</p>
            <div style={{ display:"grid", gap:8 }}>
              <button onClick={runHire} disabled={hiring || checking} className="f-sans"
                style={{ padding:"13px", fontSize:15, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (hiring || checking) ? 0.5 : 1 }}>
                {hiring ? <>採用しています<Dots /></> : "OK（採用する）"}
              </button>
              <button onClick={()=>onClose?.(appId, false)} disabled={hiring} className="f-sans"
                style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>やめる</button>
            </div>
            {/* 決める前に見る導線：後戻りできない判断の前に、やり取りと応募者の中身を見に行ける道を必ず残す */}
            <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:14 }}>
              <button onClick={()=>{ if (hiring) return; window.location.hash = "/chat/" + app.application_id; }} className="f-sans"
                style={{ background:"none", border:"none", padding:0, fontSize:12, fontWeight:700, color:"#00A86B", cursor:"pointer", textDecoration:"underline" }}>チャットを見る</button>
              <button onClick={()=>{ if (hiring) return; markHireSheet(app.application_id); window.location.hash = HIRE_SHEET_PATH; }} className="f-sans"
                style={{ background:"none", border:"none", padding:0, fontSize:12, fontWeight:700, color:"#717171", cursor:"pointer", textDecoration:"underline" }}>応募者ページで詳しく見る</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 採用アニメーション（2026-08-06たきと指示） ═══
          「採用」の判子が押印のように現れ、輪が広がり、光の粒が弾ける。人生の節目（契約成立）を祝う一拍。
          人数に達して他の応募が見送りになった時だけ、読み落とさないよう閉じるまで残す */}
      {done && (() => {
        const auto = !done.extra;
        return (
          <div onClick={closeDone} className="cb-lock-scroll"
            style={{ position:"fixed", inset:0, zIndex:9300, background:"rgba(255,255,255,0.96)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
            <div style={{ position:"relative", width:180, height:180, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {[0, 1, 2].map(i => (
                <span key={i} aria-hidden style={{ position:"absolute", width:110, height:110, borderRadius:"50%", border:"3px solid #00A86B", animation:`cbHireRing 1.5s ease-out ${0.15 + i * 0.28}s both` }} />
              ))}
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i / 12) * Math.PI * 2;
                const d = i % 2 === 0 ? 9 : 6;
                return (
                  <span key={"b" + i} aria-hidden style={{ position:"absolute", width:d, height:d, borderRadius:"50%", background:"#00A86B", ["--dx"]: Math.cos(a) * 92 + "px", ["--dy"]: Math.sin(a) * 92 + "px", animation:`cbHireBurst 1.1s ease-out ${0.2 + (i % 4) * 0.06}s both` }} />
                );
              })}
              <span className="f-sans" aria-hidden style={{ width:118, height:118, borderRadius:"50%", border:"5px solid #00A86B", color:"#00A86B",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, fontWeight:900, letterSpacing:".08em",
                animation:"cbHireSeal .7s cubic-bezier(.2,1.3,.4,1) both" }}>採用</span>
            </div>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#00A86B", margin:"8px 0 0", animation:"cbHireText .5s ease .45s both" }}>採用しました</p>
            <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.8, textAlign:"center", margin:"8px 0 0", animation:"cbHireText .5s ease .6s both" }}>
              {done.name ? done.name + "さん" : "応募者"}と #{done.jobNumber} の契約が成立しました。<br />作業日などの連絡はチャットでどうぞ。
            </p>
            {done.extra && (
              <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.8, textAlign:"center", maxWidth:380, background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:"14px 0 0", animation:"cbHireText .5s ease .7s both" }}>{done.extra}</p>
            )}
            {auto ? <AutoClose onDone={closeDone} /> : (
              <button onClick={closeDone} className="f-sans"
                style={{ marginTop:18, padding:"11px 26px", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", animation:"cbHireText .5s ease .8s both" }}>閉じる</button>
            )}
          </div>
        );
      })()}
    </>
  );
}

// 演出を一定時間で自動的に閉じる（タップでも閉じられる）。※モジュールレベル定義を維持すること
function AutoClose({ onDone, ms = 2600 }) {
  const cb = useRef(onDone); cb.current = onDone;
  useEffect(() => { const id = setTimeout(() => cb.current?.(), ms); return () => clearTimeout(id); }, [ms]);
  return null;
}
