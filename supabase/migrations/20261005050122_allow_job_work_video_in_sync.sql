-- 作業動画を既存の端末下書き同期経路へ通す。
-- URLがある場合は、求人内掲載への同意・同意日時・同意文面版をDBでも必須にする。
alter table public.jobs drop constraint if exists jobs_work_video_consent_check;
alter table public.jobs add constraint jobs_work_video_consent_check check (
  work_video_url is null or (
    work_video_job_consent is true and work_video_consent_at is not null
    and nullif(btrim(work_video_consent_version), '') is not null
  )
);

do $$
declare fn regprocedure; src text;
old_allowed text := '''photos'',''draft_step''';
new_allowed text := '''photos'',''work_video_url'',''work_video_job_consent'',''work_video_related_consent'',''work_video_consent_at'',''work_video_consent_version'',''draft_step''';
begin
 foreach fn in array array['public.sync_my_job_draft(uuid,uuid,jsonb,jsonb)'::regprocedure,'public.sync_my_open_job(uuid,uuid,jsonb,jsonb)'::regprocedure] loop
  src:=pg_get_functiondef(fn);
  if position(new_allowed in src)=0 then
   if position(old_allowed in src)=0 then raise exception '% anchor missing',fn; end if;
   execute replace(src,old_allowed,new_allowed);
  end if;
 end loop;
end $$;

do $$
declare src text := pg_get_functiondef('public.update_my_open_job(integer,jsonb)'::regprocedure);
old_allowed text := '''danger_places'',''danger_tasks'',''photos'',';
new_allowed text := '''danger_places'',''danger_tasks'',''photos'',
    ''work_video_url'',''work_video_job_consent'',''work_video_related_consent'',''work_video_consent_at'',''work_video_consent_version'',';
old_assign text := 'photos          = case when p_patch ? ''photos'' then coalesce(nullif(p_patch->''photos'',''null''::jsonb), ''[]''::jsonb) else photos end,';
new_assign text := 'photos          = case when p_patch ? ''photos'' then coalesce(nullif(p_patch->''photos'',''null''::jsonb), ''[]''::jsonb) else photos end,
    work_video_url = case when p_patch ? ''work_video_url'' then nullif(btrim(p_patch->>''work_video_url''),'''') else work_video_url end,
    work_video_job_consent = case when p_patch ? ''work_video_job_consent'' then nullif(p_patch->>''work_video_job_consent'','''')::boolean else work_video_job_consent end,
    work_video_related_consent = case when p_patch ? ''work_video_related_consent'' then nullif(p_patch->>''work_video_related_consent'','''')::boolean else work_video_related_consent end,
    work_video_consent_at = case when p_patch ? ''work_video_consent_at'' then nullif(p_patch->>''work_video_consent_at'','''')::timestamptz else work_video_consent_at end,
    work_video_consent_version = case when p_patch ? ''work_video_consent_version'' then nullif(btrim(p_patch->>''work_video_consent_version''),'''') else work_video_consent_version end,';
begin
 if position('''work_video_url''' in src)=0 then
  if position(old_allowed in src)=0 or position(old_assign in src)=0 then raise exception 'update anchor missing'; end if;
  src:=replace(src,old_allowed,new_allowed); src:=replace(src,old_assign,new_assign); execute src;
 end if;
end $$;

revoke all on function public.sync_my_job_draft(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.sync_my_job_draft(uuid,uuid,jsonb,jsonb) to authenticated;
revoke all on function public.sync_my_open_job(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.sync_my_open_job(uuid,uuid,jsonb,jsonb) to authenticated;
revoke all on function public.update_my_open_job(integer,jsonb) from public,anon;
grant execute on function public.update_my_open_job(integer,jsonb) to authenticated;
