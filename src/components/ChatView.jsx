// チャット（分割・大物②＝最終ピース・2026-07-24）：LINE式スレッド。求人コンテキストカード・確認カード・
// 日程案シート・既読・コメント報告・採用/二重予約警告・保険状態まで内蔵する最大の対話部品。
import { useState, useEffect, useRef, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { fetchJobRowForMe, fetchJobRowsForMe } from "../lib/jobForMe";
import { mapJobPublicRow, payLabel, disp, calFmtDate, daysBetweenYmd, EMPTY_MARK, ROLE_ORANGE,
  CHAT_ELIGIBLE_STATUSES, appPhaseKey, APP_PHASE_LABEL, APP_PHASE_COLOR, appPhaseLabelNow, appPhaseColorNow, photoThumb,
  payTermsLine, WAGE_CLOSING_RULE_LABELS, PAY_TERMS_UNKNOWN } from "../lib/utils";
import { useSheetDragClose } from "../lib/sheetDrag";
import { openEmployerPreview, openWorkerPreview, openPhaseInfo } from "../lib/previewBus";
import { closeReadNotifications } from "../lib/push";
import { chatCache, hydrateChatCache } from "../lib/chatCache";
import { readChatBody, writeChatBody } from "../lib/chatBodyCache";
import { snapGet, snapSet } from "../lib/snapshot";
import { Avatar, Dots } from "./ui";
import ContractPartyName from "./ContractPartyName";
import { NavIcon, NavIconInline } from "./NavIcons";
export function ChatView({ applicationId, onBack }) {
  const [msgs, setMsgs] = useState([]);
  const [msgsLoading, setMsgsLoading] = useState(true); // 初回・スレッド切替の読み込み中（仮配置の表示に使う）
  // 前回の会話の先出し（2026-08-26 Speed-4B）。暗号化した直近30件を端末から復号して即描画し、
  // 裏で走るサーバー取得が届いたら静かに置き換える（stale-while-revalidate）。
  // ★表示専用＝送信権限・採用・契約・既読の正はすべて従来どおりサーバー側が決める
  const cacheReqRef = useRef(0);            // スレッドを切り替えた後に古い復号結果が届いても捨てる
  const restoredFromCacheRef = useRef(false); // いま画面に出ているのが控えか（サーバー結果で置き換える時の目印）
  const pinBottomRef = useRef(false);         // 控え→本物の置き換えで、最下部に貼り直す
  const msgScrollRef = useRef(null); // メッセージ欄のスクロール容器（最新へ自動スクロール・LINE式・2026-07-19）
  const nearBottomRef = useRef(true); // 利用者が下端の近く(80px以内)にいるか。onScrollで更新・自動スクロールの条件（2026-08-07）
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // 入力欄の自動伸縮（改行対応・2026-08-16たきと指示）：中身の行数に合わせて高さを変える。
  // 上限132px（≒6行）を超えたら内側スクロール＝入力欄が画面を埋め尽くさない。
  // 日程案の挿入・送信後のクリアでもtextが変わるので、この1箇所で高さが追従する
  const inputRef = useRef(null);
  const CHAT_INPUT_MAX_H = 132;
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto"; // 縮む方向にも効かせるため、測る前に一度リセットする
    el.style.height = Math.min(el.scrollHeight, CHAT_INPUT_MAX_H) + "px";
  }, [text]);
  const [myId, setMyId] = useState(null);
  const myIdRef = useRef(null); // 購読のクロージャが凍結しないよう、今の自分のidをrefでも持つ
  useEffect(() => { myIdRef.current = myId; }, [myId]);
  // 段階表示の先出し（2026-08-07たきと指示「はじめは最低限の要素のみ表示。段階的に表示させていく」）：
  // 一覧キャッシュ（viewCache永続＝アプリ再起動後も残る骨・本文なし）に開いた応募の行があれば、
  // 相手名・#N・段階・採用済みフラグ・役割を0往復で先出しする。本物の取得（applyActive）が後から上書き。
  // ★表示専用（採用等の実行は従来どおりサーバーのRPC・RLSが正）。initializerは初回マウントのみ＝
  //   スレッド切替時は既存のlocalRow/applyActiveのレールが同じ役目を担う
  const _cr = hydrateChatCache()?.rows?.find(x => x.id === applicationId) || null;
  // { nickname, avatar_url }。一覧から来た時はchatCacheの相手名で即描画し、本物の取得で上書き
  // （2026-08-07たきと指示「アイコンの写真は後でいい。すぐに復元しろ」＝名前を待たせない。画像は<img>ので届き次第出る）
  const [partner, setPartner] = useState(() =>
    (_cr && _cr.partnerName) ? { nickname: _cr.partnerName, avatar_url: _cr.partnerAvatar || "" } : null);
  const [partnerInitials, setPartnerInitials] = useState(""); // ニックネーム未設定時のアイコン用・メール頭文字2文字（2026-07-22）
  const [partnerWorkerId, setPartnerWorkerId] = useState(() => _cr && _cr._role === "farmer" ? _cr.worker_id : null); // 相手が働き手ならそのauth_id（アイコンタップでプレビュー・2026-07-19）
  const [partnerFarmerId, setPartnerFarmerId] = useState(() => _cr && _cr._role === "worker" ? _cr.farmer_id : null); // 相手が農家ならそのauth_id（アイコンタップで雇い手プレビュー・2026-07-19）
  // はじめる前の確認カード（⑦）
  const [confirmJob, setConfirmJob] = useState(null); // mapJobPublicRowで整形した求人情報
  const [chatJobNumber, setChatJobNumber] = useState(() => _cr?.job_number ?? null); // ヘッダー・確認カードの#N表示用（jobs_publicから消えた求人でも出す）
  const [confirmMeetingPlace, setConfirmMeetingPlace] = useState(null);
  const [workerConfirmed, setWorkerConfirmed] = useState(() => !!_cr?.terms_confirmed_worker_at);
  const [insurancePreparedAt, setInsurancePreparedAt] = useState(() => _cr?.insurance_prepared_at ?? null);
  const [isWorkerSide, setIsWorkerSide] = useState(() => _cr?._role === "worker");
  const [confirmingTerms, setConfirmingTerms] = useState(false);
  const [confirmStep, setConfirmStep] = useState(0); // はじめる前の確認：1項目ずつ「はい」で進む分割式（2026-07-18）
  const [confirmBoxOpen, setConfirmBoxOpen] = useState(false); // 求人内容確認をボックス展開（2026-07-19）
  // ＋シート（2026-07-22・第8弾）：入力欄横の＋で開く。定型文は削除（2026-08-19たきと指示）ので
  // 中身は【📅日程案】の1枚＝農家の機能。働き手側には＋を出さない
  const [tmplOpen, setTmplOpen] = useState(false);
  // 下スワイプで閉じる（指に連動・応募者ページのボックスと同じ規則・2026-08-19）
  const tmplSheetRef = useRef(null), tmplScrollRef = useRef(null);
  useSheetDragClose(tmplSheetRef, tmplScrollRef, ()=>setTmplOpen(false), tmplOpen);
  const [dateSel, setDateSel] = useState([]); // ＋シート「日程案を送る」で選択中の日（農家→働き手・2026-07-24）
  // 日程案の承認（2026-08-19たきと指示「提案した日程案はタブ化。働き手はタップしたタブを承認する形。
  // タップするたびにメッセージ入力に入力されていく。送信ボタンタップで最終確認」）：
  // 農家が送った【日程案】のメッセージを、本文の下にタブ（日付のチップ）として描き直す。
  // 働き手がタップすると、その日が入力欄の返事の文に積まれていく（もう一度タップで外れる）。
  // ★記録は増やさない＝ここで作るのは返事の文章だけ。働く日の確定は従来どおり
  //   農家の「働く日を決める」（set_agreed_dates）が唯一の記録（表示は記録から導出の原則）
  const [planSel, setPlanSel] = useState(null); // { msgId, labels:[...] } タップ中の日
  const planBaseRef = useRef("");               // 選び始めた時点の入力＝打ちかけの文を壊さない
  const [planConfirm, setPlanConfirm] = useState(null); // 送信前の最終確認 { body, labels }
  const [planBusy, setPlanBusy] = useState(false);       // 承認の記録中（送信ボタンの二度押し防止）
  // 【日程案】の本文から日付のラベルだけを取り出す（送った時と同じ「・」区切り）
  const parsePlanLabels = (body) => {
    if (!body || !body.startsWith("【日程案】")) return null;
    const head = body.slice("【日程案】".length).split(" に来ていただきたいです")[0];
    const labels = head.split("・").map(x => x.trim()).filter(Boolean);
    return labels.length ? labels : null;
  };
  const planReplyText = (labels) =>
    // 「伺います」は目上を訪ねる時の言い方（2026-08-19たきと指摘「仕事しに行くのに伺います？」）。
    // 働き手は仕事をしに行くのであって、へりくだって訪問するのではない＝当事者どうし対等の言葉にする。
    // 「行けます」は available_dates（来られる日＝行ける日の申告）とも意味が揃う（確定は農家の採用）
    labels.length ? "【日程の承認】" + labels.join("・") + " に行けます。よろしくお願いします。" : "";
  // 入力欄から、この仕組みが作った承認文だけを取り除く（打ちかけの本文は残す）
  const stripPlanReply = (t) => String(t || "").split("【日程の承認】")[0].replace(/\s*$/, "");
  // タブのタップ：選び直すたびに、打ちかけの文の後ろの返事だけを作り替える
  const togglePlanDay = (msgId, label) => {
    const cur = (planSel && planSel.msgId === msgId) ? planSel.labels : [];
    // このメッセージのタブを触り始めた時点の入力を土台にする（打ちかけの文を壊さない）
    // 土台＝打ちかけの文。★前に作った承認文（【日程の承認】以降）は必ず落とす
    //   （2026-08-19たきと報告：古い日程案→新しい日程案の順にタップすると承認文が二重に積まれた）
    if (!planSel || planSel.msgId !== msgId) planBaseRef.current = stripPlanReply(text);
    const next = cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label];
    const base = planBaseRef.current;
    setPlanSel(next.length ? { msgId, labels: next } : null);
    setText(next.length ? (base ? base + " " : "") + planReplyText(next) : base);
  };
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
      const { data } = await fetchJobRowForMe(jobNumber);
      setJobBox({ loading: false, job_number: jobNumber, job: data ? mapJobPublicRow(data) : null });
    } catch { setJobBox({ loading: false, job_number: jobNumber, job: null }); }
  };
  const [activeAppId, setActiveAppId] = useState(applicationId);
  const [activeStatus, setActiveStatus] = useState(() => _cr?.status ?? null); // 現役応募のステータス（applied=農家に承認/見送るボタン表示・2026-07-19）
  const [activeAvail, setActiveAvail] = useState(() => _cr?.available_dates ?? null); // 現役応募の来られる日（期間求人・文脈カードで表示・2026-07-24）
  const [activeAgreed, setActiveAgreed] = useState(() => _cr?.agreed_dates ?? null); // 現役応募の働く日（確定・文脈カード/確認カードで表示・2026-07-24 追記3）
  const [threadApps, setThreadApps] = useState([]); // この相手との全応募（求人No.の仕分け用・2026-07-22）。相手は1人でも求人は複数ありうる
  // 求人No.帯の段階チップを「いま」で出すための日程（2026-08-19たきと指示）：作業日でない日は
  // 「作業中」でなく「次は M/D(曜)」。{ job_number: {work_time,date_start,date_end,holidays} }。
  // 本文の表示より後に取る（段階表示の原則＝最初は最低限）。届くまでは従来どおり段階名が出る
  const [jobSchedMap, setJobSchedMap] = useState({});
  // 応募行＋求人の日程＝appPhaseLabelNow の材料（応募者ページ・チャット一覧と同じ形）
  const phaseEntry = (r) => ({ ...r, ...(jobSchedMap[r.job_number] || {}) });
  // タブのラベル（8/20(木)）は本文から拾ったものので、保存に使う "YYYY-MM-DD" に戻す。
  // 材料は日程案を作った時と同じ求人の期間（confirmJob ?? jobSchedMap）＝送る側と受ける側で同じ日を指す
  const planYmds = (labels) => {
    const sched = jobSchedMap[chatJobNumber] || {};
    const period = daysBetweenYmd(confirmJob?.dateStartRaw || sched.date_start || "",
                                  confirmJob?.dateEndRaw || sched.date_end || "");
    const byLabel = {};
    period.forEach(d => { const l = calFmtDate(d); if (!(l in byLabel)) byLabel[l] = d; });
    return labels.map(l => byLabel[l]).filter(Boolean);
  };
  // 現役応募を切り替える（状態＝採用/確認カード/保険/#N をその応募に合わせる）。求人ページ取得も行う
  const applyActive = async (row) => {
    if (!row) return;
    setActiveAppId(row.id);
    setActiveStatus(row.status);
    setActiveAvail(row.available_dates ?? null);
    setActiveAgreed(row.agreed_dates ?? null);
    setWorkerConfirmed(!!row.terms_confirmed_worker_at);
    setInsurancePreparedAt(row.insurance_prepared_at);
    setChatJobNumber(row.job_number ?? null);
    setConfirmBoxOpen(false); setConfirmJob(null); setConfirmMeetingPlace(null); // 前の求人の残像を消す
    if (row.job_number) {
      try {
        // 求人情報と集合場所は並列取得（2026-07-27：直列だと切替が体感で遅い）
        const [jobRes, mpRes] = await Promise.all([
          fetchJobRowForMe(row.job_number),
          supabase.rpc('job_meeting_place', { p_job_number: row.job_number }),
        ]);
        if (jobRes.data) setConfirmJob(mapJobPublicRow(jobRes.data));
        if (mpRes.data && mpRes.data.ok) setConfirmMeetingPlace(mpRes.data);
      } catch {}
    }
  };
  const [deciding, setDeciding] = useState(false);
  // 送信直後の楽観表示（まだDBに無い自分の吹き出し）を、再読込で消さないための印
  const msgSigRef = useRef("");
  const readStampRef = useRef(0);
  const load = async (ids) => {
    const scope = ids || appIds || [applicationId];
    try {
      // 自分のidは起動時に取ってある（myId）。毎回 getSession を待たない＝送信・更新の往復を1つ減らす
      let uid = myId;
      if (!uid) { const { data: { session } } = await supabase.auth.getSession(); uid = session?.user?.id || null; }
      if (!uid) return;
      // 本文と「相手の最終既読」は互いに独立so同時に投げる（直列2往復→1往復ぶんの待ちに）
      const [msgRes, prRes] = await Promise.all([
        supabase.from("messages").select("*").in("application_id", scope).order("created_at",{ascending:true}),
        supabase.from("chat_reads").select("last_read_at").in("application_id", scope).neq("reader_id", uid)
          .order("last_read_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const data = msgRes.data;
      if (!msgRes.error) setPartnerReadAt(prRes.data ? prRes.data.last_read_at : null);
      // ★内容が同じなら前の配列を保つ（2026-08-07たきと報告「3〜5秒静止で最下部に自動遷移する」の根治）：
      //   5秒間隔の保険ポーリングが毎回新しい配列でsetMsgsし、下の自動スクロール（[msgs]依存）が
      //   毎回発火して、履歴を読んでいる最中でも数秒ごとに最下部へ引き戻していた。
      //   本文・送信者・時刻は改変不可（履歴保全トリガー）ので、件数と末尾idが同じ＝同一と判定してよい
      // ★送信中の楽観表示（_pending）はまだDBに無いので、届いた一覧の後ろに残す＝
      //   送った吹き出しが再読込で一瞬消える、を防ぐ
      if (data) setMsgs(prev => {
        // 仮の吹き出しは「まだ届いていないもの」だけ残す：同じ送り主・同じ本文が届いていたら落とす
        // （insertの返りを通信の都合で受け取れなかった時に、同じ文が二重に出たままにならない）。
        // 60秒たっても届かない仮の分も落とす＝いつまでも幽霊が残らない
        const pend = prev.filter(m => m._pending
          && !data.some(d => d.id === m.id || (d.sender_id === m.sender_id && d.body === m.body))
          && Date.now() - new Date(m.created_at).getTime() < 60000);
        const next = pend.length ? [...data, ...pend] : data;
        return (prev.length === next.length && (next.length === 0 || prev[prev.length-1].id === next[next.length-1].id)) ? prev : next;
      });
      setMsgsLoading(false); // 取得できた時点で仮配置を畳む（0件なら「まだメッセージはありません」に切り替わる）
      // 中身が変わったか（変わっていない時は後始末の書き込みを省く＝5秒ごとの無駄な往復を減らす）
      // 控えを出していた画面に本物が入った時は、次の描画で最下部へ貼り直す（Speed-4B）。
      // 控えは直近30件なので、サーバーの一覧のほうが長いと上に行が増えて位置がずれるため
      if (data && restoredFromCacheRef.current) { restoredFromCacheRef.current = false; pinBottomRef.current = true; }
      const sig = data ? data.length + ":" + (data.length ? data[data.length-1].id : "") : "";
      const changed = sig !== msgSigRef.current;
      msgSigRef.current = sig;
      // 控えの更新（Speed-4B）：DBから確定取得できた一覧だけ・中身が変わった時だけ書く。
      // 送信中の仮の吹き出し(_pending)は data に入っていないので控えに載らない
      if (data && changed) writeChatBody(applicationId, data);
      // 未読通知（2026-07-17）：チャットを開いた時点で自分宛の未読を既読化し、下部バーのバッジ再計算を通知
      try {
        {
          if ((data || []).some(m => m.sender_id !== uid && !m.read_at)) {
            await supabase.from("messages").update({ read_at: new Date().toISOString() })
              .in("application_id", scope).neq("sender_id", uid).is("read_at", null);
            window.dispatchEvent(new Event("cb:unreadRefresh"));
            // 読んだら、そのスレッドの通知も消す（2026-08-18たきと指示「LINEと同じ設計を」）。
            // 通知はtagがスレッドごとso、この応募の分だけが消えて他のチャットの通知は残る
            closeReadNotifications(scope.map(id => "cb-chat-" + id));
          }
          // 一覧キャッシュの未読も即クリア（既読化と同時＝一覧に戻った時に未読が一瞬残らない・2026-07-22）
          if (chatCache.v && chatCache.v.unreadMap) {
            const um = { ...chatCache.v.unreadMap };
            let changed = false;
            scope.forEach(id => { if (um[id]) { delete um[id]; changed = true; } });
            if (changed) chatCache.v = { ...chatCache.v, unreadMap: um };
          }
          // 既読トラッキング（2026-07-22・第8弾）：自分の最終既読時刻をchat_readsに刻む（相手側で「既読」表示に使われる）。
          // ★毎回は書かない（2026-08-19）：5秒ごとの保険ポーリングで毎回upsertしていたが、
          //   中身が変わっていなければ刻み直す意味が無い。変わった時と、最後の書き込みから60秒たった時だけ。
          //   相手の既読の【読み取り】は上のPromise.allで毎回している＝「既読」表示の即時性は落ちない
          if (changed || Date.now() - readStampRef.current > 60000) {
            readStampRef.current = Date.now();
            const now = new Date().toISOString();
            await supabase.from("chat_reads").upsert(
              scope.map(id => ({ application_id: id, reader_id: uid, last_read_at: now })),
              { onConflict: "application_id,reader_id" }
            );
          }
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
    // ②同じ相手の別応募＝threadAppsに行がある＝相手情報・一覧は取得済みので、
    //   セッション/相手プロフィール/イニシャル/全応募の再取得（4往復）を丸ごと省き、
    //   手元の行でapplyActive→messagesの読込だけ行う（体感が一気に縮む）
    setMsgs([]); setMsgsLoading(true); // 切替＝前の残像を消し、仮配置に戻す
    nearBottomRef.current = true; // 開いた直後・スレッド切替は必ず最下部から（前のスレッドで遡った状態を引き継がない）
    // 前回の会話を端末から先出し（Speed-4B）。ネットワークを待たずにここで始める＝
    // 下のサーバー取得と並列。届くのが遅れてサーバーが先に入っていたら、控えでは上書きしない
    restoredFromCacheRef.current = false;
    const _cacheReq = ++cacheReqRef.current;
    readChatBody(applicationId).then(list => {
      if (cacheReqRef.current !== _cacheReq || !list || !list.length) return;
      setMsgs(prev => { if (prev.length) return prev; restoredFromCacheRef.current = true; return list; });
      setMsgsLoading(false);
    }).catch(() => { /* 読めなければ通常のネットワーク取得のまま */ });
    const localRow = threadApps.find(r => r.id === applicationId);
    if (localRow && myId) {
      setAppIds([applicationId]);
      applyActive(localRow);
      load([applicationId]);
      return;
    }
    (async () => {
      try {
        const { data:{ session } } = await supabase.auth.getSession(); // ローカル読み＝往復なし
        // ★本文の復元を最優先（2026-08-07たきと報告「チャットの復元が遅い」）：
        //   メッセージは applicationId だけで取れる（RLSが当事者に絞る）ので、応募行→相手情報の
        //   取得を待たずに最初の往復で取りに行く。従来は直列3往復目（応募行→相手情報の並列取得→本文）で、
        //   DBのコールドスパイク（数秒/往復）が3回重なると復元が数秒×3になっていた。
        //   相手の名前・アイコン・求人No.帯・文脈カードは後から埋まる（先に会話を出す）
        load([applicationId]);
        if (!session) return;
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
          // 相手プロフィール・イニシャル・全応募は互いに独立ので並列取得（2026-07-27：直列3往復を1往復ぶんに）
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
          // 帯の段階チップ・日程案用の日程（待たない＝本文・状態の表示を遅らせない）
          const schedNums = [...new Set((relRows || []).map(r => r.job_number).filter(Boolean))];
          if (schedNums.length) {
            (async () => {
              try {
                // jobs_public に無い求人（一時非公開・掲載終了・下書きに戻したもの）は
                // fetchJobRowsForMe が当事者用の窓口で補う（2026-08-24）＝応募が生きているのに
                // 日程だけ分からない、を無くす。働き手側でも同じに見える
                const pub = await fetchJobRowsForMe(schedNums, "job_number,work_time,date_start,date_end,holidays");
                if (pub.error) return; // 失敗しても手元の表示を壊さない（2026-08-07規則）
                const map = { ...pub.rows };
                // 求人の持ち主は jobs からも読める（RLS「jobs owner select」）＝窓口が落ちた時の保険
                const rest = schedNums.filter(n => !map[n]);
                if (rest.length) {
                  const own = await supabase.from("jobs").select("job_number,work_time,date_start,date_end,holidays").in("job_number", rest);
                  if (!own.error) (own.data || []).forEach(j => { map[j.job_number] = j; });
                }
                setJobSchedMap(map);
              } catch {}
            })();
          }
          // メッセージ読込は冒頭で発火済み（本文最優先）。ここでは重ねて取らない
          if (active) applyActive(active);
          return;
        }
      } catch {}
    })();
  }, [applicationId]);
  // リアルタイム受信（2026-07-19）：この相手との応募IDへの新着メッセージINSERTを購読し、即時再読込。
  // 配信はRLS準拠（当事者のみ）。loadが既読化と下部バーバッジ再計算(cb:unreadRefresh)も担う。
  // ★自分が送った分は受け流す（2026-08-19）：送信は楽観表示＋insertの返りで完結しているので、
  //   自分のイベントで全件を取り直すのは無駄な往復。相手からの新着だけ取り直す
  useEffect(() => {
    if (!appIds || appIds.length === 0) return;
    // in.(uuid,...)フィルタはRealtimeで不安定なため、確実なeqを応募IDごとに張る（2026-07-27修正）
    let ch = supabase.channel("chat-" + applicationId);
    appIds.forEach(id => {
      ch = ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "application_id=eq." + id },
        (payload) => { if (payload?.new?.sender_id && payload.new.sender_id === myIdRef.current) return; load(appIds); });
    });
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [appIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // 復帰時の再読込＋保険ポーリング（2026-07-27たきと指示：チャットのリアルタイム化）：
  // iOS PWAはバックグラウンドでWebSocketが凍結・切断され、復帰後にRealtimeイベントが届かないことがある。
  // 画面復帰（visibilitychange/focus）で即再読込し、開いている間は5秒ごとの保険ポーリング。
  // loadは冪等で既読化・バッジ再計算も担うので多重に呼ばれても安全
  useEffect(() => {
    if (!appIds || appIds.length === 0) return;
    const refresh = () => { if (document.visibilityState === "visible") load(appIds); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const iv = setInterval(refresh, 5000);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); clearInterval(iv); };
  }, [appIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // 最新メッセージへの自動スクロール（LINE式・2026-07-19／2026-08-07たきと指示
  // 「更新はしてほしい。だけど、勝手に遷移させないで」で最終形）：
  //   更新（新着の反映）は常に行う。スクロールで最下部へ動かすのは
  //   ①自分が下端の近くにいる時（会話を追っている＝ついていく）
  //   ②末尾の新着が自分の送信の時（自分の発言は必ず見せる）
  //   の2つだけ。履歴を遡って読んでいる間は、新着が来ても位置を奪わない。
  //   ポーリング・既読化由来の再描画では動かない（setMsgs同一判定と二重の壁）
  const lastMsgIdRef = useRef(null);
  useEffect(() => {
    const last = msgs.length ? msgs[msgs.length - 1].id : null;
    // 末尾が増えていない＝再描画のみ。ただし控え→本物の置き換え（pinBottom）の時だけは貼り直す
    if (last === lastMsgIdRef.current && !pinBottomRef.current) return;
    pinBottomRef.current = false;
    lastMsgIdRef.current = last;
    const el = msgScrollRef.current;
    if (!el) return;
    const mine = msgs.length > 0 && myId && msgs[msgs.length - 1].sender_id === myId;
    if (nearBottomRef.current || mine) el.scrollTop = el.scrollHeight;
  }, [msgs]); // eslint-disable-line react-hooks/exhaustive-deps
  // 働き手の内容確認専用（農家の採用実行は採用するページ #/calendar/todo/hire に一本化・2026-08-06
  // 「器と機能の役割は一つに絞れ」。二重予約の壁はDB側confirm_termsが農家の初回確定時のみ見るので、
  // 働き手の確認呼び出しには掛からない＝受諾フラグ不要）
  const confirmTerms = async () => {
    if (confirmingTerms) return;
    setConfirmingTerms(true);
    const wasWorkerConfirmed = workerConfirmed; // 遷移検知用（今回初めて確認したかどうか）
    try {
      const { data, error } = await supabase.rpc('confirm_terms', { p_application_id: activeAppId });
      if (!error && data && data.ok) {
        setWorkerConfirmed(!!data.worker_confirmed);
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
  // 採用ボックスは削除（2026-08-19たきと指示「チャットの採用するボックス削除」）。
  // 農家の採用の実行窓口は【採用するページ #/calendar/todo/hire】1箇所（2026-08-19一本化）。
  // チャットは会話と記録の場に戻す＝ここから採用は押せない（lib/hire もここでは使わない）。
  // 上の confirmTerms は働き手の内容確認専用ので残す（別の操作）
  // 求人No.帯は「開いた順」に左から並べる（2026-08-06たきと指示「開いた順に並べていって。
  // 使わないチャットは右にずれていくよ」）：開いた求人を先頭に記録し、その順で並べる。
  // 触っていない求人は新しく開いたものに押されて自然に右へ流れる（＝今いる求人が必ず左端）。
  // 記録は表示専用（snapshot＝本人のみ・ログアウトのclearSnapshotsで消える。並びが消えても
  // 下の未記録ぶんの規則に落ちるだけで壊れない）。一度も開いていない求人は従来の応募日順で後ろに続く
  const CHAT_MRU_MAX = 60;
  const [chatMru, setChatMru] = useState(() => { const v = snapGet("chatMru"); return Array.isArray(v) ? v : []; });
  useEffect(() => {
    if (!activeAppId) return;
    setChatMru(prev => {
      const next = [activeAppId, ...prev.filter(id => id !== activeAppId)].slice(0, CHAT_MRU_MAX);
      snapSet("chatMru", next);
      return next;
    });
  }, [activeAppId]);
  const orderedApps = (() => {
    const rank = new Map(chatMru.map((id, i) => [id, i]));
    const opened = threadApps.filter(r => rank.has(r.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    const never = threadApps.filter(r => !rank.has(r.id)); // 未訪問は従来どおり応募日の新しい順で後ろへ
    return [...opened, ...never];
  })();
  // 詰めた先頭が実際に目に入るよう、切り替えのたび帯の横スクロールを左端へ戻す
  // （並びを変えても、器のスクロール位置は前のまま残るため）
  const jobStripRef = useRef(null);
  useEffect(() => { const el = jobStripRef.current; if (el) el.scrollLeft = 0; }, [activeAppId]);
  // ── 横スワイプで求人No.を切り替える（2026-07-30たきと指示「指に連動させてほしい」）──
  // ★スワイプは帯の並び（orderedApps）ではなく threadApps＝応募日順の【動かない並び】を辿る。
  //   帯は開いた順ので、開くたびに並びが変わる＝スワイプをこれに乗せると「今の1件」と「直前の1件」を
  //   往復するだけになり、3件目より奥の求人へ永久に辿り着けなくなるため（左へ引く＝次／右へ引く＝前）。
  //   帯はタップで選ぶ・スワイプは全件を順に送る、と役割を分けている。
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
  // 送信（2026-08-19たきと報告「チャットの送信と更新が遅すぎる」の根治）：
  // 旧＝getSession → insert → load（本文の全取得＋既読化＋chat_reads書き込み＋相手の既読取得）を
  //   1つずつ順番に待っていた＝最大6往復。nanoインスタンスなので1往復数百ms＝送信のたび数秒固まっていた。
  // 新＝①自分の吹き出しを先に出して入力を空にする（楽観表示）②insert は1往復で行の中身まで受け取る
  //   （.select().single()）③load は呼ばない（リアルタイム購読と保険ポーリングが受け持つ）。
  // ★失敗したら楽観表示を取り消し、本文を入力欄に返す＝送ったつもりで消える、を作らない
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const uid = myId;
    if (!uid) return;
    setSending(true);
    const tempId = "temp-" + Date.now();
    setMsgs(prev => [...prev, { id: tempId, application_id: activeAppId, sender_id: uid, body,
      created_at: new Date().toISOString(), read_at: null, _pending: true }]);
    setText(""); setPlanSel(null); setPlanConfirm(null); planBaseRef.current = "";
    try {
      const { data, error } = await supabase.from("messages")
        .insert({ application_id: activeAppId, sender_id: uid, body }).select().single();
      if (error) {
        setMsgs(prev => prev.filter(m => m.id !== tempId));
        setText(prev => prev.trim() ? prev : body);
        alert("送信できませんでした：" + error.message);
      } else if (data) {
        // 本物の行に差し替える（保険ポーリングが先に本物を持ってきていたら、仮の分を落とすだけ）
        setMsgs(prev => prev.some(m => m.id === data.id)
          ? prev.filter(m => m.id !== tempId)
          : prev.map(m => (m.id === tempId ? data : m)));
      }
    } catch (e) {
      setMsgs(prev => prev.filter(m => m.id !== tempId));
      setText(prev => prev.trim() ? prev : body);
      alert("送信できませんでした。通信を確かめて、もう一度お試しください。");
    }
    setSending(false);
  };
  // 送信ボタン：日程の承認を積んでいる時だけ最終確認を挟む（2026-08-19たきと指示）。
  // ふつうのメッセージは従来どおり1タップで送る＝毎回の確認で会話を鈍らせない
  const onSendTap = () => {
    if (!text.trim() || sending) return;
    if (planSel && planSel.labels.length) { setPlanConfirm({ body: text.trim(), labels: planSel.labels }); return; }
    send();
  };
  // 最終確認の「送信する」（2026-08-19たきと承認）：承認した日を先に記録してからメッセージを送る。
  // 記録先は available_dates（働き手自身の申告）＝カレンダーはこの日を斜線（未確定）で描き、
  // 農家が採用した時点でベタ塗り（確定）に変わる。働く日の確定は農家の set_agreed_dates のまま。
  // ★記録に失敗してもメッセージは送る＝相手への連絡（本来の目的）を人手のミスで止めない。
  //   ただし黙って落とさず、記録できなかったことは画面で伝える
  const sendPlanApproval = async () => {
    if (!planConfirm || planBusy || sending) return;
    setPlanBusy(true);
    const ymds = planYmds(planConfirm.labels);
    let saved = ymds.length === planConfirm.labels.length;
    let why = saved ? "" : "日付を求人の期間に照らし合わせられませんでした";
    if (saved) {
      try {
        const { data, error } = await supabase.rpc("set_my_available_dates", { p_application_id: activeAppId, p_dates: ymds });
        saved = !error && !!data?.ok;
        if (!saved) why = data?.message || data?.reason || error?.message || "不明";
      } catch (e) { saved = false; why = e?.message || "不明"; }
    }
    setPlanBusy(false);
    if (!saved) alert("カレンダーへの記録ができませんでした（" + why + "）。メッセージはこのまま送ります。");
    await send();
  };
  // 日程案は最新のものだけ押せる（2026-08-19たきと指示「日程案は最新の方を優先に。
  // 前回の日程案をタップするとバグが発生する」）：古い日程案は履歴として日付は残すが、
  // 押せないタグにする＝どれに返事しているのかが一意になり、承認文が二重に積まれない
  const latestPlanMsgId = (() => {
    let id = null;
    for (const m of msgs) if (m.sender_id !== myId && parsePlanLabels(m.body)) id = m.id;
    return id;
  })();
  // 新しい日程案が届いたら、古い方で選んでいた分は捨てる（古い日付のまま送らない）
  useEffect(() => {
    if (planSel && planSel.msgId !== latestPlanMsgId) { setPlanSel(null); setPlanConfirm(null); }
  }, [latestPlanMsgId]); // eslint-disable-line react-hooks/exhaustive-deps
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
    canceled:  "この応募は取り消されました",
  };
  const chatClosed = !!CHAT_CLOSED_NOTE[activeStatus];
  return (
    <div className="chat-full" style={{ maxWidth:600, marginLeft:"auto", marginRight:"auto", display:"flex", flexDirection:"column" }}>
      {/* 上部フッター（LINE式・2026-07-22）：← / 名前さん / 報告する の1行ヘッダー。求人No.は下の帯へ移動 */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0 10px", borderBottom:"1px solid #EEE" }}>
        <button onClick={onBack} aria-label="戻る" className="f-sans" style={{ background:"none", border:"none", color:"#717171", fontSize:20, cursor:"pointer", padding:"4px 4px", flexShrink:0, lineHeight:1 }}>←</button>
        {partner ? (<>
          <p onClick={()=>{ if (partnerWorkerId) openWorkerPreview(partnerWorkerId); else if (partnerFarmerId) openEmployerPreview(partnerFarmerId); }} className="f-sans" style={{ flex:1, minWidth:0, fontSize:15, fontWeight:700, color:"#222", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }}>{partner.nickname || "名前未設定"}さん</p>
          <button onClick={()=>{ setReportMode(v=>!v); setReportTarget(null); }} className="f-sans" style={{ flexShrink:0, background: reportMode ? "#FDECEC" : "none", border:"1px solid " + (reportMode ? "#E24B4A" : "#EBEBEB"), borderRadius:20, padding:"6px 12px", fontSize:12, fontWeight:600, color: reportMode ? "#E24B4A" : "#717171", cursor:"pointer" }}>{reportMode ? "キャンセル" : <><NavIconInline name="flag" size={12} style={{ verticalAlign:"-1.5px" }} />報告する</>}</button>
        </>) : <span style={{ flex:1 }} />}
      </div>
      {/* 求人No.の帯（横スワイプ）。右端に固定していた採用ボックスは削除（2026-08-19たきと指示） */}
      {chatJobNumber != null && (
        <div style={{ display:"flex", gap:8, alignItems:"stretch", padding:"10px 0 4px" }}>
          {/* 求人No.ボックス群（横スワイプ） */}
          <div ref={jobStripRef} style={{ flex:1, minWidth:0, display:"flex", gap:8, overflowX:"auto", WebkitOverflowScrolling:"touch", overscrollBehaviorX:"contain" }}>
            {orderedApps.map(r => {
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
                  <span style={{ display:"block", fontSize:11, marginTop:2 }}><span onClick={(e)=>{ e.stopPropagation(); openPhaseInfo(appPhaseKey(r)); }} role="button" style={{ color: appPhaseColorNow(r, phaseEntry(r)) || "#999", fontWeight:700, cursor:"pointer" }}>{appPhaseLabelNow(r, phaseEntry(r)) || r.status}</span><span style={{ color:"#999" }}>{isActive ? "・表示中" : "・開く"}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* 契約成立後のみ相手の本名を開示（当事者間・KYC非複製・2026-07-30たきと裁定(B)）。未契約は案内文を出す */}
      {activeAppId && CHAT_ELIGIBLE_STATUSES.includes(activeStatus) && (
        <ContractPartyName applicationId={activeAppId} style={{ padding:"2px 0 0" }} />
      )}
      {/* 相手の緊急連絡先カードはチャットから削除（2026-08-18たきと指示）。
          ★消えたのはチャットの表示だけ＝登録（プロフィールの🆘ボックス）・開示の窓口
          （contract_emergency_contact RPC）・今日ページの緊急連絡シート／応募者シートの
          同カードは従来どおり不変（2026-08-03の裁定＝採用成立後・相手方のみ開示、は生きている） */}
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
            <span style={{ flexShrink:0, color:"#717171" }}><NavIcon name="clipboard" size={20} /></span>
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
          { label:"集合場所", value: confirmMeetingPlace ? disp(confirmMeetingPlace.full_address) : <>取得中<Dots /></>,
            mapUrl: confirmMeetingPlace?.full_address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(confirmMeetingPlace.full_address) : null },
          { label:"持ち物",   value: disp(confirmJob.items) },
          { label:"注意・備考", value: disp(confirmJob.cautions) },
          { label:"報酬",     value: confirmJob.pay ? payLabel(confirmJob) : EMPTY_MARK },
          // 賃金支払条件（2026-08-02）：掲載時にjobsへ確定保存された3列を双方確認の対象に含める。
          // NULL・未知コードは「支払条件を確認できません」（推測表示・現在値フォールバック禁止）
          { label:"賃金締切", value: WAGE_CLOSING_RULE_LABELS[confirmJob.wageClosingRule] || PAY_TERMS_UNKNOWN },
          { label:"支払",     value: payTermsLine(confirmJob).replace(/^支払：/, "") },
          { label:"支払方式", value: confirmJob.fullPayGuarantee ? "⏱ 早く終わっても満額" : EMPTY_MARK },
          // 労働条件の明示・掲載時凍結の3項目（2026-08-21）。値の無い旧求人は「ー」（憶測で埋めない）
          { label:"変更の範囲", value: disp((confirmJob.placeChangeScope || confirmJob.taskChangeScope) ? `場所：${confirmJob.placeChangeScope || "変更なし"}／作業：${confirmJob.taskChangeScope || "変更なし"}` : "") },
          { label:"契約の更新", value: disp(confirmJob.contractRenewal) },
          { label:"労災・雇用保険", value: disp(confirmJob.laborInsuranceStatus) },
          { label:"保険",     value: insurancePreparedAt ? "準備の報告あり" : "まだ報告がありません" },
        ];
        const done = confirmStep >= rows.length;
        return (
          <div className="cb-lock-scroll" onClick={()=>setConfirmBoxOpen(false)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
            <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:18, padding:"20px", maxWidth:420, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
              <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 4px" }}>はじめる前の確認</p>
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 14px" }}>{chatJobNumber != null ? `求人 #${chatJobNumber}　` : ""}{!done ? `${confirmStep + 1} / ${rows.length}` : "内容の確認"}</p>
              {!done ? (
                <div>
                  <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", margin:"0 0 4px" }}>{rows[confirmStep].label}</p>
                  <p className="f-sans" style={{ fontSize:16, color:"#222", fontWeight:700, lineHeight:1.7, margin:"0 0 6px", overflowWrap:"break-word", wordBreak:"break-word" }}>{rows[confirmStep].value}</p>
                  {rows[confirmStep].mapUrl && (
                    <a href={rows[confirmStep].mapUrl} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ display:"inline-block", fontSize:13, fontWeight:700, color:"#00A86B", textDecoration:"underline", marginBottom:6 }}><NavIconInline name="pin" size={13} />Googleマップで開く →</a>
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
                          <a href={row.mapUrl} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ fontSize:13, color:"#00A86B", fontWeight:600, textAlign:"right", overflowWrap:"break-word", wordBreak:"break-word", textDecoration:"underline" }}><NavIconInline name="tick" size={12} style={{ verticalAlign:"-1.5px" }} />{row.value} <NavIconInline name="pin" size={12} style={{ verticalAlign:"-1.5px", marginRight:0, marginLeft:3 }} /></a>
                        ) : (
                          <span className="f-sans" style={{ fontSize:13, color:"#222", fontWeight:600, textAlign:"right", overflowWrap:"break-word", wordBreak:"break-word" }}><NavIconInline name="tick" size={12} style={{ verticalAlign:"-1.5px" }} />{row.value}</span>
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
        onScroll={(e)=>{ const el = e.currentTarget; nearBottomRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80; }}
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
            style={{ alignSelf: m.sender_id===myId ? "flex-end" : "flex-start", maxWidth:"75%", padding:"10px 14px", borderRadius:14, fontSize:14, background: m.sender_id===myId ? "#00A86B" : "#F0F0F0", color: m.sender_id===myId ? "#fff" : "#222", cursor: reportMode ? "pointer" : "default", boxShadow: reportMode ? "0 2px 6px rgba(226,75,74,.35)" : "none", whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word" }} className="f-sans">{m.body}</div>
          {/* 日程案のタブ（2026-08-19たきと指示）：本文の下に日付を並べ直す。
              働き手はタップして承認＝入力欄に返事が積まれる／農家（自分が送った側）は押せないタグ */}
          {(() => {
            const labels = parsePlanLabels(m.body);
            if (!labels) return null;
            const mine = m.sender_id === myId;
            const sel = (planSel && planSel.msgId === m.id) ? planSel.labels : [];
            return (
              /* ★幅を固定する（2026-08-19たきと報告「複数選択すると別の日がタップされる」の根治）：
                 以前は maxWidth:75% の箱に注記も入れていたため、選ぶたびに注記の文が入れ替わり、
                 箱の幅が中身に合わせて変わり、チップが折り返し直されて指の下の日が動いていた。
                 幅を75%固定にし、注記は箱の外へ出す＝チップの位置は選んでも動かない
                 （2026-07-27・2026-08-16と同じ「タップ対象は動かしてはいけない」） */
              <div style={{ alignSelf: mine ? "flex-end" : "flex-start", width:"75%" }}>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:-2, justifyContent: mine ? "flex-end" : "flex-start" }}>
                  {labels.map(l => {
                    if (mine || reportMode || m.id !== latestPlanMsgId) return (
                      <span key={l} className="f-sans" style={{ padding:"7px 11px", fontSize:12, fontWeight:700, borderRadius:20, background:"#F2F2F2", color:"#717171", border:"1px solid #E5E5E5", cursor:"default" }}>{l}</span>
                    );
                    const on = sel.includes(l);
                    return (
                      <button key={l} onClick={()=>togglePlanDay(m.id, l)} className="f-sans"
                        style={{ padding:"7px 11px", fontSize:12, fontWeight:700, borderRadius:20, cursor:"pointer",
                          background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{l}</button>
                    );
                  })}
                </div>
                {/* 注記は箱の外＝チップの折り返しに影響しない。高さも2行ぶんで固定して下の吹き出しも動かさない */}
                {!mine && !reportMode && m.id === latestPlanMsgId && (
                  <p className="f-sans" style={{ fontSize:11, color:"#999", margin:"4px 0 0", lineHeight:1.5, minHeight:33 }}>
                    {sel.length ? "選んだ日が入力欄に入りました。送信ボタンで最終確認します。" : "来られる日をタップすると、返事が入力欄に入ります。"}
                  </p>
                )}
              </div>
            );
          })()}
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
        <div className="cb-lock-scroll" onClick={()=>{ if (!reportSending) { setReportTarget(null); if (reportDone) setReportMode(false); } }} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            {reportDone ? (
              <div style={{ textAlign:"center", padding:"16px 0" }}>
                <div style={{ marginBottom:12, display:"flex", justifyContent:"center", color:"#E24B4A" }}><NavIcon name="flag" size={40} /></div>
                <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 6px" }}>報告を受け付けました</p>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>運営が内容を確認します。コメントは記録として保存されました。</p>
              </div>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 12px" }}><NavIconInline name="flag" size={14} style={{ verticalAlign:"-2px" }} />コメントを報告する</p>
                <div className="f-sans" style={{ background:"#F7F7F7", borderRadius:10, padding:"10px 12px", fontSize:13, color:"#222", lineHeight:1.7, marginBottom:14, whiteSpace:"pre-wrap", overflowWrap:"break-word", wordBreak:"break-word", maxHeight:"20vh", overflowY:"auto" }}>{reportTarget.body}</div>
                <p className="f-sans" style={{ fontSize:12, fontWeight:700, color:"#222", margin:"0 0 8px" }}>このコメントは、どう問題ですか？</p>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
                  {REPORT_REASONS.map(r => (
                    <button key={r} onClick={()=>setReportReason(r)} className="f-sans" style={{ padding:"8px 12px", borderRadius:20, border: reportReason === r ? "2px solid #E24B4A" : "1px solid #EBEBEB", background: reportReason === r ? "#FDECEC" : "#fff", fontSize:12, fontWeight:600, color: reportReason === r ? "#E24B4A" : "#717171", cursor:"pointer" }}>{r}</button>
                  ))}
                </div>
                <textarea value={reportDetail} onChange={e=>setReportDetail(e.target.value)} placeholder="補足があれば（任意）" rows={3} className="field f-sans" style={{ fontSize:13, marginBottom:12, resize:"vertical" }} />
                <button onClick={submitReport} disabled={!reportReason || reportSending} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background:"#E24B4A", color:"#fff", border:"none", borderRadius:12, cursor:"pointer", opacity: (!reportReason || reportSending) ? 0.5 : 1 }}>{reportSending ? <>送信中<Dots /></> : "報告する"}</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 該当求人ボックス（2026-07-19）：「応募された求人を見る →」タップで展開。写真＋主要情報＋詳細ページへのリンク */}
      {jobBox && (
        <div className="cb-lock-scroll" onClick={()=>setJobBox(null)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:16, maxWidth:400, width:"100%", maxHeight:"85vh", overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            {jobBox.loading ? (
              <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"48px 0" }}>読み込み中<Dots /></p>
            ) : jobBox.job ? (
              <>
                {(() => {
                  const p0 = jobBox.job.photos?.[0];
                  const src = photoThumb(p0);
                  return src
                    ? <img loading="lazy" src={src} alt="" style={{ width:"100%", height:170, objectFit:"cover", display:"block", borderRadius:"16px 16px 0 0" }} />
                    : <div style={{ width:"100%", height:170, background:"#F0F0F0", display:"flex", alignItems:"center", justifyContent:"center", color:"#C8C8C8", borderRadius:"16px 16px 0 0" }}><NavIcon name="image" size={48} /></div>;
                })()}
                <div style={{ padding:"14px 18px 18px" }} className="f-sans">
                  <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                    <p style={{ fontSize:16, fontWeight:700, color:"#222", margin:0, flex:1, minWidth:0 }}>{[jobBox.job.crop, jobBox.job.task].filter(Boolean).join(" ") || "求人"}</p>
                    <span style={{ fontSize:11, color:"#C8C8C8", flexShrink:0 }}>#{jobBox.job.id}</span>
                  </div>
                  {jobBox.job.region && <p style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}><NavIconInline name="pin" size={12} />{jobBox.job.region}</p>}
                  {jobBox.job.dateLabel && <p style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}><NavIconInline name="calendar" size={12} style={{ verticalAlign:"-1px" }} />{jobBox.job.dateLabel}{jobBox.job.workTime ? "　" + jobBox.job.workTime : ""}</p>}
                  {jobBox.job.pay > 0 && <p className="f-mono" style={{ fontSize:14, fontWeight:700, color:"#00A86B", margin:"6px 0 0" }}>{jobBox.job.payType === "daily" ? "日給" : "時給"} {jobBox.job.pay.toLocaleString()}円</p>}
                  {jobBox.job.count && <p style={{ fontSize:12, color:"#717171", margin:"4px 0 0" }}><NavIconInline name="applicants" size={12} />募集 {jobBox.job.count}</p>}
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
      /* 入力欄（2026-08-16たきと指示「改行を可能にしてほしい。送信は送信ボタンのみ」）：
         input→textareaに変更＝Enterはそのまま改行になり、送信はボタンだけになる
         （onKeyDownのEnter送信は削除。誤送信も同時に無くなる）。
         高さは中身に合わせて伸ばす＝1行から最大6行（それ以上は内側スクロール）。
         alignItemsをflex-endにして、伸びた時に＋と送信が下端に揃う */
      <div style={{ display:"flex", gap:8, padding:"12px 0", borderTop:"1px solid #EEE", alignItems:"flex-end" }}>
        {/* ＋シート（2026-07-22・第8弾）：📅日程案。農家の機能ので働き手側には出さない
            （定型文・質問集の削除で、働き手にとって中身が無くなったため） */}
        {!isWorkerSide && (
        <button onClick={()=>setTmplOpen(true)} aria-label="日程案" className="f-sans" style={{ flexShrink:0, width:40, height:40, borderRadius:"50%", background:"#F0F7F3", border:"1px solid #DDEDE5", fontSize:20, fontWeight:700, color:"#00A86B", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>＋</button>
        )}
        <textarea ref={inputRef} value={text} rows={1} onChange={e=>setText(e.target.value)}
          placeholder="メッセージを入力" className="field f-sans"
          style={{ flex:1, fontSize:14, resize:"none", lineHeight:1.6, maxHeight:132, overflowY:"auto" }} />
        <button onClick={onSendTap} disabled={sending} className="f-sans" style={{ flexShrink:0, padding:"14px 20px", fontSize:14, fontWeight:600, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", lineHeight:1.4 }}>{sending?"...":"送信"}</button>
      </div>
      )}

      {/* 日程の承認の最終確認（2026-08-19たきと指示「送信ボタンタップで最終確認」）：
          後戻りしにくい返事ので、送る前に日付と本文をそのまま見せる。ボックス外タップで閉じる */}
      {planConfirm && (
        <div className="cb-box-overlay cb-lock-scroll" onClick={()=>{ if (!sending && !planBusy) setPlanConfirm(null); }}
          style={{ position:"fixed", inset:0, zIndex:9500, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ width:"100%", maxWidth:420, maxHeight:"86vh", overflowY:"auto", background:"#fff", borderRadius:18, padding:"20px 18px calc(18px + env(safe-area-inset-bottom, 0px))" }}>
            <p className="f-sans" style={{ fontSize:17, fontWeight:800, color:"#222", textAlign:"center", margin:"0 0 4px" }}>最終確認</p>
            <p className="f-sans" style={{ fontSize:12, color:"#717171", textAlign:"center", margin:"0 0 14px" }}>この日程で返事を送ります</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", marginBottom:12 }}>
              {planConfirm.labels.map(l => (
                <span key={l} className="f-sans" style={{ padding:"8px 12px", fontSize:13, fontWeight:700, borderRadius:20, background:"#E6F7EF", color:"#0B6B4F", border:"1px solid #BFE7D5" }}>{l}</span>
              ))}
            </div>
            <p className="f-sans" style={{ fontSize:13, color:"#555", background:"#F7F7F7", borderRadius:10, padding:"10px 12px", lineHeight:1.8, margin:"0 0 16px", whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>{planConfirm.body}</p>
            <p className="f-sans" style={{ fontSize:11, color:"#999", lineHeight:1.7, margin:"0 0 14px" }}>作業日の確定は農家が行います。この返事は、その相談のためのものです。</p>
            <div style={{ display:"grid", gap:8 }}>
              <button onClick={sendPlanApproval} disabled={sending || planBusy} className="f-sans"
                style={{ padding:"13px", fontSize:15, fontWeight:800, background:"#00A86B", color:"#fff", border:"none", borderRadius:10, cursor:"pointer", opacity: (sending || planBusy) ? 0.5 : 1 }}>{(sending || planBusy) ? <>送信しています<Dots /></> : "送信する"}</button>
              <button onClick={()=>{ if (!sending && !planBusy) setPlanConfirm(null); }} disabled={sending || planBusy} className="f-sans"
                style={{ padding:"11px", fontSize:13, fontWeight:700, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>やめる</button>
            </div>
          </div>
        </div>
      )}

      {/* ＋シート（2026-07-22 第8弾→2026-08-19 定型文を削除→2026-08-17 質問集を削除）：
          いまは📅日程案の1枚＝来てほしい日を選ぶと入力欄に文章が入る。農家の機能ので、このシートは農家側にしか出ない */}
      {tmplOpen && !isWorkerSide && (() => {
        // 日程案を送る（2026-08-19たきと指示「候補日ではなく、日程案に差し替え。農家が来てほしい日を
        // 提案する形」）：期間求人で、農家が来てほしい日を選んで働き手に提案する。選ぶと入力欄に文章が入る。
        // ★ここで作るのは提案の文章だけ＝決めるのは当事者どうし（記録は働く日を決めた時に agreed_dates へ残る）
        const datesPanel = (() => {
          // 日程の出どころは2つ：求人ページの全項目（confirmJob）と、帯の段階チップ用に取った
          // 軽い日程（jobSchedMap・work_time/date_start/date_end/holidays）。前者が未着・
          // 取得できなかった時は後者に落とす＝「日程が取得できませんでした」を出す条件を最後の手段にする
          const sched = jobSchedMap[chatJobNumber] || {};
          const startRaw = confirmJob?.dateStartRaw || sched.date_start || "";
          const endRaw = confirmJob?.dateEndRaw || sched.date_end || "";
          const period = daysBetweenYmd(startRaw, endRaw);
          if (!startRaw) return <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"24px 8px" }}>この求人の日程が取得できませんでした。</p>;
          // 1日だけの募集（2026-08-19たきと指示「1日だけの場合はその日付のタグを設置。タップ不可」）：
          // 提案する日が1つしかない＝選ぶものが無いので、その日付を選べないタグとして出す
          // （buttonにしない＝押せる見た目にしない）
          if (period.length <= 1) return (
            <>
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 12px" }}>この求人は1日だけの募集です。この日に来ていただく形になります。</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                <span className="f-sans" style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, background:"#F2F2F2", color:"#717171", border:"1px solid #E5E5E5", cursor:"default" }}>{calFmtDate(startRaw)}</span>
              </div>
            </>
          );
          return (
            <>
              <p className="f-sans" style={{ fontSize:12, color:"#999", margin:"0 0 12px" }}>来てほしい日を選ぶと、日程案の文章が入力欄に入ります。送信前に編集できます。</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 }}>
                {period.map(d => {
                  const on = dateSel.includes(d);
                  return <button key={d} onClick={()=>setDateSel(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])} className="f-sans" style={{ padding:"9px 12px", fontSize:13, fontWeight:700, borderRadius:20, cursor:"pointer", background: on ? "#00A86B" : "#fff", color: on ? "#fff" : "#444", border:"1px solid " + (on ? "#00A86B" : "#DDD") }}>{calFmtDate(d)}</button>;
                })}
              </div>
              {/* ★ボタンは折り返させない（whiteSpace:nowrap）：シートは下端に固定なので、
                  ラベルが2行になるとシートが上に伸びてチップの位置がずれる＝誤タップの原因になる */}
              <button disabled={dateSel.length===0} onClick={()=>{
                const msg = "【日程案】" + [...dateSel].sort().map(calFmtDate).join("・") + " に来ていただきたいです。ご都合はいかがでしょうか。";
                setText(prev => prev.trim() ? (prev.replace(/\s*$/, "") + " " + msg) : msg);
                setDateSel([]); setTmplOpen(false);
              }} className="f-sans" style={{ width:"100%", padding:"12px", fontSize:14, fontWeight:700, background: dateSel.length===0 ? "#EBEBEB" : "#00A86B", color: dateSel.length===0 ? "#999" : "#fff", border:"none", borderRadius:10, cursor: dateSel.length===0 ? "not-allowed" : "pointer", whiteSpace:"nowrap" }}>日程案を入力欄に入れる{dateSel.length>0 ? `（${dateSel.length}日）` : ""}</button>
            </>
          );
        })();
        return (
        <div className="cb-lock-scroll" onClick={()=>setTmplOpen(false)} style={{ position:"fixed", inset:0, zIndex:9600, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end", justifyContent:"center", animation:"fadeIn .2s ease" }}>
          <div ref={tmplSheetRef} onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:"18px 18px 0 0", padding:"18px 18px 24px", maxWidth:600, width:"100%", maxHeight:"70vh", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            {/* 質問集タブは廃止（2026-08-17たきと指示）＝このシートは📅日程案の1枚ので、タブとスワイプは置かない */}
            <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:"0 0 10px" }}><NavIconInline name="calendar" size={15} />日程案</p>
            {datesPanel}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
