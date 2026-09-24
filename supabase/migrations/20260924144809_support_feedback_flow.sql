-- Reporting is a support conversation, including before authentication.
-- Guest secrets never enter public tables, returned JSON, email, or logs.
alter table public.feedback alter column reporter_id drop not null;
alter table public.feedback add column if not exists topic text not null default 'other';
alter table public.feedback add column if not exists impact text not null default 'difficult';
alter table public.feedback add column if not exists expected_result text;
alter table public.feedback add column if not exists diagnostics jsonb not null default '{}'::jsonb;
alter table public.feedback add column if not exists updated_at timestamptz;
update public.feedback set updated_at = created_at where updated_at is null;
alter table public.feedback alter column updated_at set default now();
alter table public.feedback alter column updated_at set not null;
alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback add constraint feedback_status_check check (status in ('open','checking','answered','resolved'));
alter table public.feedback add constraint feedback_support_topic_check check (topic in ('login','signup','apply','post','pdf','chat','other'));
alter table public.feedback add constraint feedback_support_impact_check check (impact in ('blocked','difficult','suggestion'));
create index if not exists feedback_reporter_created_idx on public.feedback(reporter_id,created_at desc);
create index if not exists feedback_guest_activity_idx on public.feedback(updated_at) where reporter_id is null;
create index if not exists feedback_created_idx on public.feedback(created_at);

create schema if not exists private;
create table private.feedback_guest_access (
  feedback_id uuid primary key references public.feedback(id) on delete cascade,
  token_hash bytea not null
);
create index feedback_guest_token_idx on private.feedback_guest_access(token_hash);
create table private.feedback_support_actions (
  id uuid primary key,
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  author_role text not null check (author_role in ('admin','user')),
  actor_id uuid,
  body text check (length(body) <= 3000),
  status text not null check (status in ('open','checking','answered','resolved')),
  created_at timestamptz not null default now()
);
create index feedback_support_actions_thread_idx on private.feedback_support_actions(feedback_id,created_at);
alter table private.feedback_guest_access enable row level security;
alter table private.feedback_support_actions enable row level security;
revoke all on private.feedback_guest_access, private.feedback_support_actions from public,anon,authenticated;
-- Preserve the previous signed-in mail path; anonymous reports cannot spend SMTP quota.
drop trigger if exists notify_feedback on public.feedback;
create trigger notify_feedback after insert on public.feedback for each row
  when (new.reporter_id is not null) execute function public.trg_notify_feedback();

create function private.support_touch() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
create trigger feedback_support_touch before update on public.feedback for each row execute function private.support_touch();

create function private.support_token(p_token text) returns bytea language sql immutable set search_path='' as $$
 select case when p_token ~ '^[a-f0-9]{64}$' then pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')) else null end
$$;
create function private.support_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.app_admins where auth_id=auth.uid())
$$;
create function private.support_can_access(p_id uuid,p_guest_token text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.feedback f where f.id=p_id and (
   (auth.uid() is not null and f.reporter_id=auth.uid()) or private.support_is_admin() or
   (f.reporter_id is null and exists(select 1 from private.feedback_guest_access g where g.feedback_id=f.id and g.token_hash=private.support_token(p_guest_token)))
 ))
$$;
create function private.support_path(p_path text) returns text language plpgsql immutable set search_path='' as $$
declare v_path text := regexp_replace(split_part(split_part(split_part(coalesce(p_path,''),'?',1),'&',1),'#',2),'^/?',''); v_root text;
begin
 if left(coalesce(p_path,''),1) <> '#' then v_path:=regexp_replace(split_part(split_part(coalesce(p_path,''),'?',1),'&',1),'^/?',''); end if;
 if v_path='' then return '#/search'; end if;
 if v_path=any(array['work/new','work/job','work/edit','work/drafts','apply/done','profile/worker','profile/employer','profile/worker/schedule','profile/employer/schedule','help/about','help/farmer','help/worker','help/mails','help/info','help/faq','admin/review','admin/consignment','admin/working','admin/upcoming','admin/evaluation','admin/system','admin/review-comments','admin/analytics','admin/reports','admin/farmer-pages','admin/animations','admin/timeless']) then return '#/'||v_path; end if;
 v_root:=split_part(v_path,'/',1);
 if v_root=any(array['search','saved','login','help','install','insurance','experience','new-applicants','profile','calendar','work','chat','chats','apply','admin','boxes','privacy','terms','charter','visit','qr']) then return '#/'||v_root; end if;
 return '#/other';
