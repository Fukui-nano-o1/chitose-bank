# Chitose-bank 全操作の権限表

確認元：本番DB定義（2026-10-26 JST、個人データなし）＋このブランチの権限マイグレーション＋全ソースの呼び出し。
この表は適用後の設計。生成だけでは本番に反映されない。権限の条件式・列権限・トリガーは同名の JSON に収録。
表の掲載と挙動テストの合格は別。すべての業務の全入力組合せ・実環境JWT・Storage HTTPを網羅した保証ではない。

## テーブル・ビュー：操作ごとの直接アクセス

| 操作 | 匿名のテーブル権限 | 会員のテーブル権限 | RLS条件（名前） | 追加の制約 |
|---|---|---|---|---|
| private.consignment_save_requests:SELECT | なし | なし | なし | — |
| private.consignment_save_requests:INSERT | なし | なし | なし | — |
| private.consignment_save_requests:UPDATE | なし | なし | なし | — |
| private.consignment_save_requests:DELETE | なし | なし | なし | — |
| private.feedback_guest_access:SELECT | なし | なし | なし | — |
| private.feedback_guest_access:INSERT | なし | なし | なし | — |
| private.feedback_guest_access:UPDATE | なし | なし | なし | — |
| private.feedback_guest_access:DELETE | なし | なし | なし | — |
| private.feedback_support_actions:SELECT | なし | なし | なし | — |
| private.feedback_support_actions:INSERT | なし | なし | なし | — |
| private.feedback_support_actions:UPDATE | なし | なし | なし | — |
| private.feedback_support_actions:DELETE | なし | なし | なし | — |
| private.job_copy_requests:SELECT | なし | なし | なし | — |
| private.job_copy_requests:INSERT | なし | なし | なし | — |
| private.job_copy_requests:UPDATE | なし | なし | なし | — |
| private.job_copy_requests:DELETE | なし | なし | なし | — |
| private.job_publication_requests:SELECT | なし | なし | なし | — |
| private.job_publication_requests:INSERT | なし | なし | なし | — |
| private.job_publication_requests:UPDATE | なし | なし | なし | — |
| private.job_publication_requests:DELETE | なし | なし | なし | — |
| private.listing_photo_legacy_access:SELECT | なし | なし | なし | — |
| private.listing_photo_legacy_access:INSERT | なし | なし | なし | — |
| private.listing_photo_legacy_access:UPDATE | なし | なし | なし | — |
| private.listing_photo_legacy_access:DELETE | なし | なし | なし | — |
| public.account_allowlist:SELECT | あり（条件付き） | あり（条件付き） | なし | — |
| public.account_allowlist:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.account_allowlist:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.account_allowlist:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.account_holder_changes:SELECT | なし | あり（条件付き） | ahc self or admin read | account_holder_changes_lock |
| public.account_holder_changes:INSERT | なし | なし | なし | account_holder_changes_lock |
| public.account_holder_changes:UPDATE | なし | なし | なし | account_holder_changes_lock |
| public.account_holder_changes:DELETE | なし | なし | なし | account_holder_changes_lock |
| public.account_holders:SELECT | あり（条件付き） | あり（条件付き） | own_select | firehose / lock_account_identity / log_account_holder_change / notify_new_account / seed_emergency_contact / trg_a_block_moderated / trg_min_age / trg_updated_at |
| public.account_holders:INSERT | あり（条件付き） | あり（条件付き） | own_insert | firehose / lock_account_identity / log_account_holder_change / notify_new_account / seed_emergency_contact / trg_a_block_moderated / trg_min_age / trg_updated_at |
| public.account_holders:UPDATE | あり（条件付き） | あり（条件付き） | own_update | firehose / lock_account_identity / log_account_holder_change / notify_new_account / seed_emergency_contact / trg_a_block_moderated / trg_min_age / trg_updated_at |
| public.account_holders:DELETE | あり（条件付き） | あり（条件付き） | なし | firehose / lock_account_identity / log_account_holder_change / notify_new_account / seed_emergency_contact / trg_a_block_moderated / trg_min_age / trg_updated_at |
| public.account_moderation:SELECT | あり（条件付き） | あり（条件付き） | am admin all | — |
| public.account_moderation:INSERT | あり（条件付き） | あり（条件付き） | am admin all | — |
| public.account_moderation:UPDATE | あり（条件付き） | あり（条件付き） | am admin all | — |
| public.account_moderation:DELETE | あり（条件付き） | あり（条件付き） | am admin all | — |
| public.admin_box_registry:SELECT | あり（条件付き） | あり（条件付き） | box registry admin all | — |
| public.admin_box_registry:INSERT | あり（条件付き） | あり（条件付き） | box registry admin all | — |
| public.admin_box_registry:UPDATE | あり（条件付き） | あり（条件付き） | box registry admin all | — |
| public.admin_box_registry:DELETE | あり（条件付き） | あり（条件付き） | box registry admin all | — |
| public.admin_messages:SELECT | あり（条件付き） | あり（条件付き） | am select | authz_admin_message_audit / authz_admin_message_history / trg_notify_admin_on_user_dm / trg_notify_push_admin_message |
| public.admin_messages:INSERT | あり（条件付き） | あり（条件付き） | am insert | authz_admin_message_audit / authz_admin_message_history / trg_notify_admin_on_user_dm / trg_notify_push_admin_message |
| public.admin_messages:UPDATE | あり（条件付き） | あり（条件付き） | am update | authz_admin_message_audit / authz_admin_message_history / trg_notify_admin_on_user_dm / trg_notify_push_admin_message |
| public.admin_messages:DELETE | あり（条件付き） | あり（条件付き） | なし | authz_admin_message_audit / authz_admin_message_history / trg_notify_admin_on_user_dm / trg_notify_push_admin_message |
| public.admin_notice_registry:SELECT | あり（条件付き） | あり（条件付き） | notice registry admin all / notices public read active | — |
| public.admin_notice_registry:INSERT | あり（条件付き） | あり（条件付き） | notice registry admin all | — |
| public.admin_notice_registry:UPDATE | あり（条件付き） | あり（条件付き） | notice registry admin all | — |
| public.admin_notice_registry:DELETE | あり（条件付き） | あり（条件付き） | notice registry admin all | — |
| public.app_admins:SELECT | あり（条件付き） | あり（条件付き） | app_admins self read | — |
| public.app_admins:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.app_admins:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.app_admins:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.app_errors:SELECT | あり（条件付き） | あり（条件付き） | admin_select_app_errors | trg_app_errors_rate_limit / trg_z_app_error_report |
| public.app_errors:INSERT | あり（条件付き） | あり（条件付き） | anyone_insert_app_errors | trg_app_errors_rate_limit / trg_z_app_error_report |
| public.app_errors:UPDATE | あり（条件付き） | あり（条件付き） | admin_update_app_errors | trg_app_errors_rate_limit / trg_z_app_error_report |
| public.app_errors:DELETE | あり（条件付き） | あり（条件付き） | なし | trg_app_errors_rate_limit / trg_z_app_error_report |
| public.app_settings:SELECT | あり（条件付き） | あり（条件付き） | なし | — |
| public.app_settings:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.app_settings:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.app_settings:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.application_followup_notices:SELECT | なし | なし | なし | — |
| public.application_followup_notices:INSERT | なし | なし | なし | — |
| public.application_followup_notices:UPDATE | なし | なし | なし | — |
| public.application_followup_notices:DELETE | なし | なし | なし | — |
| public.applications:SELECT | あり（条件付き） | あり（条件付き） | app farmer select / app worker select | app_review_clock / authz_no_show_clock / block_apply_when_filled / enrich_terms_snapshot_party / firehose / instant_approve / notify_application / protect_terms_snapshot / trg_a_block_moderated / trg_applications_stamp_status_change / trg_stamp_worker_terms_on_apply / trg_worker_exp_snapshot_ins / trg_worker_exp_snapshot_upd |
| public.applications:INSERT | あり（条件付き） | あり（条件付き） | なし | app_review_clock / authz_no_show_clock / block_apply_when_filled / enrich_terms_snapshot_party / firehose / instant_approve / notify_application / protect_terms_snapshot / trg_a_block_moderated / trg_applications_stamp_status_change / trg_stamp_worker_terms_on_apply / trg_worker_exp_snapshot_ins / trg_worker_exp_snapshot_upd |
| public.applications:UPDATE | あり（条件付き） | あり（条件付き） | なし | app_review_clock / authz_no_show_clock / block_apply_when_filled / enrich_terms_snapshot_party / firehose / instant_approve / notify_application / protect_terms_snapshot / trg_a_block_moderated / trg_applications_stamp_status_change / trg_stamp_worker_terms_on_apply / trg_worker_exp_snapshot_ins / trg_worker_exp_snapshot_upd |
| public.applications:DELETE | あり（条件付き） | あり（条件付き） | なし | app_review_clock / authz_no_show_clock / block_apply_when_filled / enrich_terms_snapshot_party / firehose / instant_approve / notify_application / protect_terms_snapshot / trg_a_block_moderated / trg_applications_stamp_status_change / trg_stamp_worker_terms_on_apply / trg_worker_exp_snapshot_ins / trg_worker_exp_snapshot_upd |
| public.attendance_events:SELECT | あり（条件付き） | あり（条件付き） | att admin select / att select party | authz_attendance_dispute / notify_attendance / trg_a_block_moderated |
| public.attendance_events:INSERT | あり（条件付き） | あり（条件付き） | att insert party | authz_attendance_dispute / notify_attendance / trg_a_block_moderated |
| public.attendance_events:UPDATE | あり（条件付き） | あり（条件付き） | なし | authz_attendance_dispute / notify_attendance / trg_a_block_moderated |
| public.attendance_events:DELETE | あり（条件付き） | あり（条件付き） | なし | authz_attendance_dispute / notify_attendance / trg_a_block_moderated |
| public.auth_logs:SELECT | あり（条件付き） | あり（条件付き） | なし | — |
| public.auth_logs:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.auth_logs:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.auth_logs:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.chat_reads:SELECT | あり（条件付き） | あり（条件付き） | chat_reads counterpart select / chat_reads own upsert | — |
| public.chat_reads:INSERT | あり（条件付き） | あり（条件付き） | chat_reads own upsert | — |
| public.chat_reads:UPDATE | あり（条件付き） | あり（条件付き） | chat_reads own upsert | — |
| public.chat_reads:DELETE | あり（条件付き） | あり（条件付き） | chat_reads own upsert | — |
| public.consignment_deals:SELECT | あり（条件付き） | あり（条件付き） | cd admin all / consignment admin only | consignment_touch / trg_consign_freeze_spec |
| public.consignment_deals:INSERT | あり（条件付き） | あり（条件付き） | cd admin all / consignment admin only | consignment_touch / trg_consign_freeze_spec |
| public.consignment_deals:UPDATE | あり（条件付き） | あり（条件付き） | cd admin all / consignment admin only | consignment_touch / trg_consign_freeze_spec |
| public.consignment_deals:DELETE | あり（条件付き） | あり（条件付き） | cd admin all / consignment admin only | consignment_touch / trg_consign_freeze_spec |
| public.consignment_fields:SELECT | なし | あり（条件付き） | consignment_fields admin all | — |
| public.consignment_fields:INSERT | なし | あり（条件付き） | consignment_fields admin all | — |
| public.consignment_fields:UPDATE | なし | あり（条件付き） | consignment_fields admin all | — |
| public.consignment_fields:DELETE | なし | あり（条件付き） | consignment_fields admin all | — |
| public.consignment_profiles:SELECT | あり（条件付き） | あり（条件付き） | consignment_profiles admin all | — |
| public.consignment_profiles:INSERT | あり（条件付き） | あり（条件付き） | consignment_profiles admin all | — |
| public.consignment_profiles:UPDATE | あり（条件付き） | あり（条件付き） | consignment_profiles admin all | — |
| public.consignment_profiles:DELETE | あり（条件付き） | あり（条件付き） | consignment_profiles admin all | — |
| public.consignment_progress:SELECT | あり（条件付き） | あり（条件付き） | cprog admin only | — |
| public.consignment_progress:INSERT | あり（条件付き） | あり（条件付き） | cprog admin only | — |
| public.consignment_progress:UPDATE | あり（条件付き） | あり（条件付き） | cprog admin only | — |
| public.consignment_progress:DELETE | あり（条件付き） | あり（条件付き） | cprog admin only | — |
| public.dests:SELECT | あり（条件付き） | あり（条件付き） | dests admin read | — |
| public.dests:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.dests:UPDATE | あり（条件付き） | あり（条件付き） | dests_admin_update | — |
| public.dests:DELETE | あり（条件付き） | あり（条件付き） | dests_admin_delete | — |
| public.emergency_contacts:SELECT | あり（条件付き） | あり（条件付き） | ec own select | — |
| public.emergency_contacts:INSERT | あり（条件付き） | あり（条件付き） | ec own insert | — |
| public.emergency_contacts:UPDATE | あり（条件付き） | あり（条件付き） | ec own update | — |
| public.emergency_contacts:DELETE | あり（条件付き） | あり（条件付き） | ec own delete | — |
| public.employer_profiles:SELECT | あり（条件付き） | あり（条件付き） | ep admin select / ep owner select | firehose / trg_a_block_moderated / trg_employer_profiles_updated_at / trg_ep_z_publish_texts |
| public.employer_profiles:INSERT | あり（条件付き） | あり（条件付き） | ep owner insert | firehose / trg_a_block_moderated / trg_employer_profiles_updated_at / trg_ep_z_publish_texts |
| public.employer_profiles:UPDATE | あり（条件付き） | あり（条件付き） | ep owner update | firehose / trg_a_block_moderated / trg_employer_profiles_updated_at / trg_ep_z_publish_texts |
| public.employer_profiles:DELETE | あり（条件付き） | あり（条件付き） | なし | firehose / trg_a_block_moderated / trg_employer_profiles_updated_at / trg_ep_z_publish_texts |
| public.employer_profiles_public:SELECT | なし | あり（条件付き） | なし | — |
| public.employer_profiles_public:INSERT | なし | なし | なし | — |
| public.employer_profiles_public:UPDATE | なし | なし | なし | — |
| public.employer_profiles_public:DELETE | なし | なし | なし | — |
| public.event_audit:SELECT | あり（条件付き） | あり（条件付き） | audit admin read | — |
| public.event_audit:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.event_audit:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.event_audit:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.farm_timeless_posts:SELECT | あり（条件付き） | あり（条件付き） | farm_timeless admin all | — |
| public.farm_timeless_posts:INSERT | あり（条件付き） | あり（条件付き） | farm_timeless admin all | — |
| public.farm_timeless_posts:UPDATE | あり（条件付き） | あり（条件付き） | farm_timeless admin all | — |
| public.farm_timeless_posts:DELETE | あり（条件付き） | あり（条件付き） | farm_timeless admin all | — |
| public.farmer_question_sets:SELECT | あり（条件付き） | あり（条件付き） | fqs owner all | fqs_touch |
| public.farmer_question_sets:INSERT | あり（条件付き） | あり（条件付き） | fqs owner all | fqs_touch |
| public.farmer_question_sets:UPDATE | あり（条件付き） | あり（条件付き） | fqs owner all | fqs_touch |
| public.farmer_question_sets:DELETE | あり（条件付き） | あり（条件付き） | fqs owner all | fqs_touch |
| public.farmers:SELECT | あり（条件付き） | あり（条件付き） | farmers_admin / farmers_admin_select / farmers_own / farmers_select_own_by_email | trg_a_block_moderated / trg_set_farmer_auth_id_from_email |
| public.farmers:INSERT | あり（条件付き） | あり（条件付き） | farmers_insert_own / farmers_insert_own_by_email | trg_a_block_moderated / trg_set_farmer_auth_id_from_email |
| public.farmers:UPDATE | あり（条件付き） | あり（条件付き） | farmers admin update / farmers_update_own / farmers_update_own_by_email | trg_a_block_moderated / trg_set_farmer_auth_id_from_email |
| public.farmers:DELETE | あり（条件付き） | あり（条件付き） | farmers_delete_own | trg_a_block_moderated / trg_set_farmer_auth_id_from_email |
| public.feedback:SELECT | なし | あり（条件付き） | fb select admin | feedback_support_prepare / feedback_support_touch / notify_feedback / trg_a_block_moderated |
| public.feedback:INSERT | なし | あり（条件付き） | fb insert own | feedback_support_prepare / feedback_support_touch / notify_feedback / trg_a_block_moderated |
| public.feedback:UPDATE | なし | あり（条件付き） | fb update admin | feedback_support_prepare / feedback_support_touch / notify_feedback / trg_a_block_moderated |
| public.feedback:DELETE | なし | あり（条件付き） | なし | feedback_support_prepare / feedback_support_touch / notify_feedback / trg_a_block_moderated |
| public.help_images:SELECT | あり（条件付き） | あり（条件付き） | hi read all | — |
| public.help_images:INSERT | あり（条件付き） | あり（条件付き） | hi admin write | — |
| public.help_images:UPDATE | あり（条件付き） | あり（条件付き） | hi admin update | — |
| public.help_images:DELETE | あり（条件付き） | あり（条件付き） | hi admin delete | — |
| public.industry_minimum_wages:SELECT | なし | なし | なし | — |
| public.industry_minimum_wages:INSERT | なし | なし | なし | — |
| public.industry_minimum_wages:UPDATE | なし | なし | なし | — |
| public.industry_minimum_wages:DELETE | なし | なし | なし | — |
| public.interview_question_sends:SELECT | なし | あり（条件付き） | iqs farmer select | — |
| public.interview_question_sends:INSERT | なし | なし | なし | — |
| public.interview_question_sends:UPDATE | なし | なし | なし | — |
| public.interview_question_sends:DELETE | なし | なし | なし | — |
| public.job_publish_checks:SELECT | なし | あり（条件付き） | jpc admin select / jpc owner select | trg_a_block_moderated / trg_jpc_lock_del / trg_jpc_lock_upd |
| public.job_publish_checks:INSERT | なし | あり（条件付き） | jpc owner insert | trg_a_block_moderated / trg_jpc_lock_del / trg_jpc_lock_upd |
| public.job_publish_checks:UPDATE | なし | なし | なし | trg_a_block_moderated / trg_jpc_lock_del / trg_jpc_lock_upd |
| public.job_publish_checks:DELETE | なし | なし | なし | trg_a_block_moderated / trg_jpc_lock_del / trg_jpc_lock_upd |
| public.job_questions:SELECT | あり（条件付き） | あり（条件付き） | jq read | firehose_job_questions / trg_a_block_moderated |
| public.job_questions:INSERT | あり（条件付き） | あり（条件付き） | なし | firehose_job_questions / trg_a_block_moderated |
| public.job_questions:UPDATE | あり（条件付き） | あり（条件付き） | なし | firehose_job_questions / trg_a_block_moderated |
| public.job_questions:DELETE | あり（条件付き） | あり（条件付き） | なし | firehose_job_questions / trg_a_block_moderated |
| public.job_reports:SELECT | あり（条件付き） | あり（条件付き） | report select admin | notify_job_report / trg_a_block_moderated |
| public.job_reports:INSERT | あり（条件付き） | あり（条件付き） | report insert own | notify_job_report / trg_a_block_moderated |
| public.job_reports:UPDATE | あり（条件付き） | あり（条件付き） | report admin update | notify_job_report / trg_a_block_moderated |
| public.job_reports:DELETE | あり（条件付き） | あり（条件付き） | なし | notify_job_report / trg_a_block_moderated |
| public.job_time_notices:SELECT | なし | なし | なし | — |
| public.job_time_notices:INSERT | なし | なし | なし | — |
| public.job_time_notices:UPDATE | なし | なし | なし | — |
| public.job_time_notices:DELETE | なし | なし | なし | — |
| public.job_view_counts:SELECT | あり（条件付き） | あり（条件付き） | job_view_counts read | — |
| public.job_view_counts:INSERT | なし | なし | なし | — |
| public.job_view_counts:UPDATE | なし | なし | なし | — |
| public.job_view_counts:DELETE | なし | なし | なし | — |
| public.job_view_marks:SELECT | なし | なし | なし | — |
| public.job_view_marks:INSERT | なし | なし | なし | — |
| public.job_view_marks:UPDATE | なし | なし | なし | — |
| public.job_view_marks:DELETE | なし | なし | なし | — |
| public.jobs:SELECT | あり（条件付き） | あり（条件付き） | jobs admin write / jobs owner select | block_delete_past_job / block_third_party_open / clear_job_revision_flag / firehose / job_publish_snapshot / job_publish_zscope / job_review_clock / notify_job_open_fyi / notify_job_published / notify_roster / remember_admin_listing_photos / require_recruiter_info / trg_a_block_moderated / trg_set_job_opened_at_ins / trg_set_job_opened_at_upd / zz_job_wage_floor_guard |
| public.jobs:INSERT | あり（条件付き） | あり（条件付き） | jobs admin write / jobs owner insert draft | block_delete_past_job / block_third_party_open / clear_job_revision_flag / firehose / job_publish_snapshot / job_publish_zscope / job_review_clock / notify_job_open_fyi / notify_job_published / notify_roster / remember_admin_listing_photos / require_recruiter_info / trg_a_block_moderated / trg_set_job_opened_at_ins / trg_set_job_opened_at_upd / zz_job_wage_floor_guard |
| public.jobs:UPDATE | あり（条件付き） | あり（条件付き） | jobs admin write / jobs owner update draft | block_delete_past_job / block_third_party_open / clear_job_revision_flag / firehose / job_publish_snapshot / job_publish_zscope / job_review_clock / notify_job_open_fyi / notify_job_published / notify_roster / remember_admin_listing_photos / require_recruiter_info / trg_a_block_moderated / trg_set_job_opened_at_ins / trg_set_job_opened_at_upd / zz_job_wage_floor_guard |
| public.jobs:DELETE | あり（条件付き） | あり（条件付き） | jobs admin write / jobs owner delete draft | block_delete_past_job / block_third_party_open / clear_job_revision_flag / firehose / job_publish_snapshot / job_publish_zscope / job_review_clock / notify_job_open_fyi / notify_job_published / notify_roster / remember_admin_listing_photos / require_recruiter_info / trg_a_block_moderated / trg_set_job_opened_at_ins / trg_set_job_opened_at_upd / zz_job_wage_floor_guard |
| public.jobs_public:SELECT | あり（条件付き） | あり（条件付き） | なし | — |
| public.jobs_public:INSERT | なし | なし | なし | — |
| public.jobs_public:UPDATE | なし | なし | なし | — |
| public.jobs_public:DELETE | なし | なし | なし | — |
| public.mail_registry:SELECT | あり（条件付き） | あり（条件付き） | なし | — |
| public.mail_registry:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.mail_registry:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.mail_registry:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.market_stats:SELECT | あり（条件付き） | あり（条件付き） | market_stats_public_read | — |
| public.market_stats:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.market_stats:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.market_stats:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.message_reports:SELECT | あり（条件付き） | あり（条件付き） | mr admin all / mr reporter select own | trg_a_block_moderated |
| public.message_reports:INSERT | あり（条件付き） | あり（条件付き） | mr admin all | trg_a_block_moderated |
| public.message_reports:UPDATE | あり（条件付き） | あり（条件付き） | mr admin all | trg_a_block_moderated |
| public.message_reports:DELETE | あり（条件付き） | あり（条件付き） | mr admin all | trg_a_block_moderated |
| public.messages:SELECT | あり（条件付き） | あり（条件付き） | msg select party | firehose / notify_message / trg_messages_history_lock_del / trg_messages_history_lock_upd / trg_notify_push_message |
| public.messages:INSERT | あり（条件付き） | あり（条件付き） | msg insert party | firehose / notify_message / trg_messages_history_lock_del / trg_messages_history_lock_upd / trg_notify_push_message |
| public.messages:UPDATE | なし | 列限定 | msg recipient mark read | firehose / notify_message / trg_messages_history_lock_del / trg_messages_history_lock_upd / trg_notify_push_message |
| public.messages:DELETE | あり（条件付き） | あり（条件付き） | なし | firehose / notify_message / trg_messages_history_lock_del / trg_messages_history_lock_upd / trg_notify_push_message |
| public.minimum_wages:SELECT | あり（条件付き） | あり（条件付き） | minimum_wages_select_all | — |
| public.minimum_wages:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.minimum_wages:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.minimum_wages:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.notifications:SELECT | あり（条件付き） | あり（条件付き） | notifications_own | — |
| public.notifications:INSERT | あり（条件付き） | あり（条件付き） | notifications_own | — |
| public.notifications:UPDATE | あり（条件付き） | あり（条件付き） | notifications_own | — |
| public.notifications:DELETE | あり（条件付き） | あり（条件付き） | notifications_own | — |
| public.page_events:SELECT | あり（条件付き） | あり（条件付き） | pe select admin | session_start |
| public.page_events:INSERT | あり（条件付き） | あり（条件付き） | pe insert self admin only | session_start |
| public.page_events:UPDATE | あり（条件付き） | あり（条件付き） | なし | session_start |
| public.page_events:DELETE | あり（条件付き） | あり（条件付き） | なし | session_start |
| public.pay_incidents:SELECT | あり（条件付き） | あり（条件付き） | pay incidents admin all / pay incidents reporter select | — |
| public.pay_incidents:INSERT | あり（条件付き） | あり（条件付き） | pay incidents admin all | — |
| public.pay_incidents:UPDATE | あり（条件付き） | あり（条件付き） | pay incidents admin all | — |
| public.pay_incidents:DELETE | あり（条件付き） | あり（条件付き） | pay incidents admin all | — |
| public.pending_applications:SELECT | あり（条件付き） | あり（条件付き） | pending admin read / pending own | trg_a_block_moderated |
| public.pending_applications:INSERT | あり（条件付き） | あり（条件付き） | pending own | trg_a_block_moderated |
| public.pending_applications:UPDATE | あり（条件付き） | あり（条件付き） | pending own | trg_a_block_moderated |
| public.pending_applications:DELETE | あり（条件付き） | あり（条件付き） | pending own | trg_a_block_moderated |
| public.policy_update_notices:SELECT | なし | なし | なし | — |
| public.policy_update_notices:INSERT | なし | なし | なし | — |
| public.policy_update_notices:UPDATE | なし | なし | なし | — |
| public.policy_update_notices:DELETE | なし | なし | なし | — |
| public.product_events:SELECT | なし | あり（条件付き） | product_events_admin_select | — |
| public.product_events:INSERT | 列限定 | 列限定 | product_events_insert | — |
| public.product_events:UPDATE | なし | なし | なし | — |
| public.product_events:DELETE | なし | なし | なし | — |
| public.profile_reports:SELECT | なし | あり（条件付き） | pr select admin | trg_a_block_moderated |
| public.profile_reports:INSERT | なし | あり（条件付き） | pr insert own | trg_a_block_moderated |
| public.profile_reports:UPDATE | なし | あり（条件付き） | pr admin update | trg_a_block_moderated |
| public.profile_reports:DELETE | なし | あり（条件付き） | なし | trg_a_block_moderated |
| public.push_config:SELECT | あり（条件付き） | あり（条件付き） | なし | — |
| public.push_config:INSERT | あり（条件付き） | あり（条件付き） | なし | — |
| public.push_config:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.push_config:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.push_subscriptions:SELECT | あり（条件付き） | あり（条件付き） | push own manage | — |
| public.push_subscriptions:INSERT | あり（条件付き） | あり（条件付き） | push own manage | — |
| public.push_subscriptions:UPDATE | あり（条件付き） | あり（条件付き） | push own manage | — |
| public.push_subscriptions:DELETE | あり（条件付き） | あり（条件付き） | push own manage | — |
| public.records:SELECT | あり（条件付き） | あり（条件付き） | records_admin / records_admin_select / records_own / records_select_own | — |
| public.records:INSERT | あり（条件付き） | あり（条件付き） | records_insert / records_insert_own | — |
| public.records:UPDATE | あり（条件付き） | あり（条件付き） | records_update / records_update_own | — |
| public.records:DELETE | あり（条件付き） | あり（条件付き） | records_admin_delete / records_delete / records_delete_own | — |
| public.repeat_roster:SELECT | あり（条件付き） | あり（条件付き） | roster farmer manage / roster worker view | — |
| public.repeat_roster:INSERT | あり（条件付き） | あり（条件付き） | roster farmer manage | — |
| public.repeat_roster:UPDATE | あり（条件付き） | あり（条件付き） | roster farmer manage | — |
| public.repeat_roster:DELETE | あり（条件付き） | あり（条件付き） | roster farmer manage | — |
| public.reviews:SELECT | あり（条件付き） | あり（条件付き） | review select own | firehose / pay_incident_on_unpaid / review_celebration / reviews_party_consistency / reviews_phase_gate |
| public.reviews:INSERT | あり（条件付き） | あり（条件付き） | review insert own | firehose / pay_incident_on_unpaid / review_celebration / reviews_party_consistency / reviews_phase_gate |
| public.reviews:UPDATE | あり（条件付き） | あり（条件付き） | なし | firehose / pay_incident_on_unpaid / review_celebration / reviews_party_consistency / reviews_phase_gate |
| public.reviews:DELETE | あり（条件付き） | あり（条件付き） | なし | firehose / pay_incident_on_unpaid / review_celebration / reviews_party_consistency / reviews_phase_gate |
| public.saved_jobs:SELECT | あり（条件付き） | あり（条件付き） | saved select own | firehose / trg_a_block_moderated / trg_saved_jobs_not_own |
| public.saved_jobs:INSERT | あり（条件付き） | あり（条件付き） | saved insert own | firehose / trg_a_block_moderated / trg_saved_jobs_not_own |
| public.saved_jobs:UPDATE | あり（条件付き） | あり（条件付き） | なし | firehose / trg_a_block_moderated / trg_saved_jobs_not_own |
| public.saved_jobs:DELETE | あり（条件付き） | あり（条件付き） | saved delete own | firehose / trg_a_block_moderated / trg_saved_jobs_not_own |
| public.user_onboarding_survey:SELECT | あり（条件付き） | あり（条件付き） | survey admin select / survey own select | — |
| public.user_onboarding_survey:INSERT | あり（条件付き） | あり（条件付き） | survey own insert | — |
| public.user_onboarding_survey:UPDATE | あり（条件付き） | あり（条件付き） | なし | — |
| public.user_onboarding_survey:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.withdrawal_requests:SELECT | あり（条件付き） | あり（条件付き） | wr self or admin select | — |
| public.withdrawal_requests:INSERT | あり（条件付き） | あり（条件付き） | wr self insert | — |
| public.withdrawal_requests:UPDATE | あり（条件付き） | あり（条件付き） | wr admin update | — |
| public.withdrawal_requests:DELETE | あり（条件付き） | あり（条件付き） | なし | — |
| public.worker_profile_view_counts:SELECT | なし | あり（条件付き） | wpvc self select | — |
| public.worker_profile_view_counts:INSERT | なし | なし | なし | — |
| public.worker_profile_view_counts:UPDATE | なし | なし | なし | — |
| public.worker_profile_view_counts:DELETE | なし | なし | なし | — |
| public.worker_profiles:SELECT | あり（条件付き） | あり（条件付き） | wp admin select / wp owner select | firehose / trg_a_block_moderated / trg_wp_default_nickname / trg_wp_nickname_unique / trg_wp_review_dedupe / trg_wp_z_publish_texts |
| public.worker_profiles:INSERT | あり（条件付き） | あり（条件付き） | wp owner insert | firehose / trg_a_block_moderated / trg_wp_default_nickname / trg_wp_nickname_unique / trg_wp_review_dedupe / trg_wp_z_publish_texts |
| public.worker_profiles:UPDATE | あり（条件付き） | あり（条件付き） | wp admin update / wp owner update | firehose / trg_a_block_moderated / trg_wp_default_nickname / trg_wp_nickname_unique / trg_wp_review_dedupe / trg_wp_z_publish_texts |
| public.worker_profiles:DELETE | あり（条件付き） | あり（条件付き） | なし | firehose / trg_a_block_moderated / trg_wp_default_nickname / trg_wp_nickname_unique / trg_wp_review_dedupe / trg_wp_z_publish_texts |
| storage.objects:SELECT | あり（条件付き） | あり（条件付き） | Anyone can view avatars 1oj01fe_0 / Users delete own avatar 1oj01fe_1 / farm-timeless authenticated read / help img read / job-photos admin write / listing photos authorized read | — |
| storage.objects:INSERT | あり（条件付き） | あり（条件付き） | Users upload own avatar 1oj01fe_0 / consignment-photos admin insert / employer avatar insert / farm-timeless admin insert / help img admin write / job-photos admin write / job-photos owner insert / worker avatar insert | — |
| storage.objects:UPDATE | あり（条件付き） | あり（条件付き） | consignment-photos admin update / employer avatar update / farm-timeless admin update / help img admin update / job-photos admin write / job-photos owner update / worker avatar update | — |
| storage.objects:DELETE | あり（条件付き） | あり（条件付き） | Users delete own avatar 1oj01fe_0 / consignment-photos admin delete / employer avatar delete / farm-timeless admin delete / help img admin delete / job-photos admin write / job-photos owner delete / worker avatar delete | — |

