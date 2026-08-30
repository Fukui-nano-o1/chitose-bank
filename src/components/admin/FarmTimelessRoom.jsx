// 農タイムレス（#/admin/consignment/timeless・管理者専用・2026-08-30たきと指示）。
// 日本地図（都道府県タイル）に、病害虫や栽培アクションを写真と一言コメントで記録する運営専用の圃場ノート。
// 入口＝委託面の「新しく委託を出す」カードの下（ConsignmentRoomが本部品を描く）。
// ★管理者専用の二重の壁：フロント＝この部屋自体が App の isAdmin ゲートの内側／
//   サーバー＝farm_timeless_posts のRLSが app_admins 限定（閲覧・書き込みとも・migration 20260830140119）。
//   写真は consignment-photos バケット（書き込み=admin限定・公開URLは authenticated read）を
//   timeless_ プレフィックスで間借り＝新しいバケット・ポリシーは作らない。
// ★日本地図は「タイル型」＝47都道府県を升目に並べた様式（SVGの実形は使わない）。
//   位置は PREF_TILES の1箇所だけが正（x=列1..11・y=行1..14）。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { uploadJobPhoto } from "../../lib/image";
import { getCache, setCache } from "../../lib/viewCache";
import { TASK_OPTIONS } from "../../lib/utils";
import { Dots } from "../ui";

// 47都道府県のタイル配置（x=列, y=行）。厳密な地形ではなく「日本と分かる」升目＝
// 北海道・東北を右上、中国四国九州を左下に曲げた定番のタイルマップ。
const PREF_TILES = [
  ["北海道", 11, 1], ["青森県", 11, 2], ["秋田県", 10, 3], ["岩手県", 11, 3],
  ["山形県", 10, 4], ["宮城県", 11, 4], ["新潟県", 9, 5], ["福島県", 10, 5],
  ["石川県", 7, 6], ["富山県", 8, 6], ["長野県", 9, 6], ["群馬県", 10, 6], ["栃木県", 11, 6],
  ["福井県", 7, 7], ["岐阜県", 8, 7], ["山梨県", 9, 7], ["埼玉県", 10, 7], ["茨城県", 11, 7],
  ["島根県", 2, 8], ["鳥取県", 3, 8], ["京都府", 6, 8], ["滋賀県", 7, 8], ["愛知県", 8, 8], ["静岡県", 9, 8], ["東京都", 10, 8], ["千葉県", 11, 8],
  ["山口県", 1, 9], ["広島県", 2, 9], ["岡山県", 3, 9], ["兵庫県", 4, 9], ["大阪府", 5, 9], ["奈良県", 6, 9], ["三重県", 7, 9], ["神奈川県", 10, 9],
  ["愛媛県", 2, 10], ["香川県", 3, 10], ["徳島県", 4, 10], ["和歌山県", 5, 10],
  ["佐賀県", 1, 11], ["福岡県", 2, 11], ["大分県", 3, 11], ["高知県", 4, 11],
  ["長崎県", 1, 12], ["熊本県", 2, 12], ["宮崎県", 3, 12],
  ["鹿児島県", 2, 13],
  ["沖縄県", 1, 14],
];

// 病害虫の種類（選択肢＝プリセットのみ・自由入力は置かない）。前半=害虫／後半=病気。
const PEST_KINDS = [
  "アブラムシ", "ハダニ", "アザミウマ", "コナジラミ", "ヨトウムシ", "アオムシ・コナガ",
  "カメムシ", "ハモグリバエ", "テントウムシダマシ", "ネキリムシ", "センチュウ", "ナメクジ",
  "うどんこ病", "べと病", "灰色かび病", "炭疽病", "疫病", "青枯病", "軟腐病",
  "モザイク病", "さび病", "黒星病", "根こぶ病", "その他",
];
// 栽培アクションの作業選択肢＝サイトの作業の唯一のソース（lib/utils TASK_OPTIONS）＋その他。
// TASK_OPTIONS に作業を足せばここも自動で増える（二重の表を持たない）
const ACTION_KINDS = [...TASK_OPTIONS.map(t => t.name), "その他"];

const CK = "timeless:posts"; // viewCacheの鍵（JSON安全な行のみ＝Dateを入れない・2026-08-03規則）

const dateLabel = (iso) => {
  try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; } catch { return ""; }
};

