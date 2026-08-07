// システム専用ページ（#/admin/system・管理者専用・2026-08-03たきと指示「システムページを作れ。
// システムタップで遷移。全て横スワイプで切り替えられるように」）：
// 管理タブ「その他＞システム」のポップアップ＋区画表示（SQL／エラー／画像軽量化）を独立ページ化。
// 3面はネイティブ横スクロール＋scroll-snap（指に追従・1スワイプ1面＝WorkerExperienceEntriesSwipeと
// 同じ作法）で切り替え、上部タブのタップでも移動できる。
// 書き込みは従来と同一の2つだけ（エラーの解決済み化・画像ツールの上書き）＝新しい保存機能は無い
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { recompressBucket, generateJobPhotoThumbs } from "../../lib/image";
import { Dots } from "../ui";
import { AdminNav } from "./AdminNav";

// ── 画像一括処理のバックグラウンド実行（2026-08-03たきと指示「一括軽量化は一瞬で終了させろ。
// 何分も画面に張り付かなくてはならない」・AdminTabから移設）：進捗・結果を【モジュールレベル】に
// 置く＝ボタンを押したらすぐ画面を離れてよい。他のタブ・ページへ移動しても処理は裏で続き、
// このページに戻れば進捗や完了結果がここに残っている。
// ※アプリ自体（PWA/ブラウザのタブ）を閉じると中断されるが、両ツールとも冪等so
//   もう一度押せば「残りだけ」処理される（途中まで進んだ分は無駄にならない）
const imgTaskStore = {
  running: "",        // 実行中の軽量化バケット名（"" = なし）
  progress: "",       // "3/12"
  results: {},        // bucket → {candidates, replaced, savedBytes}
  thumbRunning: false,
  thumbProgress: "",
  thumbResult: null,
  listeners: new Set(),
};
const imgTaskNotify = () => imgTaskStore.listeners.forEach(fn => { try { fn(); } catch {} });

// エラーの簡易診断（AdminTabから移設・2026-08-03）。メッセージの型から見出し・修正案・深刻度を導く
function diagnoseError(e) {
  const msg = (e.message || "").toLowerCase();
  if (msg.includes("row-level security")) return { title: "RLSポリシーで拒否", fix: "対象テーブルのRLS policyを確認", severity: "high" };
  if (msg.includes("unique") || msg.includes("duplicate key")) return { title: "重複データ", fix: "既存データを確認し重複を整理", severity: "medium" };
  if (msg.includes("failed to fetch") || msg.includes("network")) return { title: "通信エラー", fix: "ネットワーク接続を確認", severity: "medium" };
  if (msg.includes("cannot read properties of null")) return { title: "未選択データ参照", fix: "保存前にnullチェックを追加", severity: "high" };
  if (msg.includes("auth_id") || msg.includes("null")) return { title: "Auth紐づけ失敗", fix: "farmersのauth_idを確認", severity: "high" };
  return { title: "未分類エラー", fix: "message・component・operationを確認", severity: "unknown" };
}

// 手動SQLの雛形（AdminTabから移設・旧事業データ時代の資料。Supabase SQL Editorで使う）
const NOTIF_SQL = `CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id uuid REFERENCES auth.users(id) NOT NULL,
  type text NOT NULL,
  message text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (auth.uid() = farmer_id)
  WITH CHECK (auth.uid() = farmer_id);
CREATE INDEX idx_notifications_farmer
  ON notifications(farmer_id, created_at DESC);`;

const VARIETY_SQL = `ALTER TABLE records ADD COLUMN IF NOT EXISTS variety text DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS is_brand boolean DEFAULT false;`;

const Card = ({ children, style }) => (
  <div className="ledger-card" style={{ padding:"16px 20px", ...style }}>{children}</div>
);

// 3面の並びの正はここ1箇所（タブとスワイプ面はこの順で対応する）
const PANES = [
  { k:"sql",    l:"SQL" },
  { k:"errors", l:"エラー" },
  { k:"images", l:"画像軽量化" },
];

