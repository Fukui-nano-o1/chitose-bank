# chitose-bank ER図（Airbnb型マッチングのデータ構造）

作成日：2026-09-21　出どころ：リポジトリの最新コード（`supabase/migrations/` 437本＋`src/` の参照）

## 読み方・前提

- **正本はコード**。migrations の `create table` / `alter table` / `references` と、フロントの `.from()` `.select()` `.insert()`、RPC本文の列参照から機械抽出した。
- **基底テーブル7つは migrations に `create table` が無い**（2026-06〜07にダッシュボードで直接作成された世代）：`jobs` `applications` `messages` `worker_profiles` `farmers` `notifications` `pending_applications` `chat_reads` `app_errors` `help_images` `market_stats` `records` `dests`。これらの基底列は、ビュー定義（`jobs_public`）・RPC本文・フロントの insert/select から復元した。**列の型と NOT NULL は推定**（列名は実コードに現れるもののみ）。
- 本番DB（`aegwepgtmwcnwzybpgsh`）への照合は、作成時にDBが応答しなかった（接続タイムアウト4回）ため**未実施**。次にDBが温まった時に `information_schema.columns` と突き合わせること。
- 線の種類：`||--o{` などの実線は **DB上の外部キー（`references`）**。`}o..o{` などの点線は **FK制約が無く、RPC・RLS・アプリの規約で結んでいる論理的な関係**（例：`applications.job_number → jobs.job_number` はFK無し）。
- `auth_users` は Supabase Auth の `auth.users`。本人の識別子（`auth.uid()`）はここが唯一の源。

---

## 1. 全体像（核の11エンティティ）

Airbnb対応：ホスト＝農家（employer_profiles）／ゲスト＝働き手（worker_profiles）／リスティング＝jobs／予約リクエスト＝applications／メッセージ＝messages／レビュー＝reviews。

```mermaid
erDiagram
  auth_users ||--o| account_holders : "本人情報（KYC・同意版）"
  auth_users ||--o| worker_profiles : "働き手の顔"
  auth_users ||--o| employer_profiles : "農家の顔"
  auth_users ||--o{ jobs : "farmer_id（募集主）"
  jobs ||--o{ applications : "job_number（論理FK）"
  auth_users ||--o{ applications : "worker_id（論理FK）"
  applications ||--o{ messages : "application_id（CASCADE・凍結）"
  applications ||--o{ reviews : "application_id（方向ごと1件）"
  applications ||--o{ attendance_events : "その日の記録"
  auth_users ||--o{ saved_jobs : "いいね"
  auth_users ||--o{ repeat_roster : "また呼びたい（農家→働き手）"
```

---

## 2. アカウント・本人情報（auth の周り）

