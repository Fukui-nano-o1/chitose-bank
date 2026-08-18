// 📆 今日ページ（分割・段階2で切り出し・2026-07-24）：ナビ4番。やること（my_todo_items）＋きょうの仕事＋つぎの予定＋メモ。
import { useState, useEffect, useRef } from "react";
import { getCache, setCache } from "../lib/viewCache";
import { useRefreshTick, REFRESH_APPLICATIONS } from "../lib/refreshBus";
import { ymdLocal, calAddDays, calFmtDate, ROLE_ORANGE, ROLE_GREEN,
  workerUnsetCount, employerUnsetCount, WORKER_UNSET_COLUMNS, EMPLOYER_UNSET_COLUMNS, entryWorkDays } from "../lib/utils";
import { fbSuccess, fbError } from "../lib/feedback";
import { Celebration } from "./Celebration";
import { Avatar, AutoSkeleton, useSkeletonProbe, Dots, DeclaredBadge, PunchGapNotice } from "./ui";
import ContractPartyName from "./ContractPartyName";
import { TimeCorrectionSheet } from "./TimeCorrectionSheet";
import { getSession, fetchMyCalendarJobs, fetchMyTodoItems, fetchMyWorkerProfile, fetchMyEmployerProfile,
  countMyJobs, fetchMyEmergencyContact, fetchMyApplicationTerms, fetchMyPunchFacts, fetchPendingCorrections,
  decideTimeCorrection, runTodoRpc } from "../features/today/todayApi";
import { InterviewReplyPanel, NewApplicantsPanel, EmergencyStagePanel, HireStagePanel,
  HIRE_SHEET_PATH, markHireSheet } from "../features/today/components/StagePanels";

