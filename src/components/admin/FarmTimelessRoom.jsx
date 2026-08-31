// 農タイムレス（#/admin/timeless・管理者専用）。
// 日本地図（都道府県タイル）に、病害虫や栽培アクションを写真と一言コメントで記録する運営専用の圃場ノート。
// ★委託とは無関係の独立した新プロジェクト（2026-08-31たきと指示「委託の要素は全て削除。これは新しいプロジェクト」）。
// 入口＝マイページ農家面の「農タイムレス」カード（FarmerDashboard・isAdmin限定）。配線はApp.jsxの4点セット。
// ★管理者専用の二重の壁：フロント＝App の isAdmin ゲート（safeTab==="admin"&&isAdmin(me)&&timelessRoom）／
//   サーバー＝farm_timeless_posts のRLSが app_admins 限定（閲覧・書き込みとも・migration 20260830140119）。
//   写真は専用バケット farm-timeless（書き込み=admin限定・migration 20260831061025）。
// ★日本地図は「タイル型」＝47都道府県を升目に並べた様式（SVGの実形は使わない）。
//   位置は PREF_TILES の1箇所だけが正（x=列1..11・y=行1..14）。
// ★リポートの型（2026-08-31たきと指示「Weather newsのレポートページのリポートアクションをパクれ。
//   入力アクションはチャットの入力送信設計をパクれ」）：ウェザーニュースはプロプライエタリなので
//   コードは流用せず【振る舞い】だけを写した（TimeTree・Airbnbと同じ判断）＝
//   ①下部中央に常駐の「リポートする」ピル → タップで作成パネルが下からせり上がる
//   ②カテゴリをチップで選ぶ → 写真 → コメント → 送信 → リポートが即座に一覧へ載る
//   入力送信は ChatView の実物と同じ設計＝＋の丸ボタン／rows=1で中身に合わせて伸びるtextarea
//   （上限132px・Enterは改行・送信はボタンだけ）／緑の送信ボタン／楽観表示（仮カード→本物に差し替え・
//   失敗したら取り下げて入力を戻す）。ChatView側を変えたらここも合わせる。
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { uploadJobPhoto } from "../../lib/image";
import { getCache, setCache } from "../../lib/viewCache";
import { TASK_OPTIONS } from "../../lib/utils";
import { Dots } from "../ui";
import { NavIconInline } from "../NavIcons";

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
const CHAT_INPUT_MAX_H = 132; // 入力欄の伸びの上限（ChatViewと同じ値＝約6行）

const dateLabel = (iso) => {
  try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; } catch { return ""; }
};

