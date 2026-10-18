# 旧OTP APIの閉鎖

`api/auth/verify-otp.js` はOTP認証後にservice-roleで `farmers` をupsertし、登録済みの氏名もメールの先頭部分へ書き換える構造だった。OTP未確認の書込や他人のなりすましを実証した指摘ではない。

現行 `LoginScreen` は `supabase.auth.verifyOtp` を直接呼び、登録状態を本人の `account_holders` から取得する。リポジトリ内に旧APIの呼出元・rewriteはない。閉鎖前の本番HEADは405で、POSTや実OTP送信は行っていない。旧クライアント・外部利用の全履歴は未確認。

旧APIは全メソッドで410とno-storeを返す。Supabaseクライアント、秘密鍵参照、OTP消費、セッション返却、プロフィール・認証ログ書込を撤去した。現行のログイン・新規登録・パスワード再設定の処理は変えない。

既存の旧同期APIと同じ故障試験で、環境変数なしのimport、ネットワーク呼出なし、任意/不正/遅延評価の入力を読まないこと、全メソッド・HEAD応答を確認する。本番反映後はHEADで410/no-storeを照合する。過去に上書きされた氏名は推測復元しない。
