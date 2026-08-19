-- 2026-08-19 perks: free-text detail for raise / bonus / severance pay, plus the
-- "consultation window" required by the Part-time and Fixed-term Employment Act (art.6).
--
-- Why: art.6 + rule 2 require the EMPLOYER to state, in writing, whether there is a pay
-- raise / severance pay / bonus AND a consultation window. The booleans added earlier cover
-- the "whether"; the Labour Standards Act (rule 5-1-3 / 5-1-4-2 / 5-1-5) additionally wants
-- the CONTENT (timing, amount, calculation) whenever such a rule exists. These optional
-- detail fields let the employer state it, and freeze it into the contract snapshot.
--
-- consultation_contact deliberately does NOT go through the NG check (that check rejects
-- phone numbers / e-mail / URL), because a consultation window is a contact point by
-- definition. Same treatment as recruiter_contact.
-- NOTE: SQL kept ASCII-only on purpose; the Japanese labels are injected from base64.

alter table public.employer_profiles
  add column if not exists raise_detail text,
  add column if not exists bonus_detail text,
  add column if not exists severance_detail text,
  add column if not exists consultation_contact text;

-- EmployerProfileEdit upserts ONE payload into either table, so keep both in step.
alter table public.consignment_profiles
  add column if not exists raise_detail text,
  add column if not exists bonus_detail text,
  add column if not exists severance_detail text,
  add column if not exists consultation_contact text;

-- ep_z_publish_texts: fold the three new detail texts out of texts_pending and NG-check them.
-- Patch the CURRENT definition (it carries long Japanese literals) instead of rewriting it.
do $do$
declare
  v_src text; v_a text; v_b text; v_ins text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ep_z_publish_texts';
  if v_src is null then raise exception 'ep_z_publish_texts not found'; end if;
  if position('severance_detail' in v_src) > 0 then return; end if;

  -- (1) fold
  v_a := E'    new.supplies_cap             := coalesce(tp->>''supplies_cap'', new.supplies_cap);\n';
  v_n := (length(v_src) - length(replace(v_src, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'fold anchor found % times', v_n; end if;
  v_src := replace(v_src, v_a, v_a
    || E'    new.raise_detail             := coalesce(tp->>''raise_detail'', new.raise_detail);\n'
    || E'    new.bonus_detail             := coalesce(tp->>''bonus_detail'', new.bonus_detail);\n'
    || E'    new.severance_detail         := coalesce(tp->>''severance_detail'', new.severance_detail);\n');

  -- (2) NG check list (labels come from base64 so this file stays ASCII)
  v_b := E'(''pr'',''';
  v_n := (length(v_src) - length(replace(v_src, v_b, ''))) / length(v_b);
  if v_n <> 1 then raise exception 'label anchor found % times', v_n; end if;
  v_ins := '(''raise_detail'',''' || convert_from(decode('5piH57Wm44Gu5YaF5a65','base64'), 'UTF8') || '''), '
        || '(''bonus_detail'',''' || convert_from(decode('6LOe5LiO44Gu5YaF5a65','base64'), 'UTF8') || '''), '
        || '(''severance_detail'',''' || convert_from(decode('6YCA6IG35omL5b2T44Gu5YaF5a65','base64'), 'UTF8') || '''), '
        || v_b;
  v_src := replace(v_src, v_b, v_ins);

  execute v_src;
end $do$;

-- trg_job_publish_snapshot: freeze the detail texts and the consultation window into perks.
do $do$
declare
  v_src text; v_a text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_job_publish_snapshot';
  if v_src is null then raise exception 'trg_job_publish_snapshot not found'; end if;
  if position('consultation_contact' in v_src) > 0 then return; end if;
  v_a := E'      ''has_severance_pay'', coalesce(v_ep.has_severance_pay, false),\n';
  v_n := (length(v_src) - length(replace(v_src, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'perks anchor found % times', v_n; end if;
  execute replace(v_src, v_a, v_a
    || E'      ''raise_detail'', coalesce(v_ep.raise_detail, ''''),\n'
    || E'      ''bonus_detail'', coalesce(v_ep.bonus_detail, ''''),\n'
    || E'      ''severance_detail'', coalesce(v_ep.severance_detail, ''''),\n'
    || E'      ''consultation_contact'', coalesce(v_ep.consultation_contact, ''''),\n');
end $do$;
