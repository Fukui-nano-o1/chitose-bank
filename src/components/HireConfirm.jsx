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
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { calFmtDate, ROLE_ORANGE, appPhaseKey, APP_PHASE_COLOR, payTermsLine, tenureLabel, yearMonthLabel } from "../lib/utils";
import { fetchJobRowForMe } from "../lib/jobForMe";
import { findDoubleBookingJob, doubleBookingWarning, HIRE_NAME_DISCLOSURE_NOTE } from "../lib/hire";
import { Avatar, Dots } from "./ui";
import { openApplicantSheet } from "../lib/previewBus";
import { NavIcon, NavIconInline } from "./NavIcons";

// 採用するページからの遷移の合図（応募者ページで該当のシートを開く）。ここに置くのは
// 「決める前に応募者ページで詳しく見る」の導線が両方の入口で同じになるようにするため
export const HIRE_SHEET_PATH = "/profile/employer/applicants";
export function markHireSheet(applicationId) {
  try {
    sessionStorage.setItem("cb_appFilter", "interview");                            // 着地先の絞り込みを「面接中」に
    if (applicationId) sessionStorage.setItem("cb_openApplicantId", applicationId);  // その応募のシートを自動展開
  } catch {}
}

// 明細の行（ラベル＋値）＝Airbnbの内訳行の写し。★flexの潰れ対策：ラベル側に flexShrink:0
// （2026-08-23「1文字ずつの縦書き」の型＝値側は右寄せで折り返す）。※モジュールレベル定義を維持すること
function infoRow(label, value) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:12, padding:"9px 0", borderBottom:"1px solid #F4F4F4" }}>
      <span className="f-sans" style={{ flexShrink:0, fontSize:12, color:"#717171" }}>{label}</span>
      <span className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", textAlign:"right", minWidth:0 }}>{value}</span>
    </div>
  );
}
// 来られる日（応募時の申告・applications.available_dates）："any"＝期間中いつでもOK／
// 配列＝日付＋件数／null（単日求人など）＝行ごと出さない
function availText(avail) {
  if (avail === "any") return "期間中いつでもOK";
  if (!Array.isArray(avail) || avail.length === 0) return null;
  const ds = [...avail].sort();
  const shown = ds.slice(0, 3).map(calFmtDate).join("・");
  return ds.length > 3 ? `${shown} ほか${ds.length - 3}日（全${ds.length}日）` : `${shown}（${ds.length}日）`;
}
// 報酬の額。★合計は計算しない（働く日は採用後に決めるので掛け算は憶測になる）。
// 掲載の壁（2026-08-06）で数字のみが保証されているが、読めない値はそのまま出す（勝手に隠さない）
function wageText(job) {
  const fmt = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString() : v; };
  return [job.hourly_wage ? `時給 ${fmt(job.hourly_wage)}円` : null, job.daily_wage ? `日給 ${fmt(job.daily_wage)}円` : null]
    .filter(Boolean).join("・") || null;
}

