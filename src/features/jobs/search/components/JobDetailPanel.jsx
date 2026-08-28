// 求人詳細の表示部品（第2次構造改革2026-08-18で JobSearchMapView.jsx から分離）。
// ★ここは【表示だけ】：job（＝job）を受け取って描くのみ。
//   state の所有・URL/hash の制御・応募の判断は一切持たない（親＝JobSearchMapView が持つ）。
//   子が「承認済みだからチャットへ」のような判断を始めた時点で第二のコントローラーになる。
//   この層はそれを作らないための境界。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。

import { useState, useEffect } from "react";
import { supabase } from "../../../../lib/supabase";
import { CalendarView } from "../../../../components/CalendarView";
import { JobLocationMap } from "../../../../components/JobLocationMap";
import { DangerItem, LinkifiedText, MaskedText, NoticeJumpText, Carousel, JobPhotoFallback, Avatar } from "../../../../components/ui";
import { JobCard } from "../../../../components/JobCard";
import { JobInsuranceSection } from "../../../../components/InsurancePanel";
import { ReceivedReviews } from "../../../../components/ReceivedReviews";
import { BelongingChips } from "../../../../components/BelongingTags";
import { EMPTY_MARK, disp, stationLabel, payLabel, payTermsLine, overtimeLine, calFmtDate, ROLE_GREEN } from "../../../../lib/utils";
import { NavIcon, NavIconInline } from "../../../../components/NavIcons";
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
        { label:"持ち物",     value: disp(job.items), chips:true },
        { label:"備考・注意", value: disp(job.cautions) },
        // 時間外労働（2026-08-03たきと指示・持ち物／備考の下）。未設定は他項目と同じ「ー」
        { label:"時間外労働", value: disp(overtimeLine(job.overtimePolicy, job.overtimeDetail)) },
        // 労働条件の明示・掲載時凍結の3項目（2026-08-21）。値の無い旧求人は「ー」（憶測で埋めない）。
        // 退職に関する事項（長文の固定文）は労働条件通知書だけに出す＝求人票では出さない
        { label:"変更の範囲", value: disp((job.placeChangeScope || job.taskChangeScope) ? `場所：${job.placeChangeScope || "変更なし"}／作業：${job.taskChangeScope || "変更なし"}` : "") },
        { label:"契約の更新", value: disp(job.contractRenewal) },
        { label:"労災・雇用保険", value: disp(job.laborInsuranceStatus) },
      ].map(row => (
        <div key={row.label} style={{ padding:"8px 0", borderBottom:"1px solid #F7F7F7" }}>
          <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0", display:"block", marginBottom:2, textAlign:"center" }}>{row.label}</span>
          {/* 持ち物＝アイコンつきタグチップ（2026-08-28・旧📌チップの置き換え。分割・アイコン対応は BelongingChips に一本化） */}
          {row.chips && row.value !== "ー"
            ? <BelongingChips text={String(row.value)} />
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
        <span style={{ display:"flex", color:"#E8A33D" }}><NavIcon name="alert" size={18} /></span>
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

    {/* 保険カード（カレンダーの下・2026-08-19たきと指示で保険タブから移植）。
        見るのは掲載時に凍結された insuranceSnapshot だけ（2026-08-02・プロフィール現在値への
        フォールバック禁止）。snapshotが無いレガシー求人は区画ごと出ない */}
    {job.insuranceSnapshot && (
      <JobInsuranceSection employer={{ insurance_items: job.insuranceSnapshot.items, insurance_notes: job.insuranceSnapshot.notes }} />
    )}
  </>);
}

// 求人者情報（保険枠の下・2026-08-25たきと指示「その下に求人者情報を明記。アイコン、名称、代表より、評価」）。
// ★ここに出すのは4つだけ：アイコン／名称／代表より／評価。
//   氏名・住所・連絡先は出さない（2026-08-03に募集者情報ボックスを削除した判断のまま＝
//   それらは農園紹介の信頼カードが伏せ字つきで担う。ここで復活させない）。
// ★代表よりは owner_comment（＝代表より枠の中身。名前の下の挨拶ではない・2026-07-14の入替のまま）。
//   未記入なら行ごと出さない（無い情報をあるように見せない・憲法3条）。
// ★評価は ReceivedReviews に委譲＝肯定的な選択項目と審査済みコメントだけ（規約第8条）。
//   求人ページのクライアントは求人者のUIDを知らないので jobNumber 経由で引く。
//   訪問者（未ログイン）はDB側that資格なしを返す＝「まだ評価はありません」と誤読させないため案内文に差し替える
export function JobRecruiterInfo({ job, employer, trust, me, onOpenIntro }) {
  // 評価は1回だけ引いて、上の数字（また働きたい）と下の評価欄で同じ値を使う（2026-08-25）。
  // ★別々に引くと published ゲート（双方の評価that揃うか完了3日）の有無で数字that食い違う。
  //   employer_trust_info の want_again_workers は全件so、ここでは使わない
  const [reviews, setReviews] = useState(null);
  useEffect(() => {
    if (!me || !job?.id) { setReviews(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.rpc("job_employer_reviews", { p_job_number: job.id });
        if (!cancelled) setReviews(data && data.ok ? data : { ok: false });
      } catch { if (!cancelled) setReviews({ ok: false }); }
    })();
    return () => { cancelled = true; };
  }, [me, job?.id]);

  const name = employer?.nickname || job.employerName;
  if (!name) return null; // 名前も分からないうちは枠ごと出さない（空の箱を置かない）
  const comment = (employer?.owner_comment || "").trim();
  // ── Airbnbの「ホストについて（Meet your host）」の3つの数字を、うちの物差しで置き換える
  //    （2026-08-25たきと指示「真似しろ」）：
  //      レビュー件数 → 受け入れた働き手の人数（completed_hires）
  //      ★評価       → 「また働きたい」の件数（点数化はしない＝運営that点を付ける形は禁止）
  //      ホスト歴     → chitose-bank利用の開始（member_since）
  //    ★値の無い列は並べない（ダミー禁止・憲法3条）。全部無ければ数字の行ごと出さない
  const wantAgain = reviews && reviews.ok && reviews.badges ? (reviews.badges.want_again || 0) : null;
  const stats = [
    trust?.ok && trust.completed_hires > 0 ? { v: `${trust.completed_hires}人`, l: "受け入れた働き手" } : null,
    wantAgain != null ? { v: String(wantAgain), l: "また働きたい" } : null,
    trust?.ok && trust.member_since ? { v: trust.member_since, l: "から利用" } : null,
  ].filter(Boolean);
  return (
    <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", margin:"0 0 12px", letterSpacing:".06em" }}>求人者情報</p>
      {/* Airbnbの「ホストについて」のパスポート型カード（2026-08-25たきと指示「パクれ」）：
          白いカードに影・左＝大きなアイコン＋名前（縦中央）・右＝数字の縦積み（横線区切り）の2カラム。
          旧・横一列の数字はこの形に置き換えた。Airbnbの実アセットは流用できない（プロプライエタリ）ため、
          同じ視覚言語を自前で描く（NavIconと同じ判断）。
          アイコン右下のバッジ＝連絡先確認済み（trust.id_checked・Airbnbの本人確認バッジに当たる位置）。
          タップで農園紹介＝求人者カードと同じ入口（行き先を増やさない） */}
      <div onClick={()=>onOpenIntro && onOpenIntro(true)} role="button"
        style={{ display:"flex", alignItems:"center", gap:10, background:"#fff", borderRadius:24,
                 boxShadow:"0 6px 16px rgba(0,0,0,0.14)", padding:"22px 18px", margin:"4px 2px 6px",
                 cursor: onOpenIntro ? "pointer" : "default" }}>
        <div style={{ flex:"1 1 0", minWidth:0, display:"flex", flexDirection:"column", alignItems:"center" }}>
          <div style={{ position:"relative" }}>
            <Avatar url={employer?.avatar_url || job.employerAvatar} name={name} size={96} ring={ROLE_GREEN} />
            {trust?.ok && trust.id_checked && (
              <span title="連絡先確認済み" style={{ position:"absolute", right:-2, bottom:2, width:26, height:26, borderRadius:"50%", background:ROLE_GREEN, border:"2.5px solid #fff", boxSizing:"border-box", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff" }}>
                <NavIcon name="tick" size={13} />
              </span>
            )}
          </div>
          <p className="f-sans" style={{ fontSize:21, fontWeight:800, color:"#222", margin:"10px 0 0", textAlign:"center", overflowWrap:"break-word", wordBreak:"break-word", lineHeight:1.3 }}>{name}さん</p>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"3px 0 0" }}>募集主</p>
        </div>
        {stats.length > 0 && (
          <div style={{ flex:"0 0 41%", maxWidth:150, minWidth:0 }}>
            {stats.map((s, i) => (
              <div key={s.l} style={{ padding: i === 0 ? "0 0 10px" : (i === stats.length - 1 ? "10px 0 0" : "10px 0"), borderTop: i > 0 ? "1px solid #EBEBEB" : "none" }}>
                <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", margin:0, lineHeight:1.25, overflowWrap:"break-word" }}>{s.v}</p>
                <p className="f-sans" style={{ fontSize:10, color:"#717171", margin:"1px 0 0", lineHeight:1.4 }}>{s.l}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 代表より */}
      {comment && (<>
        <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0" }} />
        <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", margin:"0 0 6px", letterSpacing:".06em" }}>代表より</p>
        <p className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{comment}</p>
      </>)}
      {/* 評価（Airbnbの「レビュー」に当たる内訳。上の数字は要約so、同じ「また働きたい」that上下に出る） */}
      <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0" }} />
      <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", margin:"0 0 6px", letterSpacing:".06em" }}>評価</p>
      {/* showAllItems＝全ての評価を表示（2026-08-25たきと指示）：件数0の項目も並べる。
          ★総数that2件以上あるのに0の項目that並ぶと否定的な評価that読み取れる＝利用規約 第8条2との緊張。
            戻すときはこのpropを外すだけ（1語）。他の画面（プロフィールの評価面）は従来どおり0を出さない */}
      {me
        ? <ReceivedReviews userId={null} direction="worker_to_farmer" jobNumber={job.id} showAllItems preloaded={reviews} />
        : <p className="f-sans" style={{ fontSize:12, color:"#999", margin:0 }}>ログインすると、この求人者への評価を見られます</p>}
    </div>
  );
}
// 写真ギャラリー（最大10枚・0枚なら求人者のアイコンを1枚）
export function JobPhotoGallery({ job, employer, photosLooped, activeSlide, scrollerRef, onScroll }) {
  return (<>
    {/* 写真ギャラリー（最大10枚）。1枚も無い求人は求人者のアイコンを1枚だけ大きく出す（2026-07-30たきと指示） */}
    {(() => {
      const photos = Array.isArray(job.photos) ? job.photos : [];
      if (photos.length === 0) return (
        <div style={{ marginBottom:20 }}>
          <JobPhotoFallback url={employer?.avatar_url || job.employerAvatar} name={employer?.nickname || job.employerName || "？"} />
        </div>
      );
      const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
      // ループ用クローン：[最後, ...本物, 最初]。初期位置とジャンプはhandlePhotoScroll側
      const slides = photosLooped ? [photos[photos.length - 1], ...photos, photos[0]] : photos;
      return (
        <>
          <Carousel
            className="carousel-scroll"
            style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory" }}
            wrapperStyle={{ marginBottom:8 }}
            onScroll={onScroll}
            scrollerRef={scrollerRef}
          >
            {slides.map((photo, i) => {
              const src = typeof photo === "string" ? photo : photo?.url;
              const cap = typeof photo === "string" ? "" : photo?.caption;
              return (
                <div key={i} style={{
                  flexShrink:0, width:"100%", height:392, borderRadius:12,
                  background: bgColors[i % bgColors.length],
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:72,
                  scrollSnapAlign:"start", position:"relative", overflow:"hidden",
                }}>
                  <img loading="lazy" src={src} alt={cap || ""} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                  {cap && (
                    <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:16, fontWeight:600, lineHeight:1.6, boxSizing:"border-box" }}>{cap}</div>
                  )}
                </div>
              );
            })}
          </Carousel>
          <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:20 }}>
            {photos.map((_, i) => (
              <span key={i} style={{ fontSize:10, color: i===activeSlide ? "#00A86B" : "#D0D0D0" }}>{i===activeSlide ? "●" : "○"}</span>
            ))}
          </div>
        </>
      );
    })()}
  </>);
}