export function AdminSystemRoom() {
  // ── 横スワイプ機構：ネイティブ横スクロール＝指に追従。snapで必ず1面に着地。タブタップでも移動
  const scrollRef = useRef(null);
  const [pageIdx, setPageIdx] = useState(0);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setPageIdx(Math.max(0, Math.min(PANES.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const goTo = (idx) => { const el = scrollRef.current; if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" }); };
  // ページの器（全幅・snap）。隣面との隙間はpaddingで作る（幅計算を1面=clientWidthに保つ）
  const paneStyle = { flex:"0 0 100%", boxSizing:"border-box", scrollSnapAlign:"start", padding:"0 2px", alignSelf:"flex-start" };

  // ── 画像タスクの購読（ストアはモジュールレベル＝画面を離れても処理は続く）
  const [, imgTick] = useState(0);
  useEffect(() => {
    const fn = () => imgTick(t => t + 1);
    imgTaskStore.listeners.add(fn);
    return () => { imgTaskStore.listeners.delete(fn); };
  }, []);
  const { running: imgOptRunning, progress: imgOptProgress, results: imgOptResults,
          thumbRunning: thumbGenRunning, thumbProgress: thumbGenProgress, thumbResult: thumbGenResult } = imgTaskStore;
  const runThumbGen = () => {
    if (imgTaskStore.thumbRunning || imgTaskStore.running) return;
    if (!window.confirm("サムネの無い求人写真にカード用サムネ（640px）を生成し、jobsのphotosに書き戻します。生成済みは飛ばすので、通常は数秒で終わります。よろしいですか？")) return;
    imgTaskStore.thumbRunning = true; imgTaskStore.thumbProgress = ""; imgTaskNotify();
    // awaitしない＝ボタンは即返す。処理は裏で続き、完了結果はストアに残る
    (async () => {
      const r = await generateJobPhotoThumbs(supabase, { onProgress: (d, t) => { imgTaskStore.thumbProgress = `${d}/${t}`; imgTaskNotify(); } });
      imgTaskStore.thumbRunning = false; imgTaskStore.thumbProgress = ""; imgTaskStore.thumbResult = r; imgTaskNotify();
    })();
  };
  const runRecompress = (bucket, maxSide, quality) => {
    if (imgTaskStore.running) return;
    if (!window.confirm(`${bucket} 内の重い画像（400KB以上）を圧縮して差し替えます。実行中は画面を離れてもかまいません。よろしいですか？`)) return;
    imgTaskStore.running = bucket; imgTaskStore.progress = ""; imgTaskNotify();
    (async () => {
      const r = await recompressBucket(supabase, bucket, { maxSide, quality, onProgress: (d, t) => { imgTaskStore.progress = `${d}/${t}`; imgTaskNotify(); } });
      imgTaskStore.running = ""; imgTaskStore.progress = "";
      imgTaskStore.results = { ...imgTaskStore.results, [bucket]: r };
      imgTaskNotify();
    })();
  };

  // ── エラーログ（app_errors・RLSで管理者のみ読める。null=読み込み中）
  const [appErrors, setAppErrors] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("app_errors").select("*").order("created_at", { ascending: false }).limit(100);
        setAppErrors(data || []);
      } catch { setAppErrors([]); }
    })();
  }, []);

  return (
    <div className="appear cb-admin-page" style={{ maxWidth:640, margin:"0 auto", padding:"20px 16px 120px" }}>
      <AdminNav current="system" />

      {/* タブ（タップでも移動・スワイプ中は現在面から点灯を導出） */}
      <div style={{ display:"flex", borderBottom:"1px solid #EBEBEB", marginBottom:16 }}>
        {PANES.map((p, i) => (
          <button key={p.k} type="button" onClick={() => goTo(i)} className="f-sans"
            style={{ flex:1, padding:"10px 0", background:"none", border:"none",
              borderBottom: pageIdx === i ? "2px solid #222" : "2px solid transparent", marginBottom:-1,
              fontSize:13, fontWeight:700, color: pageIdx === i ? "#222" : "#999", cursor:"pointer" }}>{p.l}</button>
        ))}
      </div>

      <div ref={scrollRef} onScroll={onScroll}
        style={{ display:"flex", alignItems:"flex-start", overflowX:"auto", WebkitOverflowScrolling:"touch",
          scrollSnapType:"x mandatory", overscrollBehaviorX:"contain", touchAction:"pan-x pan-y" }}>

        {/* ── 面1：SQL ── */}
        <div style={paneStyle}>
          <div style={{ display:"grid", gap:16 }}>
            <Card>
              <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:4 }}>records 列追加SQL（品種・ブランド）</p>
              <p className="f-sans" style={{ fontSize:11,color:"#717171",marginBottom:16 }}>Supabase SQL Editorで実行してください。</p>
              <pre style={{
                background:"#F7F7F7",borderRadius:12,padding:16,overflowX:"auto",
                fontFamily:"'DM Mono','Courier New',monospace",fontSize:12,color:"#222",lineHeight:1.7,margin:0,
                border:"1px solid #EBEBEB",whiteSpace:"pre",
              }}>{VARIETY_SQL}</pre>
              <button onClick={()=>navigator.clipboard.writeText(VARIETY_SQL)} style={{
                marginTop:12,padding:"8px 20px",background:"#00A86B",color:"#fff",border:"none",
                borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer",
              }}>SQLをコピー</button>
            </Card>
            <Card>
              <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:4 }}>notifications テーブル作成SQL</p>
              <p className="f-sans" style={{ fontSize:11,color:"#717171",marginBottom:16 }}>Supabase SQL Editorで実行してください。</p>
              <pre style={{
                background:"#F7F7F7",borderRadius:12,padding:16,overflowX:"auto",
                fontFamily:"'DM Mono','Courier New',monospace",fontSize:12,color:"#222",lineHeight:1.7,margin:0,
                border:"1px solid #EBEBEB",whiteSpace:"pre",
              }}>{NOTIF_SQL}</pre>
              <button onClick={()=>navigator.clipboard.writeText(NOTIF_SQL)} style={{
                marginTop:12,padding:"8px 20px",background:"#00A86B",color:"#fff",border:"none",
                borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer",
              }}>SQLをコピー</button>
            </Card>
          </div>
        </div>

        {/* ── 面2：エラー ── */}
        <div style={paneStyle}>
          {appErrors === null ? (
            <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"40px 0" }}>読み込み中<Dots /></p>
          ) : appErrors.length === 0 ? (
            <div style={{ textAlign:"center", padding:"48px 0", color:"#B0B0B0" }}>
              <p className="f-sans" style={{ fontSize:14 }}>エラーは記録されていません</p>
            </div>
          ) : (
            <div style={{ display:"grid", gap:8 }}>
              {appErrors.map(e => {
                const diag = diagnoseError(e);
                return (
                  <div key={e.id} style={{
                    padding:"16px 20px", background:"#fff", border:"1px solid #EBEBEB",
                    borderRadius:12, boxShadow:"0 1px 3px rgba(0,0,0,0.04)",
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <span style={{
                        padding:"2px 8px", borderRadius:8, fontSize:10, fontWeight:700,
                        background: diag.severity === "high" ? "#FCEBEB" : diag.severity === "medium" ? "#FEF3E2" : "#F7F7F7",
                        color: diag.severity === "high" ? "#E24B4A" : diag.severity === "medium" ? "#F5A623" : "#717171",
                      }}>{diag.severity === "high" ? "重大" : diag.severity === "medium" ? "注意" : "不明"}</span>
                      <span className="f-sans" style={{ fontSize:10, color:"#B0B0B0" }}>
                        {new Date(e.created_at).toLocaleString("ja-JP")}
                      </span>
                    </div>
                    <p className="f-sans" style={{ fontSize:13, fontWeight:600, color:"#222", marginBottom:4 }}>{diag.title}</p>
                    <p className="f-mono" style={{ fontSize:11, color:"#717171", marginBottom:8, wordBreak:"break-all" }}>{e.message}</p>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                      {e.component && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{e.component}</span>}
                      {e.action && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{e.action}</span>}
                      {e.operation && <span className="tag" style={{ background:"#F7F7F7", color:"#717171" }}>{e.operation}</span>}
                    </div>
                    <div style={{ padding:"8px 12px", background:"#E6F7EF", borderRadius:8, borderLeft:"3px solid #00A86B" }}>
                      <p className="f-sans" style={{ fontSize:11, color:"#00A86B" }}>修正案: {diag.fix}</p>
                    </div>
                    {e.status === "open" && (
                      <button onClick={async () => {
                        await supabase.from("app_errors").update({ status:"fixed", resolved_at: new Date().toISOString() }).eq("id", e.id);
                        setAppErrors(prev => (prev || []).map(x => x.id === e.id ? { ...x, status:"fixed" } : x));
                      }} style={{
                        marginTop:8, padding:"6px 14px", border:"1px solid #00A86B44", borderRadius:8,
                        background:"transparent", color:"#00A86B", fontSize:11, fontWeight:600, cursor:"pointer",
                      }}>解決済みにする</button>
                    )}
                    {e.status === "fixed" && (
                      <span className="f-sans" style={{ display:"inline-block", marginTop:8, fontSize:11, color:"#00A86B", fontWeight:600 }}>解決済み</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 面3：画像軽量化 ── */}
        <div style={paneStyle}>
          <div style={{ display:"grid", gap:16 }}>
            <Card>
              <p className="f-sans" style={{ fontSize:14,fontWeight:700,color:"#222",marginBottom:4 }}>画像の一括軽量化</p>
              <p className="f-sans" style={{ fontSize:11,color:"#717171",lineHeight:1.8,marginBottom:16 }}>
                圧縮なしで保存された既存の画像（400KB以上）をダウンロード→圧縮→同じ場所に上書きします。
                URLが変わらないため、求人・プロフィール・凍結済み契約の参照はそのまま。
                既に軽い画像・処理済みの画像はスキップ＝何度実行しても安全で、2回目以降はほぼ一瞬で終わります。
                実行は裏で進むため、開始後は画面を離れてかまいません（このページに戻れば進捗と結果が見えます）。
                使い方ガイドのスクショはガイドページ上部の専用ボタンで。
              </p>
              <div style={{ display:"grid", gap:10 }}>
                {[
                  { bucket:"avatars",    label:"アイコン（avatars）",    maxSide:512,  quality:0.8, note:"表示84px級→512pxに縮小" },
                  { bucket:"job-photos", label:"求人写真（job-photos）", maxSide:1600, quality:0.8, note:"圧縮導入(7/16)前の原寸写真を縮小" },
                ].map(b => (
                  <div key={b.bucket} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <button onClick={()=>runRecompress(b.bucket, b.maxSide, b.quality)} disabled={!!imgOptRunning} className="f-sans" style={{ padding:"9px 16px", fontSize:12, fontWeight:700, background: imgOptRunning===b.bucket ? "#EBEBEB" : "#00A86B", color: imgOptRunning===b.bucket ? "#717171" : "#fff", border:"none", borderRadius:10, cursor: imgOptRunning ? "default" : "pointer" }}>
                      {imgOptRunning===b.bucket ? `軽量化中 ${imgOptProgress}…` : b.label}
                    </button>
                    <span className="f-sans" style={{ fontSize:11, color:"#999" }}>
                      {imgOptResults[b.bucket]
                        ? `完了：対象${imgOptResults[b.bucket].candidates}枚中 ${imgOptResults[b.bucket].replaced}枚を差し替え（約${Math.round(imgOptResults[b.bucket].savedBytes/1024/1024*10)/10}MB削減）`
                        : b.note}
                    </span>
                  </div>
                ))}
                {/* カード用サムネの後埋め（2026-08-02・②）：一覧カードは軽量サムネ(thumb)を読む。
                    thumbが無い既存写真（サムネ導入前のアップロード分）へ640pxサムネを生成する */}
                <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                  <button onClick={runThumbGen} disabled={thumbGenRunning || !!imgOptRunning} className="f-sans" style={{ padding:"9px 16px", fontSize:12, fontWeight:700, background: thumbGenRunning ? "#EBEBEB" : "#00A86B", color: thumbGenRunning ? "#717171" : "#fff", border:"none", borderRadius:10, cursor: (thumbGenRunning || imgOptRunning) ? "default" : "pointer" }}>
                    {thumbGenRunning ? `生成中 ${thumbGenProgress}…` : "カード用サムネ生成（job-photos）"}
                  </button>
                  <span className="f-sans" style={{ fontSize:11, color:"#999" }}>
                    {thumbGenResult
                      ? (thumbGenResult.error
                          ? `失敗：${thumbGenResult.error}`
                          : `完了：${thumbGenResult.made}枚生成（生成済みスキップ${thumbGenResult.skipped ?? 0}・失敗${thumbGenResult.failed}・求人${thumbGenResult.updatedJobs}件更新／全${thumbGenResult.total}枚）`)
                      : "サムネ無しの写真だけ後埋め（640px・生成済みは飛ばす＝通常は数秒）"}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>

      </div>
    </div>
  );
}
