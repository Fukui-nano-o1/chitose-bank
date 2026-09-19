// 集合場所の地図（Leaflet・分割で切り出し2026-07-24）：求人詳細・確認ページ・プレビュー共用。
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { geocodeAddressPrecise } from "../lib/geocode";
import { NavIcon } from "./NavIcons";

// 場所は赤いピン1本で示す（2026-07-31たきと指示・範囲の円は廃止）。右上にGoogleマップへの導線。
// ★座標は町域レベルの重心（geocodeTown）で、番地は含まれない＝ピンを立てても精度は上がらない。
//   ピンは「この辺り」を1点で読み取れるようにする表示上の目印。
//   正確な集合場所は従来どおり、承認後にチャットで当事者だけに伝える（CLAUDE.md・住所の段階的開示）。
// addressShown（2026-08-03たきと指示）：呼び出し側が集合場所を番地まで表示している時に true。
// 注記の「承認した方にのみお伝えします」が実態と矛盾しないよう文言を切り替える。
// ピン自体は従来どおり町域重心（番地の精度は持たない）＝位置は変えない。
//
// visitor（未ログイン）＝【枠だけ出して全部モザイク】（2026-09-19たきと指示）。
//   2026-08-05〜08-17 は「市区町村が納まる円だけ」を描いていたが、地図の絵そのものを出すのをやめた。
//   訪問者には Leaflet も国土地理院タイルも読まず、座標も外部のジオコーディングも使わない＝
//   地図の枠の中に位置情報が1ビットも無い（devtoolsでモザイクを外しても何も出ない）。
//   場所は画面の文字（市区町村名）だけが語る。
// ★訪問者かどうかは props の visitor だけでなく【本物のセッション】でも見る（下の useAuthAlive）：
//   アプリの me は端末のスナップショット（localStorage）から復元されるため、トークンが切れて
//   API上は未ログインでも me が残り、ログイン中の見た目（ピンつきの地図）を描いてしまうことがあった
//   （2026-09-19の報告「ログアウトしているのにモザイクされていない」の正体）。
//   セッションが無ければ props に関係なく訪問者として扱う＝フェイルクローズ。
//   ★ただし「トークンの更新に失敗した」（電波が無い・サーバーが応答しない）は未ログインではない
//   （2026-09-19 03:03 の報告「ログインしているのにモザイク」の正体＝端末の要求が1本もサーバーに届かない
//   状態で開いた。App.jsx のセッション復元と同じ物差し＝session も error も無い時だけ本物のログアウト）。
export function JobLocationMap({ lat, lng, radius, label, mapQuery, addressShown, visitor, cityArea }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  // 本物のセッションの有無（null＝まだ確かめていない）。確かめるまでは地図を描かない＝
  // 「一瞬だけピンが見える」を作らない（訪問者にはモザイクの枠が先に出る）
  const authAlive = useAuthAlive();
  const isVisitor = !!visitor || authAlive !== true;
  // Googleマップ導線を「必ずその場所」に着地させるための番地レベル座標（2026-08-03たきと指摘）。
  // 住所文字列を渡すとGoogle側の検索に委ねることになり、番地を持たない地域では町域の中心に着く。
  // 座標が取れた時だけそれを使い、取れなければ従来どおり住所文字列（＝劣化しない）。
  // 番地が開示されている画面（addressShown）でのみ引く＝訪問者に精密な座標を作らない
  const [preciseGeo, setPreciseGeo] = useState(null);
  useEffect(() => {
    setPreciseGeo(null);
    if (isVisitor || !addressShown || !mapQuery || !mapQuery.trim()) return;
    let cancelled = false;
    geocodeAddressPrecise(mapQuery).then((p) => { if (!cancelled && p) setPreciseGeo(p); });
    return () => { cancelled = true; };
  }, [mapQuery, addressShown, isVisitor]);

  useEffect(() => {
    // 訪問者はここに来ない（Leafletを読み込まない・タイルも要求しない）
    if (isVisitor) return;
    // 地図のJSとCSSを表示時にまとめて読む（動的import）。初期バンドルから地図ライブラリを外し、
    // CSSだけを起動・登録画面の必須依存にしない
    let cancelled = false;
    (async () => {
    if (!ref.current || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    let L;
    try {
      const [leaflet] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
      L = leaflet.default;
    } catch (e) { console.error("leaflet load:", e); return; }
    if (cancelled) return;
    try {
      if (!ref.current) return;
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const r = Number.isFinite(radius) && radius > 0 ? radius : 800;

      // 操作を全て無効化する。位置を示すための図であり、地図アプリではない。
      // モバイルでのスクロール奪取を構造的に防ぐ。
      const map = L.map(ref.current, {
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomControl: false,
        attributionControl: true,
      });
      mapRef.current = map;
      map.setView([lat, lng], 14, { animate: false });

      // 標準地図に変更（2026-07-31たきと指示「具体的に見えるように」）：淡色地図は地名・道が薄く、
      // どの辺りか読み取りにくかった。標準版は道路・施設名・地名がはっきり出る（同じ国土地理院タイル）
      // 出典表示は左下へ（2026-07-31）：既定の右下だと他の要素と重なるため。表示義務は左下でも果たされる
      try { map.attributionControl.setPosition("bottomleft"); } catch {}

      L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
        maxZoom: 18,
      }).addTo(map);

      // 範囲の円は描かない（2026-07-31たきと指示「ピンだけ表示」）。
      // rは表示の広さ（fitBounds）にだけ使う＝周辺が見える倍率は従来どおり
      // 場所のピン（divIcon＝画像を読まないので、アイコンのURL切れで消える事故が起きない）。
      // 立てる位置は町域の重心で、番地は含まない。タップは無効（地図アプリではなく位置を示す図）
      const pin = L.divIcon({
        className: "",
        html: '<div style="width:30px;height:42px;transform:translate(-15px,-42px)">'
            + '<svg width="30" height="42" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">'
            + '<path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 11.4 21.6 11.9 22.1a1.5 1.5 0 0 0 2.2 0C14.6 34.6 26 22.2 26 13 26 5.8 20.2 0 13 0z" fill="#E24B4A"/>'
            + '<circle cx="13" cy="13" r="5" fill="#fff"/></svg></div>',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([lat, lng], { icon: pin, interactive: false, keyboard: false }).addTo(map);

      // animate:false＝ズームアニメ中に地図が破棄されると _leaflet_pos クラッシュ（2026-07-16真っ暗事故）が起きるため必須
      map.fitBounds(L.latLng(lat, lng).toBounds(r * 2), { padding: [12, 12], animate: false });
    } catch (e) {
      console.error("JobLocationMap:", e);
    }
    })();

    return () => { cancelled = true; try { mapRef.current?.remove(); } catch {} mapRef.current = null; };
  }, [lat, lng, radius, isVisitor]);

  // 訪問者＝枠だけ。中はモザイク（地図の絵・タイル・座標を一切持たない）。
  // 座標が無い求人でも同じ枠＝「準備中」とも区別がつかない（訪問者に求人ごとの差を見せない）
  if (isVisitor) {
    return (
      <div>
        <div className="job-map-mosaic" data-testid="job-map-mosaic" aria-label="地図は会員登録・ログインすると表示されます"
          style={{ position:"relative", width:"100%", height:"clamp(240px, 42vw, 420px)", borderRadius:12, overflow:"hidden", border:"1px solid #EBEBEB" }}>
          {/* 確かめている間（authAlive===null）は文字を出さない＝ログイン中の人に一瞬「ログインすると」と見せない */}
          {authAlive !== null && (
            <div className="f-sans" style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding:16, textAlign:"center", pointerEvents:"none" }}>
              <span style={{ width:44, height:44, borderRadius:"50%", background:"#fff", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 8px rgba(0,0,0,0.12)", color:"#222" }}>
                <NavIcon name="lock" size={22} />
              </span>
              <span style={{ fontSize:13, fontWeight:700, color:"#222", background:"rgba(255,255,255,0.92)", borderRadius:20, padding:"7px 14px" }}>
                地図は会員登録・ログインすると表示されます
              </span>
            </div>
          )}
        </div>
        <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6, lineHeight:1.6 }}>
          場所は{cityArea || label || "市区町村"}まで。集合場所の地図と正確な位置は、会員登録・ログインすると表示されます
        </p>
      </div>
    );
  }

  if (lat == null || lng == null) {
    return (
      <div className="f-sans" style={{ padding:"24px", textAlign:"center", background:"#F7F7F7", borderRadius:12, fontSize:13, color:"#717171" }}>
        地図は準備中です
      </div>
    );
  }

  return (
    <div>
      {/* position:relative+zIndex:0でLeaflet内部のz-index(400〜1000)をこのボックス内に閉じ込める。
          無いと掲載前確認モーダル等(z-index:200)を地図が突き抜けて覆う（2026-07-14修正） */}
      <div style={{ position:"relative" }}>
        <div ref={ref} style={{ width:"100%", height:"clamp(240px, 42vw, 420px)", borderRadius:12, overflow:"hidden", border:"1px solid #EBEBEB", position:"relative", zIndex:0 }} />
        {/* 地図上の注記ボックス（本名・詳細住所は公開しません。）は削除（2026-07-31たきと指示）。
            開示の説明は地図の下の1行に残る */}
        {/* Googleマップで開く（2026-07-31たきと指示・右上に配置）：箱をタップで別タブへ。
            住所文字列（郵便番号＋都道府県＋市区町村＋町域・番地は含まない）を渡し、Google側で
            ジオコーディングさせる（2026-08-02）。緯度経度（geocodeTownの町域重心）を渡すと
            重心のずれがそのまま位置ずれになるため。mapQueryが無い旧呼び出しは従来どおり座標。
            番地を渡さない＝開示の粒度は町域のまま（CLAUDE.md・住所の段階的開示）で不変。 */}
        {/* 行き先の優先順（2026-08-03）：①番地レベルで取れた座標＝必ずその点に着く
            ②住所文字列＝Google側の検索に委ねる（番地未対応の地域では町域中心に着く）
            ③座標（町域重心）＝住所が無い旧呼び出し */}
        <a href={preciseGeo
              ? `https://www.google.com/maps/search/?api=1&query=${preciseGeo.lat},${preciseGeo.lng}`
              : (mapQuery && mapQuery.trim())
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery.trim())}`
              : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
          target="_blank" rel="noopener noreferrer"
          className="f-sans" style={{ position:"absolute", right:12, top:12, zIndex:3, display:"inline-flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"7px 13px", fontSize:12, fontWeight:700, color:"#222", textDecoration:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.16)", whiteSpace:"nowrap" }}>
          Googleマップ <span style={{ color:"#00A86B" }}>→</span>
        </a>
      </div>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6, lineHeight:1.6 }}>
        {addressShown
          ? <>ピンは{label ? label + "の" : ""}おおよその位置です（番地の位置とは少しずれることがあります）</>
          : <>ピンは{label ? label + "の" : ""}おおよその位置です（番地は含みません）</>}
      </p>
    </div>
  );
}

// 本物のセッションの有無を1回だけ確かめる（null＝未確認／true＝ある／false＝ない）。
// getSession は端末のトークンを読む。トークンが期限切れなら【更新の通信】が走り、その通信が失敗すると
// { session: null, error } を返す（auth-js 2.105 の __loadSession）＝これは未ログインではない。
// 「ない」に倒すのは { session: null, error: null }（端末にトークンが無い＝本物のログアウト）だけ。
// 例外（更新の通信が投げた）も「ログアウトではない」側＝App.jsx の復元と同じ物差し（2026-07-26）。
// ★ここを「session が無ければ全部訪問者」にすると、電波の無い場所・サーバーが応答しない窓で
//   ログイン中の人にモザイクが出る（2026-09-19 03:03 の実害）。真の未ログインは DB 側の anon マスクが
//   別に守っている（jobs_public＝訪問者には座標2桁・駅と町域は NULL）ので、ここが緩んでも位置は漏れない。
function useAuthAlive() {
  const [alive, setAlive] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => supabase.auth.getSession())
      .then((res) => { if (!cancelled) setAlive(!!res?.data?.session || !!res?.error); })
      .catch(() => { if (!cancelled) setAlive(true); });
    return () => { cancelled = true; };
  }, []);
  return alive;
}
