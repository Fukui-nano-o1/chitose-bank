// 相手の顔を出すプレビュー（働き手・雇い手）。第2次構造改革2026-08-17でApp.jsxから移設。
// ★開くのは lib/previewBus のイベント経由（openWorkerPreview / openEmployerPreview）＝
//   どの画面からも同じ窓口で開く。表示してよい項目の正は components/TrustCards。
// 器＝白い全画面テイクオーバー（2026-08-31たきと指示「アイコンタップで白いテイクオーバーに遷移。
// ボックス展開はやめよう。Airbnbをパクれ」）：Airbnbのプロフィール画面と同じ型＝アプリの上に
// 白い全画面が乗り、左上の✕でとじる・中身は縦スクロール。URLは変えない。
// 評価・記録の全画面（FinalReviewSheet・2026-08-31）と同じ器の作法。
// ★外タップで閉じる黒幕は無くなったので、出口は✕（全画面には「外」thatない＝✕全廃規約の例外）。
// 名乗り（2026-08-24・報復防止）はヘッダーに常設＝スクロールしても面を替えても消えない。
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { isAdmin, ROLE_GREEN, ROLE_ORANGE, farmIntroTopics, farmHostQa, perkBadges, workerQaItems } from "../../lib/utils";
import { getCache, setCache, clearCache } from "../../lib/viewCache";
import { openWorkerPreview, openEmployerPreview } from "../../lib/previewBus";
import { Avatar, Dots, QaChat, SwipeTabPages } from "../../components/ui";
import { WorkerTrustCard, FarmerTrustCard } from "../../components/TrustCards";
import { WorkerWorkRecord } from "../../components/WorkerWorkRecord";
import { FarmerRecord } from "../../components/FarmerRecord";
import { ReceivedReviews } from "../../components/ReceivedReviews";
import { MyReviewsOfWorker } from "../../components/MyReviewsOfWorker";
import { NavIcon, NavIconInline } from "../../components/NavIcons";

// 白い全画面の器（両プレビュー共用）：左上✕＋名乗り（常設）＋縦スクロールの中身。
// 名乗り（2026-08-24たきと指示「プレビューにはアイコンと名称の明記を。報復防止のため」）は
// ヘッダーに置く＝面を切り替えても・スクロールしても常に見える。色は役割色（働き手=橙／農家=緑）。
// ✕はFinalReviewSheetのheaderBtnと同じ36pxの丸（器の見た目を枝分かれさせない）
function PreviewTakeover({ onClose, url, name, accent, children }) {
  return (
    <div className="cb-preview-overlay" style={{ position:"fixed", inset:0, zIndex:9700, background:"#fff", display:"flex", flexDirection:"column", animation:"fadeIn .18s ease" }}>
      <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:12, padding:"calc(10px + env(safe-area-inset-top, 0px)) 16px 10px", borderBottom:"1px solid #F0F0F0" }}>
        <button onClick={onClose} aria-label="とじる" className="f-sans" style={{ width:36, height:36, borderRadius:"50%", border:"1px solid #EBEBEB", background:"#fff", color:"#222", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0, flexShrink:0 }}><NavIcon name="close" size={16} /></button>
        <Avatar url={url} name={name || "？"} size={32} ring={accent} />
        <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", margin:0, minWidth:0, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name || "名前未設定"}</p>
      </div>
      <div style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 24px calc(24px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>{children}</div>
      </div>
    </div>
  );
}

