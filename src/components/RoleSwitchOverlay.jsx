// 役割切替の全画面アニメ（2026-08-22たきと指示「Airbnbの切り替えアニメーションをパクって」）。
// Airbnbの「ホストに切り替え」と同じ視覚言語＝白い全画面テイクオーバーの中央で、切替先の
// 役割バッジがフリップして現れ、「切り替えています」＋細い進捗バー→フェードアウトで
// 新しい面が下から現れる。実アセットは流用できない（プロプライエタリ）ため自前で描いた
// （下部ナビのNavIconと同じ判断・2026-08-22）。
// ★時間の正はCSS（appStyles.js の cbRs* 群）。マウント/ハッシュ変更/アンマウントの
//   タイミングは ProfileHub の ROLE_SWITCH_MS 定数＝CSSを変えたら両方合わせること。
// 画面を覆っている間のタップは全部ここが吸う（切替途中の誤タップ防止）。
import { NavIcon } from "./NavIcons";
import { ROLE_ORANGE, ROLE_GREEN } from "../lib/utils";

export function RoleSwitchOverlay({ target, creating }) {
  const worker = target === "worker";
  const color = worker ? ROLE_ORANGE : ROLE_GREEN;
  const label = worker
    ? "働き手に切り替えています"
    : creating
      ? "農家をはじめる準備をしています"
      : "農家に切り替えています";
  return (
    <div className="cb-roleswitch f-sans" role="status" aria-live="polite">
      <div className="cb-roleswitch-badge" style={{ borderColor: color, color }}>
        <NavIcon name={worker ? "profile" : "sprout"} size={44} />
      </div>
      <p className="cb-roleswitch-label">{label}</p>
      <div className="cb-roleswitch-bar"><span style={{ background: color }} /></div>
    </div>
  );
}
