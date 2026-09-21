# chitose-bank ER図（2026-09-21時点）

出どころ＝リポジトリの現物（`supabase/migrations/` 437本・RPC/ビューの定義・フロントの列参照）を
main の最新コミット（6134e1c）で洗い出したもの。テーブル名・列名は migration と
`update_my_open_job` / `worker_profile_for_farmer` / `jobs_public` 等の列挙から取った。

★注意：`jobs` / `applications` / `messages` / `farmers` / `worker_profiles` / `notifications` /
`chat_reads` / `pending_applications` は migration 以前に本番へ直接作られた表（`create table` が
repo に無い）。その列は「後から足した migration」と「RPC・フロントが読み書きしている列」から
復元しているため、**型は推定を含む**。本番の `information_schema` と突き合わせる時は
`supabase/checks/audit.sql` と同じ要領で読み取り専用に照合すること（作成日はDBが応答せず未照合）。

凡例：`PK`＝主キー／`FK`＝DBの外部キー制約あり／**（論理）**＝制約は無いが値で結ぶ関係
（`job_number` → `jobs.job_number`、`auth_id` / `*_id` → `auth.users.id`）。
Mermaid は GitHub 上でそのまま描画される。

---

## 0. 全体の骨（ドメインの地図）

```mermaid
flowchart LR
  AUTH[("auth.users<br/>(Supabase Auth)")]
  subgraph ID["① 本人・役割"]
    AH[account_holders<br/>本人確認情報]
    WP[worker_profiles<br/>働き手の顔]
    EP[employer_profiles<br/>雇い手の顔]
    EC[emergency_contacts]
  end
  subgraph JOB["② 求人と取引"]
    J[jobs<br/>求人]
    A[applications<br/>応募＝取引の記録簿]
    M[messages<br/>チャット]
    R[reviews<br/>評価]
    AE[attendance_events<br/>日次の記録]
  end
  subgraph OPS["③ 運営・機構"]
    AD[app_admins]
    AS[app_settings]
    EA[event_audit]
    AM[account_moderation]
  end
  subgraph CON["④ 委託レーン（管理者専用）"]
    CP[consignment_profiles]
    CD[consignment_deals]
    CF[consignment_fields]
    FT[farm_timeless_posts]
  end
  AUTH --> AH & WP & EP & EC & AD & AM & CP
  EP --> J
  J --> A
  WP --> A
  A --> M & R & AE
  J -. "jobs_public (view)" .-> V1[(公開の姿)]
  EP -. "employer_profiles_public (view)" .-> V2[(公開の姿)]
```

---

## 1. 本人・役割（アカウント層）