// 募集主カード（名前・アイコン・待遇表。RPCの到着を待たず即描画）
export function JobEmployerCard({ job, employer, trust, onOpenIntro }) {
  return (<>
    {/* 門番をRPC待ちから外す（2026-08-14）：名前・アイコンは一覧の行（jobs_public＝
        employerName/employerAvatar）がが最初から持っている。待遇表も job.perks
        （掲載時凍結）だけで描ける＝RPCの到着を待たずカードを即描画する。
        RPC（employer）は農園紹介モーダルの中身と信頼情報の補強にだけ使う */}
    {(employer?.nickname || job.employerName) && (() => {
      const pk = job.perks || {}; // 掲載時に確定保存された待遇のみ（2026-08-02・プロフィール現在値とのマージ廃止）
      // ★求人者カードの待遇は【項目名＋内容の9行の表】に戻した（2026-08-25たきと指示
      //   「ここの待遇は前回の見せ方を復元」）＝2026-08-24のバッジ化はこのカードでは撤回。
      //   バッジは縦に積むと1行1個になり、何の項目か（駐車場/受動喫煙…）が読み取りにくかった。
      //   ★タイトル下のバッジ列（JobFlagBadges＋perkBadges）と確認ページ・審査プレビューの表は不変
      const perkRows = [
        { label:"送迎",     on: pk.has_transport,        value: pk.has_transport ? `あり${pk.transport_area ? "（" + pk.transport_area + "）" : ""}` : EMPTY_MARK },
        { label:"駐車場",   on: pk.has_parking,          value: pk.has_parking ? `あり${pk.parking_capacity ? "（" + pk.parking_capacity + "台）" : ""}` : EMPTY_MARK },
        { label:"通勤手当", on: pk.has_commute_allowance, value: pk.has_commute_allowance ? `あり${pk.commute_allowance_detail ? "（" + pk.commute_allowance_detail + "）" : ""}` : EMPTY_MARK },
        // 昇給・賞与・退職手当（2026-08-19たきと指示）：掲載時に凍結された perks から。
        // 「あり」のときの内容（時期・金額等）も凍結されていれば括弧で添える。旧求人はキーが無い＝「ー」
        { label:"賞与",     on: pk.has_bonus,            value: pk.has_bonus ? `あり${pk.bonus_detail ? "（" + pk.bonus_detail + "）" : ""}` : EMPTY_MARK },
        { label:"昇給",     on: pk.has_raise,            value: pk.has_raise ? `あり${pk.raise_detail ? "（" + pk.raise_detail + "）" : ""}` : EMPTY_MARK },
        { label:"退職手当", on: pk.has_severance_pay,    value: pk.has_severance_pay ? `あり${pk.severance_detail ? "（" + pk.severance_detail + "）" : ""}` : EMPTY_MARK },
        { label:"作業用品の負担", on: pk.employer_pays_supplies, value: pk.employer_pays_supplies ? `募集主が負担${pk.supplies_cap ? "（" + pk.supplies_cap + "）" : ""}` : EMPTY_MARK },
        { label:"アクセサリー", on: pk.accessory_ok,          value: pk.accessory_ok ? "OK" : EMPTY_MARK },
        // 受動喫煙（2026-08-03たきと指示）：就業場所の受動喫煙対策は求人の明示事項。
        // 値は掲載時に凍結された perks から（プロフィール現在値は参照しない）。未設定は「ー」
        { label:"受動喫煙", on: !!pk.smoking_policy,
          value: pk.smoking_policy
            ? (pk.smoking_policy === "喫煙場所あり"
                ? `喫煙場所あり${pk.smoking_area ? "（" + pk.smoking_area + "）" : ""}`
                : pk.smoking_policy)
            : EMPTY_MARK },
      ];
      return (
        <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
          {/* アイコン左・2倍(88px)・名前に「さん」・登録してからの月日。紹介文はここでは出さない（2026-07-16） */}
          {/* アイコン・名前タップ→農園紹介をボックス展開（2026-07-16） */}
          <div onClick={()=>onOpenIntro(true)} role="button" style={{ display:"flex", alignItems:"center", gap:14, textAlign:"left", cursor:"pointer" }}>
            <Avatar url={employer?.avatar_url || job.employerAvatar} name={employer?.nickname || job.employerName} size={70} />
            <div style={{ minWidth:0 }}>
              <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>{employer?.nickname || job.employerName}さん</p>
              {trust?.ok && trust.member_since && (
                <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>chitose-bank利用 {trust.member_since}から</p>
              )}
            </div>
          </div>
          <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0 4px" }} />
          <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:4, letterSpacing:".06em", textAlign:"center" }}>待遇</p>
          <div style={{ width:"fit-content", margin:"0 auto" }}>{/* 待遇ブロックはカード中央配置（2026-07-16） */}
            {perkRows.map((row, i) => (
              <div key={row.label} style={{
                display:"flex", alignItems:"center", gap:12, padding:"8px 0",
                borderBottom: i < perkRows.length - 1 ? "1px solid #F7F7F7" : "none",
              }}>
                <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:72, flexShrink:0 }}>{row.label}</span>
                <span className="f-sans" style={{ fontSize:15, color: row.on ? "#222" : "#B0B0B0", fontWeight: row.on ? 600 : 400, lineHeight:1.6 }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    })()}
  </>);
}

// 農家へのレビュー（匿名・日付なし・並び替えつき）
export function JobReviews({ job, sort, onSort, showAll, onShowAll }) {
  return (<>
    {/* 農家へのレビュー（段階2-a・ガワのみ・取引実績ベース・匿名・日付なし） */}
    {(() => {
      const allReviews = job.farmerReviews || [];
      if (allReviews.length === 0) return null;
      const sortedReviews = [...allReviews];
      if (sort === "high") sortedReviews.sort((a, b) => b.stars - a.stars);
      else if (sort === "low") sortedReviews.sort((a, b) => a.stars - b.stars);
      const visibleReviews = showAll ? sortedReviews : sortedReviews.slice(0, 8);
      const hasMore = sortedReviews.length > 8;

      return (
        <div style={{ marginBottom:5 }}>
          {/* ヘッダー: 左=農家プロフィール(控えめ) / 中央=星評価(主役) */}
          <div className="review-header-row" style={{ marginBottom:24 }}>
            {/* 左: 農家プロフィール（控えめ・既存プロフィール行を縮小） */}
            <div className="review-header-profile" style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{
                width:32, height:32, borderRadius:"50%", background:"#E6F7EF", flexShrink:0,
                display:"flex", alignItems:"center", justifyContent:"center", color:"#00A86B",
              }}><NavIcon name="farmer" size={18} /></div>
              <div>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0 }}>{job.farmerName}</p>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:0 }}>{job.farmerBadge}・{job.farmerYears}</p>
              </div>
            </div>

            {/* 中央: 星評価（主役・特大） */}
            <div className="review-header-stars">
              <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:8 }}>
                <span style={{ fontSize:36, color:"#00A86B" }}>★</span>
                <span className="f-mono" style={{ fontSize:36, fontWeight:800, color:"#222" }}>{job.farmerRating}</span>
              </div>
              <p className="f-sans" style={{ fontSize:15, color:"#717171", margin:0, marginTop:2 }}>{job.farmerReviewCount}件のレビュー</p>
            </div>

            {/* 右: バランス用の余白 */}
            <div className="review-header-spacer" />
          </div>

          {/* 並び替えタブ */}
          <div style={{ display:"flex", gap:8, marginBottom:18 }}>
            {[
              { key:"new",  label:"新しい順" },
              { key:"high", label:"評価が高い順" },
              { key:"low",  label:"評価が低い順" },
            ].map(opt => {
              const active = sort === opt.key;
              return (
                <button key={opt.key} onClick={() => onSort(opt.key)} className="f-sans" style={{
                  padding:"7px 16px", borderRadius:20, fontSize:13, cursor:"pointer", fontWeight:600,
                  border: active ? "1px solid #00A86B" : "1px solid #EBEBEB",
                  background: active ? "#E6F7EF" : "#fff",
                  color: active ? "#00A86B" : "#717171",
                }}>{opt.label}</button>
              );
            })}
          </div>

          {/* 個別レビュー一覧（匿名・日付なし・最大8件） */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {visibleReviews.map((review, i) => (
              <div key={i} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"14px 16px" }}>
                <p style={{ margin:0, marginBottom:6, fontSize:15, color:"#00A86B", letterSpacing:1 }}>
                  {"★".repeat(review.stars)}{"☆".repeat(5 - review.stars)}
                </p>
                <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.7, margin:0 }}>{review.text}</p>
              </div>
            ))}
          </div>

          {/* もっと見る */}
          {hasMore && !showAll && (
            <button onClick={() => onShowAll(true)} className="f-sans" style={{
              display:"block", margin:"18px auto 0", padding:"10px 28px", borderRadius:20,
              border:"1px solid #222", background:"#fff", color:"#222", fontSize:13, fontWeight:700, cursor:"pointer",
            }}>もっと見る</button>
          )}
        </div>
      );
    })()}
  </>);
}

