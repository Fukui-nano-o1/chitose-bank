# 権限の設計・検証

このディレクトリを、操作の追加・変更時にレビューする権限の仕様とする。
基準日：2026-10-26 JST。本番スキーマと GitHub main `acac43ed` を照合し、このブランチの変更を重ねた設計。

## 読み方

- [全操作の表](authorization-matrix.md)：テーブル・ビューの各 CRUD、DB関数、ソースの呼び出し、HTTP/Edge入口、Storageバケット。
- [機械検証する仕様](authorization-contract.json)：実行権限、列権限、RLSの条件式、トリガー、関数定義のハッシュ。表と同じ内容から生成する。
- `scripts/fixtures/authorization/schema.json`：個人データを含まない本番スキーマの固定基準。メール送信だけを置き換えた試験用データ。
- `supabase/migrations/20261025173600_authorization_contract.sql`：以下の共通判定と制約を実際の保存経路に組み込む変更。

「全操作」は、基準スキーマの全 public/private テーブル・ビュー・関数、Storageのオブジェクト操作、およびリポジトリ内の呼び出しを意味する。
外部サービスの管理画面操作・全入力値の組合せ・未確認のデプロイ差分まで保証するものではない。
匿名/会員のSQL実行権限があることと、対象データにアクセスできることは別。RLS、関数内の条件、トリガーを合わせて判断する。
管理用 `service_role` / DB所有者の操作は一般会員の権限表とは別の信頼境界であり、ブラウザーへ鍵を渡さない。

## 業務上の条件と実装・テストの対応

| 操作・対象 | 操作者・対象の関係 | 変更できる内容・状態・期限 | 強制する場所 | 挙動テスト |
|---|---|---|---|---|
| 求人者の採用確認 | 応募に記録された求人者本人。停止・退会済み主体は不可 | approved/meeting/interview/contracted/working のみ。終了状態・未知状態は拒否。行をロックして確認 | `application_write_denial` → `confirm_terms` | `authorization-db`: hiring |
| 働き手の条件確認 | 本人・応募当事者 | 既存の原子的保存・再送確認・終了状態の拒否を維持 | `confirm_my_worker_terms_once` | `worker-terms-db` |
| 掲載確認記録 | 本人が所有する、その求人 | 対象求人番号と所有者を同じ行で照合 | `jpc owner insert` RLS。原子的掲載RPCにも適用 | `authorization-db`: publication / `job-publish-db` |
| 運営への会話送信 | 本人のスレッド。運営発言は現管理者のみ | 本文を新規追加。作成時刻はDBが設定 | RLS＋`guard_admin_message_history` | `authorization-db`: support |
| 運営との会話の既読 | 受信側だけ | read_atのみ。本人・発言者区分・本文・作成時刻・IDは変更不可。再送で時刻を変更しない | RLS＋履歴保護トリガー | `authorization-db`: support |
| 運営との会話の証跡 | DBが記録。会員は作成・変更できない | 本文を複写せず、操作者・行ID・種別・既読を記録。台帳保存失敗は元操作も失敗 | `audit_admin_message`＋event_audit RLS | `authorization-db`: support / admin |
| 欠勤への異議 | 欠勤を記録された働き手本人。停止中は不可 | 欠勤記録時刻から72時間未満。期限ちょうどから拒否。時刻不明は運営窓口へ | `application_write_denial`＋attendance_events BEFORE INSERT。直接登録・RPC共通 | `authorization-db`: dispute |
| 管理者としての操作 | `app_admins` の現在の会員ID | メール・user_metadata・過去JWTの役割情報は根拠にしない。名簿削除後の次のDB操作で解除 | `is_app_admin`。管理用RLSと関数の呼出者判定を共通化 | `authorization-db`: admin / admin RPC |
| 求人・応募・通常チャット | 既存の所有者・当事者条件 | 現在の状態遷移・履歴保護・入力項目制限を維持 | 各RLS / RPC / trigger。全条件はJSON | `chat-db`, `job-copy-db`, `job-publish-db`, `authorization-db`: isolation |
| 会員情報・プロフィール・緊急連絡先 | 本人・管理者・所定条件の契約当事者 | 同意・明示確認・対象列の既存条件を維持 | 各RLS / 保存RPC / 開示関数 | `account-save`, `profile-record`, `emergency-contact-db` |
| 集合場所・求人写真 | 所有者または所定条件を満たす閲覧者 | 承認前の詳細住所、非公開求人写真の制限を維持 | 住所・写真の共通判定とStorage RLS | `meeting-address-db`, `listing-photo-db` |
| 評価 | 契約当事者 | 最終作業終了から72時間未満の保存、72時間後公開。既存条件を維持 | 評価RPC・期限トリガー | `review-window-db`, `review-db` |
| プロフィール写真・ヘルプ画像 | 本人のパス、または現管理者 | 他人のパス・他人の参照先の変更を拒否 | Storage RLS・参照保存RPC | `profile-avatar`, `help-image-db`, `authorization-db`: storage |
| 委託・出荷記録・通報処理 | 権限表に記載した所有者・現管理者 | 一般公開範囲を広げず、既存の列・対象条件を維持 | 各RLS・既存RPC。管理者の根拠を統一 | `consignment-aux-db`, `consignment-deal-db`, `admin-reports`, `authorization-db` |
| 問い合わせ・計測・エラーログ | 会員本人、または専用の匿名受付条件 | 問合せトークン・同意・項目制限・送信頻度制限を維持 | 専用RPC / RLS | `support-db`, `product-analytics`, `error-throttle` |
| その他の保守・集計関数 | 全操作の表に記載するSQL実行権限と内部条件 | 一般会員からの直接変更を新設しない | SQL権限・既存関数。定義変更をCIで検知 | 契約差分検査。個別の全挙動を確認したという意味ではない |

