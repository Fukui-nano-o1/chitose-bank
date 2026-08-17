// 求人詳細の本文（2026-08-07たきと指示「求人詳細ページをボックス化している要素をトレース。
// ただし浮遊ボックスは除外」）：AdminJobPreview（審査・オーナープレビュー＝求人詳細ページの
// ボックス化）の本文をそのまま写した表示専用部品。
// 【除外＝浮遊・操作系】指摘チップ／公開の右スワイプ緑面／下部の操作バー／⏸一時非公開／指摘エディタ。
// 【追補（2026-08-07たきと指示「一時非公開以外はちゃんと確認できるように」）】求人ページと同じ
// 確認内容を後段に追加：保険（掲載時凍結のinsuranceSnapshotのみ・現在値へのフォールバック禁止）／
// 農家プロフィール（job_employer_profile / job_employer_trust_info＝訪問者にも開いている公開RPC）／
// 質問（JobQuestions＝求人Q&A・詳細/確認ページと同じ部品）。
// ※掲載前の確認の記録は載せない：job_publish_checks のRLSが本人・運営のみで、働き手には常に0件
//   ＝「記録なし」という嘘の表示になる。開示するならDB側の判断が先（勝手に開けない）。
// 【同指示「求人にラベルは貼らなくていい」】ヘッダーのバッジ（初心者大歓迎等）は出さない
// ＝AdminJobPreviewとの意図的な差分。
// job は mapJobPublicRow() で整形済みのオブジェクトを渡すこと。me は Q&A の投稿判定用（任意）。
// ※本文の見た目を変えるときは AdminJobPreview 側と揃える（出どころが同じ・枝分かれさせない）
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { payLabel, disp, stationLabel, payTermsLine, overtimeLine, EMPTY_MARK } from "../lib/utils";
import { Avatar, Carousel, DangerItem, LinkifiedText, MaskedAddress } from "./ui";
import { CalendarView } from "./CalendarView";
import { JobLocationMap } from "./JobLocationMap";
import { InsurancePanel } from "./InsurancePanel";
import { JobQuestions, ContentQTabs, ContentQSwipeArea } from "./JobQuestions";

