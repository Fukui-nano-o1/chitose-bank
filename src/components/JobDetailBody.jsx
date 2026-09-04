// 求人詳細の本文＝ボックス版（カレンダーのカード・応募者シートなど、面の中に開く求人詳細）。
// 2026-09-02たきと指示「ボックス展開している求人詳細も同じ構造にしよう」＝求人詳細ページ
// （JobSearchMapView）と同じ Airbnb の掲載ページの並びにした。区画の部品はページ側と【同じもの】を
// import して使う（JobDetailPanel）＝見た目・並びを2箇所で作らない。並びの正は JobDetailPanel.jsx
// 冒頭のコメント＝ページ側を並べ替えたらここも揃える。
//   写真 → タイトル（3行：作物 作業／場所／事実の1行）→ 募集主の行 → ポイント → 作業内容 → 待遇 →
//   作業日程 → 評価 → 募集主について → 作業の場所 → 知っておくこと
// 【ページと違うところ（ボックスの都合）】
//   ・写真は sticky の全面（.job-hero）にしない＝面の中で写真を留めると中身が読めない。引き伸ばしも切る
//     （stretch=false・面の中では window.scrollY が常に0なので、下向きの指が全部「引き下げ」に見えるため）
//   ・目次の帯（JobSectionNav・PCの写真を過ぎると出る帯）は出さない＝ページの固定位置に依存する部品
//   ・応募パネル／その他の求人／報告リンク＝ボックスの外の操作なので置かない（この部品は表示専用）
//   ・農園紹介モーダル（onOpenIntro）は持ち込まない＝募集主の行・募集主カードはタップしても開かない
// 【残したもの】仕事の内容／質問のタブ（横スワイプ・最初のタブでさらに右スワイプ＝onBack）、
//   右下の「トップ」浮遊ボックス、危険箇所の写真の拡大。
// ※掲載前の確認の記録は載せない：job_publish_checks のRLSが本人・運営のみで、働き手には常に0件
//   ＝「記録なし」という嘘の表示になる。開示するならDB側の判断が先（勝手に開けない）。
// job は mapJobPublicRow() で整形済みのオブジェクトを渡すこと。me は Q&A の投稿判定・評価の閲覧・
// 番地の開示に使う（任意）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { MaskedAddress, MaskedText } from "./ui";
import { JobQuestions, ContentQTabs, ContentQSwipeArea } from "./JobQuestions";
import { JobPhotoGallery, JobKeyFacts, JobHostRow, JobHighlights, JobDescription, JobAmenities,
  JobScheduleSection, JobReviewsAndHost, JobLocationSection, JobThingsToKnow } from "../features/jobs/search/components/JobDetailPanel";

