// 応募UIの表示部品（第2次構造改革2026-08-18で JobSearchMapView.jsx から分離）。
//
// ★ここは【表示＋親から渡されたhandlerの発火】だけ：
//   何と書くか（applyBtnLabel）・押せるか（applyBtnDisabled）・押したらどうなるか（applyBtnOnClick）は
//   すべて親（JobSearchMapView）が決めて渡す。この層は判断しない。
//   子が「承認済みだからチャットへ」と判断を始めた時点で第二のコントローラーになる＝作らない。
// ★props名は親の識別子名と同一にしてある（改名しない）。名前を変えると、抽出先の
//   ローカル変数と衝突して静かに壊れる事故が起きる（2026-08-18・RelatedJobsで実際に踏んだ）。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { NavIconInline } from "../../../../components/NavIcons";

import { Dots, NoticeJumpText } from "../../../../components/ui";
import { payLabel, payTermsLine, calFmtDate } from "../../../../lib/utils";
// 右カラムの応募パネル（給与・最高額・CTA・支払条件・補足文）
export function ApplyPanel({ selectedJob, applyPanelRef, maxPay, hideApply, applying, applyBtnOnClick, applyBtnDisabled, applyBtnStyle, applyBtnLabel, closedLabel }) {
  return (<>
    {/* 右カラム: 応募パネル（段階2-a・ガワのみ。応募は実稼働しない）
        外側はグリッドのstretchで左カラムの高さまで伸びるラッパー（枠なし＝sticky可動域の確保用）。
        内側が見た目の白い枠（中身の高さにしか伸びない） */}
    <div>
    <div ref={applyPanelRef} className="job-apply-panel" style={{
      position:"sticky", background:"#fff", border:"1px solid #EBEBEB",
      borderRadius:16, padding:"20px", marginBottom:5,
    }}>
      {/* 給与 */}
      <p className="f-mono" style={{ fontSize:22, fontWeight:800, color:"#222", margin:0, marginBottom:6 }}>
        {payLabel(selectedJob)}
      </p>

      {/* 最高額（自動計算・休憩1hダミー前提） */}
      <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:0, marginBottom:16 }}>
        期間内に全て勤務した場合の最高額: {maxPay != null ? `¥${maxPay.toLocaleString()}` : "—"}
      </p>

      <div style={{ height:1, background:"#EBEBEB", margin:"0 0 16px" }} />

      {/* CTAボタン（募集終了・未応募なら「募集終了」表示で押下不可） */}
      <button
        onClick={hideApply ? undefined : applyBtnOnClick}
        disabled={hideApply || applying || applyBtnDisabled}
        className="btn-primary f-sans"
        style={{ width:"100%", padding:"16px", fontSize:15, fontWeight:700, borderRadius:14, ...(hideApply ? { background:"#EBEBEB", color:"#717171" } : applyBtnStyle) }}
      >{hideApply ? closedLabel : applyBtnLabel}</button>
      {/* 掲載時に確定保存された支払条件を表示（2026-08-02・ハードコード廃止） */}
      <p style={{ fontSize:12, color:"#888", textAlign:"center", marginTop:8 }}><NoticeJumpText text={payTermsLine(selectedJob)} /></p>

      {/* 補足文 */}
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", textAlign:"center", margin:0, marginTop:10 }}>
        まだ応募は確定しません。正確な金額は面接後に決定します。
      </p>

    </div>
    </div>
  </>);
}

// PC専用の下固定応募バー（応募パネルが画面外に出たら表示）
export function ApplyBarPC({ selectedJob, showApplyBar, isOwnJob, ownLoaded, hideApply, applying, applyBtnOnClick, applyBtnDisabled, applyBtnStyle, applyBtnLabel, closedLabel }) {
  return (<>
    {/* PC専用：下固定の応募バー（応募パネルが画面外に出たら表示。スマホはCSSでdisplay:none）。募集終了かつ未応募では非表示（2026-07-24） */}
    {selectedJob && showApplyBar && ownLoaded && !isOwnJob && (
      <div className="pc-apply-bar" style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:500,
        background:"#fff", borderTop:"1px solid #EBEBEB",
        padding:"16px 24px", boxShadow:"0 -4px 16px rgba(0,0,0,0.08)",
        alignItems:"center", justifyContent:"space-between", gap:24,
      }}>
        <span className="f-mono" style={{ fontSize:18, fontWeight:800, color:"#222" }}>{payLabel(selectedJob)}</span>
        <button
          onClick={hideApply ? undefined : applyBtnOnClick}
          disabled={hideApply || applying || applyBtnDisabled}
          className="btn-primary f-sans"
          style={{ padding:"14px 32px", fontSize:15, fontWeight:700, borderRadius:14, whiteSpace:"nowrap", ...(hideApply ? { background:"#EBEBEB", color:"#717171" } : applyBtnStyle) }}
        >{hideApply ? closedLabel : applyBtnLabel}</button>
      </div>
    )}
  </>);
}