export function EmployerPreviewSheet() {
  const [st, setSt] = useState(null); // {farmer_id, loading, profile, trust}
  // ボックスは3枚（0=プロフィール／1=記録／2=評価）。横スワイプで行き来する。
  // ★働き手プレビュー（下）と同じ構造・同じタブ名（2026-08-24たきと指示「農家プレビューも
  //   働き手プレビューと同じ構造に」）＝面の分け方も送り方も役割で枝分かれしない
  const [page, setPage] = useState(0);
  useEffect(() => {
    const f = (e) => {
      const farmerId = e.detail;
      if (!farmerId) return;
      setPage(0); // 開くたび1枚目から
      // 段階表示（2026-08-07・働き手プレビューと同じ3段）：段階0＝前回のプレビュー即表示（viewCache）／
      // 段階1＝プロフィールが届いた時点で表示／段階2＝実績が届き次第合流（失敗時は上書きしない）
      const cached = getCache("preview:e:" + farmerId);
      if (cached?.profile) setSt({ farmer_id: farmerId, loading: false, profile: cached.profile, trust: cached.trust || null });
      else setSt({ farmer_id: farmerId, loading: true, profile: null, trust: null });
      Promise.resolve(supabase.from("employer_profiles_public").select("auth_id,nickname,avatar_url,owner_comment,pr,intro_path,intro_joy,intro_crops,intro_atmosphere,intro_message,unique_point,always_do,break_style,interaction_style,teaching_style,chat_style,question_style,commitment,has_transport,has_parking,has_commute_allowance,has_bonus,has_raise,has_severance_pay,employer_pays_supplies,accessory_ok,parking_capacity,commute_allowance_detail,transport_area,supplies_cap,insurance_items,created_at").eq("auth_id", farmerId).maybeSingle())
        .then(epRes => {
          // 通信失敗（res.error）では手元の表示（段階0のキャッシュ）を上書きしない＝2026-08-07規則
          if (epRes?.error) { setSt(prev => prev && prev.farmer_id === farmerId ? { ...prev, loading: false } : prev); return; }
          const p = epRes?.data || null;
          setSt(prev => prev && prev.farmer_id === farmerId ? { ...prev, loading: false, profile: p } : prev);
          if (p) setCache("preview:e:" + farmerId, { profile: p, trust: getCache("preview:e:" + farmerId)?.trust || null });
          else clearCache("preview:e:" + farmerId); // 本当に未設定＝キャッシュも消す
        }).catch(() => { setSt(prev => prev && prev.farmer_id === farmerId ? { ...prev, loading: false } : prev); });
      Promise.resolve(supabase.rpc("employer_trust_info", { p_farmer_id: farmerId }))
        .then(trustRes => {
          const t = (trustRes?.data && trustRes.data.ok) ? trustRes.data : null;
          if (!t) return;
          setSt(prev => prev && prev.farmer_id === farmerId ? { ...prev, trust: t } : prev);
          const c = getCache("preview:e:" + farmerId);
          if (c?.profile) setCache("preview:e:" + farmerId, { ...c, trust: t });
        }).catch(() => {});
    };
    window.addEventListener("cb:openEmployerPreview", f);
    return () => window.removeEventListener("cb:openEmployerPreview", f);
  }, []);
  if (!st) return null;
  const topics = st.profile ? farmIntroTopics(st.profile) : [];
  return (
    <PreviewTakeover onClose={()=>setSt(null)} url={st.profile?.avatar_url} name={st.profile?.nickname} accent={ROLE_GREEN}>
        {st.loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
        ) : st.profile ? (
          <>
            <SwipeTabPages tabs={["プロフィール","記録","評価"]} page={page} onPage={setPage}>
              {/* 1枚目：プロフィール＝信頼カード（身元・自己申告のタグ）＋自己紹介の問いかけQ&A。
                  働き手プレビューの1枚目（WorkerTrustCard＋QaChat）と同じ組み立て（2026-08-24たきと指示）。
                  数字（受け入れ・公開中・実績）は hideStats で出さない＝2枚目の記録が持つ */}
              <div>
                <FarmerTrustCard profile={st.profile} trust={st.trust} extraBadges={perkBadges(st.profile)} hideQa hideStats />
                {(() => {
                  const qaAll = [...farmHostQa(st.profile), ...topics.map(t => ({ q: t.label, a: t.body }))];
                  return qaAll.length > 0
                    ? <QaChat items={qaAll} accent={ROLE_GREEN} />
                    : <p className="f-sans" style={{ textAlign:"center", color:"#B0B0B0", fontSize:12, padding:"16px 0 0", margin:0 }}>まだ自己紹介はありません</p>;
                })()}
              </div>
              {/* 2枚目：記録＝受け入れの数字＋公開中／終了した求人のカード（2026-08-31・Airbnbの型）。
                  働き手の「はたらいた記録」と対の面。カードのタップ＝この全画面を閉じてから求人ページへ
                  （開いたままだと遷移先が白幕の下に隠れる）。戻り先はいまのURL（cb_jobBackToの既存の作法） */}
              <div>
                <FarmerRecord trust={st.trust} profile={st.profile} farmerId={st.farmer_id}
                  onOpenJob={(jn) => {
                    try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "") || "/search"); } catch { /* 保存できなくても遷移は続ける */ }
                    setSt(null);
                    window.location.hash = "/work/job/" + jn;
                  }} />
              </div>
              {/* 3枚目：受け取った評価（利用規約 第8条・働き手→農家の肯定評価。DBのreviews_public_badgesが公開判定）。
                  まだ無い時は「まだ評価はありません」と明記（部品側が担う） */}
              <div>
                <ReceivedReviews userId={st.farmer_id} direction="worker_to_farmer" />
              </div>
            </SwipeTabPages>
          </>
        ) : (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>この農家のプロフィールは未設定です</p>
        )}
    </PreviewTakeover>
  );
}

