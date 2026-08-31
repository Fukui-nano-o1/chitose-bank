// 農タイムレス（#/admin/timeless・管理者専用）。
// 日本地図（都道府県タイル）に、病害虫や栽培アクションを写真と一言コメントで記録する運営専用の圃場ノート。
// ★委託とは無関係の独立した新プロジェクト（2026-08-31たきと指示「委託の要素は全て削除。これは新しいプロジェクト」）。
// 入口＝マイページ農家面の「農タイムレス」カード（FarmerDashboard・isAdmin限定）。配線はApp.jsxの4点セット。
// ★管理者専用の二重の壁：フロント＝App の isAdmin ゲート（safeTab==="admin"&&isAdmin(me)&&timelessRoom）／
//   サーバー＝farm_timeless_posts のRLSが app_admins 限定（閲覧・書き込みとも・migration 20260830140119）。
//   写真は専用バケット farm-timeless（書き込み=admin限定・migration 20260831061025）。
// ★日本地図は【本物の地図】（Leaflet＋国土地理院タイル＝JobLocationMapと同じ道具・2026-08-31たきと
//   「日本地図を表示できるか？ズームできるか？」）：指でパン・ピンチズームできる。
//   ★既定の表示＝拠点の徳島県を選択済みで開く（HOME_PREF・解除で日本全体）。
//   県の選択は地図上のマーカー（47都道府県の県庁所在地に置いた丸）のタップ。位置の正は PREFS の1箇所だけ。
//   県を選ぶと、その県の個々のリポート（lat/lngを持つ行）が面の色のピンで散らばり、ピンの範囲へズームする。
//   ピンのタップで日付・市町村・カテゴリ・コメントのポップアップ（2026-08-31たきと「いつどこでなにがあったか一目で」）。
//   ★JobLocationMapは「位置を示す図」なので操作を全部殺しているが、ここは地図として触る画面なので
//     dragging・ズームを生かす（升目のタイルマップは2026-08-31に本物の地図へ差し替えて廃止）。
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
import "leaflet/dist/leaflet.css";

// 47都道府県のマーカー位置（おおよその県庁所在地・lat/lng）。地図のズームに関わらず1県1点。
// 県名は地図タイル（国土地理院）自身が描くので、マーカーに文字は持たせない。
const PREFS = [
  ["北海道", 43.06, 141.35], ["青森県", 40.82, 140.74], ["岩手県", 39.70, 141.15], ["宮城県", 38.27, 140.87],
  ["秋田県", 39.72, 140.10], ["山形県", 38.24, 140.36], ["福島県", 37.75, 140.47],
  ["茨城県", 36.34, 140.45], ["栃木県", 36.57, 139.88], ["群馬県", 36.39, 139.06], ["埼玉県", 35.86, 139.65],
  ["千葉県", 35.61, 140.12], ["東京都", 35.69, 139.69], ["神奈川県", 35.45, 139.64],
  ["新潟県", 37.90, 139.02], ["富山県", 36.70, 137.21], ["石川県", 36.59, 136.63], ["福井県", 36.07, 136.22],
  ["山梨県", 35.66, 138.57], ["長野県", 36.65, 138.18], ["岐阜県", 35.39, 136.72], ["静岡県", 34.98, 138.38],
  ["愛知県", 35.18, 136.91], ["三重県", 34.73, 136.51],
  ["滋賀県", 35.00, 135.87], ["京都府", 35.02, 135.76], ["大阪府", 34.69, 135.52], ["兵庫県", 34.69, 135.18],
  ["奈良県", 34.69, 135.83], ["和歌山県", 34.23, 135.17],
  ["鳥取県", 35.50, 134.24], ["島根県", 35.47, 133.05], ["岡山県", 34.66, 133.93], ["広島県", 34.40, 132.46],
  ["山口県", 34.19, 131.47],
  ["徳島県", 34.07, 134.56], ["香川県", 34.34, 134.04], ["愛媛県", 33.84, 132.77], ["高知県", 33.56, 133.53],
  ["福岡県", 33.61, 130.42], ["佐賀県", 33.25, 130.30], ["長崎県", 32.74, 129.87], ["熊本県", 32.79, 130.74],
  ["大分県", 33.24, 131.61], ["宮崎県", 31.91, 131.42], ["鹿児島県", 31.56, 130.56], ["沖縄県", 26.21, 127.68],
];
// 日本全体が納まる範囲（北海道〜沖縄）＝県の選択を解除した時の表示
const JAPAN_BOUNDS = [[24.0, 122.9], [45.8, 146.0]];
// 拠点＝徳島県吉野川市（2026-08-31指示「デフォルトはその地域から」→「各市町村から始められるか？僕なら吉野川市だ」）。
// 開いた瞬間からこの県が選択済み＝県内のピンと一覧が最初から出て、リポート作成の場所も入っている。
// ★地図の初期表示は【市町村スケール】＝HOME_CITY を中心に zoom 12（吉野川市とその周辺が1画面に納まる）。
//   県全体を見たい時はピンチで引く。丸をもう一度タップすれば従来どおり解除＝日本全体へ。
//   拠点を変える時は HOME_PREF / HOME_CITY の2つだけ（座標はデモの市町村中心と同じ物差し）
const HOME_PREF = "徳島県";
const HOME_CITY = { name: "吉野川市", lat: 34.066, lng: 134.358, zoom: 12 };

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
// 面の色とラベル（2026-08-31たきと指示「アクションと病害虫の表示を分けろ」）：
// kind がページ全体の面＝地図のバブル・一覧・作成パネルの種別を同じ状態で切り替える
const KIND_LABEL = { pest: "病害虫", action: "栽培アクション" };
const KIND_COLOR = { pest: "#C0392B", action: "#00A86B" };
const CHAT_INPUT_MAX_H = 132; // 入力欄の伸びの上限（ChatViewと同じ値＝約6行）

