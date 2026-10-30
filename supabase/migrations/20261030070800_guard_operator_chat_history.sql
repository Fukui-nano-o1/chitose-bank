-- Operator DM history only; no normal messages, hiring functions, data updates,
-- notifications, auth changes, or historical migration replay.
-- Apply only this reviewed file with separate action-time authorization.
begin;
set local search_path = pg_catalog, public;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.admin_messages in share row exclusive mode;
do $preflight$
declare v_fingerprint text;
begin
  select md5(jsonb_build_object(
'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.relacl::text) order by c.relname) from pg_class c where c.oid in ('public.admin_messages'::regclass,'public.app_admins'::regclass)),
'columns',(select jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attacl::text) order by c.relname,a.attnum) from pg_class c join pg_attribute a on a.attrelid=c.oid left join pg_attrdef d on a.attrelid=d.adrelid and a.attnum=d.adnum where c.oid in ('public.admin_messages'::regclass,'public.app_admins'::regclass) and a.attnum>0 and not a.attisdropped),
'constraints',(select jsonb_agg(jsonb_build_array(conname,contype,pg_get_constraintdef(oid,true)) order by conname) from pg_constraint where conrelid='public.admin_messages'::regclass and contype <> 'n'),
'policies',(select jsonb_agg(jsonb_build_array(p.tablename,p.policyname,p.permissive,p.roles,p.cmd,p.qual,p.with_check) order by p.tablename,p.policyname) from pg_policies p where p.schemaname='public' and p.tablename in ('admin_messages','app_admins')),
'triggers',(select jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true),md5(pg_get_functiondef(t.tgfoid))) order by c.relname,t.tgname) from pg_class c join pg_trigger t on t.tgrelid=c.oid where c.oid in ('public.admin_messages'::regclass,'public.app_admins'::regclass) and not t.tgisinternal)
)::text) into v_fingerprint;
  if v_fingerprint is distinct from 'c1451d298f7cd8609d13213a7c1968ff' then
    raise exception 'ADMIN_MESSAGE_SCHEMA_DRIFT';
  end if;
  if to_regprocedure('public.guard_admin_message_update()') is not null then
    raise exception 'ADMIN_MESSAGE_GUARD_ALREADY_EXISTS';
  end if;
end
$preflight$;

-- Match the existing UI: ordinary users receive operator messages; operators
-- receive user messages. An operator may still read their own system-report thread.
alter policy "am update" on public.admin_messages
  using (
    (from_admin and user_id = (select auth.uid()))
    or (not from_admin and exists (
      select 1 from public.app_admins a where a.auth_id = (select auth.uid())
    ))
  )
  with check (
    (from_admin and user_id = (select auth.uid()))
    or (not from_admin and exists (
      select 1 from public.app_admins a where a.auth_id = (select auth.uid())
    ))
  );

-- INSERT remains idempotent using the client-generated UUID; author/ownership
-- authorization remains the unchanged "am insert" policy. Database timestamps
-- and initial unread state cannot be supplied by an API client.
revoke insert, update, delete, truncate, trigger on public.admin_messages from public, anon, authenticated;
revoke insert (id, user_id, from_admin, body, created_at, read_at),
  update (id, user_id, from_admin, body, created_at, read_at)
  on public.admin_messages from public, anon, authenticated;
grant insert (id, user_id, from_admin, body) on public.admin_messages to authenticated;
grant update (read_at) on public.admin_messages to authenticated;

create function public.guard_admin_message_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- Compare every field except the sole mutable receipt, including future columns.
  -- This also protects history from an accidental privileged server UPDATE.
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception using errcode = '42501', message = 'ADMIN_MESSAGE_HISTORY_IMMUTABLE';
  end if;
  if new.read_at is null then
    if old.read_at is not null then
      raise exception using errcode = '42501', message = 'ADMIN_MESSAGE_RECEIPT_IMMUTABLE';
    end if;
    return null; -- Null-to-null requests do not produce an UPDATE or side effects.
  end if;
  if old.read_at is not null then
    return null; -- Retry/concurrent stale clients preserve the first receipt exactly.
  end if;
  new.read_at := clock_timestamp(); -- Client clock is never receipt evidence.
  return new;
end
$function$;

create trigger guard_admin_message_update
  before update on public.admin_messages
  for each row execute function public.guard_admin_message_update();

revoke all on function public.guard_admin_message_update() from public, anon, authenticated, service_role;


commit;
