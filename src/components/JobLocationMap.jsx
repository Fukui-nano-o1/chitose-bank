// 集合場所の地図（Leaflet・分割で切り出し2026-07-24）：求人詳細・確認ページ・プレビュー共用。
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

// 場所はピンで示し、その周りにおおよその範囲の円を描く（2026-07-31たきと指示）。
// ★座標は町域レベルの重心（geocodeTown）で、番地は含まれない＝ピンを立てても精度は上がらない。
//   ピンは「この辺り」を1点で読み取れるようにする表示上の目印で、円が実際の曖昧さを表す。
//   正確な集合場所は従来どおり、承認後にチャットで当事者だけに伝える（CLAUDE.md・住所の段階的開示）。
export function JobLocationMap({ lat, lng, radius, label }) {
  const ref = useRef(null);
  const mapRef = useRef(null);

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
        {/* 地図上の注記ボックス（本名・詳細住所は公開しません。）は削除（2026-07-31たきと指示）。
            開示の説明は地図の下の1行に残る */}
        {/* Googleマップで開く（2026-07-31たきと指示）：右下の箱をタップで別タブへ。
            渡す座標はこの地図と同じ町域の重心＝番地は渡さない（開示の粒度は変わらない） */}
        <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
          className="f-sans" style={{ position:"absolute", right:10, bottom:10, zIndex:2, display:"inline-flex", alignItems:"center", gap:6, background:"#fff", border:"1px solid #EBEBEB", borderRadius:20, padding:"7px 13px", fontSize:12, fontWeight:700, color:"#222", textDecoration:"none", boxShadow:"0 2px 8px rgba(0,0,0,0.16)", whiteSpace:"nowrap" }}>
          Googleマップ <span style={{ color:"#00A86B" }}>→</span>
        </a>
      </div>
      <p className="f-sans" style={{ fontSize:11, color:"#B0B0B0", marginTop:6, lineHeight:1.6 }}>
        ピンは{label ? label + "の" : ""}おおよその位置です（番地は含みません）。
        正確な集合場所は、応募を承認した方にのみお伝えします
      </p>
    </div>
  );
}