export function JobDetailBody({ job, me, onBack }) {
  const [activeSlide, setActiveSlide] = useState(0);
  // 仕事の内容／質問のタブ（2026-08-08たきと指示）＝求人詳細ページと同じ部品（ContentQTabs＋ContentQSwipeArea）。
  // ★最初のタブでさらに右スワイプ＝onEdgeSwipe("prev")→onBack（面を戻る）＝
  //   タブ切替と「横スワイプで戻る」が同じ指の動きで両立する
  const [tab, setTab] = useState("content");
  const rootRef = useRef(null);
  const [dangerLightbox, setDangerLightbox] = useState(null);
  // トップ写真のループ（2026-08-08たきと指示「最後の写真をスライドしたらトップ写真に戻れ」）＝
  // 求人詳細ページ（JobSearchMapView・2026-07-16）の実装をそのままトレース：
  // 両端にクローンを置き（[最後, ...本物, 最初]）、端に着地した瞬間に本物へ瞬間ジャンプする
  const photoScrollerRef = useRef(null);
  const photoCount = job?.photos?.length || 0;
  const photosLooped = photoCount > 1;
  // 農家プロフィール（求人詳細ページと同じ2本を並列で・2026-08-02の作法）。
  // job_employer_profile／job_employer_trust_info＝訪問者にも開いている公開RPC（当事者は掲載終了後も可）
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
  return (
    <div ref={rootRef} className="job-detail-boxed">
      {/* 写真＝ページと同じギャラリー部品（スマホ＝横スワイプ＋「n / N」・タップで写真の一覧／PC＝モザイク）。
          原寸で見せる（カード用サムネにしない・2026-08-02規則）。.job-hero で包まない＝面の中では留めない */}
      <JobPhotoGallery job={job} employer={emp} photosLooped={photosLooped} activeSlide={activeSlide}
        scrollerRef={photoScrollerRef} onScroll={handlePhotoScroll} stretch={false} />

      {/* 仕事の内容／質問（2026-08-08たきと指示）＝求人詳細ページと同じタブ＋横スワイプ。
          最初のタブでさらに右スワイプ＝面を戻る（onBack）＝1つの指の動きで両立させる */}
      <ContentQSwipeArea value={tab} onChange={setTab}
        onEdgeSwipe={(d)=>{ if (d === "prev" && onBack) onBack(); }}>
      <ContentQTabs value={tab} onChange={setTab} />
      {tab === "questions" ? (
        /* 質問（求人Q&A・詳細/確認ページと同じ部品＝公開Q&A。投稿ゲート・NG検査はサーバー側が従来どおり） */
        <JobQuestions jobNumber={job.id} me={me} />
      ) : (<>

      {/* ── ここからAirbnbの掲載ページの並び（ページ側 JobSearchMapView と同じ・2026-09-02）── */}
      {/* タイトルブロック＝1行目 作物 作業／2行目 場所／3行目 事実の1行（灰色）。
          番地の開示はDB側が正（jobs_publicのanonマスク）＝ログインしていれば届いた値が出る。
          町域の伏せ字は masked_fields に載っている時だけ描く＝町域が未設定の求人に偽のモザイクを出さない */}
      <div style={{ marginBottom:0 }}>
        <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:0, lineHeight:1.3 }}>
          {job.crop} {job.task}
        </h2>
        {job.region && (
          <p className="f-sans" style={{ fontSize:15, fontWeight:600, color:"#222", margin:"6px 0 0", lineHeight:1.5 }}>
            {job.region}
            {Array.isArray(job.maskedFields) && job.maskedFields.includes("town") && <MaskedText label="町域から先の住所" chars={4} />}
            {me && <MaskedAddress value={job.workAddress} unlocked={true} exists={job.hasWorkAddress} />}
          </p>
        )}
        <JobKeyFacts job={job} />
        <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"6px 0 0", userSelect:"text" }}>#{job.id}</p>
      </div>

      {/* 募集主の行（Hosted by）→ ポイント（Highlights）→ 作業内容（Description）→ 待遇（Amenities）→ 作業日程 */}
      <JobHostRow job={job} employer={emp} trust={empTrust} />
      <JobHighlights job={job} />
      <JobDescription job={job} />
      <JobAmenities job={job} />
      <JobScheduleSection job={job} />

      {/* 評価 → 募集主について（Reviews → Meet your host。1部品＝評価の取得を1回にするため） */}
      <JobReviewsAndHost job={job} employer={emp} trust={empTrust} me={me} />

      {/* 作業の場所（地図）＝Where you'll be */}
      <JobLocationSection job={job} me={me} />

      {/* 知っておくこと＝きまり（持ち物・備考・時間外・支払条件ほか）／危険箇所／保険（掲載時凍結の snapshot のみ） */}
      <JobThingsToKnow job={job} onPhoto={setDangerLightbox} />
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
        <div className="cb-lock-scroll" onClick={() => setDangerLightbox(null)} style={{
          position:"fixed", inset:0, zIndex:10000,
          background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", animation:"fadeIn .2s ease", padding:16,
        }}>
          <img src={dangerLightbox} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}