```mermaid
erDiagram
  auth_users {
    uuid id PK "Supabase Auth"
    text email
  }
  account_holders {
    uuid id PK
    uuid auth_id FK "UNIQUE"
    text full_name
    text postal_code
    text address
    date birth_date "18歳判定"
    text entity_type "individual/corporate"
    text company_name
    text company_number
    text contact_email
    text contact_phone
    text agreed_terms_version
    text agreed_privacy_version
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
  worker_profiles {
    uuid auth_id PK
    text nickname "重複禁止トリガー"
    text pr "自己紹介(公開)"
    text pr_pending
    jsonb pr_qa "Q&A20問"
    jsonb pr_qa_pending
    timestamptz pr_submitted_at
    jsonb pr_revision_targets
    text avatar_url
    text residence_city "市町村まで"
    text transport
    text farm_experience "未経験/経験あり"
    jsonb experienced_tasks
    text physical_level "希望する作業の強さ"
    jsonb interests "趣味タグ"
    jsonb languages
    text work_mood
    text learning_pref
    text work_pattern
    jsonb self_declared "免許・資格・保険方針"
    jsonb experience_entries "作物x作業 最大5"
    timestamptz created_at
    timestamptz updated_at
  }
  employer_profiles {
    uuid auth_id PK
    text nickname "農園名"
    text pr
    text avatar_url
    text owner_comment
    text intro_message
    text intro_path
    text intro_crops
    text intro_joy
    text intro_atmosphere
    text unique_point
    text always_do
    jsonb texts_pending
    timestamptz texts_submitted_at
    text recruiter_name "募集主(法定明示)"
    text recruiter_name_kana
    text recruiter_zip
    text recruiter_prefecture
    text recruiter_city
    text recruiter_address_detail
    text recruiter_address "1行合成"
    text recruiter_contact
    text consultation_contact
    text place_zip
    text place_prefecture
    text place_city
    text place_town
    bool has_transport
    text transport_area
    bool has_parking
    text parking_capacity
    bool has_commute_allowance
    text commute_allowance_detail
    bool has_bonus
    text bonus_detail
    bool has_raise
    text raise_detail
    bool has_severance_pay
    text severance_detail
    bool employer_pays_supplies
    text supplies_cap
    bool accessory_ok
    text smoking_policy "受動喫煙"
    text smoking_area
    jsonb insurance_items "保険の自己申告"
    jsonb insurance_notes
    text labor_insurance_status
    text interaction_style
    text teaching_style
    text chat_style
    text break_style
    text question_style
    timestamptz created_at
    timestamptz updated_at
  }
  emergency_contacts {
    uuid auth_id PK
    text name
    text relation "本人/家族等"
    text phone
    timestamptz confirmed_at "第三者は本人の確認が要る"
    timestamptz updated_at
  }
  user_onboarding_survey {
    uuid auth_id PK
    text source
    text source_other
    jsonb reasons
    text reason_other
    timestamptz created_at
  }
  withdrawal_requests {
    uuid id PK
    uuid auth_id FK
    timestamptz requested_at
    timestamptz processed_at
  }
  farmers {
    uuid id PK "旧世代・承認機能で残置"
    uuid auth_id
    text email "UNIQUE"
    text name
    int joined_year
    text status "pending/approved"
    text prefecture
    text municipality
    text experience_tier
    text farming_type
    text area_tan
    jsonb planned_crops
    jsonb sales_channels
    text avatar_url
    timestamptz created_at
  }

  auth_users ||--o| account_holders : "auth_id"
  auth_users ||--o| worker_profiles : "auth_id(論理)"
  auth_users ||--o| employer_profiles : "auth_id(論理)"
  auth_users ||--o| emergency_contacts : "auth_id"
  auth_users ||--o| user_onboarding_survey : "auth_id(論理)"
  auth_users ||--o{ withdrawal_requests : "auth_id"
  auth_users ||--o| farmers : "auth_id(論理)"
  account_holders ||--o{ account_holder_changes : "account_auth_id(論理)"
```

---

## 2. 求人と取引（マッチングの本体）