```mermaid
erDiagram
  auth_users {
    uuid id PK
    text email "他利用者に一切出ない"
    timestamptz banned_until "退会・追放で infinity"
  }
  account_holders {
    uuid id PK
    uuid auth_id FK "UNIQUE・self-only RLS"
    text full_name "契約成立後の相手方にだけ開示"
    text postal_code
    text address
    date birth_date "18歳未満は登録不可（trg）"
    text entity_type "individual/corporate"
    text contact_email
    text contact_phone "どちらか必須（CHECK）"
    text company_name
    text company_number
    text agreed_terms_version
    text agreed_privacy_version "app_settings.privacy_version と照合"
    timestamptz agreed_at
    timestamptz created_at
    timestamptz updated_at
  }
  account_holder_changes {
    bigint id PK
    uuid account_auth_id
    timestamptz changed_at
    uuid changed_by
    text source
    jsonb old_values
    jsonb new_values
  }
  account_allowlist {
    text email PK "招待制の名簿（signup_open=true で不要）"
    text label
    timestamptz added_at
  }
  account_moderation {
    uuid auth_id PK, FK
    text state "active/suspended/banned"
    text reason
    uuid moderated_by
    timestamptz created_at
    timestamptz updated_at
  }
  app_admins {
    uuid auth_id PK, FK "運営（自己募集判定・管理RPC権限）"
    text label
    timestamptz created_at
  }
  emergency_contacts {
    uuid auth_id PK, FK "self-only・開示は contract_emergency_contact() のみ"
    text name
    text relation "本人 or 家族など"
    text phone
    timestamptz confirmed_at "第三者の連絡先は本人確認が要る"
    timestamptz updated_at
  }
  withdrawal_requests {
    uuid id PK
    uuid auth_id FK
    timestamptz requested_at
    timestamptz processed_at "process_withdrawal() が刻む"
  }
  policy_update_notices {
    uuid auth_id FK
    text doc "terms/privacy"
    text version
    timestamptz sent_at
    bigint request_id
  }
  user_onboarding_survey {
    uuid auth_id PK
    text source
    text source_other
    jsonb reasons
    text reason_other
    timestamptz created_at
  }
  push_subscriptions {
    text endpoint PK
    uuid auth_id FK
    text p256dh
    text auth
    timestamptz created_at
  }
  farmers {
    uuid id PK "旧・農家登録（AdminTab承認と RLS の農家判定に残る）"
    uuid auth_id
    text email
    text name
    text prefecture
    text municipality
    text status "pending/approved（DB既定 pending）"
    int joined_year
    text farming_type
    text experience_tier
    jsonb planned_crops
    jsonb sales_channels
    numeric area_tan
    text avatar_url
  }

  auth_users ||--o| account_holders : "FK"
  account_holders ||--o{ account_holder_changes : "account_auth_id（論理）"
  auth_users ||--o| account_moderation : "FK"
  auth_users ||--o| app_admins : "FK"
  auth_users ||--o| emergency_contacts : "FK"
  auth_users ||--o{ withdrawal_requests : "FK"
  auth_users ||--o{ policy_update_notices : "FK"
  auth_users ||--o| user_onboarding_survey : "（論理）"
  auth_users ||--o{ push_subscriptions : "FK"
  auth_users ||--o| farmers : "auth_id（論理）"
```

---

## 3. プロフィール（ホスト／ゲストの看板）

```mermaid
erDiagram
  worker_profiles {
    uuid auth_id PK "self/admin のみ SELECT。農家は worker_profile_for_farmer() 経由"
    text nickname "UNIQUE（trg・NFKC/仮名折り畳み）"
    text avatar_url
    text pr "自己紹介（即公開・NG自動拒否）"
    jsonb pr_qa "問いかけQ&A"
    text pr_pending "旧・審査待ち（2026-08-14 廃止・trg が即公開列へ畳む）"
    jsonb pr_qa_pending
    timestamptz pr_submitted_at
    jsonb pr_revision_targets
    text residence_city "市町村まで"
    text transport "車/バイク/自転車/公共交通"
    text farm_experience "未経験/経験あり"
    jsonb experienced_tasks
    jsonb experience_entries "作物×作業（最大5）"
    text physical_level "希望する作業の強さ"
    jsonb interests "趣味タグ（プリセット）"
    jsonb languages
    text work_mood
    text learning_pref
    text work_pattern
    jsonb self_declared "免許・資格・保険の方針"
    timestamptz created_at
  }
  employer_profiles {
    uuid auth_id PK "admin+本人のみ。第三者は employer_profiles_public ビュー"
    text nickname "農園名・屋号（重複可）"
    text pr
    text avatar_url
    text recruiter_name "募集主氏名（求人ページで法定明示）"
    text recruiter_name_kana
    text recruiter_address "1行合成（分割列が真実）"
    text recruiter_zip
    text recruiter_prefecture
    text recruiter_city
    text recruiter_address_detail
    text recruiter_contact
    text consultation_contact "相談窓口（パート有期法6条）"
    text place_zip
    text place_prefecture
    text place_city
    text place_town
    text place_address
    jsonb insurance_items "保険の自己申告"
    jsonb insurance_notes
    text labor_insurance_status
    boolean has_transport
    text transport_area
    boolean has_parking
    text parking_capacity
    boolean has_commute_allowance
    text commute_allowance_detail
    boolean has_bonus
    text bonus_detail
    boolean has_raise
    text raise_detail
    boolean has_severance_pay
    text severance_detail
    boolean employer_pays_supplies
    text supplies_cap
    boolean accessory_ok
    text smoking_policy "受動喫煙（掲載必須）"
    text smoking_area
    text unique_point
    text always_do
    text break_style
    text interaction_style
    text teaching_style
    text chat_style
    text question_style
    jsonb texts_pending "旧・審査待ち（廃止・trg が畳む）"
    timestamptz texts_submitted_at
    timestamptz texts_revision_requested_at
    timestamptz created_at
    timestamptz updated_at
  }
  employer_profiles_public {
    view _ "承認済み列だけ・BAN除外・SELECT専用"
  }
  worker_profile_view_counts {
    uuid worker_id PK
    bigint view_count
    timestamptz updated_at
  }
  farmer_question_sets {
    uuid id PK
    uuid farmer_id
    text title
    jsonb questions "面接の質問集"
    timestamptz created_at
    timestamptz updated_at
  }

  auth_users ||--o| worker_profiles : "auth_id（論理）"
  auth_users ||--o| employer_profiles : "auth_id（論理）"
  employer_profiles ||--|| employer_profiles_public : "ビュー"
  worker_profiles ||--o| worker_profile_view_counts : "（論理）"
  auth_users ||--o{ farmer_question_sets : "farmer_id（論理）"
```