// #/calendar：ナビ4番「📆 今日」。きょうの契約済み仕事＋つぎの予定（向こう7日）。
// カレンダーは各役割の面へ移植（農家＝応募者ページ／働き手＝ステータスページ・2026-07-27）。
// 両役（働き手・農家）を持つ人だけ役割タブを出す。タブはこのページの表示だけを切替（全体モードは変えない）。
export function TodayPage({ me, defaultRole }) {
  // 前回この面が出した内容をまず描く→裏で最新に差し替える（stale-while-revalidate・2026-07-27たきと指示）
  const refreshTick = useRefreshTick(REFRESH_APPLICATIONS);
  const [loading, setLoading] = useState(() => getCache("today:entries") === undefined);
  const [entries, setEntries] = useState(() => getCache("today:entries") ?? []);
  const [hasWorker, setHasWorker] = useState(() => getCache("today:roles")?.w ?? false);
  const [hasFarmer, setHasFarmer] = useState(() => getCache("today:roles")?.f ?? false);
  const [role, setRole] = useState(defaultRole === "farmer" ? "farmer" : "worker");
  // 仮配置の骨を測るref：役割で箱の数が違うので鍵も分ける（働き手／農家）
  const skelRef = useSkeletonProbe("today:" + role);
  const [todos, setTodos] = useState(() => getCache("today:todos") ?? []);     // やることフィード（my_todo_items・状態カードの単一ソース）
  // jobCount（自分が出した求人の数）のstateは廃止（2026-08-03）：カレンダー箱のタップ可否判定が
  // 唯一の読み手だったが、タップ不能を全廃したため不要になった。求人の有無は下の f（農家か）の算出で今も使う
  // プロフィールの未入力数（役割ごと）。未入力がある間だけ「プロフィールの未入力」ボックスが現れる（2026-08-03たきと指示）
  const [profileUnset, setProfileUnset] = useState(() => getCache("today:unset") ?? null);
  const [hiredIds, setHiredIds] = useState(() => new Set(getCache("today:hired") ?? [])); // 採用済み（両者の確認が揃った）自分の応募ID
  // 画面の状態→キャッシュの写し（2026-07-27）。やることは片付けると手元のstateだけから消えるため、
  // ここで一括して写す。読み込みが終わるまでは写さない（空を焼き付けない）
  useEffect(() => { if (loading) return; setCache("today:todos", todos); }, [todos, loading]);
  const [confirming, setConfirming] = useState("");
  // 完了の祝祭（2026-08-06）：保険の報告・開始の確認の成功時。演出のみ＝記録・ゲートには触れない
  const [celebrate, setCelebrate] = useState(null);
  // 打刻の修正申請（第13弾(2)）：自分が承認する側のpendingを直接読む。
  // my_todo_items（RETURNS TABLE・固定型）は触らず、件数はDB側のmy_nav_badges が todo に加算済み
  const [corrections, setCorrections] = useState([]);
  const [punchFacts, setPunchFacts] = useState({}); // application_id → 打刻の事実（申告フラグ・双方の署名時刻）
  const [corrApp, setCorrApp] = useState(null);     // 乖離からの修正申請（シートは共通部品・双方から出せる）
  const [corrDeciding, setCorrDeciding] = useState("");
  // 承認／見送り。片付いたらカードが消える＝やることの件数・ナビのバッジと一致し続ける。
  // 申請者自身は承認できない（RPCが 'self' で拒否し message を返すので、それをそのまま出す）
  const decideCorrection = async (c, approve) => {
    if (corrDeciding) return;
    setCorrDeciding(c.id);
    try {
      const { data, error } = await decideTimeCorrection(c.id, approve);
      if (error) { alert("処理に失敗しました：" + error.message); setCorrDeciding(""); return; }
      if (!data?.ok) { alert(data?.message || ("処理できませんでした：" + (data?.reason || "不明"))); setCorrDeciding(""); return; }
      setCorrections(prev => prev.filter(x => x.id !== c.id));
      window.dispatchEvent(new Event("cb:unreadRefresh"));   // ナビのやることバッジを取り直す
    } catch (e) { alert("処理に失敗しました：" + (e?.message || "不明")); }
    setCorrDeciding("");
  };
  const [memo, setMemo] = useState(() => { try { return localStorage.getItem("cb_todayMemo") || ""; } catch { return ""; } }); // 私的メモ（端末内・本人のみ）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await getSession();
        if (!session) { setLoading(false); return; }
        // 6本とも互いに独立なので1回で同時に投げる（2026-07-27たきと指示「直列を並列に」）。
        // 以前はカレンダー→やること→残り4本の3段階で待っていた
        const [{ data }, { data: td }, { data: wp }, { count: jc }, { data: ep }, { data: emg }, { data: apps }, { data: facts }, { data: corr }] = await Promise.all([
          fetchMyCalendarJobs(),
          fetchMyTodoItems(),
          // 役割の判定に加えて、プロフィールの未入力を数えるための列も一緒に取る（往復は増やさない・2026-08-03）。
          // 列は lib/utils の *_UNSET_COLUMNS が唯一のソース＝数え方と列リストが枝分かれしない
          fetchMyWorkerProfile(session.user.id, WORKER_UNSET_COLUMNS),
          countMyJobs(session.user.id),
          fetchMyEmployerProfile(session.user.id, EMPLOYER_UNSET_COLUMNS),
          // 🆘緊急連絡先の有無（未入力の数え・self-only RLS・2026-08-07）。失敗時はnull＝未登録扱い
          fetchMyEmergencyContact(session.user.id),
          // 採用の判定に要る時刻。採用してもstatusは'approved'のままなので（contractedは表示用の値で
          // DBには書かれない・CLAUDE.md）、両者の確認時刻で見るしかない。get_my_calendar_jobsは
          // この2列を返さないため、自分の応募から直に引く（当事者RLSの内側・2026-07-27）
          fetchMyApplicationTerms(session.user.id),
          // 打刻の事実（第13弾・追補）：申告フラグと双方の署名時刻。両役割ぶんをまとめて取る
          // （RLSで当事者の行だけ返る）。get_my_calendar_jobs/my_todo_items は返さない列なので直に読む
          fetchMyPunchFacts(session.user.id),
          // 自分が承認する側の打刻修正（申請者自身には出さない＝RPC側でも拒否される）
          fetchPendingCorrections(session.user.id),
        ]);
        if (cancelled) return;
        const rows = data || [];
        setEntries(rows); setCache("today:entries", rows);
        setTodos(td || []);
        const w = !!wp || rows.some(e => e.my_role === "worker");
        const f = (jc || 0) > 0 || !!ep || rows.some(e => e.my_role === "farmer");
        setHasWorker(w); setHasFarmer(f);
        setCache("today:roles", { w, f });
        // プロフィールの未入力数（2026-08-03たきと指示）。埋まれば0＝ボックスが消え、
        // 後で空にすればまた1以上になって現れる＝状態を持たず毎回いまの行から数える
        // 緊急連絡先（別テーブル）は働き手側の応募条件でもあるので両役割に渡す（2026-08-17）
        const unset = { w: workerUnsetCount(wp, { hasEmergency: !!emg }).total, f: employerUnsetCount(ep, { hasEmergency: !!emg }).total };
        setProfileUnset(unset); setCache("today:unset", unset);
        const hired = (apps || [])
          .filter(a => a.terms_confirmed_worker_at && a.terms_confirmed_farmer_at
                    && !["rejected","expired","completed"].includes(a.status))
          .map(a => a.id);
        setHiredIds(new Set(hired)); setCache("today:hired", hired);
        setCorrections(corr || []);
        setPunchFacts(Object.fromEntries((facts || []).map(f => [f.id, f])));
        // 既定ロールが持っていない側なら、持っている側へ寄せる
        setRole(r => (r === "worker" && !w && f) ? "farmer" : (r === "farmer" && !f && w) ? "worker" : r);
      } catch {}
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // refreshTick＝応募の変化(Realtime)と画面の復帰の合図（2026-08-18 Speed-1B）。
    // 中身は合図に含まれない＝ここで同じ窓口から取り直す。loadingは立て直さないので骨は出ない
  }, [refreshTick]);

  const todayYmd = ymdLocal(new Date());
  const in7Ymd = ymdLocal(calAddDays(7));
  const mine = entries.filter(e => e.my_role === role && e.relation === "application");
  // 当日判定（2026-07-24 追記3／2026-08-11に entryWorkDays へ一本化）：
  // 確定した働く日（agreed_dates）＞働き手が申請した労働希望日（available_dates）＞求人の期間、の順で見る。
  // カレンダー（MyCalendar）の塗り・名前チップと同じ関数＝「今日」と「カレンダー」で予定が食い違わない
  const isTodayJob = (e) => entryWorkDays(e).has(todayYmd);
  const todayJobs = mine
    .filter(isTodayJob)
    .sort((a, b) => (a.work_time || "").localeCompare(b.work_time || ""));
  // きょうの仕事の分解（2026-07-25たきと指示・同日改定）：1箱でなく役割ごとの箱に分ける。
  // 確認カード（現場情報）／緊急連絡（当日の遅刻・欠勤・中止）／きょうのチャット（相手との連絡）
  const tCard = todayJobs.map(e => ({ ...e, stage: "t_card" }));
  // 採用済み（契約〜作業中）の仕事は、作業日でなくても緊急連絡・開始の入口を開ける（2026-07-27たきと指示）。
  // 遅刻・欠勤・中止の連絡は前日にもしたいし、開始ページは採用が決まった時点で見たいため
  // 採用済み＝両者の確認が揃った応募（status='approved'のまま採用になる。帯のappPhaseKeyと同じ判定）。
  // statusだけで見ると採用済みが拾えず、緊急連絡・開始の箱が薄いままだった（2026-07-27たきと報告）
  const hiredMine = mine.filter(e => e.application_id
    && (hiredIds.has(e.application_id) || ["contracted","working"].includes(e.application_status)));
  // 作業が開始された仕事（開始打刻でstatusがworkingになる）＝終了の箱も開ける（2026-07-27たきと指示）
  const startedMine = mine.filter(e => e.application_id && e.application_status === "working");
  const tEmergency = (() => {
    const seen = new Set(); const out = [];
    [...todayJobs.filter(e => e.application_id), ...hiredMine].forEach(e => {
      if (seen.has(e.application_id)) return;
      seen.add(e.application_id);
      out.push({ ...e, stage: "t_emergency" });
    });
    return out;
  })();
  const todayStageItems = (st) => st === "t_card" ? tCard : st === "t_emergency" ? tEmergency : null; // t_chatは削除（2026-07-25）
  const upcoming = mine
    .filter(e => e.date_start && e.date_start > todayYmd && e.date_start <= in7Ymd)
    .sort((a, b) => (a.date_start || "").localeCompare(b.date_start || "") || (a.work_time || "").localeCompare(b.work_time || ""));
  const dual = hasWorker && hasFarmer;
  // 用件ごとの専用ページ（2026-07-25たきと指示）：#/calendar/todo/{stage}。ボックスタップで遷移・←で今日へ戻る。
  // ★宣言位置：下のスワイプeffectが[pageStage]依存を持つため、effectより前に置く（no-use-before-define対策・2026-08-02）
  const readTodoStage = () => { const mt = window.location.hash.replace(/^#\/?/, "").match(/^calendar\/todo\/([a-z_]+)$/); return mt ? mt[1] : null; };
  const [pageStage, setPageStage] = useState(readTodoStage());
  useEffect(() => {
    const on = () => setPageStage(readTodoStage());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // 横スワイプで働き手⇄農家（雇い手）を切替（両役持ちのみ・2026-07-25）。
  // なめらか化（同日改修）：①追従はsetStateせずDOMのtransformを直接書く（毎フレーム再レンダーを排除）
  // ②ジェスチャ開始8pxで縦/横を1回だけ判定する方向ロック（縦と誤認識しない）
  // ③容器にtouch-action:pan-y＋横ロック中はpreventDefault（縦スクロールとの奪い合いを断つ。ReactのonTouchMoveは
  //   passiveでpreventDefault不可のため、ネイティブリスナーを{passive:false}で張る）
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const gestureRef = useRef(null); // { x, y, lock:'h'|'v'|null }
  const roleRef = useRef(role); roleRef.current = role;
  const dualRef = useRef(dual); dualRef.current = dual;
  const [slideDir, setSlideDir] = useState(0); // 切替後のスライドイン方向（1=右から・-1=左から）
  const [slideKey, setSlideKey] = useState(0); // key更新でアニメを再生
  const switchRole = (target) => {
    if (target === roleRef.current) return;
    setSlideDir(target === "farmer" ? 1 : -1); // タブ並び：左=働き手・右=農家
    setSlideKey(k => k + 1);
    setRole(target);
  };
  const switchRoleRef = useRef(switchRole); switchRoleRef.current = switchRole;
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const onStart = (ev) => {
      // オーバーレイ（下からのシート・モーダル＝.cb-lock-scroll）内で始まったタッチは奪わない
      // （緊急連絡ページのボックス展開中に背後の役割が切り替わる事故の防止・2026-08-02）
      if (ev.target && ev.target.closest && ev.target.closest(".cb-lock-scroll")) { gestureRef.current = null; return; }
      const t = ev.touches[0]; if (t) gestureRef.current = { x: t.clientX, y: t.clientY, lock: null };
    };
    const onMove = (ev) => {
      const g = gestureRef.current; if (!g || !dualRef.current) return;
      const t = ev.touches[0]; if (!t) return;
      const dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // 8px動くまで判定保留
        g.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";  // 1ジェスチャ1回だけ軸を確定
      }
      if (g.lock !== "h") return; // 縦確定＝以後ノータッチ（ブラウザのスクロールに完全に譲る）
      ev.preventDefault();
      const c = contentRef.current; if (!c) return;
      const target = dx < 0 ? "farmer" : "worker";
      const damp = target === roleRef.current ? 0.12 : 0.4; // 行き先が無い方向は強い抵抗（端の感触）
      c.style.transition = "none";
      c.style.transform = `translateX(${Math.max(-100, Math.min(100, dx * damp))}px)`;
    };
    const onEnd = (ev) => {
      const g = gestureRef.current; gestureRef.current = null;
      if (!g || g.lock !== "h") return;
      const c = contentRef.current;
      const t = ev.changedTouches && ev.changedTouches[0];
      const dx = t ? t.clientX - g.x : 0;
      const target = dx < 0 ? "farmer" : "worker";
      if (Math.abs(dx) >= 50 && target !== roleRef.current) {
        if (c) { c.style.transition = ""; c.style.transform = ""; }
        switchRoleRef.current(target); // key更新で新コンテンツがスライドイン
        return;
      }
      if (c) { c.style.transition = "transform .2s ease"; c.style.transform = ""; } // スナップバック
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
    // pageStage依存（2026-08-02）：本体⇄専用ページでrootの実DOMが差し替わるため、
    // 遷移のたびに現在のroot（本体 or 緊急連絡ページ）へリスナーを張り直す
  }, [pageStage]);
  const accent = role === "worker" ? ROLE_ORANGE : ROLE_GREEN;
  // 役割タブ（両役を持つ人だけ・タップでも切替可）：今日ページ本体と緊急連絡の専用ページで共用（2026-08-02）。
  // 構造は求人タブ（作成中⇄公開中）と同型＝横幅いっぱい均等・白地・選択中は太枠＋太字。枠色のみ役割カラー
  const roleTabsRow = dual ? (
    <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
      {[{ k:"worker", l:"働き手", c:ROLE_ORANGE }, { k:"farmer", l:"農家", c:ROLE_GREEN }].map(t => (
        <button key={t.k} onClick={()=>switchRole(t.k)} className="f-sans" style={{
          flex:1, padding:"11px 0", borderRadius:12, cursor:"pointer", background:"#fff",
          border: role === t.k ? "2px solid " + t.c : "1px solid #EBEBEB",
          fontSize:14, fontWeight: role === t.k ? 800 : 600,
          color: role === t.k ? t.c : "#999",
        }}>{t.l}</button>
      ))}
    </div>
  ) : null;

  // TodayCardコンポーネントは削除（2026-07-25統合）：役割はstage="today"の行（チャット主ボタン・⚠️緊急連絡・求人チップ）へ

  // ── やること（採配台）：状態カード。①②⑧=遷移／③〜⑦=直接実行（保険・開始確認はインライン、日程決定・完了/評価は既存モーダルへ橋渡し） ──
  const removeTodo = (id, st) => setTodos(prev => prev.filter(t => !(t.application_id === id && t.stage === st)));
  const TODO_META = {
    // プロフィールの未入力（2026-08-03たきと指示）：未入力がある間だけ、やることの先頭に現れる。
    // 埋まれば消える／後で空にすればまた現れる（状態を持たず、毎回いまのプロフィール行から数える）。
    // 行き先は編集ページ＝専用ページを挟まない（用件の一覧ではなく自分の入力そのものが行き先ので・boxNav）。
    // バッジ＝未入力の項目数＝プロフィール入口の名刺バッジと同じ数（数え方はlib/utilsが唯一のソース）
    profile:     { icon:"👤", title:"プロフィールの未入力", btn:"入力する →",
                   desc:"農家はあなたのプロフィールを見て、応募を承認するか決めます。埋まっているほど選ばれやすくなります。",
                   // 合図（cb_fillProfile）＝着地した編集ページが最初の未入力ボックスをその場で開く。
                   // 以後は保存のたびに次の未入力へ進む（編集ページ側の既存の連鎖・2026-07-16）
                   boxNav: () => {
                     try { sessionStorage.setItem("cb_fillProfile", "1"); } catch {}
                     return role === "farmer" ? "/profile/employer/profile" : "/profile/worker/profile";
                   } },
    // カレンダー（2026-07-27たきと指示：確認カードをカレンダーに差し替え・統合）：
    // 応募（予定）が1件でもあれば件数0でも常にタップ可＝月カレンダーへ直行。バッジ＝きょうが作業日の仕事の数。
    // 現場情報の確認はカレンダーの日タップ→求人ページで担う（確認カードの役割を吸収）
    // 遷移先は「その役割のカレンダーが載っている面」＝農家は応募者ページ／働き手はステータスページ。
    // どちらも上部にカレンダーを展開して着地する（合図＝cb_openCalendar・2026-07-27たきと指示）。
    // 月カレンダー単独のページ(#/calendar/month)は廃止した
    t_card:      { icon:"📅", title:"カレンダー",           btn:"カレンダー →",     always:true,
                   desc:"応募した仕事・自分の求人の予定を、月のカレンダーで見られます。予定が入ると、日をタップしてその日の仕事を確認できます。",
                   nav: () => {
      try { sessionStorage.setItem("cb_openCalendar", "1"); } catch {}
      return role === "farmer" ? "/profile/employer/applicants" : "/saved";
    } },
    t_emergency: { icon:"⚠️", title:"緊急連絡",             btn:"緊急連絡 →",       nav: e => "/emergency/" + e.application_id,
                   desc:"遅刻・欠勤・中止など、作業当日の急な連絡をする窓口です。採用が決まった仕事から使えます。" },
    // t_chat（きょうのチャット）・chat（未読メッセージ）は削除（2026-07-25たきと指示・両役割）：
    // 未読の案内は下部ナビ「チャット」タブのバッジ＋プッシュ通知＋トーストが担い、今日は自分のアクションだけに絞る
    revision:    { icon:"📝", title:"求人に修正のお願い",   btn:"修正する →",       nav: e => "/work/edit/" + e.job_number,
                   desc:"運営から求人内容の修正のお願いが届いたとき、ここから直して再申請します。" },
    // 求人への質問（2026-07-27たきと指示）：公開Q&A（job_questions）の未回答＝求人カードの❓Nと同じ母集団。
    // 1行=1質問（質問者のアイコン・名前＋その求人のチップ）。行き先は求人詳細の「質問」タブ
    question:    { icon:"💬", title:"求人への質問",         btn:"回答する →",
                   desc:"あなたの求人に届いた質問に回答します。回答は求人ページに公開されます。", nav: e => {
      // 出どころ＝カレンダー（今日）：求人詳細の浮遊「←戻る」ボックスを出さない目印（2026-07-27たきと指示）
      try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {}
      return "/work/job/" + e.job_number + "/questions"; // タブ指定つきURL（リロードしても質問タブのまま）
    } },
    // 新着の応募（2026-07-26たきと指示・同日改定）：タップでお祝いパネル（NewApplicantsPanel）を展開。
    // 行タップで応募者ページへ「応募中」フィルタ着地＝どの求人に誰が応募したかを応募者ページの求人カード設計で見せる
    // 行き先は新着の応募ページ（#/new-applicants・2026-08-05たきと指示で新設）に変更。
    // 応募を受けた雇い手のための専用ページ＝サイトを開いた時の着地先と同じ面に揃える
    // （そこから応募者シート＝承認・見送りの唯一の窓口へ送られる）
    approve:     { icon:"📨", title:"新着の応募",           btn:"確認して承認 →",
                   desc:"あなたの求人に新しく届いた応募を確認します。承認すると面接に進めます。",
                   nav: () => "/new-applicants" },
    // decide_dates（働く日を決める）は廃止（2026-07-24たきと確定）：日程宣言なしもいつでもOKも全期間working前提。
    // 日程変更が必要な時だけ応募者ページの働く日モーダル（set_agreed_dates・cb_agreeAppId着地は温存）で行う
    // interview/hire（2026-07-25たきと指示）：チャットの質問集シート・採用ボタンを今日のリストへ移設。
    // チャットは「アクションの報告（自動送信）＋直接やりとりが必要な時だけ」の最小役割に寄せていく
    interview:   { icon:"❓", title:"面接の質問を送る",     btn:"質問を送る →",     qset:true,
                   desc:"承認した応募者に面接の質問を送ります。質問と回答はチャットに証跡として残ります。" },
    // 採用する（2026-07-27たきと指示）：その場実行をやめ、応募者ページの「面接中」タブへ直行。
    // 採用の実行は応募者シートの🤝採用するボタン（二重予約警告つき）が担う
    // 2026-08-06：専用ページを応募者単位のカードに刷新（HireStagePanel）。行き先も一覧でなく
    // 「その応募のシート」へ＝どの応募者を採用するのかを取り違えない（cb_openApplicantId・新着の応募ページと同じ作法）
    hire:        { icon:"🤝", title:"採用する",             btn:"採用する →",
                   desc:"面接を終えた応募者を採用します。実行は応募者ページの🤝採用するボタン（二重予約の警告つき）です。",
                   nav: (e) => { markHireSheet(e?.application_id); return HIRE_SHEET_PATH; } },
    insurance:   { icon:"🛡", title:"保険の準備の報告",     btn:"準備したと報告",   rpc:"confirm_insurance",
                   desc:"作業前に、保険の準備ができたことを報告します。報告した時刻が記録に残ります。" },
    // 開始を確認／来なかった の2択（2026-07-30たきと指摘「働き手がこなかった場合の措置がない」）。
    // 来なかった時に「開始を確認」しか道が無いのは、事実と違う記録を迫ることになる。altは
    // 応募者ページの完了モーダル（働き手は来ましたか？→来なかった＝欠勤記録・72時間の異議申立つき）へ直行する
    confirm_start:{ icon:"✓", title:"作業の開始を確認",     btn:"開始を確認",       rpc:"confirm_start",
                   desc:"働き手が現場に来て作業が始まったことを確認します。来なかった場合の記録もここからできます。",
                   alt: { label:"来なかった", flag:"cb_completeAppId", to:"/profile/employer/applicants",
                          // 旧「active（進行中）」はステータス絞り込み統一（2026-08-07）で廃止。該当応募は
                          // 採用/作業中のどちらもありうるので「すべて」で開く（対象シートはcb_completeAppIdが自動展開）
                          before: () => { try { sessionStorage.setItem("cb_appFilter", "all"); } catch {} } } },
    // review（評価する）はcompleteへ統合（2026-07-25たきと指示）：完了記録がまだ／評価だけ残り（3日以内）の
    // 両方をmy_todo_itemsが'complete'として返す。行き先は同じ完了モーダル（完了記録→評価の一連）
    // 完了して評価する（2026-07-27たきと指示）：ボックスタップで応募者ページの「完了」タブへ直行。
    // 行タップ（専用ページ経由）でも同じ着地。cb_completeAppId は評価モーダルの自動展開用に併せて渡す
    complete:    { icon:"✅", title:"完了して評価する",     btn:"完了・評価 →",     flag:"cb_completeAppId", to:"/profile/employer/applicants",
                   desc:"作業の完了を記録して、働き手を評価します。完了の記録から3日以内は評価だけ後からもできます。",
                   before: () => { try { sessionStorage.setItem("cb_appFilter", "completed"); } catch {} } },
    // w_waiting（返事待ち）は廃止（2026-07-25たきと指示）：やることリストは当人のアクションが前提。
    // 返事待ちは相方（農家）のアクション待ち＝思想が違う。応募状況の確認は応募状況ページが担う
    // w_confirm（求人内容の確認）は廃止（2026-07-25たきと指示）：内容を確認した上で応募するのが前提。
    // 応募INSERT時にterms_confirmed_worker_atをDBトリガーが自動記録。日程の申請（チャットの候補日）は残す
    // 求職の修正（2026-07-27たきと指示・枠のみ先行）：農家側 revision の働き手版。
    // 求職カード（求職一覧＝Phase2b）の実装後に、運営からの修正依頼をmy_todo_itemsが返す想定。
    // 中身（遷移先・実行内容）は未定ので nav/rpc は持たせない＝現状は常に「該当なし」の薄い箱として並ぶ
    w_revision:  { icon:"📝", title:"求職に修正のお願い", btn:"修正する →",
                   desc:"運営から求職内容の修正のお願いが届いたとき、ここから直します。" },
    w_interview: { icon:"✍️", title:"面接の回答",           btn:"返事する",
                   desc:"農家から届いた面接の質問に、その場で返事します。返信はチャットにも残ります。" }, // 農家の【面接の質問】にここで返事（専用パネル・返信はチャットにも残る）
    // w_start（作業を開始する）は廃止（2026-07-27たきと指示）：開始時刻が来たらDB側のcron
    // auto_start_work() が自動で開始を記録するため、働き手に押させる箱を置かない
    // 採用済みなら終了の箱も開ける（2026-07-27たきと指示）。行き先は件数に依らず同じので直行(direct)
    w_review:    { icon:"⭐", title:"終了を確認して評価",   btn:"評価ページへ →",   nav: () => "/profile/worker/approved",
                   desc:"仕事の終了を確認して、農家を評価します。評価は承認済みの応募一覧から行います。" },
  };
  // アクションボックス（2026-07-25・プロフィール入口カードと同型）：用件（stage）ごとに絵文字ボックスを横2列配置。
  // 右上=放置数バッジ。タップで下に対象一覧（働き手アイコン＋ニックネーム＋求人チップ＋実行ボタン）が展開。
  // A案（2026-07-24たきと確定）：農家タブ＝働き手を出す／働き手タブ＝相手（農家）名は出さない（求人チップで識別）
  const todoKey = (t) => t.application_id || ("j" + t.job_number);
  // 面接の回答を送信してリストが空になった時は「送信完了しました。」を出す（2026-07-26たきと指示。ページを離れたらリセット）
  const [answeredDone, setAnsweredDone] = useState(false);
  useEffect(() => { setAnsweredDone(false); }, [pageStage]);
  const TODO_BOX_LABEL = { insurance: "保険の報告", interview: "面接する", revision: "求人の修正", w_revision: "求職の修正", question: "質問に答える" }; // ボックス用の短縮ラベル（未定義はm.titleのまま。hireはタイトル「採用する」をそのまま表示）
  // 役割ごとの全用件カタログ（ボックスは常時表示。該当ありは上位・該当なしは薄く下位に並ぶ。並びは正規フロー順）
  const TODO_STAGE_CATALOG = {
    farmer: ["t_card", "t_emergency", "revision", "question", "approve", "interview", "hire", "insurance", "confirm_start", "complete"],
    worker: ["t_card", "t_emergency", "w_revision", "w_interview", "w_review"],
  };
  // 専用ページを開いたら役割をその用件側へ合わせる（accent・パネルの表示条件が追従）
  useEffect(() => {
    if (!pageStage) return;
    if (pageStage.startsWith("t_")) return; // きょうの仕事系は両役共通＝現在の役割のまま
    const pr = TODO_STAGE_CATALOG.worker.includes(pageStage) ? "worker" : "farmer";
    if (role !== pr) setRole(pr);
  }, [pageStage, role]);
  // hireDoubleBookingCheck・m.hire分岐は削除（2026-07-27）：採用の実行は応募者シートへ移設（二重予約警告もそちらが持つ）
  const runTodo = async (m, e) => {
    const busyKey = (e.application_id || e.job_number) + e.stage;
    if (m.nav) { window.location.hash = m.nav(e); return; }
    if (m.flag) { if (m.before) m.before(); try { sessionStorage.setItem(m.flag, e.application_id); } catch {} window.location.hash = m.to; return; }
    // 面接の質問（チャットからの移設）：チャットに着地して質問集シートを自動で開く（回答は面接の証跡としてチャットに残る）
    if (m.qset) { try { sessionStorage.setItem("cb_openQSet", "1"); } catch {} window.location.hash = "/chat/" + e.application_id; return; }
    if (m.rpc) {
      if (confirming) return; setConfirming(busyKey);
      const { data, error } = await runTodoRpc(m.rpc, e.application_id);
      setConfirming("");
      if (error || !data?.ok) { fbError(); alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); return; }
      removeTodo(e.application_id, e.stage);
      fbSuccess();
      if (m.rpc === "confirm_insurance") setCelebrate({ emoji:"🛡", title:"報告しました" });
      else if (m.rpc === "confirm_start") setCelebrate({ emoji:"🌅", title:"作業が始まりました" });
    }
  };
  // count＝バッジの数の上書き（一覧を持たない箱＝プロフィールの未入力数。省略時は対象件数）
  const TodoStageBox = ({ stage, items, count }) => {
    const m = TODO_META[stage]; if (!m) return null;
    const n = count ?? items.length;
    // 各ボックス＝専用ページ(#/calendar/todo/{stage})へのリンクに統一（2026-08-02たきと指示
    // 「各ボックスの遷移先を新設。リンクも新設」）。1件直行・direct直行は廃止＝
    // 実行・個別遷移は専用ページの行が担う。カレンダー（always）だけはカレンダー面へ直行（専用ページを挟まない）。
    // ★タップ不能は全廃（2026-08-03たきと指示）：どのボックスも常に開ける。
    //   薄表示は「いま用事が無い」の目印としてのみ残す（押せなさの表現ではない）
    // ★なにもなければ説明文を明記（2026-08-03たきと指示）：行き先が空っぽの面だと
    //   「なぜ何も無いのか」が分からないため、カレンダーも予定がゼロの時は専用ページ
    //   （用件の説明＋空状態）へ送る。予定があるときだけカレンダー面へ直行する
    const calendarReady = entries.some(e => e.my_role === role) || mine.length > 0;
    const dim = n === 0;
    const onTapBox = () => {
      if (m.boxNav) { window.location.hash = m.boxNav(); return; }   // 専用ページを挟まず直接その面へ（プロフィールの未入力）
      if (m.always && calendarReady) { window.location.hash = m.nav(); return; }
      window.location.hash = "/calendar/todo/" + stage;
    };
    return (
      <button onClick={onTapBox} className="f-sans" style={{
        position:"relative", background:"#fff", border:"1px solid #EBEBEB", borderRadius:18,
        padding:"24px 10px 18px", textAlign:"center", cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.04)",
        opacity: dim ? 0.45 : 1,
      }}>
        {n > 0 && <span aria-label={"残り" + n + "件"} style={{ position:"absolute", top:10, right:10, minWidth:24, height:24, borderRadius:12, background:"#00A86B", color:"#fff", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 7px" }}>{n}</span>}
        <span style={{ display:"block", fontSize:40, lineHeight:1, marginBottom:10 }}>{m.icon}</span>
        <span style={{ display:"block", fontSize:14, fontWeight:800, color:"#222" }}>{TODO_BOX_LABEL[stage] || m.title}</span>
      </button>
    );
  };
  // 展開パネル：タップしたボックスの対象一覧（1行=誰・どの求人・実行ボタン）
  // ボックス内タイトル・左端の役割色バーは廃止（2026-07-26たきと指示：見出しはページヘッダーが担う・属性分け不要）
  const TodoStagePanel = ({ stage, items }) => {
    const m = TODO_META[stage]; if (!m) return null;
    return (
      <div style={{ gridColumn:"1 / -1", border:"1px solid #EBEBEB", borderRadius:12, background:"#fff", padding:"12px 14px" }}>
        <div style={{ display:"grid", gap:8 }}>
          {items.map(t => {
            const busy = confirming === (t.application_id || t.job_number) + t.stage;
            const jobChip = [t.job_number ? "#" + t.job_number : "", [t.crop, t.task].filter(Boolean).join(" "), (stage.startsWith("t_") && t.work_time) ? "🕒" + t.work_time : ""].filter(Boolean).join(" ");
            // 打刻の事実（第13弾・追補）：申告フラグと双方の署名時刻の開き。隠さず、この行の下に添える
            const pf = punchFacts[t.application_id];
            return (
              <div key={todoKey(t)} style={{ display:"grid", gap:6, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                {role === "farmer" && t.partner_name ? (
                  /* ニックネームはアイコンの下（2026-07-26たきと指示） */
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, flexShrink:0, maxWidth:64 }}>
                    <Avatar url={t.partner_avatar} name={t.partner_name} size={36} bg={ROLE_ORANGE} />
                    <span className="f-sans" style={{ fontSize:10, fontWeight:700, color:"#222", maxWidth:64, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.partner_name}さん</span>
                  </div>
                ) : null}
                {/* 求人チップはタップで求人ページへ（確認前に内容を見られる） */}
                {jobChip && <button onClick={()=>{ if (!t.job_number) return; try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + t.job_number; }} className="f-sans" style={{ flexShrink:1, minWidth:0, fontSize:11, fontWeight:600, color:"#717171", background:"#F7F7F7", border:"none", borderRadius:8, padding:"4px 8px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }}>{jobChip}</button>}
                <span style={{ flex:1 }} />
                {/* 副の選択肢（今のところ「来なかった」だけ）。主の隣に控えめに置く */}
                {m.alt && (
                  <button onClick={()=>runTodo(m.alt, t)} disabled={busy} className="f-sans" style={{ flexShrink:0, padding:"8px 10px", fontSize:12, fontWeight:700, background:"#fff", color:"#E24B4A", border:"1px solid #E24B4A", borderRadius:9, cursor:"pointer", whiteSpace:"nowrap" }}>{m.alt.label}</button>
                )}
                <button onClick={()=>runTodo(m, t)} disabled={busy} className="f-sans" style={{ flexShrink:0, padding:"8px 12px", fontSize:12, fontWeight:700, background:accent, color:"#fff", border:"none", borderRadius:9, cursor:"pointer", whiteSpace:"nowrap", opacity: busy ? 0.6 : 1 }}>{busy ? "..." : m.btn}</button>
              </div>
              {/* 契約成立後のみ相手の本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)） */}
              {t.application_id && <ContractPartyName applicationId={t.application_id} showPending={false} style={{ margin:0, paddingLeft:2 }} />}
              {pf && (pf.started_declared || pf.ended_declared) && (
                <span><DeclaredBadge show label={(pf.started_declared ? "開始" : "終了") + "は圏外で申告された時刻"} /></span>
              )}
              {/* 導線は双方に出す（2026-07-30たきと訂正）。文言だけ立場で変える */}
              {pf && <PunchGapNotice app={pf} onRequestCorrection={()=>setCorrApp(pf)}
                correctionLabel={role === "worker" ? "🕐 自分の打刻を直す → 修正を申請" : "🕐 実際と違う場合は → 修正を申請"} />}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const UpcomingRow = ({ e }) => {
    const label = e.date_end && e.date_end !== e.date_start ? `${calFmtDate(e.date_start)}〜${calFmtDate(e.date_end)}` : calFmtDate(e.date_start);
    return (
      <button onClick={()=>{ try { sessionStorage.setItem("cb_jobBackTo", "/calendar"); } catch {} window.location.hash = "/work/job/" + e.job_number; }}
        className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, width:"100%", textAlign:"left", background:"#fff", border:"1px solid #F0F0F0", borderLeft:"3px solid " + accent, borderRadius:10, padding:"11px 12px", cursor:"pointer" }}>
        <span style={{ minWidth:0, overflow:"hidden" }}>
          <span style={{ display:"block", fontSize:13, fontWeight:600, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{[e.crop, e.task].filter(Boolean).join(" ") || "求人"} <span style={{ color:"#999", fontWeight:700, fontSize:11 }}>#{e.job_number}</span></span>
          <span style={{ display:"block", fontSize:11, color:"#999", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>📅 {label}{e.work_time ? "　" + e.work_time : ""}{role === "farmer" && e.partner_name ? "　" + e.partner_name : ""}</span>
        </span>
        <span style={{ color:"#C8C8C8", fontSize:16, flexShrink:0 }}>›</span>
      </button>
    );
  };

  // ── 用件の専用ページ（#/calendar/todo/{stage}）：ボックスタップの行き先。←で今日へ戻る ──
  if (pageStage && TODO_META[pageStage]) {
    const pm = TODO_META[pageStage];
    const pItems = todayStageItems(pageStage) || todos.filter(t => t.stage === pageStage);
    // 緊急連絡は農家と働き手でページを分ける（2026-08-02たきと指示）：役割タブ＋横スワイプ（指連動）で切替。
    // スワイプ機構は今日ページ本体と同一（rootRefのネイティブリスナー＋contentRefへのtransform直書き＝
    // 指に追従・50px以上で切替成立・slideKey更新でスライドイン・両役持ちのみ）。他の用件ページは従来どおり単ページ
    const swipeStage = pageStage === "t_emergency";
    return (
      <div ref={swipeStage ? rootRef : undefined}
        style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px", ...(swipeStage ? { overflowX:"hidden", touchAction:"pan-y" } : {}) }}>
        {celebrate && <Celebration {...celebrate} onDone={()=>setCelebrate(null)} />}
        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 0 16px" }}>
          <button onClick={()=>{ window.location.hash = "/calendar"; }} aria-label="今日へ戻る" className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:20, cursor:"pointer", padding:"4px 6px", lineHeight:1 }}>←</button>
          <h2 className="f-sans" style={{ display:"flex", alignItems:"center", gap:8, fontSize:18, fontWeight:800, color:"#222", margin:0, flex:1, minWidth:0 }}>
            <span style={{ fontSize:20 }}>{pm.icon}</span>{TODO_BOX_LABEL[pageStage] || pm.title}
          </h2>
          {/* 件数バッジは廃止（2026-07-26たきと指示：ページ内で通知は不要。件数は今日ページのボックスが示す） */}
        </div>
        {/* 農家⇄働き手の切替タブ（緊急連絡のみ・両役持ちのみ表示。スワイプと同じswitchRoleを共有） */}
        {swipeStage && roleTabsRow}
        {/* 用件の説明（2026-08-02新設）：全ボックスが専用ページへのリンクになったため、
            該当0件で開いても「何のページか」が分かるように各用件の一言説明を置く。
            ★空のときは下の空状態ボックス内に本文として大きく出す（2026-08-03たきと指示
            「なにもなければ説明文を明記」）ので、ここでは出さない＝二重に出さない */}
        {pm.desc && pItems.length > 0 && <p className="f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.7, margin:"-6px 0 16px", paddingLeft:38 }}>{pm.desc}</p>}
        <div key={swipeStage ? slideKey : "static"} ref={swipeStage ? contentRef : undefined}
          style={swipeStage && slideDir ? { animation: `${slideDir > 0 ? "cbSlideInR" : "cbSlideInL"} .28s ease` } : undefined}>
        {loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>
        ) : pItems.length === 0 ? (
          /* 空状態：説明文を明記する（2026-08-03たきと指示）。「いまありません」だけだと
             なぜ空なのか・いつここに何が来るのかが分からないため、用件の説明を本文として大きく出す */
          <div style={{ background:"#F7F7F7", borderRadius:14, padding:"28px 20px", textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>{pm.icon}</div>
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 8px" }}>{answeredDone ? "送信完了しました。" : "この用事はいまありません"}</p>
            {pm.desc && <p className="f-sans" style={{ fontSize:13, color:"#555", lineHeight:1.8, margin:"0 auto", maxWidth:420, textAlign:"left" }}>{pm.desc}</p>}
          </div>
        ) : pageStage === "approve" ? (
          <NewApplicantsPanel items={pItems} onTap={(t)=>runTodo(TODO_META.approve, t)} />
        ) : pageStage === "hire" ? (
          /* 採用するページは応募者ページと同じカード構造・ただし応募者単位（2026-08-06たきと指示）。
             🤝→最終確認→OKでその場で採用（ページ遷移しない）。片付いた応募はやることからも消す */
          <HireStagePanel items={pItems} meId={me?.id} onHired={(id)=>removeTodo(id, "hire")} />
        ) : pageStage === "t_emergency" ? (
          /* 緊急連絡はステータスページと同じカード構造（2026-08-02たきと指示） */
          <EmergencyStagePanel items={pItems} role={role} />
        ) : pageStage === "w_interview" ? (
          <InterviewReplyPanel items={pItems} accent={accent} onAnswered={(id)=>{ removeTodo(id, "w_interview"); setAnsweredDone(true); }} />
        ) : (
          <TodoStagePanel stage={pageStage} items={pItems} />
        )}
        </div>
        {corrApp && <TimeCorrectionSheet key={corrApp.id} app={corrApp} onClose={()=>setCorrApp(null)} />}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ maxWidth:600, margin:"0 auto", padding:"8px 0 24px", overflowX:"hidden", touchAction:"pan-y" }}>
      {celebrate && <Celebration {...celebrate} onDone={()=>setCelebrate(null)} />}
      {/* 見出し「📆 今日」は削除（2026-07-26たきと指示）。現在地は下部ナビの点灯が示すため冗長 */}
      {/* 役割タブ（両役を持つ人だけ・このページの表示だけ切替）。単役は非表示（roleTabsRow＝共通化・2026-08-02） */}
      {roleTabsRow}
      {/* 役割コンテンツ：ドラッグ追従はcontentRefへのtransform直書き（再レンダーなし）。切替成立時はkey更新でスライドイン再生 */}
      <div key={slideKey} ref={contentRef} style={{
        animation: slideDir ? `${slideDir > 0 ? "cbSlideInR" : "cbSlideInL"} .28s ease` : undefined,
      }}>
      {/* 読み込み中は仮配置（2026-07-27たきと指示）。このページは往復が多い
          （セッション→カレンダー→やること→プロフィール類）ので待ちが最も長い */}
      {loading ? (
        <AutoSkeleton shapeKey={"today:" + role} />
      ) : (<>
        {/* 【やること】採配台：状態カードを締切の近い順に。①②⑧=遷移／③〜⑦=直接実行。件数=今日タブのバッジ(todo)と一致 */}
        {(() => {
          // 最新順（sort_keyの新しい順・同日なら求人番号の新しい順）
          const myTodos = todos.filter(t => t.my_role === role && t.stage !== "w_start").sort((a, b) => (b.sort_key || "").localeCompare(a.sort_key || "") || (b.job_number || 0) - (a.job_number || 0));
          // 用件（stage）ごとに1箱へ集約。該当ありは最新順で上位、該当なしもカタログ順で常時表示（薄表示・タップ不可）
          const activeOrder = []; const byStage = new Map();
          [["t_card", tCard], ["t_emergency", tEmergency]].forEach(([st, arr]) => { if (arr.length) { byStage.set(st, arr); activeOrder.push(st); } }); // きょうの仕事系は常に先頭（t_chatは削除・2026-07-25）
          myTodos.forEach(t => { if (!byStage.has(t.stage)) { byStage.set(t.stage, []); activeOrder.push(t.stage); } byStage.get(t.stage).push(t); });
          // 「終了を確認して評価」は採用済みなら常に開ける（2026-07-27たきと指示）。
          // my_todo_itemsのw_reviewは農家の完了記録の後にしか出ないので、それを待たずに灯す。
          // 開始は自動（auto_start_work）になったため、開始済みがあればそれを優先して件数に出す
          const reviewItems = startedMine.length ? startedMine : hiredMine;
          if (role === "worker" && !byStage.has("w_review") && reviewItems.length) {
            byStage.set("w_review", reviewItems.map(e => ({ ...e, stage: "w_review" })));
            activeOrder.push("w_review");
          }
          const catalog = TODO_STAGE_CATALOG[role] || [];
          const stageOrder = [...activeOrder, ...catalog.filter(st => !byStage.has(st))];
          // いま これだけ（2026-08-06）：正規フロー順（catalog順）で最初に該当がある用件。
          // 昇格した用件は下の格子から抜く（複製でなく移動＝「上に動いた」が一目で分かる。同日たきと指示）
          const nowStage = catalog.filter(st => !st.startsWith("t_")).find(st => (byStage.get(st) || []).length > 0) || null;
          // プロフィールの未入力（2026-08-03たきと指示）：未入力がある間だけ格子の先頭に差し込む。
          // カタログには入れない＝埋まれば箱ごと消える（薄表示で残さない）。読み込み前(null)は出さない。
          // 「いま これだけ」はcatalogから選ぶのでprofileは昇格しない＝格子の先頭に置く（二重表示にならない）
          const unsetN = profileUnset ? (role === "farmer" ? profileUnset.f : profileUnset.w) : 0;
          if (unsetN > 0) stageOrder.unshift("profile");
          return (
            <div style={{ marginBottom:24 }}>
              {/* 件数は打刻修正の承認ぶんも足す＝ナビのバッジ(todo)と一致させる（my_nav_badgesも同じ加算） */}
              <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid " + accent, paddingLeft:8 }}>やること（{myTodos.length + corrections.length}）</p>
              {/* いま これだけ（2026-08-06・赤ちゃん前提の第0歩）：分かれ道10本の手前に「最優先の1本」を
                  大きく1枚だけ出す。正規フロー順（catalog順）で最初に該当がある用件＝次の一歩。
                  タップの行き先は下のボックスと同じ専用ページ＝入口が増えるだけで、実行の窓口は増やさない。
                  10ボックスは従来どおり下に残す（追加可能・削除可能・他を壊さない） */}
              {(() => {
                if (!nowStage) return null;
                const nm = TODO_META[nowStage]; if (!nm) return null;
                const nCount = (byStage.get(nowStage) || []).length;
                return (
                  <button onClick={() => { window.location.hash = "/calendar/todo/" + nowStage; }}
                    className="f-sans cb-now-pulse"
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:16, background:"#fff", border:"3px solid " + accent, borderRadius:20, padding:"20px 18px", marginBottom:12, cursor:"pointer", textAlign:"left" }}>
                    <span style={{ fontSize:44, lineHeight:1, flexShrink:0 }}>{nm.icon}</span>
                    <span style={{ flex:1, minWidth:0 }}>
                      <span className="f-sans" style={{ display:"block", fontSize:12, fontWeight:800, color:accent, letterSpacing:".08em" }}>いま これだけ</span>
                      <span className="f-sans" style={{ display:"block", fontSize:20, fontWeight:800, color:"#222", marginTop:2 }}>{nm.title}</span>
                    </span>
                    <span style={{ flexShrink:0, minWidth:34, height:34, borderRadius:17, background:accent, color:"#fff", fontSize:16, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 8px" }}>{nCount}</span>
                  </button>
                );
              })()}
              {/* 打刻の修正の承認（第13弾(2)）：やることの最上部。相手が申請したものだけが並ぶ
                  （申請者自身には出さない＝RPC側でも拒否される）。片付けると消える＝バッジ数と一致する */}
              {corrections.length > 0 && (
                <div style={{ display:"grid", gap:10, marginBottom:12 }}>
                  {corrections.map(c => {
                    const hm = (ts) => ts ? new Date(ts).toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" }) : null;
                    const parts = [hm(c.proposed_started_at) && ("開始 " + hm(c.proposed_started_at)), hm(c.proposed_ended_at) && ("終了 " + hm(c.proposed_ended_at))].filter(Boolean);
                    return (
                      <div key={c.id} style={{ border:"1px solid #F5A623", background:"#FFF9EE", borderRadius:12, padding:"12px 14px" }}>
                        <p className="f-sans" style={{ fontSize:13, fontWeight:800, color:"#222", margin:"0 0 4px" }}>🕐 打刻の修正の申請が届いています</p>
                        <p className="f-sans" style={{ fontSize:12, color:"#444", margin:"0 0 2px", lineHeight:1.7 }}>
                          {c.applications?.job_number ? ("求人 #" + c.applications.job_number + "　") : ""}{parts.join("／") || "（時刻の指定なし）"}
                        </p>
                        {c.reason && <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 8px", lineHeight:1.7, whiteSpace:"pre-wrap" }}>理由：{c.reason}</p>}
                        <div style={{ display:"flex", gap:8, marginTop:10 }}>
                          <button onClick={()=>decideCorrection(c, true)} disabled={corrDeciding===c.id} className="f-sans"
                            style={{ flex:1, padding:"9px 0", fontSize:13, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", opacity: corrDeciding===c.id ? 0.5 : 1 }}>承認する</button>
                          <button onClick={()=>decideCorrection(c, false)} disabled={corrDeciding===c.id} className="f-sans"
                            style={{ flex:1, padding:"9px 0", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #DDD", borderRadius:8, cursor:"pointer", opacity: corrDeciding===c.id ? 0.5 : 1 }}>見送る</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div ref={skelRef} style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:12 }}>
                {stageOrder.filter(st => st !== nowStage).map(st => <TodoStageBox key={st} stage={st} items={byStage.get(st) || []} count={st === "profile" ? unsetN : undefined} />)}
              </div>
            </div>
          );
        })()}
        {/* きょうの仕事の独立セクションは廃止（2026-07-25たきと指示）：stage="today"としてやることの箱へ統合。
            仕事がない日の「求人をさがす」導線だけ残す */}
        {todayJobs.length === 0 && upcoming.length === 0 && (
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <button onClick={()=>{ window.location.hash = "/search"; }} className="f-sans" style={{ padding:"10px 22px", fontSize:13, fontWeight:700, background:"#fff", border:"1px solid #EBEBEB", borderRadius:12, color:"#00A86B", cursor:"pointer" }}>求人をさがす →</button>
          </div>
        )}
        {upcoming.length > 0 && (
          <div style={{ marginBottom:24 }}>
            <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid #DDD", paddingLeft:8 }}>つぎの予定（7日以内）</p>
            <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:8 }}>
              {upcoming.map(e => <UpcomingRow key={e.application_id || e.job_number} e={e} />)}
            </div>
          </div>
        )}
        {/* 📝メモ（私的・端末内localStorage・本人のみ／DB非保存） */}
        <div style={{ marginBottom:24 }}>
          <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#B0B0B0", letterSpacing:".06em", margin:"0 0 10px", borderLeft:"3px solid #DDD", paddingLeft:8 }}>📝 メモ</p>
          <textarea value={memo} onChange={e=>{ setMemo(e.target.value); try { localStorage.setItem("cb_todayMemo", e.target.value); } catch {} }} placeholder="自分用のメモ（この端末だけに保存されます）" rows={3} className="field f-sans" style={{ width:"100%", fontSize:14, resize:"vertical", boxSizing:"border-box" }} />
        </div>
        {/* 「📅 月の予定を見る」ボタンは削除（2026-07-27たきと指示）：やることのカレンダー箱に統合 */}
      </>)}
      </div>
      {corrApp && <TimeCorrectionSheet key={corrApp.id} app={corrApp} onClose={()=>setCorrApp(null)} />}
    </div>
  );
}
