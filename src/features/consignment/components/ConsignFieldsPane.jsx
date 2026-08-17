// 圃場の登録簿（委託者単位）。第2次構造改革2026-08-17で ConsignmentRoom.jsx から分離・中身は不変。
import { useState } from "react";
import { supabase } from "../../../lib/supabase";
import { zipLookup } from "../../../lib/zipLookup";
import { uploadJobPhoto } from "../../../lib/image";
import { Dots } from "../../../components/ui";

//    新規委託ウィザードSTEP1で呼び出せる。ウィザードで入力した圃場も掲載時に自動登録（同名upsert）──
export function ConsignFieldsPane({ fields, onReload }) {
  const [form, setForm] = useState(null); // null=一覧 / {}=新規 / {id,...}=編集
  const [fSaving, setFSaving] = useState(false);
  const [fZipBusy, setFZipBusy] = useState(false);
  const [fZipError, setFZipError] = useState("");
  const [fPhotoBusy, setFPhotoBusy] = useState(false);
  const fset = (k, v) => setForm(p => ({ ...p, [k]: v }));
  // 圃場の写真は1枚（2026-08-02たきと指示）。consignment-photos バケット流用・選び直しで差し替え
  const fPhotoUpload = async (file) => {
    if (!file || fPhotoBusy) return;
    setFPhotoBusy(true);
    try {
      // 共通ヘルパーでHEIC変換＋1600px/0.8圧縮（原寸だと5MB上限超過・2026-08-03バグ修理）
      const { url } = await uploadJobPhoto(supabase, file, { bucket: "consignment-photos", pathPrefix: "consign_field_", withThumb: false });
      fset("photo", url);
    } catch (e) { alert("写真のアップロードに失敗しました：" + (e?.message || "不明なエラー")); }
    setFPhotoBusy(false);
  };
  // 圃場の住所は正式なもの（2026-08-02たきと指示）：郵便番号→住所を自動入力＋番地は手入力。
  // 検索は2系統レース＋タイムアウト＋キャッシュ（lib/zipLookup・「検索に数十秒」対策）
  const fZipSearch = async () => {
    const z = (form?.zip || "").replace(/[^0-9]/g, "");
    if (z.length !== 7) { setFZipError("郵便番号は7桁で入力してください"); return; }
    setFZipBusy(true); setFZipError("");
    const r = await zipLookup(z);
    if (!r.ok) setFZipError(r.reason === "notfound" ? "住所が見つかりませんでした" : "検索に失敗しました。通信環境をご確認ください");
    else setForm(f => ({ ...f, zip: z, addr_main: r.full }));
    setFZipBusy(false);
  };
  const saveField = async () => {
    if (fSaving || !form) return;
    const name = (form.name || "").trim();
    if (!name) { alert("圃場の呼び名を入力してください。"); return; }
    setFSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setFSaving(false); return; }
      const row = {
        auth_id: session.user.id, name,
        // region＝正式住所（都道府県〜町域・郵便番号検索から）。番地はdata.addr_detailに分離
        region: (form.addr_main || "").trim(), area_a: String(form.area_a || "").trim(),
        data: { zip: (form.zip || "").replace(/[^0-9]/g, ""), addr_detail: (form.addr_detail || "").trim(), photo: form.photo || "" },
        updated_at: new Date().toISOString(),
      };
      const { error } = form.id
        ? await supabase.from("consignment_fields").update(row).eq("id", form.id)
        : await supabase.from("consignment_fields").insert(row);
      if (error) { alert("保存に失敗しました：" + (error.code === "23505" ? "同じ呼び名の圃場が既にあります" : error.message)); setFSaving(false); return; }
      setForm(null); onReload();
    } catch { alert("保存に失敗しました。"); }
    setFSaving(false);
  };
  const delField = async (f) => {
    if (!window.confirm("圃場「" + f.name + "」を削除しますか？（作成済みの委託の内容には影響しません）")) return;
    const { error } = await supabase.from("consignment_fields").delete().eq("id", f.id);
    if (error) { alert("削除に失敗しました：" + error.message); return; }
    onReload();
  };
  // ── 入力フォーム（新規・編集共用）──
  if (form) return (
    <div>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>{form.id ? "圃場を編集" : "圃場を登録"}</h2>
      <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 16px" }}>登録した圃場は「新しく委託を出す」で呼び出せます。</p>
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">圃場の呼び名</label>
        <input className="field f-sans" value={form.name || ""} onChange={e=>fset("name", e.target.value)} placeholder="例：川向こうの畑" style={{ fontSize:15.4, marginBottom:0 }} />
      </div>
      {/* 正式住所（2026-08-02たきと指示）：郵便番号から検索。新規登録と同じ3分割（郵便番号/住所/番地） */}
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">郵便番号</label>
        <div style={{ display:"flex", gap:8 }}>
          <input className="field f-sans" inputMode="numeric" value={form.zip || ""} onChange={e=>fset("zip", e.target.value.replace(/[^0-9]/g, ""))} placeholder="例：7700000" style={{ fontSize:15.4, marginBottom:0, flex:1 }} />
          <button type="button" onClick={fZipSearch} disabled={fZipBusy} className="f-sans" style={{ flexShrink:0, padding:"0 14px", fontSize:14.3, fontWeight:700, background:"#fff", color:"#111111", border:"1px solid #111111", borderRadius:10, cursor:"pointer" }}>{fZipBusy ? <>検索中<Dots /></> : "住所を検索"}</button>
        </div>
        {fZipError && <p className="f-sans" style={{ fontSize:12.1, fontWeight:700, color:"#111111", margin:"6px 0 0" }}>{fZipError}</p>}
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">住所</label>
        <input className="field f-sans" value={form.addr_main || ""} onChange={e=>fset("addr_main", e.target.value)} placeholder="例：徳島県〇〇市〇〇町" style={{ fontSize:15.4, marginBottom:0 }} />
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">番地・字</label>
        <input className="field f-sans" value={form.addr_detail || ""} onChange={e=>fset("addr_detail", e.target.value)} placeholder="例：123-4" style={{ fontSize:15.4, marginBottom:0 }} />
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">面積（a）</label>
        <input className="field f-sans" inputMode="numeric" value={form.area_a || ""} onChange={e=>fset("area_a", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="例：30" style={{ fontSize:15.4, marginBottom:0 }} />
      </div>
      <div style={{ marginBottom:10 }}>
        <label className="lbl f-sans">圃場の写真（1枚）</label>
        {form.photo ? (
          <div style={{ position:"relative", display:"inline-block" }}>
            <img loading="lazy" src={form.photo} alt="" style={{ width:140, height:140, objectFit:"cover", borderRadius:12, border:"1px solid #111111", display:"block" }} />
            <button type="button" onClick={()=>fset("photo", "")} className="f-sans" aria-label="写真を削除" style={{ position:"absolute", top:-8, right:-8, width:26, height:26, borderRadius:"50%", border:"1px solid #111111", background:"#111111", color:"#fff", fontSize:13.2, fontWeight:700, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>×</button>
          </div>
        ) : (
          <label className="f-sans" style={{ display:"flex", alignItems:"center", justifyContent:"center", width:"100%", height:96, border:"1px dashed #111111", borderRadius:12, fontSize:14.3, fontWeight:700, color:"#111111", cursor:"pointer", background:"#fff" }}>
            {fPhotoBusy ? <>アップロード中<Dots /></> : "＋ 写真を追加"}
            <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{ fPhotoUpload(e.target.files && e.target.files[0]); e.target.value = ""; }} />
          </label>
        )}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <button onClick={()=>setForm(null)} className="f-sans" style={{ flex:1, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#fff", color:"#111111", border:"1px solid #111111", cursor:"pointer" }}>キャンセル</button>
        <button onClick={saveField} disabled={fSaving} className="f-sans" style={{ flex:1.4, padding:"14px", fontSize:15.4, fontWeight:700, borderRadius:12, background:"#111111", color:"#fff", border:"none", cursor:"pointer", opacity: fSaving ? 0.6 : 1 }}>{fSaving ? <>保存中<Dots /></> : "保存する"}</button>
      </div>
    </div>
  );
  // ── 一覧 ──
  return (
    <div>
      <h2 className="f-sans" style={{ fontSize:22, fontWeight:800, color:"#111111", margin:"0 0 4px" }}>委託圃場</h2>
      <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 16px" }}>登録した圃場は「新しく委託を出す」で呼び出せます。掲載した委託の圃場も自動でここに登録されます。</p>
      {fields.length === 0 && (
        <p className="f-sans" style={{ fontSize:13.2, color:"#999999", margin:"0 0 12px" }}>登録された圃場はまだありません。</p>
      )}
      {fields.map(f => (
        <div key={f.id} style={{ background:"#fff", border:"1px solid #111111", borderRadius:14, padding:"14px 16px", marginBottom:10, display:"flex", gap:12, alignItems:"flex-start" }}>
          {((f.data || {}).photo || "") && (
            <img loading="lazy" src={f.data.photo} alt="" style={{ width:64, height:64, objectFit:"cover", borderRadius:10, border:"1px solid #E5E5E5", flexShrink:0 }} />
          )}
          <div style={{ flex:1, minWidth:0 }}>
          <p className="f-sans" style={{ fontSize:15.4, fontWeight:800, color:"#111111", margin:0 }}>{f.name}</p>
          <p className="f-sans" style={{ fontSize:13.2, color:"#111111", margin:"4px 0 0" }}>{[((f.data || {}).zip ? "〒" + f.data.zip + " " : "") + [f.region, (f.data || {}).addr_detail].filter(Boolean).join(" "), f.area_a ? f.area_a + "a" : ""].filter(x => (x || "").trim()).join("・") || "住所・面積 未入力"}</p>
          <div style={{ display:"flex", gap:8, marginTop:10 }}>
            <button onClick={()=>setForm({ id: f.id, name: f.name, addr_main: f.region, area_a: f.area_a, ...(f.data || {}) })} className="f-sans" style={{ padding:"8px 16px", fontSize:13.2, fontWeight:700, borderRadius:10, background:"#fff", color:"#111111", border:"1px solid #111111", cursor:"pointer" }}>編集</button>
            <button onClick={()=>delField(f)} className="f-sans" style={{ padding:"8px 16px", fontSize:13.2, fontWeight:700, borderRadius:10, background:"#fff", color:"#999999", border:"1px solid #D0D0D0", cursor:"pointer" }}>削除</button>
          </div>
          </div>
        </div>
      ))}
      <button onClick={()=>setForm({})} className="f-sans" style={{ width:"100%", padding:"16px", fontSize:15.4, fontWeight:800, borderRadius:14, background:"#111111", color:"#fff", border:"none", cursor:"pointer", marginTop:6 }}>＋ 圃場を登録する</button>
    </div>
  );
}

