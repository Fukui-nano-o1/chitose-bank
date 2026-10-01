// 応募UIの表示部品（第2次構造改革2026-08-18で JobSearchMapView.jsx から分離）。
//
// ★ここは【表示＋親から渡されたhandlerの発火】だけ：
//   何と書くか（applyBtnLabel）・押せるか（applyBtnDisabled）・押したらどうなるか（applyBtnOnClick）は
//   すべて親（JobSearchMapView）が決めて渡す。この層は判断しない。
//   子が「承認済みだからチャットへ」と判断を始めた時点で第二のコントローラーになる＝作らない。
// ★props名は親の識別子名と同一にしてある（改名しない）。名前を変えると、抽出先の
//   ローカル変数と衝突して静かに壊れる事故が起きる（2026-08-18・RelatedJobsで実際に踏んだ）。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。

import { Dots, NoticeJumpText } from "../../../../components/ui";
import { payLabel, payTermsLine } from "../../../../lib/utils";
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

