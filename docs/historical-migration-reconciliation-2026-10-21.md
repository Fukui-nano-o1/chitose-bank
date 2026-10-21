# 過去のDB移行識別子の照合（2026-10-21）

## 今回確定した修正

本番 `aegwepgtmwcnwzybpgsh` の `supabase_migrations.schema_migrations` 499件と、GitHubのSQLファイル470件を照合した。履歴のversion/name/本文ハッシュを読み、対象110件のみ記録済みSQLを比較した。利用者テーブルのデータは取得していない。

59ファイルの実行SQLが本番適用履歴と一致することを確認し、番号を実際のversionへ変更した。SQLファイル本文は59件すべてバイト単位で変更していない。DBのDDL/DML再実行、履歴テーブルの修正、migration repair は行っていない。

- 58件：先頭の連続した `--` コメント/空行と外側の空白を除いた本文が完全一致。
- 1件 `close_others_when_filled`：差分を確認し、内部を含む説明コメントだけの違い。関数・条件・通知本文・実行順序は同じ。
- 本番のnameに旧timestampが含まれる場合、ファイル名は実version＋従来の説明名を使用。本番nameそのものはfixtureに保存。
- 既存の番号重複6組を解消。470ファイルのversionはすべて一意になった。
- 実行時に参照する3試験のSQLパスを変更。全ファイルの番号重複、変更対象59件の本文ハッシュ、旧番号の再混入をCIで検査。

照合証跡は `scripts/fixtures/historical-applied-migrations.json`。`localSha256` は保持したファイル本文、`appliedSqlMd5` は本番履歴の `array_to_string(statements,E'\n')` のMD5。コメントが異なるため、この2種類のハッシュを同一値とは扱わない。CIは保存した照合結果とファイル不変性を検査し、本番DBへ接続しない。

## まだ一括適用できない理由

変更後も、本番にのみ存在するversionは84件、ローカルにのみ存在するversionは55件。415件は番号が共通だが、全件のSQL意味一致を証明した数ではない。全499件のSQL本文照合、全履歴からの空DB再構築は未完了。**この状態で `supabase db push --include-all` や全件再適用を行わない。**

名前のtimestamp接頭辞を除いて対応付けると、未確定の本番履歴は次の86件（時刻違い51・対応ファイル未確定33・同名曖昧2）。「対応未確定」はSQLが存在しない証明ではなく、別ファイルへの合成・改名も調べる必要がある。

実際に `application_available_dates` と `agreed_dates` は、後続の別履歴で適用した関数が同じローカルファイルに合成されている。`page_events_self_only` も本番とローカルで含む処理が違う。このため名前だけを合わせたり、未適用と見なして再実行したりしない。適用履歴ごとの処理分解・依存順・一度限りのデータ変更を確認する。

### 未確定の対応

