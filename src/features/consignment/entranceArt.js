// 委託ページの入場演出（草むら・蔓・空の描画データ）。
// 第2次構造改革2026-08-17で ConsignmentRoom.jsx から分離・中身は不変。
// ★演出だけの層＝業務ロジックを混ぜない。振り付け（生える時刻・幕が開く1.75s）の規則は
//   CLAUDE.md 2026-08-05 の記載を参照。delay を足すときは幕に間に合うか式で確認すること。
import { VINE_CORNER_STEMS, VINE_CORNER_LEAVES } from "../../components/ui";

// 三角形でなくSVGの手書きパスで描く。stem=茎、leaves=[中心x, 中心y, 傾き°]（viewBox 0 0 40 80・葉は楕円）
export const CONSIGN_SPRIGS = [
  { stem: "M20 80 C20 58 20 32 20 6",
    leaves: [[12,64,38],[28,56,-38],[12,46,40],[28,38,-38],[13,28,36],[27,20,-36],[20,7,90]] },
  { stem: "M14 80 C16 60 24 38 29 8",
    leaves: [[9,60,40],[30,50,-35],[11,40,42],[32,30,-33],[16,22,40],[29,9,-75]] },
  { stem: "M22 80 C22 68 21 56 20 44",
    leaves: [[15,66,38],[28,60,-36],[14,52,40],[27,47,-38],[20,44,85]] },
];
// 群れの土台（振り付けは固定：右→左→右の順に下から上へ・2026-07-31たきと指示）。
// 中央に寄って見えないよう、株の根元は必ず端の側に置く（右群れ=右端0〜38%・左群れ=左端0〜38%。
// 負値も許す＝画面外へはみ出してよい）。panel=どちらの幕に所属するか（幕が開くとき群れごと退場）。
// 順番はまず太陽→次に草（2026-07-31たきと指示「まず太陽を出してから草を出そう」）。
// 2026-08-05たきと指示で草の群れを1つ増やし2→3に＝右→左→右の振り付けがこれで一周する
// （②右下→③左中→④右上）。最後の群れは 1.15s+株ごとのずれ0.12s+生える0.34s≒1.61s で出揃い、
// 幕が開く1.75s（CSS .consign-entrance-top/bottom の animation-delay）に間に合う
export const CONSIGN_CLUSTER_BASES = [
  { panel: "top",    anchor: "right", bottomMin: 0,  bottomMax: 20,  delay: 0.10, kind: "sun" }, // ①上段＝白い太陽が先
  { panel: "bottom", anchor: "right", bottomMin: 0,  bottomMax: 10,  delay: 0.45 }, // ②右・下段（草）
  { panel: "bottom", anchor: "left",  bottomMin: 55, bottomMax: 75,  delay: 0.80 }, // ③左・中段（草）
  { panel: "bottom", anchor: "right", bottomMin: 85, bottomMax: 100, delay: 1.15 }, // ④右・上段（草・2026-08-05追加）
];
// 草の大きさの倍率（2026-08-05たきと指示「全体的に0.8倍の大きさに」）。
// ★草だけに掛ける＝太陽と花火は対象外（同指示「太陽と花火に変更はない」）ので
//   sunSize・花火のsize等には触れない。大きさを直すときはこの1箇所を変える
export const CONSIGN_GRASS_SCALE = 0.8;
// 入場のたびに草の配置を抽選する（2026-07-31たきと指示「毎回違うパターン」＝ここは意図的に乱数。
// 以前の「決め打ち＝再現性」はこの指示で上書き）。全てのパターンを毎回変える（たきと指示）：
// 群れごとの大きさの基準・株の種類・本数・高さ・左右の向き・傾き・位置ずれ・生える時間差。
// 高さは最大420px前後（3倍→実機で大きすぎたため良い塩梅に再調整・2026-07-31）＝先端の画面はみ出しは許容のまま
export const makeConsignGrass = () => {
  const r = (min, max) => min + Math.random() * (max - min);
  return CONSIGN_CLUSTER_BASES.map(c => {
    // 夏仕様：上段は白い太陽（2026-07-31）と花火（2026-08-03たきと指示）を入室ごとにランダムで
    // 出し分ける（交互＝どちらも消さない）。太陽＝爛々と輝く昼、花火＝5〜7発上がる夜
    if (c.kind === "sun") {
      if (Math.random() < 0.5) {
        return {
          panel: c.panel,
          kind: "sun",
          delay: c.delay,
          sunSize: Math.round(r(210, 280)),   // 太陽の直径px（爛々と大きめ）
          sunTop: +r(7, 17).toFixed(1),       // 上幕の上端からの位置%
          sunLeft: +r(40, 64).toFixed(1),     // 横位置%（中央やや右）
        };
      }
      // 花火：1発＝打ち上げの尾（下から炸裂点まで昇る）＋炸裂（閃光＋光条＋粒）。
      // 位置・大きさ・玉数・間合いは入室ごとに抽選＝毎回違う夜空になる
      const n = 5 + Math.floor(Math.random() * 3); // 5〜7発
      return {
        panel: c.panel,
        kind: "fireworks",
        shells: Array.from({ length: n }, (_, i) => {
          const riseDur = +r(0.38, 0.52).toFixed(2);
          return {
            left: +r(12, 88).toFixed(1),          // 炸裂点の横位置%
            top: +r(16, 62).toFixed(1),           // 炸裂点の縦位置%（上幕の中）
            rise: Math.round(r(120, 260)),        // 打ち上げの高さpx（尾が昇る距離）
            riseDur,
            delay: +(c.delay + i * r(0.11, 0.17)).toFixed(2), // 続けざまに上がる
            size: Math.round(r(130, 210)),        // 炸裂の直径px
            rays: 16 + Math.floor(Math.random() * 8) * 2,     // 光条の数（16〜30・偶数）
            spin: Math.round(r(0, 22)),           // 玉の向き（回転°）
            burstDur: +r(0.8, 1.0).toFixed(2),    // 消えるまで
          };
        }),
      };
    }
    // 群れごとの大きさの基準（実機確認で縮小・2026-07-31「良い塩梅に」／2026-08-05に0.8倍）。
    // 基準も上限も同じ倍率を掛ける＝上限だけ据え置いて背の高い株ばかりが上限に張り付くのを防ぐ
    const size = r(160, 300) * CONSIGN_GRASS_SCALE;
    return {
      panel: c.panel,
      anchor: c.anchor,
      delay: c.delay,
      pos: { bottom: r(c.bottomMin, c.bottomMax).toFixed(1) + "%" },
      sprigs: Array.from({ length: 6 + Math.floor(Math.random() * 5) }, () => ({ // 6〜10株（3〜5株の倍・2026-07-31たきと指示）
        v: Math.floor(Math.random() * CONSIGN_SPRIGS.length),
        h: Math.round(Math.min(420 * CONSIGN_GRASS_SCALE, r(size * 0.7, size * 1.3))),
        x: +r(-8, 38).toFixed(1),           // 端からの寄せ%（負値=画面外へはみ出す）＝右左の分離
        y: Math.round(r(0, 44)),            // 根元の縦ゆらぎpx（一直線に並ばない）
        flip: Math.random() < 0.5,          // 左右反転（同じ形でも景色が変わる）
        tilt: Math.round(r(-10, 10)),       // 株ごとの傾き（°・根元を軸に）
        d: r(0, 0.12),                      // 群れの中の生える時間差（ステップの区切りを崩さない範囲）
      })),
    };
  });
};