## 共通判定の境界

1. 管理者の唯一の根拠は `app_admins.auth_id`。`public.is_app_admin()` は呼出者本人だけを調べる。対象人物が管理者かという保護条件は別であり、勝手に呼出者判定へ置き換えない。
2. 採用確認・異議申立は `private.application_write_denial(id, action)` を共用。DBから操作者・対象・状態・時刻を取得する。未知の操作名は拒否。一般会員にこの内部関数の直接実行権限を与えない。
3. 会話の履歴保護はトリガーで行い、画面・RPC・直接更新の経路を問わず同じ制約を適用する。
4. 別の業務ルールを、単一の巨大な「管理者なら全部可」判定へ押し込めない。プロフィール、評価、写真などの既存の対象別判定は維持し、権限表とテストで関連付ける。
5. UIの `isAdmin` は表示用。名簿を取得できなければ管理機能を表示しない。起動・フォーカス復帰・30秒ごとに確認する。保存時の強制判定は毎回DBが行う。

## 期限の扱い

欠勤通知の起点は `no_show_recorded_at`。`work_completed_at` は作業終了時刻のため代用しない。
新規の欠勤記録でDBが時刻を付け、クライアントから書き換えても維持する。
過去分は監査台帳の `applications.attended: new=false` の日時からだけ補完する。
監査に時刻が残っていない過去分には新しい受付期間を付与せず、`dispute_time_unknown` と案内する。
期限内に保存済みの同一リクエストを再送する場合は、期限後でも既存の保存結果を確認できる。新規の異議を期限後に作成できるという意味ではない。

## 開発時の手順

```sh
npm run test:authorization
npm run build
```

操作や権限を変更する場合は、先に許可条件と拒否条件をレビューし、挙動テストを追加する。その後にだけ次を実行する。

```sh
npm run authorization:matrix
git diff -- security/authorization-contract.json security/authorization-matrix.md
```

生成コマンドは本番へ接続せず、架空DBに変更を適用して表を作る。単に生成して差分検査を通すことを、セキュリティレビューの代わりにしない。
CIはすべてのPRとmain更新で走り、DB定義・呼出経路・HTTP入口と権限表の差分を検出する。
既存のマイグレーションを書き換えず、新しいファイルを追加する。追加分は架空DBへ順に適用して検証する。

## 適用と確認の範囲

- この変更の作成・テストでは本番へ書き込まない。マイグレーションの適用とフロントのデプロイは別工程。
- 適用前に対象定義の差分、現管理者の名簿、過去の欠勤時刻を確認する。新しい判定が正常操作を拒否しないことを確認する。
- DBを先に適用し、その後フロントを反映する。新UIは既存の `app_admins` 自分行SELECTで動作する。
- サービス鍵、メール、プッシュ、Authの署名検証と失効、Storage HTTP配信は試験DBでは再現しない。ネットワーク送信は無効化する。
- テーブル権限の網羅、主要経路の挙動確認、実環境の悪用調査は別。過去の悪用有無はこのテストでは確認できない。
- 参考：[OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。確認日：2026-10-26 JST。
