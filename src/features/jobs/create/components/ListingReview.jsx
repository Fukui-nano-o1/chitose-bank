import { JobDetailBody } from "../../../../components/JobDetailBody";
import { NavIcon } from "../../../../components/NavIcons";
import { payTermsLine, CURRENT_PAY_POLICY } from "../../../../lib/utils";
import { RECRUITER_FIELDS } from "../listingPublicationPages";
import { isMultiDaySchedule } from "../listingNavigation.js";

// 掲載確認の表示だけを所有する。入力・保存・掲載判定・URLとモーダルの状態は
// LandingFlowに残し、編集/再確認はcallbackで親へ戻す。JobDetailBodyを複製しない。
// 掲載前の確認（step11）：値がまだ無い区画の代わりに出す空の区画（2026-09-19）。JobDetailBody は値の無い区画を
// 描かない（作業内容・作業日程）が、掲載前の確認では「未設定」と編集の入口を見せる必要がある。
// 見た目は JobDetailPanel の AirSection と同じ区切り（細い線＋太い見出し）。★モジュールレベル定義を維持すること
function ConfEmptySection({ title, children }) {
  return (
    <div style={{ borderTop:"1px solid #EBEBEB", marginTop:24, paddingTop:24 }}>
      <h3 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 14px" }}>{title}</h3>
      <p className="f-sans" style={{ fontSize:15, color:"#B0B0B0", margin:0 }}>{children}</p>
    </div>
  );
}

