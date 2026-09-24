# 仕事の評価：基本3項目＋任意3項目

更新日：2026-09-25（日本時間）

働き手が仕事を振り返る画面の評価項目を3項目から6項目に増やした。
基本3項目だけでも確認・送信へ進める。追加項目は「詳しく振り返る」から開く。

| 区分 | 評価すること | 保存先 |
| --- | --- | --- |
| 基本 | 求人と実際の仕事が一致していたか | `match_level` / `as_described` |
| 基本 | 報酬が約束どおり支払われたか | `pay_status` / `paid_as_posted` |
| 基本 | またこの農家の仕事をしたいか | `want_again_choice` / `want_again` |
| 任意 | 教え方・指示が分かりやすかったか | `instructions_clear` |
| 任意 | 安全に作業できる配慮があったか | `safety_care` |
| 任意 | 約束した時間どおりに仕事が始まったか | `on_time` |

追加3項目は以前から存在する nullable boolean 列を再利用する。肯定は `true`、
否定は `false`、判断できない・未回答・回答の取り消しは `null`。
`null` を否定や肯定として数えない。確認画面には回答した任意項目だけを並べる。

既存の `reviews_public_badges` は3列すべてについて `is true` の件数を返すため、
DB構造・公開関数・権限の変更は不要。過去の肯定回答も同じ項目に集計される。
公開されるまでの待機条件と閲覧資格は従来のまま。
農家から働き手への「バイトの評価」は追加対象ではない。

## 確認

- `scripts/review-ui.test.mjs`：基本だけで完了、任意の肯定・否定・判断できない、
  確認から訂正、回答取り消し、別の仕事への切替、失敗後の再送、未払いの説明、
  共通画面を使う農家側の互換性、既存集計の表示。
- `scripts/review-db.test.mjs`：リポジトリの既存migrationをローカルPostgres互換環境に適用し、
  nullable値の保存、肯定のみの公開、双方の評価・3日間の公開待機、当事者以外の拒否を確認。
- 本番DBの管理接続は応答がなく、今回の接続による確認はできなかった。
  本番DBの変更・実データの試験投稿は行っていない。

根拠：`src/components/WorkerReviewSheet.jsx`、`FinalReviewSheet.jsx`、`ReceivedReviews.jsx`、
`supabase/migrations/20260819061155_reviews_worker_to_farmer_more_items.sql`、
`supabase/migrations/20260825154145_reviews_public_badges_waiting_count.sql`。
