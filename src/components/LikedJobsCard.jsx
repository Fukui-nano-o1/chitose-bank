// いいねした求人カード（2026-08-22 たきと指示「マイページのわたしの記録グループにいいねした求人カードを新設」）
// ・マイページ（ProfileHub・働き手ホーム）の「わたしの記録」カテゴリーに並ぶ1枚。
//   カード＝件数＋説明／タップで一覧ボックス／行タップで求人ページへ（労働条件通知書カードと同じ作法）。
// ・データ源はステータスページ(#/saved)と同じ my_job_actions（SECURITY DEFINER・本人のいいね＋応募だけ）。
//   liked=true の行だけをこのカードが使う＝いいねの取得経路を増やさない。
//   キャッシュもステータスページと同じ "saved:rows"（同じRPCの同じ形）を共用＝どちらから開いても互いに温まる。
// ・★読み取り専用：♥解除・いいね追加はここには置かない。実行の窓口は従来どおり
//   求人ページ・ステータスページの♥だけ（実行窓口を増やさない＝2026-08-07採用一本化と同じ考え方）。
// ・取得の規則（SavedJobsViewと同じ・2026-08-07フェイルオープン規則）：
//   ①res.errorを見る・失敗時は手元の値もキャッシュも上書きしない
//   ②my_job_actions は auth.uid() が無いと【200で空配列】を返すので、空配列はセッションを確かめてから信じる
// ・行はJSON安全な型のみ（RPCの返りは日付も文字列）＝viewCacheに入れてよい（2026-08-03の規則）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { getCache, setCache } from "../lib/viewCache";
import { photoThumb, dateRangeLabel, ROLE_ORANGE } from "../lib/utils";

const likedOf = (list) => (Array.isArray(list) ? list.filter(r => r.liked) : null);

