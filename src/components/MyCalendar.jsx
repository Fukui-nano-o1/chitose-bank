// 月カレンダー（#/calendar/month・分割・大物①・2026-07-24）：当事者applicationsの作業日程を月グリッドに塗る部品。
// 「今日」ページ(TodayPage)の奥の画面。プロフィール内蔵カレンダー・応募者ページ上部でも使用（backToToday無し）。
// 予定カード（アジェンダ）は2026-07-27に廃止→2026-08-21に日付シートとして復活：
// 日をタップすると、その日の予定と操作（日程の移動・コピー・内容の編集）をシートで出す。
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { ymdLocal, CALENDAR_WD, ROLE_ORANGE, ROLE_GREEN, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, entryWorkDays, calFmtDate, dateRangeLabel } from "../lib/utils";
import { getCache, setCache } from "../lib/viewCache";
import { fbSuccess, fbError } from "../lib/feedback";
import { NavIcon } from "./NavIcons";
import { Dots } from "./ui";
// 重複日の色（2026-07-27たきと指示）：求人期間と求職期間が同じ日に重なる＝二重予約の警告色（既存の警告赤と同色）
const CAL_OVERLAP = "#E24B4A";
// #/calendar：自分（農家・働き手どちらの立場でも）の予定を月グリッドに塗る。
// 日付タップ＝その日の予定と操作を日付シートで開く（この部品の中で完結・親への通知はしない）。
// jobsテーブルを直接読むとRLS(owner select=farmer_idのみ)で相手方の求人が読めないため、
// get_my_calendar_jobs（SECURITY DEFINER）経由で取得する。
// ★出すのは【公開中と終了した自分の求人】と【応募している求人（完了ぶんも含む）】と
//   【いいねした求人（公開中）】。審査中・下書きは出さない（2026-08-25たきと指示
//   「なぜか、終了した求人がカレンダーから消えている」で終了ぶんを戻した）
//   （migration 20260819…_calendar_only_open_and_applied → …_calendar_restore_liked_rows で
//    いいねだけ復元）。絞り込みはRPC側that行う＝フロントに条件を書かない。
// canPostJob＝予定のない日のタップで「求人を出す」を出すか（2026-08-21たきと指示）。
// 農家の置き場所（お仕事タブのカレンダー面・応募者ページ上部）だけ true。
// 働き手のステータスページには出さない＝求人を出すのは農家の操作so、置き場所で出し分ける
// onDayJobs(ymd, jobNumbers)＝予定のある日のタップを親へ渡す（2026-08-21たきと指示
// 「応募者ページはカレンダーだけ。特定の日程をタップして該当する求人カードのみ表示」）。
// 渡された置き場所では日付シートを開かず、親that求人カードの絞り込みを行う。
// 予定のない日は従来どおり（canPostJobなら求人を出すシート）＝絞り込みの解除は親の解除ボタンthat担う
// noDaySheet＝予定のある日をタップしても日付シートを開かない（2026-08-22たきと指示）。
// ステータスページ用＝カレンダーの下に同じ求人のカードが常に並ぶ置き場所で、シートは二重の表示になるため
export function MyCalendar({ backToToday, canPostJob, onDayJobs, dayJobsAll, noDaySheet }) {
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
  // ── 日付シートと移動モード（2026-08-19たきと指示＝TimeTree式のコピー・移動・編集をカレンダーへ）──
  // シートはこの部品を置いた全ての画面で開く（お仕事タブのカレンダー面・応募者ページ上部・ステータスページ）。
  const [daySheet, setDaySheet] = useState(null);   // { ymd, idxs } | null
  const [moveMode, setMoveMode] = useState(null);   // { jobNumber, title } | null＝日程の移動先を選んでいる最中
  // dayOwn＝親へ日を渡す置き場所（農家のカレンダー面）で選んだ日の【自分が出した求人】の予定。
  // その置き場所は日付シートを開かない（日タップ＝求人カードの絞り込み）ため、移動・コピーの入口が
  // 無くなっていた（2026-08-25たきと指示「自分が出した求人予定をタップで移動とコピー可能にして」）。
  // 盤面のすぐ下に操作の行として出す＝カードを覆わない・移動モードは同じ盤面で行き先をタップできる
  const [dayOwn, setDayOwn] = useState(null);       // "YYYY-MM-DD" | null（予定は毎回この日から引き直す＝取り直しが入っても添字がずれない）
  const [moving, setMoving] = useState(false);      // 多重送信ガード
  const [reloadKey, setReloadKey] = useState(0);    // 移動成功後に予定を取り直す合図（loadingは立てない＝骨は出ない）

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
  }, [reloadKey]);

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
  // 求人期間の行（own＝自分の出した公開中の求人／liked＝いいね）は人との約束ではないので従来どおりの塗り。
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

  // ── 日程の移動（2026-08-19）：シートの「日程をうごかす」→盤面で移動先の日をタップ→確認→RPC ──
  // 壁はDB側 move_job_dates が担保（本人・draft/pending/open・進行中の応募なし・今日以降・
  // 期間と休日を同じ日数ずらす・記録は jobs の firehose that event_audit に自動で残す）
  const confirmMove = async (ymd) => {
    if (moving) return;
    const mm = moveMode;
    if (!window.confirm(`#${mm.jobNumber}「${mm.title}」を ${calFmtDate(ymd)} 開始にうごかします。期間と休日も同じ日数ずれます。よろしいですか？`)) return;
    setMoving(true);
    try {
      const { data, error } = await supabase.rpc("move_job_dates", { p_job_number: mm.jobNumber, p_new_start: ymd });
      if (error || !data?.ok) {
        fbError();
        const r = data?.reason;
        alert(r === "has_applications" ? "応募が届いているため、日程はうごかせません。日程の相談はチャットで行ってください。"
          : r === "past_date" ? "今日より前の日にはうごかせません。"
          : r === "bad_status" ? "終了した求人の日程はうごかせません。"
          : "うごかせませんでした：" + (r || error?.message || "不明"));
        // 過去日だけは選び直せるようにモードを残す。それ以外は根本的に動かせないのでモード解除
        if (r !== "past_date") setMoveMode(null);
        return;
      }
      fbSuccess();
      setMoveMode(null);
      setReloadKey(k => k + 1); // 予定を取り直して盤面に反映（前回内容を出したまま裏で差し替え）
    } finally { setMoving(false); }
  };
  // コピー＝既存 copy_job のレールそのまま（FarmerDashboard runJobAction "copy" と同じ作法・
  // sessionStorage経由で新しい下書きを即復元）。日程は引き継がれない（2026-08-16たきと指示）
  const copyFromSheet = async (n) => {
    const { data, error } = await supabase.rpc("copy_job", { p_job_number: n });
    if (error || !data?.ok) { fbError(); alert("コピーに失敗しました：" + (data?.reason || error?.message || "不明")); return; }
    try { if (data.job) sessionStorage.setItem("cb_editJobPrefill", JSON.stringify(data.job)); } catch {}
    if (data.dates_cleared) alert("コピーしました。作業日程は引き継がないため空になっています。確認ページの「日程」から新しい日を選んでください。");
    setDaySheet(null);
    window.location.hash = "/work/edit/" + data.job_number; // 新しい下書きを編集フローで開く
  };
  // 内容の編集＝既存レール（公開中は一時非公開にしてから編集フローへ・FarmerDashboardと同じ確認文言）。
  // ★unpublish_job は応募中・面接中を見送りにする（migration 20260808004900）＝確認文に明記
  const editFromSheet = async (e) => {
    if (e.status === "open") {
      if (!window.confirm("内容を編集するには、いったん一時非公開にします。（さがすに表示されなくなります。応募中・面接中の方は見送りになります。編集後にもう一度掲載できます）よろしいですか？")) return;
      const { data, error } = await supabase.rpc("unpublish_job", { p_job_number: e.job_number });
      if (error || !data?.ok) { fbError(); alert("一時非公開にできませんでした：" + (data?.reason || error?.message || "不明")); return; }
    }
    setDaySheet(null);
    window.location.hash = "/work/edit/" + e.job_number;
  };
  const onDayTap = (dt) => {
    const ymd = ymdLocal(dt);
    // 移動モード中の日付タップ＝移動先の決定（最優先・シートや親への通知はしない）
    if (moveMode) { confirmMove(ymd); return; }
    setSelectedDay(dt);
    const idxs = entryIdxOnDay(ymd);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (idxs.length === 0) {
      // 予定のない日＝「求人を出す」の入口（2026-08-21たきと指示）。農家の置き場所だけ。
      // 働き手の置き場所（canPostJobなし）は従来どおり「この日の予定はありません」を一瞬出す
      if (canPostJob) { setDaySheet({ ymd, idxs: [] }); return; }
      setFlashNoPlan(true);
      flashTimer.current = setTimeout(() => setFlashNoPlan(false), 1800);
      return;
    }
    setFlashNoPlan(false);
    // 予定のある日のタップを親へ渡す置き場所（応募者ページ・2026-08-21たきと指示）：
    // シートは開かず、その日の求人番号を親に知らせて求人カードの絞り込みをさせる。
    // ★親へ渡すのは【自分が出した求人（relation='own'）】だけ（2026-08-22たきと報告「まだ表示されない」の修理）。
    //   このカレンダーには働き手として応募した仕事・いいね（'application'/'liked'）も載るため、
    //   そういう日を渡すと応募者ページには出すカードが無く「求人はありません」の空絞り込みになっていた。
    //   自分の求人が無い日は通常の日付シートへフォールスルー＝応募の予定も「求人ページを見る」で確認できる
    // ★dayJobsAll＝関係を問わず、その日の求人番号を全部渡す（2026-08-23たきと指示
    //   「タップした求人カードを表示」＝働き手のカレンダーページ用）。働き手の一覧には
    //   応募した求人・いいねした求人が並ぶので、'own' だけに絞ると渡すものが無くなる
    if (onDayJobs) {
      const picked = [...new Set(idxs
        .filter(i => dayJobsAll || entries[i]?.relation === "own")
        .map(i => entries[i]?.job_number).filter(Boolean))];
      if (picked.length > 0) {
        onDayJobs(ymd, picked);
        // 自分が出した求人の予定がある日は、盤面の下に移動・コピーの行を出す（親の絞り込みと同じ間隔で入り切りする）
        const mine = idxs.filter(i => entries[i]?.relation === "own");
        setDayOwn(prev => prev === ymd || mine.length === 0 ? null : ymd);
        return;
      }
    }
    // ★ステータスページ（noDaySheet）は予定のある日のシートを開かない（2026-08-22たきと指示
    //   「ボックス展開しなくていい。求人カードが表示されるんだから」）＝カレンダーの下に
    //   同じ求人のカードが常に並んでいるため、シートは二重の表示になる。タップは選択の目印だけ
    if (noDaySheet) return;
    // 日付タップ＝日付シートを開く（2026-08-21たきと指示）。
    // 以前は応募者ページ・ステータスページだけ「その日の求人カードへスクロール＋黄色く光らせる」
    // という別の動きをしており（onDayTapJobs）、そこではシートが永久に開かなかった。
    // シートはその日の予定を一覧で見せ、求人ページへも行けるso、カードへ飛ばす動きは畳んだ
    setDaySheet({ ymd, idxs });
  };

  return (
    <div style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px" }}>
      {/* 「今日」の奥の画面（2026-07-24）：ナビ「今日」から来た時だけ、先頭に今日へ戻る導線を出す（プロフィール内蔵のカレンダーでは出さない） */}
      {backToToday && <button onClick={()=>{ window.location.hash="/calendar"; }} className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:14, cursor:"pointer", padding:"4px 0 12px", display:"inline-flex", alignItems:"center", gap:6 }}>← 今日</button>}
      {/* 見出し「カレンダー」は削除（2026-07-27たきと指示）：カレンダーを見れば分かる＝重複。
          「今日」から入った月の予定（backToToday）だけは、どの画面かの手がかりとして残す */}
      {backToToday && <h2 className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"0 0 20px" }}>月の予定</h2>}
      {/* 移動モードの帯（2026-08-19）：日程の移動先を選んでいる最中の案内。帯・トーストは
          「外」that無いので閉じるボタンを置いてよい（2026-08-19の✕全廃の対象外と同じ扱い） */}
      {moveMode && (
        <div className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, background:"#0E8A6B", color:"#fff", borderRadius:12, padding:"10px 14px", marginBottom:10 }}>
          <span style={{ fontSize:13, fontWeight:700, minWidth:0 }}>{moving ? <>うごかしています<Dots /></> : <>#{moveMode.jobNumber} の新しい開始日をタップしてください</>}</span>
          <button onClick={()=>setMoveMode(null)} disabled={moving} className="f-sans" style={{ flexShrink:0, background:"none", border:"none", color:"#fff", fontSize:13, fontWeight:700, textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer", padding:0 }}>やめる</button>
        </div>
      )}
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
                const liked = es.some(e => e.relation === "liked" || likedIds.has(e.job_number)); // いいね済み＝右上に小さく❤️
                const isToday = ymd === todayYmd;
                const isSelected = selectedDay && ymdLocal(selectedDay) === ymd;
                return (
                  <button key={dd} onClick={() => onDayTap(dt)} style={{
                    position:"relative", padding:"7px 2px", borderRadius:8, border:"none", cursor:"pointer", fontSize:12, textAlign:"center",
                    background: fillBg || (isSelected ? "#E6F7EF" : "transparent"),
                    color: fillFg, fontWeight: (baseColor || isToday) ? 700 : 400,
                    boxShadow: isToday ? "inset 0 0 0 1.5px #00A86B" : "none",
                    // minWidth:0＝中身（名前チップ）で列を押し広げない。長い名前は下の…省略で収める
                    display:"flex", flexDirection:"column", alignItems:"stretch", gap:2, minWidth:0, overflow:"hidden",
                    // マスの高さ（2026-08-23たきと指示「カレンダーを縦に伸ばして」）：名前チップが乗る日だけ
                    // 46pxで、それ以外は中身なりの高さだった＝盤面が詰まって見えた。予定の無い日にも下限を持たせる
                    minHeight: chips.length > 0 ? 56 : 44,
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
                    {liked && <span aria-hidden="true" style={{ position:"absolute", top:1, right:2, display:"flex", color:"#E24B4A" }}><NavIcon name="heartFill" size={8} /></span>}
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
          {/* 選んだ日の「自分が出した求人」の操作（2026-08-25）：移動は掲載中だけ・コピーは終了した求人でも可
              （日付シートの規則と揃える＝同じ操作が画面ごとに違わない）。実行は同じ関数を呼ぶ */}
          {!moveMode && dayOwn && entryIdxOnDay(dayOwn).some(i => entries[i]?.relation === "own") && (
            <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:8 }}>
              {entryIdxOnDay(dayOwn).filter(i => entries[i]?.relation === "own").map(i => {
                const e = entries[i];
                if (!e) return null;
                const title = ((e.crop||"") + " " + (e.task||"")).trim() || "無題";
                const live = e.status === "open";
                return (
                  <div key={"own-act-" + e.job_number} style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, padding:"10px 12px" }}>
                    <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", flex:"1 1 auto", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {title} <span style={{ color:"#B0B0B0", fontWeight:600, fontSize:11 }}>#{e.job_number}</span>
                    </span>
                    {live && (
                      <button onClick={()=>setMoveMode({ jobNumber: e.job_number, title })} className="f-sans"
                        style={{ flexShrink:0, background:"#0E8A6B", color:"#fff", border:"none", borderRadius:20, padding:"7px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}>日程をうごかす</button>
                    )}
                    <button onClick={()=>copyFromSheet(e.job_number)} className="f-sans"
                      style={{ flexShrink:0, background:"#F7F7F7", color:"#222", border:"1px solid #EBEBEB", borderRadius:20, padding:"7px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}>コピー</button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {/* 日付シート（2026-08-19たきと指示＝TimeTree式）：日をタップ→その日の予定と操作。
          規格＝cb-box-overlay + cb-lock-scroll 併用（2026-08-15）・✕なし・外タップで閉じる（2026-08-19）。
          操作は 移動（新設 move_job_dates）／コピー（既存 copy_job）／内容の編集（既存の
          一時非公開→編集レール）＝実行の壁は全てDB側that担保。応募の行は見るだけ（相手thatいる予定）。 */}
      {daySheet && (
        <div onClick={()=>setDaySheet(null)} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:8000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}>{calFmtDate(daySheet.ymd)} の予定</p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            <div style={{ display:"flex", flexDirection:"column", gap:10, maxHeight:"55vh", overflowY:"auto", overscrollBehavior:"contain" }}>
              {/* 予定のない日（canPostJobの置き場所だけここに来る）＝求人を出す入口（2026-08-21たきと指示）。
                  タップした日は cb_newJobDateStart で求人フローへ渡し、開始日の初期値になる（一度きり・下書き優先） */}
              {daySheet.idxs.length === 0 && (
                <div style={{ textAlign:"center", padding:"6px 0 2px" }}>
                  <p className="f-sans" style={{ fontSize:13, color:"#999", margin:"0 0 14px" }}>この日の予定はありません。</p>
                  <button onClick={()=>{ try { sessionStorage.setItem("cb_newJobDateStart", daySheet.ymd); } catch {} setDaySheet(null); window.location.hash = "/work/new"; }}
                    className="f-sans" style={{ background:"#0E8A6B", color:"#fff", border:"none", borderRadius:24, padding:"12px 22px", fontSize:14, fontWeight:700, cursor:"pointer" }}>
                    この日から始まる求人を出す
                  </button>
                </div>
              )}
              {daySheet.idxs.map(i => {
                const e = entries[i];
                const own = e.relation === "own";
                // 掲載中の求人だけ、日程の移動・内容の編集を出す（終了した求人は動かさない＝過去の求人はいじらない）
                const ownLive = own && e.status === "open";
                const title = ((e.crop||"") + " " + (e.task||"")).trim() || "無題";
                return (
                  <div key={e.relation + e.job_number + (e.application_id||"")} style={{ border:"1px solid #EBEBEB", borderRadius:12, padding:"12px 14px" }}>
                    <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0 }}>{title} <span style={{ color:"#B0B0B0", fontWeight:600, fontSize:12 }}>#{e.job_number}</span></p>
                    <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>
                      {dateRangeLabel(e.date_start, e.date_end)}{e.work_time ? `　${e.work_time}` : ""}
                    </p>
                    {e.relation === "application" && e.partner_name && (
                      <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>
                        {e.partner_name}さん　<span style={{ color: APP_PHASE_COLOR[phaseOfEntry(e)], fontWeight:700 }}>{APP_PHASE_LABEL[phaseOfEntry(e)]}</span>
                      </p>
                    )}
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:10 }}>
                      {ownLive && (
                        <button onClick={()=>{ setDaySheet(null); setMoveMode({ jobNumber: e.job_number, title }); }} className="f-sans"
                          style={{ background:"#0E8A6B", color:"#fff", border:"none", borderRadius:20, padding:"7px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}>日程をうごかす</button>
                      )}
                      {own && (
                        <button onClick={()=>copyFromSheet(e.job_number)} className="f-sans"
                          style={{ background:"#F7F7F7", color:"#222", border:"1px solid #EBEBEB", borderRadius:20, padding:"7px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}>コピー</button>
                      )}
                      {ownLive && (
                        <button onClick={()=>editFromSheet(e)} className="f-sans"
                          style={{ background:"#F7F7F7", color:"#222", border:"1px solid #EBEBEB", borderRadius:20, padding:"7px 14px", fontSize:13, fontWeight:700, cursor:"pointer" }}>内容を編集</button>
                      )}
                      <button onClick={()=>{ setDaySheet(null); window.location.hash = "/work/job/" + e.job_number; }} className="f-sans"
                        style={{ background:"none", color:"#717171", border:"none", padding:"7px 4px", fontSize:13, fontWeight:700, textDecoration:"underline", textUnderlineOffset:3, cursor:"pointer" }}>求人ページを見る</button>
                    </div>
                    {ownLive ? (
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0" }}>
                        日程をうごかせるのは、応募が届く前だけです。届いた後の日程はチャットで相談してください。
                      </p>
                    ) : own ? (
                      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"8px 0 0" }}>
                        掲載が終わった求人です。日程の変更や内容の編集はできません（記録として残ります）。
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
