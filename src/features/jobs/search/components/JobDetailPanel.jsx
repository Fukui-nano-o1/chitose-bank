// 求人詳細の表示部品（第2次構造改革2026-08-18で JobSearchMapView.jsx から分離）。
// ★ここは【表示だけ】：job（＝job）を受け取って描くのみ。
//   state の所有・URL/hash の制御・応募の判断は一切持たない（親＝JobSearchMapView が持つ）。
//   子が「承認済みだからチャットへ」のような判断を始めた時点で第二のコントローラーになる。
//   この層はそれを作らないための境界。
// ★モジュールレベル定義を維持すること（コンポーネント内定義はフォーカス消失バグの原因）。
//
// ── 構成＝Airbnbの掲載ページの解剖（2026-09-01たきと指示「構成をAirbnbと同じにしろ。パクれ」）──
// Airbnbのコードは流用できない（プロプライエタリ）＝写したのは【区画の並びと区切りの言語】だけ：
//   写真 → タイトル＋事実の1行 → 募集主の小さな行 → この求人のポイント → 作業内容 → 待遇 →
//   作業日程（カレンダー）→ 評価 → 募集主について（パスポート型カード）→ 作業の場所（地図）→
//   知っておくこと（きまり・安全・保険）→ その他の求人 → 報告リンク → 下部の応募バー。
//   （Airbnb：photos → title+facts → host row → highlights → description → amenities →
//     calendar → reviews → meet your host → where you'll be → things to know → price bar）
// 個別の白カードに包む形はやめ、細い区切り線（AirSection）で区画を積む＝Airbnbのページの見た目。
// ★区画を足す・並べ替える時はこの解剖に沿って置くこと（親＝JobSearchMapViewの並びも同時に）。

import { useState, useEffect } from "react";
import { supabase } from "../../../../lib/supabase";
import { CalendarView } from "../../../../components/CalendarView";
import { JobLocationMap } from "../../../../components/JobLocationMap";
import { DangerItem, LinkifiedText, MaskedText, NoticeJumpText, Carousel, JobPhotoFallback, Avatar, JOB_FLAG_INFO } from "../../../../components/ui";
import { JobCard } from "../../../../components/JobCard";
import { JobInsuranceSection } from "../../../../components/InsurancePanel";
import { ReceivedReviews } from "../../../../components/ReceivedReviews";
import { BelongingChips } from "../../../../components/BelongingTags";
import { disp, stationLabel, payTermsLine, overtimeLine, ROLE_GREEN } from "../../../../lib/utils";
import { NavIcon, NavIconInline } from "../../../../components/NavIcons";

// Airbnbの区切りの言語：細い線＋太い見出しで区画を積む（白カードに包まない）。
// この部品の区画は必ずこれで区切る＝区切り方を画面内で2種類にしない
function AirSection({ title, children, style }) {
  return (
    <div style={{ borderTop:"1px solid #EBEBEB", marginTop:24, paddingTop:24, ...style }}>
      {title && <h3 className="f-sans" style={{ fontSize:18, fontWeight:800, color:"#222", margin:"0 0 14px" }}>{title}</h3>}
      {children}
    </div>
  );
}

// タイトル直下の事実の1行（Airbnbの「6 guests · 3 bedrooms · 3 beds」の型・2026-09-01）。
// 旧・主要情報カード（白いカードのグリッド）はこの1行に置き換えた。支払条件は「知っておくこと」へ移動。
// ★報酬はこの行に入れない（細かい構造もAirbnbに・2026-09-01）＝Airbnbの事実の行に価格は無く、
//   価格は下部のバーが常時出す（うちも同じ：モバイル＝下部の応募バー／PC＝応募パネルと下部バー）
export function JobKeyFacts({ job }) {
  const facts = [
    job.dateLabel,
    job.workTime && `勤務 ${job.workTime}`,
    job.breakTime && `休憩 ${job.breakTime}`,
    job.count && `採用 ${job.count}`,
    // 最寄り駅は訪問者にはDBがNULLで返る＝移動時間だけの表示になる
    stationLabel(job.nearestStation, job.commuteTime),
  ].filter(v => v && String(v).trim());
  if (facts.length === 0) return null;
  return (
    <p className="f-sans" style={{ fontSize:14, color:"#717171", lineHeight:1.8, margin:"6px 0 0" }}>
      {facts.join(" ・ ")}
    </p>
  );
}