---

## 4. 求人（リスティング）

```mermaid
erDiagram
  jobs {
    uuid id PK
    int job_number UK "IDENTITY 1000〜（URL /#/work/job/N）"
    uuid farmer_id FK "→ auth.users（募集主）"
    text status "draft/pending/open/closed"
    timestamptz created_at
    timestamptz opened_at "初回掲載"
    timestamptz unlisted_at
    text unlisted_reason "unpublished（一時非公開）"
    timestamptz revision_requested_at "運営の修正のお願い中"
    int draft_step
    text crop
    text task
    text zip
    text prefecture
    text city
    text town "anon には NULL"
    text address "番地・訪問者にはマスク"
    numeric lat "anon は小数2桁"
    numeric lng
    int geo_radius_m "anon は 3000"
    text geocoded_from
    text date_label
    date date_start
    date date_end
    jsonb holidays
    int headcount
    text pay_type "時給/日給"
    text hourly_wage "text型"
    text daily_wage "text型・最賃は実働換算で検査"
    boolean full_pay_guarantee
    text pay_method "cash（掲載時に凍結）"
    text pay_timing "same_day_after_work"
    text wage_closing_rule "each_workday"
    text work_time
    text break_time
    text overtime_policy "掲載必須"
    text overtime_detail
    text nearest_station "anon には NULL"
    text commute_time
    text job_exp
    boolean beginner_ok
    boolean experienced_preferred
    boolean instant_approve_repeat "名簿の相手を自動承認"
    text notes "作業の説明"
    text belongings
    text cautions
    jsonb danger_places
    jsonb danger_tasks
    jsonb photos "[{url,caption,thumb}]"
    jsonb perks "掲載時に凍結（18キー）"
    jsonb insurance_snapshot "掲載時に凍結"
    timestamptz profile_snapshot_at
    text recruiter_name "掲載時に転写"
    text recruiter_name_kana
    text recruiter_address
    text recruiter_contact
    text place_change_scope
    text task_change_scope
    text contract_renewal
    text retirement_terms
    text labor_insurance_status
  }
  jobs_public {
    view _ "open または満員closed・BAN除外・anonマスク・hired_count 派生"
  }
  job_publish_checks {
    uuid id PK
    int job_number
    uuid farmer_id
    jsonb items "掲載前チェック4項目"
    timestamptz agreed_at
    timestamptz created_at
  }
  job_questions {
    uuid id PK
    int job_number
    uuid asker_id
    text question "NG自動検査"
    text answer
    timestamptz answered_at
    boolean hidden "運営が非表示"
    timestamptz created_at
  }
  job_reports {
    uuid id PK
    int job_number
    uuid reporter_id
    text target_field
    text issue_type
    text detail
    text status "open/resolved"
    timestamptz created_at
  }
  job_view_counts {
    int job_number PK
    bigint view_count
    timestamptz updated_at
  }
  job_view_marks {
    int job_number PK
    text viewer_key PK "sha256(uid‖job‖塩)・30日で purge"
    date seen_on
  }
  saved_jobs {
    uuid worker_id PK
    int job_number PK
    timestamptz created_at
  }
  minimum_wages {
    uuid id PK
    text prefecture
    int hourly_wage "徳島県 1046円"
    date effective_from
    text source_url
    text note
  }

  auth_users ||--o{ jobs : "farmer_id"
  jobs ||--|| jobs_public : "ビュー（employer_profiles を JOIN）"
  jobs ||--o{ job_publish_checks : "job_number（論理）"
  jobs ||--o{ job_questions : "job_number（論理）"
  jobs ||--o{ job_reports : "job_number（論理）"
  jobs ||--o| job_view_counts : "job_number（論理）"
  jobs ||--o{ job_view_marks : "job_number（論理）"
  jobs ||--o{ saved_jobs : "job_number（論理）"
  auth_users ||--o{ saved_jobs : "worker_id（論理）"
  auth_users ||--o{ job_questions : "asker_id（論理）"
```

