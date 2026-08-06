// 委託レーンの公開範囲＝【唯一のゲート】（2026-08-03たきと指示）。
// 指示：「管理者権限と同時に委託の利用特約に同意した者のみ公開する。後々、管理者権限は外す設計だ」
//
// ★解禁の手順（後日・1箇所だけ直す）：
//   canSeeConsignment の isAdmin(me) を外すと、特約同意だけが条件になる。呼び出し側は無改修。
//   ただしフロントだけ外しても実際には見えない＝【DB側も同時に開ける必要がある】：
//     consignment_deals / consignment_profiles のRLSは現在 app_admins 限定（実測確認済み・2026-08-03）。
//     UIで隠すだけにせずサーバー側でも担保する、が当プロジェクトの原則（CLAUDE.md・二重の壁）。
//   つまり解禁＝「この関数の1行」＋「RLSポリシーの張り替え」の2手。片方だけでは開かない（＝事故で漏れない）。
import { isAdmin } from "./utils";

// 委託機能利用特約の版数（本文はConsignmentRoomの定数・本文を変えたらここを上げる＝旧版の同意者に再同意を求める）。
// ここが唯一の定義。ConsignmentRoom もこれを import して使う（2箇所で持つと片方だけ上げる事故が起きる）
export const CONSIGN_TERMS_VERSION = "consignment-terms-v1-2026-08";

// 委託機能利用特約に同意済みか（版数まで一致していること）。consignor = consignment_profiles の行
export const consignTermsOk = (consignor) => !!(
  consignor &&
  consignor.consignment_terms_consent &&
  consignor.consignment_terms_consent_version === CONSIGN_TERMS_VERSION
);

// 委託を見せてよい相手か（さがすページの「委託」タブの表示条件）
export const canSeeConsignment = (me, consignor) => isAdmin(me) && consignTermsOk(consignor);