| 本番version | 本番name | ローカル候補 | 状態 |
|---|---|---|---|
| `20260715073257` | `admin_list_contracts` | `20260720174613_admin_list_contracts.sql` / `20260715073257_admin_list_contracts.sql` | 同名が複数 |
| `20260720174613` | `admin_list_contracts` | `20260720174613_admin_list_contracts.sql` / `20260715073257_admin_list_contracts.sql` | 同名が複数 |
| `20260721021358` | `start_reminder_contracted_only` | — | 対応未確定 |
| `20260721021526` | `farmer_no_show_report` | — | 対応未確定 |
| `20260721023129` | `moderation_notice_with_appeal` | — | 対応未確定 |
| `20260721032133` | `auto_close_finished_jobs` | — | 対応未確定 |
| `20260722131031` | `chat_reads` | — | 対応未確定 |
| `20260722150418` | `expire_by_start_time` | — | 対応未確定 |
| `20260722150452` | `fix_status_check_expired` | — | 対応未確定 |
| `20260723141626` | `worker_experience_entries` | — | 対応未確定 |
| `20260723142051` | `visitor_anon_jobs` | — | 対応未確定 |
| `20260723160544` | `calendar_notes` | — | 対応未確定 |
| `20260723161411` | `application_available_dates` | `20260724090000_application_available_dates.sql` | 時刻・内容を要照合 |
| `20260723162044` | `agreed_dates` | `20260724100000_agreed_dates.sql` | 時刻・内容を要照合 |
| `20260723162940` | `apply_to_job_available_dates` | — | 対応未確定 |
| `20260723164429` | `agreed_dates_calendar_and_badge` | — | 対応未確定 |
| `20260723175602` | `approve_copies_available_dates` | — | 対応未確定 |
| `20260723181545` | `my_todo_items_feed` | — | 対応未確定 |
| `20260724034448` | `copy_job` | `20260724120000_copy_job.sql` | 時刻・内容を要照合 |
| `20260724034959` | `copy_job_edit_from_start` | — | 対応未確定 |
| `20260724035832` | `copy_job_open_confirm` | — | 対応未確定 |
| `20260724124814` | `cron_watchdog` | — | 対応未確定 |
| `20260725030225` | `todo_items_interview_hire` | `20260725110000_todo_items_interview_hire.sql` | 時刻・内容を要照合 |
| `20260725032054` | `insurance_todo_only_unset` | `20260725113000_insurance_todo_only_unset.sql` | 時刻・内容を要照合 |
| `20260725032755` | `insurance_considering_not_prepared` | `20260725114500_insurance_considering_not_prepared.sql` | 時刻・内容を要照合 |
| `20260725033419` | `todo_worker_interview_reply` | `20260725120000_todo_worker_interview_reply.sql` | 時刻・内容を要照合 |
| `20260725062057` | `interview_question_send_history` | `20260725140000_interview_question_send_history.sql` | 時刻・内容を要照合 |
| `20260725062124` | `interview_sends_tighten_grants` | — | 対応未確定 |
| `20260725063115` | `apply_is_consent_drop_wconfirm` | `20260725130000_apply_is_consent_drop_wconfirm.sql` | 時刻・内容を要照合 |
| `20260725124420` | `dead_jobs_dont_count` | `20260725170000_dead_jobs_dont_count.sql` | 時刻・内容を要照合 |
| `20260726085217` | `nav_badge_applicants_pending` | `20260726120000_nav_badge_applicants_pending.sql` | 時刻・内容を要照合 |
| `20260727123331` | `session_summary_awareness` | — | 対応未確定 |
| `20260727130042` | `todo_job_questions` | `20260727150000_todo_job_questions.sql` | 時刻・内容を要照合 |
| `20260727131634` | `admin_dedupe_and_test_accounts` | — | 対応未確定 |
| `20260727132852` | `session_summary_split_mails` | `20260727160000_session_summary_split_mails.sql` | 時刻・内容を要照合 |
| `20260727133449` | `page_events_self_only` | `20260727170000_page_events_self_only.sql` | 時刻・内容を要照合 |
| `20260727135516` | `status_change_as_unread` | `20260727180000_status_change_as_unread.sql` | 時刻・内容を要照合 |
| `20260729032012` | `auto_start_work` | `20260727190000_auto_start_work.sql` | 時刻・内容を要照合 |
| `20260729035711` | `expire_full_job_is_rejected` | `20260727200000_expire_full_job_is_rejected.sql` | 時刻・内容を要照合 |
| `20260729054814` | `require_recruiter_info_also_on_insert` | — | 対応未確定 |
| `20260729054902` | `fix_require_recruiter_info_message` | `20260727250000_fix_require_recruiter_info_message.sql` | 時刻・内容を要照合 |
| `20260730054534` | `nav_badge_time_corrections` | — | 対応未確定 |
| `20260730072811` | `jobs_recruiter_columns_and_view` | — | 対応未確定 |
| `20260730073528` | `worksite_address_public` | — | 対応未確定 |
| `20260730080419` | `jobs_public_visitor_masking` | — | 対応未確定 |
| `20260730103520` | `declared_punch_transparency_v2` | — | 対応未確定 |
| `20260730111129` | `hired_worker_identity` | — | 対応未確定 |
| `20260730113030` | `pending_applications` | — | 対応未確定 |
| `20260805091518` | `20260805091432_admin_evaluation_records` | `20260805091432_admin_evaluation_records.sql` | 時刻・内容を要照合 |
| `20260805093255` | `20260805093104_admin_worker_dashboard` | `20260805093104_admin_worker_dashboard.sql` | 時刻・内容を要照合 |
| `20260805101611` | `20260805101446_worker_work_record_open_to_farmers` | `20260805101446_worker_work_record_open_to_farmers.sql` | 時刻・内容を要照合 |
| `20260806012115` | `20260806012028_backrecord_kirito_1054_1056` | `20260806012028_backrecord_kirito_1054_1056.sql` | 時刻・内容を要照合 |
| `20260806012554` | `20260806012511_restore_deleted_jobs_and_block_delete` | `20260806012511_restore_deleted_jobs_and_block_delete.sql` | 時刻・内容を要照合 |
| `20260806014049` | `20260806013953_jobs_public_include_closed` | `20260806013953_jobs_public_include_closed.sql` | 時刻・内容を要照合 |
| `20260806014721` | `20260806014605_work_record_survives_missing_job` | `20260806014605_work_record_survives_missing_job.sql` | 時刻・内容を要照合 |
| `20260806031215` | `admin_attention` | `20260806120000_admin_attention.sql` | 時刻・内容を要照合 |
| `20260806165333` | `20260806175000_expire_stale_hire_miss_alert` | `20260806175000_expire_stale_hire_miss_alert.sql` | 時刻・内容を要照合 |
| `20260806173837` | `20260806181500_job_photos_owner_scoped_write` | `20260806181500_job_photos_owner_scoped_write.sql` | 時刻・内容を要照合 |
| `20260807150636` | `withdrawal_close_open_jobs` | `20260807150430_withdrawal_close_open_jobs.sql` | 時刻・内容を要照合 |
| `20260814082942` | `20260814082846_message_mail_sender_title_full_body` | `20260814082846_message_mail_sender_title_full_body.sql` | 時刻・内容を要照合 |
| `20260814084250` | `20260814084154_message_mail_fold_over_100` | `20260814084154_message_mail_fold_over_100.sql` | 時刻・内容を要照合 |
| `20260815060513` | `20260808151500_unpublish_withdrawal_reason_and_mails` | `20260808151500_unpublish_withdrawal_reason_and_mails.sql` | 時刻・内容を要照合 |
| `20260816034510` | `20260816040500_cancel_application_keeps_record` | `20260816040500_cancel_application_keeps_record.sql` | 時刻・内容を要照合 |
| `20260816035216` | `20260809031500_job_published_mail_details` | `20260809031500_job_published_mail_details.sql` | 時刻・内容を要照合 |
| `20260816040016` | `20260816051500_apply_cancel_worker_confirm_mails` | `20260816051500_apply_cancel_worker_confirm_mails.sql` | 時刻・内容を要照合 |
| `20260816082026` | `20260816090000_job_time_notices` | `20260816090000_job_time_notices.sql` | 時刻・内容を要照合 |
| `20260816140254` | `20260816141000_application_followup_notices` | `20260816141000_application_followup_notices.sql` | 時刻・内容を要照合 |
| `20260816140424` | `20260816142000_application_mail_self_judgement_note` | `20260816142000_application_mail_self_judgement_note.sql` | 時刻・内容を要照合 |
| `20260817033335` | `20260816150000_job_time_notices_v2` | `20260816150000_job_time_notices_v2.sql` | 時刻・内容を要照合 |
| `20260817033937` | `20260817000000_send_user_email_returns_request_id` | `20260817000000_send_user_email_returns_request_id.sql` | 時刻・内容を要照合 |
| `20260817034108` | `20260817001000_job_time_notices_final` | `20260817001000_job_time_notices_final.sql` | 時刻・内容を要照合 |
| `20260817034909` | `20260817002000_job_time_notices_per_work_day` | `20260817002000_job_time_notices_per_work_day.sql` | 時刻・内容を要照合 |
| `20260817050643` | `20260817010000_firehose_no_chat_mail` | `20260817010000_firehose_no_chat_mail.sql` | 時刻・内容を要照合 |
| `20260817100859` | `20260817020000_policy_update_notice` | `20260817020000_policy_update_notice.sql` | 時刻・内容を要照合 |
| `20260817101852` | `20260817030000_policy_mail_important_kaitei` | `20260817030000_policy_mail_important_kaitei.sql` | 時刻・内容を要照合 |
| `20260818124417` | `20260818090000_retract_chat_message_mail` | `20260818090000_retract_chat_message_mail.sql` | 時刻・内容を要照合 |
| `20260819102353` | `io_index_cleanup` | — | 対応未確定 |
| `20260819102439` | `revert_premature_completion_1232` | `20260819110000_revert_premature_completion_1232.sql` | 時刻・内容を要照合 |
| `20260819112852` | `io_index_cleanup_drop_dup_email_constraint` | — | 対応未確定 |
| `20260821062823` | `authenticator_work_mem_16mb` | — | 対応未確定 |
| `20260823035541` | `20260821090000_labor_conditions_missing_items` | `20260821090000_labor_conditions_missing_items.sql` | 時刻・内容を要照合 |
| `20260824020059` | `20260824020500_job_details_for_party` | `20260824020500_job_details_for_party.sql` | 時刻・内容を要照合 |
| `20260911100505` | `20260911010000_update_my_open_job` | `20260911010000_update_my_open_job.sql` | 時刻・内容を要照合 |
| `20261005120636` | `expose_consented_work_video_in_jobs_public` | `20261005121000_expose_consented_work_video_in_jobs_public.sql` | 時刻・内容を要照合 |
| `20261009123325` | `guard_job_wages_by_work_dates_20261009` | — | 対応未確定 |
| `20261009124614` | `create_industry_minimum_wages_registry_20261009` | — | 対応未確定 |

