// ボックス一覧（#/boxes・管理者専用・分割3-Aで切り出し2026-07-24）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { NoticeJumpText } from "../ui";
import { AdminNav } from "./AdminNav";

// ── ボックス一覧 専用ページ（#/boxes・管理者のみ・2026-07-17）：管理タブ「その他」のポップアップから昇格。
//    2タブ構成（ボックス台帳 ⇄ お知らせ台帳・#/boxes / #/boxes/notices）。タブは指追従スワイプでも切替
//    （農家プロ作成中⇄公開中と同じページャー作法）。台帳はadmin_box_registry / admin_notice_registry（RLSで管理者限定）。
//    閲覧専用（2026-07-17変更）：編集UIは持たない。行タップで「本番に出る姿」をそのまま展開し、展開機会と説明を添える
// 段階お祝いボックスの本番見た目プレビュー（ボックス一覧の preview_key='stage:...' から参照）。
// 文面は App 内の実定義(defs・17555付近)をサンプル題名で写したもの。実定義を変えたらここも合わせる
const STAGE_BOX_PREVIEWS = {
  "w:approved": { emoji:"🎉", head:"承認されました！",         body:"「ブロッコリー 収穫」に承認されました。打ち合わせ・面接をチャットで進めましょう。", link:"チャットを開く →" },
  "w:worked":   { emoji:"🌾", head:"お仕事おつかれさまでした", body:"農家が「ブロッコリー 収穫」の作業完了を記録しました。最後に、お互いを評価しましょう。", link:"評価する →" },
  "w:reviewed": { emoji:"⭐", head:"評価を送りました",         body:"ありがとうございました。「ブロッコリー 収穫」の実績が、あなたのプロフィールに反映されます。", link:"実績を見る →" },
  "f:applied":  { emoji:"📩", head:"新しい応募が届きました",   body:"「ブロッコリー 収穫」に新しい応募があります。プロフィールを見て、承認するか決めましょう。", link:"応募者を見る →" },
  "f:worked":   { emoji:"🌾", head:"作業が完了しました",       body:"「ブロッコリー 収穫」の作業が完了しました。働き手を評価しましょう。", link:"応募者を見る →" },
};