export function ListingReview({ job, me, employer, trust, farmerDisplayName, hasWorkVideo,
  wageLookupNotice, recruiterStatus, missingFields, onReloadRecruiter, onMissingField,
  onEditPage, onOpenPerks, onOpenProfile, onOpenIntro }) {
  // 確認画面の編集入口はJobDetailBodyの「編集」タブに集約する。
  const confDecorate = (label, node) => {
    switch (label) {
      case "写真": return (
        <div key={label}>
          {node}
          {job.photos.length === 0 && <p className="f-sans" style={{ fontSize:13, color:"#B0B0B0", textAlign:"center", margin:"8px 0 0" }}>写真は後から登録できます。いまは求人者のアイコンが表紙になります。</p>}
        </div>
      );
      case "求人タイトル・募集タグ": return (
        <div key={label}>
          {node}
          {/* 農園プロフィール未入力＝募集主の行が出ない。タップで入力ボックスを展開（2026-07-16の入口を維持） */}
          {!(employer && employer.nickname) && (
            <div onClick={onOpenProfile} role="button" style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginTop:16, cursor:"pointer" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center" }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", color:"#717171", marginBottom:8 }}><NavIcon name="farmer" size={24} /></div>
                <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, marginBottom:2 }}>{farmerDisplayName || "農園名未設定"}</p>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:0 }}>募集主の行・待遇・保険は、農園プロフィールから表示されます</p>
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#00A86B", margin:"8px 0 0" }}>タップして農園プロフィールを入力 →</p>
              </div>
            </div>
          )}
        </div>
      );
      case "作業内容": return (
        <div key={label}>
          {(job.jobBody && job.jobBody.trim()) ? node : <ConfEmptySection title="作業内容">未設定</ConfEmptySection>}
        </div>
      );
      case "待遇": return (
        <div key={label}>
          {node}
        </div>
      );
      case "報酬・勤務条件・日程": return (
        <div key={label}>
          {job.dateStart ? node : <ConfEmptySection title="作業日程">未設定</ConfEmptySection>}
        </div>
      );
      case "場所・地図": return (
        <div key={label}>{node}</div>
      );
      case "持ち物・備考・危険箇所・保険": return (
        <div key={label}>
          {node}
        </div>
      );
      default: return node;
    }
  };

  return (<>
    {/* タイトル */}
    <h2 className="f-sans" style={{ fontSize:"clamp(20px,3vw,30px)", fontWeight:850, color:"#222", marginBottom:6, lineHeight:1.3 }}>
      掲載前に、内容を確認しましょう
    </h2>
    <p className="f-sans" style={{ fontSize:14, color:"#717171", marginBottom:20 }}>働き手に表示される内容です。直したい項目は、各区画の「編集」から直せます。</p>
    {wageLookupNotice}

    <div style={{ maxWidth:870, margin:"0 auto" }}>
      {/* 本文＝求人詳細ページ・ボックス版・審査プレビューと同じ JobDetailBody。募集主の材料（employer／trust）は
          本人のプロフィールを渡す＝求人番号の無い下書きでも募集主の行・募集主カード・保険が出る。
          仕事の内容／質問のタブも同じ（質問は draftJobNumber があるときだけ本物の求人Q&A） */}
      {recruiterStatus !== "ready" && <div role="status" className="listing-publication-error">
        <p>{recruiterStatus === "loading" ? "登録情報を確認しています…" : "登録情報を確認できませんでした。確認できるまで掲載しません。"}</p>
        <button type="button" className="listing-back" disabled={recruiterStatus === "loading"} onClick={onReloadRecruiter}>登録情報を再確認</button>
      </div>}
      {missingFields.length > 0 && <section className="listing-publication-error" aria-label="掲載前に確認が必要な項目">
        <h2>掲載前に確認が必要です</h2>
        {missingFields.map(item => <button key={item.label} type="button" className="listing-review-edit" onClick={() => onMissingField(item)}>{item.label}を確認</button>)}
      </section>}
      <JobDetailBody hideTopButton reviewEditContent={(
        <section className="listing-review-edit-index" aria-label="入力項目を編集">
          <h2>入力項目を編集</h2>
          <p>変更したい項目を選んでください。編集後は確認画面へ戻ります。</p>
          <div>{[
        ["crop","作物"],["task","作業"],["task_scope","作業の変更範囲"],
        ["workplace","集合場所"],["place_scope","場所の変更範囲"],["access","アクセス"],
        ["schedule","日程"],...(isMultiDaySchedule(job.dateStart,job.dateEnd)?[["holidays","期間内の休日"]]:[]),
        ["headcount","採用人数"],["work_time","勤務時間"],["break_time","休憩時間"],
        ["overtime","時間外労働"],["daily_wage","日給"],
        ["photos","写真"],...(job.photos.length?[["photo_captions","写真の説明"]]:[]),
        ["description","作業の説明"],["work_video","YouTube動画"],
        ...(hasWorkVideo?[["video_consent","動画の利用同意"]]:[]),
        ["danger_places","危険な場所"],["danger_tasks","危険な作業"],
        ["belongings","持ち物"],["cautions","注意事項"],
        ["worker_preferences","経験に関する希望"],["repeat_approval","リピーターの自動承認"],
        ...Object.entries(RECRUITER_FIELDS).map(([id, field])=>[id,field.title]),
        ["smoking_policy","受動喫煙の状況"]
      ].map(([id,title])=><button type="button" className="listing-review-edit" key={id} data-edit-page={id} onClick={() => onEditPage(id)}><span>{title}</span><span aria-hidden="true">編集 ›</span></button>)}</div>
          <button type="button" className="listing-review-edit" onClick={onOpenPerks}><span>待遇</span><span aria-hidden="true">編集 ›</span></button>
        </section>
      )} job={job} me={me} employer={employer} trust={trust}
        onOpenIntro={(employer && employer.nickname) ? onOpenIntro : undefined}
        decorate={confDecorate} />
      {/* 報酬バー＝求人詳細ページの下の応募バー（報酬＋支払条件）に当たる部分（審査プレビューと同じ置き方）。
          本文は報酬を持たないのでここに置く。sticky＝スクロールの下端に留まる。右端は本文の「トップ」浮遊ボックス
          （56px・zIndex5）が重なる場所なので空けておく（zIndexはそれより下） */}
      <div style={{ position:"sticky", bottom:0, zIndex:4, background:"#fff", borderTop:"1px solid #EBEBEB", padding:"10px 68px 10px 0", marginTop:16, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ minWidth:0 }}>
          <span className="f-mono" style={{ display:"block", fontSize:18, fontWeight:800, color: job.pay > 0 ? "#222" : "#B0B0B0" }}>{job.pay > 0 ? `日給${job.pay.toLocaleString()}円` : "報酬 未設定"}</span>
          {/* draftはDB列が入る前なので「現在の固定ポリシー」を共通定数から表示（2026-08-02・ハードコード廃止） */}
          <span className="f-sans" style={{ display:"block", fontSize:12, color:"#717171", lineHeight:1.5, marginTop:2 }}>{payTermsLine(CURRENT_PAY_POLICY)}</span>
        </div>
      </div>
    </div>
  </>);
}