```mermaid
erDiagram
  jobs {
    uuid id PK
    int job_number "IDENTITY 1000〜 UNIQUE"
    uuid farmer_id FK "auth.users"
    text status "draft/pending/open/closed"
    text crop
    text task
    text zip
    text prefecture
    text city
    text town "anonマスク"
    text address "番地(anonマスク)"
    text date_label
    date date_start
    date date_end
    jsonb holidays
    int headcount
    text pay_type "時給/日給"
    text hourly_wage "text型"
    text daily_wage "text型"
    text work_time
    text break_time
    text nearest_station "anonマスク"
    text commute_time
    text job_exp
    text notes "作業の説明"
    text belongings
    text cautions
    jsonb danger_places "icon,label,desc,photos の配列"
    jsonb danger_tasks
    jsonb photos "url,thumb,caption の配列"
    bool beginner_ok
    bool experienced_preferred
    bool instant_approve_repeat
    bool full_pay_guarantee
    jsonb perks "掲載時に凍結"
    text overtime_policy "なし/あり"
    text overtime_detail
    text place_change_scope
    text task_change_scope
    text contract_renewal
    text retirement_terms
    text labor_insurance_status
    text recruiter_name "掲載時に凍結"
    text recruiter_name_kana
    text recruiter_address
    text recruiter_contact
    jsonb insurance_snapshot "掲載時に凍結"
    timestamptz profile_snapshot_at
    text pay_method "cash"
    text pay_timing "same_day_after_work"
    text wage_closing_rule "each_workday"
    numeric lat
    numeric lng
    int geo_radius_m
    text geocoded_from
    timestamptz opened_at
    text unlisted_reason "unpublished/deleted"
    timestamptz unlisted_at
    timestamptz revision_requested_at
    int draft_step
    timestamptz created_at
  }
  applications {
    uuid id PK
    int job_number "→jobs(論理) 部分UNIQUE(job_number,worker_id) where status≠canceled"
    uuid worker_id
    uuid farmer_id "求人の所有者をコピー"
    text status "applied/approved/meeting/interview/contracted/working/completed/rejected/expired/canceled"
    jsonb available_dates "来られる日 or any"
    jsonb agreed_dates "働く日"
    timestamptz decided_at
    text rejected_reason
    timestamptz canceled_at
    timestamptz terms_confirmed_worker_at "応募時に自動"
    timestamptz terms_confirmed_farmer_at "採用"
    jsonb terms_snapshot "契約の凍結(改変不可)"
    text worker_exp_snapshot
    timestamptz insurance_prepared_at
    timestamptz insurance_first_mailed_at
    date insurance_last_mailed_on
    timestamptz started_at "自動開始"
    bool auto_started
    timestamptz farmer_confirmed_start_at "廃止列(読まない)"
    timestamptz work_completed_at
    bool auto_completed
    timestamptz worker_confirmed_end_at "廃止列(読まない)"
    bool attended
    bool time_corrected
    int completion_remind_count
    timestamptz status_changed_at
    uuid status_changed_by
    timestamptz created_at
  }
  pending_applications {
    uuid id PK
    int job_number
    uuid worker_id
    jsonb available_dates
    timestamptz created_at
  }
  messages {
    uuid id PK
    uuid application_id FK "ON DELETE CASCADE"
    uuid sender_id
    text body "改変・削除不可"
    timestamptz created_at
    timestamptz read_at "唯一の更新可能列"
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
    text status "open/resolved"
    timestamptz created_at
  }
  reviews {
    uuid id PK
    uuid application_id FK "UNIQUE(application_id,direction)"
    uuid reviewer_id
    uuid reviewee_id
    text direction "farmer_to_worker/worker_to_farmer"
    bool on_time
    bool as_described
    bool followed_instructions
    bool completed_work
    bool want_again
    bool entrust
    bool safety_care
    bool instructions_clear
    bool paid_as_posted
    text want_again_choice "yes/neutral/no"
    text work_outcome "completed/partial/failed"
    jsonb traits "特記タグ"
    text match_level "matched/partly/differed"
    text pay_status "paid/unpaid/other"
    text public_comment
    text comment_status "approved/rejected"
    text private_memo "本人のみ"
    timestamptz published_at
    timestamptz created_at
  }
  attendance_events {
    uuid id PK
    uuid application_id FK
    uuid actor_id
    text kind "late/absent_notice/cancel/postpone/dispute_no_show/no_show_report/plan_mismatch/work_incomplete"
    text detail "内訳(選択式)"
    text reason
    date work_date
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
    jsonb snapshot "申告時点の証拠一式"
    text admin_note
    timestamptz decided_at
    timestamptz created_at
  }
  repeat_roster {
    uuid farmer_id PK
    uuid worker_id PK
    bool notify
    uuid source_application_id
    timestamptz created_at
  }
  saved_jobs {
    uuid worker_id PK
    int job_number PK
    timestamptz created_at
  }
  job_questions {
    uuid id PK
    int job_number
    uuid asker_id
    text question
    text answer
    timestamptz answered_at
    bool hidden
    timestamptz created_at
  }
  job_reports {
    uuid id PK
    int job_number
    uuid reporter_id
    text target_field
    text issue_type
    text detail
    text status
    timestamptz created_at
  }
  job_publish_checks {
    uuid id PK
    int job_number
    uuid farmer_id
    jsonb items "掲載前チェック(追記のみ)"
    timestamptz agreed_at
    timestamptz created_at
  }
  job_view_counts {
    int job_number PK
    bigint view_count
    timestamptz updated_at
  }
  job_view_marks {
    int job_number PK
    text viewer_key PK "sha256(uid,job,salt)"
    date seen_on
  }
  farmer_question_sets {
    uuid id PK
    uuid farmer_id
    text title
    jsonb questions
    timestamptz created_at
    timestamptz updated_at
  }
  interview_question_sends {
    uuid id PK
    uuid application_id FK
    uuid farmer_id
    uuid set_id FK "SET NULL"
    text set_title
    timestamptz sent_at
  }
  job_time_notices {
    uuid application_id PK
    text kind PK "before_60/start/end/all_done"
    text role PK "worker/farmer"
    date work_date
    timestamptz requested_at
    bigint request_id
    timestamptz succeeded_at
    int http_status
  }
  application_followup_notices {
    uuid application_id PK
    int stage_hours PK "12..72"
    bool sent
    timestamptz sent_at
  }
  notifications {
    uuid id PK
    uuid farmer_id "受信者のauth id"
    text type
    text message
    bool read
    timestamptz created_at
  }
  worker_profile_view_counts {
    uuid worker_id PK
    bigint view_count
    timestamptz updated_at
  }
  profile_reports {
    uuid id PK
    uuid target_worker_id
    uuid reporter_id
    text source "profile/work_record"
    text target_field
    text issue_type
    text detail
    text status
    timestamptz created_at
  }

  jobs ||--o{ applications : "job_number(論理)"
  jobs ||--o{ pending_applications : "job_number(論理)"
  jobs ||--o{ saved_jobs : "job_number(論理)"
  jobs ||--o{ job_questions : "job_number(論理)"
  jobs ||--o{ job_reports : "job_number(論理)"
  jobs ||--o{ job_publish_checks : "job_number(論理)"
  jobs ||--o| job_view_counts : "job_number(論理)"
  jobs ||--o{ job_view_marks : "job_number(論理)"
  applications ||--o{ messages : "application_id"
  applications ||--o{ chat_reads : "application_id(論理)"
  applications ||--o{ reviews : "application_id"
  applications ||--o{ attendance_events : "application_id"
  applications ||--o{ pay_incidents : "application_id"
  applications ||--o{ interview_question_sends : "application_id"
  applications ||--o{ job_time_notices : "application_id"
  applications ||--o{ application_followup_notices : "application_id"
  applications ||--o| repeat_roster : "source_application_id(論理)"
  messages ||--o{ message_reports : "message_id"
  farmer_question_sets ||--o{ interview_question_sends : "set_id"
```