---

## 5. 応募〜契約〜評価（予約リクエストの一生）

```mermaid
erDiagram
  applications {
    uuid id PK
    int job_number "→ jobs.job_number（論理・UNIQUE(job_number,worker_id) where status<>canceled）"
    uuid worker_id "→ auth.users"
    uuid farmer_id "→ auth.users（jobs.farmer_id の写し）"
    text status "applied/approved/meeting/interview/contracted/working/completed/rejected/expired/canceled"
    timestamptz created_at "応募"
    timestamptz decided_at "承認・見送り"
    text rejected_reason
    timestamptz canceled_at
    timestamptz held_at
    timestamptz handled_at
    timestamptz status_changed_at
    uuid status_changed_by
    jsonb available_dates "来られる日（申告）"
    jsonb agreed_dates "働く日（農家が決める）"
    timestamptz terms_confirmed_worker_at "応募時に自動"
    timestamptz terms_confirmed_farmer_at "採用＝契約成立"
    jsonb terms_snapshot "労働条件の凍結（3年保存・改変不可trg）"
    text worker_exp_snapshot
    timestamptz insurance_prepared_at "保険の報告"
    timestamptz insurance_first_mailed_at
    date insurance_last_mailed_on
    timestamptz started_at "自動開始（cron）"
    boolean auto_started
    timestamptz farmer_confirmed_start_at "旧・開始確認（打刻廃止）"
    timestamptz work_completed_at "完了（最終日終了時刻に自動）"
    boolean auto_completed
    timestamptz worker_confirmed_end_at "旧・終了確認（打刻廃止）"
    boolean attended "欠勤の記録"
    boolean time_corrected
    int completion_remind_count
  }
  pending_applications {
    uuid id PK
    int job_number
    uuid worker_id
    jsonb available_dates
    timestamptz created_at "仮応募（プロフィール完成で昇格）"
  }
  messages {
    uuid id PK
    uuid application_id FK "ON DELETE CASCADE・本文/送信者/時刻は改変・削除不可（trg）"
    uuid sender_id
    text body
    timestamptz created_at
    timestamptz read_at "クライアントが書けるのはここだけ"
  }
  chat_reads {
    uuid application_id PK
    uuid reader_id PK
    timestamptz last_read_at
  }
  message_reports {
    uuid id PK
    uuid message_id FK
    uuid application_id
    uuid reporter_id
    text body_snapshot "凍結コピー"
    uuid sender_id_snapshot
    text reason
    text detail
    text status
    timestamptz created_at
  }
  interview_question_sends {
    uuid id PK
    uuid application_id FK
    uuid farmer_id
    uuid set_id FK
    text set_title
    timestamptz sent_at
  }
  attendance_events {
    uuid id PK
    uuid application_id FK
    uuid actor_id
    text kind "late/absent_notice/cancel/postpone/no_show_report/dispute_no_show/plan_mismatch/work_incomplete"
    text detail "予定と違う の内訳"
    text reason
    date work_date
    timestamptz created_at
  }
  job_time_notices {
    uuid application_id PK, FK
    date work_date PK
    text kind PK "before_60/start/end/all_done"
    text role PK "worker/farmer"
    timestamptz sent_at
  }
  application_followup_notices {
    uuid application_id PK, FK
    int stage_hours PK "未判断の督促 24/48/72h"
    boolean sent
    timestamptz sent_at
  }
  reviews {
    uuid id PK
    uuid application_id FK "UNIQUE(application_id, direction)"
    uuid reviewer_id "当事者整合 trg"
    uuid reviewee_id
    text direction "farmer_to_worker / worker_to_farmer"
    text want_again_choice "yes/neutral/no（真実）"
    boolean want_again "影（互換）"
    text work_outcome
    jsonb traits "肯定4＋否定2（否定は非公開）"
    text match_level "求人票との一致"
    text pay_status "unpaid → pay_incidents 起票"
    boolean entrust
    boolean on_time
    boolean as_described
    boolean safety_care
    boolean followed_instructions
    boolean completed_work
    boolean instructions_clear
    boolean paid_as_posted
    text public_comment
    text comment_status "approved 既定・運営が rejected に"
    text private_memo
    timestamptz published_at
    timestamptz created_at
  }
  pay_incidents {
    uuid id PK
    uuid application_id FK
    uuid reporter_id
    uuid farmer_id
    uuid worker_id
    int job_number
    text status "reported/checking/resolved/unresolved"
    jsonb snapshot "申告時点の求人・契約・日次・回答"
    text admin_note
    timestamptz decided_at
    timestamptz created_at
  }
  repeat_roster {
    uuid farmer_id PK "農家本人のみ manage"
    uuid worker_id PK
    boolean notify
    uuid source_application_id
    timestamptz created_at
  }
  notifications {
    uuid id PK
    uuid farmer_id "受信者の auth_id（名前は歴史的）"
    text type
    text message
    boolean read
    timestamptz created_at
  }

  jobs ||--o{ applications : "job_number（論理）"
  jobs ||--o{ pending_applications : "job_number（論理）"
  auth_users ||--o{ applications : "worker_id / farmer_id（論理）"
  applications ||--o{ messages : "FK"
  applications ||--o{ chat_reads : "（論理）"
  messages ||--o{ message_reports : "FK"
  applications ||--o{ interview_question_sends : "FK"
  farmer_question_sets ||--o{ interview_question_sends : "FK"
  applications ||--o{ attendance_events : "FK"
  applications ||--o{ job_time_notices : "FK"
  applications ||--o{ application_followup_notices : "FK"
  applications ||--o{ reviews : "FK"
  applications ||--o{ pay_incidents : "FK"
  applications |o--o{ repeat_roster : "source_application_id（論理）"
  auth_users ||--o{ notifications : "farmer_id（論理）"
```

