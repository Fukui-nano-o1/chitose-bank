-- 2026-08-19 perks: add "shokyu" (pay raise) and "taishoku teate" (severance pay)
-- Both are legally required items of the labor conditions notice (rodo joken tsuchisho).
-- Same shape as has_bonus: a single boolean, no free-text detail (nothing new goes
-- through the texts_pending / NG-check path).
-- NOTE: SQL kept ASCII-only on purpose (Japanese typed through the MCP channel gets mangled).

alter table public.employer_profiles
  add column if not exists has_raise boolean not null default false,
  add column if not exists has_severance_pay boolean not null default false;

-- employer_profiles_public: rebuilt from the CURRENT production definition with the two
-- columns appended at the end (2026-08-06 lesson: never rebuild a view from an old migration).
create or replace view public.employer_profiles_public as
  select auth_id,
    nickname,
    pr,
    avatar_url,
    has_transport,
    has_parking,
    has_commute_allowance,
    has_bonus,
    employer_pays_supplies,
    accessory_ok,
    parking_capacity,
    commute_allowance_detail,
    transport_area,
    supplies_cap,
    intro_path,
    intro_joy,
    intro_crops,
    intro_atmosphere,
    intro_message,
    owner_comment,
    staff_count,
    commitment,
    unique_point,
    always_do,
    break_style,
    interaction_style,
    place_prefecture,
    place_city,
    place_town,
    created_at,
    insurance_items,
    teaching_style,
    chat_style,
    question_style,
    has_raise,
    has_severance_pay
  from employer_profiles
  where not is_account_moderated(auth_id);

-- 2026-07-19 rule: views are SELECT-only.
revoke all on public.employer_profiles_public from anon, authenticated;
grant select on public.employer_profiles_public to authenticated;

-- trg_job_publish_snapshot: freeze the two new keys into jobs.perks at publish time.
-- The body carries long Japanese literals, so patch one fragment of the CURRENT definition
-- instead of rewriting it (2026-08-16 lesson). Idempotent; aborts unless it matches exactly once.
do $do$
declare
  v_src text;
  v_needle text;
  v_repl text;
  v_n int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_job_publish_snapshot';
  if v_src is null then
    raise exception 'trg_job_publish_snapshot not found';
  end if;
  if position('has_severance_pay' in v_src) > 0 then
    return; -- already patched
  end if;
  v_needle := E'      ''has_bonus'', coalesce(v_ep.has_bonus, false),\n';
  v_repl := v_needle
    || E'      ''has_raise'', coalesce(v_ep.has_raise, false),\n'
    || E'      ''has_severance_pay'', coalesce(v_ep.has_severance_pay, false),\n';
  v_n := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  if v_n <> 1 then
    raise exception 'expected exactly 1 anchor in trg_job_publish_snapshot, found %', v_n;
  end if;
  execute replace(v_src, v_needle, v_repl);
end $do$;