export function AdminBoxRegistryPage() {
  const hashToTab = () => (window.location.hash.replace(/^#\/?/, "").startsWith("boxes/notices") ? "notices" : "boxes");
  const [pTab, setPTab] = useState(() => { try { return hashToTab(); } catch { return "boxes"; } });
  useEffect(() => {
    const onHash = () => setPTab(hashToTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // ── 台帳の読み取り（編集はしない） ──
  const [rows, setRows] = useState([]);
  const [nRows, setNRows] = useState([]);
  const load = async () => {
    const { data } = await supabase.from("admin_box_registry").select("*").order("sort").order("created_at");
    setRows(data || []);
  };
  const nLoad = async () => {
    const { data } = await supabase.from("admin_notice_registry").select("*").order("sort").order("created_at");
    setNRows(data || []);
  };
  useEffect(() => { load(); nLoad(); }, []);
  const [preview, setPreview] = useState(null);   // 展開中のボックス行
  const [nPreview, setNPreview] = useState(null); // 展開中のお知らせ行
  const fmtDate = (ts) => { if (!ts) return ""; const d = new Date(ts); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; };
  const audienceLabel = (a) => (a === "farmer" ? "農家" : a === "worker" ? "働き手" : "全員");
  const noticeStatus = (r) => {
    if (!r.published) return { l:"下書き", bg:"#F5F5F5", fg:"#717171" };
    const now = new Date();
    if (r.starts_at && now < new Date(r.starts_at)) return { l:"公開予定", bg:"#FFF4E0", fg:"#C77700" };
    if (r.ends_at && now > new Date(r.ends_at)) return { l:"終了", bg:"#F5F5F5", fg:"#999" };
    return { l:"公開中", bg:"#E6F7EF", fg:"#00A86B" };
  };
  // ── 指追従ページャー（農家プロ作成中⇄公開中と同じ作法）：横ロック後はtransformを直接書き、端は1/3の抵抗 ──
  const trackRef = useRef(null);
  const dragRef = useRef(null); // {x, y, dx, lock:"h"|"v"|null, w}
  const basePct = () => (pTab === "boxes" ? 0 : -50);
  const goTab = (k) => { setPTab(k); window.location.hash = k === "boxes" ? "/boxes" : "/boxes/notices"; };
  const onPagerStart = (e) => {
    if (preview || nPreview) return; // 展開中はスワイプで切り替えない
    dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: null, w: e.currentTarget.clientWidth || 1 };
  };
  const onPagerMove = (e) => {
    const s = dragRef.current, el = trackRef.current;
    if (!s || !el) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (s.lock !== "h") return;
    const atEdge = (pTab === "boxes" && dx > 0) || (pTab === "notices" && dx < 0);
    s.dx = atEdge ? dx / 3 : dx;
    el.style.transition = "none";
    el.style.transform = `translateX(calc(${basePct()}% + ${s.dx}px))`;
  };
  const onPagerEnd = () => {
    const s = dragRef.current, el = trackRef.current;
    dragRef.current = null;
    if (!s || !el || s.lock !== "h") return;
    el.style.transition = "transform .3s ease";
    const threshold = Math.min(80, s.w / 4);
    if (pTab === "boxes" && s.dx < -threshold) {
      el.style.transform = "translateX(-50%)";
      goTab("notices");
    } else if (pTab === "notices" && s.dx > threshold) {
      el.style.transform = "translateX(0%)";
      goTab("boxes");
    } else {
      el.style.transform = `translateX(${basePct()}%)`;
    }
  };
  return (
    /* cb-admin-page＝下部バーを隠す目印（浮遊☰・フッターは出す・appStyles・2026-08-05） */
    <div className="fade-in cb-admin-page" style={{ maxWidth:560, margin:"0 auto", padding:"24px 16px 120px" }}>
      {/* 管理ページの共通ナビ（全ページ導線・2026-08-02）。旧「← 管理」ボタンは管理チップが兼ねる */}
      <AdminNav current={pTab === "notices" ? "notices" : "boxes"} />
      <div style={{ display:"flex", gap:8, margin:"0 0 16px" }}>
        {[
          { k:"boxes",   l:"ボックス一覧",   n:rows.length },
          { k:"notices", l:"お知らせ一覧", n:nRows.length },
        ].map(t => (
          <button key={t.k} onClick={()=>{ if (pTab !== t.k) goTab(t.k); }} className="f-sans"
            style={{ flex:1, padding:"11px 0", borderRadius:12, border: pTab===t.k ? "2px solid #222" : "1px solid #EBEBEB", background:"#fff", fontSize:14, fontWeight: pTab===t.k ? 800 : 600, color: pTab===t.k ? "#222" : "#999", cursor:"pointer" }}>
            {t.l}{t.n > 0 ? `（${t.n}）` : ""}
          </button>
        ))}
      </div>
      <div onTouchStart={onPagerStart} onTouchMove={onPagerMove} onTouchEnd={onPagerEnd} style={{ overflow:"hidden", touchAction:"pan-y" }}>
        <div ref={trackRef} style={{ display:"flex", width:"200%", transform: pTab==="boxes" ? "translateX(0%)" : "translateX(-50%)", transition:"transform .3s ease" }}>
          {/* ── ボックス台帳パネル（閲覧のみ） ── */}
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingRight:5 }}>
            {rows.length === 0 && (
              <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", padding:"24px 0" }}>台帳は空です。</p>
            )}
            {rows.map(r => (
              <button key={r.id} onClick={()=>setPreview(r)} className="f-sans" style={{ width:"100%", display:"flex", alignItems:"flex-start", gap:10, padding:"12px 2px", background:"none", border:"none", borderBottom:"1px solid #F7F7F7", textAlign:"left", cursor:"pointer" }}>
                <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", minWidth:130, flexShrink:0 }}>{r.name}</span>
                <span className="f-sans" style={{ flex:1, fontSize:12, color:"#717171", lineHeight:1.6, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{r.where_from}</span>
                <span style={{ fontSize:14, color:"#B0B0B0", flexShrink:0 }}>›</span>
              </button>
            ))}
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginTop:12 }}>
              本番で展開されるボックス（ポップアップ）の台帳。行をタップすると、本番と同じボックスの形で展開機会と説明を確認できます（閲覧のみ）。
            </p>
          </div>
          {/* ── お知らせ台帳パネル（閲覧のみ） ── */}
          <div style={{ width:"50%", flexShrink:0, boxSizing:"border-box", paddingLeft:5 }}>
            {nRows.length === 0 && (
              <p className="f-sans" style={{ fontSize:12, color:"#B0B0B0", textAlign:"center", padding:"24px 0" }}>お知らせはありません。</p>
            )}
            {nRows.map(r => {
              const st = noticeStatus(r);
              return (
              <button key={r.id} onClick={()=>setNPreview(r)} className="f-sans" style={{ width:"100%", display:"flex", alignItems:"flex-start", gap:10, padding:"12px 2px", background:"none", border:"none", borderBottom:"1px solid #F7F7F7", textAlign:"left", cursor:"pointer" }}>
                <span style={{ flexShrink:0, padding:"2px 8px", borderRadius:8, fontSize:10, fontWeight:700, background:st.bg, color:st.fg, marginTop:1 }}>{st.l}</span>
                <span className="f-sans" style={{ fontSize:13, fontWeight:700, color:"#222", minWidth:110, flexShrink:0 }}>{r.name}</span>
                <span className="f-sans" style={{ flex:1, fontSize:12, color:"#717171", lineHeight:1.6, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{r.body}</span>
                <span style={{ fontSize:14, color:"#B0B0B0", flexShrink:0 }}>›</span>
              </button>
              );
            })}
            <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginTop:12 }}>
              行をタップすると、本番で利用者に表示されるお知らせポップアップをそのまま確認できます（閲覧のみ）。
            </p>
          </div>
        </div>
      </div>

      {/* ── ボックスの展開（本番と同じボックス意匠で、展開機会と説明を表示） ── */}
      {preview && (
        <div onClick={()=>setPreview(null)} style={{ position:"fixed", inset:0, zIndex:8000, background:"rgba(0,0,0,0.45)", animation:"fadeIn .2s ease" }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up" style={{ position:"absolute", left:12, right:12, top:"6vh", bottom:"calc(64px + 10px + env(safe-area-inset-bottom, 0px))", maxWidth:520, margin:"0 auto", background:"#fff", borderRadius:20, boxShadow:"0 12px 48px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
              <button onClick={()=>setPreview(null)} aria-label="閉じる" className="f-sans" style={{ width:32, height:32, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:14, cursor:"pointer", flexShrink:0 }}>✕</button>
              <p className="f-sans" style={{ fontSize:15, fontWeight:800, color:"#222", margin:0 }}>{preview.name}</p>
            </div>
            <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px" }}>
              {(() => {
                // preview_key='stage:...' の行は、本番の段階お祝いボックスの見た目をそのまま展開して見せる
                const sk = preview.preview_key && preview.preview_key.startsWith("stage:") ? preview.preview_key.slice(6) : null;
                const sb = sk ? STAGE_BOX_PREVIEWS[sk] : null;
                if (!sb) return null;
                return (
                  <div style={{ marginBottom:18 }}>
                    <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 8px" }}>本番の見た目（サンプル題名）</p>
                    <div className="f-sans" style={{ background:"#fff", border:"3px solid #00A86B", borderRadius:20, padding:"24px 20px 20px", boxShadow:"0 6px 24px rgba(0,0,0,0.12)", textAlign:"left" }}>
                      <div style={{ fontSize:34, marginBottom:8 }}>{sb.emoji}</div>
                      <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text={sb.head} /></p>
                      <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
                      <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0 }}>{sb.body}</p>
                      <span className="f-sans" style={{ display:"inline-block", marginTop:16, borderBottom:"2px solid #00A86B", padding:"0 0 2px", fontSize:18, fontWeight:700, color:"#00A86B" }}>{sb.link}</span>
                    </div>
                  </div>
                );
              })()}
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 6px" }}>展開機会・説明（どこから開くか）</p>
              <p className="f-sans" style={{ fontSize:14, color:"#222", lineHeight:1.9, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>{preview.where_from || "（説明未登録）"}</p>
              <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", lineHeight:1.7, marginTop:16, borderTop:"1px solid #F7F7F7", paddingTop:12 }}>
                このボックスは本番のこの意匠（下からせり上がるシート）で展開されます。台帳は閲覧専用です。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── お知らせの展開（本番の規定と同じ意匠・2026-07-17設計＝左詰め・緑の太縁3px・タイトル20/本文18・
           タイトルと説明の間に横線・上限=画面上から30px・下限=下部フッターの20px上・最終段に「〇〇する」リンク）＋展開機会 ── */}
      {nPreview && (() => {
        const st = noticeStatus(nPreview);
        return (
        <div onClick={()=>setNPreview(null)} className="cb-box-overlay" style={{ zIndex:8000 }}>
          <div onClick={e=>e.stopPropagation()} className="cb-sheet-up cb-notice-sheet">
            <button onClick={()=>setNPreview(null)} aria-label="閉じる" style={{ position:"absolute", top:12, right:12, width:36, height:36, borderRadius:"50%", background:"#F0F0F0", border:"none", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#00A86B", margin:"0 0 14px" }}>📢 お知らせ</p>
            <p className="f-sans" style={{ fontSize:20, fontWeight:800, color:"#222", lineHeight:1.4, margin:0 }}><NoticeJumpText text={nPreview.name} /></p>
            <div style={{ height:1, background:"#E5E5E5", margin:"14px 0" }} />
            {nPreview.image_url
              ? <img src={nPreview.image_url} alt={nPreview.name} style={{ display:"block", width:"100%", borderRadius:12 }} />
              : <p className="f-sans" style={{ fontSize:18, color:"#444", lineHeight:1.7, margin:0, whiteSpace:"pre-wrap", overflowWrap:"break-word" }}>{nPreview.body}</p>}
            {nPreview.link_label && nPreview.link_hash && (
              <p style={{ margin:"22px 0 0" }}>
                <button onClick={()=>{ const h = nPreview.link_hash; setNPreview(null); if (!h.startsWith("event:")) window.location.hash = h; }} className="f-sans" style={{ background:"none", border:"none", padding:"0 0 1px", fontSize:18, fontWeight:800, color:"#00A86B", borderBottom:"2px solid #00A86B", cursor:"pointer" }}><NoticeJumpText text={nPreview.link_label + " →"} /></button>
              </p>
            )}
            <div style={{ marginTop:20, borderTop:"1px solid #F0F0F0", paddingTop:12 }}>
              <p className="f-sans" style={{ fontSize:11, fontWeight:700, color:"#B0B0B0", letterSpacing:".08em", margin:"0 0 6px" }}>展開機会</p>
              <p className="f-sans" style={{ fontSize:13, color:"#717171", lineHeight:1.8, margin:0 }}>
                <span style={{ padding:"2px 8px", borderRadius:8, fontSize:11, fontWeight:700, background:st.bg, color:st.fg, marginRight:8 }}>{st.l}</span>
                対象：{audienceLabel(nPreview.audience)}
                {(nPreview.starts_at || nPreview.ends_at) ? `　期間：${fmtDate(nPreview.starts_at) || "指定なし"}〜${fmtDate(nPreview.ends_at) || "指定なし"}` : "　期間：指定なし"}
                <br />展開機会：{(nPreview.trigger_on || "startup").split(",").map(t => ({ startup:"起動時", login:"ログイン画面を開いたとき", after_login:"ログイン後", approval:"応募承認後", confirm:"確認ページ（農家プロ未入力時）" }[t.trim()] || t)).join("・")}{nPreview.show_every_time ? "のたびに毎回ポップアップ表示されます（✕で閉じても次回また表示）。" : nPreview.repeat_chance > 0 ? `のたびに約${nPreview.repeat_chance}%の確率でランダム表示されます（✕で閉じても対象のまま）。` : "に1回だけポップアップ表示されます（✕で既読）。"}上の表示が本番そのままの見え方です。
              </p>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
