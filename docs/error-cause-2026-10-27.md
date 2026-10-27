# 2026-10-27 エラー原因の照合と管理画面の分類

## 結論

2026-10-27 21:44:19 JST（12:44:19 UTC）の `/search` に記録された `La` は、iPhone版Chromeが挿入したGoogle翻訳スクリプトの失敗処理と一致した。翻訳リクエストの実行または応答処理が失敗した後、元の失敗理由を捨てて `La` を返す経路である。サイトの描画失敗、Service Worker登録失敗とは区別する。

元の通信のステータス・応答・端末での操作は記録されていない。回線切断、通信の拒否、サーバー応答、応答解析のどれだったかは未確定。画面停止、翻訳先言語、実機での再現・復帰、Chrome側での修正公開も未確認。

## 一次資料とコード照合

確認日：2026-10-27。保存済みエラーの技術情報だけを使用し、ユーザーID・セッションIDは資料に含めない。

- 申告ブラウザ：iOS Chrome `CriOS/151.0.7922.57`。
- 申告OS：iPhone OS `27_0_1`。
- 発生源：`unhandledrejection`。メッセージ：`La`。
- [Googleの翻訳エントリ](https://translate.googleapis.com/translate_a/element.js?cb=cr.googleTranslate.onTranslateElementLoad&aus=true&hl=ja) が参照するビルド：`TE_20261025`。
- [日本語版翻訳ライブラリ el_main](https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.ja.CZfhvHNGWSo.O/am=AACAAQ/d=1/ed=1/rs=AN8SPfrElSgq8-PmgKbto-A8RG_jTLzCzw/m=el_main)。取得ファイルのSHA-256：`7037ed3a247dbb650761b2cc4fcee3ce2faf31d37dc4ebb871d8c1cca5987dba`。
- [Chromium issue 571648515](https://issues.chromium.org/issues/571648515) にも、iOSの翻訳コードによる `La` と翻訳通信失敗の同型報告がある。これだけを原因確定の根拠にはせず、上記配信コードと保存スタックを照合した。

| 保存されたスタック | 日本語版 el_main の対応処理 |
| --- | --- |
| `@https://www.chitose-bank.com/:518:344` | `gx` の失敗ハンドラー。`Error("La")` を新しく作りPromiseをrejectする箇所 |
| `Li@https://www.chitose-bank.com/:196:221` | generatorを再開してハンドラーを実行する `Li` |
| `@https://www.chitose-bank.com/:197:338` | generatorの `throw` 経由で `Li` に戻る箇所 |

`gx` → `fx` → `dx` が翻訳通信の経路。`fx` は `/v1/translateHtml` のPOSTと応答処理を担当し、その失敗を `gx` が `La` に置き換える。ページURLがスタックに出ていても、サイト配信コードの発生とは限らない。

## 失敗経路の再現

Google配信ファイルを変更せず取得・ハッシュ照合した後、検証用コピーの同じクロージャ末尾にテスト入口を追加。元の `gx` はそのまま実行し、呼び出し先 `fx` だけを失敗するPromiseに差し替えた。JSDOMの外部リソース読み込みは無効、fetchとXMLHttpRequestも失敗させ、外部へデータを送信していない。

原コードから `Error: La` が返り、V8では `518:339 → Li 196:220 → 197:336` のスタックを再現した。WebKitとV8では呼び出し位置の列の表現が異なるため、保存されたWebKitの列位置は元コードの該当式とも直接照合した。これはGoogleの失敗ハンドラーの再現であり、利用者のiPhoneや実際の通信状態の再現ではない。

再実行：上記ライブラリをローカルに保存し、`node scripts/verify-google-translate-la.mjs <取得ファイル>`。Googleコード自体はリポジトリに収録しない。

## Service Workerの4件

保存スタックの `serviceWorker.register` と `registerSW.js:1:98` は、登録が拒否され旧登録スクリプトが失敗を処理しなかった経路。GooglebotというUA申告だけでGoogleの実アクセスとは認定しない。

2026-10-27に本番の `/registerSW.js` を取得し、同期例外とPromise拒否の両方を捕捉する現行コードを確認した。既存の回帰検証でも拒否後にページ処理が継続する。10月16日の端末が読んだファイルは保存されていないため、旧キャッシュ・巡回側の再利用等の詳細は断定しない。既存記録は削除・自動解決しない。

## 表示の変更

- 大分類を9種類へ分離：描画失敗、JavaScript実行、非同期処理、端末・ブラウザ、JS/CSS読み込み、DB・権限、通信、ログイン・メール、原因未特定。
- 各記録に細分類、判定の確度・根拠、発生元、表示への影響、ブラウザ名・版を表示。報告文のコピーも同じ診断を使用する。
- `La` はメッセージ単独で判定しない。iOS Chrome、未処理Promise、ページURL、3フレームの行・列、`Li` 関数名が一致した型だけを「コード照合済み」とする。近い型は候補、その他は原因未特定として残す。
- `error_boundary` の記録と、`window.onerror`・`unhandledrejection` を区別する。後者だけで画面が停止したとは表示しない。
- スタックを初回取得することで、一覧の表示・展開・コピーで分類が変わる問題を解消。同じメッセージでも別の細分類は別グループにし、一括解決の対象を混ぜない。
- DB通知の既存署名は維持。旧署名が複数グループに分かれる場合は、特定の一群を勝手に選ばず一覧に着地する。
- 読み込み失敗を「記録なし」と表示せず、再試行を案内する。

DBスキーマ、RLS、エラー収集・除外条件は変更しない。保存済みエラーの解決状態も変更しない。

## 検証

- 分類：一致・不一致、別ブラウザ・別スクリプト、追加フレーム、DB数値コード、原因不明の保持。
- 実コンポーネント：Viteで組み立ててJSDOM上で一覧、展開、コピー、分類ごとの解決、読込失敗・再試行、旧通知からの遷移を検証。DB呼び出しは合成データに限定。
- 既存Service Worker・Googlebot分類の回帰検証。
- `npm run build`：全criticalテスト837件成功、ESLintエラー0（変更箇所以外の既存警告19件）、本番ビルド成功。最終文言修正後も関連20件・全ESLint・Viteビルドを確認。

管理画面の検証は合成データを使ったDOM検証。実機Safari・Chromeの表示操作の確認を代替するものではない。