// ページ背景の蔓（2026-07-31たきと指示・同日修正：たきと提供の蔓イラストのイメージに準拠）。
// うねる茎＋渦巻きのツル（先端と枝先がくるりと巻く）＋葉。上端から吊るす前提の向きで描く。
// stems=茎とツルのパス（複数）、leaves=[中心x, 中心y, 傾き°]（viewBox 0 0 60 120・葉は楕円）
export const CONSIGN_VINES = [
  { stems: [
      "M30 0 C26 18 40 30 34 46 C28 62 42 70 36 86 C32 96 24 102 26 110 C27 116 35 118 37 112 C38 108 33 106 32 110",
      "M34 46 C46 48 54 42 52 34 C50.5 28 43 28.5 44.5 34.5 C45.5 38 50 37 49.5 33.5",
    ],
    leaves: [[22,24,-40],[40,36,35],[24,56,-38],[44,64,30],[27,84,-36],[36,96,40]] },
  { stems: [
      "M18 0 C26 16 10 30 18 46 C25 60 40 62 44 74 C48 86 38 94 30 88 C24 83 28 73 35 76 C39 78 38 83 34 83",
      "M18 46 C10 48 4 42 7 35 C9 30 15 32 13 37",
    ],
    leaves: [[26,12,35],[10,28,-40],[26,40,38],[36,58,30],[48,70,-30]] },
  { stems: [
      "M42 0 C38 14 48 22 44 34 C40 46 26 48 24 60 C22 70 32 75 36 68 C38 63 33 59 30 63",
      "M44 34 C52 36 58 30 55 23 C53 18 47 20 49 25",
    ],
    leaves: [[34,8,-35],[50,16,30],[34,28,-38],[30,44,35],[18,54,-30]] },
];
// 四隅の蔓（2026-07-31たきと指示「四隅に蔓を這わしてほしい」）：角を抱くように這う飾り蔓。
// 左上向きに1種だけ描き、他の3隅は左右・上下の反転で使い回す。viewBox 0 0 120 120。
// パスの正本は components/ui の VINE_CORNER_*（入口カードの蔓と同じ形＝二重管理しない）
export const CONSIGN_CORNER_VINE = { stems: VINE_CORNER_STEMS, leaves: VINE_CORNER_LEAVES };

