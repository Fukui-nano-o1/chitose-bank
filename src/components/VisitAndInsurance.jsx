// 訪問者の玄関（#/visit・恒久URL）／QRページ／保険の準備ページ（分割・段階2で切り出し・2026-07-24）。
// /#/visit は印刷物に焼かれた恒久URL＝ルート文字列・遷移先の意味を変えない（CLAUDE.md絶対遵守）。
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { INSURANCE_ITEMS, insuranceToggle } from "../lib/utils";
import { prefetchSearchJobs } from "../lib/searchJobs";
import { ToggleSwitch } from "./ToggleSwitch";
import { Dots } from "./ui";
// 🛡 保険の準備（自己申告）専用ページ（#/insurance・2026-07-24）：農家プロフィール編集の箱から独立ページへ。
// employer_profiles.insurance_items を単独upsert（onConflictで当該列のみ更新＝他項目は温存）。
export function InsurancePrepPage({ me }) {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState({}); // { key: 農家の自由記述メモ }。求人の🛡保険タブで定型説明の下に出す
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setLoading(false); return; }
        const { data } = await supabase.from("employer_profiles").select("insurance_items,insurance_notes").eq("auth_id", session.user.id).maybeSingle();
        setItems(Array.isArray(data?.insurance_items) ? data.insurance_items : []);
        setNotes((data?.insurance_notes && typeof data.insurance_notes === "object") ? data.insurance_notes : {});
      } catch {}
      setLoading(false);
    })();
  }, []);
  // トグルの排他ルール（2026-07-25たきと指示）：「これから準備する」は他の保険と両立しない。
  // 選ぶと他の選択・ひとことが消えるため、消えるものがある時だけ警告を一度出してからリセットする
  const toggleItem = (k, v) => {
    // 排他ルール本体は lib/utils の insuranceToggle に一本化（プロフィールの保険カードと共用・2026-07-29）
    const r = insuranceToggle(items, notes, k, v);
    if (r.losing && !window.confirm("「これから準備する」を選ぶと、他の保険の選択と入力したひとことはリセットされます。よろしいですか？")) return;
    setItems(r.items);
    setNotes(r.notes);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSaving(false); return; }
      // メモは「選択中の項目」の空でないものだけ保存（外した項目のメモは残さない＝表示と保存の一致）
      const prunedNotes = {};
      items.forEach(k => { const t = (notes[k] || "").trim(); if (t) prunedNotes[k] = t; });
      const { error } = await supabase.from("employer_profiles").upsert({ auth_id: session.user.id, insurance_items: items, insurance_notes: prunedNotes, updated_at: new Date().toISOString() }, { onConflict: "auth_id" });
      setSaving(false);
      if (error) { alert("保存に失敗しました：" + error.message); return; }
      setSaved(true); setTimeout(()=>setSaved(false), 2000);
    } catch { setSaving(false); alert("保存に失敗しました"); }
  };
  return (
    /* ins-prep-page＝このページではサイトのフッター（サポート等）を隠す目印（CSSはappStyles） */
    <div className="help-edge ins-prep-page" style={{ maxWidth:560, marginLeft:"auto", marginRight:"auto", padding:"24px 20px 96px" }}>
      {/* ← 戻る＝左下の浮遊ボックス（2026-08-03たきと指示。下部バー・☰を消したページの戻り道・経験ページと同型） */}
      <button onClick={()=>{ let fromApp=false; try{ fromApp=sessionStorage.getItem("cb_insFromApp")==="1"; sessionStorage.removeItem("cb_insFromApp"); }catch{} if (fromApp && window.history.length>1) window.history.back(); else window.location.hash="/profile/employer"; }} className="f-sans"
        style={{ position:"fixed", left:12, bottom:"calc(12px + env(safe-area-inset-bottom, 0px))", zIndex:60, background:"#fff", border:"1px solid #EBEBEB", borderRadius:16, padding:"12px 18px", fontSize:14, fontWeight:600, color:"#222", cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,0.15)", display:"inline-flex", alignItems:"center", gap:6 }}>← 戻る</button>
      <h1 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#222", margin:"0 0 6px" }}>🛡 保険の準備（自己申告）</h1>
      <p className="f-sans" style={{ fontSize:13, color:"#717171", margin:"0 0 20px", lineHeight:1.7 }}>当てはまるものを選べます（複数可）。あなたの求人・プロフィールに「農家の自己申告」として表示されます。運営が確認するものではありません。選んだ項目には、働き手向けのひとことを添えられます（任意）。</p>
      {loading ? (
        <p className="f-sans" style={{ textAlign:"center", color:"#999", fontSize:13, padding:"32px 0" }}>読み込み中<Dots /></p>
      ) : (<>
        {/* 罫線で区切る行から、1項目=1ボックスへ（2026-07-29たきと指示・プロフィールの箱と同じ作法）。
            申告した項目は縁が緑。中身（トグル・ひとこと）と排他ルールは従来どおり */}
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
          {/* これから準備する選択中は他の保険を非表示（2026-07-25たきと指示・排他を見た目でも表現）。OFFに戻すと全箱復活 */}
          {(items.includes("considering") ? INSURANCE_ITEMS.filter(it => it.k === "considering") : INSURANCE_ITEMS).map((it) => {
            const on = items.includes(it.k);
            return (
              <div key={it.k} style={{ background:"#F7F7F7", border:"1px solid " + (on ? "#00A86B" : "#EBEBEB"), borderRadius:14, padding:"2px 14px 6px" }}>
                <ToggleSwitch label={it.label} checked={on} onChange={(v)=>toggleItem(it.k, v)} />
                {on && (
                  <div style={{ padding:"0 0 8px" }}>
                    <textarea
                      value={notes[it.k] || ""}
                      onChange={e=>setNotes(prev => ({ ...prev, [it.k]: e.target.value }))}
                      placeholder="働き手へのひとこと（任意・例：加入している保険会社や補償の範囲など）"
                      rows={2}
                      maxLength={300}
                      className="field f-sans"
                      style={{ fontSize:13, resize:"vertical", width:"100%", boxSizing:"border-box", background:"#fff" }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {items.includes("considering") && (
          <button onClick={()=>{ window.location.hash="/help/faq"; }} className="f-sans" style={{ background:"none", border:"none", padding:0, color:"#00A86B", fontSize:13, fontWeight:700, textDecoration:"underline", cursor:"pointer", marginBottom:16 }}>→ 1日保険の入り方（ヘルプ）</button>
        )}
        <button onClick={save} disabled={saving} className="btn-primary f-sans" style={{ width:"100%", padding:"15px", fontSize:15, fontWeight:700, borderRadius:12 }}>{saving ? "保存中..." : "保存する"}</button>
        {saved && <p className="f-sans" style={{ fontSize:12, color:"#00A86B", textAlign:"center", marginTop:12 }}>保存しました ✓</p>}
      </>)}
    </div>
  );
}

// 訪問者の玄関（#/visit・恒久URL・2026-07-24／2026-08-17改）。
// ★このルート文字列は印刷物のQRコードに焼き込み済み＝削除・改名を禁ずる（CLAUDE.md 2026-07-24）。
//   玄関の意味「訪問者が求人を見に来る入口」も不変。
// 2026-08-17たきと指示：同意画面（ロゴ＋求人の帯＋規約リンク＋「同意して見てみる」）は
//   利用者になる最大の障壁ので削除。玄関は素通りにし、着いたらそのまま #/search へ送る。
//   規約・プラポリはフッターに常設。同意の記録は会員登録時（AccountHolderForm）に取る。
//   アプリの入れ方は #/install（InstallGuide）に同じ文面が残っている＝案内は失われない。
export function VisitEntrance() {
  // 素通り：着いたその足で #/search へ送る（同意画面は撤去・2026-08-17）。
  // 退避先（cb_visitReturn）は同意ゲート時代の遺産。まだ端末に残っている人がいるので読んで消す
  // ＝古い保存値のまま迷子にしない。新規には二度と書かれない。
  useEffect(() => {
    // さがす一覧の先読み（2026-08-02）：置き換わるまでの一瞬でも取得を始めておくと、
    // 着いた先のさがすが即描画になる。キャッシュが既にあれば何もしない（関数内で判定）
    prefetchSearchJobs();
    let dest = "/search";
    try { const r = localStorage.getItem("cb_visitReturn"); if (r) dest = "/" + r; localStorage.removeItem("cb_visitReturn"); } catch {}
    window.location.replace(window.location.pathname + window.location.search + "#" + dest);
  }, []);
  return null;
}

// 管理者用QRコードページ（#/qr・2026-07-24）：焼き込み済みの静的QR(public/visit-qr.svg)を表示。実行時生成しない。
export function VisitorQRPage() {
  const url = "https://chitose-bank.com/#/visit";
  return (
    <div style={{ maxWidth:520, margin:"0 auto", padding:"40px 20px 96px", textAlign:"center" }}>
      <h1 className="f-sans qr-noprint" style={{ fontSize:24, fontWeight:800, color:"#222", margin:"0 0 12px" }}>📇 QRコード</h1>
      <p className="f-sans qr-noprint" style={{ fontSize:12, color:"#C77700", background:"#FFF7E6", border:"1px solid #FFE0A3", borderRadius:10, padding:"10px 12px", margin:"0 0 22px", lineHeight:1.8, textAlign:"left" }}>このQRは印刷物に配布済み。画像とURLは永久に変更しないこと（恒久URL /#/visit）。</p>
      <div className="qr-print-area">
        <img src="/visit-qr.svg" alt="訪問者用QRコード" style={{ width:"min(72vw, 320px)", height:"auto", imageRendering:"pixelated", display:"block", margin:"0 auto" }} />
        <p className="f-mono" style={{ fontSize:14, color:"#222", margin:"16px 0 0", wordBreak:"break-all" }}>{url}</p>
        <p className="f-sans qr-print-only" style={{ fontSize:20, fontWeight:800, color:"#222", margin:"26px 0 4px" }}>chitose-bank</p>
        <p className="f-sans qr-print-only" style={{ fontSize:14, color:"#555", margin:0 }}>農家と働き手が直接つながる、農作業の求人サイトです。</p>
      </div>
      <button onClick={()=>window.print()} className="btn-primary f-sans qr-noprint" style={{ marginTop:26, padding:"14px 32px", fontSize:15, fontWeight:700, borderRadius:12 }}>🖨 印刷</button>
    </div>
  );
}