const dateLabel = (iso) => {
  try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; } catch { return ""; }
};

export function FarmTimelessRoom() {
  const [posts, setPosts] = useState(() => { const c = getCache(CK); return Array.isArray(c) ? c : []; });
  const [loaded, setLoaded] = useState(false);
  const [pref, setPref] = useState(HOME_PREF); // 選択中の都道府県（既定=拠点の徳島県・""=未選択で一覧は全件）
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
  const mapEl = useRef(null);     // 地図を描くdiv
  const mapRef = useRef(null);    // Leafletの地図本体
  const layerRef = useRef(null);  // 県マーカーの層（作り直しはこの層だけ＝地図ごと作り直さない）
  const pinsRef = useRef(null);   // 個々のリポートのピンの層（県を選んだ時だけ中身を持つ）
  const LRef = useRef(null);      // 動的importしたLeaflet
  const [mapReady, setMapReady] = useState(0); // 地図ができた合図（マーカー側のeffectを起こす）

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

  // 表示は面（kind）で分ける：地図のバブルの件数も、一覧も、いまの面のリポートだけ
  const facePosts = posts.filter(p => p.kind === kind);
  const countByPref = facePosts.reduce((a, p) => { a[p.pref] = (a[p.pref] || 0) + 1; return a; }, {});
  const kindTotal = { pest: posts.filter(p => p.kind === "pest").length, action: posts.filter(p => p.kind === "action").length };
  const shown = pref ? facePosts.filter(p => p.pref === pref) : facePosts;

  // ── 本物の日本地図（Leaflet＋国土地理院タイル）──
  // Leafletは動的import（JobLocationMapと同じ＝初期バンドルに地図ライブラリを入れない）。
  // JobLocationMapと違い、ここは地図として触る画面なのでドラッグ・ピンチ・ズームを生かす。
  // ★fitBoundsは animate:false（ズームアニメ中に地図が破棄されると _leaflet_pos クラッシュ・2026-07-16事故）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let L;
      try { L = (await import("leaflet")).default; } catch (e) { console.error("leaflet load:", e); return; }
      if (cancelled || !mapEl.current || mapRef.current) return;
      try {
        LRef.current = L;
        const map = L.map(mapEl.current, {
          zoomControl: true,          // ＋−ボタン（ピンチできない環境の道）
          attributionControl: true,
          scrollWheelZoom: true,
          zoomSnap: 0.5,              // 日本全体が390px幅でも納まるよう半段ズームを許す
        });
        try { map.attributionControl.setPosition("bottomleft"); } catch {}
        L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
          maxZoom: 18,
        }).addTo(map);
        map.fitBounds(JAPAN_BOUNDS, { animate: false });
        mapRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
        pinsRef.current = L.layerGroup().addTo(map);
        setMapReady(x => x + 1);
      } catch (e) { console.error("FarmTimelessRoom map:", e); }
    })();
    return () => { cancelled = true; try { mapRef.current?.remove(); } catch {} mapRef.current = null; layerRef.current = null; pinsRef.current = null; };
  }, []);

  // 県マーカー（記録の件数・選択の見た目が変わるたびに、この層だけ描き直す）。
  // 記録あり＝黒い数字のバブル／なし＝白い小さな丸。選択中＝白フチ＋黒の外リングで浮かせる。
  // 県名の文字はマーカーに持たせない＝地図タイル自身が県名を描く（ズームすれば読める）
  useEffect(() => {
    const L = LRef.current, lg = layerRef.current;
    if (!L || !lg) return;
    lg.clearLayers();
    PREFS.forEach(([name, lat, lng]) => {
      const n = countByPref[name] || 0;
      const on = pref === name;
      const size = n ? 24 : 13;
      const ring = on ? "box-shadow:0 0 0 2.5px #fff,0 0 0 5px #111111;" : "box-shadow:0 1px 4px rgba(0,0,0,0.35);";
      const faceColor = KIND_COLOR[kind];
      const html = n
        ? `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${faceColor};color:#fff;border:2px solid #fff;${ring}display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;box-sizing:border-box">${n}</div>`
        : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${on ? "#111111" : "#fff"};border:2px solid #111111;${ring}box-sizing:border-box"></div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      // ★zIndexOffset＝県の丸を常にピンより上に。県庁近くのピン（例：徳島市）が丸に重なると
      //   解除のタップが奪われるため（実測で検出）。重なった下のピンの内容は一覧が受け持つ
      const mk = L.marker([lat, lng], { icon, keyboard: false, zIndexOffset: 500, title: name + (n ? `（${n}件）` : "") });
      mk.on("click", () => { setPref(p => (p === name ? "" : name)); setFormErr(""); });
      mk.addTo(lg);
    });
  }, [mapReady, pref, kind, JSON.stringify(countByPref)]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 個々のリポートのピン（県を選んだ時だけ）──「いつどこでなにがあったか一目で」（2026-08-31たきと指示）。
  // 面（kind）×選択中の県のリポートのうち lat/lng を持つものを、面の色の小さな点で地図に散らす。
  // タップでポップアップ＝日付・市町村・カテゴリ・コメント。★ポップアップの中身は createElement＋
  // textContent で組む（innerHTMLに利用者由来の文字列を渡さない＝HTML直挿入の禁止・2026-08-02規則）。
  // ★リポート作成では city/lat/lng は入れていない（pref のみ）＝手入力のピンは出ない。
  //   位置つきの行（いまはデモ）だけがピンになる。位置の無い行は一覧が受け持つ
  useEffect(() => {
    const L = LRef.current, lg = pinsRef.current;
    if (!L || !lg) return;
    lg.clearLayers();
    if (!pref) return;
    const faceColor = KIND_COLOR[kind];
    shown.filter(p => !p._pending && p.lat != null && p.lng != null).forEach(p => {
      const html = `<div style="width:14px;height:14px;border-radius:50%;background:${faceColor};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);box-sizing:border-box"></div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [14, 14], iconAnchor: [7, 7] });
      const mk = L.marker([p.lat, p.lng], { icon, keyboard: false });
      const box = document.createElement("div");
      box.className = "f-sans";
      box.style.cssText = "font-size:12.5px;line-height:1.6;max-width:210px";
      const head = document.createElement("div");
      head.style.cssText = "font-weight:800;color:#111111";
      head.textContent = p.category;
      const sub = document.createElement("div");
      sub.style.cssText = "color:#777777";
      sub.textContent = `${dateLabel(p.created_at)}・${p.city || p.pref}`;
      box.append(head, sub);
      if (p.comment) {
        const c = document.createElement("div");
        c.style.cssText = "color:#111111;margin-top:2px;word-break:break-word";
        c.textContent = p.comment.length > 60 ? p.comment.slice(0, 60) + "…" : p.comment;
        box.appendChild(c);
      }
      // closeButton:false＝✕は置かない（地図の別の場所をタップすると閉じる＝2026-08-19の規約に揃える）
      mk.bindPopup(box, { closeButton: false, offset: [0, -6], maxWidth: 230 });
      mk.addTo(lg);
    });
  }, [mapReady, pref, kind, posts]); // eslint-disable-line react-hooks/exhaustive-deps

  // 県を選んだらピンの範囲へズーム・解除で日本全体へ（animate:false＝2026-07-16の_leaflet_pos事故予防）。
  // 動かすのは【選択が変わった時だけ】＝投稿の増減・面の切替では、手でパン・ズームした地図を勝手に動かさない。
  // ★開いた瞬間（1回目）だけは拠点の市町村（HOME_CITY＝吉野川市）を中心に市町村スケールで始める。
  //   解除→再選択したら従来どおり県内のピンの範囲へ（県全体を見たい時の道）
  const bootViewRef = useRef(true);
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!L || !map) return;
    const boot = bootViewRef.current;
    bootViewRef.current = false;
    try {
      if (boot && pref === HOME_PREF) {
        map.setView([HOME_CITY.lat, HOME_CITY.lng], HOME_CITY.zoom, { animate: false });
        return;
      }
      if (!pref) { map.fitBounds(JAPAN_BOUNDS, { animate: false }); return; }
      const pts = facePosts.filter(p => p.pref === pref && p.lat != null && p.lng != null).map(p => [p.lat, p.lng]);
      const hit = PREFS.find(([name]) => name === pref);
      if (pts.length) {
        // ★県庁の点も範囲に含める＝解除の丸（県のマーカー）がズーム後も必ず画面内に残る
        if (hit) pts.push([hit[1], hit[2]]);
        map.fitBounds(L.latLngBounds(pts).pad(0.15), { animate: false, maxZoom: 11 });
      } else if (hit) {
        map.setView([hit[1], hit[2]], 9.5, { animate: false });
      }
    } catch (e) { console.error("FarmTimelessRoom fit:", e); }
  }, [mapReady, pref]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* ── 面の切替（病害虫⇄栽培アクション・2026-08-31たきと指示「表示を分けろ」）──
          地図のバブル・一覧・作成パネルの種別が丸ごと切り替わる。件数つき */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {["pest", "action"].map(k => {
          const on = kind === k;
          return (
            <button key={k} type="button" onClick={() => { if (kind !== k) { setKind(k); setCategory(""); setFormErr(""); } }} className="f-sans"
              style={{ flex: 1, padding: "11px 0", fontSize: 14.3, fontWeight: 800, borderRadius: 12, cursor: "pointer",
                border: on ? `2px solid ${KIND_COLOR[k]}` : "1px solid #D0D0D0",
                background: on ? KIND_COLOR[k] : "#fff", color: on ? "#fff" : "#111111" }}>
              {KIND_LABEL[k]}（{kindTotal[k]}）
            </button>
          );
        })}
      </div>

      {/* ── 本物の日本地図（国土地理院タイル・パン／ピンチズーム可）──
          丸＝47都道府県（黒い数字＝記録の件数）。タップで選択・もう一度で解除。
          ★外枠に position:relative + zIndex:0 ＝Leafletの内部z-index（コントロール1000等）を
            この箱の中に閉じ込める（下部のリポートピル・作成パネル（zIndex600）の上に漏れさせない） */}
      <div style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 16, overflow: "hidden", marginBottom: 16, position: "relative", zIndex: 0 }}>
        <div ref={mapEl} style={{ height: 360, background: "#EAF0F2" }} />
        <p className="f-sans" style={{ fontSize: 12.1, color: "#999999", textAlign: "center", margin: 0, padding: "9px 10px" }}>
          {pref ? (
            /* ★「解除」は文字ボタンでも置く＝初期表示が市町村スケールになり、県の丸（県庁の位置）が
               画面の外にあることがあるため（丸のタップでも従来どおり解除できる） */
            <>
              {pref} を選んでいます。点をタップすると内容が出ます
              <button type="button" onClick={() => { setPref(""); setFormErr(""); }} className="f-sans"
                style={{ marginLeft: 8, background: "none", border: "none", padding: 0, fontSize: 12.1, fontWeight: 700, color: "#717171", textDecoration: "underline", cursor: "pointer" }}>解除</button>
            </>
          ) : "地図は指で動かして拡大できます。丸をタップして都道府県を選んでください"}
        </p>
      </div>

      {/* ── リポートの一覧（面＝病害虫/栽培アクション＋選択中の県で絞り込み・新しい順）── */}
      <p className="f-sans" style={{ fontSize: 12.1, color: "#999999", fontWeight: 700, letterSpacing: ".06em", margin: "0 0 8px", borderLeft: `3px solid ${KIND_COLOR[kind]}`, paddingLeft: 8 }}>
        {pref ? `${pref}の${KIND_LABEL[kind]}（${shown.length}件）` : `すべての${KIND_LABEL[kind]}（${shown.length}件）`}
      </p>
      {shown.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 16, padding: "20px 18px" }}>
          <p className="f-sans" style={{ fontSize: 13.2, color: "#999999", margin: 0, lineHeight: 1.8 }}>
            {pref ? `${pref}の${KIND_LABEL[kind]}のリポートはまだありません。下の「リポートする」から残せます。` : `${KIND_LABEL[kind]}のリポートはまだありません。地図から都道府県を選び、下の「リポートする」から残しましょう。`}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {shown.map(p => (
            /* 送信中の仮カード（_pending）は薄く＝チャットの楽観表示と同じ見え方 */
            <div key={p.id} style={{ display: "flex", gap: 10, background: "#fff", border: "1px solid #E5E5E5", borderRadius: 14, padding: "12px 12px", opacity: p._pending ? 0.55 : 1 }}>
              {p.photo_url && <img src={p.photo_url} alt="" loading="lazy" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* 種別チップは面の切替で分かれたため外した（面の中では全部同じ＝繰り返しになる）。
                    カテゴリの左の小さな点が面の色を引き継ぐ */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: KIND_COLOR[p.kind] || "#999", flexShrink: 0 }} />
                  <span className="f-sans" style={{ fontSize: 14.3, fontWeight: 800, color: "#111111" }}>{p.category}</span>
                  {/* 場所は市町村まで分かればそれを出す（無ければ県）＝「いつどこでなにが」の「どこ」 */}
                  <span className="f-sans" style={{ fontSize: 11.5, color: "#999999" }}>{p.city || p.pref}・{p._pending ? "送信中…" : dateLabel(p.created_at)}</span>
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

      {/* ── リポートアクション（WNの振る舞い）＝下部中央に常駐のピル。作成パネルを開いている間は消す ──
          位置と格納の連動は .cb-timeless-report-fab（appStyles）＝下部バーが格納されたら画面下部へ降りる */}
      {!composer && (
        <button type="button" onClick={() => setComposer(true)} className="f-sans cb-timeless-report-fab"
          style={{ display: "flex", alignItems: "center", gap: 7, background: "#111111", color: "#fff", border: "none", borderRadius: 26,
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
