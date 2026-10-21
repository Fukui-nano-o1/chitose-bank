# 入力情報の保存管理・修正台帳

2026-10-18の調査と修正。確認時刻は日本時間で翌19日を含む。Excelではなく、GitHub内の分類・保存窓口・操作管理・回帰試験を正本として管理する。

「修正済み」は以下に特定した故障経路と試験範囲についての判定であり、全入力・全障害条件の無事故保証ではない。各PRに検証結果と本番のcommit/deployment/HTTP照合を記録する。

## 責任を分ける場所

| 責任 | 主なファイル | 管理するもの |
|---|---|---|
| 仕分け | `src/lib/jobInputFields.js`、`src/features/jobs/create/jobInputCodec.js` | 44入力列、型・変換・空値・コピー規則。所有者・公開状態・操作IDは入力から分離 |
| 求人の保管・同期 | `deviceDrafts.js`、`jobDraftProtocol.js`、`offlineSync.js`、`jobCreateApi.js` | 端末下書き、比較元、DB正本、掲載と確認記録の一体保存 |
| 共通操作の保管 | `src/lib/operationStore.js` | 所有者と操作別のIndexedDB記録、同一操作の再取得・確認後の消去 |
| プロフィール | `src/lib/profileRecord.js`、`profileAvatar.js` | 項目群ごとの比較保存、本人一致、画像の新規保管と参照確定 |
| 画像 | `src/lib/photoStorage.js`、`image.js` | バイトに対応する不変URL、保存照合、写真一覧の比較更新 |
| 本人登録・いいね | `accountHolderRecord.js`、`savedJobRecord.js` | 正本を読み直した結果で完了判定。失敗を成功表示にしない |
| コピー・当日報告・条件確認 | 各record/flow、対応するSupabase migration | 操作IDによる再送、本人と対象の一致、必須記録・通知の同時確定 |
| 委託 | `src/features/consignment/consignorRecord.js`、`consignmentRecord.js`、`consignmentAuxRecord.js` | 本人情報、案件一括保存、圃場・貸与品・特約・状態・進捗の個別操作 |
| 検証・配布 | `scripts/*-db/record/ui.test.mjs`、`.github/workflows/*-check.yml` | 故障注入、実コンポーネント、権限・競合・再送の回帰試験、マージ前CI |

ファイル名だけの分割ではなく、画面からの書込を保存窓口に寄せ、保存された内容と本人・対象・比較元を照合する。必須の複数更新はDBトランザクションにまとめる。

## 確認済みの不具合と対応

