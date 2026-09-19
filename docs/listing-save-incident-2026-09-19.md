# 求人の掲載・途中保存の応答処理エラー（2026-09-19）

## 報告と原因

19:01の画面に「掲載エラー：TypeError: Response cannot have a body with the given status.」が表示され、掲載・途中保存が完了しないとの報告。

`src/lib/requestTransport.js` はREST応答を受信し、本文をArrayBufferにしてResponseを再構築していた。本文がないかの判定を `response.body === null` だけに依存していたため、204応答のbodyが空のストリームになるブラウザーでは `new Response(emptyArrayBuffer, {status:204})` がTypeErrorになる。

本文を返さない求人のUPDATEは掲載と途中保存の両方が使用する。サーバーで保存されても、クライアント側でエラーになり、その後の公開RPCや保存完了の遷移に到達できない。

- Fetch仕様は204・205・304等のResponseに非nullの本文を与えるとTypeErrorにする。
- MDNは、本文がないHEAD・204応答でもブラウザーがbodyをnullにしない場合を明記している。
- 修正前に空のストリームを持つ204応答を再現すると、実際の通信処理とインストール済みSupabase SDKの両方で失敗した。Nodeでの例外文は `Response constructor: Invalid response status code 204`。

資料（2026-09-19確認）:

- [Fetch: Response初期化](https://fetch.spec.whatwg.org/#initialize-a-response)
- [MDN: Response.body](https://developer.mozilla.org/en-US/docs/Web/API/Response/body#value)
- [Supabase: update](https://supabase.com/docs/reference/javascript/update)

## 修正

HEADおよび204・205・304ではHTTPの意味に従って本文をnullとして扱う。それ以外の応答は従来どおり最後まで受信する。HTTPステータス、ヘッダー、所有者の絞り込み、保存データ、権限制御は変更しない。書き込みの自動再送も追加しない。

## 検証

- `node --test scripts/request-transport.test.mjs scripts/calendar-move.test.mjs scripts/calendar-updates.test.mjs`: 33件成功。追加した2件は修正前に失敗し、修正後に成功。
- 実際のLandingFlow・jobCreateApi・Supabase SDK・通信処理を接続したJSDOM検証: 6件成功。通信先と認証だけを隔離したfixtureに置換。新規下書き、既存下書きの204更新、新規掲載、既存下書きからの掲載、保存拒否、掲載拒否を確認。保存・公開要求が各1回であることと、完了時の遷移、拒否時の画面保持も確認。
- `npm run build`: 成功。ESLintは0エラー、既存の20警告。
- 本番の求人データはテストで変更していない。iPhone実機の通信記録は取得していないため、画像の操作でどの求人が保存されたかはこの調査だけでは確定しない。

17:45のカレンダーの通信失敗は別の報告として扱う。今回の再現だけで同じ原因だったとは断定しない。先行する保存結果の再確認処理は回帰テストに含めている。

## 再発防止（2026-09-19追記）

修正時に回帰テストは追加していたが、従来の `npm run build` はESLintとViteだけで、テストを必須にしていなかった。

- `npm run test:critical` に通信処理・カレンダーの保存結果確認・日程更新の38テストをまとめ、`npm run build` の最初に実行する。1件でも失敗すればビルドを停止する。
- `vercel.json` の `buildCommand` を `npm run build` に指定し、本番・プレビューの通常のデプロイでも同じ検証を通す。
- 同じ通信処理を使うプライバシーポリシー同意のUPDATE、雇い手プロフィールのUPSERT、下書きDELETE、戻り値のないRPC、応募件数のHEAD応答を追加検証した。成功時の空応答を処理でき、書き込みが重複しないことを確認する。
- 本当のHTTPエラー、タイムアウト、カレンダーの保存結果を確認できない場合の既存テストも必須にした。確認できない状態を成功に変換する対応ではない。

検証結果: 正常なコードでは38件すべて成功し、ビルドも成功。隔離したコピーに今回の不具合を再投入すると、`npm run build` がテスト段階で終了コード1となり、配信用ファイルが生成されないことを確認した。本番データは変更していない。

この仕組みが検出するのはテストで再現した条件であり、通信切断や未知の不具合までゼロにする保証ではない。

設定資料（2026-09-19確認）: [Vercel buildCommand](https://vercel.com/docs/project-configuration/vercel-json#buildcommand)