export function HireConfirm({ app, meId, onClose, onHired }) {
  const [dup, setDup] = useState(null);          // 重なっている別の求人番号
  const [checking, setChecking] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [done, setDone] = useState(null);        // 採用の演出 { appId, name, jobNumber, extra, data }
  const [info, setInfo] = useState(null);        // ページの中身の材料 { job, avail, trust }（届いたぶんだけ描く）
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

  // ページの中身の材料（2026-08-31たきと指示「ページの内容もAirbnbをパクれ」＝Airbnbの承諾画面は
  // 相手の認証・予約の内容・お金・承諾すると何が起きるか、を1画面に並べる）。
  // ★取得はどれも既存の窓口だけ：求人＝fetchJobRowForMe（当事者の窓口）／来られる日＝applications
  // （農家の当事者RLS）／相手の身元＝worker_trust_info（応募を受けた農家は閲覧資格あり・信頼カードと同じRPC）。
  // ★届かなくても採用は止めない＝その区画を描かないだけ（表示のフェイルオープン・2026-08-07規則）
  useEffect(() => {
    if (!appId) { setInfo(null); return; }
    let cancelled = false;
    setInfo(null);
    (async () => {
      const [jobRes, appRes, trustRes] = await Promise.all([
        fetchJobRowForMe(app.job_number).catch(() => ({ data: null })),
        supabase.from("applications").select("available_dates").eq("id", appId).maybeSingle(),
        app.partner_id ? Promise.resolve(supabase.rpc("worker_trust_info", { p_worker_id: app.partner_id })).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setInfo({
        job: jobRes?.data || null,
        avail: appRes?.error ? null : (appRes?.data?.available_dates ?? null),
        trust: (trustRes?.data && trustRes.data.ok) ? trustRes.data : null,
      });
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
      {/* ═══ 最終確認＝全画面テイクオーバー（ページ遷移しない） ═══
          ★2026-08-31たきと指示「Airbnbをパクれ」：Airbnbの承諾（予約リクエストのAccept）は
          小さなボックスでも別ページへの遷移でもなく、白い全画面が乗る形（左上に✕・中身は縦スクロール・
          下部に固定の大きな実行ボタン）→ 成立の画面に「ゲストにメッセージを送る」のCTA。
          評価・記録（FinalReviewSheet/DayReportSheet・同日）と同じ器に揃えた。
          OKを押した時だけ confirm_terms が走る。ここに出す情報は「後戻りできない判断」に必要なものだけ */}
      {app && !done && (
        <div onClick={ev=>ev.stopPropagation()} className="cb-lock-scroll"
          style={{ position:"fixed", inset:0, zIndex:9200, background:"#fff", display:"flex", flexDirection:"column", animation:"fadeIn .2s ease" }}>
          {/* とじる＝左上の✕（やめるボタンは廃止＝✕が担う） */}
          <div style={{ flexShrink:0, padding:"calc(10px + env(safe-area-inset-top, 0px)) 16px 6px" }}>
            <button onClick={()=>{ if (!hiring) onClose?.(appId, false); }} disabled={hiring} aria-label="とじる"
              style={{ width:36, height:36, borderRadius:"50%", border:"1px solid #EBEBEB", background:"#fff", color:"#222", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>
              <NavIcon name="close" size={16} />
            </button>
          </div>
          <div style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"6px 24px 24px" }}>
            <div style={{ maxWidth:560, margin:"0 auto" }}>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"0 0 6px" }}>採用の最終確認</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 14px" }}>面接を終えてから決めてください</p>
            {/* ═ 相手（Airbnbのゲストカードの写し＝人と認証だけ。仕事の中身は下の区画へ） ═ */}
            <div style={{ display:"flex", alignItems:"center", gap:12, background:"#F7F7F7", borderRadius:12, padding:"14px", marginBottom:12 }}>
              <Avatar url={app.partner_avatar} name={app.partner_name || "？"} size={52} ring={phaseColor} bg={ROLE_ORANGE} />
              <div style={{ minWidth:0 }}>
                <p className="f-sans" style={{ fontSize:16, fontWeight:800, color:"#222", margin:0 }}>{app.partner_name ? app.partner_name + "さん" : "この方"}</p>
                {/* 身元の事実＝信頼カードと同じ2つだけ（利用歴・連絡先確認済み）。実績の数字は
                    出さない＝数字は記録の面が持つ（2026-08-07の整理を崩さない） */}
                {info?.trust && (info.trust.joined_at || info.trust.verified_at) && (
                  <p className="f-sans" style={{ fontSize:11, color:"#717171", margin:"4px 0 0", lineHeight:1.7 }}>
                    {info.trust.joined_at ? `chitose-bank利用${tenureLabel(info.trust.joined_at)}` : ""}
                    {info.trust.joined_at && info.trust.verified_at ? "　" : ""}
                    {info.trust.verified_at ? <span style={{ color:"#B05A2A", fontWeight:600 }}><NavIconInline name="tick" size={11} style={{ verticalAlign:"-1.5px" }} />連絡先確認済み（{yearMonthLabel(info.trust.verified_at)}）</span> : null}
                  </p>
                )}
              </div>
            </div>
            {/* 二重予約の警告（lib/hire）。下調べ中はその旨を出す＝「警告が無い」のか
                「まだ調べ終わっていない」のかを取り違えさせない */}
            {checking ? (
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 10px" }}>日程の重なりを確認中<Dots /></p>
            ) : dup ? (
              <p className="f-sans" style={{ fontSize:12, color:"#B54A0E", background:"#FFF6EE", border:"1px solid #F3D3B5", borderRadius:10, padding:"10px 12px", lineHeight:1.7, margin:"0 0 10px" }}>{doubleBookingWarning(dup)}</p>
            ) : null}
            {/* ═ 仕事の内容（Airbnbの予約の内容の写し）＝appのぶんは必ず出る・求人の行が届いたら場所も ═ */}
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"14px 0 2px" }}>仕事の内容</p>
            <div style={{ marginBottom:4 }}>
              {infoRow("求人", <>{titleOf(app)} <span style={{ color:"#999" }}>#{app.job_number}</span></>)}
              {infoRow("日程", dateOf(app))}
              {app.work_time ? infoRow("勤務時間", app.work_time) : null}
              {info?.job && (info.job.city || info.job.town) ? infoRow("場所", `${info.job.city || ""}${info.job.town || ""}`) : null}
              {availText(info?.avail) ? infoRow("来られる日", availText(info.avail)) : null}
            </div>
            {/* ═ 報酬と支払い（Airbnbの受取額の内訳の写し）＝金額の話を承諾の画面に必ず置く。
                ★合計の見積もりは作らない：働く日は採用後に決める（働く日を決める）ので、期間×日給の
                掛け算は憶測になる（憲法3条）。事実（額と支払条件）だけを出す ═ */}
            {info?.job && (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"14px 0 2px" }}>報酬と支払い</p>
                <div style={{ marginBottom:4 }}>
                  {wageText(info.job) ? infoRow("報酬", wageText(info.job)) : null}
                  {infoRow("支払い", payTermsLine({ payTiming: info.job.pay_timing, payMethod: info.job.pay_method }).replace(/^支払：/, ""))}
                </div>
              </>
            )}
            {/* ═ 採用すると（Airbnbの「承諾すると予約が確定します」の写し）＝何が起きるかを先に全部言う。
                1つ目は本名の相互開示の明示（2026-07-30たきと裁定(B)・採用confirmに必ず入れる） ═ */}
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"14px 0 8px" }}>採用すると</p>
            <div style={{ background:"#F7F7F7", borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
              {[
                HIRE_NAME_DISCLOSURE_NOTE,
                "労働条件がいまの内容で確定し、労働条件通知書としてお互いに残ります。",
                "カレンダーに確定の予定として表示されます。",
                info?.job?.headcount ? `募集人数（${info.job.headcount}人）に達すると、残りの応募は自動で見送りになります。` : "募集人数に達すると、残りの応募は自動で見送りになります。",
              ].map((t, i) => (
                <p key={i} className="f-sans" style={{ display:"flex", gap:8, fontSize:12, color:"#555", lineHeight:1.7, margin: i === 0 ? 0 : "8px 0 0" }}>
                  <span style={{ flexShrink:0, color:"#00A86B", marginTop:1 }}><NavIconInline name="tick" size={12} style={{ marginRight:0 }} /></span>
                  <span>{t}</span>
                </p>
              ))}
            </div>
            {/* 決める前に見る導線：後戻りできない判断の前に、やり取りと応募者の中身を見に行ける道を必ず残す。
                ★どちらも【先に onClose()】＝この全画面を畳んでから運ぶ（2026-09-01たきと報告
                  「応募者ページに遷移しない」の修理）。畳まないと、URLだけ変わって全画面が上に残る＝
                  何も起きていないように見える。さらに応募者ページから開いた時は行き先が同じURLなので
                  hashchange も起きず、本当に何も起きていなかった */}
            <div style={{ display:"flex", justifyContent:"center", gap:16 }}>
              <button onClick={()=>{ if (hiring) return; if (onClose) onClose(); window.location.hash = "/chat/" + app.application_id; }} className="f-sans"
                style={{ background:"none", border:"none", padding:0, fontSize:12, fontWeight:700, color:"#00A86B", cursor:"pointer", textDecoration:"underline" }}>チャットを見る</button>
              <button onClick={()=>{
                  if (hiring) return;
                  markHireSheet(app.application_id);        // 別ページから来た時＝着地後のローダーが拾ってシートを開く
                  openApplicantSheet(app.application_id);   // 既に応募者ページに居る時＝その場でシートを開く
                  if (onClose) onClose();
                  window.location.hash = HIRE_SHEET_PATH;
                }} className="f-sans"
                style={{ background:"none", border:"none", padding:0, fontSize:12, fontWeight:700, color:"#717171", cursor:"pointer", textDecoration:"underline" }}>応募者ページで詳しく見る</button>
            </div>
            </div>
          </div>
          {/* 下部の固定バー（Airbnbの下部ボタンの写し）：実行は全幅の1つだけ */}
          <div style={{ flexShrink:0, borderTop:"1px solid #EBEBEB", padding:"12px 24px calc(14px + env(safe-area-inset-bottom, 0px))", background:"#fff" }}>
            <button onClick={runHire} disabled={hiring || checking} className="f-sans"
              style={{ display:"block", width:"100%", maxWidth:560, margin:"0 auto", padding:"14px 20px", fontSize:15, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer", opacity: (hiring || checking) ? 0.5 : 1 }}>
              {hiring ? <>採用しています<Dots /></> : "OK（採用する）"}
            </button>
          </div>
        </div>
      )}

      {/* ═══ 採用アニメーション＝成立の画面（2026-08-06たきと指示・2026-08-31 Airbnb型に改定） ═══
          「採用」の判子が押印のように現れ、輪が広がり、光の粒が弾ける。人生の節目（契約成立）を祝う一拍。
          ★自動で閉じない：Airbnbの承諾成立の画面は「ゲストにメッセージを送る」のCTAを置いて
          利用者の選択を待つ。同じく「チャットを開く →」を主役に置き、とじるでその場に残る */}
      {done && (() => {
        return (
          <div onClick={closeDone} className="cb-lock-scroll"
            style={{ position:"fixed", inset:0, zIndex:9300, background:"#fff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, animation:"fadeIn .2s ease" }}>
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
              {done.name ? done.name + "さん" : "応募者"}と #{done.jobNumber} の契約が成立しました。
            </p>
            {done.extra && (
              <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.8, textAlign:"center", maxWidth:380, background:"#F7F7F7", borderRadius:10, padding:"10px 12px", margin:"14px 0 0", animation:"cbHireText .5s ease .7s both" }}>{done.extra}</p>
            )}
            {/* Airbnbの「ゲストにメッセージを送る」の写し＝次の一歩（作業日の相談）へ直行。
                ★stopPropagation：背景のonClick（closeDone）と同じイベントで二重に走らせない */}
            <div style={{ width:"100%", maxWidth:380, display:"grid", gap:8, marginTop:20, animation:"cbHireText .5s ease .8s both" }}>
              <button onClick={ev=>{ ev.stopPropagation(); const d = done; setDone(null); if (d) { onHired?.(d.appId, d.data); window.location.hash = "/chat/" + d.appId; } }} className="f-sans"
                style={{ padding:"14px 20px", fontSize:15, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>チャットを開く →</button>
              <button onClick={ev=>{ ev.stopPropagation(); closeDone(); }} className="f-sans"
                style={{ padding:"12px 20px", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>とじる</button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
