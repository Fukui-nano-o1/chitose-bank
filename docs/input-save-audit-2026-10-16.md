# 入力・保存経路の全体監査

確認日: 2026-10-16、23:32〜23:42 JST。実装の修正・本番データへの書き込み・デプロイは行っていない。

**判定: 根本解消は未完了。本番反映を安全と判断できない。** 求人の保存契約を整理する方向は正しいが、プロフィール、画像、旧API、コピー、付随記録にも同じ保証を広げる必要がある。ファイルを分けるだけでは、原子性・本人確認・再送・競合の問題は解消しない。

## 対象と証拠の区分

- 対象コード: PR #10 `0354b15c2fda09a39634ab0eb0c49282511a4c6a`。ローカル対応コミット `1cb49dbd7cea1b3df3d574ddceeb06466362e909`。両者のtreeは `20f378822e7a2be70d3cd184e023925b5e1fc18e`。
- `src` の214ファイル、`api` の4ファイル、Supabase Edge Functionの1ファイル、計219ファイルを構文解析。HTML入力部品の宣言169箇所、DB書込87箇所、Storage書込17箇所、RPC呼出113箇所、サポートRPCラッパー6箇所、端末保存93箇所、認証操作8箇所を抽出した。
- これは**静的な呼出箇所数**。RPCには読み取りも含む。入力部品には共通部品・動的繰返し・非表示経路が含まれるため、169を業務入力項目数とは扱わない。行単位の索引は [input-path-inventory-2026-10-16.json](input-path-inventory-2026-10-16.json)。間接呼出はサポート、チャット、写真、求人APIの呼出元も照合した。
- **再現**: 実ソースから抽出した処理に模擬失敗を与えたもの。コピーは実migration内の関数をPGliteで実行。22ケースで不具合の挙動を再現した。React画面全体・実Supabase通信・全トリガー込みの再現ではない。
- **構造確認**: コード／本番の定義から経路を確認したが、その条件の故障試験は未実施。
- **既存試験通過**: `npm run build` の334試験が通過、失敗・skip・TODOは0。ESLintは0エラー、既存警告19。Vite/PWAビルド成功。この通過は追加発見の不存在を意味しない。

再現結果は [input-reproduction-results-2026-10-16.json](input-reproduction-results-2026-10-16.json)。この診断スクリプトの正常終了は「不具合を再現できた」の意味であり、製品の合格ではない。通常CIには組み込んでいない。

## 本番との照合

| 確認対象 | 読み取りで確認した結果 |
|---|---|
| GitHub main | `aa2abb0465e519b567c08f1758a3f751e86d09a5` |
| 本番 `www.chitose-bank.com` | Vercel production `dpl_7xqDcTCWR3kPZDd95c3fwa7mVeL2`、上記mainを配信、READY |
| PR #10 | open、未マージ。掲載・確認記録の一体保存は本番未反映 |
| 本番DB | `aegwepgtmwcnwzybpgsh`。`publish_my_job_with_check` は全シグネチャを検索して0関数。最新migration記録は `20261009124614` |
| 公開中求人 | 2件。確認記録が1件もない求人は0件。ただし現在の入力と確認内容の一致、過去の全欠落はこの集計では判定しない |
| 満額支払フラグ | `jobs.full_pay_guarantee` はNOT NULL、既定値true。公開中2件ともtrue |
| アバター参照 | 対象バケットのURLを持つ雇い手5件・働き手4件。Storageメタデータに対応ファイルのない参照は0件。過去の消失や画像内容の一致までは証明しない |
| RLS | publicの59テーブルはすべて有効。RLSが有効というだけで各ポリシーの正しさを保証しない |
| 旧同期API | 本番 `/api/sync-farmer` へのHEADがHTTP 405、`Cache-Control: no-store`。関数の到達性を確認。POST・本番更新は試していない |

上記に個人の氏名・住所・電話・画像・入力本文は取得／掲載していない。集計とカタログ情報だけを使用した。

再確認用の読み取り専用SQL: [input-save-audit.sql](../supabase/checks/input-save-audit.sql)。本番の画像・求人集計は現在の断面に限る。