// ── 働き手プレビューからの通報（2026-08-06たきと指示「プレビューに報告するを2つ」）──
// 求人詳細の「⚑ この求人を報告する」と同じ語彙・同じ視覚文法。保存先は profile_reports（三本目の通報台帳）。
// 選択肢は事実の申告だけを並べる＝運営の主観（評価・おすすめ度）は混ぜない（2026-07-16あっせん回避）。
// ★2ページ（プロフィール／はたらいた記録）の末尾に同じボタンを1つずつ置く。中身は共通で、
//   どちらの面から出したかは source 列に自動で入る＝運営が「何についての報告か」を取り違えない
const PROFILE_REPORT_FIELDS = ["自己紹介", "質問への回答", "自己申告（経験・資格）", "写真・アイコン", "はたらいた記録", "その他"];
const PROFILE_REPORT_ISSUES = ["虚偽・誇大の疑い", "連絡先の直書き・外部誘導", "個人情報・肖像権", "差別的・不快な表現", "なりすましの疑い", "記録の食い違い", "その他"];

// ボタン本体。押すと親が持つモーダルを開くだけ（送信は親の1箇所に集約＝発火点を散らさない）
function ProfileReportButton({ onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="f-sans" style={{ display:"block", width:"100%", marginTop:20, padding:"10px 0", background:"none", border:"none", fontSize:12, color:"#B0B0B0", textDecoration:"underline", cursor:"pointer" }}>
      <NavIconInline name="flag" size={12} style={{ verticalAlign:"-1px" }} />この人を報告する
    </button>
  );
}

