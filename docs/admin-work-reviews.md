# 仕事後の評価（管理者用）

管理画面 → その他 → **仕事後の評価**（`#/admin/evaluation/reviews`）。従来の「評価」は内容に合わせて「勤務実績」に改名。

1. 「働き手 → 農家」「農家 → 働き手」を選ぶ。
2. 投稿日時・求人・当事者の表示名を確認し、「回答を見る」を開く。
3. 良い点・悪い点を別々に確認する。未選択は否定ではない。旧形式の中立・一部完了等は「その他の回答・旧項目」に表示。
4. 求人を確認するときはカード末尾のリンク。未払いが明示された場合は通報案件へのリンクも表示する。

新しい順・1ページ30件。通信失敗は「評価なし」にせず再読み込みを表示する。スコア・順位・評価の変更や削除は設けない。

## 取得経路

`AdminTab → AdminEvaluationRoom → AdminWorkReviewsRoom → admin_work_reviews`。
既存のApp管理者ゲートに加え、RPC内部でも`auth.uid()`と`app_admins`を照合。匿名実行を拒否。
仕事が完了した応募に紐づく投稿済み評価のみ返す。良い点5つ・悪い点5つの文言は利用者の回答画面と同じ`WORK_REVIEW_POINTS`を使用。
本人専用の`private_memo`・自由記述・住所・連絡先を取得しない。端末の永続キャッシュには保存しない。
既存reviewsのRLS・公開集計・利用者間の公開条件は変更しない。

## 検証

- `scripts/admin-work-reviews-db.test.mjs`：匿名拒否、非管理者拒否、返却項目、完了条件、方向別30件ページング。
- `scripts/admin-work-reviews-ui.test.mjs`：回答分類、方向切替、再試行、権限エラー、遅延応答の破棄、求人リンク。
- `npm run build`で上記を含む既存の回帰テスト・lint・本番ビルド。

本番読み取り検証：働き手→農家3件、農家→働き手4件を取得。一般ユーザーはnot_admin、匿名ロールには実行権限なし。
Supabase Advisorの「authenticatedがSECURITY DEFINERを実行可能」はこの管理RPCの意図した入口。内部のapp_admins照合で拒否されることを実測済み（[指摘の説明](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)）。