### ローカルからの対応が一意でないファイル

- `20260715073257_admin_list_contracts.sql`
- `20260720174613_admin_list_contracts.sql`
- `20260724110000_my_todo_items.sql`
- `20260727170500_summarize_sessions_self_only.sql`
- `20260727260000_backfill_recruiter_info.sql`
- `20260730080000_backfill_job_recruiter_info.sql`

上記6ファイルのうち2件は同名 `admin_list_contracts` の候補。残る4件は対応先を一意に特定できていない。後埋め・データ補修を含むため、SQLを推測して本番へ再適用しない。

## 修正した59件

| 旧ファイル | 本番version |
|---|---|
| `20260722141500_chat_partner_initials.sql` | `20260722141020` |
| `20260722160000_calendar_my_role.sql` | `20260722153240` |
| `20260722170000_notify_message_no_throttle.sql` | `20260723083154` |
| `20260724130000_any_dates_no_decide.sql` | `20260724040753` |
| `20260724140000_no_decide_dates_stage.sql` | `20260724041414` |
| `20260724150000_signup_open_general_release.sql` | `20260724041827` |
| `20260724150000_employer_trust_split_open_vs_track_record.sql` | `20260724120520` |
| `20260724160000_copy_job_clear_past_dates.sql` | `20260724120652` |
| `20260724153000_employer_trust_active_counts.sql` | `20260724121021` |
| `20260724160000_employer_public_job_counts.sql` | `20260724122103` |
| `20260725100000_todo_items_partner_avatar.sql` | `20260725011136` |
| `20260725120000_add_insurance_notes.sql` | `20260725032918` |
| `20260725150000_reapply_interview_history_todo.sql` | `20260725121430` |
| `20260725160000_drop_w_waiting.sql` | `20260725123747` |
| `20260725170000_apply_gate_one_qa_and_on.sql` | `20260725135049` |
| `20260725180000_drop_chat_todo.sql` | `20260725233831` |
| `20260725190000_merge_complete_review_todo.sql` | `20260725234634` |
| `20260726100000_expire_approved_unhired.sql` | `20260726021840` |
| `20260727170000_close_others_when_filled.sql` | `20260727132805` |
| `20260727180000_my_job_actions.sql` | `20260727141156` |
| `20260727210000_block_apply_when_filled.sql` | `20260729040145` |
| `20260727220000_employer_recruiter_info.sql` | `20260729043036` |
| `20260727230000_job_employer_profile_recruiter_info.sql` | `20260729045906` |
| `20260727240000_require_recruiter_info_to_open.sql` | `20260729050159` |
| `20260727270000_require_recruiter_info_on_pending.sql` | `20260729061751` |
| `20260729130000_saved_jobs_not_own.sql` | `20260730053943` |
| `20260730120000_employer_trust_avg_approval_hours.sql` | `20260730073410` |
| `20260803154500_emergency_contacts.sql` | `20260803152227` |
| `20260806174500_consignment_photos_authenticated_read.sql` | `20260806165301` |
| `20260807000034_purge_page_events_30d.sql` | `20260806235921` |
| `20260807021723_revoke_app_work_dates_from_public.sql` | `20260807021610` |
| `20260807133000_withdrawal_add_consignment_profiles.sql` | `20260807133347` |
| `20260808004900_unpublish_job_rejects_applicants.sql` | `20260808004820` |
| `20260816050512_message_mail_layout_v3.sql` | `20260816050601` |
| `20260816070000_emergency_contact_reminder.sql` | `20260816051921` |
| `20260816073000_emergency_contact_reminder_mail_only.sql` | `20260816052828` |
| `20260816140000_application_followup_state.sql` | `20260816140013` |
| `20260816143000_followup_backfill_existing.sql` | `20260816140605` |
| `20260817040444_pending_apply_hard_gates.sql` | `20260817040519` |
| `20260817100444_worker_ready_minimal_four.sql` | `20260817100516` |
| `20260817100956_apply_gate_single_condition.sql` | `20260817101027` |
| `20260817040000_policy_mail_article_numbers.sql` | `20260817102437` |
| `20260816170000_my_farm_applicants_profiles_via_window.sql` | `20260818124905` |
| `20260819044500_perks_add_raise_and_severance_pay.sql` | `20260819043838` |
| `20260819043759_remove_interview_question_sets.sql` | `20260819043922` |
| `20260819045000_consignment_profiles_perks_parity.sql` | `20260819044045` |
| `20260819060000_perks_detail_texts_and_consultation_contact.sql` | `20260819052827` |
| `20260824030000_contract_party_name_hired_without_snapshot.sql` | `20260824021554` |
| `20260824050000_emergency_contact_self_from_account.sql` | `20260824033718` |
| `20260825010000_calendar_keep_ended_jobs.sql` | `20260825031019` |
| `20260828010000_calendar_include_applied.sql` | `20260828031155` |
| `20260831140533_account_reported_count_open_only.sql` | `20260831140545` |
| `20260924144809_support_feedback_flow.sql` | `20260924145301` |
| `20260924151645_chat_inbox_previews.sql` | `20260924152147` |
| `20260928095100_app_errors_rate_limit.sql` | `20260928095153` |
| `20261002153118_distinguish_googlebot_error_reports.sql` | `20261002153325` |
| `20261005054800_shift_existing_job_drafts_for_video_step.sql` | `20261005054633` |
| `20261005060000_add_stable_job_draft_step_id.sql` | `20261005054958` |
| `20261005061500_allow_stable_draft_step_id_in_sync.sql` | `20261005055405` |

## 検証

ローカルの自動試験661件成功（失敗/skip/TODO 0）、lint 0エラー・既存19警告、Vite/PWAビルド成功。マージ前CIの最終結果はPRに記録する。アプリ実行コード、API、公開アセット、依存関係は変更していない。本作業は本番DBを変更するものではない。