// スマホ専用の常時表示の下部応募フッター
export function ApplyBarMobile({ selectedJob, isOwnJob, ownLoaded, setOwnMenuOpen, hideApply, applying, applyBtnOnClick, applyBtnDisabled, applyBtnStyle, applyBtnLabel, closedLabelShort }) {
  return (<>
    {/* 求人詳細（スマホ専用）：常時表示の下部応募フッター。スクロール中は非表示(CSS)。自分の求人には出さない（2026-07-22）。
        募集終了（満員／期間終了）かつ未応募でも、構造は同じままボタンを「この募集は終了しました」の
        灰色・押せない状態にする（2026-07-27たきと指示。以前はフッターごと消していたため、訪問者には
        下部ナビだけが残り、終了したことが伝わらなかった） */}
    {selectedJob && ownLoaded && !isOwnJob && (
      <div className="mobile-apply-bar" style={{ boxShadow:"0 -4px 16px rgba(0,0,0,0.08)" }}>
        {/* 並び入れ替え（2026-07-16）：日給＋応募ボタンが上・注記が下 */}
        {/* バランス修正（2026-07-24）：報酬は1行固定(flexShrink:0)・ボタンは残り幅(flex:1)で長いラベル
            （「承認されました — チャットを開く」等）は2行に折り返す＝画面から見切れない */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <span className="f-mono" style={{ fontSize:16, fontWeight:800, color:"#222", flexShrink:0, whiteSpace:"nowrap" }}>{payLabel(selectedJob)}</span>
          <button
            data-guide="apply-btn"
            onClick={hideApply ? undefined : applyBtnOnClick}
            disabled={hideApply || applying || applyBtnDisabled}
            className="btn-primary f-sans"
            style={{ flex:1, minWidth:0, padding:"12px 12px", fontSize:14, fontWeight:700, borderRadius:14, lineHeight:1.35, textAlign:"center", ...(hideApply ? { background:"#EBEBEB", color:"#717171" } : applyBtnStyle) }}
          >{hideApply ? closedLabelShort : applyBtnLabel}</button>
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#888", textAlign:"center", margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {hideApply ? "ほかの求人は「さがす」から見られます" : "応募しても即採用ではなく、面接後に決まります"}
        </p>
      </div>
    )}
    {/* 本人の求人（スマホ）：同じ構造で応募ボタンの位置に「あなたの求人」（2026-08-15たきと指示） */}
    {selectedJob && ownLoaded && isOwnJob && (
      <div className="mobile-apply-bar" style={{ boxShadow:"0 -4px 16px rgba(0,0,0,0.08)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <span className="f-mono" style={{ fontSize:16, fontWeight:800, color:"#222", flexShrink:0, whiteSpace:"nowrap" }}>{payLabel(selectedJob)}</span>
          {/* data-guide="own-job-btn"＝この画面の説明が「自分の求人の詳細」だと見分ける目印＋スポットライトの的
              （2026-09-02たきと指示「自分の求人詳細は分けて説明しよう」）。応募ボタンの apply-btn と対 */}
          <button data-guide="own-job-btn" onClick={()=>setOwnMenuOpen(true)} className="btn-primary f-sans"
            style={{ flex:1, minWidth:0, padding:"12px 12px", fontSize:14, fontWeight:700, borderRadius:14, lineHeight:1.35, textAlign:"center" }}>あなたの求人</button>
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#888", textAlign:"center", margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          あなたが出した求人です。タップで操作できます
        </p>
      </div>
    )}
  </>);
}

// 応募の確認ボックス（3〜4面・期間求人は来られる日の選択つき）
export function ApplyConfirmBox({ selectedJob, applyConfirmOpen, setApplyConfirmOpen, applyConfirmStep, setApplyConfirmStep, applyChoice, setApplyChoice, applyDates, setApplyDates, setApplyImgZoom, applyAvailRef, isPeriodJob, periodDays, applying, handleApply }) {
  return (<>
    {applyConfirmOpen && selectedJob && (
      <div onClick={()=>setApplyConfirmOpen(false)} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:9000 }}>
        {/* ★高さは3面とも固定（2026-08-16たきと報告「次へをタップするとボックスが閉じてしまう」の根治）：
            面ごとに中身の高さが違うと、次へのタップでボックスが縮んでボタンが上へ移動し、続けてタップする
            指が「さっきボタンがあった場所」＝ボックスの外（黒い被せ）に落ちて閉じていた（2026-07-27の
            日程チップ誤タップと同型）。中身だけ内側でスクロールし、次へ/戻るは下部に常設＝何も動かない。
            高さの式＝1面目の画像（フルブリード幅×3/4）が余白なくちょうど収まる高さ（2026-08-16たきと指示
            「画像を枠にきれいに収めて。空白は寂しいよ」）。240px=タイトル・区切り線・案内文・ドット・
            ボタン・上下パディングの合計。3面とも同じ高さ＝固定の原則は不変 */}
        <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet" style={{ height:"calc((min(100vw - 32px, 480px) - 6px) * 0.75 + 240px)", display:"flex", flexDirection:"column" }}>
          {/* ✕ボタンは置かない（2026-07-27たきと指示）：ボックス外タップ＋下部「戻る」で閉じられるので重複 */}
          {/* 3面切り替え（2026-08-16たきと指示）：1面目=承認の流れ図（タップで大画面）／2面目=説明（文字18に拡大）／
              3面目=日程・応募。次へ/戻るで行き来し、1面目の戻るはボックスを閉じる */}
          <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0, flexShrink:0 }}><NoticeJumpText text="応募の確認" /></p>
          <div style={{ height:1, background:"#E5E5E5", margin:"14px 0", flexShrink:0 }} />
          {/* ★スクロール領域は負マージンでボックスの余白(24px)まで広げ、同じ24pxを内側paddingで戻す。
              こうしないと、フルブリード画像（負マージン）の左24pxがスクロール領域の左端でクリップされて
              見切れる（スクロール容器は左上へのはみ出しを表示できない・2026-08-16たきと報告の修理） */}
          <div style={{ flex:"1 1 auto", minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", margin:"0 -24px", padding:"0 24px" }}>
          {applyConfirmStep === 0 && (
            /* 画像は枠いっぱい（フルブリード＝左右パディング24pxを負マージンで打ち消す）＋縦は中央寄せ
               ＝空白を作らない（2026-08-16たきと指示）。aspectRatioで場所の先確保は維持（2026-07-27） */
            <div style={{ minHeight:"100%", display:"flex", flexDirection:"column", justifyContent:"center" }}>
              {/* 承認の流れ（①プロフィール確認②判断③承認決定）のインフォグラフィック＝応募前に承認制であることを伝える */}
              <img loading="lazy" src="/apply-approval-flow.jpg" alt="承認の流れ：応募者のプロフィールを見て、承認するか決めます"
                onClick={()=>setApplyImgZoom(true)}
                width={1000} height={750} style={{ display:"block", width:"calc(100% + 48px)", maxWidth:"none", margin:"0 -24px", height:"auto", aspectRatio:"1000 / 750", background:"#F7F7F7", cursor:"zoom-in" }} />
              <p className="f-sans" style={{ fontSize:13, color:"#8A8A8A", textAlign:"center", margin:"10px 0 0" }}>画像はタップで大きく表示できます</p>
            </div>
          )}
          {applyConfirmStep === 1 && (
            /* 説明も縦中央寄せ＝1面目と同じ高さの枠で空白が上下に割れて意図した見た目になる */
            <div style={{ minHeight:"100%", display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>
                応募はまだ採用ではありません。承認前であれば、「あなたの応募」ページからいつでも取り消せます。
              </p>
              {/* 文字18に拡大（2026-08-16たきと指示「2枚目のスクショの文字を大きく」・旧13/#8A8A8A） */}
              <p className="f-sans" style={{ fontSize:18, color:"#555", lineHeight:1.7, margin:"14px 0 0", background:"#F7F7F7", borderRadius:10, padding:"12px 14px" }}>
                採用されると契約が成立し、お互いのお名前（本名）が農家に表示されます。雇用の手続き（労働者名簿・賃金の記録）に必要なためです。
              </p>
            </div>
          )}
          {applyConfirmStep === 2 && (isPeriodJob ? (
            /* 期間求人：来られる日を宣言してから応募（いつでもOK=1タップで即応募／特定日=複数選択→下部の応募ボタン） */
            /* ★この面では応募しない（2026-08-16たきと指示「どちらも最終確認をして」）：
               いつでもOKも日程選択も、選ぶだけで4面目（最終確認）へ進む。応募の実行は4面目の「応募する」のみ */
            <div>
              <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>来られる日を選んでください</p>
              <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 14px", lineHeight:1.6 }}>この求人は期間募集です。来られる日を農家に伝えてから応募します。</p>
              <button onClick={()=>{ setApplyChoice("any"); setApplyConfirmStep(3); }} className="f-sans" style={{ width:"100%", padding:"16px", fontSize:16, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:14, cursor:"pointer", marginBottom:16 }}><NavIconInline name="circleO" size={16} style={{ verticalAlign:"-2.5px" }} />期間中いつでもOK</button>
              <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", margin:"0 0 12px" }}>または、来られる日を選ぶ</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {periodDays.map(d => {
                  const on = applyDates.includes(d);
                  return (
                    <button key={d} onClick={()=>setApplyDates(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])} className="f-sans" style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{calFmtDate(d)}</button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ minHeight:"100%", display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>
                「応募する」を押すと、農家に応募が届きます。
              </p>
            </div>
          ))}
          {applyConfirmStep === 3 && isPeriodJob && (
            /* 4面目＝最終確認（期間求人のみ）：選んだ内容をそのまま見せてから応募する */
            <div style={{ minHeight:"100%", display:"flex", flexDirection:"column", justifyContent:"center" }}>
              <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 10px" }}>応募の最終確認</p>
              <div className="f-sans" style={{ fontSize:18, color:"#222", lineHeight:1.7, background:"#F7F7F7", borderRadius:10, padding:"12px 14px" }}>
                来られる日：{applyChoice === "any" ? <><NavIconInline name="circleO" size={17} style={{ verticalAlign:"-3px" }} />期間中いつでもOK</> : `${[...applyDates].sort().map(calFmtDate).join("・")}（${applyDates.length}日）`}
              </div>
              <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:"14px 0 0" }}>
                「応募する」を押すと、この内容で農家に応募が届きます。
              </p>
            </div>
          )}
          </div>
          {/* 面インジケーター（単日3点・期間4点）＋次へ/戻る（下部に常設・スクロールしなくても必ず見える） */}
          <div style={{ display:"flex", justifyContent:"center", gap:6, margin:"14px 0 0", flexShrink:0 }}>
            {(isPeriodJob ? [0,1,2,3] : [0,1,2]).map(i => <span key={i} style={{ width:7, height:7, borderRadius:"50%", background: i===applyConfirmStep ? "#00A86B" : "#DDD" }} />)}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:14, flexShrink:0 }}>
            <button onClick={()=>{ if (applyConfirmStep === 0) setApplyConfirmOpen(false); else setApplyConfirmStep(s=>s-1); }} className="f-sans" style={{ flex:1, padding:"14px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>戻る</button>
            {applyConfirmStep < 2 ? (
              <button onClick={()=>setApplyConfirmStep(s=>s+1)} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12 }}>次へ</button>
            ) : isPeriodJob && applyConfirmStep === 2 ? (
              /* 期間求人の2面目＝日程を選んで次へ（応募はまだしない）。いつでもOKは上の大ボタンから直接4面目へ */
              <button onClick={()=>{ if (applyDates.length===0) return; setApplyChoice("dates"); setApplyConfirmStep(3); }} disabled={applyDates.length===0} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, opacity: applyDates.length===0 ? 0.5 : 1, cursor: applyDates.length===0 ? "not-allowed" : "pointer" }}>{`この日程で次へ${applyDates.length>0 ? `（${applyDates.length}日）` : ""}`}</button>
            ) : isPeriodJob ? (
              /* 期間求人の4面目＝最終確認からの応募実行（唯一の応募ボタン） */
              <button onClick={()=>{ if (applyChoice !== "any" && applyDates.length===0) return; applyAvailRef.current = applyChoice === "any" ? "any" : [...applyDates].sort(); setApplyConfirmOpen(false); handleApply(); }} disabled={applying || (applyChoice !== "any" && applyDates.length===0)} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, opacity: (applying || (applyChoice !== "any" && applyDates.length===0)) ? 0.6 : 1 }}>{applying ? <>送信中<Dots /></> : "応募する"}</button>
            ) : (
              <button onClick={()=>{ applyAvailRef.current = null; setApplyConfirmOpen(false); handleApply(); }} disabled={applying} className="btn-primary f-sans" style={{ flex:2, padding:"14px", fontSize:14, fontWeight:700, borderRadius:12, opacity: applying ? 0.6 : 1 }}>{applying ? <>送信中<Dots /></> : "応募する"}</button>
            )}
          </div>
        </div>
      </div>
    )}
  </>);
}

