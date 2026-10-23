# 掲載フロー刷新の作業境界（2026-10-21）

最初に docs/uiux/listing-flow-redesign.md を読む。現在の合意は「1ページ＝1種類の入力・判断」。
ルートAGENTS.mdや古いPROGRESS.mdに残る過去のページ構成ではなく、この合意と現行コードを基準にする。

- 各PRで着手する段階・完了条件・触らない処理を宣言する。別課題を同梱しない。
- 第1弾は共通基盤のみ。第2弾は日程/休日/採用人数。順番を飛ばさない。
- 新規/コピー/下書き再開/公開中編集で同じページIDと部品を使う。
- 進捗番号をそのままずらさない。flowSteps.jsの旧番号表は固定し、世代不明は推測しない。
- listingPagePlan.jsの分割先は第1弾では未有効。LandingFlowの番号判定・保存範囲・ルーティングを接続するまでFARMER_FLOWを並べ替えない。
- 保存列、競合保護、最低賃金、公開権限、掲載同意記録、管理者通知は画面刷新で変更しない。
- draft_step_idは保存比較の契約。再び比較項目から落としたり、未取得値を補ったりしない。
- 入力stateと保存は親で維持し、共通枠は表示のみ。入力用ボックスの全画面化だけを独立ページ完成と呼ばない。
- コンポーネントはモジュールレベルに定義する。保存の完了を未確認のまま表示しない。
- 新テストをtest:criticalに含め、npm run buildを通す。実機未検証は未検証と記録する。

## 第2弾の引継ぎ（2026-10-22）

- 日程/休日/人数の3ページを実装済み。次は第3弾に限定する。
- 現在の画面順序は listingNavigation.js の ACTIVE_LISTING_FLOW。flowSteps.js の FARMER_FLOW と番号表は旧保存契約のため維持する。
- useListingNavigation が農家の固定ID・URL・履歴・確認画面への帰路を扱う。親Appから番号URLで上書きしない。
- 端末専用の listingPageId/listingNavVersion/listingReturnToReview をDB入力列へ混ぜない。サーバーの draft_step_id は引き続き比較専用。
- 旧DB下書きからは休日の確認済み状態を推測しない。同期済み端末から復元できるのは同一求人のページ位置だけで、入力・比較元を上書きしない。
- 完了は通信結果確認後のみ。URLや下書きから完了画面を復元しない。
- tests: listing-schedule.test.mjs / listing-schedule-ui.test.mjs。新たな分割時にも入力保持・旧番号・履歴・確認への帰路を残す。

## 第3弾の引継ぎ（2026-10-23）

- 基本情報の9種別を独立ページ化済み。次は第4弾だけに限定する。
- 作業2/場所3/勤務条件4ページのDB番号は旧2/3/5のまま。番号表をずらさない。
- `terms` は旧URL専用。実ページは work_time/break_time/overtime/daily_wage。旧端末世代を明示変換し、不足項目から復帰する。
- 日給の時間・休憩表示は確認用。変更は専用ページへ移動する。最低賃金算式を今回のUI分割で変更しない。
- accessのスキップはaccessだけ。通常/確認からの編集/補助ページの往復を同じ履歴契約で扱う。
- listing-basics.test.mjs / listing-basics-ui.test.mjs / listing-basics-browser.mjsを次段階でも維持する。
- 物理端末検証と本番反映は未実施。第4弾で基本情報を再設計し直さない。