export function JobDetailBody({ job, me, onBack }) {
  const [activeSlide, setActiveSlide] = useState(0);
  // 仕事の内容／保険／質問のタブ（2026-08-08たきと指示「保険と質問も横スワイプ機能付きで変更しろ」）＝
  // 求人詳細ページと同じ部品（ContentQTabs＋ContentQSwipeArea）。タップでも横スワイプでも切り替わる。
  // ★最初のタブでさらに右スワイプ＝onEdgeSwipe("prev")→onBack（面を戻る）＝
  //   タブ切替と「横スワイプで戻る」が同じ指の動きで両立する
  const [tab, setTab] = useState("content");
  const rootRef = useRef(null);
  const [dangerLightbox, setDangerLightbox] = useState(null);
  // トップ写真のループ（2026-08-08たきと指示「最後の写真をスライドしたらトップ写真に戻れ」）＝
  // 求人詳細ページ（JobSearchMapView・2026-07-16）の実装をそのままトレース：
  // 両端にクローンを置き（[最後, ...本物, 最初]）、端に着地した瞬間に本物へ瞬間ジャンプする。
  // 1枚目で左へ→最後の写真／最後の写真で右へ→1枚目。ドットは本物の枚数ぶんだけ出す
  const photoScrollerRef = useRef(null);
  const photoCount = job?.photos?.length || 0;
  const photosLooped = photoCount > 1;
  // 農家プロフィール（求人詳細ページと同じ2本を並列で・2026-08-02の作法）
  const [emp, setEmp] = useState(null);
  const [empTrust, setEmpTrust] = useState(null);
  useEffect(() => {
    if (!job?.id) { setEmp(null); setEmpTrust(null); return; }
    let cancelled = false;
    (async () => {
      const [profRes, trustRes] = await Promise.all([
        Promise.resolve(supabase.rpc('job_employer_profile', { p_job_number: job.id })).catch(() => ({ data: null })),
        Promise.resolve(supabase.rpc('job_employer_trust_info', { p_job_number: job.id })).catch(() => ({ data: null })),
      ]);
      if (cancelled) return;
      setEmp((profRes.data && profRes.data[0]) || null);
      setEmpTrust(trustRes.data || null);
    })();
    return () => { cancelled = true; };
  }, [job?.id]);
  // 開いた時・求人が変わった時は本物の1枚目（＝クローンの次）に置く。フックは早期returnより前に置く
  useEffect(() => {
    if (!photosLooped) return;
    const el = photoScrollerRef.current;
    if (el) requestAnimationFrame(() => { el.scrollLeft = el.clientWidth; });
    setActiveSlide(0);
  }, [job?.id, photosLooped]);
  if (!job) return null;
  // 右下の「トップ」浮遊ボックス（2026-08-08たきと指示）：最寄りのスクロール容器を先頭へ戻す。
  // ボックスの中（シートのスクロール領域）でもページでも同じ1実装で効く
  const scrollToTop = () => {
    for (let n = rootRef.current?.parentElement; n; n = n.parentElement) {
      try {
        const st = window.getComputedStyle(n);
        if ((st.overflowY === "auto" || st.overflowY === "scroll") && n.scrollHeight > n.clientHeight + 1) {
          n.scrollTo({ top: 0, behavior: "smooth" }); return;
        }
      } catch { break; }
    }
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
  };
  const handlePhotoScroll = e => {
    const el = e.target;
    const w = el.clientWidth;
    if (!w) return;
    const idx = Math.round(el.scrollLeft / w);
    if (!photosLooped) { setActiveSlide(idx); return; }
    const settled = Math.abs(el.scrollLeft - idx * w) < 2;
    if (settled && idx === 0) { el.scrollLeft = photoCount * w; setActiveSlide(photoCount - 1); return; }
    if (settled && idx === photoCount + 1) { el.scrollLeft = w; setActiveSlide(0); return; }
    setActiveSlide(((idx - 1) % photoCount + photoCount) % photoCount);
  };
  const hasInsurance = Array.isArray(job.insuranceSnapshot?.items) && job.insuranceSnapshot.items.length > 0;
  return (
    <div ref={rootRef}>
      {/* 写真ギャラリー（原寸＝詳細・審査プレビューと同じ扱い。カード用サムネにしない・2026-08-02規則） */}
      {(() => {
        const photos = job.photos.length > 0 ? job.photos : [job.icon, job.icon, job.icon];
        const bgColors = ["#F0F0F0", "#EAEAEA", "#F0F0F0"];
        // ループ用クローン：[最後, ...本物, 最初]。初期位置とジャンプはhandlePhotoScroll側（詳細ページと同型）
        const slides = photosLooped ? [photos[photos.length - 1], ...photos, photos[0]] : photos;
        return (
          <div style={{ position:"relative", borderRadius:12, marginBottom:8 }}>
            <Carousel
              className="carousel-scroll"
              style={{ display:"flex", overflowX:"auto", scrollSnapType:"x mandatory" }}
              wrapperStyle={{ marginBottom:8 }}
              onScroll={handlePhotoScroll}
              scrollerRef={photoScrollerRef}
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
                    {job.photos.length > 0
                      ? <img loading="lazy" src={src} alt={cap || ""} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                      : photo}
                    {cap && (
                      <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 20px 16px", background:"linear-gradient(transparent, rgba(0,0,0,0.65))", color:"#fff", fontSize:16, fontWeight:600, boxSizing:"border-box" }}>{cap}</div>
                    )}
                  </div>
                );
              })}
            </Carousel>
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:8 }}>
              {photos.map((_, i) => (
                <span key={i} style={{ fontSize:10, color: i===activeSlide ? "#00A86B" : "#D0D0D0" }}>{i===activeSlide ? "●" : "○"}</span>
              ))}
            </div>
          </div>
        );
      })()}
      <div style={{ marginBottom:12 }} />

      {/* 仕事の内容／保険／質問（2026-08-08たきと指示）＝求人詳細ページと同じタブ＋横スワイプ。
          最初のタブでさらに右スワイプ＝面を戻る（onBack）＝1つの指の動きで両立させる */}
      <ContentQSwipeArea value={tab} onChange={setTab} showInsurance={hasInsurance}
        onEdgeSwipe={(d)=>{ if (d === "prev" && onBack) onBack(); }}>
      <ContentQTabs value={tab} onChange={setTab} showInsurance={hasInsurance} />
      {tab === "questions" ? (
        /* 質問（求人Q&A・詳細/確認ページと同じ部品＝公開Q&A。投稿ゲート・NG検査はサーバー側が従来どおり） */
        <JobQuestions jobNumber={job.id} me={me} />
      ) : tab === "insurance" ? (
        /* 保険（求人ページの保険タブと同じ規則・2026-08-02）：掲載時に凍結された insuranceSnapshot だけを見る。
           プロフィール現在値へのフォールバック禁止。snapshotが無い＝レガシー求人はタブごと出さない */
        <InsurancePanel employer={{ insurance_items: job.insuranceSnapshot.items, insurance_notes: job.insuranceSnapshot.notes }} />
      ) : (<>

      {/* ヘッダー。番地の開示はDB側が正（jobs_publicのanonマスク）＝ログインしていれば届いた値が出る。
          バッジ（初心者大歓迎・経験者優遇・リピート即決）は貼らない（2026-08-07たきと指示
          「求人にラベルは貼らなくていい」＝AdminJobPreviewとの意図的な差分） */}
      <div style={{ position:"relative", marginBottom:20 }}>
        <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>
          {job.crop} {job.task}{job.region ? `｜${job.region}` : ""}
          {job.region && <MaskedAddress value={job.workAddress} unlocked={true} exists={job.hasWorkAddress} />}
        </h2>
        <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"4px 0 0", userSelect:"text" }}>#{job.id}</p>
      </div>

      {/* 主要情報 */}
      <div style={{ position:"relative", width:"100%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
        <div className="job-detail-info-grid">
          {[
            { label:"日程",     value: (job.dateLabel || "").replace("〜", "\n〜") },
            { label:"勤務時間", value: job.workTime },
            { label:"休憩時間", value: job.breakTime },
            { label:"採用人数", value: job.count },
            { label:"移動時間", value: stationLabel(job.nearestStation, job.commuteTime) },
            { label:"報酬",     value: payLabel(job) },
          ].filter(row => row.value && String(row.value).trim()).map(row => (
            <div key={row.label} style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center", textAlign:"center" }}>
              <span className="f-sans" style={{ fontSize:11, color:"#B0B0B0" }}>{row.label}</span>
              <span className="f-sans" style={{ fontSize:15, color:"#222", fontWeight:600, lineHeight:1.6, whiteSpace:"pre-line" }}>{row.value}</span>
            </div>
          ))}
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"10px 0 0" }}>{payTermsLine(job)}</p>
      </div>

      {/* 雇い手カード＋待遇表（2026-08-07たきと指示「詳細と同じ構造にしよう。待遇がない」＝
          求人詳細ページの主要情報直後のブロックをトレース）。
          待遇は掲載時に確定保存された job.perks のみを見る（2026-08-02規則・プロフィール現在値とのマージ禁止）。
          農園紹介モーダルへのタップは持ち込まない（この部品は表示専用） */}
      {emp && emp.nickname && (() => {
        const pk = job.perks || {};
        const perkRows = [
          { label:"送迎",     on: pk.has_transport,        value: pk.has_transport ? `あり${pk.transport_area ? "（" + pk.transport_area + "）" : ""}` : EMPTY_MARK },
          { label:"駐車場",   on: pk.has_parking,          value: pk.has_parking ? `あり${pk.parking_capacity ? "（" + pk.parking_capacity + "台）" : ""}` : EMPTY_MARK },
          { label:"通勤手当", on: pk.has_commute_allowance, value: pk.has_commute_allowance ? `あり${pk.commute_allowance_detail ? "（" + pk.commute_allowance_detail + "）" : ""}` : EMPTY_MARK },
          { label:"賞与",     on: pk.has_bonus,            value: pk.has_bonus ? "あり" : EMPTY_MARK },
          { label:"農家負担", on: pk.employer_pays_supplies, value: pk.employer_pays_supplies ? `あり${pk.supplies_cap ? "（" + pk.supplies_cap + "）" : ""}` : EMPTY_MARK },
          { label:"アクセサリー", on: pk.accessory_ok,          value: pk.accessory_ok ? "OK" : EMPTY_MARK },
          { label:"受動喫煙", on: !!pk.smoking_policy,
            value: pk.smoking_policy
              ? (pk.smoking_policy === "喫煙場所あり"
                  ? `喫煙場所あり${pk.smoking_area ? "（" + pk.smoking_area + "）" : ""}`
                  : pk.smoking_policy)
              : EMPTY_MARK },
        ];
        return (
          <div style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
            <div style={{ display:"flex", alignItems:"center", gap:14, textAlign:"left" }}>
              <Avatar url={emp.avatar_url} name={emp.nickname} size={70} />
              <div style={{ minWidth:0 }}>
                <p className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>{emp.nickname}さん</p>
                {empTrust?.ok && empTrust.member_since && (
                  <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>chitose-bank利用 {empTrust.member_since}から</p>
                )}
              </div>
            </div>
            <div style={{ borderTop:"1px solid #EBEBEB", margin:"14px 0 4px" }} />
            <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:4, letterSpacing:".06em", textAlign:"center" }}>待遇</p>
            <div style={{ width:"fit-content", margin:"0 auto" }}>
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

      {/* 作業説明 */}
      {job.jobBody && job.jobBody.trim() && (
      <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
        <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", marginBottom:8, letterSpacing:".06em" }}>作業内容</p>
        <p className="f-sans" style={{ fontSize:15, color:"#222", lineHeight:1.8, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }}><LinkifiedText text={job.jobBody} /></p>
      </div>
      )}

      {/* 経験・持ち物・備考（配列駆動・未入力は「ー」） */}
      <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:5 }}>
        {[
          { label:"持ち物",     value: disp(job.items), chips:true, pin:true },
          { label:"備考・注意", value: disp(job.cautions) },
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

      {/* 保険は「保険」タブへ移動（2026-08-08）＝ここには置かない */}

      {/* 危険区域セクション（両方空なら見出しごと非表示） */}
      {((job.dangerPlaces && job.dangerPlaces.length > 0) || (job.dangerTasks && job.dangerTasks.length > 0)) && (
      <div style={{ position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"16px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:20 }}>
          <span style={{ fontSize:18 }}>⚠️</span>
          <h3 className="f-sans" style={{ fontSize:16, fontWeight:700, color:"#222", margin:0 }}>作業上の注意・危険箇所</h3>
        </div>
        {(job.dangerPlaces && job.dangerPlaces.length > 0) && (
          <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:28 }}>
            {job.dangerPlaces.map((place, i) => (
              <DangerItem key={i} icon={place.icon} label={place.label} desc={place.desc} photos={place.photos || []} onPhotoClick={setDangerLightbox} />
            ))}
          </div>
        )}
        {(job.dangerTasks && job.dangerTasks.length > 0) && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {job.dangerTasks.map((task, i) => (
              <DangerItem key={i} icon={task.icon} label={task.label} desc={task.desc} photos={task.photos || []} onPhotoClick={setDangerLightbox} />
            ))}
          </div>
        )}
      </div>
      )}

      {/* 地図（集合場所のおおよその範囲・円のみ） */}
      <div style={{ position:"relative", width:"100%", marginBottom:20, borderRadius:12 }}>
        <JobLocationMap lat={job.lat} lng={job.lng} radius={job.radius} label={job.region}
          mapQuery={job.workAddress ? job.region + job.workAddress : job.region}
          addressShown={!!job.workAddress} />
      </div>

      {/* 開催期間カレンダー */}
      {job.dateStart && (
        <div style={{ marginBottom:20 }}>
          <CalendarView start={job.dateStart} end={job.dateEnd} readOnly={true} holidays={job.holidays} />
        </div>
      )}

      {/* 農家プロフィールのカード（FarmerTrustCard＝氏名・住所・連絡先・受け入れ実績）は削除
          （2026-08-08たきと指示）。求人詳細ページでも常設せず農園紹介モーダルの中に置いている
          ＝ここだけ常設で連絡先まで出ていた。雇い手の情報は主要情報の下の「雇い手カード＋待遇表」で足りる */}

      {/* 質問は「質問」タブへ移動（2026-08-08）＝ここには置かない */}
      </>)}
      </ContentQSwipeArea>

      {/* 右下の「トップ」浮遊ボックス（2026-08-08たきと指示）：sticky＝面のスクロールに合わせて
          右下に留まる（position:fixedは親のtransform（面の横スライド）で基準がずれるため使わない）。
          高さ0の帯にぶら下げる＝レイアウトの高さを増やさない */}
      <div style={{ position:"sticky", bottom:16, height:0, zIndex:5 }}>
        <button onClick={scrollToTop} aria-label="先頭に戻る" className="f-sans"
          style={{ position:"absolute", right:0, bottom:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1,
            width:56, height:56, borderRadius:16, background:"rgba(255,255,255,0.96)", border:"1px solid #EBEBEB",
            boxShadow:"0 2px 10px rgba(0,0,0,0.12)", cursor:"pointer", color:"#222" }}>
          <span style={{ fontSize:18, lineHeight:1 }}>↑</span>
          <span style={{ fontSize:10, fontWeight:800 }}>トップ</span>
        </button>
      </div>

      {/* 危険箇所の写真ライトボックス（全画面拡大） */}
      {dangerLightbox && (
        <div onClick={() => setDangerLightbox(null)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease", padding:16,
        }}>
          <button onClick={e => { e.stopPropagation(); setDangerLightbox(null); }} style={{
            position:"absolute", top:20, right:20,
            width:40, height:40, borderRadius:"50%",
            background:"rgba(255,255,255,0.15)", border:"none",
            color:"#fff", fontSize:22, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>✕</button>
          <img src={dangerLightbox} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}