---

## 6. 通報・意見（当事者のいない記録）

```mermaid
erDiagram
  profile_reports {
    uuid id PK
    uuid target_worker_id
    uuid reporter_id
    text source
    text target_field
    text issue_type
    text detail
    text status
    timestamptz created_at
  }
  feedback {
    uuid id PK
    uuid reporter_id "NOT NULL（退会で行削除）"
    text page_hash
    text category
    text body
    int viewport
    text status "open/resolved"
    timestamptz created_at
  }
  auth_users ||--o{ profile_reports : "reporter / target（論理）"
  auth_users ||--o{ feedback : "reporter_id（論理）"
```

---

## 7. 運営・システム（利用者に見えない裏方）

```mermaid
erDiagram
  app_settings {
    text key PK "third_party_publish_allowed / signup_open / privacy_version / mail_skip_when_push / job_view_mark_salt"
    text value
    timestamptz updated_at
  }
  admin_messages {
    uuid id PK
    uuid user_id "運営DMの相手"
    boolean from_admin
    text body
    timestamptz created_at
    timestamptz read_at
  }
  admin_notice_registry {
    uuid id PK
    text name
    text body
    text image_url
    text audience
    text trigger_on "startup/after_login/login/confirm"
    boolean published
    timestamptz starts_at
    timestamptz ends_at
    text link_label
    text link_hash
    int sort
  }
  admin_box_registry {
    uuid id PK
    text name
    text where_from
    text preview_key
    int sort
  }
  mail_registry {
    text code PK "M01…M42"
    text subject_pattern
    int priority
    text label
  }
  push_config {
    int id PK
    text vapid_public
    text vapid_private
    text subject
    text trigger_secret
  }
  event_audit {
    bigint id PK
    timestamptz at
    uuid actor
    text table_name
    text op
    text row_pk
    jsonb diff "変更前後（3年保存予定）"
  }
  page_events {
    bigint id PK
    uuid auth_id
    uuid anon_key
    text page_hash
    text src
    timestamptz ts "30日で purge"
    boolean summarized
  }
  app_errors {
    uuid id PK
    text session_id
    uuid user_id
    text level
    text source
    text page
    text component
    text action
    text operation
    text error_code
    text message
    text stack
    text url
    text user_agent
    jsonb metadata
    text status "open/fixed"
    timestamptz resolved_at
    timestamptz created_at "1年で purge"
  }
  help_images {
    text slot_key PK
    text url
    timestamptz updated_at
  }
  market_stats {
    text _ "旧事業データ（管理タブ legacyView が読む）"
  }
  records {
    uuid farmer_id "旧・売上経費記録（2行残置）"
  }
  dests {
    text _ "旧・出荷先（1行残置・admin限定）"
  }
  auth_users ||--o{ admin_messages : "user_id（論理）"
  auth_users ||--o{ event_audit : "actor（論理）"
  auth_users ||--o{ page_events : "auth_id（論理）"
  auth_users ||--o{ app_errors : "user_id（論理）"
```