// 募集主の小さな行（Airbnbの「Hosted by X」の型・タイトルブロックの直下）。
// タップ＝農園紹介モーダル（求人者カードと同じ入口＝行き先を増やさない）
export function JobHostRow({ job, employer, trust, onOpenIntro }) {
  const name = employer?.nickname || job.employerName;
  if (!name) return null;
  return (
    <AirSection>
      <div onClick={()=>onOpenIntro && onOpenIntro(true)} role="button"
        style={{ display:"flex", alignItems:"center", gap:14, cursor: onOpenIntro ? "pointer" : "default" }}>
        <Avatar url={employer?.avatar_url || job.employerAvatar} name={name} size={48} />
        <div style={{ minWidth:0 }}>
          <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>募集主：{name}さん</p>
          {trust?.ok && trust.member_since && (
            <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"3px 0 0" }}>chitose-bank利用 {trust.member_since}から</p>
          )}
        </div>
      </div>
    </AirSection>
  );
}

// この求人のポイント（Airbnbの「Highlights」の型）：旗（初心者大歓迎・経験者優遇・リピート即決）を
// アイコン＋太字＋説明の行で並べる。絵柄と説明文の正は ui.jsx の JOB_FLAG_INFO（バッジと同じソース）
export function JobHighlights({ job }) {
  const keys = [job.beginnerOk && "beginner", job.experiencedPreferred && "expert", job.instantApproveRepeat && "repeat"].filter(Boolean);
  if (keys.length === 0) return null;
  return (
    <AirSection>
      <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
        {keys.map(k => {
          const b = JOB_FLAG_INFO[k];
          return (
            <div key={k} style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
              <span style={{ flexShrink:0, color:"#222", display:"flex", marginTop:2 }}><NavIcon name={b.iconName} size={26} /></span>
              <div style={{ minWidth:0 }}>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0 }}>{b.label}</p>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:"2px 0 0" }}>{b.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </AirSection>
  );
}

// 作業内容（Airbnbの「Description」の型＝説明文だけ。持ち物・備考・時間外などの
// きまりの表は「知っておくこと」（JobThingsToKnow）へ移動・2026-09-01）。
// ★長文は5行で畳んで「もっと見る ›」（Airbnbの Show more の型・下線の太字リンク）。
//   Airbnbは別画面に開くが、ここはその場で開く＝画面を増やさない。短文はボタンごと出ない
export function JobDescription({ job }) {
  const [expanded, setExpanded] = useState(false);
  const body = (job.jobBody || "").trim();
  if (!body) return null;
  const isLong = body.length > 140 || body.split("\n").length > 5;
  const clamp = (isLong && !expanded)
    ? { display:"-webkit-box", WebkitLineClamp:5, WebkitBoxOrient:"vertical", overflow:"hidden" }
    : {};
  return (
    <AirSection title="作業内容">
      <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", ...clamp }}><LinkifiedText text={body} /></p>
      {isLong && !expanded && (
        <button onClick={()=>setExpanded(true)} className="f-sans" style={{ marginTop:10, padding:0, background:"none", border:"none", cursor:"pointer", fontSize:15, fontWeight:700, color:"#222", textDecoration:"underline" }}>もっと見る ›</button>
      )}
    </AirSection>
  );
}

// 待遇（Airbnbの「What this place offers」の細かい構造まで写す・2026-09-01「細かい構造もパクれ」）：
// アイコン＋名前の行を縦に並べ、【無い待遇は灰色＋打ち消し線で並べたまま】（Airbnbの
// unavailable amenities の型＝「無い」も正直に見せる）。内容（エリア・台数・時期など）は
// 名前の下の灰色の小さな行。値は掲載時に確定保存された jobs.perks のみ
// （2026-08-02・プロフィール現在値とのマージ廃止）。アイコンは待遇バッジと同じ NavIcon（正は1組）
export function JobAmenities({ job }) {
  const pk = job.perks || {};
  // 受動喫煙だけ3状態（禁煙＝あり扱い／喫煙場所あり＝あり扱い／記録なし）：求人の明示事項なので
  // 「記録なし」は打ち消し線にしない（「無い」ではなく「分からない」＝嘘の断定をしない・2026-08-24と同じ判断）
  const smoking = pk.smoking_policy
    ? { icon:"noSmoke", label: pk.smoking_policy === "喫煙場所あり" ? "喫煙場所あり" : pk.smoking_policy,
        on:true, detail: pk.smoking_policy === "喫煙場所あり" ? pk.smoking_area : "" }
    : { icon:"noSmoke", label:"受動喫煙：記録なし", on:false, noStrike:true };
  const rows = [
    { icon:"van",       label:"送迎",                 on: !!pk.has_transport,         detail: pk.transport_area },
    { icon:"parking",   label:"駐車場",               on: !!pk.has_parking,           detail: pk.parking_capacity ? `${pk.parking_capacity}台` : "" },
    { icon:"train",     label:"通勤手当",             on: !!pk.has_commute_allowance, detail: pk.commute_allowance_detail },
    { icon:"gift",      label:"賞与",                 on: !!pk.has_bonus,             detail: pk.bonus_detail },
    { icon:"raise",     label:"昇給",                 on: !!pk.has_raise,             detail: pk.raise_detail },
    { icon:"briefcase", label:"退職手当",             on: !!pk.has_severance_pay,     detail: pk.severance_detail },
    { icon:"glove",     label:"作業用品は募集主が負担", on: !!pk.employer_pays_supplies, detail: pk.supplies_cap },
    { icon:"ring",      label:"アクセサリーOK",       on: !!pk.accessory_ok },
    smoking,
  ];
  // Airbnbと同じく「ある待遇が先・無い待遇は後ろにまとめて」並べる
  const ordered = [...rows.filter(r => r.on), ...rows.filter(r => !r.on)];
  return (
    <AirSection title="待遇">
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {ordered.map(r => (
          <div key={r.label} style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
            <span style={{ flexShrink:0, display:"flex", color: r.on ? "#222" : "#B0B0B0", marginTop:1 }}><NavIcon name={r.icon} size={24} /></span>
            <div style={{ minWidth:0 }}>
              <p className="f-sans" style={{ fontSize:15, color: r.on ? "#222" : "#B0B0B0", margin:0, lineHeight:1.5,
                textDecoration: (!r.on && !r.noStrike) ? "line-through" : "none" }}>{r.label}</p>
              {r.on && r.detail && (
                <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"1px 0 0", lineHeight:1.6, overflowWrap:"break-word" }}>{r.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </AirSection>
  );
}

// 作業日程（Airbnbの「Select check-in date」＝カレンダーの区画）。閲覧専用・休日はグレー。
// 見出しの下の灰色の1行＝期間（Airbnbが見出し下に泊数・日付範囲を出す細かい構造の写し）
export function JobScheduleSection({ job }) {
  if (!job.dateStart) return null;
  return (
    <AirSection title="作業日程">
      {job.dateLabel && (
        <p className="f-sans" style={{ fontSize:14, color:"#717171", margin:"-8px 0 14px" }}>{job.dateLabel}</p>
      )}
      <div className="calendar-below-map">
        <CalendarView start={job.dateStart} end={job.dateEnd} readOnly={true} holidays={job.holidays} />
      </div>
    </AirSection>
  );
}

// 作業の場所（Airbnbの「Where you'll be」の型＝地図の区画）。細かい構造も同じ：
// 見出し → 地図 → 地図の下に太字の場所の1行（Airbnbは map の下に "Onna, Okinawa, Japan"）。
// カレンダーは「作業日程」（JobScheduleSection）、保険は「知っておくこと」（JobThingsToKnow）へ移動（2026-09-01）
export function JobLocationSection({ job, me }) {
  return (
    <AirSection title="作業の場所">
      {/* 地図（集合場所のおおよその位置・ピンのみ）。会員には番地込みの住所をGoogleマップ導線に渡す
          （2026-08-03・タイトルの住所表示と同じ開示粒度）。訪問者は従来どおり町域まで。
          訪問者（未ログイン）はピンを描かず半径1kmの円のみ（2026-08-05たきと指示）＝
          1点を指す絵で「正確な位置」に見せない。届く座標自体もanonマスクで丸められている */}
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
      {job.region && (
        <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:"12px 0 0" }}>{job.region}{job.cityArea ? ` ${job.cityArea}` : ""}</p>
      )}
    </AirSection>
  );
}

// 知っておくこと（Airbnbの「Things to know」の型＝House rules / Safety & property に当たる区画）。
// ★Airbnbは折りたたんで「Show more」だが、ここは全部を開いたまま出す＝時間外労働・危険箇所・保険は
//   法定・安全の明示so、タップしないと読めない形にしない（赤ちゃん前提とも整合）。
// 中身は移設＝仕事のきまり（旧・経験持ち物備考の表＋支払条件）／安全への注意（旧・危険箇所）／
// 保険の準備（旧・地図の下の保険カード）。表示の項目・値の出し方は一切変えていない
export function JobThingsToKnow({ job, onPhoto }) {
  const hasDanger = (job.dangerPlaces && job.dangerPlaces.length > 0) || (job.dangerTasks && job.dangerTasks.length > 0);
  const sub = { fontSize:15, fontWeight:700, color:"#222", margin:"0 0 10px" };
  return (
    <AirSection title="知っておくこと">
      {/* ── 仕事のきまり（Airbnbの House rules に当たる） ── */}
      <p className="f-sans" style={sub}>仕事のきまり</p>
      <div style={{ marginBottom:6 }}>
        {[
          { label:"持ち物",     value: disp(job.items), chips:true },
          { label:"備考・注意", value: disp(job.cautions) },
          // 時間外労働（2026-08-03たきと指示）。未設定は他項目と同じ「ー」
          { label:"時間外労働", value: disp(overtimeLine(job.overtimePolicy, job.overtimeDetail)) },
          // 労働条件の明示・掲載時凍結の3項目（2026-08-21）。値の無い旧求人は「ー」（憶測で埋めない）。
          // 退職に関する事項（長文の固定文）は労働条件通知書だけに出す＝求人票では出さない
          { label:"変更の範囲", value: disp((job.placeChangeScope || job.taskChangeScope) ? `場所：${job.placeChangeScope || "変更なし"}／作業：${job.taskChangeScope || "変更なし"}` : "") },
          { label:"契約の更新", value: disp(job.contractRenewal) },
          { label:"労災・雇用保険", value: disp(job.laborInsuranceStatus) },
        ].map(row => (
          <div key={row.label} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"9px 0", borderBottom:"1px solid #F7F7F7" }}>
            <span className="f-sans" style={{ fontSize:13, color:"#B0B0B0", width:104, flexShrink:0, lineHeight:1.6 }}>{row.label}</span>
            {/* 持ち物＝アイコンつきタグチップ（2026-08-28・分割・アイコン対応は BelongingChips に一本化） */}
            {row.chips && row.value !== "ー"
              ? <div style={{ minWidth:0 }}><BelongingChips text={String(row.value)} /></div>
              : <span className="f-sans" style={{ fontSize:15, color: row.value === "ー" ? "#B0B0B0" : "#222", lineHeight:1.6, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", minWidth:0 }}>{row.value}</span>}
          </div>
        ))}
        {/* 掲載時に確定保存された支払条件（2026-08-02・ハードコード廃止）。
            頭から1文字ずつ跳ねさせて目に留める（2026-08-14たきと指示・NoticeJumpText） */}
        <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"10px 0 0" }}><NoticeJumpText text={payTermsLine(job)} /></p>
      </div>

      {/* ── 安全への注意（Airbnbの Safety & property に当たる）＝危険箇所。記載が無ければ小見出しごと出さない ── */}
      {hasDanger && (
        <div style={{ marginTop:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
            <span style={{ display:"flex", color:"#E8A33D" }}><NavIcon name="alert" size={17} /></span>
            <p className="f-sans" style={{ ...sub, margin:0 }}>作業上の注意・危険箇所</p>
          </div>
          {(job.dangerPlaces && job.dangerPlaces.length > 0) && (
            <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom: (job.dangerTasks && job.dangerTasks.length > 0) ? 20 : 0 }}>
              {job.dangerPlaces.map((place, i) => (
                <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={place.photos || []} onPhotoClick={onPhoto} />
              ))}
            </div>
          )}
          {(job.dangerTasks && job.dangerTasks.length > 0) && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {job.dangerTasks.map((task, i) => (
                <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={task.photos || []} onPhotoClick={onPhoto} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 保険の準備＝掲載時に凍結された insuranceSnapshot だけ（2026-08-02・プロフィール現在値への
          フォールバック禁止）。snapshotが無いレガシー求人は小見出しごと出ない ── */}
      {job.insuranceSnapshot && (
        <div style={{ marginTop:20 }}>
          <p className="f-sans" style={sub}>保険の準備</p>
          <JobInsuranceSection employer={{ insurance_items: job.insuranceSnapshot.items, insurance_notes: job.insuranceSnapshot.notes }}
            style={{ border:"none", padding:0, marginBottom:0, borderRadius:0 }} />
        </div>
      )}
    </AirSection>
  );
}

// 評価＋募集主について（Airbnbの「Reviews」→「Meet your host」＝隣り合う2区画・2026-09-01）。
// 1つの部品にしている理由＝評価（job_employer_reviews）を【1回だけ】引いて、
// 評価の区画と、募集主カードの数字（また働きたい）の両方で同じ値を使うため。
// ★別々に引くと published ゲート（双方の評価が揃うか完了3日）の有無で数字が食い違う。
//   employer_trust_info の want_again_workers は全件so、ここでは使わない（2026-08-25の判断のまま）。
// ★募集主カードに出すのは アイコン／名称／数字／代表より だけ（2026-08-25たきと指示）。
//   氏名・住所・連絡先は出さない（2026-08-03に募集者情報ボックスを削除した判断のまま＝
//   それらは農園紹介の信頼カードが伏せ字つきで担う。ここで復活させない）
export function JobReviewsAndHost({ job, employer, trust, me, onOpenIntro }) {
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
  const comment = (employer?.owner_comment || "").trim();
  // ── パスポート型カードの3つの数字（Airbnbのレビュー件数／★評価／ホスト歴を、うちの物差しで）：
  //      レビュー件数 → 受け入れた働き手の人数（completed_hires）
  //      ★評価       → 「また働きたい」の件数（点数化はしない＝運営が点を付ける形は禁止）
  //      ホスト歴     → chitose-bank利用の開始（member_since）
  //    ★値の無い列は並べない（ダミー禁止・憲法3条）。全部無ければ数字の行ごと出さない
  const wantAgain = reviews && reviews.ok && reviews.badges ? (reviews.badges.want_again || 0) : null;
  const stats = [
    trust?.ok && trust.completed_hires > 0 ? { v: `${trust.completed_hires}人`, l: "受け入れた働き手" } : null,
    wantAgain != null ? { v: String(wantAgain), l: "また働きたい" } : null,
    trust?.ok && trust.member_since ? { v: trust.member_since, l: "から利用" } : null,
  ].filter(Boolean);
  return (<>
    {/* ── 評価（Airbnbの「Reviews」の位置＝カレンダーの下）──
        ReceivedReviews に委譲＝肯定的な選択項目と審査済みコメントだけ（規約第8条）。
        求人ページのクライアントは求人者のUIDを知らないので jobNumber 経由で引く。
        訪問者（未ログイン）はDB側が資格なしを返す＝「まだ評価はありません」と誤読させないため案内文に差し替える */}
    <AirSection title={reviews && reviews.ok && reviews.total > 0 ? `評価（${reviews.total}件）` : "評価"}>
      {/* 見出しの件数＝Airbnbの「★4.9 · 12 reviews」の件数の位置（★の点数は出さない＝点数化の禁止）。
          showAllItems＝全ての評価を表示（2026-08-25たきと指示）：件数0の項目も並べる。
          ★総数が2件以上あるのに0の項目が並ぶと否定的な評価が読み取れる＝利用規約 第8条2との緊張。
            戻すときはこのpropを外すだけ（1語）。他の画面（プロフィールの評価面）は従来どおり0を出さない */}
      {me
        ? <ReceivedReviews userId={null} direction="worker_to_farmer" jobNumber={job.id} showAllItems preloaded={reviews} />
        : <p className="f-sans" style={{ fontSize:13, color:"#999", margin:0 }}>ログインすると、この求人者への評価を見られます</p>}
    </AirSection>

    {/* ── 募集主について（Airbnbの「Meet your host」＝評価の直下）── */}
    {name && (
      <AirSection title="募集主について">
        {/* パスポート型カード（2026-08-25たきと指示「パクれ」）：白いカードに影・
            左＝大きなアイコン＋名前（縦中央）・右＝数字の縦積み（横線区切り）の2カラム。
            アイコン右下のバッジ＝連絡先確認済み（trust.id_checked・Airbnbの本人確認バッジに当たる位置）。
            タップで農園紹介＝募集主の小さな行と同じ入口（行き先を増やさない） */}
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
        {/* 募集主の対応（Airbnbの「Host details：Response rate / Responds within…」の型）＝
            承認までの時間。値の無い募集主は行ごと出さない（憶測で埋めない）。
            文言は農家プレビューの記録タブ（FarmerRecord）と同じ言い回しに揃える */}
        {trust?.ok && trust.avg_approval_hours != null && (
          <p className="f-sans" style={{ fontSize:14, color:"#222", margin:"14px 0 0" }}>承認までの時間：平均{trust.avg_approval_hours}時間</p>
        )}
        {/* 代表より（owner_comment＝代表より枠の中身。未記入なら行ごと出さない・憲法3条） */}
        {comment && (
          <div style={{ marginTop:14 }}>
            <p className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#717171", margin:"0 0 6px" }}>代表より</p>
            <p className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}>{comment}</p>
          </div>
        )}
      </AirSection>
    )}
  </>);
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
        // ★下の丸ドットは廃止し、写真の右下に「n / N」のカウンター（Airbnbの細かい構造の写し・2026-09-01）。
        //   カウンターを写真の上に重ねるため relative の親で包む（Carouselの矢印とは別の層・zIndex 2）
        <div style={{ position:"relative", marginBottom:20 }}>
          <Carousel
            className="carousel-scroll"
            style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory" }}
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
          {photos.length > 1 && (
            <span className="f-sans" aria-hidden="true" style={{ position:"absolute", right:14, bottom:14, zIndex:2, pointerEvents:"none",
              background:"rgba(34,34,34,0.72)", color:"#fff", fontSize:12, fontWeight:600, borderRadius:6, padding:"4px 10px", letterSpacing:"0.04em" }}>
              {Math.min(activeSlide + 1, photos.length)} / {photos.length}
            </span>
          )}
        </div>
      );
    })()}
  </>);
}

// JobEmployerCard（募集主カード＝小さな行＋待遇表）と JobReviews（farmerReviews＝一度も実データが入らなかった
// ガワ）は2026-09-01のAirbnb構成で廃止：カードの頭は JobHostRow・待遇表は JobAmenities に分かれ、
// 評価は JobReviewsAndHost が実データ（job_employer_reviews）で担う。git履歴から復元可
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