## 不具合と修正優先度

P0は最優先の権限経路、P1はデータ消失・条件不整合、P2は重複・復旧・表示の不整合。

| ID | 優先度 | 対象・問題 | 証拠と影響 |
|---|---|---|---|
| A00 | P0 | 旧 `api/sync-farmer.js` に本人確認がない | **再現**。認証ヘッダーなしの処理がservice-roleクライアントの `farmers.upsert` に到達し200。メールを入力キーとして名前を書き換える。本番mainにも同じコード、HEADで到達性確認。ただし本番POSTの成功／被害発生は未確認 |
| A01 | P1 | 雇い手・働き手の画像差替えで旧画像を先に削除 | **再現**。新画像のupload失敗時に旧ファイルもなくなる。`EmployerProfileEdit.handleAvatar` / `WorkerProfileEdit.handleAvatar` |
| A02 | P1 | 画像保存・削除のDBエラーを無視、存在確認だけでupload成功とする | **再現**。DB拒否でも表示更新・通知なし。さらに旧 `avatar.jpg` が残った場合、2回uploadが失敗しても `avatarUpload.js` は成功を返す。ファイルの存在は今回の保存の証明にならない |
| A03 | P1 | プロフィールが全項目upsert、版数照合なし | **再現**。働き手の端末Aが移動手段を変更後、古い端末Bが住所を保存するとAの変更が戻る。雇い手も同型を構造確認。本番プロフィールのトリガー／ポリシーに期待版数の照合なし |
| A04 | P1 | 読込失敗を未登録・空欄として扱える | **再現**。働き手プロフィール、経験、保険準備で、読込エラー後の保存が既存選択を空にする。雇い手・緊急連絡先・別の保険画面にも同型。特に緊急連絡先は失敗を行なし扱いして本人情報へ戻す構造 |
| A05 | P2 | 求人写真の応答紛失後、再試行で別ファイルを作成 | **再現**。`uploadJobPhoto` は毎回別名。保存済み応答を失って再実行すると2オブジェクトになり、戻るURLは後者だけ。委託・圃場写真も共通関数を使用 |
| A06 | P2 | 危険写真の同時追加が上限を超える | **再現**。古い `place.photos.length` を各処理が使い、同時2回×2枚で4枚保存。表示枠は2枚。アップロード中の退場・保存との競合も構造上残るが、その画面全体の再現は未実施 |
| A07 | P2 | 求人コピーの再送で複数下書き | **実SQL再現**。同じコピー関数を2回呼ぶと別IDを作る。UIは実行中連打を防ぎ応答不明を案内するが、再試行を同一操作へ結び付ける永続IDがない |
| A08 | P2 | 初回登録の応答紛失を照合しない | **再現**。DB登録済みで失敗表示後、押し直すと23505になり完了しない。二重登録自体は本番のauth_id一意制約で防止される。再読込等の別経路で復旧する可能性はある |
| A09 | P2 | 当日報告の再送で同じ記録を追加 | **再現＋本番制約照合**。`DayReportSheet.submit` の送信行に操作IDなし。応答紛失後の再送で2件。本番 `attendance_events` はID主キーのみで、業務キーの一意制約／重複排除トリガーなし。欠勤異議等も同型 |
| A10 | P2 | 「いいね解除」の失敗を無視 | **再現**。`SavedJobsView.handleUnsave` は先に画面から消してDELETEエラーを捨てる。再読込すると復活する。別画面 `LikedJobs` / 検索の解除はエラー時復元を実装済み |
| A11 | P1 | 委託の電話・標準条件・圃場登録が分離保存 | **再現**は電話。正本 `account_holders` の更新失敗を無視し `consignment_profiles` の保存成功で完了／端末下書き削除。電話は委託側には残るため「完全消失」ではなく二重管理の不一致。圃場登録・標準条件もエラーを捨てる構造。管理者限定経路 |
| A12 | P1 | ヘルプ画像の削除／形式変更で参照切れ | **再現**は削除。Storageを先に削除しDB削除拒否で古いURLが残る。一括圧縮時の拡張子変更もDB参照確定より先に旧ファイルを削除。管理者限定 |
| A13 | 要仕様確認 | 満額支払条件が入力・確認・契約表示で一貫しない | **構造＋本番定義確認**。入力codecに当該列なし、掲載プレビューの値はfalse、DB既定true、チャットと労働条件通知はtrueを文言化。プレビュー部品はフラグを表示しないため「画面でfalseと明示」とは断定しない。既定trueが意図した契約条件か確認・明示が必要 |
| A14 | P2 | 勤務時間の未入力が既定時間へ変換 | **再現**。work_time=nullから復元→保存で `8:00〜16:00` へ。未入力と本人確定値の区別が消える。初期値自体を不正とは扱わず、既存空欄の往復変換の問題として管理 |
| A15 | P2 | 求人内容確認後の自動チャットだけ失敗する | **再現**。`ChatView.confirmTerms` は確認RPC成功後のmessages INSERTエラーを無視。契約の確認フラグは保存済みだが、約束した通知履歴は欠落する。PR #10の掲載確認記録とは別経路 |
| A16 | P1 | コピー関数が新しい入力列を引き継がない | **実SQL再現＋本番関数照合**。`place_change_scope`、`task_change_scope`、動画URL・同意関連列がコピー先で欠落。期間だけリセットする既存方針とずれる。動画同意は機械コピーが適切かを別途判断し、引継ぎ／再確認を明示する |

