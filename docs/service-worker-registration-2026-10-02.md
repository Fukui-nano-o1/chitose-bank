# Service Worker登録の未処理例外（2026-10-02）

## 報告・確認

2026-10-02 18:56:26 JST、`/search`、未ログイン、端末分類Androidで1件。
`Rejected`のスタックは`wrsParams.serviceWorkers.navigator.serviceWorker.register`から`registerSW.js:1:98`へ続く。

main efc3c79で使用しているvite-plugin-pwa 1.3.0の自動生成登録スクリプトに失敗時の処理がないことを、コードと生成物で確認した。登録が拒否されるとglobalのunhandledrejectionに届く。
この記録だけでは実利用者の離脱、通常画面の表示停止、拒否した実行環境の詳細は確認できない。

## 修正

- `public/registerSW.js`を唯一の登録スクリプトとして追加。プラグインはこのファイルがある場合、自動生成版で上書きしない。
- `/sw.js`・scope `/`・load後の登録を維持。スクリプトがload後に到着しても登録する。
- 同期例外・Promise拒否・API getterの拒否を局所的に処理し、通常のオンライン表示を続ける。原因はconsoleの警告に残す。
- 既存ログは、登録APIとregisterSW.jsの両方を含むスタックだけを「端末・ブラウザ機能」に分類し説明する。別の`Rejected`や他の未処理例外は従来どおり検知する。
- Service Worker本体、通知処理、DB、既存エラーログの解決状態は変更しない。

## 検証

`scripts/service-worker-registration.test.mjs`: 正常登録・一回だけの登録・load後の到着・非対応環境・同期拒否・非同期拒否・getter拒否・元の原因保持・別エラーの検知を検証。
`scripts/performance.test.mjs`: 起動キャッシュ、ページ取得、通知ハンドラーの既存検証。