end $$;
create function private.support_diagnostics(p_data jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_result jsonb:='{}'; v_errors jsonb:='[]'; v_e jsonb; v_clean jsonb; v_key text; v_value text;
begin
 if p_data is null or p_data='{}'::jsonb then return '{}'; end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'SUPPORT_BAD_INPUT'; end if;
 if p_data ? 'page_hash' then v_result:=v_result||jsonb_build_object('page_hash',private.support_path(p_data->>'page_hash')); end if;
 if p_data->>'captured_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then v_result:=v_result||jsonb_build_object('captured_at',p_data->>'captured_at'); end if;
 if p_data->>'build_id' ~ '^[a-zA-Z0-9_-]{1,80}$' then v_result:=v_result||jsonb_build_object('build_id',p_data->>'build_id'); end if;
 if jsonb_typeof(p_data->'online')='boolean' then v_result:=v_result||jsonb_build_object('online',p_data->'online'); end if;
 if jsonb_typeof(p_data->'viewport')='object' then
   v_clean:='{}';
   foreach v_key in array array['width','height'] loop
     v_value:=p_data->'viewport'->>v_key;
     if v_value ~ '^\d{1,5}$' and v_value::int between 1 and 20000 then v_clean:=v_clean||jsonb_build_object(v_key,v_value::int); end if;
   end loop;
   if v_clean<>'{}'::jsonb then v_result:=v_result||jsonb_build_object('viewport',v_clean); end if;
 end if;
 if jsonb_typeof(p_data->'recent_errors')='array' then
   for v_e in select value from jsonb_array_elements(p_data->'recent_errors') limit 10 loop
     v_clean:='{}';
     if v_e->>'at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then v_clean:=v_clean||jsonb_build_object('at',v_e->>'at'); end if;
     v_value:=v_e->>'source';
     v_clean:=v_clean||jsonb_build_object('source',case when v_value=any(array['client','window.onerror','unhandledrejection','error_boundary']) then v_value else 'client' end);
     v_value:=v_e->>'operation';
     v_clean:=v_clean||jsonb_build_object('operation',case when v_value=any(array['runtime_error','promise_rejection','render_error','privacy_consent','auth.signInWithOtp','auth.signInWithPassword','auth.verifyOtp','auth.updateUser','auth.profile','auth.action','apply','publish','pdf','calendar_move']) then v_value else 'unknown' end);
     v_value:=v_e->>'code';
     v_clean:=v_clean||jsonb_build_object('code',case when v_value=any(array['unknown','AbortError','TimeoutError','TypeError','ReferenceError','SyntaxError','NetworkError','AuthRetryableFetchError','invalid_credentials','otp_expired','over_email_send_rate_limit','over_request_rate_limit','email_not_confirmed','signup_disabled','unexpected_failure','request_timeout','REQUEST_TIMEOUT','23505','42501','57014','PGRST301']) or v_value ~ '^[45]\d{2}$' then v_value else 'unknown' end);
     v_errors:=v_errors||jsonb_build_array(v_clean);
   end loop;
   v_result:=v_result||jsonb_build_object('recent_errors',v_errors);
 end if;
 return v_result;
end $$;

-- Cached clients may still INSERT feedback directly. Apply the same privacy and
-- timestamp boundaries there, without making them migrate to the RPC first.
create function private.support_prepare_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if length(coalesce(new.body,''))>3000 or length(coalesce(new.expected_result,''))>1000 then raise exception 'SUPPORT_BAD_INPUT'; end if;
 if new.reporter_id is not null then
   perform pg_advisory_xact_lock(8349621);
   if (select count(*) from public.feedback where reporter_id=new.reporter_id and created_at>now()-interval '1 hour')>=20 then raise exception 'SUPPORT_RATE_LIMIT'; end if;
 end if;
 new.status:='open'; new.created_at:=now(); new.updated_at:=now();
 new.page_hash:=private.support_path(new.page_hash);
 new.diagnostics:=private.support_diagnostics(new.diagnostics);
 return new;
end $$;
create trigger feedback_support_prepare before insert on public.feedback for each row execute function private.support_prepare_insert();
revoke all on function private.support_prepare_insert() from public,anon,authenticated;
revoke all on public.feedback from anon;

create function private.support_report(p_report public.feedback) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',p_report.id,'page_hash',p_report.page_hash,'category',p_report.category,
   'body',p_report.body,'viewport',p_report.viewport,'created_at',p_report.created_at,'status',p_report.status,
   'topic',p_report.topic,'impact',p_report.impact,'expected_result',p_report.expected_result,
   'diagnostics',p_report.diagnostics,'updated_at',p_report.updated_at)