P0の再現は模擬adminクライアントであり、秘密鍵を取得したり実データを書き換えたりしていない。PGliteのコピー試験は実関数＋最小テーブルで、全トリガー、RLS、実データは含まない。A03は保存順を交差させた2編集者の再現で、実機2台の同時実行ではない。

## 全経路の確認台帳

| 入力・保存のまとまり | 主な保存先／窓口 | 今回の確認・残課題 |
|---|---|---|
| 求人44列、日程・報酬・場所・説明・危険・写真・動画 | `jobInputCodec` / `jobInputFields` / `deviceDrafts` / `offlineSync` | 既存変換・端末・DB・UI試験通過。A05/A06/A13/A14/A16。元の44列定義は既存設計書とfixture参照 |
| 求人の端末保存、再読込、ログイン引継ぎ | `deviceDrafts` / `loginReturn` / `LandingFlow` | 既存故障試験通過。容量不足・競合は保存契約内で扱う。他フォームへ同じ保証は未展開 |
| 求人掲載・確認記録 | 新原子RPC | 既存原子性・応答紛失・照合不一致・権限試験通過。本番未反映 |
| 公開中の編集 | `sync_my_open_job` | 比較元・応募中制限の既存試験通過。公開内容変更時の確認記録をどの版へ対応させるかは別管理課題 |
| コピー、非公開、削除、日程移動 | `copyJobToEdit` / dashboard API / `calendarMove` | 移動応答照合の試験通過。コピーA07/A16。未使用の旧 `insertJob/updateJob/updateMyOpenJob` は定義が残るが現行LandingFlowからの呼出なし |
| 作業場登録 | `WorkplacePage` → employer_profiles | 保存エラー・遅い読込からの入力保護あり。保存前の再読込耐性、別端末との競合防止は不足。オフライン時は求人側入力だけに反映 |
| 雇い手プロフィール・募集者情報・待遇・喫煙等 | `EmployerProfileEdit` | A01〜A04。項目ごとの保存でも全固定項目を送る。保存成功時にサーバー確定行を取り直さずcacheへ入力値を書き戻す |
| 働き手プロフィール・PR/Q&A・希望・移動等 | `WorkerProfileEdit` | A01〜A04。保存直前のPR読込はあるが、版数競合を防ぐ処理ではない |
| 経験・資格 | `WorkerExperiencePage` | A04。プロフィール全体保存と同じ列を別画面から書くためA03の影響対象 |
| 緊急連絡先 | `EmergencyContactBox` → emergency_contacts | 書込エラーは確認、本人RLSあり。初期読込失敗／旧値上書き／未保存再読込は未保護 |
| 保険準備・保険確認 | `InsurancePrepBox` / `VisitAndInsurance` / `confirm_insurance` | 準備入力A04。確認RPCは確認時刻とチャットを同一DB処理に保存し、逐次再送にはalreadyを返す。真の同時実行の二重通知は未検証 |
| 認証・本人登録・同意 | LoginScreen / AccountHolderForm / privacyConsent | 認証・プライバシー応答紛失等の既存試験通過。本人登録A08。旧APIはA00と下記 |
| 応募・仮応募・取消・承認・採用・面接日 | search API / HireConfirm / ChatView / dashboard API | 応募UI・期限・日付の既存試験通過。各RPCの全競合組合せは未検証。日程変更の期待版数なし。採用等の状態遷移と同時の変更は検証環境で追加試験が必要 |
| 当日の報告・欠勤・異議 | DayReportSheet / WorkerApplications / dashboard | A09。状態変更RPCと追記イベントを区別する必要あり |
| 双方向評価・再依頼名簿 | reviews / submit_farmer_final_review / repeat_roster | UI/SQL/期限/重複の既存試験通過。reviewsは(application_id,direction)一意。名簿変更は書込エラー確認あり、再読込耐性は別途 |
| チャット・運営とのチャット | chatMessaging / ChatView / AdminChat | 固定UUID再送・同内容照合・期限の既存試験通過。自動メッセージA15と管理画面からの新規DMは別経路 |
| 質問・回答 | ask_job_question / answer_job_question | 入力維持・error確認あり。本番関数は質問の再送で新規INSERT、回答の再送でも通知追記。操作IDがない。既存返信を他編集者が上書きする比較元もない。故障再現は未実施 |
| いいね、アンケート | saved_jobs / user_onboarding_survey | A10。いいねの主キーで同一求人の二重行は防止。アンケート成功後のいいねは別通信で部分成功可能 |
| 通報・退会申請 | job/profile/message_reports / withdrawal_requests | 通常エラー表示を確認。追記型の送信に固定操作IDなし。応答紛失後の照合・再送を今回の22ケースでは網羅していない |
| 問合せ・返答・管理者対応 | supportClient / AdminSupportThread / AdminReportsRoom | 同一操作ID、本人／ゲスト分離、再送、競合・期限の既存UI/DB試験通過 |
| 委託者情報・圃場・貸付・契約・進捗 | consignment_* | 管理者限定。A05/A11。全体JSONを版数照合なしで更新、初回作成・進捗追記に操作IDなし。圃場／標準条件の保存失敗を捨てる |
| 管理者公開・修正依頼・停止・審査 | AdminTab / RPC | 管理者公開はstatusを直接更新し新原子RPCを通らない。修正依頼との競合、チェック対象版の意味を設計に含める。権限を拡大していない |
| 管理者DM・地域投稿・ヘルプ画像・画像保守 | AdminTab / FarmTimelessRoom / HelpCenter / image | A12。新規DM／地域投稿は操作IDなし。サムネ後埋めは古いphotos配列をIDだけでUPDATEし、利用者の変更を戻す競合が構造上可能 |
| エラー対応・通知既読・アクセス計測・push | errorLog / AdminSystemRoom / productAnalytics / send-push | 入力正本ではない。失敗を許容する計測と必須保存を分けて確認。pushは送信数を返すが永続再送台帳はない。外部メール・push到達は未検証 |
| 旧経営登録・プロフィール・農家/出荷先管理 | farmers / ProfileModal / OnboardingModal / App | 旧画像保存もerror未確認。`showProfile=true` への現行呼出を確認できず、管理者の旧承認もprops受渡のみ残るため通常入力と同一視しない。window.storage依存が残置 |
| サーバー側旧API | api/sync-farmer、api/auth/verify-otp | A00。verify-otpはOTP成功後、既存氏名もメール由来の値でupsertする。srcからの呼出なし。後者の本番動作／利用者影響は未確認 |

