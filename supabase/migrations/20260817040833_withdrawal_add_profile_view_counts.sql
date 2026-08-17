-- 退会処理の取りこぼし修理（2026-08-17）：worker_profile_view_counts（プロフィールが閲覧された回数）が
-- process_withdrawal の削除対象に入っていなかった。プロフィール本体は退会で消えるのに、そこから
-- 導出された回数だけが本人のuuidを鍵として残り続ける状態だった。
-- 保存・削除の設計台帳v1(a)「行ごと削除＝本人の届出情報・行動の記録（証跡ではないもの）」に該当。
-- プラポリ第3条データ台帳へ「プロフィールが閲覧された回数＝退会の申し出から30日以内に削除」の行を
-- 追記したことに対応する（台帳の約束と機構を必ず一致させる・原則1）。
--
-- ★関数本体は書き写さず、現物の定義に1行を差し込んで作り直す（写経ミスを構造的に起こさない）
do $$
declare def text; hit int;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'process_withdrawal';
  if def is null then raise exception 'process_withdrawal が見つかりません'; end if;

  if def like '%worker_profile_view_counts%' then
    raise notice 'already covered';
    return;
  end if;

  select count(*) into hit from regexp_matches(def, 'delete from public\.saved_jobs', 'g');
  if hit <> 1 then raise exception 'saved_jobs の削除行が一意に見つかりません（hit=%）', hit; end if;

  def := replace(
    def,
    'delete from public.saved_jobs           where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object(''saved_jobs'', n);',
    'delete from public.saved_jobs           where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object(''saved_jobs'', n);'
    || E'\n  delete from public.worker_profile_view_counts where worker_id = p_auth_id; get diagnostics n = row_count; d := d || jsonb_build_object(''worker_profile_view_counts'', n);'
  );
  execute def;
end $$;