| ID | 問題 | 修正・証跡 |
|---|---|---|
| A00 | 旧同期APIの本人確認なしservice-role書込 | [PR #12](https://github.com/Fukui-nano-o1/chitose-bank/pull/12)。410/no-storeで閉鎖 |
| A01/A02 | アバターの先行削除・失敗を成功扱い | [#13](https://github.com/Fukui-nano-o1/chitose-bank/pull/13)。新画像照合→DB参照確定→旧画像整理 |
| A03/A04 | プロフィール全体の古い上書き・読込失敗を空扱い | [#14](https://github.com/Fukui-nano-o1/chitose-bank/pull/14)、[#20](https://github.com/Fukui-nano-o1/chitose-bank/pull/20)。項目群CAS、読込ゲート、所有者必須 |
| 掲載 | 掲載だけ成功して確認記録が欠落 | [#15](https://github.com/Fukui-nano-o1/chitose-bank/pull/15)。原子保存と再送照合。旧掲載RPCの一般実行を閉鎖 |
| A16 | コピー時の新規入力列欠落 | [#16](https://github.com/Fukui-nano-o1/chitose-bank/pull/16)。44列のコピー方針を検査。動画同意は再確認 |
| A11基本 | 委託の電話・標準条件・圃場が分離保存 | [#17](https://github.com/Fukui-nano-o1/chitose-bank/pull/17)、[#18](https://github.com/Fukui-nano-o1/chitose-bank/pull/18)。必要な更新を一体化 |
| A12 | ヘルプ画像の先行削除・参照切れ | [#19](https://github.com/Fukui-nano-o1/chitose-bank/pull/19)。不変画像と参照CAS。Storage削除をしない |
| A07 | コピー応答紛失後に複数下書き | [#21](https://github.com/Fukui-nano-o1/chitose-bank/pull/21)。端末操作IDとDB台帳。旧コピーRPCを閉鎖 |
| A09 | 当日報告・異議の再送で追記重複 | [#22](https://github.com/Fukui-nano-o1/chitose-bank/pull/22)。固定UUID、入力照合、通知は初回のみ |
| A08 | 初回登録の応答紛失後に完了不能 | [#23](https://github.com/Fukui-nano-o1/chitose-bank/pull/23)。本人の登録11項目一致で確認。異なる既存登録を上書きしない |
| A10 | いいね解除失敗を無視 | [#24](https://github.com/Fukui-nano-o1/chitose-bank/pull/24)。3画面共通の正本照合、失敗時表示保持 |
| A15 | 内容確認成功後の定型チャット欠落 | [#25](https://github.com/Fukui-nano-o1/chitose-bank/pull/25)。確認・スナップショット・メッセージを一体化。旧働き手分岐を閉鎖 |
| A05/A06 | 写真再送の別ファイル化、危険写真の同時追加超過 | [#26](https://github.com/Fukui-nano-o1/chitose-bank/pull/26)。バイトによる不変パス、入力ロック、最新配列の上限。委託の破壊的自動写真補修も撤去 |
| A14 | 既存の空/読取不能な勤務時間が既定時刻に変化 | [#27](https://github.com/Fukui-nano-o1/chitose-bank/pull/27)。本人が時刻を変更するまで元値を保持 |
| A11残経路 | 圃場単独・貸与品・特約・状態・進捗の不確かな保存 | [#28](https://github.com/Fukui-nano-o1/chitose-bank/pull/28)。対象キー更新、比較保存、固定操作、入力保持 |
| 旧OTP | 認証後に既存農家名をメール由来の名前へ上書き | [#29](https://github.com/Fukui-nano-o1/chitose-bank/pull/29)。全メソッド410/no-store、本番HEADで閉鎖確認 |
| 写真保守 | サムネ後埋めが利用者の写真編集を戻す | [#30](https://github.com/Fukui-nano-o1/chitose-bank/pull/30)。不変画像と写真配列CAS。反映記録はPR末尾 |
| 移行管理 | 今回の14件のSQLファイル番号と適用履歴が不一致 | [#31](https://github.com/Fukui-nano-o1/chitose-bank/pull/31)。本文一致を確認してファイル名を実履歴へ統一。DB再適用なし |
| 過去の移行管理 | 過去SQLの番号ずれ・番号重複6組 | 2026-10-21：内容一致を確認した59件の番号を修正し、全470ファイルの番号重複を解消。本文不変・旧番号再混入・全番号重複のCI検査を追加。[照合記録](historical-migration-reconciliation-2026-10-21.md)。DB再適用なし |
| A13 | 満額支払の保存値・確認・文言が不一致 | 未解決。下記の仕様判断が必要 |

## A13：先に決める契約条件

`jobs.full_pay_guarantee` の既定値はtrue、コピーは元値を継承。求人44列の入力契約には含まず、掲載プレビューはfalseを渡している。`ChatView` はtrueを「早く終わっても満額」、`LaborConditionsNotice` は同じtrueを「作業が中止になった場合も満額を支払う」と表示する。異なる場面が同じ値に結び付いている。

確認する点は、満額保証が**早期終了だけか、天候等での中止にも適用するか**、新規求人で固定条件か選択条件か。既存値を推測変更せず、方針確定後に入力/確認/公開/契約スナップショットの対応を一つにする。過去の契約を書き換える変更は別途扱う。

## 次の調査順序

下記は構造上の残課題または未検証であり、再現済みの不具合と混同しない。

1. 過去からのDB適用履歴の整理。10/21に追加59件の識別子と番号重複6組を修正済み。複数の適用履歴を合成したSQLなど、本番履歴86件の対応確認が残る。[最新の詳細](historical-migration-reconciliation-2026-10-21.md)。全件一括適用を実行しない。
2. 管理者公開・公開中編集と掲載確認記録の対象版の一致、採用/日程変更との競合。既存の状態・応募・日程試験の外側を追加検証する。
3. 質問/回答、通報/退会、管理者新規DM、地域投稿の追記再送。固定操作IDと通知重複の有無を調べる。
4. アンケート成功後のいいね部分失敗、保険確認の真の同時実行時の通知重複。
5. 旧キャッシュ画面の直接テーブル更新と古い未使用CRUD、旧画像の再圧縮。既存の共通プロフィール処理も直接権限を使うため、一括失効はしていない。
6. 過去の不一致・欠落・重複の範囲を、個人情報を持ち出さない集計で調査。推測復元や無断の履歴通知はしない。

## 検証の境界

2026-10-21に「エラー自体を潰すのではなく、想定される失敗を検証して案内を充実させる」方針へ切替。保存結果不明・競合・ログイン確認・読込失敗・端末保存失敗・保存後の確認待ちを区別する案内と、ヘルプ7項目を追加。[対象・試験・未検証範囲](expected-input-error-guidance-2026-10-21.md)。保存/権限の制約や既存の未解決記録は維持。

ローカルPostgres（PGlite）・実React・実Supabase SDKのHTTPアダプター・端末保存の隔離試験を実施。本番ではDB関数本文/権限/制約・Vercel commitとwwwの割当・配信JS・閉鎖APIのHEADを照合する。本番の利用者入力・写真・メッセージ・通知を試験で作成/変更していない。

実機2台の通信競合、実ブラウザ強制終了、2本の本物のDB接続の同時実行、メール/push到達、全過去データは未検証。別編集者の順序を交差させた試験を「実機2台の合格」とは呼ばない。

Security Advisorは2026-10-19 01:05 JSTの確認で既存199件（ERROR1/WARN183/INFO15）。今回の新RPCで増加なし。件数は再現済み脆弱性件数ではない。既存view、関数実行権限・search_path等の個別調査を残す。[Advisorの説明](https://supabase.com/docs/guides/database/database-linter)

## 今回の反映記録

PR #21〜#27は各PRの末尾に本番commit/deployment/HTTP確認を追記済み。すべてwww割当とHTTP配信を照合した。

| PR | 本番merge commit | 本番deployment | 確認時刻（JST） |
|---|---|---|---|
| #21 | `5c89bb3cfd953c3131faf7355d2798d1ce1369b2` | `dpl_E7VWVoVe7c5WyJSLYWP6NL6y16p1` | 10/19 00:15 |
| #22 | `b2a3bd980de52440541ed5c9bb60e95e54975a0d` | `dpl_GVyj7Zb18BovVA7R1FRyrfKfdKqi` | 10/19 00:29 |
| #23 | `2bca7d7aa504d659f02a54e27756c3bd4c0deb51` | `dpl_2dcVPSARsEubcuWh3RVPQXLkAQbg` | 10/19 00:39 |
| #24 | `3811a5ff39dca670a316cd63832c9571788f8501` | `dpl_84UNT7j6Y6A5hteKzKTK8ahVsPBM` | 10/19 00:42 |
| #25 | `3f7e52aa370d3476e97239c6ee443759428201af` | `dpl_4TKdPsUHeZtzT9CYMS4z8TGN8JA6` | 10/19 00:48 |
| #26 | `d64902d77fdfc941e16f0ee4b6d69996df8a6c2a` | `dpl_4AD99Ke7TgNaNhCkCmKr82N734v2` | 10/19 00:54 |
| #27 | `10dcb3bee04bf4cae12bf53a7618e29f6ef4dca1` | `dpl_7fjDwULmLhxaJW91Q26sSWjVELYv` | 10/19 00:59 |
| #28 | `380cd1698705a54faa327eaf05f17487b820d5dd` | `dpl_EnqyoQyCaZ9BPqXrKkDiADcRKi21` | 10/19 01:17 |
| #29 | `36d4f437561a593d8507eda176bdc1de825989fc` | `dpl_HaS47o1tMWp4RazUcRnKcJ7aM3Fv` | 10/19 01:21 |

#30以降の反映記録は各PRの末尾を参照する。#31はDB変更の再実行を伴わない識別子と参照の修正。

最新統合コードはローカルで659件成功、失敗/skip/TODO 0、lint0エラー・既存19警告、Vite/PWA成功。初回CIで検出した画面準備待機不足は、実際にボタンが操作可能になるのを待つ試験へ修正して再検証した。試験を省略して合格扱いにはしていない。