export function FarmTimelessRoom() {
  const [posts, setPosts] = useState(() => { const c = getCache(CK); return Array.isArray(c) ? c : []; });
  const [loaded, setLoaded] = useState(false);
  const [pref, setPref] = useState("");        // 選択中の都道府県（""=未選択・一覧は全件）
  const [kind, setKind] = useState("pest");    // pest=病害虫 / action=栽培アクション
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState(null);    // { url } 1枚だけ
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const fileRef = useRef(null);

  // 読み込み（SWR）：前回内容を即描画→裏で最新に。失敗時は手元の値を上書きしない（2026-08-07規則）
  useEffect(() => {
    (async () => {
      const res = await supabase.from("farm_timeless_posts").select("*").order("created_at", { ascending: false }).limit(500);
      if (!res.error && Array.isArray(res.data)) { setPosts(res.data); setLoaded(true); }
    })();
  }, []);
  // state→キャッシュの写しは1箇所（2026-07-29の作法）。読み込み前は写さない（空を焼き付けない）
  useEffect(() => { if (loaded) setCache(CK, posts); }, [posts, loaded]);

  const countByPref = posts.reduce((a, p) => { a[p.pref] = (a[p.pref] || 0) + 1; return a; }, {});
  const shown = pref ? posts.filter(p => p.pref === pref) : posts;

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadJobPhoto(supabase, file, { bucket: "consignment-photos", pathPrefix: "timeless_", withThumb: false });
      setPhoto({ url });
    } catch (err) { alert("写真をアップロードできませんでした：" + (err?.message || err)); }
    setUploading(false);
  };

  const submit = async () => {
    // 押せないボタンにしない＝押した時に足りないものを言う（2026-08-03の原則）
    if (!pref) { setFormErr("地図から都道府県を選んでください。"); return; }
    if (!category) { setFormErr(kind === "pest" ? "病害虫の種類を選んでください。" : "作業を選んでください。"); return; }
    setFormErr("");
    setSaving(true);
    const { data, error } = await supabase.from("farm_timeless_posts")
      .insert({ kind, category, pref, comment: comment.trim(), photo_url: photo?.url || null })
      .select().single();
    setSaving(false);
    if (error) { alert("記録できませんでした：" + error.message); return; }
    setPosts(p => [data, ...p]);
    setCategory(""); setComment(""); setPhoto(null); // 場所と種別は続けて記録しやすいよう保持
  };

  const removePost = async (p) => {
    if (!window.confirm("この記録を削除しますか？")) return;
    const { error } = await supabase.from("farm_timeless_posts").delete().eq("id", p.id);
    if (error) { alert("削除できませんでした：" + error.message); return; }
    // 写真ファイルはバケットに残す（孤児残置の設計＝job-photosと同じ。URLを参照する行はもう無い）
    setPosts(rows => rows.filter(r => r.id !== p.id));
  };

  const kinds = kind === "pest" ? PEST_KINDS : ACTION_KINDS;

  return (
    <div className="fade-in">
      <button onClick={() => { window.location.hash = "/admin/consignment"; }} className="f-sans" style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #EBEBEB", borderRadius: 20, fontSize: 13.2, fontWeight: 600, color: "#111111", cursor: "pointer", padding: "7px 14px", marginBottom: 16 }}>← 戻る</button>
      <h2 className="f-sans" style={{ fontSize: 22, fontWeight: 800, color: "#111111", margin: "0 0 4px" }}>農タイムレス</h2>
      <p className="f-sans" style={{ fontSize: 13.2, color: "#999999", margin: "0 0 16px", lineHeight: 1.7 }}>日本地図に、病害虫や栽培アクションを写真と一言で記録します（管理者専用）。</p>

      {/* ── 日本地図（都道府県タイル）── 記録のある県は薄グレー＋件数バッジ・選択中は黒 */}
      <div style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 16, padding: "14px 10px", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(11, 1fr)", gap: 3, maxWidth: 480, margin: "0 auto" }}>
          {PREF_TILES.map(([name, x, y]) => {
            const on = pref === name;
            const n = countByPref[name] || 0;
            return (
              <button key={name} type="button" onClick={() => { setPref(on ? "" : name); setFormErr(""); }} className="f-sans"
                title={name + (n ? `（${n}件）` : "")}
                style={{ gridColumn: x, gridRow: y, position: "relative", aspectRatio: "1", minWidth: 0, padding: 0,
                  border: on ? "2px solid #111111" : "1px solid #D8D8D8", borderRadius: 6, cursor: "pointer",
                  background: on ? "#111111" : n ? "#EFEFEF" : "#fff", color: on ? "#fff" : "#111111",
                  fontSize: 8.5, fontWeight: 700, lineHeight: 1.1, overflow: "hidden" }}>
                {name === "北海道" ? name : name.replace(/[都府県]$/, "")}
                {n > 0 && (
                  <span style={{ position: "absolute", top: 1, right: 1, minWidth: 12, height: 12, borderRadius: 6, background: on ? "#fff" : "#111111", color: on ? "#111111" : "#fff", fontSize: 8, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 2px" }}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="f-sans" style={{ fontSize: 12.1, color: "#999999", textAlign: "center", margin: "10px 0 0" }}>
          {pref ? `${pref} を選んでいます（もう一度タップで解除）` : "都道府県をタップして選んでください"}
        </p>
      </div>

      {/* ── 記録の入力 ── */}
      <div style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 16, padding: "16px 14px", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[["pest", "病害虫"], ["action", "栽培アクション"]].map(([k, l]) => {
            const on = kind === k;
            return (
              <button key={k} type="button" onClick={() => { setKind(k); setCategory(""); setFormErr(""); }} className="f-sans" style={{ flex: 1, padding: "10px 0", fontSize: 14.3, fontWeight: 700, borderRadius: 10, cursor: "pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{l}</button>
            );
          })}
        </div>
        <label className="lbl f-sans">{kind === "pest" ? "病害虫の種類" : "作業"}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {kinds.map(k => {
            const on = category === k;
            return (
              <button key={k} type="button" onClick={() => { setCategory(on ? "" : k); setFormErr(""); }} className="f-sans" style={{ padding: "7px 12px", fontSize: 13.2, fontWeight: 700, borderRadius: 16, cursor: "pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{k}</button>
            );
          })}
        </div>
        <label className="lbl f-sans">写真（任意・1枚）</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          {photo ? (
            <div style={{ position: "relative" }}>
              <img src={photo.url} alt="" loading="lazy" style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 10, border: "1px solid #E5E5E5", display: "block" }} />
              {/* ×＝写真の削除ボタン（閉じるではない＝2026-08-19の全廃の対象外） */}
              <button type="button" onClick={() => setPhoto(null)} aria-label="写真を削除" style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: "none", background: "#111111", color: "#fff", fontSize: 12, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="f-sans" style={{ width: 84, height: 84, borderRadius: 10, border: "1.5px dashed #C8C8C8", background: "#FAFAFA", color: "#999999", fontSize: 12.1, fontWeight: 700, cursor: "pointer", opacity: uploading ? 0.6 : 1 }}>{uploading ? <>追加中<Dots /></> : "＋ 写真"}</button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} style={{ display: "none" }} />
        </div>
        <label className="lbl f-sans">一言コメント（任意）</label>
        <input className="field f-sans" value={comment} onChange={e => setComment(e.target.value)} maxLength={300} placeholder="例：葉裏に発生。広がる前に対処" style={{ fontSize: 15.4, marginBottom: 12 }} />
        {formErr && <p className="f-sans" style={{ fontSize: 12.6, color: "#C0392B", fontWeight: 700, margin: "0 0 8px" }}>{formErr}</p>}
        <button onClick={submit} disabled={saving} className="f-sans" style={{ width: "100%", padding: "13px", fontSize: 15.4, fontWeight: 700, borderRadius: 12, background: "#111111", color: "#fff", border: "none", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? <>記録中<Dots /></> : "記録する"}</button>
      </div>

      {/* ── 記録の一覧（選択中の県で絞り込み・未選択は全件・新しい順）── */}
      <p className="f-sans" style={{ fontSize: 12.1, color: "#999999", fontWeight: 700, letterSpacing: ".06em", margin: "0 0 8px", borderLeft: "3px solid #111111", paddingLeft: 8 }}>
        {pref ? `${pref}の記録（${shown.length}件）` : `すべての記録（${shown.length}件）`}
      </p>
      {shown.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 16, padding: "20px 18px" }}>
          <p className="f-sans" style={{ fontSize: 13.2, color: "#999999", margin: 0, lineHeight: 1.8 }}>
            {pref ? `${pref}の記録はまだありません。上の入力から最初の記録を残せます。` : "記録はまだありません。地図から都道府県を選んで、最初の記録を残しましょう。"}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {shown.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 10, background: "#fff", border: "1px solid #E5E5E5", borderRadius: 14, padding: "12px 12px" }}>
              {p.photo_url && <img src={p.photo_url} alt="" loading="lazy" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="f-sans" style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: p.kind === "pest" ? "#C0392B" : "#00A86B", borderRadius: 10, padding: "2px 8px" }}>{p.kind === "pest" ? "病害虫" : "栽培アクション"}</span>
                  <span className="f-sans" style={{ fontSize: 14.3, fontWeight: 800, color: "#111111" }}>{p.category}</span>
                  <span className="f-sans" style={{ fontSize: 11.5, color: "#999999" }}>{p.pref}・{dateLabel(p.created_at)}</span>
                </div>
                {p.comment && <p className="f-sans" style={{ fontSize: 13.2, color: "#111111", margin: "6px 0 0", lineHeight: 1.7, wordBreak: "break-word" }}>{p.comment}</p>}
                <button type="button" onClick={() => removePost(p)} className="f-sans" style={{ marginTop: 6, background: "none", border: "none", padding: 0, fontSize: 11.5, color: "#999999", textDecoration: "underline", cursor: "pointer" }}>削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
