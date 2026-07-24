// 集合場所のおおよその範囲マップ（Leaflet・円のみ・分割で切り出し2026-07-24）：求人詳細・確認ページ・プレビュー共用。
import { useEffect, useRef } from "react";
import L from "leaflet";

// 集合場所の地図。円のみを描き、ピンは立てない。
// 座標は町域レベルの重心であり、番地は特定できない。
export function JobLocationMap({ lat, lng, radius, label }) {
  const ref = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
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

      L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
        maxZoom: 18,
      }).addTo(map);

      L.circle([lat, lng], {
        radius: r,
        color: "#00A86B",
        weight: 2,
        fillColor: "#00A86B",
        fillOpacity: 0.15,
      }).addTo(map);

      // animate:false＝ズームアニメ中に地図が破棄されると _leaflet_pos クラッシュ（2026-07-16真っ暗事故）が起きるため必須
      map.fitBounds(L.latLng(lat, lng).toBounds(r * 2), { padding: [16, 16], animate: false });
    } catch (e) {
      console.error("JobLocationMap:", e);
    }

    return () => { try { mapRef.current?.remove(); } catch {} mapRef.current = null; };
  }, [lat, lng, radius]);

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
        {/* 注記は地図の高さの中央にオーバーレイ（2026-07-16） */}
        <span className="f-sans" style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%, -50%)", zIndex:1, pointerEvents:"none", background:"rgba(255,255,255,0.92)", borderRadius:20, padding:"6px 14px", fontSize:11, fontWeight:600, color:"#717171", whiteSpace:"nowrap", boxShadow:"0 1px 4px rgba(0,0,0,0.12)" }}>本名・詳細住所は公開しません。</span>
      </div>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6, lineHeight:1.6 }}>
        {label ? label + "のおおよその範囲です。" : "おおよその範囲です。"}
        正確な集合場所は、応募を承認した方にのみお伝えします
      </p>
    </div>
  );
}
