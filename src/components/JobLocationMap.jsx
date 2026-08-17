// 集合場所の地図（Leaflet・分割で切り出し2026-07-24）：求人詳細・確認ページ・プレビュー共用。
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { geocodeAddressPrecise } from "../lib/geocode";

// 訪問者に見せる円の半径（m）。1kmで「この範囲のどこか」を示す（2026-08-05たきと指示）
const VISITOR_CIRCLE_M = 1000;

// 場所は赤いピン1本で示す（2026-07-31たきと指示・範囲の円は廃止）。右上にGoogleマップへの導線。
// ★座標は町域レベルの重心（geocodeTown）で、番地は含まれない＝ピンを立てても精度は上がらない。
//   ピンは「この辺り」を1点で読み取れるようにする表示上の目印。
//   正確な集合場所は従来どおり、承認後にチャットで当事者だけに伝える（CLAUDE.md・住所の段階的開示）。
// addressShown（2026-08-03たきと指示）：呼び出し側が集合場所を番地まで表示している時に true。
// 注記の「承認した方にのみお伝えします」が実態と矛盾しないよう文言を切り替える。
// ピン自体は従来どおり町域重心（番地の精度は持たない）＝位置は変えない。
//
// visitor（2026-08-05たきと指示）：訪問者（未ログイン）に見せる時は true。
//   ピンは1点を指す絵ので「正確な位置が分かる」と読めてしまう。訪問者にはピンを描かず、
//   半径1kmの円だけで「この範囲のどこか」を示す。
//   ★訪問者に届く座標自体が既に約1.1km格子へ丸められている（jobs_public のanonマスク・
//     migration 20260803131655）＝円は表示上の目印で、円を描いても精度は上がらない。
export function JobLocationMap({ lat, lng, radius, label, mapQuery, addressShown, visitor }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  // Googleマップ導線を「必ずその場所」に着地させるための番地レベル座標（2026-08-03たきと指摘）。
  // 住所文字列を渡すとGoogle側の検索に委ねることになり、番地を持たない地域では町域の中心に着く。
  // 座標が取れた時だけそれを使い、取れなければ従来どおり住所文字列（＝劣化しない）。
  // 番地が開示されている画面（addressShown）でのみ引く＝訪問者に精密な座標を作らない
  const [preciseGeo, setPreciseGeo] = useState(null);
  useEffect(() => {
    setPreciseGeo(null);
    if (!addressShown || !mapQuery || !mapQuery.trim()) return;
    let cancelled = false;
    geocodeAddressPrecise(mapQuery).then((p) => { if (!cancelled && p) setPreciseGeo(p); });
    return () => { cancelled = true; };
  }, [mapQuery, addressShown]);

  useEffect(() => {
    // Leafletは動的import（2026-07-25）：初期バンドルから地図ライブラリを外し、地図を表示する画面で初めて読み込む
    let cancelled = false;
    (async () => {
    let L;
    try { L = (await import("leaflet")).default; } catch (e) { console.error("leaflet load:", e); return; }
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

      if (visitor) {
        // 訪問者：ピンを描かず、半径1kmの円だけを描く（2026-08-05たきと指示）。
        // 1点を指す絵を出さない＝「正確な位置が分かる画面」に見せない
        L.circle([lat, lng], {
          radius: VISITOR_CIRCLE_M,
          color: "#E24B4A", weight: 2, opacity: 0.85,
          fillColor: "#E24B4A", fillOpacity: 0.12,
          interactive: false,
        }).addTo(map);
      } else {
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
      }

      // animate:false＝ズームアニメ中に地図が破棄されると _leaflet_pos クラッシュ（2026-07-16真っ暗事故）が起きるため必須
      // 訪問者は円がちょうど収まる広さ（直径＝2km）に合わせる
      const fitM = visitor ? VISITOR_CIRCLE_M * 2 : r * 2;
      map.fitBounds(L.latLng(lat, lng).toBounds(fitM), { padding: [12, 12], animate: false });
    } catch (e) {
      console.error("JobLocationMap:", e);
    }
    })();

    return () => { cancelled = true; try { mapRef.current?.remove(); } catch {} mapRef.current = null; };
  }, [lat, lng, radius, visitor]);

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
        {/* 訪問者にはGoogleマップ導線を出さない（2026-08-05たきと指示）。
            円で範囲だけを示す画面に、外部地図で1点に着地できる出口を残さない */}
        {!visitor && <a href={preciseGeo
              ? `https://www.google.com/maps/search/?api=1&query=${preciseGeo.lat},${preciseGeo.lng}`
              : (mapQuery && mapQuery.trim())
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery.trim())}`
              : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
          target="_blank" rel="noopener noreferrer"
          className="f-sans" style={{ position:"absolute", right:12, top:12, zIndex:3, display:"inline-flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"7px 13px", fontSize:12, fontWeight:700, color:"#222", textDecoration:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.16)", whiteSpace:"nowrap" }}>
          Googleマップ <span style={{ color:"#00A86B" }}>→</span>
        </a>}
      </div>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6, lineHeight:1.6 }}>
        {visitor
          ? <>円は{label ? label + "の" : ""}おおよその範囲です（半径約1km・正確な位置は含みません）。
             正確な集合場所は、会員登録・ログインすると表示されます</>
          : addressShown
          ? <>ピンは{label ? label + "の" : ""}おおよその位置です（番地の位置とは少しずれることがあります）</>
          : <>ピンは{label ? label + "の" : ""}おおよその位置です（番地は含みません）。
             正確な集合場所は、会員登録・ログインすると表示されます</>}
      </p>
    </div>
  );
}