export function LikedJobsCard({ me }) {
  // 前回の内容（ステータスページと共用のキャッシュ）が残っていればまず出す→裏で最新に差し替える
  const [rows, setRows] = useState(() => likedOf(getCache("saved:rows"))); // null=読み込み中
  const [listOpen, setListOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false); // 説明は？ボタンで展開（労働条件通知書と同じ作法）

  useEffect(() => {
    if (!me?.id) return;
    let live = true;
    (async () => {
      let res;
      try { res = await supabase.rpc("my_job_actions"); }
      catch (e) { res = { data: null, error: e }; }
      if (!live) return;
      let list = res?.error ? null : res?.data;
      if (Array.isArray(list) && list.length === 0) { // ②空配列の正体を確かめる（トークン未確立の0件を信じない）
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!live) return;
          if (!session) list = null;
        } catch { list = null; }
      }
      if (!Array.isArray(list)) return; // ①失敗時は手元の値（キャッシュ）のまま
      setCache("saved:rows", list); // 全体をステータスページと同じ形で保存（形を変えない）
      setRows(likedOf(list));
    })();
    return () => { live = false; };
  }, [me?.id]);

  const count = rows ? rows.length : 0;

  // 求人ページへ（戻り先＝いまのマイページ。WorkerApplicationsの求人リンクと同じ作法）
  const openJob = (r) => {
    setListOpen(false); // ポータルごとアンマウントされる前に閉じておく（cb-lock-scrollの残骸を作らない）
    try { sessionStorage.setItem("cb_jobBackTo", window.location.hash.replace(/^#/, "")); } catch {}
    window.location.hash = "/work/job/" + r.job_number;
  };

  return (
    <>
      {/* 「わたしの記録」カテゴリーの中に並ぶ1枚＝専用の見出しは持たない。
          件数0でもカードは出す（タップ不能・非表示にしない＝2026-08-03の原則。中で説明を出す） */}
      <button type="button" onClick={() => setListOpen(true)} className="f-sans" style={{ width:"100%", marginTop:12, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"18px 16px", cursor:"pointer", display:"block", textAlign:"left", boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>
        <span className="f-sans" style={{ display:"block", fontSize:16, fontWeight:800, color:"#222" }}><span aria-hidden="true" style={{ color:"#E24B4A" }}>♥</span> いいねした求人</span>
        <span className="f-sans" style={{ display:"block", fontSize:13, color:"#717171", marginTop:4, lineHeight:1.6 }}>
          {rows === null ? "読み込み中…" : count > 0 ? `${count}件　気になる求人の一覧です。タップで見返せます` : "気になる求人を♥しておくと、ここに並びます"}
        </span>
      </button>

      {/* 一覧ボックス（労働条件通知書の一覧と同じ規格：中央・上下40px余白・外タップで閉じる・✕なし） */}
      {listOpen && createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget) setListOpen(false); }} className="cb-box-overlay cb-lock-scroll" style={{ zIndex:10000, padding:"40px 16px" }}>
          <div onClick={e => e.stopPropagation()} className="cb-sheet-up" style={{ background:"#fff", borderRadius:20, padding:"20px", maxWidth:460, width:"100%", maxHeight:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", position:"relative" }}>
            {/* 見出し行ごと「？」の当たり判定にする（丸チップだけだと外して黒幕に当たる・2026-08-18の教訓） */}
            <button type="button" onClick={(e) => { e.stopPropagation(); setInfoOpen(v => !v); }} aria-label="説明を見る" aria-expanded={infoOpen}
              style={{ display:"flex", alignItems:"center", gap:8, width:"100%", margin:"0 0 12px", padding:"4px 48px 4px 0", background:"none", border:"none", cursor:"pointer", textAlign:"left" }}>
              <span className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222" }}><span aria-hidden="true" style={{ color:"#E24B4A" }}>♥</span> いいねした求人</span>
              <span className="f-sans" style={{ width:22, height:22, borderRadius:11, background: infoOpen ? ROLE_ORANGE : "#F0F0F0", color: infoOpen ? "#fff" : "#717171", fontSize:12, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>？</span>
            </button>
            {infoOpen && (
              <p className="fade-in f-sans" style={{ fontSize:12, color:"#717171", lineHeight:1.8, margin:"0 0 12px" }}>
                求人ページで♥した求人の一覧です。タップすると求人ページが開きます。♥の解除は求人ページ、またはステータスページでできます。
              </p>
            )}
            {rows === null ? (
              <p className="f-sans" style={{ fontSize:13, color:"#717171", textAlign:"center", padding:"24px 8px" }}>読み込み中…</p>
            ) : count === 0 ? (
              <div style={{ textAlign:"center", padding:"24px 8px" }}>
                <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.9, margin:0 }}>
                  まだ♥した求人はありません。<br />気になる求人を♥しておくと、ここに並びます。
                </p>
                <button type="button" onClick={() => { setListOpen(false); window.location.hash = "/search"; }} className="f-sans"
                  style={{ marginTop:14, padding:"10px 18px", fontSize:13, fontWeight:700, background:"#fff", color:"#00A86B", border:"1px solid #00A86B", borderRadius:10, cursor:"pointer" }}>求人をさがす →</button>
              </div>
            ) : (
              <div style={{ display:"grid", gap:8 }}>
                {rows.map(r => {
                  const photo = photoThumb(r.photos?.[0]);
                  const title = [r.crop, r.task].filter(Boolean).join(" ") || `求人 #${r.job_number}`;
                  const dates = dateRangeLabel(r.date_start, r.date_end);
                  const ended = r.job_status !== "open"; // 掲載が終わった求人（行は残す＝記録。JobCardの「募集終了」と同じ語）
                  return (
                    <button key={r.job_number} type="button" onClick={() => openJob(r)} className="f-sans"
                      style={{ display:"flex", alignItems:"center", gap:12, width:"100%", textAlign:"left", border:"1px solid #EBEBEB", borderRadius:12, padding:"10px 12px", background:"#fff", cursor:"pointer" }}>
                      <span style={{ width:52, height:52, borderRadius:10, background:"#F7F7F7", flexShrink:0, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>
                        {photo ? <img loading="lazy" src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", filter: ended ? "grayscale(70%)" : "none" }} /> : "🌱"}
                      </span>
                      <span style={{ flex:1, minWidth:0 }}>
                        <span style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                          <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</span>
                          <span className="f-sans" style={{ fontSize:11, color:"#C8C8C8", flexShrink:0 }}>#{r.job_number}</span>
                        </span>
                        <span className="f-sans" style={{ display:"block", fontSize:11, color:"#717171", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {[dates, r.town].filter(Boolean).join("　") || "　"}
                        </span>
                        {ended
                          ? <span className="f-sans" style={{ display:"inline-block", fontSize:10, fontWeight:700, color:"#757575", background:"#F0F0F0", borderRadius:20, padding:"1px 8px", marginTop:3 }}>募集終了</span>
                          : <span className="f-sans" style={{ display:"block", fontSize:11, color:ROLE_ORANGE, marginTop:3 }}>求人ページを見る →</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