---

## 3. 運営・機構（管理者専用・ログ・設定）

```mermaid
erDiagram
  app_admins {
    uuid auth_id PK "FK auth.users"
    text label
    timestamptz created_at
  }
  app_settings {
    text key PK "signup_open / third_party_publish_allowed / privacy_version / mail_skip_when_push / apply_profile_gate / job_view_mark_salt"
    text value
    timestamptz updated_at
  }
  account_allowlist {
    text email PK
    text label
    timestamptz added_at
  }
  account_moderation {
    uuid auth_id PK "FK auth.users"
    text state "active/suspended/banned"
    text reason
    uuid moderated_by
    timestamptz created_at
    timestamptz updated_at
  }
  admin_messages {
    uuid id PK "運営DM"
    uuid user_id
    bool from_admin
    text body
    timestamptz created_at
    timestamptz read_at
  }
  admin_notice_registry {
    uuid id PK "お知らせ台帳"
    text name
    text body
    text audience
    text trigger_on "startup/after_login/login/confirm"
    bool published
    text link_hash
    text image_url
    bool show_every_time
    int repeat_chance
    int sort
    timestamptz created_at
  }
  admin_box_registry {
    uuid id PK
    text name
    text where_from
    text preview_key
    int sort
    timestamptz created_at
  }
  mail_registry {
    text code PK "M01〜"
    text subject_pattern
    int priority
    text label
  }
  minimum_wages {
    uuid id PK
    text prefecture "UNIQUE(prefecture,effective_from)"
    int hourly_wage
    date effective_from
    text source_url
    text note
  }
  push_subscriptions {
    text endpoint PK
    uuid auth_id FK
    text p256dh
    text auth
    timestamptz created_at
  }
  push_config {
    int id PK
    text vapid_public
    text vapid_private
    text subject
    text trigger_secret
  }
  policy_update_notices {
    uuid auth_id PK "FK auth.users"
    text doc PK "privacy/terms"
    text version PK
    timestamptz sent_at
    bigint request_id
  }
  feedback {
    uuid id PK
    uuid reporter_id
    text page_hash
    text category
    text body
    int viewport
    text status "open/resolved"
    timestamptz created_at
  }
  page_events {
    bigint id PK "30日で削除"
    uuid auth_id
    uuid anon_key
    text page_hash
    text src
    timestamptz ts
    bool summarized
  }
  app_errors {
    uuid id PK "1年で削除"
    text level
    text source
    text component
    text action
    text operation
    text error_code
    text message
    text stack
    text page
    text url
    text user_agent
    uuid user_id
    text session_id
    text status "open/fixed"
    timestamptz resolved_at
    timestamptz created_at
  }
  event_audit {
    bigint id PK "変更の記録(firehose)"
    timestamptz at
    uuid actor
    text table_name
    text op
    text row_pk
    jsonb diff
  }
  help_images {
    text slot_key PK
    text url
    timestamptz updated_at
  }
```

---

## 4. 委託レーン（管理者専用・利用者からは到達不可）

