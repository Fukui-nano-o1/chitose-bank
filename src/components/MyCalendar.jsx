// 月カレンダー（#/calendar/month・分割・大物①・2026-07-24）：当事者applicationsの作業日程を月グリッドに塗る部品。
// 「今日」ページ(TodayPage)の奥の画面。プロフィール内蔵カレンダー・応募者ページ上部でも使用（backToToday無し）。
// 予定カード（アジェンダ）は2026-07-27に廃止：カレンダーは「日を選ぶ」だけを担い、
// 選んだ日の求人をどう見せるかは置き場所を持つページ側（応募者ページ）の仕事＝onDayTapJobsで渡す。
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, CALENDAR_WD, ROLE_ORANGE, ROLE_GREEN, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, entryWorkDays } from "../lib/utils";
import { getCache, setCache } from "../lib/viewCache";
// 重複日の色（2026-07-27たきと指示）：求人期間と求職期間が同じ日に重なる＝二重予約の警告色（既存の警告赤と同色）
const CAL_OVERLAP = "#E24B4A";
// #/calendar：自分（農家・働き手どちらの立場でも）の予定を月グリッドに塗る。
// 日付タップ＝その日の求人番号を親へ通知。
// jobsテーブルを直接読むとRLS(owner select=farmer_idのみ)で相手方の求人が読めないため、
// get_my_calendar_jobs（SECURITY DEFINER）経由で取得する。
// ★出すのは【公開中の求人】と【応募している求人】だけ（2026-08-19たきと指示・migration
//   20260819…_calendar_only_open_and_applied）。終了・審査中・下書きの自分の求人と、
//   いいねしただけの求人は出さない（いいねは予定ではない）。絞り込みはRPC側that行う。
export function MyCalendar({ backToToday, onDayTapJobs }) {
  // ── 前回の予定で即描画（2026-08-11たきと報告「日程の反映に10秒ほどかかる。一瞬で表示」）──
  // 鍵は今日ページと共用の "today:entries"＝同じ get_my_calendar_jobs の結果so、
  // 今日→カレンダーの行き来はどちらから入っても前回内容that即出る（取り直しは裏で走る＝SWR）。
  // ★キャッシュに入れてよいのはJSON安全な型だけ（2026-08-03のDate事故）。RPCの日付は文字列so安全。
  //   いいねは Set だと復元できないため配列で持ち、読み出すときに Set に戻す。
  const [entries, setEntries] = useState(() => getCache("today:entries") ?? []);
  const [loading, setLoading] = useState(() => getCache("today:entries") === undefined);
  const [cvYear, setCvYear] = useState(new Date().getFullYear());
  const [cvMonth, setCvMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState(null);
  const [likedIds, setLikedIds] = useState(() => new Set(getCache("cal:liked") ?? [])); // いいね済みjob_number（❤️表示）
  // 「下書きを進めませんか？」ボックスは削除（2026-08-19たきと指示）。
  // 下書きの続きは お仕事タブ（作成中）から入る＝カレンダーを開くたびに覆いかぶさる案内を出さない。
  // 付随して、カレンダーを開くたびに走っていた jobs（自分の下書き）の問い合わせ1本も無くなった
  const [flashNoPlan, setFlashNoPlan] = useState(false);
  const flashTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        // 2本は互いに独立so、awaitする前に同時に投げる（2026-07-27たきと指示「直列を並列に」）。
        // 以前は getSession→予定→いいね の直列3段で、しかも盤面を出すのに
        // いいね（❤️の飾り）の到着まで待っていた
        const calP = supabase.rpc("get_my_calendar_jobs");
        const savedP = supabase.from("saved_jobs").select("job_number").eq("worker_id", session.user.id);

        // 盤面は予定thatが返った時点で出す＝いいねは飾りso待たない
        const calRes = await calP;
        if (cancelled) return;
        // ★失敗時はキャッシュのままにする（res.errorを見ずに上書きすると、通信不調の数秒間だけ
        //   予定that消えて「予定はまだありません」に見える＝2026-08-07のフェイルオープンと同じ型）
        if (!calRes.error) { const rows = calRes.data || []; setEntries(rows); setCache("today:entries", rows); }
        setLoading(false);

        // いいねは届き次第あとから乗せる（thenableはPromise.resolveで包む・2026-07-26教訓）
        Promise.resolve(savedP).then(r => {
          if (cancelled || r.error || !r.data) return;
          const ids = r.data.map(x => x.job_number);
          setLikedIds(new Set(ids)); setCache("cal:liked", ids); // Setは保存できないso配列で持つ
        }).catch(() => {});
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const todayYmd = ymdLocal(new Date());
  // その予定が占める日は lib/utils の entryWorkDays に一本化（2026-08-11）。
  // 以前はここが求人期間の生の範囲だけを見ており、①働き手が申請した労働希望日（available_dates）が
  // どこにも反映されず、②農家が働く日を確定した後（agreed_dates）ですら期間まるごとを塗っていた
  // （名前チップだけが合意日を見ていた＝同じ画面の中で食い違っていた）。
  // 予定1件につき1回だけ日の集合を作る（月グリッドは3か月×42マスを走査するため、毎マス作り直さない）
  const workDays = useMemo(() => entries.map(e => entryWorkDays(e)), [entries]);
  const entryIdxOnDay = (ymd) => {
    const out = [];
    for (let i = 0; i < entries.length; i++) if (workDays[i].has(ymd)) out.push(i);
    return out;
  };
  const entriesOnDay = (dt) => entryIdxOnDay(ymdLocal(dt)).map(i => entries[i]);
  // ── 名前チップ「誰がいつ来るか」（2026-07-29たきと指示）──
  // 出すのは採用済みだけ＝両者の確認時刻が揃った応募（面接中はまだ来ると確定していないので出さない）。
  // 段階は appPhaseKey（帯の唯一のソース）で導く。statusは承認後も'approved'のままで、
  // 面接中と採用の区別は terms_confirmed_*_at にしか無いため、RPCにこの2列を返させている
  // （migration 20260729…_calendar_terms_confirmed_for_phase）。
  const HIRED_PHASES = ["contracted", "working"];
  const phaseOfEntry = (e) => appPhaseKey({
    status: e.application_status,
    terms_confirmed_worker_at: e.terms_confirmed_worker_at,
    terms_confirmed_farmer_at: e.terms_confirmed_farmer_at,
  });
  // 誰が来る日か＝塗りと同じ entryWorkDays で見る（働く日が確定していればその日、
  // 未確定なら働き手が申請した労働希望日、それも無ければ求人の日程どおり）
  const chipsOnDay = (dt) => {
    const ymd = ymdLocal(dt);
    return entryIdxOnDay(ymd)
      .map(i => entries[i])
      .filter(e => e.relation === "application" && e.partner_name && HIRED_PHASES.includes(phaseOfEntry(e)));
  };
  // 確定したか＝【採用したか】（2026-08-11たきと指示「承認したらならばカレンダーに反映。採用したならば確定」）。
  // 承認（面接中）はカレンダーに出すが、まだその日に働くと決まったわけではない＝未確定。
  // 採用（両者の確認時刻が揃う＝契約成立）で確定する。
  // ★確定の分かれ目は段階であって、農家が「働く日を決める」を押したか（agreed_dates の有無）ではない。
  //   働く日を決めるのは日を絞る操作で、契約の成立とは別（採用前に決めても確定にはならない）。
  // 求人期間の行（own＝自分の出した公開中の求人）は人との約束ではないので従来どおりの塗り。
  const isConfirmedEntry = (e) => e.relation !== "application" || HIRED_PHASES.includes(phaseOfEntry(e));

  const prevMo = () => { if (cvMonth === 0) { setCvYear(y => y - 1); setCvMonth(11); } else setCvMonth(m => m - 1); };
  const nextMo = () => { if (cvMonth === 11) { setCvYear(y => y + 1); setCvMonth(0); } else setCvMonth(m => m + 1); };
  // カレンダーのスワイプ月送り（2026-07-19）：左スワイプ=次月/右スワイプ=前月。
  // 判定は求人フローと同じ作法（60px以上かつ横が縦の1.5倍）。切替時は求人フローの横滑りアニメを流用
  // 指に連動する月送り（2026-07-30たきと指示）＋前後の月が見える3枚並び。
  // 盤面は［先月｜今月｜来月］の3枚を横に並べた帯で、いつも真ん中が今月。指で引くと帯ごと動くので、
  // 引いた先の月の日程がその場で見える。離すと、しきい値を超えていれば隣の月まで滑って着地する。
  const calTouch = useRef(null);
  const calTrackRef = useRef(null);
  const [calDx, setCalDx] = useState(0);         // 指の追従量（px）
  const [calSnap, setCalSnap] = useState(false); // true=離した後の滑り（アニメ）
  // 1枚分の幅は実測（px）で持つ（2026-07-30修理）。%で組むと、隣の月の右端の列が
  // 今月の1列目に重なって出た（%の解決先が枠とズレる）。実測pxなら重なりようがない
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = calTrackRef.current;
    if (!el) return;
    const measure = () => setTrackW(el.clientWidth || 0);
    measure();
    let ro;
    try { ro = new ResizeObserver(measure); ro.observe(el); } catch { window.addEventListener("resize", measure); }
    return () => { if (ro) ro.disconnect(); else window.removeEventListener("resize", measure); };
  }, [loading, entries.length]);
  const panelW = () => trackW || calTrackRef.current?.clientWidth || 320;
  const onCalTouchStart = (e) => {
    if (!e.touches || e.touches.length !== 1) { calTouch.current = null; return; }
    calTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null };
    setCalSnap(false);
  };
  const onCalTouchMove = (e) => {
    const s = calTouch.current; if (!s || !e.touches || !e.touches[0]) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;        // まだ方向が定まっていない
      s.lock = Math.abs(dx) > Math.abs(dy) * 1.5 ? "h" : "v";  // 一度決めたら最後まで変えない
    }
    if (s.lock !== "h") return;                                // 縦は日付タップ・ページのスクロールに渡す
    const w = panelW();
    setCalDx(Math.max(-w, Math.min(w, dx)));                   // 隣の月までで止める（3枚しか無いので）
  };
  const onCalTouchEnd = (e) => {
    const s = calTouch.current; calTouch.current = null;
    if (!s || s.lock !== "h" || !e.changedTouches || !e.changedTouches[0]) { setCalDx(0); return; }
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    const w = panelW();
    setCalSnap(true);
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) {
      setCalDx(0);                                             // 足りない引きは元の位置へ戻す
      setTimeout(() => setCalSnap(false), 240);
      return;
    }
    // 隣の月まで滑らせてから、中身を差し替えて真ん中に戻す（アニメ無しで戻すので継ぎ目は見えない）
    const toNext = dx < 0;
    setCalDx(toNext ? -w : w);
    setTimeout(() => {
      if (toNext) nextMo(); else prevMo();
      setCalSnap(false); setCalDx(0);
    }, 240);
  };
  // 帯の位置：既定は真ん中の月（1枚分だけ左へ）。そこから指のぶんだけずらす。すべてpx
  const calTrackStyle = {
    display:"flex", width: trackW ? trackW * 3 : "100%",
    transform: trackW ? `translateX(${-trackW + calDx}px)` : undefined,
    transition: calSnap ? "transform .24s cubic-bezier(.22,.8,.36,1)" : "none",
  };
  // 半分より引いたら、見出しの月表示も引いた先の月に変える（今どの月を見ているかと一致させる）
  const headOffset = calDx > panelW() * 0.5 ? -1 : calDx < -panelW() * 0.5 ? 1 : 0;
  const monthAt = (off) => { const d = new Date(cvYear, cvMonth + off, 1); return { y: d.getFullYear(), m: d.getMonth() }; };
  const headMonth = monthAt(headOffset);
  // 月ごとのマス（先頭の空白＋日付）。3枚並びのどの月にも同じ形で使う
  const monthCells = (y, m) => {
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < firstDay; i++) out.push(null);
    for (let dd = 1; dd <= daysInMonth; dd++) out.push(dd);
    return out;
  };

  const onDayTap = (dt) => {
    setSelectedDay(dt);
    const matches = entriesOnDay(dt);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (matches.length === 0) {
      setFlashNoPlan(true);
      flashTimer.current = setTimeout(() => setFlashNoPlan(false), 1800);
      onDayTapJobs?.(ymdLocal(dt), []);
      return;
    }
    setFlashNoPlan(false);
    // 予定カード（アジェンダ）は廃止（2026-07-27たきと指示）。日付タップの行き先は、
    // 置き場所を持っているページ側（応募者ページ）へ渡す＝カレンダーは「日を選ぶ」だけの部品になる
    onDayTapJobs?.(ymdLocal(dt), [...new Set(matches.map(m => m.job_number))]);
  };

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px" }}>
      {/* 「今日」の奥の画面（2026-07-24）：ナビ「今日」から来た時だけ、先頭に今日へ戻る導線を出す（プロフィール内蔵のカレンダーでは出さない） */}
      {backToToday && <button onClick={()=>{ window.location.hash="/calendar"; }} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:14, cursor:"pointer", padding:"4px 0 12px", display:"inline-flex", alignItems:"center", gap:6 }}>← 今日</button>}
      {/* 見出し「カレンダー」は削除（2026-07-27たきと指示）：カレンダーを見れば分かる＝重複。
          「今日」から入った月の予定（backToToday）だけは、どの画面かの手がかりとして残す */}
      {backToToday && <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"0 0 20px" }}>月の予定</h2>}
      {/* ★盤面は常に出す（2026-08-19たきと指示「カレンダーが閉じている状態から展開している。
          展開したままにしろ」）：以前は読み込み中だけ見出し1本ぶんの骨を出し、予定が0件なら
          盤面ごと案内文に差し替えていたため、データが届いた瞬間に下へ開いて見えていた。
          月のマス目は予定が無くても描けるので先に出し、予定の点・名前だけが後から入る＝形が変わらない。
          読み込み中／予定なしの知らせは、盤面の下に小さく添える（差し替えない） */}
      {(
        <>
          <div onTouchStart={onCalTouchStart} onTouchMove={onCalTouchMove} onTouchEnd={onCalTouchEnd} onTouchCancel={onCalTouchEnd} style={{ background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:10, touchAction:"pan-y", overflow:"hidden" }}>
            {/* 展開の2段（2026-07-27）：見出し（○○年○○月）が先に入り、盤面が少し遅れて開く。
                月送りのスワイプ中は見出しごと指について動く（2026-07-30たきと指示） */}
            <div className="cb-cal-head" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
              <button onClick={prevMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:13 }}>{"‹"}</button>
              {/* 引いた先が半分を超えたら、見出しもその月に変わる（見えている盤面と一致させる） */}
              <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222" }}>{headMonth.y}年{headMonth.m+1}月</span>
              <button onClick={nextMo} style={{ background:"#F7F7F7", border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:13 }}>{"›"}</button>
            </div>
            {/* ②縦の展開はここから下（見出しの帯が横に伸び切ってから開く・2026-07-27たきと指示） */}
            <div className="cb-cal-body-wrap"><div>
            {/* 3枚並び（2026-07-30たきと指示）：引いた先の月の日程がその場で見える。いつも真ん中が今月 */}
            <div ref={calTrackRef} style={{ overflow:"hidden" }}>
            <div style={calTrackStyle}>
            {/* 幅を測るまでは今月の1枚だけ描く（測る前の%組みで重なりが出たため・2026-07-30修理） */}
            {(trackW ? [-1, 0, 1] : [0]).map(off => { const mm = monthAt(off); return (
            <div key={`${mm.y}-${mm.m}`} style={{ width: trackW ? trackW : "100%", flexShrink:0, overflow:"hidden", opacity: off === 0 ? 1 : 0.55 }}>
            {/* minmax(0,1fr)（2026-07-30修理）：既定の 1fr は minmax(auto,1fr)＝中身の最小幅で列が広がる。
                名前チップ（4文字以上）が乗った日の列だけ広がり、盤面が枠からはみ出して隣の月と重なっていた */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:1, marginBottom:2 }}>
              {CALENDAR_WD.map(wd => <div key={wd} style={{ textAlign:"center", fontSize:9, color:"#B0B0B0", padding:"2px 0" }}>{wd}</div>)}
              {monthCells(mm.y, mm.m).map((dd, i) => {
                if (!dd) return <div key={`e${i}`} />;
                const dt = new Date(mm.y, mm.m, dd);
                const ymd = ymdLocal(dt);
                // 予定のある日は塗りつぶし（2026-07-27たきと指示：求人フローのカレンダーと同じ形式に統一）。
                // 求人期間（農家として）=緑／求職期間（働き手として）=橙／両方が重なる日=赤。
                // 濃さは公開中（jobs.status='open'）だけ濃色、それ以外（下書き・審査中・終了等）は薄色（同日改定）
                const idxs = entryIdxOnDay(ymd);
                const es = idxs.map(k => entries[k]);
                const farmerEs = es.filter(e => e.my_role === "farmer");
                const workerEs = es.filter(e => e.my_role === "worker");
                const hasFarmer = farmerEs.length > 0;
                const hasWorker = workerEs.length > 0;
                const isOpen = es.some(e => e.status === "open"); // 公開中が1件でもあれば濃色
                const baseColor = (hasFarmer && hasWorker) ? CAL_OVERLAP : hasFarmer ? ROLE_GREEN : hasWorker ? ROLE_ORANGE : null;
                // 名前チップが乗る日は塗りを薄くする（2026-07-29たきと指示）＝濃い地に濃いチップを重ねない。
                // 濃淡の既存ルール（濃い=公開中）はチップの無い日でそのまま維持される
                const chips = chipsOnDay(dt);
                // まだ確定していない日（2026-08-11）＝この日に出ている予定が全部「承認済み・採用前」。
                // 承認された時点で希望日はカレンダーに出すが、採用までは働くと決まっていない＝
                // ベタ塗りにすると決まったように見えるので、斜線にして見た目で分ける。
                // 採用（確定）が1件でもあればその日は確定扱い＝斜線にしない
                const onlyWish = idxs.length > 0 && idxs.every(k => !isConfirmedEntry(entries[k]));
                // 薄色＝同じ色の8%（+"14"）。文字は色に沿った濃い字にして読めるようにする
                const solid = isOpen && chips.length === 0 && !onlyWish;
                const fillBg = baseColor
                  ? (onlyWish
                      ? `repeating-linear-gradient(135deg, ${baseColor}3D 0 4px, ${baseColor}0F 4px 8px)`
                      : (solid ? baseColor : baseColor + "22"))
                  : null;
                const fillFg = baseColor ? (solid ? "#fff" : baseColor) : "#222";
                // いいね済み＝右上に小さく❤️。いいねしただけの求人はカレンダーに出さなくなった（2026-08-19）so、
                // ❤️that付くのは「応募した求人のうち、いいねもしていたもの」だけになる（relation==='liked'は消滅）
                const liked = es.some(e => likedIds.has(e.job_number));
                const isToday = ymd === todayYmd;
                const isSelected = selectedDay && ymdLocal(selectedDay) === ymd;
                return (
                  <button key={dd} onClick={() => onDayTap(dt)} style={{
                    position:"relative", padding:"7px 2px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, textAlign:"center",
                    background: fillBg || (isSelected ? "#E6F7EF" : "transparent"),
                    color: fillFg, fontWeight: (baseColor || isToday) ? 700 : 400,
                    boxShadow: isToday ? "inset 0 0 0 1.5px #00A86B" : "none",
                    // minWidth:0＝中身（名前チップ）で列を押し広げない。長い名前は下の…省略で収める
                    display:"flex", flexDirection:"column", alignItems:"stretch", gap:2, minWidth:0, overflow:"hidden", minHeight: chips.length > 0 ? 46 : undefined,
                  }}>
                    <span>{dd}</span>
                    {/* 誰が来るか（採用済みのみ）。色は段階色＝帯・チャットと同じ体系。
                        名前はニックネーム（未設定ならメール頭2文字）で、本名は返らない（resolve_actor_name） */}
                    {chips.slice(0, 2).map(e => (
                      <span key={e.application_id} title={`${e.partner_name}（${APP_PHASE_LABEL[phaseOfEntry(e)]}）`}
                        className="f-sans" style={{
                          background: APP_PHASE_COLOR[phaseOfEntry(e)], color:"#fff",
                          fontSize:9, fontWeight:700, lineHeight:1.5, borderRadius:3, padding:"0 3px",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", display:"block",
                          minWidth:0, maxWidth:"100%", boxSizing:"border-box",
                        }}>{e.partner_name}</span>
                    ))}
                    {chips.length > 2 && (
                      <span className="f-sans" style={{ fontSize:8, fontWeight:700, color:"#717171", lineHeight:1.4 }}>＋{chips.length - 2}</span>
                    )}
                    {liked && <span aria-hidden="true" style={{ position:"absolute", top:1, right:2, fontSize:8, lineHeight:1 }}>❤️</span>}
                  </button>
                );
              })}
            </div>
            </div>
            ); })}
            </div>
            </div>{/* 3枚並びここまで */}
            </div></div>{/* ②縦の展開ここまで */}
          </div>
          {/* 盤面の下の説明文（役割色の凡例・名前チップの凡例・斜線の意味・濃淡と❤️・名前の注記）は
              すべて削除（2026-08-19たきと指示「カレンダーの説明文。すべて削除」）＝盤面だけを見せる。
              色や斜線の意味そのものは変えていない（塗り分けは従来どおり） */}
          {flashNoPlan && (
            <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", margin:"10px 0 0" }}>この日の予定はありません。</p>
          )}
        </>
      )}
    </div>
  );
}