## 権限・Advisorの扱い

本番Security AdvisorはERROR 1、WARN 185、INFO 12件を返した。これは**198件の不具合を再現したという意味ではない**。

| 分類 | 件数 | 判定・参照 |
|---|---:|---|
| SECURITY DEFINER view | 1 | `employer_profiles_public`。公開列を絞ったviewであることを確認。RLS回避の意図と公開項目の契約を再点検する。[説明](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view) |
| mutable search_path | 21 | 関数の固定化が未完。危険度は関数権限と内容に依存。[説明](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) |
| anon実行可能definer | 48 | 読取関数・トリガー関数等を含むため数だけで漏洩と断定しない。[説明](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) |
| authenticated実行可能definer | 115 | 各関数の本人照合と公開契約を点検する。[説明](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| 漏洩パスワード保護無効 | 1 | 保存同期の直接原因ではない。[説明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| RLS有効・policyなし | 12 | private台帳等の意図的な直接アクセス禁止を含む。[説明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) |

`answer_job_question` のNULL比較だけを見て匿名改変可能と断定しない。本番のEXECUTEを照合し、ask/answer、copy、confirm_insurance、旧publish、修正依頼、アカウント変更はいずれもanon実行不可を確認した。A00はservice-role経路なので、このRLS／RPC制限では代替できない。

## 根本修正の順序と受入条件

1. **A00を閉じる。** 旧APIを廃止するか、認証した本人IDに更新対象を固定する。任意メール指定で他人の行を更新できないことを確認する。
2. **プロフィールと画像を保護する。** 読込状態を未取得／存在なし／取得済み／失敗に分け、未取得・失敗時は既存値を空で上書きしない。変更項目だけ送信し、DB内で期待版数を照合する。画像は新しい操作IDのキーへ保存→DB参照確定→旧画像清掃の順にし、復旧台帳を残す。
3. **入力契約をコピーと表示まで接続する。** 入力列ごとに保存先・変換・既定値・コピー方針・確認文言・表示元を1つの台帳で管理する。A13の契約条件を明示し、A16を列追加時の検査に含める。
4. **追記と付随処理に操作IDを渡す。** 登録、当日報告、質問、通報、管理者DM、委託進捗等で、送信前にIDを固定保存し、再送時は同じ結果を照合する。必須の複数DB更新は同一トランザクション、外部通知は永続的な送信待ち台帳で管理する。
5. **管理操作にも比較元を要求する。** 写真保守、管理者公開、全体JSON更新を通常入力と同じ競合規則へ接続する。

「仕分けコード」は項目・変換・コピー規則、「保管コード」はDB/Storage/端末のアクセス窓口、「管理コード」は操作ID・状態・版数・再送・復旧を担当させる。画面は確定した保存結果だけを受け取る。現行の求人契約・端末保存・サポート送信を土台とし、巨大な万能保存ファイルにはまとめない。

各修正の完了条件は、通常保存／通信拒否／保存後の応答紛失／再読込／二重押下／2端末の同一項目・別項目競合／読込失敗／端末容量不足／匿名・別人拒否。すべてを同じ試験でまとめて保証したとは扱わない。

## 未検証の境界

- 実機iPhone/Android、ブラウザ完全終了、実機2台の同時通信。
- 本番と同じ全トリガー・RLS・Storage・HTTP経路を備えた検証環境での結合試験。
- 本番APIへのPOST、第三者更新、実メール／push送信。今回意図的に実行していない。
- すべての過去データの整合性、過去の発生件数、旧API利用履歴・被害範囲。現在の少数集計から「過去に問題なし」とは判断できない。
- 全RPC・管理操作の真の同時実行、メール送信失敗後の回復、Storageオブジェクト内容の一致。

全コードの入口を棚卸しし、重要経路を検査した。**全入力の全障害条件を実環境で合格確認した状態ではない。**

## 再実行

```sh
npm run build
node scripts/audit-input-paths.mjs docs/input-path-inventory-2026-10-16.json
node scripts/audit-input-repro.mjs
```

診断コードには認証情報・本番URLへの通信処理がない。修正後は該当再現を「安全な結果を期待する」回帰試験へ置き換える。単に診断のassertを外して通過数だけ増やさない。