export function WorkerPreviewSheet() {
  const [st, setSt] = useState(null); // {worker_id, loading, profile, trust, viewer_id}
  // 通報モーダル：{ source:"profile"|"work_record", field, issue, detail, sending, done }
  const [rep, setRep] = useState(null);
  // ボックスは2枚（0=プロフィール／1=はたらいた記録）。横スワイプで行き来する（2026-08-05たきと指示）
  const [page, setPage] = useState(0);
  useEffect(() => {
    const f = (e) => {
      // detail は従来の worker_id（文字列）と、開始面つきの { workerId, page } の両形を受ける
      //（previewBus.openWorkerPreview の第2引数・2026-08-21。古い呼び出し元は文字列のまま）
      const d = e.detail;
      const workerId = (d && typeof d === "object") ? d.workerId : d;
      if (!workerId) return;
      const startPage = (d && typeof d === "object" && (d.page === 1 || d.page === 2)) ? d.page : 0;
      setPage(startPage); // 開くたびに指定の面から（省略時は1枚目）
      // 段階表示（2026-08-07たきと報告「展開が10秒。優先順位つけて表示させて」）：
      // 従来はプロフィール＋実績RPCの両方が返るまで「読み込み中」＝遅い方（実績のコールドスパイク）が
      // 全体を人質にしていた。3段に分離：
      // 段階0（0往復）＝前回のプレビュー（viewCache・表示専用）があれば即表示→裏で最新化
      // 段階1（1往復目）＝プロフィールが届いた時点で表示（実績を待たない）
      // 段階2＝実績（worker_trust_info）が届き次第あとから合流。失敗時は上書きしない
      const cached = getCache("preview:w:" + workerId);
      if (cached?.profile) setSt({ worker_id: workerId, loading: false, blocked: false, viewer_id: null, profile: cached.profile, trust: cached.trust || null });
      else setSt({ worker_id: workerId, loading: true, profile: null, trust: null });
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession(); // ローカル読み＝往復なし
          const viewer = session?.user || null;
          // 閲覧された回数の計測は廃止（2026-08-19たきと指示「閲覧された回数は削除」）＝
          // 表示が無くなったので数えない。DBの窓口・集計テーブルは記録so残してある
          // 段階1：プロフィール。未承認の自己紹介(pr_pending等)を農家に渡さないため、承認済み列だけ返す
          // RPC経由（2026-08-07）。★このRPCが列を絞る役目は今も現役＝ここは消さない。
          // ★under_review（審査中は本人と運営以外に見せない・2026-07-19）は【いま休眠中】：
          //   承認プロセスの削除（2026-08-14）で pr_pending は保存の瞬間に畳まれ、RPCはこの旗を返さない。
          //   受け皿（下の blocked）を残してあるのは、審査を戻す＝畳むトリガーを外した時に、
          //   壁とその表示が同時に再武装するため。DB側の分岐と対で扱うこと（片方だけ消さない）
          Promise.resolve(supabase.rpc("worker_profile_for_farmer", { p_worker_id: workerId })).then(wpRes => {
            // 通信失敗（res.error）では手元の表示（段階0のキャッシュ）を上書きしない＝2026-08-07規則
            if (wpRes?.error) { setSt(prev => prev && prev.worker_id === workerId ? { ...prev, loading: false } : prev); return; }
            const raw = wpRes?.data || null;
            const blocked = !!(raw && raw.under_review);
            const p = blocked ? null : raw;
            setSt(prev => prev && prev.worker_id === workerId ? { ...prev, loading: false, blocked, viewer_id: viewer?.id || null, profile: blocked ? null : p } : prev);
            if (p && !blocked) setCache("preview:w:" + workerId, { profile: p, trust: getCache("preview:w:" + workerId)?.trust || null });
            else clearCache("preview:w:" + workerId);
          }).catch(() => { setSt(prev => prev && prev.worker_id === workerId ? { ...prev, loading: false } : prev); });
          // 段階2：実績。届き次第合流（res.errorや拒否は上書きしない＝フェイルオープン規則）
          Promise.resolve(supabase.rpc("worker_trust_info", { p_worker_id: workerId })).then(trustRes => {
            const t = (trustRes?.data && trustRes.data.ok) ? trustRes.data : null;
            if (!t) return;
            setSt(prev => prev && prev.worker_id === workerId && !prev.blocked ? { ...prev, trust: t } : prev);
            const c = getCache("preview:w:" + workerId);
            if (c?.profile) setCache("preview:w:" + workerId, { ...c, trust: t });
          }).catch(() => {});
        } catch {
          setSt(prev => prev && prev.worker_id === workerId ? { ...prev, loading: false } : prev);
        }
      })();
    };
    window.addEventListener("cb:openWorkerPreview", f);
    return () => window.removeEventListener("cb:openWorkerPreview", f);
  }, []);

  // 通報の送信（発火点はここ1箇所。2枚のボタンはモーダルを開くだけ）
  const closeSheet = () => { setSt(null); setRep(null); };
  const submitReport = async () => {
    if (!rep || rep.sending || !rep.field || !rep.issue || !st?.worker_id || !st?.viewer_id) return;
    setRep(r => ({ ...r, sending: true }));
    const { error } = await supabase.from("profile_reports").insert({
      target_worker_id: st.worker_id,
      reporter_id: st.viewer_id,
      source: rep.source,
      target_field: rep.field,
      issue_type: rep.issue,
      detail: (rep.detail || "").trim() || null,
    });
    if (error) { setRep(r => ({ ...r, sending: false })); alert("報告の送信に失敗しました：" + error.message); return; }
    setRep(r => ({ ...r, sending: false, done: true }));
    setTimeout(() => setRep(null), 1800);
  };

  // ページャーは共有部品 SwipeTabPages（ui.jsx）に一本化（2026-08-21）。
  // ProfileHubの名刺カード裏面と同じ実装＝送り方・見た目が枝分かれしない

  if (!st) return null;
  // 報告できるのはログイン済みの他人だけ（自分は報告しない＝DB側のCHECK制約と揃える）
  const canReport = !!(st.viewer_id && st.viewer_id !== st.worker_id);
  return (
    <PreviewTakeover onClose={closeSheet} url={st.profile?.avatar_url} name={st.profile?.nickname} accent={ROLE_ORANGE}>
        {st.loading ? (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
        ) : st.profile ? (
          <>
            <SwipeTabPages tabs={["プロフィール","記録","評価"]} page={page} onPage={setPage}>
              {/* 1枚目：プロフィール（従来の中身をそのまま） */}
              <div>
                <WorkerTrustCard profile={st.profile} trust={st.trust} />
                {/* Q&Aはチャットと同じコメント形式（2026-08-06たきと指示）。💪希望する作業の強さも質問要素として合流 */}
                <QaChat items={workerQaItems(st.profile)} />
                <MyReviewsOfWorker workerId={st.worker_id} />
                {canReport && <ProfileReportButton onOpen={()=>setRep({ source:"profile", field:"", issue:"", detail:"", sending:false, done:false })} />}
              </div>
              {/* 2枚目：はたらいた記録（働き手ダッシュボードと同じ部品）。
                  並びは プロフィール→記録→評価（2026-08-07たきと指示で評価と入れ替え） */}
              <div>
                <WorkerWorkRecord workerId={st.worker_id} />
                {canReport && <ProfileReportButton onOpen={()=>setRep({ source:"work_record", field:"", issue:"", detail:"", sending:false, done:false })} />}
              </div>
              {/* 3枚目：受け取った評価（利用規約 第8条・肯定バッジ＋公開コメント。DBのreviews_public_badgesが公開判定）。
                  まだ無い時は「まだ評価はありません」と明記（2026-08-24たきと指示・部品側が担う） */}
              <div>
                <ReceivedReviews userId={st.worker_id} direction="farmer_to_worker" />
              </div>
            </SwipeTabPages>
          </>
        ) : st.blocked ? (
          /* 休眠中の受け皿（審査を戻した時に再武装する。上の段階1のコメントと対）。
             いまは worker_profile_for_farmer が under_review を返さないので描画されない */
          <div style={{ textAlign:"center", padding:"32px 0" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>⏳</div>
            <p className="f-sans" style={{ fontSize:14, fontWeight:700, color:"#222", margin:"0 0 6px" }}>プロフィールは審査中です</p>
            <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.7, margin:0 }}>運営の確認が終わると表示されます。</p>
          </div>
        ) : (
          <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>この方のプロフィールは未設定です</p>
        )}

      {/* 通報モーダル：求人の通報（JobSearchMapView）と同じ視覚文法・語彙。2枚のボタンの共通の行き先。
          全画面の上に重ねる小さなボックスのまま（送信の一拍＝これは「外」のある確認so外タップは閉じない仕様を維持） */}
      {rep && (
        <div className="cb-lock-scroll" onClick={e=>e.stopPropagation()} style={{ position:"fixed", inset:0, zIndex:9800, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:400, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            {rep.done ? (
              <p className="f-sans" style={{ fontSize:14, color:"#00A86B", fontWeight:700, textAlign:"center", padding:"20px 0", margin:0 }}>報告を受け付けました。運営が確認します</p>
            ) : (
              <>
                <p className="f-sans" style={{ fontSize:15, fontWeight:700, color:"#222", marginBottom:4 }}>この人を報告する</p>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", margin:"0 0 12px" }}>{rep.source === "work_record" ? "はたらいた記録の面から" : "プロフィールの面から"}</p>
                <div style={{ display:"grid", gap:8, marginBottom:8 }}>
                  <select value={rep.field} onChange={e=>setRep(r=>({ ...r, field:e.target.value }))} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">対象項目を選択</option>
                    {PROFILE_REPORT_FIELDS.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={rep.issue} onChange={e=>setRep(r=>({ ...r, issue:e.target.value }))} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:13, fontFamily:"inherit", background:"#fff", boxSizing:"border-box" }}>
                    <option value="">問題の種類を選択</option>
                    {PROFILE_REPORT_ISSUES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <textarea value={rep.detail} onChange={e=>setRep(r=>({ ...r, detail:e.target.value }))} placeholder="詳細（任意）" rows={4} className="f-sans" style={{ width:"100%", border:"1px solid #EBEBEB", borderRadius:8, padding:"8px 10px", fontSize:16, fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }} />
                </div>
                <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.6, marginBottom:16 }}>報告は運営のみが確認します。相手にはあなたの情報は伝わりません</p>
                <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                  <button onClick={()=>setRep(null)} className="f-sans" style={{ padding:"9px 18px", fontSize:13, background:"#fff", color:"#717171", border:"1px solid #EBEBEB", borderRadius:10, cursor:"pointer" }}>キャンセル</button>
                  <button onClick={submitReport} disabled={rep.sending || !rep.field || !rep.issue} className="f-sans" style={{ padding:"9px 18px", fontSize:13, fontWeight:700, background: (rep.field && rep.issue) ? "#E24B4A" : "#EBEBEB", color: (rep.field && rep.issue) ? "#fff" : "#717171", border:"none", borderRadius:10, cursor:"pointer" }}>{rep.sending ? <>送信中<Dots /></> : "送信する"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PreviewTakeover>
  );
}
