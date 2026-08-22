// 役割切替の全画面アニメ（2026-08-22たきと指示「Airbnbの切り替えアニメーションをパクって」）。
// Airbnbの「ホストに切り替え」と同じ視覚言語＝白い全画面テイクオーバーの中央で、切替先の
// 役割バッジがフリップして現れ、「切り替えています」＋細い進捗バー→フェードアウトで
// 新しい面が下から現れる。実アセットは流用できない（プロプライエタリ）ため自前で描いた
// （下部ナビのNavIconと同じ判断・2026-08-22）。
// ★農家への切替はバッジの代わりに畑のシーン（2026-08-22たきと指示「耕しているアニメーションや
//   トラクターを運転しているアニメーションを追加。ランダム。」）＝マウント時に1回抽選して固定。
//   シーンは働き手切替（1.6s）より0.6秒長い（幕の寿命は appStyles の .cb-rs-scene が正）。
// ★時間の正はCSS（appStyles.js の cbRs* 群）。マウント/ハッシュ変更/アンマウントの
//   タイミングは ProfileHub の ROLE_SWITCH_MS 定数＝CSSを変えたら両方合わせること。
// 画面を覆っている間のタップは全部ここが吸う（切替途中の誤タップ防止）。
import { useState } from "react";
import { NavIcon } from "./NavIcons";
import { ROLE_ORANGE, ROLE_GREEN } from "../lib/utils";

// ── 畑のシーン（線画・stroke=役割の緑・NavIconと同じ視覚言語） ──
// 座標はviewBox(240×130)のユーザー単位。SVG子要素へのCSS transformのpxはユーザー単位に写るので、
// 走行のtranslateX・車輪のtransformOrigin（インラインstyle）はこの座標系で書いてある。
// 動きの定義はappStyles.jsの cbRsDrive/cbRsSpin/cbRsBump/cbRsPuff/cbRsSoil/cbRsHoeSwing/cbRsHoeSoil。

// トラクター：左の画面外から右へ走り抜け、通った後に耕した土の山が順に現れる。
// 土の山のdelayは走行（cbRsDrive 1.75s・-130→+150px）で後端がその位置を通過する時刻に合わせた概算。
function TractorScene() {
  return (
    <svg className="cb-roleswitch-scene" viewBox="0 0 240 130" fill="none" stroke={ROLE_GREEN}
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* 地面 */}
      <path d="M6 112h228" />
      {/* 耕した土の山（通過後に出る） */}
      <path className="cb-rs-soil" style={{ animationDelay: ".9s" }}  d="M28 112q5-8 10 0" />
      <path className="cb-rs-soil" style={{ animationDelay: "1.1s" }} d="M58 112q5-8 10 0" />
      <path className="cb-rs-soil" style={{ animationDelay: "1.3s" }} d="M88 112q5-8 10 0" />
      <path className="cb-rs-soil" style={{ animationDelay: "1.45s" }} d="M118 112q5-8 10 0" />
      <path className="cb-rs-soil" style={{ animationDelay: "1.6s" }} d="M148 112q5-8 10 0" />
      {/* トラクター本体（走行＝外のg・弾み＝内のg・車輪の回転＝さらに内＝transformを混ぜない入れ子） */}
      <g className="cb-rs-drive">
        <g className="cb-rs-bump">
          {/* 排気の煙（ループで浮かんで消える） */}
          <circle className="cb-rs-puff" cx="60" cy="34" r="4" />
          <circle className="cb-rs-puff" style={{ animationDelay: ".4s" }} cx="64" cy="26" r="5" />
          {/* 煙突（ボンネットの上）・キャビン＋ボンネット・窓 */}
          <path d="M60 62V42" />
          <path d="M26 80V50h24v12h32l10 18" />
          <path d="M32 56h12" />
          <path d="M92 80v14" />
          {/* 後輪（大）・前輪（小）＝スポークごと回る */}
          <g className="cb-rs-wheel" style={{ transformOrigin: "40px 96px" }}>
            <circle cx="40" cy="96" r="16" />
            <path d="M40 96V85M40 96l9.5 5.5M40 96l-9.5 5.5" />
          </g>
          <g className="cb-rs-wheel" style={{ transformOrigin: "94px 103px" }}>
            <circle cx="94" cy="103" r="9" />
            <path d="M94 103v-6M94 103l5.2 3M94 103l-5.2 3" />
          </g>
        </g>
      </g>
    </svg>
  );
}

// 耕す人：くわを振り上げ→振り下ろすループ。打った所で土が跳ね、後ろに耕した山が残る。
// 腕＋くわは肩(98,56)を支点にひとつのgで回す（transformOriginはインラインでユーザー単位指定）。
function HoeScene() {
  return (
    <svg className="cb-roleswitch-scene" viewBox="0 0 240 130" fill="none" stroke={ROLE_GREEN}
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* 地面と、耕し終えた土の山（後ろ側） */}
      <path d="M6 112h228" />
      <path className="cb-rs-soil" style={{ animationDelay: ".35s" }} d="M38 112q5-8 10 0" />
      <path className="cb-rs-soil" style={{ animationDelay: ".6s" }}  d="M64 112q5-8 10 0" />
      <g className="cb-rs-bob">
        {/* 人（右向き）：頭・前かがみの胴・両脚 */}
        <circle cx="96" cy="40" r="10" />
        <path d="M96 50l6 32" />
        <path d="M102 82L88 112" />
        <path d="M102 82l12 30" />
        {/* 腕＋くわ（肩を支点に振る）：腕→柄→刃 */}
        <g className="cb-rs-hoe-arm" style={{ transformOrigin: "98px 56px" }}>
          <path d="M98 56l22 8" />
          <path d="M120 64l42 30" />
          <path d="M162 94l-7 16" />
        </g>
        {/* 打った所で跳ねる土（振り下ろしの拍に同期・少しずつずらす） */}
        <path className="cb-rs-hoe-soil" d="M150 106l-3-5" />
        <path className="cb-rs-hoe-soil" style={{ animationDelay: ".06s" }} d="M158 104l1-6" />
        <path className="cb-rs-hoe-soil" style={{ animationDelay: ".12s" }} d="M166 107l4-4" />
      </g>
    </svg>
  );
}

export function RoleSwitchOverlay({ target, creating }) {
  const worker = target === "worker";
  // 農家シーンの抽選はマウント時に1回だけ（再レンダーで絵が入れ替わらないようstateの初期化関数で）
  const [farmScene] = useState(() => (Math.random() < 0.5 ? "tractor" : "hoe"));
  const color = worker ? ROLE_ORANGE : ROLE_GREEN;
  const label = worker
    ? "働き手に切り替えています"
    : creating
      ? "農家をはじめる準備をしています"
      : "農家に切り替えています";
  return (
    <div className={"cb-roleswitch f-sans" + (worker ? "" : " cb-rs-scene")} role="status" aria-live="polite">
      {worker ? (
        <div className="cb-roleswitch-badge" style={{ borderColor: color, color }}>
          <NavIcon name="profile" size={44} />
        </div>
      ) : (
        farmScene === "tractor" ? <TractorScene /> : <HoeScene />
      )}
      <p className="cb-roleswitch-label">{label}</p>
      <div className="cb-roleswitch-bar"><span style={{ background: color }} /></div>
    </div>
  );
}