// 配置は入室ごとに抽選
export const makeConsignVines = () => {
  const r = (min, max) => min + Math.random() * (max - min);
  return Array.from({ length: 6 + Math.floor(Math.random() * 4) }, () => ({ // 6〜9本
    v: Math.floor(Math.random() * CONSIGN_VINES.length),
    x: +r(-4, 96).toFixed(1),            // 横位置%（負値=左へ少しはみ出す）
    h: Math.round(r(120, 340)),          // 垂れる長さ
    flip: Math.random() < 0.5,
    dur: +r(4.5, 7.5).toFixed(1),        // 揺れの周期s（1本ずつ違う=風のばらつき）
    delay: +r(0, 3).toFixed(1),
  }));
};

// 現在のJST時刻から、太陽（昼）／月（夜）の位置（左→右）と空の色（朝昼夕夜）を決める。
// 昼＝5〜19時（14h）で太陽が左8%→右92%へ弧を描く。夜＝19〜翌5時（10h）は月が左→右。
export const computeSky = (now) => {
  const jst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
  const h = jst.getHours() + jst.getMinutes() / 60;
  const arc = (prog) => 20 - Math.sin(prog * Math.PI) * 13; // 上端からの位置%（20→7→20＝昇って沈む）
  const leftOf = (prog) => 8 + prog * 84;                    // 横位置%（8→92）
  if (h >= 5 && h < 19) {
    const prog = (h - 5) / 14;
    let skyTop, orb, glow, chrome;
    // chrome＝skyTopを白地に重ねた不透明色。画面最上端（ステータスバー/ブラウザの帯）を空と同色に染める用
    if (h < 10)      { skyTop = "rgba(255,214,168,0.55)"; orb = "#FFC46B"; glow = "rgba(255,196,107,0.55)"; chrome = "#FFE8CF"; } // 朝
    else if (h < 15) { skyTop = "rgba(198,228,255,0.50)"; orb = "#FFE27A"; glow = "rgba(255,226,122,0.60)"; chrome = "#E3F1FF"; } // 昼
    else             { skyTop = "rgba(255,176,124,0.55)"; orb = "#FF8A4C"; glow = "rgba(255,138,76,0.55)"; chrome = "#FFD4B7"; }  // 夕
    return { isNight: false, left: leftOf(prog), top: arc(prog), skyTop, orb, glow, chrome };
  }
  const prog = (((h - 19) + 24) % 24) / 10; // 夜（19→翌5）
  // 月齢（実際の欠け加減を再現・2026-07-31たきと指示）：既知の新月（2000-01-06 18:14 UTC）からの
  // 経過日数を朔望月（29.530589日）で割った端数。0=新月・0.5=満月
  const synodic = 29.530588853;
  let moonPhase = ((now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % synodic / synodic;
  if (moonPhase < 0) moonPhase += 1;
  return { isNight: true, left: leftOf(prog), top: arc(prog), skyTop: "rgba(28,32,60,0.60)", orb: "#E8ECF5", glow: "rgba(200,210,235,0.50)", chrome: "#77798A", moonPhase };
};