---

## 8. 委託レーン・農タイムレス（管理者専用・別プロジェクト）

```mermaid
erDiagram
  consignment_profiles {
    uuid auth_id PK "employer_profiles の LIKE ＋ 委託者KYC（銀行口座まで）・admin のみ"
    text consignor_name
    text consignor_trade_name
    text consignor_corp_no
    text consignor_invoice_no
    text consignor_bank
    text consignor_account_no
    boolean consignment_data_consent
    boolean consignment_terms_consent
  }
  consignment_fields {
    uuid id PK
    uuid auth_id
    text name "圃場"
    text region
    text area_a
    jsonb data
  }
  consignment_deals {
    uuid id PK
    text counterparty_name "手入力・auth_id を持たない"
    text field_name
    numeric area_a
    text crop
    text task
    int unit_price
    int total_amount
    int deposit_amount
    jsonb spec
    jsonb spec_snapshot
    text status "draft/agreed/working/inspected/paid/done"
    date agreed_at
    date start_date
    date end_date
    date inspected_at
    date paid_at
    text notes
    text memo
  }
  consignment_progress {
    uuid id PK
    uuid deal_id FK
    date work_date
    numeric hours
    int workers
    int yield_boxes
    text note
  }
  farm_timeless_posts {
    uuid id PK
    uuid author_id
    text kind "pest/action"
    text category
    text pref
    text city
    double lat
    double lng
    text comment
    text photo_url "farm-timeless バケット"
    timestamptz created_at
  }
  auth_users ||--o| consignment_profiles : "auth_id（論理）"
  auth_users ||--o{ consignment_fields : "auth_id（論理）"
  consignment_deals ||--o{ consignment_progress : "FK"
  auth_users ||--o{ farm_timeless_posts : "author_id（論理）"
```

---

## 9. 補足

### ストレージ（テーブルではないが図の一部）
| バケット | 中身 | 書き込み | 参照する列 |
|---|---|---|---|
| `job-photos` | 求人・危険箇所の写真とサムネ | 本人フォルダ `{uid}/`＋admin | `jobs.photos` `jobs.danger_*` |
| `avatars` | アイコン | 本人フォルダ | `worker_profiles.avatar_url` `employer_profiles.avatar_url` |
| `help-images` | ヘルプの画像 | admin | `help_images.url` |
| `consignment-photos` | 委託の写真 | admin | `consignment_deals.spec` |
| `farm-timeless` | 農タイムレスの写真 | admin | `farm_timeless_posts.photo_url` |

### 「論理FK」のまま残っている主な関係（FK制約が無い）
- `applications.job_number → jobs.job_number`（apply_to_job / RLS / ビューが結ぶ）
- `applications.worker_id / farmer_id → auth.users.id`
- `saved_jobs` `repeat_roster` `job_questions` `job_reports` `job_publish_checks` `job_view_*` の `job_number` / `*_id`
- `worker_profiles.auth_id` `employer_profiles.auth_id`（PK だが `references auth.users` は無い）

FK制約を足すかは別判断（退会処理は `auth.users` の行を残して匿名化する設計なので、`ON DELETE CASCADE` を安易に足すと証跡が巻き添えになる）。

### 削除済み（図に載せない）
`workers`（→ worker_profiles に統合）／`attendance_corrections`・`time_corrections`（打刻の全廃）／`calendar_notes` `error_logs` `mail_failures`（2026-07-29 大掃除）／ビュー `public_summary` `monthly_pnl` `board_*`（公開ボード廃止）。

### 次にやること
1. DBが応答する時間帯に `select table_name, column_name, data_type from information_schema.columns where table_schema='public'` を取り、基底7テーブルの推定列（型・NOT NULL）を確定して本書を直す。
2. 列を足す・表を足すたびに本書を更新する（migration と同じ push に含める）。