```mermaid
erDiagram
  consignment_profiles {
    uuid auth_id PK "employer_profilesと同列+委託者KYC"
    text nickname
    text consignor_name
    text consignor_trade_name
    text consignor_corp_no
    text consignor_invoice_no
    text consignor_type
    text consignor_zip
    text consignor_pref
    text consignor_city
    text consignor_addr
    text consignor_bank
    text consignor_bank_branch
    text consignor_account_type
    text consignor_account_no
    jsonb consignor_data
    bool consignment_terms_consent
    timestamptz consignment_terms_consent_at
    text consignment_terms_consent_version
    bool consignment_data_consent
    timestamptz consignment_data_consent_at
    text consignment_data_consent_version
    text labor_insurance_status
    timestamptz updated_at
  }
  consignment_fields {
    uuid id PK
    uuid auth_id "UNIQUE(auth_id,name)"
    text name
    text region
    text area_a
    jsonb data "設備・貸与等"
    timestamptz created_at
    timestamptz updated_at
  }
  consignment_deals {
    uuid id PK "案件台帳(auth_id列なし)"
    text counterparty_name
    text field_name
    numeric area_a
    text crop
    text task
    int unit_price
    int total_amount
    int deposit_amount
    jsonb spec "仕様(凍結)"
    text status "draft/agreed/working/inspected/paid/done"
    date agreed_at
    date start_date
    date end_date
    date inspected_at
    date paid_at
    text notes
    text memo
    timestamptz created_at
    timestamptz updated_at
  }
  consignment_progress {
    uuid id PK
    uuid deal_id FK "ON DELETE CASCADE"
    date work_date
    numeric hours
    int workers
    int yield_boxes
    text note
    timestamptz created_at
  }
  farm_timeless_posts {
    uuid id PK "農タイムレス(独立プロジェクト)"
    uuid author_id
    text kind "pest/action"
    text category
    text pref
    text city
    numeric lat
    numeric lng
    text comment
    text photo_url
    timestamptz created_at
  }

  consignment_profiles ||--o{ consignment_fields : "auth_id(論理)"
  consignment_deals ||--o{ consignment_progress : "deal_id"
```

---

## 5. ビュー・ストレージ・旧遺物

| 種類 | 名前 | 中身 |
|---|---|---|
| view | `jobs_public` | `jobs ⨝ employer_profiles`。open（＋満員のclosed）・非公開でない・停止中でない農家の求人だけ。anon には town/番地/駅/募集主をNULL・座標2桁・半径3000m。`masked_fields` で伏せた項目名だけ返す。SELECT専用 |
| view | `employer_profiles_public` | 雇い手の看板（承認済み列のみ・BAN除外）。SELECT専用 |
| storage | `avatars` | アイコン（本人フォルダ `{uid}/`） |
| storage | `job-photos` | 求人写真・危険箇所写真・サムネ（書き込みは `{uid}/` 配下＋管理者） |
| storage | `consignment-photos` | 委託レーンの写真（書き込みは管理者） |
| storage | `farm-timeless` | 農タイムレスの写真（書き込みは管理者） |
| storage | `help-images` | ヘルプの画像（管理者） |
| legacy | `farmers` | 旧・農家登録（管理タブの承認機能とセッション復元が読む） |
| legacy | `records` / `dests` / `market_stats` | 旧・公開ボード/データ入力の残骸（UIは2026-07-24に削除・行は残置） |
| legacy | `auth_logs` | 参照ゼロ・0行（次の掃除の候補） |

---

## 6. 関係の要点（読む人向けの補足）

- **auth.users が根**。役割はアカウント属性ではなく「どのプロフィール行を持つか」で決まる
  （`worker_profiles` あり＝働き手、`employer_profiles` あり＝雇い手。両方持てる）。
- **applications が取引の記録簿**。状態を上書きせず時刻列を追記する（`terms_confirmed_*_at`・
  `started_at`・`work_completed_at`…）。段階ラベルは `app_phase()` が導出し、列としては持たない。
- **契約の凍結**＝`applications.terms_snapshot`（採用時）と `jobs.perks / insurance_snapshot /
  recruiter_* / pay_*`（掲載時）。どちらもトリガーで改変を拒む。
- **DBの外部キーは応募まわりに集中**（`messages` / `reviews` / `attendance_events` / `pay_incidents` /
  `interview_question_sends` / `job_time_notices` / `application_followup_notices` → `applications.id`）。
  `job_number` で結ぶ表（`saved_jobs` / `job_questions` / `job_reports` / `job_view_*` /
  `pending_applications` / `applications`）は制約なしの論理関係。
- **証跡は消さない**：`messages` は本文・送信者・時刻の改変と削除を全経路で拒否。
  `jobs` は掲載済み・応募あり・作業日経過の行を DELETE できない。退会（`process_withdrawal`）は
  本人の届出情報を消し、取引の記録は匿名化して残す。
- **期限つきの掃除**：`page_events` 30日・`app_errors` 1年・`job_view_marks` 30日（cron）。
  チャット・契約・通報・`event_audit` の3年削除は未実装（2028年内に設計）。
