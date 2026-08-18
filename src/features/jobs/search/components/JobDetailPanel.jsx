// 求人詳細の表示部品（第2次構造改革2026-08-18で JobSearchMapView.jsx から分離）。
// ★ここは【表示だけ】：job（＝job）を受け取って描くのみ。
//   state の所有・URL/hash の制御・応募の判断は一切持たない（親＝JobSearchMapView が持つ）。
//   子が「承認済みだからチャットへ」のような判断を始めた時点で第二のコントローラーになる。
//   この層はそれを作らないための境界。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
import { CalendarView } from "../../../../components/CalendarView";
import { JobLocationMap } from "../../../../components/JobLocationMap";
import { DangerItem, LinkifiedText, MaskedText, NoticeJumpText } from "../../../../components/ui";
import { EMPTY_MARK, disp, stationLabel, payLabel, payTermsLine, overtimeLine, calFmtDate } from "../../../../lib/utils";
// 求人の主要情報（日程・勤務時間・休憩・人数・最寄り駅・報酬・支払条件・時間外）
export function JobKeyFacts({ job }) {
  return (<>
    {/* 主要情報 */}
    <div style={{ width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
      <div className="job-detail-info-grid">
        {[
          // 日程は確認ページと同じ設計（2026-07-16）：「〜終了日」を下段に折り返し
          { label:"日程",     value: (job.dateLabel || "").replace("〜", "\n〜") },
          { label:"勤務時間", value: job.workTime },
          { label:"休憩時間", value: job.breakTime },
          { label:"採用人数", value: job.count },
          // 最寄り駅は訪問者にはDBがNULLで返る＝移動時間だけの表示になる。
          // 伏せ字は町域だけに絞る（2026-08-17たきと指示「町域だけモザイク処理」）ので、ここは伏せ字を置かない
          { label:"移動時間", value: stationLabel(job.nearestStation, job.commuteTime) },
          { label:"報酬",     value: payLabel(job) },
        // 値は文字列のほかReact要素（伏せ字を含む行）も入る＝要素は常に出す（2026-08-17）
        ].filter(row => typeof row.value === "object" ? !!row.value : (row.value && String(row.value).trim())).map(row => (
          <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center", textAlign:"center" }}>
            <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{row.label}</span>
            <span className="f-sans" style={{ fontSize:15, color:"#222", fontWeight:600, lineHeight:1.6, whiteSpace:"pre-line" }}>{row.value}</span>
          </div>
        ))}
      </div>
      {/* 掲載時に確定保存された支払条件を表示（2026-08-02・ハードコード廃止） */}
      {/* 支払条件は頭から1文字ずつ跳ねさせて目に留める（2026-08-14たきと指示・NoticeJumpText） */}
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}><NoticeJumpText text={payTermsLine(job)} /></p>
    </div>

    {/* 集合場所の表示は詳細ページから削除（2026-07-16）。承認後の共有はチャットの「はじめる前の確認」カードに一本化 */}
  </>);
}

// 作業の説明と、経験・持ち物・備考（配列駆動・未入力は「ー」）
export function JobDescription({ job }) {
  return (<>
    {/* 作業説明 */}
    {job.jobBody && job.jobBody.trim() && (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
      <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}><LinkifiedText text={job.jobBody} /></p>
    </div>
    )}

    {/* 経験・持ち物・備考（配列駆動・未入力は「ー」）。希望する働き手は削除・必要経験と持ち物はバッジ表示（2026-07-16・確認/プレビューと同設計） */}
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
      {[
        { label:"持ち物",     value: disp(job.items), chips:true, pin:true },
        { label:"備考・注意", value: disp(job.cautions) },
        // 時間外労働（2026-08-03たきと指示・持ち物／備考の下）。未設定は他項目と同じ「ー」
        { label:"時間外労働", value: disp(overtimeLine(job.overtimePolicy, job.overtimeDetail)) },
      ].map(row => (
        <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
          <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>{row.label}</span>
          {row.chips && row.value !== "ー"
            ? (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:2, justifyContent:"center" }}>
                {String(row.value).split(/[、,・\n／/]+/).map(s => s.trim()).filter(Boolean).map((c, i) => (
                  <span key={i} className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", background:"#F7F7F7", borderRadius:20, padding:"6px 14px" }}>{row.pin ? "📌 " : ""}{c}</span>
                ))}
              </div>
            )
            : <span className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", display:"block", textAlign:"center" }}>{row.value}</span>}
        </div>
      ))}
    </div>
  </>);
}

// 危険な場所・危険な作業（両方空なら見出しごと非表示）
export function JobDangerZones({ job, onPhoto }) {
  return (<>
    {/* 危険区域セクション（両方空なら見出しごと非表示＝ブロック化） */}
    {((job.dangerPlaces && job.dangerPlaces.length > 0) || (job.dangerTasks && job.dangerTasks.length > 0)) && (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
        <span style={{ fontSize:18 }}>⚠️</span>
        <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
      </div>

      {/* 危険な場所 */}
      {(job.dangerPlaces && job.dangerPlaces.length > 0) && (
        <>
          <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
            {job.dangerPlaces.map((place, i) => {
              const placePhotos = place.photos || [];
              return (
              <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={placePhotos} onPhotoClick={onPhoto} />
              );
            })}
          </div>
        </>
      )}

      {/* 危険な作業 */}
      {(job.dangerTasks && job.dangerTasks.length > 0) && (
        <>
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {job.dangerTasks.map((task, i) => {
              const taskPhotos = task.photos || [];
              return (
              <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={taskPhotos} onPhotoClick={onPhoto} />
              );
            })}
          </div>
        </>
      )}
    </div>
    )}
  </>);
}

// 地図（ピンのみ・訪問者は円）と開催期間カレンダー
export function JobLocationSection({ job, me }) {
  return (<>
    {/* 地図（集合場所のおおよその位置・ピンのみ）。会員には番地込みの住所をGoogleマップ導線に渡す
        （2026-08-03・タイトルの住所表示と同じ開示粒度）。訪問者は従来どおり町域まで。
        訪問者（未ログイン）はピンを描かず半径1kmの円のみ（2026-08-05たきと指示）＝
        1点を指す絵で「正確な位置」に見せない。届く座標自体もanonマスクで丸められている */}
    <div style={{ width:"100%", marginBottom:5 }}>
      <JobLocationMap
        lat={job.lat}
        lng={job.lng}
        radius={job.radius}
        label={job.region}
        mapQuery={me && job.workAddress ? job.region + job.workAddress : job.region}
        addressShown={!!(me && job.workAddress)}
        visitor={!me}
        cityArea={job.cityArea}
      />
    </div>

    {/* 開催期間カレンダー（地図の下・全幅・PCのみ表示。スマホはフッター📅からモーダル） */}
    {job.dateStart && (
      <div className="calendar-below-map" style={{ marginBottom:5 }}>
        <CalendarView start={job.dateStart} end={job.dateEnd} readOnly={true} holidays={job.holidays} />
      </div>
    )}
  </>);
}