export function FarmTimelessRoom() {
  const [posts, setPosts] = useState(() => { const c = getCache(CK); return Array.isArray(c) ? c : []; });
  const [loaded, setLoaded] = useState(false);
  const [pref, setPref] = useState("");        // 選択中の都道府県（""=未選択・一覧は全件）
  const [composer, setComposer] = useState(false); // リポート作成パネル（下部にせり上がる・WN型）
  const [kind, setKind] = useState("pest");    // pest=病害虫 / action=栽培アクション
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState(null);    // { url } 1枚だけ
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [formErr, setFormErr] = useState("");
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // 読み込み（SWR）：前回内容を即描画→裏で最新に。失敗時は手元の値を上書きしない（2026-08-07規則）
  useEffect(() => {
    (async () => {
      const res = await supabase.from("farm_timeless_posts").select("*").order("created_at", { ascending: false }).limit(500);
      if (!res.error && Array.isArray(res.data)) {
        // 送信中の仮カード（_pending）はまだDBに無いので消さない＝ChatViewの再読込と同じ作法
        setPosts(prev => [...prev.filter(p => p._pending), ...res.data]);
        setLoaded(true);
      }
    })();
  }, []);
  // state→キャッシュの写しは1箇所（2026-07-29の作法）。読み込み前は写さない（空を焼き付けない）。
  // 仮カード（_pending）は焼かない＝失敗して取り下げた行がキャッシュに残らない
  useEffect(() => { if (loaded) setCache(CK, posts.filter(p => !p._pending)); }, [posts, loaded]);

  // 入力欄の自動伸縮（ChatViewの入力送信設計の写し・2026-08-16）：中身の行数に合わせて高さを変える。
  // 上限を超えたら内側スクロール。送信後のクリアでもcommentが変わるので、この1箇所で高さが追従する
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto"; // 縮む方向にも効かせるため、測る前に一度リセットする
    el.style.height = Math.min(el.scrollHeight, CHAT_INPUT_MAX_H) + "px";
  }, [comment, composer]);

  const countByPref = posts.reduce((a, p) => { a[p.pref] = (a[p.pref] || 0) + 1; return a; }, {});
  const shown = pref ? posts.filter(p => p.pref === pref) : posts;

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadJobPhoto(supabase, file, { bucket: "farm-timeless", pathPrefix: "timeless_", withThumb: false });
      setPhoto({ url });
    } catch (err) { alert("写真をアップロードできませんでした：" + (err?.message || err)); }
    setUploading(false);
  };

  // 送信（ChatView.send の楽観表示の写し）：仮カードを即座に一覧の先頭へ→本物の行に差し替え。
  // 失敗したら仮カードを取り下げ、入力（コメント・写真）を手元に戻して知らせる
  const send = async () => {
    if (sending) return;
    // 押せないボタンにしない＝押した時に足りないものを言う（2026-08-03の原則）
    if (!pref) { setFormErr("上の地図から都道府県をタップしてください。"); return; }
    if (!category) { setFormErr(kind === "pest" ? "病害虫の種類を選んでください。" : "作業を選んでください。"); return; }
    setFormErr("");
    setSending(true);
    const body = comment.trim();
    const savedPhoto = photo;
    const tempId = "temp-" + Date.now();
    setPosts(prev => [{ id: tempId, kind, category, pref, comment: body, photo_url: savedPhoto?.url || null,
      created_at: new Date().toISOString(), _pending: true }, ...prev]);
    setComment(""); setPhoto(null); // 場所・種別・カテゴリは続けてリポートしやすいよう保持（チャットの連投と同じ）
    try {
      const { data, error } = await supabase.from("farm_timeless_posts")
        .insert({ kind, category, pref, comment: body, photo_url: savedPhoto?.url || null })
        .select().single();
      if (error) throw error;
      setPosts(prev => prev.map(p => (p.id === tempId ? data : p)));
    } catch (e) {
      setPosts(prev => prev.filter(p => p.id !== tempId));
      setComment(prev => (prev.trim() ? prev : body));
      setPhoto(p => p || savedPhoto);
      alert("送信できませんでした：" + (e?.message || e));
    }
    setSending(false);
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
    /* cb-admin-page＝サイトフッターを隠す目印（下部バー・浮遊☰は出す・appStyles・2026-08-05）。
       独立ページなので外枠（幅・余白）も自前で持つ＝他の管理部屋（AdminWorkingRoom等）と同じ規格。
       下の余白は、常駐のリポートピル／作成パネルに一覧が隠れないぶんまで広げる */
    <div className="appear cb-admin-page" style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px", paddingBottom: composer ? "calc(340px + env(safe-area-inset-bottom, 0px))" : "calc(160px + env(safe-area-inset-bottom, 0px))" }}>
      <button onClick={() => { window.location.hash = "/profile/employer"; }} className="f-sans" style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #EBEBEB", borderRadius: 20, fontSize: 13.2, fontWeight: 600, color: "#111111", cursor: "pointer", padding: "7px 14px", marginBottom: 16 }}>← 戻る</button>
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

      {/* ── リポートの一覧（選択中の県で絞り込み・未選択は全件・新しい順）── */}
      <p className="f-sans" style={{ fontSize: 12.1, color: "#999999", fontWeight: 700, letterSpacing: ".06em", margin: "0 0 8px", borderLeft: "3px solid #111111", paddingLeft: 8 }}>
        {pref ? `${pref}のリポート（${shown.length}件）` : `すべてのリポート（${shown.length}件）`}
      </p>
      {shown.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 16, padding: "20px 18px" }}>
          <p className="f-sans" style={{ fontSize: 13.2, color: "#999999", margin: 0, lineHeight: 1.8 }}>
            {pref ? `${pref}のリポートはまだありません。下の「リポートする」から残せます。` : "リポートはまだありません。地図から都道府県を選び、下の「リポートする」から残しましょう。"}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {shown.map(p => (
            /* 送信中の仮カード（_pending）は薄く＝チャットの楽観表示と同じ見え方 */
            <div key={p.id} style={{ display: "flex", gap: 10, background: "#fff", border: "1px solid #E5E5E5", borderRadius: 14, padding: "12px 12px", opacity: p._pending ? 0.55 : 1 }}>
              {p.photo_url && <img src={p.photo_url} alt="" loading="lazy" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="f-sans" style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: p.kind === "pest" ? "#C0392B" : "#00A86B", borderRadius: 10, padding: "2px 8px" }}>{p.kind === "pest" ? "病害虫" : "栽培アクション"}</span>
                  <span className="f-sans" style={{ fontSize: 14.3, fontWeight: 800, color: "#111111" }}>{p.category}</span>
                  <span className="f-sans" style={{ fontSize: 11.5, color: "#999999" }}>{p.pref}・{p._pending ? "送信中…" : dateLabel(p.created_at)}</span>
                </div>
                {p.comment && <p className="f-sans" style={{ fontSize: 13.2, color: "#111111", margin: "6px 0 0", lineHeight: 1.7, wordBreak: "break-word" }}>{p.comment}</p>}
                {!p._pending && (
                  <button type="button" onClick={() => removePost(p)} className="f-sans" style={{ marginTop: 6, background: "none", border: "none", padding: 0, fontSize: 11.5, color: "#999999", textDecoration: "underline", cursor: "pointer" }}>削除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── リポートアクション（WNの振る舞い）＝下部中央に常駐のピル。作成パネルを開いている間は消す ── */}
      {!composer && (
        <button type="button" onClick={() => setComposer(true)} className="f-sans"
          style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(64px + 14px + env(safe-area-inset-bottom, 0px))", zIndex: 600,
            display: "flex", alignItems: "center", gap: 7, background: "#111111", color: "#fff", border: "none", borderRadius: 26,
            padding: "13px 22px", fontSize: 15, fontWeight: 800, letterSpacing: ".02em", cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
          <NavIconInline name="camera" size={17} style={{ verticalAlign: "-3px", marginRight: 0 }} />リポートする
        </button>
      )}

      {/* ── リポート作成パネル（下からせり上がる・下部バーの上にドック）──
          黒幕は敷かない＝上の地図・一覧はそのまま見え、県の選び直しもできる（モーダルにしない）。
          閉じる導線は「とじる」の文字ボタン（✕は置かない・黒幕が無いので外タップも無い） */}
      {composer && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: "calc(64px + env(safe-area-inset-bottom, 0px))", zIndex: 600 }}>
          <div style={{ maxWidth: 640, margin: "0 auto", background: "#fff", borderTop: "1px solid #E5E5E5", borderRadius: "16px 16px 0 0", boxShadow: "0 -6px 20px rgba(0,0,0,0.12)", padding: "10px 14px 12px" }}>
            {/* 見出し行：どこのリポートか＋種別トグル＋とじる */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="f-sans" style={{ fontSize: 13.2, fontWeight: 800, color: pref ? "#111111" : "#C0392B", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pref ? `${pref}のリポート` : "場所が未選択（上の地図でタップ）"}
              </span>
              {[["pest", "病害虫"], ["action", "栽培アクション"]].map(([k, l]) => {
                const on = kind === k;
                return (
                  <button key={k} type="button" onClick={() => { setKind(k); setCategory(""); setFormErr(""); }} className="f-sans" style={{ flexShrink: 0, padding: "6px 10px", fontSize: 12.1, fontWeight: 700, borderRadius: 14, cursor: "pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{l}</button>
                );
              })}
              <button type="button" onClick={() => { setComposer(false); setFormErr(""); }} className="f-sans" style={{ flexShrink: 0, background: "none", border: "none", padding: "6px 4px", fontSize: 12.1, fontWeight: 700, color: "#999999", cursor: "pointer" }}>とじる</button>
            </div>
            {/* カテゴリのチップ（横スクロール1行・WNのカテゴリ選択の型） */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 6, marginBottom: 6 }}>
              {kinds.map(k => {
                const on = category === k;
                return (
                  <button key={k} type="button" onClick={() => { setCategory(on ? "" : k); setFormErr(""); }} className="f-sans" style={{ flexShrink: 0, padding: "7px 12px", fontSize: 13.2, fontWeight: 700, borderRadius: 16, cursor: "pointer", border: on ? "2px solid #111111" : "1px solid #D0D0D0", background: on ? "#111111" : "#fff", color: on ? "#fff" : "#111111" }}>{k}</button>
                );
              })}
            </div>
            {/* 写真のプレビュー（あるときだけ）。×＝写真の削除ボタン（閉じるではない＝2026-08-19の全廃の対象外） */}
            {photo && (
              <div style={{ position: "relative", display: "inline-block", marginBottom: 6 }}>
                <img src={photo.url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 10, border: "1px solid #E5E5E5", display: "block" }} />
                <button type="button" onClick={() => setPhoto(null)} aria-label="写真を削除" style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: "none", background: "#111111", color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
            )}
            {formErr && <p className="f-sans" style={{ fontSize: 12.1, color: "#C0392B", fontWeight: 700, margin: "0 0 6px" }}>{formErr}</p>}
            {/* 入力バー（ChatViewの入力欄の写し）：＋=写真／伸びるtextarea／送信。Enterは改行・送信はボタンだけ */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="写真を追加" className="f-sans" style={{ flexShrink: 0, width: 40, height: 40, borderRadius: "50%", background: "#F0F7F3", border: "1px solid #DDEDE5", fontSize: 20, fontWeight: 700, color: "#00A86B", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, opacity: uploading ? 0.5 : 1 }}>{uploading ? "…" : "＋"}</button>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} style={{ display: "none" }} />
              <textarea ref={inputRef} value={comment} rows={1} maxLength={300} onChange={e => setComment(e.target.value)}
                placeholder="一言コメント（任意）" className="field f-sans"
                style={{ flex: 1, fontSize: 14, resize: "none", lineHeight: 1.6, maxHeight: CHAT_INPUT_MAX_H, overflowY: "auto" }} />
              <button type="button" onClick={send} disabled={sending} className="f-sans" style={{ flexShrink: 0, padding: "14px 20px", fontSize: 14, fontWeight: 600, background: "#00A86B", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", lineHeight: 1.4 }}>{sending ? "..." : "送信"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