$$;
revoke all on function private.support_report(public.feedback) from public,anon,authenticated;
create function private.support_detail(p_id uuid,p_guest_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_report jsonb; v_messages jsonb;
begin
 if not private.support_can_access(p_id,p_guest_token) then raise exception 'SUPPORT_NOT_FOUND'; end if;
 select private.support_report(f) into v_report from public.feedback f where id=p_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'author_role',author_role,'body',body,'created_at',created_at) order by created_at,id),'[]'::jsonb)
 into v_messages from private.feedback_support_actions where feedback_id=p_id and body is not null;
 return jsonb_build_object('report',v_report,'messages',v_messages);
end $$;
create function private.support_list(p_guest_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('items',coalesce(jsonb_agg(private.support_report(f::public.feedback) order by f.updated_at desc),'[]'::jsonb)) from (
   select f.* from public.feedback f where (auth.uid() is not null and f.reporter_id=auth.uid()) or
   (f.reporter_id is null and exists(select 1 from private.feedback_guest_access g where g.feedback_id=f.id and g.token_hash=private.support_token(p_guest_token)))
   order by f.updated_at desc limit 100
 ) f
$$;
create function private.support_create(p_id uuid,p_guest_token text,p_category text,p_topic text,p_impact text,p_body text,p_expected text,p_page_hash text,p_diagnostics jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_hash bytea:=private.support_token(p_guest_token); v_diag jsonb;
begin
 if p_id is null or (v_uid is null and v_hash is null) then raise exception 'SUPPORT_BAD_INPUT'; end if;
 -- Serialise retry identity and create caps, including requests that rotate guest tokens.
 perform pg_advisory_xact_lock(8349621);
 if exists(select 1 from public.feedback where id=p_id) then
   if not private.support_can_access(p_id,p_guest_token) then raise exception 'SUPPORT_NOT_FOUND'; end if;
   return private.support_detail(p_id,p_guest_token);
 end if;
 if p_category is null or p_category<>all(array['confusing','broken','typo','suggestion','other']) or
    p_topic is null or p_topic<>all(array['login','signup','apply','post','pdf','chat','other']) or
    p_impact is null or p_impact<>all(array['blocked','difficult','suggestion']) or
    length(btrim(coalesce(p_body,''))) not between 1 and 3000 or length(coalesce(p_expected,''))>1000 or length(coalesce(p_page_hash,''))>1000 then raise exception 'SUPPORT_BAD_INPUT'; end if;
 if v_uid is null then
   if (select count(*) from public.feedback where reporter_id is null and created_at>now()-interval '1 hour')>=300 or
      (select count(*) from private.feedback_guest_access g join public.feedback f on f.id=g.feedback_id where g.token_hash=v_hash and f.created_at>now()-interval '1 hour')>=10 then raise exception 'SUPPORT_RATE_LIMIT'; end if;
 elsif (select count(*) from public.feedback where reporter_id=v_uid and created_at>now()-interval '1 hour')>=20 then raise exception 'SUPPORT_RATE_LIMIT'; end if;
 v_diag:=private.support_diagnostics(p_diagnostics);
 insert into public.feedback(id,reporter_id,page_hash,category,body,viewport,topic,impact,expected_result,diagnostics)
 values(p_id,v_uid,private.support_path(p_page_hash),p_category,btrim(p_body),(v_diag->'viewport'->>'width')::int,p_topic,p_impact,nullif(btrim(p_expected),''),v_diag);
 if v_uid is null then insert into private.feedback_guest_access values(p_id,v_hash); end if;
 return private.support_detail(p_id,p_guest_token);
end $$;
create function private.support_reply(p_id uuid,p_guest_token text,p_message_id uuid,p_body text,p_reopen boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_previous private.feedback_support_actions%rowtype; v_status text;
begin
 if not private.support_can_access(p_id,p_guest_token) then raise exception 'SUPPORT_NOT_FOUND'; end if;
 perform 1 from public.feedback where id=p_id for update;
 select * into v_previous from private.feedback_support_actions where id=p_message_id;
 if found then
   if v_previous.feedback_id<>p_id or v_previous.author_role<>'user' or v_previous.actor_id is distinct from auth.uid() then raise exception 'SUPPORT_NOT_FOUND'; end if;
   return private.support_detail(p_id,p_guest_token);
 end if;
 if p_message_id is null or length(btrim(coalesce(p_body,''))) not between 1 and 3000 then raise exception 'SUPPORT_BAD_INPUT'; end if;
 if (select count(*) from private.feedback_support_actions where feedback_id=p_id and author_role='user' and created_at>now()-interval '1 hour')>=60 then raise exception 'SUPPORT_RATE_LIMIT'; end if;
 select case when p_reopen or status in ('answered','resolved') then 'open' else status end into v_status from public.feedback where id=p_id;
 insert into private.feedback_support_actions(id,feedback_id,author_role,actor_id,body,status) values(p_message_id,p_id,'user',auth.uid(),btrim(p_body),v_status);
 update public.feedback set status=v_status where id=p_id;
 return private.support_detail(p_id,p_guest_token);
end $$;
create function private.admin_support_update(p_id uuid,p_expected_updated_at timestamptz,p_status text,p_body text,p_message_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_previous private.feedback_support_actions%rowtype; v_updated timestamptz;
begin
 if not private.support_is_admin() then raise exception 'SUPPORT_FORBIDDEN'; end if;
 select updated_at into v_updated from public.feedback where id=p_id for update;
 if not found then raise exception 'SUPPORT_NOT_FOUND'; end if;
 select * into v_previous from private.feedback_support_actions where id=p_message_id;
 if found then
   if v_previous.feedback_id<>p_id or v_previous.author_role<>'admin' or v_previous.actor_id is distinct from auth.uid() then raise exception 'SUPPORT_NOT_FOUND'; end if;
   return private.support_detail(p_id,null);
 end if;
 if p_message_id is null or p_status is null or p_status<>all(array['open','checking','answered','resolved']) or length(coalesce(p_body,''))>3000 or (p_status='answered' and nullif(btrim(p_body),'') is null) then raise exception 'SUPPORT_BAD_INPUT'; end if;
 if p_expected_updated_at is null or v_updated<>p_expected_updated_at then raise exception 'SUPPORT_CONFLICT'; end if;
 insert into private.feedback_support_actions(id,feedback_id,author_role,actor_id,body,status) values(p_message_id,p_id,'admin',auth.uid(),nullif(btrim(p_body),''),p_status);
 update public.feedback set status=p_status where id=p_id;
 return private.support_detail(p_id,null);
end $$;

-- Public functions are invokers; privileged code lives outside exposed schemas.
create function public.support_create(p_id uuid,p_guest_token text,p_category text,p_topic text,p_impact text,p_body text,p_expected text,p_page_hash text,p_diagnostics jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.support_create(p_id,p_guest_token,p_category,p_topic,p_impact,p_body,p_expected,p_page_hash,p_diagnostics) $$;
create function public.support_list(p_guest_token text) returns jsonb language sql security invoker set search_path='' as $$ select private.support_list(p_guest_token) $$;
create function public.support_detail(p_id uuid,p_guest_token text) returns jsonb language sql security invoker set search_path='' as $$ select private.support_detail(p_id,p_guest_token) $$;
create function public.support_reply(p_id uuid,p_guest_token text,p_message_id uuid,p_body text,p_reopen boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.support_reply(p_id,p_guest_token,p_message_id,p_body,p_reopen) $$;
create function public.admin_support_update(p_id uuid,p_expected_updated_at timestamptz,p_status text,p_body text,p_message_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_support_update(p_id,p_expected_updated_at,p_status,p_body,p_message_id) $$;

revoke all on function private.support_touch(),private.support_token(text),private.support_is_admin(),private.support_can_access(uuid,text),private.support_path(text),private.support_diagnostics(jsonb) from public,anon,authenticated;
revoke all on function private.support_create(uuid,text,text,text,text,text,text,text,jsonb),private.support_list(text),private.support_detail(uuid,text),private.support_reply(uuid,text,uuid,text,boolean),private.admin_support_update(uuid,timestamptz,text,text,uuid) from public,anon,authenticated;
revoke all on function public.support_create(uuid,text,text,text,text,text,text,text,jsonb),public.support_list(text),public.support_detail(uuid,text),public.support_reply(uuid,text,uuid,text,boolean),public.admin_support_update(uuid,timestamptz,text,text,uuid) from public,anon,authenticated;
grant usage on schema private to anon,authenticated;
grant execute on function private.support_create(uuid,text,text,text,text,text,text,text,jsonb),private.support_list(text),private.support_detail(uuid,text),private.support_reply(uuid,text,uuid,text,boolean),public.support_create(uuid,text,text,text,text,text,text,text,jsonb),public.support_list(text),public.support_detail(uuid,text),public.support_reply(uuid,text,uuid,text,boolean) to anon,authenticated;
grant execute on function private.admin_support_update(uuid,timestamptz,text,text,uuid),public.admin_support_update(uuid,timestamptz,text,text,uuid) to authenticated;

create function private.cleanup_guest_support() returns bigint language plpgsql security definer set search_path='' as $$
declare v_count bigint;
begin
 delete from public.feedback where reporter_id is null and updated_at<now()-interval '1 year';
 get diagnostics v_count=row_count; return v_count;
end $$;
revoke all on function private.cleanup_guest_support() from public,anon,authenticated;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('cleanup-guest-support','17 19 * * *','select private.cleanup_guest_support()');
 end if;
end $$;
