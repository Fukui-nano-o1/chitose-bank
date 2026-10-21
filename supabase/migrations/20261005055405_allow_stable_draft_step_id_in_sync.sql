-- stable draft_step_idを端末同期RPCの許可列へ追加。
do $$
declare fn regprocedure; src text;
old_allowed text := '''work_video_consent_version'',''draft_step''';
new_allowed text := '''work_video_consent_version'',''draft_step'',''draft_step_id''';
begin
 foreach fn in array array['public.sync_my_job_draft(uuid,uuid,jsonb,jsonb)'::regprocedure,'public.sync_my_open_job(uuid,uuid,jsonb,jsonb)'::regprocedure] loop
  src:=pg_get_functiondef(fn);
  if position(new_allowed in src)=0 then
   if position(old_allowed in src)=0 then raise exception '% anchor missing',fn; end if;
   execute replace(src,old_allowed,new_allowed);
  end if;
 end loop;
end $$;
