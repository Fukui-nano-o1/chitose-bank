// チャット（分割・大物②＝最終ピース・2026-07-24）：LINE式スレッド。求人コンテキストカード・確認カード・
// 定型文/質問集/候補日シート・既読・コメント報告・採用/二重予約警告・保険状態まで内蔵する最大の対話部品。
import { useState, useEffect, useRef, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { mapJobPublicRow, payLabel, disp, calFmtDate, daysBetweenYmd, EMPTY_MARK, ROLE_ORANGE,
  CHAT_ELIGIBLE_STATUSES, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, CHAT_TEMPLATES_FARMER, CHAT_TEMPLATES_WORKER, photoThumb,
  payTermsLine, WAGE_CLOSING_RULE_LABELS, PAY_TERMS_UNKNOWN } from "../lib/utils";
import { openEmployerPreview, openWorkerPreview, openPhaseInfo } from "../lib/previewBus";
import { chatCache } from "../lib/chatCache";
import { ensureDefaultQuestionSets } from "../lib/questionSets";
import { Avatar, Dots } from "./ui";
import ContractPartyName from "./ContractPartyName";
export function ChatView({ applicationId, onBack }) {
  const [msgs, setMsgs] = useState([]);
  const [msgsLoading, setMsgsLoading] = useState(true); // 初回・スレッド切替の読み込み中（仮配置の表示に使う）
  const msgScrollRef = useRef(null); // メッセージ欄のスクロール容器（最新へ自動スクロール・LINE式・2026-07-19）
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState(null);
  const [partner, setPartner] = useState(null); // { nickname, avatar_url }
  const [partnerInitials, setPartnerInitials] = useState(""); // ニックネーム未設定時のアイコン用・メール頭文字2文字（2026-07-22）
  const [partnerWorkerId, setPartnerWorkerId] = useState(null); // 相手が働き手ならそのauth_id（アイコンタップでプレビュー・2026-07-19）
  const [partnerFarmerId, setPartnerFarmerId] = useState(null); // 相手が農家ならそのauth_id（アイコンタップで雇い手プレビュー・2026-07-19）
  // はじめる前の確認カード（⑦）
  const [confirmJob, setConfirmJob] = useState(null); // mapJobPublicRowで整形した求人情報
  const [chatJobNumber, setChatJobNumber] = useState(null); // ヘッダー・確認カードの#N表示用（jobs_publicから消えた求人でも出す）
  const [confirmMeetingPlace, setConfirmMeetingPlace] = useState(null);
  const [workerConfirmed, setWorkerConfirmed] = useState(false);
  const [farmerConfirmed, setFarmerConfirmed] = useState(false);
  const [insurancePreparedAt, setInsurancePreparedAt] = useState(null);
  const [isWorkerSide, setIsWorkerSide] = useState(false);
  const [confirmingTerms, setConfirmingTerms] = useState(false);
  const [confirmStep, setConfirmStep] = useState(0); // はじめる前の確認：1項目ずつ「はい」で進む分割式（2026-07-18）
  const [confirmBoxOpen, setConfirmBoxOpen] = useState(false); // 求人内容確認をボックス展開（2026-07-19）
  // 定型文シート（2026-07-22・第8弾）：入力欄横の＋→役割別のテンプレをタップで挿入
  const [tmplOpen, setTmplOpen] = useState(false);
  // ＋シートのタブ（2026-07-23）：定型文 / 質問集（質問集は農家側のみ）。スワイプで切替
  const [tmplTab, setTmplTab] = useState("phrase");
  // 今日のやること「面接の質問を送る」からの着地（2026-07-25）：フラグがあれば質問集シートを自動で開く（農家側のみ）
  const wantQSetRef = useRef(false);
  useEffect(() => { try { if (sessionStorage.getItem("cb_openQSet")) { sessionStorage.removeItem("cb_openQSet"); wantQSetRef.current = true; } } catch {} }, []);
  useEffect(() => {
    if (wantQSetRef.current && myId && !isWorkerSide) { wantQSetRef.current = false; setTmplTab("qset"); setTmplOpen(true); }
  }, [myId, isWorkerSide]);
  const [chatQSets, setChatQSets] = useState(null); // 農家の面接の質問集（null=未読込）
  const [qSending, setQSending] = useState(false);
  const [dateSel, setDateSel] = useState([]); // ＋シート「候補日を送る」で選択中の候補日（農家→働き手・2026-07-24）
  const tmplSwipe = useRef(null); // ＋シートの横スワイプ判定
  // 既読（2026-07-22・第8弾）：相手（counterpart）のchat_reads最終既読時刻。自分の送信でこれ以前のものに「既読」
  const [partnerReadAt, setPartnerReadAt] = useState(null);
  // コメント報告（2026-07-19）：🚩報告する→問題のコメントをタップ→どう問題かを選んで送信（運営に届く・本文は凍結コピー保存）
  const [reportMode, setReportMode] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetail, setReportDetail] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const REPORT_REASONS = ["連絡先の交換・誘導", "誹謗中傷・攻撃的な言葉", "差別的な発言", "金銭・契約のトラブル", "迷惑・スパム", "その他"];
  const submitReport = async () => {
    if (!reportTarget || !reportReason || reportSending) return;
    setReportSending(true);
    try {
      const { data, error } = await supabase.rpc("report_chat_message", { p_message_id: reportTarget.id, p_reason: reportReason, p_detail: reportDetail.trim() });
      if (error || !data?.ok) { alert("報告に失敗しました：" + (data?.reason || error?.message || "不明")); setReportSending(false); return; }
      setReportDone(true);
    } catch { alert("報告に失敗しました。"); }
    setReportSending(false);
  };
  // 相手ごとのチャット（2026-07-19たきと指示）：求人・応募ごとに分けず、同じ相手との全応募のメッセージを1本に統合する。
  // appIds＝この相手と共有する全応募ID／activeAppId＝送信・確認カード・採用ボタンが紐づく「現役」の応募
  // （進行中で最新のもの。無ければ最新。完了した過去の応募は履歴としてメッセージに混ざる）
  const [appIds, setAppIds] = useState(null);
  const [appJobMap, setAppJobMap] = useState({}); // application_id→job_number（自動メッセージ下「応募された求人を見る」用・2026-07-19）
  const [jobBox, setJobBox] = useState(null); // 該当求人のボックス表示：{loading, job_number, job}
  const openJobBox = async (jobNumber) => {
    if (!jobNumber) return;
    setJobBox({ loading: true, job_number: jobNumber, job: null });
    try {
      const { data } = await supabase.from("jobs_public").select("*").eq("job_number", jobNumber).maybeSingle();
      setJobBox({ loading: false, job_number: jobNumber, job: data ? mapJobPublicRow(data) : null });
    } catch { setJobBox({ loading: false, job_number: jobNumber, job: null }); }
  };
  const [activeAppId, setActiveAppId] = useState(applicationId);
  const [activeStatus, setActiveStatus] = useState(null); // 現役応募のステータス（applied=農家に承認/見送るボタン表示・2026-07-19）
  const [activeAvail, setActiveAvail] = useState(null); // 現役応募の来られる日（期間求人・文脈カードで表示・2026-07-24）
  const [activeAgreed, setActiveAgreed] = useState(null); // 現役応募の働く日（確定・文脈カード/確認カードで表示・2026-07-24 追記3）
  const [threadApps, setThreadApps] = useState([]); // この相手との全応募（求人No.の仕分け用・2026-07-22）。相手は1人でも求人は複数ありうる
  // 現役応募を切り替える（状態＝採用/確認カード/保険/#N をその応募に合わせる）。求人ページ取得も行う
  const applyActive = async (row) => {
    if (!row) return;
    setActiveAppId(row.id);
    setActiveStatus(row.status);
    setActiveAvail(row.available_dates ?? null);
    setActiveAgreed(row.agreed_dates ?? null);
    setWorkerConfirmed(!!row.terms_confirmed_worker_at);
    setFarmerConfirmed(!!row.terms_confirmed_farmer_at);
    setInsurancePreparedAt(row.insurance_prepared_at);
    setChatJobNumber(row.job_number ?? null);
    setConfirmBoxOpen(false); setConfirmJob(null); setConfirmMeetingPlace(null); // 前の求人の残像を消す
    if (row.job_number) {
      try {
        // 求人情報と集合場所は並列取得（2026-07-27：直列だと切替が体感で遅い）
        const [jobRes, mpRes] = await Promise.all([
          supabase.from("jobs_public").select("*").eq("job_number", row.job_number).maybeSingle(),
          supabase.rpc('job_meeting_place', { p_job_number: row.job_number }),
        ]);
        if (jobRes.data) setConfirmJob(mapJobPublicRow(jobRes.data));
        if (mpRes.data && mpRes.data.ok) setConfirmMeetingPlace(mpRes.data);
      } catch {}
    }
  };
  const [deciding, setDeciding] = useState(false);
  const load = async (ids) => {
    const scope = ids || appIds || [applicationId];
    try {
      const { data } = await supabase.from("messages").select("*").in("application_id", scope).order("created_at",{ascending:true});
      if (data) setMsgs(data);
      setMsgsLoading(false); // 取得できた時点で仮配置を畳む（0件なら「まだメッセージはありません」に切り替わる）
      // 未読通知（2026-07-17）：チャットを開いた時点で自分宛の未読を既読化し、下部バーのバッジ再計算を通知
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if ((data || []).some(m => m.sender_id !== session.user.id && !m.read_at)) {
            await supabase.from("messages").update({ read_at: new Date().toISOString() })
              .in("application_id", scope).neq("sender_id", session.user.id).is("read_at", null);
            window.dispatchEvent(new Event("cb:unreadRefresh"));
          }
          // 一覧キャッシュの未読も即クリア（既読化と同時＝一覧に戻った時に未読が一瞬残らない・2026-07-22）
          if (chatCache.v && chatCache.v.unreadMap) {
            const um = { ...chatCache.v.unreadMap };
            let changed = false;
            scope.forEach(id => { if (um[id]) { delete um[id]; changed = true; } });
            if (changed) chatCache.v = { ...chatCache.v, unreadMap: um };
          }
          // 既読トラッキング（2026-07-22・第8弾）：自分の最終既読時刻をchat_readsに刻む（相手側で「既読」表示に使われる）
          const now = new Date().toISOString();
          await supabase.from("chat_reads").upsert(
            scope.map(id => ({ application_id: id, reader_id: session.user.id, last_read_at: now })),
            { onConflict: "application_id,reader_id" }
          );
          // 相手の最終既読時刻を取得（counterpart select・当事者のみ読める）。自分の送信メッセージの「既読」判定に使う
          const { data: pr } = await supabase.from("chat_reads")
            .select("last_read_at").in("application_id", scope).neq("reader_id", session.user.id)
            .order("last_read_at", { ascending: false }).limit(1).maybeSingle();
          setPartnerReadAt(pr ? pr.last_read_at : null);
        }
      } catch {}
    } catch {}
  };

  const decideApplication = async (approve) => {
    if (deciding) return;
    if (!approve && !window.confirm("この応募を見送りますか？")) return;
    setDeciding(true);
    try {
      const { data, error } = await supabase.rpc("approve_application", { p_application_id: activeAppId, p_approve: approve });
      if (error || !data?.ok) { alert("処理に失敗しました：" + (data?.reason || error?.message || "不明")); setDeciding(false); return; }
      setActiveStatus(data.status);
      await load(); // ボタンに応じた自動返信（承認/見送り）が届くので再読込
    } catch { alert("処理に失敗しました。"); }
    setDeciding(false);
  };
  useEffect(() => {
    // 求人No.ボックスでの切替を一瞬に（2026-07-27たきと指示）：
    // ①前のスレッドのメッセージを即クリア（残像を消す）
    // ②同じ相手の別応募＝threadAppsに行がある＝相手情報・一覧は取得済みso、
    //   セッション/相手プロフィール/イニシャル/全応募の再取得（4往復）を丸ごと省き、
    //   手元の行でapplyActive→messagesの読込だけ行う（体感が一気に縮む）
    setMsgs([]); setMsgsLoading(true); // 切替＝前の残像を消し、仮配置に戻す
    const localRow = threadApps.find(r => r.id === applicationId);
    if (localRow && myId) {
      setAppIds([applicationId]);
      applyActive(localRow);
      load([applicationId]);
      return;
    }
    (async () => {
      try {
        const { data:{ session } } = await supabase.auth.getSession();
        if (!session) { load([applicationId]); return; }
        setMyId(session.user.id);
        const { data: app } = await supabase.from("applications")
          .select("farmer_id,worker_id")
          .eq("id", applicationId).maybeSingle();
        if (app) {
          const iAmWorker = session.user.id === app.worker_id;
          const table = iAmWorker ? "employer_profiles_public" : "worker_profiles"; // 他人の雇い手行は公開ビュー経由（番地・未公開テキスト遮断・2026-07-19監査#1）
          const partnerId = iAmWorker ? app.farmer_id : app.worker_id;
          setPartnerWorkerId(iAmWorker ? null : app.worker_id); // 相手が働き手の時だけアイコンタップでプレビュー（2026-07-19）
          setPartnerFarmerId(iAmWorker ? app.farmer_id : null);
          setIsWorkerSide(iAmWorker);
          // 相手プロフィール・イニシャル・全応募は互いに独立so並列取得（2026-07-27：直列3往復を1往復ぶんに）
          const [pRes, initRes, relRes] = await Promise.all([
            supabase.from(table).select("nickname,avatar_url").eq("auth_id", partnerId).maybeSingle(),
            supabase.rpc("my_chat_partner_initials"),
            supabase.from("applications")
              .select("id,job_number,status,created_at,terms_confirmed_worker_at,terms_confirmed_farmer_at,insurance_prepared_at,available_dates,agreed_dates")
              .eq(iAmWorker ? "worker_id" : "farmer_id", session.user.id)
              .eq(iAmWorker ? "farmer_id" : "worker_id", partnerId)
              .order("created_at", { ascending: false }),
          ]);
          if (pRes.data) setPartner(pRes.data);
          // ニックネーム未設定時のアイコン用に、相手のメール頭文字2文字（本体は伏せる）を使う（2026-07-22）
          if (initRes.data && initRes.data[partnerId]) setPartnerInitials(initRes.data[partnerId]);
          const rel = relRes.data;
          const relRows = (rel && rel.length > 0) ? rel : null;
          // 現役＝開いた応募(applicationId)そのもの（2026-07-22 修正）。メッセージ履歴は相手ごとに束ねる(appIds)が、
          // 状態（採用/確認カード/保険/#N・"勲章"）は開いた応募に固定する。以前は「相手との最新の応募」を現役にしていたため、
          // 同じ相手に複数応募があると別の求人(例#1055)の状態が開いた求人(例#1053)に映っていた。見つからない時だけ従来の推定へ
          const active = relRows
            ? (relRows.find(r => r.id === applicationId)
               || relRows.find(r => CHAT_ELIGIBLE_STATUSES.includes(r.status))
               || relRows[0])
            : null;
          // チャットは求人（応募）ごとに分ける（2026-07-23）：メッセージ履歴は開いた応募だけに限定する。
          // 相手ごとに束ねると、求人ごとの terms_snapshot（契約内容）が混同する恐れがあるため。
          // threadApps は「この相手の他の求人」への導線＋二重予約チェック用に残す（切替は各求人の別チャットへ遷移）。
          const ids = [applicationId];
          setAppIds(ids);
          setThreadApps(relRows || []);
          if (relRows) setAppJobMap(Object.fromEntries(relRows.map(r => [r.id, r.job_number])));
          // メッセージ読込は求人情報の取得を待たない（2026-07-27：awaitで直列化していたぶん表示が遅れていた）
          load(ids);
          if (active) applyActive(active);
          return;
        }
      } catch {}
      load([applicationId]);
    })();
  }, [applicationId]);
  // リアルタイム受信（2026-07-19）：この相手との応募IDへの新着メッセージINSERTを購読し、即時再読込。
  // 配信はRLS準拠（当事者のみ）。loadが既読化と下部バーバッジ再計算(cb:unreadRefresh)も担う。
  // 自分の送信分もイベントが来るがloadは冪等。チャットを閉じると購読解除
  useEffect(() => {
    if (!appIds || appIds.length === 0) return;
    // in.(uuid,...)フィルタはRealtimeで不安定なため、確実なeqを応募IDごとに張る（2026-07-27修正）
    let ch = supabase.channel("chat-" + applicationId);
    appIds.forEach(id => {
      ch = ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "application_id=eq." + id }, () => { load(appIds); });
    });
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [appIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // 復帰時の再読込＋保険ポーリング（2026-07-27たきと指示：チャットのリアルタイム化）：
  // iOS PWAはバックグラウンドでWebSocketが凍結・切断され、復帰後にRealtimeイベントが届かないことがある。
  // 画面復帰（visibilitychange/focus）で即再読込し、開いている間は5秒ごとの保険ポーリング。
  // loadは冪等で既読化・バッジ再計算も担うso多重に呼ばれても安全
  useEffect(() => {
    if (!appIds || appIds.length === 0) return;
    const refresh = () => { if (document.visibilityState === "visible") load(appIds); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const iv = setInterval(refresh, 5000);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); clearInterval(iv); };
  }, [appIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // 最新メッセージへ自動スクロール（LINE式・2026-07-19）：メッセージ更新のたびに一番下へ
  useEffect(() => {
    const el = msgScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const confirmTerms = async () => {
    if (confirmingTerms) return;
    setConfirmingTerms(true);
    const wasWorkerConfirmed = workerConfirmed; // 遷移検知用（今回初めて確認したかどうか）
    try {
      const { data, error } = await supabase.rpc('confirm_terms', { p_application_id: activeAppId });
      if (!error && data && data.ok) {
        setWorkerConfirmed(!!data.worker_confirmed);
        setFarmerConfirmed(!!data.farmer_confirmed);
        // 働き手が今回はじめて確認した時、その旨をチャットメッセージとして送信（2026-07-19）。
        // 履歴として残り、農家にも「確認済み」が伝わる
        if (isWorkerSide && !wasWorkerConfirmed && data.worker_confirmed) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              await supabase.from("messages").insert({ application_id: activeAppId, sender_id: session.user.id, body: "✓ 求人内容を確認しました。よろしくお願いします。" });
              await load(appIds);
            }
          } catch {}
        }
      }
    } catch {}
    setConfirmingTerms(false);
  };
  // ── 横スワイプで求人No.を切り替える（2026-07-30たきと指示「指に連動させてほしい」）──
  // 並びは上部の求人No.帯と同じ threadApps の順。左へ引く＝次の求人／右へ引く＝前の求人。
  // 端では引きしろを1/4に落として「これ以上は無い」を手で伝える（ゴムの手応え）。
  // 縦スクロールは邪魔しない＝最初の動きで軸を決め、横と決まった時だけ追従する。
  const goThread = (id) => {
    // 帯のボタンと同じ行き先。location.replaceはアプリ全体の再読込を起こすためhashだけ差し替える
    try { window.history.replaceState(null, "", "#/chat/" + id); } catch { window.location.hash = "/chat/" + id; }
    window.dispatchEvent(new Event("hashchange"));
  };
  const chatSwipe = useRef(null);
  const [swipeDx, setSwipeDx] = useState(0);
  const [swipeSnap, setSwipeSnap] = useState(false); // true=指を離した後の戻り（アニメで戻す）
  const threadNeighbor = (dir) => { // dir=+1 次 / -1 前
    const i = threadApps.findIndex(r => r.id === activeAppId);
    if (i < 0) return null;
    const n = threadApps[i + dir];
    return n ? n.id : null;
  };
  const onChatSwipeStart = (e) => {
    if (threadApps.length < 2 || !e.touches || e.touches.length !== 1) { chatSwipe.current = null; return; }
    chatSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null };
    setSwipeSnap(false);
  };
  const onChatSwipeMove = (e) => {
    const s = chatSwipe.current; if (!s || !e.touches || !e.touches[0]) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;      // まだ方向が定まっていない
      s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? "h" : "v"; // 一度決めたら最後まで変えない
    }
    if (s.lock !== "h") return;                               // 縦スクロールはそのまま通す
    const hasNext = !!threadNeighbor(dx < 0 ? 1 : -1);
    setSwipeDx(Math.max(-140, Math.min(140, hasNext ? dx : dx * 0.25))); // 端はゴムの手応え
  };
  const onChatSwipeEnd = () => {
    const s = chatSwipe.current; chatSwipe.current = null;
    if (!s || s.lock !== "h") { setSwipeDx(0); return; }
    const dx = swipeDx;
    const target = Math.abs(dx) >= 60 ? threadNeighbor(dx < 0 ? 1 : -1) : null;
    setSwipeSnap(true); setSwipeDx(0);                        // 指を離したら必ず元の位置へ戻す
    setTimeout(() => setSwipeSnap(false), 240);
    if (target) goThread(target);
  };
  // 二重予約チェック（2026-07-22）：農家が採用しようとする働き手が、この農家の別の求人（進行中）で
  // 日程が重なっていないか。重なる求人番号を返す（無ければnull）。RLSで見えるのは自分の求人だけ＝越権なし
  const farmerDoubleBookingCheck = async () => {
    if (isWorkerSide || chatJobNumber == null) return null;
    const others = threadApps.filter(r => r.id !== activeAppId && CHAT_ELIGIBLE_STATUSES.includes(r.status) && r.job_number != null);
    if (others.length === 0) return null;
    try {
      const nums = [...new Set([chatJobNumber, ...others.map(r => r.job_number)])];
      const { data: jrows } = await supabase.from("jobs").select("job_number,date_start,date_end").in("job_number", nums);
      const dm = Object.fromEntries((jrows || []).map(j => [j.job_number, j]));
      const cur = dm[chatJobNumber];
      if (!cur || !cur.date_start) return null;
      const curEnd = cur.date_end || cur.date_start;
      for (const r of others) {
        const j = dm[r.job_number];
        if (!j || !j.date_start) continue;
        const jEnd = j.date_end || j.date_start;
        if (cur.date_start <= jEnd && j.date_start <= curEnd) return r.job_number; // 日程が重なる
      }
    } catch {}
    return null;
  };
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const { data:{ session } } = await supabase.auth.getSession();
      if (!session) { setSending(false); return; }
      const { error } = await supabase.from("messages").insert({ application_id: activeAppId, sender_id: session.user.id, body: text.trim() });
      if (!error) { setText(""); await load(); }
    } catch {}
    setSending(false);
  };
  // ＋シートの質問集タブ（2026-07-23）：農家が自分の面接の質問集をチャットに投函（回答はチャットに残る）
  useEffect(() => {
    if (!tmplOpen || isWorkerSide || !myId) return;
    let cancelled = false;
    (async () => {
      try {
        // 初回はデフォルト3種を用意してから読み込む（準備しておく・2026-07-23）
        const list = await ensureDefaultQuestionSets(myId);
        if (!cancelled) setChatQSets(list);
      } catch { if (!cancelled) setChatQSets([]); }
    })();
    return () => { cancelled = true; };
  }, [tmplOpen, isWorkerSide, myId]);
  const sendQSetToChat = async (setId) => {
    if (qSending) return;
    setQSending(true);
    try {
      const { data, error } = await supabase.rpc("send_interview_questions", { p_application_id: activeAppId, p_set_id: setId });
      if (error || !data?.ok) { alert("送信に失敗しました：" + (data?.message || data?.reason || error?.message || "不明")); setQSending(false); return; }
      setQSending(false); setTmplOpen(false);
      await load();
      try { window.dispatchEvent(new Event("cb:unreadRefresh")); } catch {}
    } catch (e) { alert("送信に失敗しました：" + (e?.message || "不明")); setQSending(false); }
  };
  // 既読マーカー（2026-07-22・第8弾）：LINE式に、相手が読んだ自分の最新メッセージ1件にだけ「既読」を出す。
  // partnerReadAt（相手の最終既読時刻）以前に送った自分のメッセージのうち、最後の1件のidを求める
  const readMarkMsgId = (() => {
    if (!partnerReadAt || !myId) return null;
    const t = new Date(partnerReadAt).getTime();
    let id = null;
    for (const m of msgs) {
      if (m.sender_id === myId && new Date(m.created_at).getTime() <= t) id = m.id;
    }
    return id;
  })();
  // 終了したチャット（2026-07-25たきと指示・2026-07-27に見送りを追加）：失効・完了・見送りは同じ設計＝
  // 薄暗い幕＋中央ラベル・スクロール閲覧可・入力バー非表示。履歴は消さずに読める状態を保つ（チャット履歴の保全）。
  // ラベルと色は帯の唯一のソース（APP_PHASE_LABEL / APP_PHASE_COLOR）から採る
  const CHAT_CLOSED_NOTE = {
    expired:   "この求人の募集期間は終了しました",
    completed: "この仕事は完了しました",
    rejected:  "この応募は見送りになりました",
  };
  const chatClosed = !!CHAT_CLOSED_NOTE[activeStatus];
  return (
    <div className="chat-full" style={{ maxWidth:600, marginLeft:"auto", marginRight:"auto", display:"flex", flexDirection:"column" }}>
      {/* 上部フッター（LINE式・2026-07-22）：← / 名前さん / 報告する の1行ヘッダー。求人No.は下の帯へ移動 */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0 10px", borderBottom:"1px solid #EEE" }}>
        <button onClick={onBack} aria-label="戻る" className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:20, cursor:"pointer", padding:"4px 4px", flexShrink:0, lineHeight:1 }}>←</button>
        {partner ? (<>
          <p onClick={()=>{ if (partnerWorkerId) openWorkerPreview(partnerWorkerId); else if (partnerFarmerId) openEmployerPreview(partnerFarmerId); }} className="f-sans" style={{ flex:1, minWidth:0, fontSize:15, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }}>{partner.nickname || "名前未設定"}さん</p>
          <button onClick={()=>{ setReportMode(v=>!v); setReportTarget(null); }} className="f-sans" style={{ flexShrink:0, background: reportMode ? "#FDECEC" : "none", border:"1px solid " + (reportMode ? "#E24B4A" : "#EBEBEB"), borderRadius:20, padding:"6px 12px", fontSize:12, fontWeight:600, color: reportMode ? "#E24B4A" : "#717171", cursor:"pointer" }}>{reportMode ? "キャンセル" : "🚩 報告する"}</button>
        </>) : <span style={{ flex:1 }} />}
      </div>
      {/* 求人No.はスワイプ（横スクロール）／採用するは固定（スクロールせず常に右に表示）（2026-07-22） */}
      {chatJobNumber != null && (
        <div style={{ display:"flex", gap:8, alignItems:"stretch", padding:"10px 0 4px" }}>
          {/* 求人No.ボックス群：この枠だけが横スワイプ */}
          <div style={{ flex:1, minWidth:0, display:"flex", gap:8, overflowX:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain" }}>
            {threadApps.map(r => {
              const isActive = r.id === activeAppId;
              // 別の求人はその求人の別チャットへ遷移（求人ごとに分離・2026-07-23）。
              // replaceで履歴を積まない＝←（戻る）が求人切替の履歴を辿らず、ちゃんとチャットから出る
              return (
                <button key={r.id} onClick={()=>{
                  if (isActive) return;
                  // location.replace はブラウザによってページ全体の再読込を起こし、切替に十数秒かかっていた
                  // （2026-07-27たきと報告）。履歴を積まずhashだけ差し替え＝アプリは再起動しない。
                  // replaceStateはhashchangeを発火しないので手動で通知する（Appのハッシュ監視が拾う）
                  try { window.history.replaceState(null, "", "#/chat/" + r.id); } catch { window.location.hash = "/chat/" + r.id; }
                  window.dispatchEvent(new Event("hashchange"));
                }} className="f-sans" style={{ flexShrink:0, textAlign:"left", background: isActive ? "#F0F7F3" : "#fff", border:"1px solid " + (isActive ? "#00A86B" : "#EBEBEB"), borderRadius:12, padding:"8px 14px", cursor: isActive ? "default" : "pointer", minWidth:120 }}>
                  <span style={{ display:"block", fontSize:13, fontWeight:700, color: isActive ? "#0B6B4F" : "#222" }}>#{r.job_number}</span>
                  {/* 帯統一（2026-07-25）：段階名は応募者リストと同じ段階色で表示 */}
                  <span style={{ display:"block", fontSize:11, marginTop:2 }}><span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(appPhaseKey(r)); }} role="button" style={{ color: APP_PHASE_COLOR[appPhaseKey(r)] || "#999", fontWeight:700, cursor:"pointer" }}>{APP_PHASE_LABEL[appPhaseKey(r)] || r.status}</span><span style={{ color:"#999" }}>{isActive ? "・表示中" : "・開く"}</span></span>
                </button>
              );
            })}
          </div>
          {/* 採用ボックス（農家・進行中のみ）：固定＝スクロールの外。常に右端に見える */}
          {!isWorkerSide && CHAT_ELIGIBLE_STATUSES.includes(activeStatus) && (
            farmerConfirmed ? (
              <span className="f-sans" style={{ flexShrink:0, display:"flex", alignItems:"center", background:"#E6F7EF", color:"#00A86B", fontSize:13, fontWeight:700, borderRadius:12, padding:"8px 16px", whiteSpace:"nowrap" }}>✓ 採用決定済み{!workerConfirmed ? "（確認待ち）" : ""}</span>
            ) : (
              <button onClick={async ()=>{ if (confirmingTerms) return; const dup = await farmerDoubleBookingCheck(); const warn = dup ? `⚠️ この働き手さんは、日程が重なる別の求人 #${dup} にも進んでいます。\n同じ日に別の仕事（二重予約）になっていないか確認してください。\n\n` : ""; if (window.confirm(warn + "この方の採用を決定しますか？\n面接はチャットで行い、採用を決めたらタップしてください。" + (workerConfirmed ? "\n（働き手は内容確認済み）" : "") + "\n\n採用すると契約が成立し、お互いのお名前（本名）が相手に表示されます。雇用の手続き（労働者名簿・賃金の記録）に必要なためです。")) confirmTerms(); }} disabled={confirmingTerms} className="f-sans" style={{ flexShrink:0, display:"flex", alignItems:"center", background:"#222", color:"#fff", fontSize:13, fontWeight:700, border:"none", borderRadius:12, padding:"8px 18px", cursor:"pointer", whiteSpace:"nowrap", opacity: confirmingTerms ? 0.6 : 1 }}>{confirmingTerms ? "..." : "採用する"}</button>
            )
          )}
        </div>
      )}
      {/* 契約成立後のみ相手の本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)）。未契約は案内文を出す */}
      {activeAppId && CHAT_ELIGIBLE_STATUSES.includes(activeStatus) && (
        <ContractPartyName applicationId={activeAppId} style={{ padding:"2px 0 0" }} />
      )}
      {reportMode && !reportTarget && (
        <p className="f-sans" style={{ fontSize:12, color:"#E24B4A", fontWeight:700, margin:0, padding:"8px 0", textAlign:"center" }}>問題のあるコメントをタップしてください</p>
      )}

      {/* 求人コンテキストカード（#N「作物 作業」＋確認/採用/保険/求人リンクの展開）は削除（2026-07-25たきと指示）。
          求人番号は上部の#N求人ボックス帯・確認/採用の行動は今日のやることに集約済みのため重複だった */}

      {/* 求人内容の確認（⑦・働き手のみ）：チャットを占有せず、コンパクトなバー→タップでボックス展開（2026-07-19） */}
      {/* 確認済みはチャットメッセージ「✓ 求人内容を確認しました」として残る（2026-07-19）ので、
          未確認の時だけ確認バーを出す */}
      {confirmJob && isWorkerSide && !workerConfirmed && CHAT_ELIGIBLE_STATUSES.includes(activeStatus) && (
          <button onClick={()=>{ setConfirmStep(0); setConfirmBoxOpen(true); }} className="f-sans cb-urgent-still"
            style={{ display:"flex", alignItems:"center", gap:10, width:"100%", textAlign:"left", background:"#FFF8E7", border:"1px solid #F5D98F", borderRadius:12, padding:"12px 14px", cursor:"pointer", margin:"10px 0" }}>
            <span style={{ fontSize:20, flexShrink:0 }}>📋</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ display:"block", fontSize:13, fontWeight:700, color:"#8A6D1D" }}>はじめる前に、求人内容を確認しましょう</span>
              <span style={{ display:"block", fontSize:12, color:"#B08A2E", marginTop:2 }}>日程・集合場所・持ち物・報酬など{chatJobNumber != null ? `（求人 #${chatJobNumber}）` : ""}</span>
            </span>
            <span style={{ fontSize:13, fontWeight:700, color:"#8A6D1D", flexShrink:0 }}>確認する →</span>
          </button>
      )}
      {/* 求人内容確認ボックス（2026-07-19）：分割式（1項目ずつ「はい」→一覧→内容に相違ありません） */}
      {confirmBoxOpen && confirmJob && isWorkerSide && !workerConfirmed && (() => {
        const rows = [
          { label:"日程",     value: disp(confirmJob.dateLabel) },
          // 働く日（農家が確定・2026-07-24 追記3）：期間求人で確定済みの時だけ確認対象に含める
          ...(Array.isArray(activeAgreed) && activeAgreed.length > 0 ? [{ label:"働く日", value: activeAgreed.slice().sort().map(d => calFmtDate(d)).join("・") }] : []),
          { label:"時間",     value: disp(confirmJob.workTime) },
          { label:"集合場所", value: confirmMeetingPlace ? disp(confirmMeetingPlace.full_address) : "取得中...",
            mapUrl: confirmMeetingPlace?.full_address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(confirmMeetingPlace.full_address) : null },
          { label:"持ち物",   value: disp(confirmJob.items) },
          { label:"注意・備考", value: disp(confirmJob.cautions) },
          { label:"報酬",     value: confirmJob.pay ? payLabel(confirmJob) : EMPTY_MARK },
          // 賃金支払条件（2026-08-02）：掲載時にjobsへ確定保存された3列を双方確認の対象に含める。
          // NULL・未知コードは「支払条件を確認できません」（推測表示・現在値フォールバック禁止）
          { label:"賃金締切", value: WAGE_CLOSING_RULE_LABELS[confirmJob.wageClosingRule] || PAY_TERMS_UNKNOWN },
          { label:"支払",     value: payTermsLine(confirmJob).replace(/^支払：/, "") },
          { label:"支払方式", value: confirmJob.fullPayGuarantee ? "⏱ 早く終わっても満額" : EMPTY_MARK },
          { label:"保険",     value: insurancePreparedAt ? "✓ 準備の報告あり" : "まだ報告がありません" },
        ];
        const done = confirmStep >= rows.length;
        return (
          <div onClick={()=>setConfirmBoxOpen(false)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
            <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:18, padding:"20px", maxWidth:420, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
              <button onClick={()=>setConfirmBoxOpen(false)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>はじめる前の確認</p>
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 14px" }}>{chatJobNumber != null ? `求人 #${chatJobNumber}　` : ""}{!done ? `${confirmStep + 1} / ${rows.length}` : "内容の確認"}</p>
              {!done ? (
                <div>
                  <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"0 0 4px" }}>{rows[confirmStep].label}</p>
                  <p className="f-sans" style={{ fontSize:16, color:"#222", fontWeight:700, lineHeight:1.7, margin:"0 0 6px", overflowWrap:"break-word", wordBreak:"break-word" }}>{rows[confirmStep].value}</p>
                  {rows[confirmStep].mapUrl && (
                    <a href={rows[confirmStep].mapUrl} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ display:"inline-block", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", marginBottom:6 }}>📍 Googleマップで開く →</a>
                  )}
                  <div style={{ height:12 }} />
                  <div style={{ display:"flex", gap:8 }}>
                    {confirmStep > 0 && (
                      <button onClick={()=>setConfirmStep(s=>s-1)} className="f-sans" style={{ padding:"12px 16px", fontSize:13, fontWeight:600, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>← 前へ</button>
                    )}
                    <button onClick={()=>setConfirmStep(s=>s+1)} className="f-sans" style={{ flex:1, padding:"12px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>はい</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display:"grid", gap:10, marginBottom:14 }}>
                    {rows.map(row => (
                      <div key={row.label} style={{ display:"flex", justifyContent:"space-between", gap:12, borderBottom:"1px solid #F7F7F7", paddingBottom:8 }}>
                        <span className="f-sans" style={{ fontSize:12, color:"#B0B0B0", flexShrink:0 }}>{row.label}</span>
                        {row.mapUrl ? (
                          <a href={row.mapUrl} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ fontSize:13, color:"#00A86B", fontWeight:600, textAlign:"right", overflowWrap:"break-word", wordBreak:"break-word", textDecoration:"underline" }}>✓ {row.value} 📍</a>
                        ) : (
                          <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600, textAlign:"right", overflowWrap:"break-word", wordBreak:"break-word" }}>✓ {row.value}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="f-sans" style={{ fontSize:11, color:"#8A8A8A", lineHeight:1.7, margin:"0 0 10px", background:"#F7F7F7", borderRadius:8, padding:"8px 10px" }}>
                    確認すると契約が成立し、お互いのお名前（本名）が相手に表示されます。雇用の手続き（労働者名簿・賃金の記録）に必要なためです。
                  </p>
                  <button onClick={async ()=>{ await confirmTerms(); setConfirmBoxOpen(false); }} disabled={confirmingTerms} className="f-sans" style={{ width:"100%", padding:"14px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer" }}>
                    {confirmingTerms ? "..." : "内容に相違ありません"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 失効した求人のチャット（2026-07-25たきと指示）：メッセージ領域を薄暗くし中央に「失効中」ラベル。
          オーバーレイはpointerEvents:noneなので背後のチャットは従来どおりスクロール・閲覧できる（履歴保全と整合） */}
      <div style={{ flex:1, minHeight:0, position:"relative", display:"flex", flexDirection:"column" }}>
      {/* 横スワイプで求人No.を切り替える（2026-07-30たきと指示）。指に連動＝引いた分だけ中身がずれ、
          離すと切り替わる／戻る。上部の求人No.帯のタップと同じ行き先（hash差し替え＝再読込しない） */}
      <div ref={msgScrollRef}
        onTouchStart={onChatSwipeStart} onTouchMove={onChatSwipeMove} onTouchEnd={onChatSwipeEnd} onTouchCancel={onChatSwipeEnd}
        style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorY:"contain", padding:"12px 0", display:"flex", flexDirection:"column", gap:8,
                 transform: swipeDx ? `translateX(${swipeDx}px)` : undefined,
                 transition: swipeSnap ? "transform .22s cubic-bezier(.22,.8,.36,1)" : "none" }}>
        {/* 採用するボタンは上部の求人No.帯（同列）へ移設（2026-07-22 LINE式）。凍結トリガーは confirm_terms のまま */}
        {/* 読み込み中は吹き出しの仮配置（2026-07-27たきと指示）。「まだメッセージはありません」を
            先に出すと、履歴があるのに一瞬「無い」と誤読させるため、読込中と空を分ける */}
        {msgs.length === 0 && msgsLoading ? (
          <div aria-busy="true" aria-label="読み込み中" style={{ display:"grid", gap:10, padding:"8px 4px" }}>
            {[0,1,2,3].map(i => (
              <div key={i} className="ghost-line" style={{ height: i % 2 ? 44 : 62, width: i % 2 ? "58%" : "72%", borderRadius:16, justifySelf: i % 2 ? "end" : "start" }} />
            ))}
          </div>
        ) : msgs.length === 0 ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#B0B0B0", fontSize:13, marginTop:40 }}>まだメッセージはありません。<br/>面接や打ち合わせの連絡は、ここで行えます。</p>
        ) : msgs.map(m => (
          <Fragment key={m.id}>
          <div
            onClick={()=>{ if (reportMode) { setReportTarget(m); setReportReason(""); setReportDetail(""); setReportDone(false); } }}
            style={{ alignSelf: m.sender_id===myId ? "flex-end" : "flex-start", maxWidth:"75%", padding:"10px 14px", borderRadius:14, fontSize:14, background: m.sender_id===myId ? "#00A86B" : "#F0F0F0", color: m.sender_id===myId ? "#fff" : "#222", cursor: reportMode ? "pointer" : "default", boxShadow: reportMode ? "0 2px 6px rgba(226,75,74,.35)" : "none", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", ...((typeof m.body==="string" && m.body.startsWith("【面接の質問】")) ? { border: m.sender_id===myId ? "2px solid rgba(255,255,255,0.7)" : "2px solid #F5A623" } : {}) }} className="f-sans">{m.body}</div>
          {/* 既読（2026-07-22・第8弾）：相手が読んだ自分の最新メッセージにだけ小さく表示 */}
          {m.id === readMarkMsgId && (
            <span className="f-sans" style={{ alignSelf:"flex-end", fontSize:10, color:"#B0B0B0", marginTop:-4 }}>既読</span>
          )}
          {/* 応募の自動メッセージの直後（農家側のみ）：2通目として応募者のプロフィールカード＋
              「応募された求人を見る →」リンクを表示（2026-07-19）。旧文言（確認をお願いします）にも出すためstartsWithで判定 */}
          {!isWorkerSide && partnerWorkerId && m.sender_id !== myId && m.body.startsWith("あなたの求人に応募しました！") && (
            <>
            <div
              onClick={()=>{ if (!reportMode) openWorkerPreview(partnerWorkerId); }}
              role="button"
              className="f-sans"
              style={{ alignSelf:"flex-start", maxWidth:"75%", background:"#fff", border:"1px solid #EBEBEB", borderRadius:14, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, cursor: reportMode ? "default" : "pointer", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
              <Avatar url={partner?.avatar_url} name={partner?.nickname || partnerInitials || "？"} size={48} ring={ROLE_ORANGE} />
              <div>
                <p style={{ fontSize:14, fontWeight:700, color:"#222", margin:0 }}>{(partner?.nickname || "働き手")}さん</p>
                <p style={{ fontSize:13, fontWeight:700, color:"#00A86B", margin:"4px 0 0", textDecoration:"underline" }}>プロフィールを見る →</p>
              </div>
            </div>
            <button
              onClick={()=>{ if (!reportMode) openJobBox(appJobMap[m.application_id] ?? chatJobNumber); }}
              className="f-sans"
              style={{ alignSelf:"flex-start", background:"none", border:"none", padding:"0 0 2px", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor: reportMode ? "default" : "pointer" }}>応募された求人を見る →</button>
            </>
          )}
          </Fragment>
        ))}
      </div>
      {chatClosed && (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.35)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, pointerEvents:"none", zIndex:5 }}>
          <span className="f-sans" style={{ background: APP_PHASE_COLOR[activeStatus] || "#607D8B", color:"#fff", fontSize:14, fontWeight:800, padding:"8px 24px", borderRadius:20 }}>{APP_PHASE_LABEL[activeStatus] || "終了"}</span>
          <span className="f-sans" style={{ color:"#fff", fontSize:12, fontWeight:600, textShadow:"0 1px 4px rgba(0,0,0,0.6)" }}>{CHAT_CLOSED_NOTE[activeStatus]}</span>
        </div>
      )}
      </div>
      {/* コメント報告ボックス（2026-07-19）：該当コメントの引用＋どう問題かの選択＋補足→送信で運営に届く */}
      {reportTarget && (
        <div onClick={()=>{ if (!reportSending) { setReportTarget(null); if (reportDone) setReportMode(false); } }} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>{ setReportTarget(null); if (reportDone) setReportMode(false); }} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            {reportDone ? (
              <div style={{ textAlign:"center", padding:"16px 0" }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🚩</div>
                <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 6px" }}>報告を受け付けました</p>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>運営が内容を確認します。コメントは記録として保存されました。</p>
              </div>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 12px" }}>🚩 コメントを報告する</p>
                <div className="f-sans" style={{ background:"#F7F7F7", borderRadius:10, padding:"10px 12px", fontSize:13, color:"#222", lineHeight:1.7, marginBottom:14, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", maxHeight:"20vh", overflowY:"auto" }}>{reportTarget.body}</div>
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 8px" }}>このコメントは、どう問題ですか？</p>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
                  {REPORT_REASONS.map(r => (
                    <button key={r} onClick={()=>setReportReason(r)} className="f-sans" style={{ padding:"8px 12px", borderRadius:20, border: reportReason === r ? "2px solid #E24B4A" : "1px solid #EBEBEB", background: reportReason === r ? "#FDECEC" : "#fff", fontSize:12, fontWeight:600, color: reportReason === r ? "#E24B4A" : "#717171", cursor:"pointer" }}>{r}</button>
                  ))}
                </div>
                <textarea value={reportDetail} onChange={e=>setReportDetail(e.target.value)} placeholder="補足があれば（任意）" rows={3} className="field f-sans" style={{ fontSize:13, marginBottom:12, resize:"vertical" }} />
                <button onClick={submitReport} disabled={!reportReason || reportSending} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:12, cursor:"pointer", opacity: (!reportReason || reportSending) ? 0.5 : 1 }}>{reportSending ? "送信中..." : "報告する"}</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 該当求人ボックス（2026-07-19）：「応募された求人を見る →」タップで展開。写真＋主要情報＋詳細ページへのリンク */}
      {jobBox && (
        <div onClick={()=>setJobBox(null)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            <button onClick={()=>setJobBox(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,0.92)", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2, boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}>✕</button>
            {jobBox.loading ? (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
            ) : jobBox.job ? (
              <>
                {(() => {
                  const p0 = jobBox.job.photos?.[0];
                  const src = photoThumb(p0);
                  return src
                    ? <img loading="lazy" src={src} alt="" style={{ width:"100%", height:170, objectFit:"cover", display:"block", borderRadius:"16px 16px 0 0" }} />
                    : <div style={{ width:"100%", height:170, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, borderRadius:"16px 16px 0 0" }}>🌾</div>;
                })()}
                <div style={{ padding:"14px 18px 18px" }} className="f-sans">
                  <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                    <p style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, flex:1, minWidth:0 }}>{[jobBox.job.crop, jobBox.job.task].filter(Boolean).join(" ") || "求人"}</p>
                    <span style={{ fontSize:11, color:"#C8C8C8", flexShrink:0 }}>#{jobBox.job.id}</span>
                  </div>
                  {jobBox.job.region && <p style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>📍 {jobBox.job.region}</p>}
                  {jobBox.job.dateLabel && <p style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>📅 {jobBox.job.dateLabel}{jobBox.job.workTime ? "　" + jobBox.job.workTime : ""}</p>}
                  {jobBox.job.pay > 0 && <p className="f-mono" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"6px 0 0" }}>{jobBox.job.payType === "daily" ? "日給" : "時給"} {jobBox.job.pay.toLocaleString()}円</p>}
                  {jobBox.job.count && <p style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}>👥 募集 {jobBox.job.count}</p>}
                  <button onClick={()=>{ setJobBox(null); try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "")); } catch {} window.location.hash = "/work/job/" + jobBox.job_number; }} className="f-sans" style={{ marginTop:14, background:"none", border:"none", padding:"0 0 2px", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", cursor:"pointer" }}>詳細ページで見る →</button>
                </div>
              </>
            ) : (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 16px" }}>この求人（#{jobBox.job_number}）は現在公開されていません</p>
            )}
          </div>
        </div>
      )}

      {/* 採用するボタンはチャット右上の浮遊に移設（2026-07-19・上のsticky）。下部の常駐ブロックは廃止 */}
      {/* 失効・完了・見送り（2026-07-25たきと指示・2026-07-27に見送り追加）：入力バーごと非表示＝送信不可。空いた分メッセージ領域(flex:1)が自動で広がる */}
      {chatClosed ? null : (!isWorkerSide && activeStatus === "applied") ? (
        /* 承認待ちの間、農家の入力欄は一時的に承認/見送るボタンへ（2026-07-19）。判断後は通常の入力欄に戻る */
        <div style={{ padding:"12px 0", borderTop:"1px solid #EEE" }}>
          <p className="f-sans" style={{ fontSize:12, color:"#717171", margin:"0 0 8px", textAlign:"center" }}>応募が届いています。アイコンからプロフィールを確認して判断してください</p>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>decideApplication(false)} disabled={deciding} className="f-sans" style={{ flex:1, padding:"13px", fontSize:14, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:12, cursor:"pointer" }}>見送る</button>
            <button onClick={()=>decideApplication(true)} disabled={deciding} className="f-sans" style={{ flex:2, padding:"13px", fontSize:14, fontWeight:700, background:"#00A86B", color:"#fff", border:"none", borderRadius:12, cursor:"pointer", opacity: deciding ? 0.6 : 1 }}>{deciding ? "..." : "承認する"}</button>
          </div>
        </div>
      ) : (
      <div style={{ display:"flex", gap:8, padding:"12px 0", borderTop:"1px solid #EEE", alignItems:"center" }}>
        {/* 定型文（2026-07-22・第8弾）：＋で役割別テンプレシートを開く */}
        <button onClick={()=>{ setTmplTab("phrase"); setTmplOpen(true); }} aria-label="定型文・質問集" className="f-sans" style={{ flexShrink:0, width:40, height:40, borderRadius:"50%", background:"#F0F7F3", border:"1px solid #DDEDE5", fontSize:20, fontWeight:700, color:"#00A86B", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>＋</button>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") send(); }} placeholder="メッセージを入力" className="field f-sans" style={{ flex:1, fontSize:14 }} />
        <button onClick={send} disabled={sending} className="f-sans" style={{ padding:"10px 20px", fontSize:14, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer" }}>{sending?"...":"送信"}</button>
      </div>
      )}

      {/* ＋シート（2026-07-22 第8弾→2026-07-23 タブ化）：定型文／質問集をタブ＋スワイプで切替。
          定型文＝タップで入力欄に挿入（編集して送信可）／質問集＝タップでチャットに投函（農家のみ・回答は残る） */}
      {tmplOpen && (() => {
        const phrasePanel = (
          <>
            <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 12px" }}>タップで入力欄に入ります。送信前に編集できます。</p>
            <div style={{ display:"grid", gap:8 }}>
              {(isWorkerSide ? CHAT_TEMPLATES_WORKER : CHAT_TEMPLATES_FARMER).map(t => (
                <button key={t} onClick={()=>{ setText(prev => prev.trim() ? (prev.replace(/\s*$/, "") + " " + t) : t); setTmplOpen(false); }} className="f-sans" style={{ textAlign:"left", background:"#F7FBF9", border:"1px solid #DDEDE5", borderRadius:12, padding:"12px 14px", fontSize:14, color:"#222", cursor:"pointer", lineHeight:1.6 }}>{t}</button>
              ))}
            </div>
          </>
        );
        const qsetPanel = (
          <>
            <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 12px" }}>タップでチャットに【面接の質問】として送ります。回答もチャットに残ります。</p>
            {chatQSets === null ? (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"24px 0" }}>読み込み中<Dots /></p>
            ) : chatQSets.length === 0 ? (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"20px 8px", lineHeight:1.7 }}>まだ質問集がありません。<br/>プロフィールの「📋 面接の質問集」から作成できます。</p>
            ) : (
              /* minmax(0,1fr)：nowrapの質問プレビューがmin-content幅で列を押し広げ、カードが画面右へ
                 はみ出すのを防ぐ（auto列はnowrap長文の幅まで育つ・2026-07-25修正）。ellipsisはこれで効く */
              <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:8 }}>
                {chatQSets.map(s => (
                  <button key={s.id} disabled={qSending} onClick={()=>sendQSetToChat(s.id)} className="f-sans" style={{ display:"block", textAlign:"left", width:"100%", background:"#F7FBF9", border:"1px solid #DDEDE5", borderRadius:12, padding:"12px 14px", cursor:"pointer" }}>
                    <span style={{ display:"block", fontSize:14, fontWeight:700, color:"#222" }}>{s.title || "無題の質問集"}</span>
                    <span style={{ display:"block", fontSize:12, color:"#999", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{(Array.isArray(s.questions) ? s.questions : []).join(" / ") || "質問なし"}</span>
                  </button>
                ))}
                {qSending && <p className="f-sans" style={{ fontSize:12, color:"#999", textAlign:"center", margin:"4px 0 0" }}>送信中...</p>}
              </div>
            )}
          </>
        );
        // 候補日を送る（引っ越し(5)）：期間求人で、来られる日の候補を働き手に提案する。選んで入力欄に入れて送信
        const datesPanel = (() => {
          const period = daysBetweenYmd(confirmJob?.dateStartRaw, confirmJob?.dateEndRaw);
          if (!confirmJob?.dateStartRaw) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"24px 8px" }}>この求人の日程が取得できませんでした。</p>;
          if (period.length <= 1) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"24px 8px", lineHeight:1.7 }}>この求人は単日のため、候補日はありません。</p>;
          return (
            <>
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 12px" }}>来られる日の候補を選ぶと、入力欄に文章が入ります。送信前に編集できます。</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 }}>
                {period.map(d => {
                  const on = dateSel.includes(d);
                  return <button key={d} onClick={()=>setDateSel(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])} className="f-sans" style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{calFmtDate(d)}</button>;
                })}
              </div>
              <button disabled={dateSel.length===0} onClick={()=>{
                const msg = "【候補日】" + [...dateSel].sort().map(calFmtDate).join("・") + " のいずれかで来られますか？ご都合を教えてください。";
                setText(prev => prev.trim() ? (prev.replace(/\s*$/, "") + " " + msg) : msg);
                setDateSel([]); setTmplOpen(false);
              }} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background: dateSel.length===0 ? "#EBEBEB" : "#00A86B", color: dateSel.length===0 ? "#999" : "#fff", border:"none", borderRadius:10, cursor: dateSel.length===0 ? "not-allowed" : "pointer" }}>候補日を入力欄に入れる{dateSel.length>0 ? `（${dateSel.length}日）` : ""}</button>
            </>
          );
        })();
        const TMPL_TABS = [{ k:"phrase", l:"定型文" }, { k:"qset", l:"質問集" }, { k:"dates", l:"📅 候補日" }];
        const tmplIdx = TMPL_TABS.findIndex(t => t.k === tmplTab);
        return (
        <div onClick={()=>setTmplOpen(false)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:"18px 18px 0 0", padding:"18px 18px 24px", maxWidth:600, width:"100%", maxHeight:"70vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            {isWorkerSide ? (
              /* 働き手側：定型文のみ（質問集は農家の機能） */
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                  <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>定型文</p>
                  <button onClick={()=>setTmplOpen(false)} aria-label="閉じる" style={{ width:34, height:34, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer" }}>✕</button>
                </div>
                {phrasePanel}
              </>
            ) : (
              /* 農家側：定型文／質問集のタブ＋スワイプ */
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                  <div style={{ display:"flex", gap:6 }}>
                    {TMPL_TABS.map(t => (
                      <button key={t.k} onClick={()=>setTmplTab(t.k)} className="f-sans" style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 2px 8px", fontSize:15, fontWeight: tmplTab===t.k ? 800 : 600, color: tmplTab===t.k ? "#00A86B" : "#999", borderBottom: tmplTab===t.k ? "2px solid #00A86B" : "2px solid transparent" }}>{t.l}</button>
                    ))}
                  </div>
                  <button onClick={()=>setTmplOpen(false)} aria-label="閉じる" style={{ width:34, height:34, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:15, cursor:"pointer" }}>✕</button>
                </div>
                <div style={{ overflow:"hidden" }}
                  onTouchStart={e=>{ tmplSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                  onTouchEnd={e=>{ const s = tmplSwipe.current; tmplSwipe.current = null; if (!s) return; const dx = e.changedTouches[0].clientX - s.x; const dy = e.changedTouches[0].clientY - s.y; if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return; const ni = dx < 0 ? Math.min(tmplIdx + 1, TMPL_TABS.length - 1) : Math.max(tmplIdx - 1, 0); setTmplTab(TMPL_TABS[ni].k); }}>
                  <div style={{ display:"flex", width:"300%", transform: `translateX(-${tmplIdx * (100/3)}%)`, transition:"transform .25s ease" }}>
                    <div style={{ width:"33.3333%", flexShrink:0, boxSizing:"border-box", paddingRight:4 }}>{phrasePanel}</div>
                    <div style={{ width:"33.3333%", flexShrink:0, boxSizing:"border-box", padding:"0 4px" }}>{qsetPanel}</div>
                    <div style={{ width:"33.3333%", flexShrink:0, boxSizing:"border-box", paddingLeft:4 }}>{datesPanel}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