## 関数：実行権限

実行権限「あり」は入口を呼べるという意味。関数内の当事者・管理者・状態・期限の判定で拒否される場合がある。内部関数はHTTP経由の公開を意味しない。

| 関数 | 区分 | 匿名 EXECUTE | 会員 EXECUTE | 実行権限の主体 |
|---|---|---|---|---|
| private.admin_support_update(p_id uuid, p_expected_updated_at timestamp with time zone, p_status text, p_body text, p_message_id uuid) | internal-function | なし | あり | 定義者（内部判定必須） |
| private.application_write_denial(p_id uuid, p_action text) | internal-function | なし | なし | 定義者（内部判定必須） |
| private.audit_admin_message() | trigger-function | なし | なし | 定義者（内部判定必須） |
| private.can_read_listing_photo(p_bucket text, p_name text, p_owner text) | internal-function | なし | あり | 定義者（内部判定必須） |
| private.can_read_meeting_address(p_job_number integer) | internal-function | あり | あり | 定義者（内部判定必須） |
| private.cleanup_guest_support() | internal-function | なし | なし | 定義者（内部判定必須） |
| private.confirm_worker_terms(p_owner uuid, p_application_id uuid) | internal-function | なし | あり | 定義者（内部判定必須） |
| private.copy_job_once(p_owner uuid, p_request_id uuid, p_job_number integer) | internal-function | なし | あり | 定義者（内部判定必須） |
| private.guard_admin_message_history() | trigger-function | なし | なし | 定義者（内部判定必須） |
| private.guard_attendance_dispute() | trigger-function | なし | なし | 定義者（内部判定必須） |
| private.listing_photo_urls(p_photos jsonb, p_places jsonb, p_tasks jsonb) | internal-function | なし | なし | 呼出者 |
| private.publish_job_with_check(p_request_id uuid, p_job_id uuid, p_expected jsonb, p_items jsonb, p_agreed_at timestamp with time zone) | internal-function | なし | あり | 定義者（内部判定必須） |
| private.remember_admin_listing_photos() | trigger-function | なし | なし | 定義者（内部判定必須） |
| private.save_consignment_bundle(p_owner uuid, p_request_id uuid, p_deal_id uuid, p_expected jsonb, p_patch jsonb, p_expected_field jsonb, p_terms jsonb) | internal-function | なし | あり | 定義者（内部判定必須） |
| private.stamp_no_show_recorded_at() | trigger-function | なし | なし | 呼出者 |
| private.support_can_access(p_id uuid, p_guest_token text) | internal-function | なし | なし | 定義者（内部判定必須） |
| private.support_create(p_id uuid, p_guest_token text, p_category text, p_topic text, p_impact text, p_body text, p_expected text, p_page_hash text, p_diagnostics jsonb) | internal-function | あり | あり | 定義者（内部判定必須） |
| private.support_detail(p_id uuid, p_guest_token text) | internal-function | あり | あり | 定義者（内部判定必須） |
| private.support_diagnostics(p_data jsonb) | internal-function | なし | なし | 呼出者 |
| private.support_is_admin() | internal-function | なし | なし | 定義者（内部判定必須） |
| private.support_list(p_guest_token text) | internal-function | あり | あり | 定義者（内部判定必須） |
| private.support_path(p_path text) | internal-function | なし | なし | 呼出者 |
| private.support_prepare_insert() | trigger-function | なし | なし | 定義者（内部判定必須） |
| private.support_reply(p_id uuid, p_guest_token text, p_message_id uuid, p_body text, p_reopen boolean) | internal-function | あり | あり | 定義者（内部判定必須） |
| private.support_report(p_report feedback) | internal-function | なし | なし | 呼出者 |
| private.support_token(p_token text) | internal-function | なし | なし | 呼出者 |
| private.support_touch() | trigger-function | なし | なし | 呼出者 |
| public.admin_account_jobs(p_auth_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_attention() | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_hide_question(p_id uuid, p_hidden boolean) | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_list_accounts() | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_list_contracts() | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_moderate_account(p_auth_id uuid, p_action text, p_reason text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_preview_application_followups(p_to uuid, p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.admin_preview_job(p_job_number integer) | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_preview_job_time_notices(p_to uuid, p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.admin_product_analytics(p_days integer) | rpc | なし | あり | 呼出者 |
| public.admin_review_comments() | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_send_emergency_contact_reminder(p_target uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.admin_send_policy_update(p_doc text, p_version text, p_target uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.admin_support_update(p_id uuid, p_expected_updated_at timestamp with time zone, p_status text, p_body text, p_message_id uuid) | rpc | なし | あり | 呼出者 |
| public.admin_work_reviews(p_direction text, p_offset integer) | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_worker_list() | rpc | なし | あり | 定義者（内部判定必須） |
| public.admin_working_jobs() | rpc | なし | あり | 定義者（内部判定必須） |
| public.am_i_account_allowed() | rpc | なし | あり | 定義者（内部判定必須） |
| public.answer_job_question(p_id uuid, p_answer text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.app_accrued_days(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.app_accrued_minutes(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.app_error_report_to_admin() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.app_errors_rate_limit() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.app_phase(a applications) | rpc | あり | あり | 呼出者 |
| public.app_review_accepting(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.app_review_opened_at(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.app_review_published(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.app_work_dates(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.app_work_due_at(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.application_followup_mail(p_app uuid, p_stage integer) | rpc | なし | なし | 定義者（内部判定必須） |
| public.apply_to_job(p_job_number integer, p_available_dates jsonb) | rpc | なし | あり | 定義者（内部判定必須） |
| public.approve_application(p_application_id uuid, p_approve boolean) | rpc | なし | あり | 定義者（内部判定必須） |
| public.approve_profile_text(p_auth_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.ask_job_question(p_job integer, p_question text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.assert_actor_not_moderated() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.assert_review_window(p_app uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.auto_complete_work() | rpc | なし | なし | 定義者（内部判定必須） |
| public.auto_start_work() | rpc | なし | なし | 定義者（内部判定必須） |
| public.cancel_application(p_application_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.chat_message_mail_send(p_auth_id uuid, p_subject text, p_body text, p_html text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.complete_work(p_application_id uuid, p_attended boolean) | rpc | なし | あり | 定義者（内部判定必須） |
| public.confirm_insurance(p_application_id uuid, p_items text[]) | rpc | なし | あり | 定義者（内部判定必須） |
| public.confirm_my_worker_terms(p_owner uuid, p_application_id uuid) | rpc | なし | あり | 呼出者 |
| public.confirm_terms(p_application_id uuid, p_accept_double_booking boolean) | rpc | なし | あり | 定義者（内部判定必須） |
| public.consignment_summary(p_deal_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.contract_emergency_contact(p_application_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.contract_party_name(p_application_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.copy_job(p_job_number integer) | rpc | なし | なし | 定義者（内部判定必須） |
| public.copy_my_job_once(p_owner uuid, p_request_id uuid, p_job_number integer) | rpc | なし | あり | 呼出者 |
| public.count_job_view(p_job_number integer) | rpc | なし | あり | 定義者（内部判定必須） |
| public.count_worker_profile_view(p_worker_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.create_pending_application(p_job integer, p_available_dates jsonb) | rpc | なし | あり | 定義者（内部判定必須） |
| public.cron_watchdog() | rpc | なし | なし | 定義者（内部判定必須） |
| public.current_privacy_version() | rpc | なし | あり | 定義者（内部判定必須） |
| public.employer_public_job_counts(p_job_number integer) | rpc | あり | あり | 定義者（内部判定必須） |
| public.employer_public_jobs(p_job_number integer) | rpc | あり | あり | 定義者（内部判定必須） |
| public.employer_public_jobs_by_farmer(p_farmer_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.employer_trust_info(p_farmer_id uuid) | rpc | あり | あり | 定義者（内部判定必須） |
| public.enforce_min_age() | trigger-function | あり | あり | 呼出者 |
| public.ep_z_publish_texts() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.expire_stale_applications() | rpc | なし | なし | 定義者（内部判定必須） |
| public.get_minimum_wage(p_prefecture text) | rpc | あり | あり | 呼出者 |
| public.get_my_calendar_jobs() | rpc | なし | あり | 定義者（内部判定必須） |
| public.h(p text) | rpc | あり | あり | 呼出者 |
| public.is_account_moderated(p_uid uuid) | rpc | あり | あり | 定義者（内部判定必須） |
| public.is_app_admin() | rpc | あり | あり | 定義者（内部判定必須） |
| public.is_job_party(p_job_number integer) | rpc | なし | なし | 定義者（内部判定必須） |
| public.is_measured(p_uid uuid) | rpc | あり | あり | 定義者（内部判定必須） |
| public.is_worker_profile_ready(p_uid uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.job_details_for_party(p_job_numbers integer[]) | rpc | なし | あり | 定義者（内部判定必須） |
| public.job_employer_profile(p_job_number integer) | rpc | あり | あり | 定義者（内部判定必須） |
| public.job_employer_reviews(p_job_number integer) | rpc | なし | あり | 定義者（内部判定必須） |
| public.job_employer_trust_info(p_job_number integer) | rpc | あり | あり | 定義者（内部判定必須） |
| public.job_exists(p_job_number integer) | rpc | あり | あり | 定義者（内部判定必須） |
| public.job_link(p_job integer) | rpc | あり | あり | 呼出者 |
| public.job_meeting_place(p_job_number integer) | rpc | なし | あり | 定義者（内部判定必須） |
| public.job_ref(p_job integer, p_viewer text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.job_scheduled_minutes(p_work_time text) | rpc | あり | あり | 呼出者 |
| public.job_scheduled_start(p_work_time text) | rpc | あり | あり | 呼出者 |
| public.job_time_notice_mail(p_app uuid, p_kind text, p_role text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.job_wage_floor_guard() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.jp_col(p_col text) | rpc | あり | あり | 呼出者 |
| public.jp_val(p jsonb) | rpc | あり | あり | 呼出者 |
| public.jpc_history_lock() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.jq_ng_check(p text) | rpc | あり | あり | 呼出者 |
| public.link_farmer_when_auth_user_created() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.mask_email(p text) | rpc | あり | あり | 呼出者 |
| public.messages_history_lock() | trigger-function | あり | あり | 呼出者 |
| public.moderate_review_comment(p_review_id uuid, p_approve boolean) | rpc | なし | あり | 定義者（内部判定必須） |
| public.move_job_dates(p_job_number integer, p_new_start date) | rpc | なし | あり | 定義者（内部判定必須） |
| public.my_chat_inbox_previews() | rpc | なし | あり | 呼出者 |
| public.my_chat_partner_initials() | rpc | なし | あり | 定義者（内部判定必須） |
| public.my_farm_applicants() | rpc | なし | あり | 呼出者 |
| public.my_farm_jobs() | rpc | なし | あり | 呼出者 |
| public.my_job_actions() | rpc | なし | あり | 定義者（内部判定必須） |
| public.my_nav_badges() | rpc | なし | あり | 定義者（内部判定必須） |
| public.my_todo_items() | rpc | なし | あり | 定義者（内部判定必須） |
| public.my_unread_message_counts() | rpc | なし | あり | 定義者（内部判定必須） |
| public.my_worker_trust_stats() | rpc | なし | あり | 定義者（内部判定必須） |
| public.notify_admin_on_user_dm() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.notify_admins(p_type text, p_message text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.notify_push_on_admin_message() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.notify_push_on_message() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.pending_job_previews() | rpc | あり | あり | 定義者（内部判定必須） |
| public.policy_update_mail(p_doc text, p_version text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.process_withdrawal(p_auth_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.profile_text_ng(p text) | rpc | あり | あり | 呼出者 |
| public.promote_my_pending_applications() | rpc | なし | あり | 定義者（内部判定必須） |
| public.publish_my_job(p_job_number integer) | rpc | なし | なし | 定義者（内部判定必須） |
| public.publish_my_job_with_check(p_request_id uuid, p_job_id uuid, p_expected jsonb, p_items jsonb, p_agreed_at timestamp with time zone) | rpc | なし | あり | 呼出者 |
| public.purge_old_app_errors() | rpc | なし | なし | 定義者（内部判定必須） |
| public.purge_old_job_view_marks() | rpc | なし | なし | 定義者（内部判定必須） |
| public.purge_old_page_events() | rpc | なし | なし | 定義者（内部判定必須） |
| public.push_payload(p_kind text, p_id uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.push_vapid_public() | rpc | あり | あり | 定義者（内部判定必須） |
| public.record_my_attendance_once(p_owner uuid, p_event_id uuid, p_input jsonb) | rpc | なし | あり | 呼出者 |
| public.report_chat_message(p_message_id uuid, p_reason text, p_detail text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.request_job_revision(p_job_number integer, p_reason text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.request_profile_revision(p_auth_id uuid, p_reason text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.resolve_actor_name(p_auth_id uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.resolve_job_time_notice_delivery() | rpc | なし | なし | 定義者（内部判定必須） |
| public.review_box(p_level text, p_label text, p_value text) | rpc | あり | あり | 呼出者 |
| public.review_traits_valid(p_direction text, p_traits jsonb) | rpc | なし | あり | 呼出者 |
| public.review_window(p_application_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.review_window_state(p_opened_at timestamp with time zone, p_at timestamp with time zone) | rpc | なし | なし | 呼出者 |
| public.reviews_public_badges(p_user_id uuid, p_direction text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.rls_auto_enable() | rpc | なし | あり | 定義者（内部判定必須） |
| public.save_help_image_reference(p_owner uuid, p_slot text, p_expected jsonb, p_url text) | rpc | なし | あり | 呼出者 |
| public.save_my_consignment_aux(p_owner uuid, p_operation text, p_id uuid, p_expected jsonb, p_input jsonb) | rpc | なし | あり | 呼出者 |
| public.save_my_consignment_bundle(p_owner uuid, p_request_id uuid, p_deal_id uuid, p_expected jsonb, p_patch jsonb, p_expected_field jsonb, p_terms jsonb) | rpc | なし | あり | 呼出者 |
| public.save_my_consignor_consent(p_owner uuid, p_version text, p_at timestamp with time zone) | rpc | なし | あり | 呼出者 |
| public.save_my_consignor_profile(p_owner uuid, p_expected jsonb, p_type text, p_data jsonb, p_expected_phone text, p_phone text) | rpc | なし | あり | 呼出者 |
| public.save_my_privacy_consent(p_auth_id uuid, p_version text) | rpc | なし | あり | 呼出者 |
| public.save_my_profile_fields(p_table text, p_expected jsonb, p_patch jsonb) | rpc | なし | なし | 呼出者 |
| public.save_my_profile_fields(p_table text, p_expected jsonb, p_patch jsonb, p_owner uuid) | rpc | なし | あり | 呼出者 |
| public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.seed_emergency_contact_from_holder() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.send_admin_email(p_subject text, p_body text, p_html text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_application_followups() | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_completion_confirmations() | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_daily_auth_digest() | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_insurance_reminders() | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_job_start_reminders() | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_job_time_notices() | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_review_reminder() | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_user_email(p_auth_id uuid, p_subject text, p_body text, p_html text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.send_user_email_unless_push(p_auth_id uuid, p_subject text, p_body text, p_html text) | rpc | なし | なし | 定義者（内部判定必須） |
| public.set_agreed_dates(p_application_id uuid, p_dates jsonb) | rpc | なし | あり | 定義者（内部判定必須） |
| public.set_application_followup(p_application_id uuid, p_kind text) | rpc | なし | あり | 定義者（内部判定必須） |
| public.set_employer_profiles_updated_at() | trigger-function | あり | あり | 呼出者 |
| public.set_farmer_auth_id_from_email() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.set_job_opened_at() | trigger-function | あり | あり | 呼出者 |
| public.set_my_available_dates(p_application_id uuid, p_dates jsonb) | rpc | なし | あり | 定義者（内部判定必須） |
| public.set_updated_at() | trigger-function | あり | あり | 呼出者 |
| public.set_worker_exp_snapshot() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.signup_open() | rpc | あり | あり | 定義者（内部判定必須） |
| public.stamp_worker_terms_on_apply() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.submit_farmer_final_review(p_application_id uuid, p_work_outcome text, p_want_again_choice text, p_traits jsonb, p_favorite boolean) | rpc | なし | あり | 定義者（内部判定必須） |
| public.submit_farmer_review(p_application_id uuid, p_want_again boolean, p_entrust boolean, p_public_comment text, p_private_memo text, p_favorite boolean, p_on_time boolean, p_as_described boolean, p_followed_instructions boolean, p_completed_work boolean) | rpc | なし | あり | 定義者（内部判定必須） |
| public.summarize_sessions() | rpc | なし | なし | 定義者（内部判定必須） |
| public.summarize_user_actions() | rpc | なし | なし | 定義者（内部判定必須） |
| public.support_create(p_id uuid, p_guest_token text, p_category text, p_topic text, p_impact text, p_body text, p_expected text, p_page_hash text, p_diagnostics jsonb) | rpc | あり | あり | 呼出者 |
| public.support_detail(p_id uuid, p_guest_token text) | rpc | あり | あり | 呼出者 |
| public.support_list(p_guest_token text) | rpc | あり | あり | 呼出者 |
| public.support_reply(p_id uuid, p_guest_token text, p_message_id uuid, p_body text, p_reopen boolean) | rpc | あり | あり | 呼出者 |
| public.sync_my_job_draft(p_owner uuid, p_id uuid, p_expected jsonb, p_patch jsonb) | rpc | なし | あり | 呼出者 |
| public.sync_my_open_job(p_owner uuid, p_id uuid, p_expected jsonb, p_patch jsonb) | rpc | なし | あり | 定義者（内部判定必須） |
| public.touch_updated_at() | trigger-function | あり | あり | 呼出者 |
| public.trg_account_holder_changes_lock() | trigger-function | あり | あり | 呼出者 |
| public.trg_app_review_clock() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.trg_block_apply_when_filled() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_block_delete_past_job() | trigger-function | あり | あり | 呼出者 |
| public.trg_block_third_party_open() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_clear_job_revision_flag() | trigger-function | あり | あり | 呼出者 |
| public.trg_consign_freeze_spec() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_enrich_terms_snapshot_party() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_firehose() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_instant_approve() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_job_publish_snapshot() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_job_publish_zscope() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_job_review_clock() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.trg_lock_account_identity() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_log_account_holder_change() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_application() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_attendance() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_feedback() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_job_open_fyi() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_job_published() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_job_report() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_message() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_new_account() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_notify_roster() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_pay_incident_on_unpaid() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_protect_terms_snapshot() | trigger-function | あり | あり | 呼出者 |
| public.trg_require_recruiter_info() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_review_celebration() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.trg_reviews_party_consistency() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_reviews_phase_gate() | trigger-function | なし | なし | 定義者（内部判定必須） |
| public.trg_saved_jobs_not_own() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_session_start() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.trg_stamp_status_change() | trigger-function | あり | あり | 呼出者 |
| public.unpublish_job(p_job_number integer) | rpc | なし | あり | 定義者（内部判定必須） |
| public.unread_count_for(p_uid uuid) | rpc | なし | なし | 定義者（内部判定必須） |
| public.update_account_holder_self(p_patch jsonb, p_source text) | rpc | なし | あり | 呼出者 |
| public.update_my_open_job(p_job_number integer, p_patch jsonb) | rpc | なし | あり | 定義者（内部判定必須） |
| public.worker_cards_for_farmer(p_worker_ids uuid[]) | rpc | なし | あり | 定義者（内部判定必須） |
| public.worker_profile_for_farmer(p_worker_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.worker_trust_info(p_worker_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.worker_trust_info_bulk(p_worker_ids uuid[]) | rpc | なし | あり | 定義者（内部判定必須） |
| public.worker_want_again_count(p_worker_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.worker_work_record(p_worker_id uuid) | rpc | なし | あり | 定義者（内部判定必須） |
| public.wp_default_nickname() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.wp_nickname_norm(p text) | rpc | なし | なし | 呼出者 |
| public.wp_nickname_unique() | trigger-function | あり | あり | 定義者（内部判定必須） |
| public.wp_review_dedupe() | trigger-function | あり | あり | 呼出者 |
| public.wp_z_publish_texts() | trigger-function | あり | あり | 定義者（内部判定必須） |

## ソースから呼び出す経路

動的な対象は式を明示。実行時の全分岐を列挙したという意味ではない。新規・変更呼び出しはCIの差分検査で止まる。

| 種別 | 対象・式 | 操作 | 呼出元 |
|---|---|---|---|
| auth | getSession |  | src/App.jsx |
| auth | getUser |  | src/App.jsx |
| auth | signOut |  | src/App.jsx |
| auth | stopAutoRefresh |  | src/App.jsx |
| auth | getSession |  | src/app/preview/PreviewSheets.jsx |
| auth | getSession |  | src/components/AccountHolderForm.jsx |
| auth | getSession |  | src/components/AdminChat.jsx |
| auth | getSession |  | src/components/AdminJobPreview.jsx |
| auth | getSession |  | src/components/AnalyticsPreferences.jsx |
| auth | getSession |  | src/components/ChatList.jsx |
| auth | getSession |  | src/components/ChatView.jsx |
| auth | getSession |  | src/components/EmployerProfileEdit.jsx |
| auth | getSession |  | src/components/JobLocationMap.jsx |
| auth | getSession |  | src/components/JobQuestions.jsx |
| auth | getSession |  | src/components/LikedJobs.jsx |
| auth | signInWithOtp |  | src/components/LoginScreen.jsx |
| auth | signInWithPassword |  | src/components/LoginScreen.jsx |
| auth | updateUser |  | src/components/LoginScreen.jsx |
| auth | verifyOtp |  | src/components/LoginScreen.jsx |
| auth | getSession |  | src/components/MyCalendar.jsx |
| auth | getSession |  | src/components/MyReviewsOfWorker.jsx |
| auth | getUser |  | src/components/OnboardingModal.jsx |
| auth | getSession |  | src/components/ProfileHub.jsx |
| auth | getUser |  | src/components/ProfileHub.jsx |
| auth | getUser |  | src/components/ProfileModal.jsx |
| auth | getSession |  | src/components/SavedJobsView.jsx |
| auth | getSession |  | src/components/WorkerApplications.jsx |
| auth | getSession |  | src/components/WorkerProfileEdit.jsx |
| auth | getSession |  | src/features/consignment/consignmentRecord.js |
| auth | getSession |  | src/features/consignment/ConsignmentRoom.jsx |
| auth | getSession |  | src/features/consignment/consignorRecord.js |
| auth | getSession |  | src/features/consignment/editor/ConsignorInfoEdit.jsx |
| auth | getSession |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| auth | getSession |  | src/features/jobs/create/jobCreateApi.js |
| auth | getSession |  | src/features/jobs/search/jobSearchApi.js |
| auth | getSession |  | src/features/today/todayApi.js |
| auth | getSession |  | src/lib/accountHolderRecord.js |
| auth | getSession |  | src/lib/attendanceRecord.js |
| auth | getSession |  | src/lib/copyJobRecord.js |
| auth | getSession |  | src/lib/helpImageRecord.js |
| auth | getSession |  | src/lib/listingPhotoAccess.js |
| auth | onAuthStateChange |  | src/lib/listingPhotoAccess.js |
| auth | getSession |  | src/lib/offlineSync.js |
| auth | getSession |  | src/lib/photoStorage.js |
| auth | getSession |  | src/lib/profileAvatar.js |
| auth | getSession |  | src/lib/profileRecord.js |
| auth | getSession |  | src/lib/savedJobRecord.js |
| auth | getSession |  | src/lib/workerReady.js |
| auth | getSession |  | src/lib/workerTermsRecord.js |
| fetch（動的） | q |  | api/j/[num].js |
| fetch（動的） | url |  | src/app/help/HelpCenter.jsx |
| fetch | "https://api.open-meteo.com/v1/forecast?latitude=34.066&longitude=134.366&current=wind_speed_10m,wind_direction_10m" |  | src/features/consignment/ConsignmentRoom.jsx |
| fetch（動的） | "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q) |  | src/features/jobs/create/jobCreateGeo.js |
| fetch（動的） | "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q) |  | src/lib/geocode.js |
| fetch（動的） | ...args |  | src/lib/requestTransport.js |
| fetch（動的） | `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}` |  | src/lib/supportClient.js |
| fetch（動的） | "https://zipcloud.ibsnet.co.jp/api/search?zipcode=" + zip |  | src/lib/zipLookup.js |
| fetch（動的） | `https://madefor.github.io/postal-code-api/api/v1/${zip.slice(0, 3)}/${zip.slice(3)}.json` |  | src/lib/zipLookup.js |
| realtime-channel | cb-profile-approved |  | src/App.jsx |
| realtime-channel | hired-watch |  | src/App.jsx |
| realtime-channel | stage-watch |  | src/App.jsx |
| realtime-channel | unread-badge |  | src/App.jsx |
| realtime-channel（動的） | "admin-dm-page:" + thread |  | src/components/AdminChat.jsx |
| realtime-channel | admin-dm-inbox |  | src/components/AdminChat.jsx |
| realtime-channel | admin-dm-row |  | src/components/AdminChat.jsx |
| realtime-channel | chatlist-live |  | src/components/ChatList.jsx |
| realtime-channel（動的） | "chat-" + applicationId |  | src/components/ChatView.jsx |
| realtime-subscription（動的） | { event: "*", schema: "public", table: "applications", filter: "farmer_id=eq." + me.id } | subscribe | src/App.jsx |
| realtime-subscription（動的） | { event: "*", schema: "public", table: "applications", filter: "worker_id=eq." + me.id } | subscribe | src/App.jsx |
| realtime-subscription（動的） | { event: "INSERT", schema: "public", table: "admin_messages" } | subscribe | src/App.jsx |
| realtime-subscription（動的） | { event: "INSERT", schema: "public", table: "messages" } | subscribe | src/App.jsx |
| realtime-subscription（動的） | { event: "INSERT", schema: "public", table: "notifications", filter: "farmer_id=eq." + uid } | subscribe | src/App.jsx |
| realtime-subscription（動的） | { event: "UPDATE", schema: "public", table: "applications", filter: "worker_id=eq." + me.id } | subscribe | src/App.jsx |
| realtime-subscription（動的） | { event: "INSERT", schema: "public", table: "admin_messages" } | subscribe | src/components/AdminChat.jsx |
| realtime-subscription（動的） | { event: "INSERT", schema: "public", table: "messages" } | subscribe | src/components/ChatList.jsx |
| realtime-subscription（動的） | { event: "UPDATE", schema: "public", table: "applications" } | subscribe | src/components/ChatList.jsx |
| realtime-subscription（動的） | { event: "INSERT", schema: "public", table: "messages", filter: "application_id=eq." + id } | subscribe | src/components/ChatView.jsx |
| rpc | admin_working_jobs |  | src/App.jsx |
| rpc | is_account_moderated |  | src/App.jsx |
| rpc | job_exists |  | src/App.jsx |
| rpc | my_nav_badges |  | src/App.jsx |
| rpc | my_unread_message_counts |  | src/App.jsx |
| rpc | employer_trust_info |  | src/app/preview/PreviewSheets.jsx |
| rpc | worker_profile_for_farmer |  | src/app/preview/PreviewSheets.jsx |
| rpc | worker_trust_info |  | src/app/preview/PreviewSheets.jsx |
| rpc | am_i_account_allowed |  | src/components/AccountHolderForm.jsx |
| rpc | admin_product_analytics |  | src/components/admin/AdminAnalyticsRoom.jsx |
| rpc | admin_worker_list |  | src/components/admin/AdminEvaluationRoom.jsx |
| rpc | admin_review_comments |  | src/components/admin/AdminReviewCommentsRoom.jsx |
| rpc | moderate_review_comment |  | src/components/admin/AdminReviewCommentsRoom.jsx |
| rpc | admin_account_jobs |  | src/components/admin/AdminTab.jsx |
| rpc | admin_hide_question |  | src/components/admin/AdminTab.jsx |
| rpc | admin_list_accounts |  | src/components/admin/AdminTab.jsx |
| rpc | admin_list_contracts |  | src/components/admin/AdminTab.jsx |
| rpc | admin_moderate_account |  | src/components/admin/AdminTab.jsx |
| rpc | request_job_revision |  | src/components/admin/AdminTab.jsx |
| rpc | admin_working_jobs |  | src/components/admin/AdminUpcomingRoom.jsx |
| rpc | admin_working_jobs |  | src/components/admin/AdminWorkingRoom.jsx |
| rpc | admin_work_reviews |  | src/components/admin/AdminWorkReviewsRoom.jsx |
| rpc | admin_preview_job |  | src/components/AdminJobPreview.jsx |
| rpc | my_chat_inbox_previews |  | src/components/ChatList.jsx |
| rpc | my_chat_partner_initials |  | src/components/ChatList.jsx |
| rpc | my_unread_message_counts |  | src/components/ChatList.jsx |
| rpc | worker_cards_for_farmer |  | src/components/ChatList.jsx |
| rpc | approve_application |  | src/components/ChatView.jsx |
| rpc | job_meeting_place |  | src/components/ChatView.jsx |
| rpc | my_chat_partner_initials |  | src/components/ChatView.jsx |
| rpc | report_chat_message |  | src/components/ChatView.jsx |
| rpc | set_my_available_dates |  | src/components/ChatView.jsx |
| rpc | contract_emergency_contact |  | src/components/ContractEmergencyContact.jsx |
| rpc | contract_party_name |  | src/components/ContractPartyName.jsx |
| rpc | employer_trust_info |  | src/components/EmployerProfileEdit.jsx |
| rpc | employer_public_jobs_by_farmer |  | src/components/FarmerRecord.jsx |
| rpc | confirm_terms |  | src/components/HireConfirm.jsx |
| rpc | worker_trust_info |  | src/components/HireConfirm.jsx |
| rpc | job_employer_profile |  | src/components/JobDetailBody.jsx |
| rpc | job_employer_trust_info |  | src/components/JobDetailBody.jsx |
| rpc | admin_hide_question |  | src/components/JobQuestions.jsx |
| rpc | answer_job_question |  | src/components/JobQuestions.jsx |
| rpc | ask_job_question |  | src/components/JobQuestions.jsx |
| rpc | contract_party_name |  | src/components/LaborConditionsNotice.jsx |
| rpc | my_job_actions |  | src/components/LikedJobs.jsx |
| rpc | signup_open |  | src/components/LoginScreen.jsx |
| rpc | get_my_calendar_jobs |  | src/components/MyCalendar.jsx |
| rpc | my_farm_applicants |  | src/components/NewApplicantsPage.jsx |
| rpc | my_farm_jobs |  | src/components/NewApplicantsPage.jsx |
| rpc | my_worker_trust_stats |  | src/components/ProfileHub.jsx |
| rpc | job_employer_reviews |  | src/components/ReceivedReviews.jsx |
| rpc | reviews_public_badges |  | src/components/ReceivedReviews.jsx |
| rpc | cancel_application |  | src/components/SavedJobsView.jsx |
| rpc | my_job_actions |  | src/components/SavedJobsView.jsx |
| rpc | cancel_application |  | src/components/WorkerApplications.jsx |
| rpc | employer_trust_info |  | src/components/WorkerApplications.jsx |
| rpc | my_job_actions |  | src/components/WorkerApplications.jsx |
| rpc | worker_want_again_count |  | src/components/WorkerProfileEdit.jsx |
| rpc | worker_work_record |  | src/components/WorkerWorkRecord.jsx |
| rpc | save_my_consignment_aux |  | src/features/consignment/consignmentAuxRecord.js |
| rpc | save_my_consignment_bundle |  | src/features/consignment/consignmentRecord.js |
| rpc | consignment_summary |  | src/features/consignment/ConsignmentRoom.jsx |
| rpc | save_my_consignor_consent |  | src/features/consignment/consignorRecord.js |
| rpc | save_my_consignor_profile |  | src/features/consignment/consignorRecord.js |
| rpc | update_account_holder_self |  | src/features/consignment/editor/ConsignorInfoEdit.jsx |
| rpc | approve_application |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | complete_work |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | employer_trust_info |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | my_farm_applicants |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | my_farm_jobs |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | set_agreed_dates |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | set_application_followup |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | submit_farmer_final_review |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | unpublish_job |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | worker_cards_for_farmer |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | worker_profile_for_farmer |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | worker_trust_info |  | src/features/farmer/dashboard/farmerDashboardApi.js |
| rpc | employer_trust_info |  | src/features/jobs/create/jobCreateApi.js |
| rpc | get_minimum_wage |  | src/features/jobs/create/jobCreateApi.js |
| rpc | publish_my_job_with_check |  | src/features/jobs/create/jobCreateApi.js |
| rpc | update_my_open_job |  | src/features/jobs/create/jobCreateApi.js |
| rpc | job_employer_reviews |  | src/features/jobs/search/components/JobDetailPanel.jsx |
| rpc | apply_to_job |  | src/features/jobs/search/jobSearchApi.js |
| rpc | cancel_application |  | src/features/jobs/search/jobSearchApi.js |
| rpc | create_pending_application |  | src/features/jobs/search/jobSearchApi.js |
| rpc | employer_public_job_counts |  | src/features/jobs/search/jobSearchApi.js |
| rpc | employer_public_jobs |  | src/features/jobs/search/jobSearchApi.js |
| rpc | job_employer_profile |  | src/features/jobs/search/jobSearchApi.js |
| rpc | job_employer_trust_info |  | src/features/jobs/search/jobSearchApi.js |
| rpc | pending_job_previews |  | src/features/jobs/search/jobSearchApi.js |
| rpc | signup_open |  | src/features/jobs/search/jobSearchApi.js |
| rpc | unpublish_job |  | src/features/jobs/search/jobSearchApi.js |
| rpc | confirm_insurance |  | src/features/today/todayApi.js |
| rpc | get_my_calendar_jobs |  | src/features/today/todayApi.js |
| rpc | my_farm_jobs |  | src/features/today/todayApi.js |
| rpc | my_todo_items |  | src/features/today/todayApi.js |
| rpc | review_window |  | src/hooks/useReviewWindow.js |
| rpc | record_my_attendance_once |  | src/lib/attendanceRecord.js |
| rpc | get_my_calendar_jobs |  | src/lib/calendarMove.js |
| rpc | move_job_dates |  | src/lib/calendarMove.js |
| rpc | copy_my_job_once |  | src/lib/copyJobRecord.js |
| rpc | save_help_image_reference |  | src/lib/helpImageRecord.js |
| rpc | job_details_for_party |  | src/lib/jobForMe.js |
| rpc（動的） | pending.open ? "sync_my_open_job" : "sync_my_job_draft" |  | src/lib/offlineSync.js |
| rpc | save_my_privacy_consent |  | src/lib/privacyConsent.js |
| rpc | save_my_profile_fields |  | src/lib/profileRecord.js |
| rpc | push_vapid_public |  | src/lib/push.js |
| rpc | save_push_subscription |  | src/lib/push.js |
| rpc | count_job_view |  | src/lib/searchJobs.js |
| rpc（動的） | name |  | src/lib/supportClient.js |
| rpc | is_worker_profile_ready |  | src/lib/workerReady.js |
| rpc | promote_my_pending_applications |  | src/lib/workerReady.js |
| rpc | confirm_my_worker_terms |  | src/lib/workerTermsRecord.js |
| rpc | push_payload |  | supabase/functions/send-push/index.ts |
| rpc | unread_count_for |  | supabase/functions/send-push/index.ts |
| storage | avatars | getPublicUrl | src/components/ProfileModal.jsx |
| storage | avatars | list | src/components/ProfileModal.jsx |
| storage | avatars | remove | src/components/ProfileModal.jsx |
| storage | avatars | upload | src/components/ProfileModal.jsx |
| storage | avatars |  | src/lib/avatarUpload.js |
| storage | help-images |  | src/lib/helpImageRecord.js |
| storage（動的） | bucket | download | src/lib/image.js |
| storage（動的） | bucket | list | src/lib/image.js |
| storage（動的） | bucket | upload | src/lib/image.js |
| storage（動的） | reference.bucket | download | src/lib/listingPhotoAccess.js |
| storage（動的） | bucket |  | src/lib/photoStorage.js |
| storage | avatars | getPublicUrl | src/lib/profileAvatar.js |
| storage | avatars | remove | src/lib/profileAvatar.js |
| table | farmers | select | api/health.js |
| table | account_holders | select | src/App.jsx |
| table | admin_notice_registry | select | src/App.jsx |
| table | applications | select | src/App.jsx |
| table | dests | delete | src/App.jsx |
| table | dests | select | src/App.jsx |
| table | dests | update | src/App.jsx |
| table | employer_profiles_public | select | src/App.jsx |
| table | employer_profiles | select | src/App.jsx |
| table | farmers | insert | src/App.jsx |
| table | farmers | select | src/App.jsx |
| table | jobs | select | src/App.jsx |
| table | notifications | select | src/App.jsx |
| table | notifications | update | src/App.jsx |
| table | page_events | insert | src/App.jsx |
| table | records | select | src/App.jsx |
| table | reviews | select | src/App.jsx |
| table | worker_profiles | select | src/App.jsx |
| table | app_errors | insert | src/app/diagnostics/errorLog.js |
| table | employer_profiles_public | select | src/app/preview/PreviewSheets.jsx |
| table | profile_reports | insert | src/app/preview/PreviewSheets.jsx |
| table | admin_box_registry | select | src/components/admin/AdminBoxRegistryPage.jsx |
| table | admin_notice_registry | select | src/components/admin/AdminBoxRegistryPage.jsx |
| table | pay_incidents | select | src/components/admin/AdminReportsRoom.jsx |
| table（動的） | REPORT_KINDS.find(source => source.key === row.kind).table | update, select | src/components/admin/AdminReportsRoom.jsx |
| table（動的） | source.table | select | src/components/admin/AdminReportsRoom.jsx |
| table | app_errors | select | src/components/admin/AdminSystemRoom.jsx |
| table | app_errors | update | src/components/admin/AdminSystemRoom.jsx |
| table | admin_messages | insert | src/components/admin/AdminTab.jsx |
| table | admin_messages | select | src/components/admin/AdminTab.jsx |
| table | attendance_events | select | src/components/admin/AdminTab.jsx |
| table | employer_profiles | select | src/components/admin/AdminTab.jsx |
| table | feedback | select | src/components/admin/AdminTab.jsx |
| table | job_questions | select | src/components/admin/AdminTab.jsx |
| table | job_reports | select | src/components/admin/AdminTab.jsx |
| table | jobs | update | src/components/admin/AdminTab.jsx |
| table | message_reports | select | src/components/admin/AdminTab.jsx |
| table | pay_incidents | select | src/components/admin/AdminTab.jsx |
| table | profile_reports | select | src/components/admin/AdminTab.jsx |
| table | user_onboarding_survey | select | src/components/admin/AdminTab.jsx |
| table | withdrawal_requests | select | src/components/admin/AdminTab.jsx |
| table | withdrawal_requests | update | src/components/admin/AdminTab.jsx |
| table | worker_profiles | select | src/components/admin/AdminTab.jsx |
| table | farm_timeless_posts | delete | src/components/admin/FarmTimelessRoom.jsx |
| table | farm_timeless_posts | insert, select | src/components/admin/FarmTimelessRoom.jsx |
| table | farm_timeless_posts | select | src/components/admin/FarmTimelessRoom.jsx |
| table | admin_messages | select | src/components/AdminChat.jsx |
| table | admin_messages | update | src/components/AdminChat.jsx |
| table | employer_profiles | select | src/components/AdminChat.jsx |
| table | worker_profiles | select | src/components/AdminChat.jsx |
| table | job_publish_checks | select | src/components/AdminJobPreview.jsx |
| table | jobs | select | src/components/AdminJobPreview.jsx |
| table | product_events | insert | src/components/AnalyticsPreferences.jsx |
| table | applications | select | src/components/ChatList.jsx |
| table | employer_profiles_public | select | src/components/ChatList.jsx |
| table | applications | select | src/components/ChatView.jsx |
| table | chat_reads | select | src/components/ChatView.jsx |
| table | chat_reads | upsert | src/components/ChatView.jsx |
| table | jobs | select | src/components/ChatView.jsx |
| table | messages | select | src/components/ChatView.jsx |
| table | messages | update | src/components/ChatView.jsx |
| table（動的） | table | select | src/components/ChatView.jsx |
| table | consignment_deals | select | src/components/ConsignmentSearchList.jsx |
| table | account_holders | select | src/components/EmergencyContactBox.jsx |
| table | account_holders | select | src/components/EmployerProfileEdit.jsx |
| table | app_errors | insert | src/components/EmployerProfileEdit.jsx |
| table | emergency_contacts | select | src/components/EmployerProfileEdit.jsx |
| table（動的） | table | select | src/components/EmployerProfileEdit.jsx |
| table | attendance_events | select | src/components/FinalReviewSheet.jsx |
| table | applications | select | src/components/HireConfirm.jsx |
| table | job_questions | select | src/components/JobQuestions.jsx |
| table | jobs | select | src/components/JobQuestions.jsx |
| table | account_holders | select | src/components/LaborConditionsNotice.jsx |
| table | applications | select | src/components/LaborConditionsNotice.jsx |
| table | account_holders | select | src/components/LoginScreen.jsx |
| table | app_errors | insert | src/components/LoginScreen.jsx |
| table | farmers | select | src/components/LoginScreen.jsx |
| table | saved_jobs | select | src/components/MyCalendar.jsx |
| table | reviews | select | src/components/MyReviewsOfWorker.jsx |
| table | farmers | select | src/components/OnboardingModal.jsx |
| table | farmers | upsert | src/components/OnboardingModal.jsx |
| table | market_stats | select | src/components/OnboardingModal.jsx |
| table | applications | select | src/components/ProfileHub.jsx |
| table | emergency_contacts | select | src/components/ProfileHub.jsx |
| table | reviews | select | src/components/ProfileHub.jsx |
| table | withdrawal_requests | insert | src/components/ProfileHub.jsx |
| table | worker_profiles | select | src/components/ProfileHub.jsx |
| table | farmers | update | src/components/ProfileModal.jsx |
| table | withdrawal_requests | insert | src/components/ProfileModal.jsx |
| table | applications | select | src/components/SavedJobsView.jsx |
| table | reviews | select | src/components/SavedJobsView.jsx |
| table | worker_profiles | select | src/components/SavedJobsView.jsx |
| table | applications | select | src/components/WorkerApplications.jsx |
| table | pending_applications | delete | src/components/WorkerApplications.jsx |
| table | pending_applications | select | src/components/WorkerApplications.jsx |
| table | reviews | select | src/components/WorkerApplications.jsx |
| table | account_holders | select | src/components/WorkerProfileEdit.jsx |
| table | app_errors | insert | src/components/WorkerProfileEdit.jsx |
| table | emergency_contacts | select | src/components/WorkerProfileEdit.jsx |
| table | worker_profiles | select | src/components/WorkerProfileEdit.jsx |
| table | reviews | insert | src/components/WorkerReviewSheet.jsx |
| table | account_holders | select | src/features/consignment/ConsignmentRoom.jsx |
| table | consignment_deals | select | src/features/consignment/ConsignmentRoom.jsx |
| table | consignment_fields | select | src/features/consignment/ConsignmentRoom.jsx |
| table | consignment_profiles | select | src/features/consignment/ConsignmentRoom.jsx |
| table | consignment_progress | select | src/features/consignment/ConsignmentRoom.jsx |
| table | employer_profiles | select | src/features/consignment/ConsignmentRoom.jsx |
| table | account_holders | select | src/features/consignment/consignorRecord.js |
| table | consignment_profiles | select | src/features/consignment/consignorRecord.js |
| table | emergency_contacts | select | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | employer_profiles | select | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | employer_profiles | upsert | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | jobs | delete | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | jobs | select | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | repeat_roster | delete | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | repeat_roster | select | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | repeat_roster | upsert | src/features/farmer/dashboard/farmerDashboardApi.js |
| table | account_holders | select | src/features/jobs/create/jobCreateApi.js |
| table | applications | select | src/features/jobs/create/jobCreateApi.js |
| table | employer_profiles | select | src/features/jobs/create/jobCreateApi.js |
| table | employer_profiles | upsert | src/features/jobs/create/jobCreateApi.js |
| table | jobs | insert, select | src/features/jobs/create/jobCreateApi.js |
| table | jobs | select | src/features/jobs/create/jobCreateApi.js |
| table | jobs | update | src/features/jobs/create/jobCreateApi.js |
| table | account_holders | select | src/features/jobs/search/jobSearchApi.js |
| table | applications | select | src/features/jobs/search/jobSearchApi.js |
| table | consignment_profiles | select | src/features/jobs/search/jobSearchApi.js |
| table | job_reports | insert | src/features/jobs/search/jobSearchApi.js |
| table | jobs | select | src/features/jobs/search/jobSearchApi.js |
| table | pending_applications | select | src/features/jobs/search/jobSearchApi.js |
| table | saved_jobs | select | src/features/jobs/search/jobSearchApi.js |
| table | user_onboarding_survey | insert | src/features/jobs/search/jobSearchApi.js |
| table | user_onboarding_survey | select | src/features/jobs/search/jobSearchApi.js |
| table | worker_profiles | select | src/features/jobs/search/jobSearchApi.js |
| table | applications | select | src/features/today/todayApi.js |
| table | emergency_contacts | select | src/features/today/todayApi.js |
| table | employer_profiles | select | src/features/today/todayApi.js |
| table | jobs | select | src/features/today/todayApi.js |
| table | worker_profiles | select | src/features/today/todayApi.js |
| table | account_holders | insert, select | src/lib/accountHolderRecord.js |
| table | account_holders | select | src/lib/accountHolderRecord.js |
| table | app_admins | select | src/lib/authorization.js |
| table（動的） | table | insert, select | src/lib/chatMessaging.js |
| table（動的） | table | select | src/lib/chatMessaging.js |
| table | help_images | select | src/lib/helpImageRecord.js |
| table | applications | select | src/lib/hire.js |
| table | jobs | select | src/lib/hire.js |
| table | jobs | select | src/lib/image.js |
| table | jobs_public | select | src/lib/jobForMe.js |
| table | account_holders | select | src/lib/offlineSync.js |
| table | jobs | select | src/lib/photoStorage.js |
| table | jobs | update | src/lib/photoStorage.js |
| table | account_holders | select | src/lib/privacyConsent.js |
| table（動的） | table | insert | src/lib/profileAvatar.js |
| table（動的） | table | select | src/lib/profileAvatar.js |
| table（動的） | table | update | src/lib/profileAvatar.js |
| table（動的） | table | select | src/lib/profileRecord.js |
| table | app_errors | insert | src/lib/push.js |
| table | saved_jobs | delete | src/lib/savedJobRecord.js |
| table | saved_jobs | insert | src/lib/savedJobRecord.js |
| table | saved_jobs | select | src/lib/savedJobRecord.js |
| table | job_view_counts | select | src/lib/searchJobs.js |
| table | jobs_public | select | src/lib/searchJobs.js |
| table | worker_profiles | select | src/lib/workerReady.js |
| table | push_config | select | supabase/functions/send-push/index.ts |
| table | push_subscriptions | delete | supabase/functions/send-push/index.ts |
| table | push_subscriptions | select | supabase/functions/send-push/index.ts |

## HTTP / Edge エントリポイント

| ファイル | 判定 |
|---|---|
| api/auth/verify-otp.js | 廃止済み（410）。 |
| api/health.js | GET/HEADのみ。サービス権限は疎通・件数確認。個別データを返さない。 |
| api/j/[num].js | 公開求人の共有用メタ情報。匿名権限で取得。 |
| api/sync-farmer.js | 廃止済み（410）。 |
| supabase/functions/send-push/index.ts | DBに保存したトリガー秘密値とヘッダーを照合してからサービス権限を使用。 |

## Storage バケット

| バケット | 匿名のURL公開 |
|---|---|
| avatars | 公開（オブジェクトSELECTのRLSとは別） |
| assets | 公開（オブジェクトSELECTのRLSとは別） |
| help-images | 公開（オブジェクトSELECTのRLSとは別） |
| farm-timeless | 公開（オブジェクトSELECTのRLSとは別） |
| job-photos | 非公開（署名URL・RLS等で許可） |
| consignment-photos | 非公開（署名URL・RLS等で許可） |