// その他の求人（0件なら「ありません」）
// ★prop名を currentJob にしている理由（2026-08-18）：この区画には「一覧の各求人」を指す
//   ローカル変数 job が既にある。prop も job にすると filter(job => job.id !== job.id) と
//   自分自身の比較になり、その他の求人が常に0件になる（build も lint も通ってしまう）。
// viewCounts（任意・2026-08-21たきと指示「その他の求人にも」）：job_number→閲覧数。一覧と同じ👀ピルを出す
export function RelatedJobs({ currentJob, jobList, savedIds, canLike, onToggleSave, viewCounts }) {
  return (<>
    {/* その他の求人（0件なら「ありません」を表示） */}
    <div className="job-detail-more-jobs" style={{ marginBottom:20 }}>
      <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", marginBottom:12 }}>その他の求人</h3>
      {jobList.filter(job => job.id !== currentJob.id).length === 0 ? (
        <p className="f-sans" style={{ fontSize:15, color:"#999", padding:"20px 0" }}>現在、他の求人はありません。</p>
      ) : (
      <Carousel
        className="carousel-scroll"
        style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4 }}
      >
        {jobList.filter(job => job.id !== currentJob.id).map(job => (
          <JobCard key={job.id} job={job} variant="related" saved={savedIds.has(job.id)} onToggleSave={canLike(job) ? onToggleSave : undefined} views={viewCounts?.[job.id]} />
        ))}
      </Carousel>
      )}
    </div>
  </>);
}

