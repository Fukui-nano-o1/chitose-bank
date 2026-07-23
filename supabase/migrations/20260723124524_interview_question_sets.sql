-- 面接の質問集（2026-07-23）。※本番へ先行適用済み（supabase_migrations に version 20260723124524 として記録済み）。
--   本ファイルは repo とのズレを解消するための写経（二頭運転の交通規則・2026-07-21）。冪等形なので再適用も安全。
-- 農家が自分の「面接の質問集」（タイトル＋質問1〜5）を作り、応募者チャットに【面接の質問】として投函する。
--   ・質問集は農家本人のみ CRUD（RLS owner限定）。
--   ・投函は send_interview_questions RPC 経由（農家＝当該応募のfarmerのみ）。回答はチャットに残る＝不変の証跡。
--   ・運営は関与しない（当事者=農家が自分の言葉で質問を送る）。「面談」の語は使わない（CLAUDE.md 2026-07-16）。

create table if not exists public.farmer_question_sets (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null,
  title text not null default '',
  questions jsonb not null default '[]'::jsonb,  -- 文字列の配列（質問1〜5）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.farmer_question_sets enable row level security;

drop policy if exists "fqs owner all" on public.farmer_question_sets;
create policy "fqs owner all" on public.farmer_question_sets
  for all to authenticated
  using (farmer_id = auth.uid())
  with check (farmer_id = auth.uid());

-- 質問集を応募者チャットに【面接の質問】として投函（農家＝当該応募のfarmerのみ・回答はチャットに残る）
create or replace function public.send_interview_questions(p_application_id uuid, p_set_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_farmer uuid; v_status text; v_title text; v_qs jsonb; v_body text; v_i int := 0; v_q text;
begin
  select farmer_id, status into v_farmer, v_status
    from public.applications where id = p_application_id;
  if v_farmer is null then return json_build_object('ok',false,'reason','not_found'); end if;
  if v_farmer <> auth.uid() then return json_build_object('ok',false,'reason','not_yours'); end if;
  if v_status not in ('applied','approved','meeting','interview','contracted') then
    return json_build_object('ok',false,'reason','bad_status');
  end if;

  select title, questions into v_title, v_qs
    from public.farmer_question_sets where id = p_set_id and farmer_id = auth.uid();
  if v_qs is null or jsonb_array_length(v_qs) = 0 then
    return json_build_object('ok',false,'reason','empty_set');
  end if;
  if jsonb_array_length(v_qs) > 5 then
    return json_build_object('ok',false,'reason','too_many','message','質問は5問までです');
  end if;

  v_body := '【面接の質問】' || coalesce(nullif(v_title,''),'') || E'\n' ||
            'お手すきの時に、このチャットでお答えください。';
  for v_q in select jsonb_array_elements_text(v_qs) loop
    v_i := v_i + 1;
    v_body := v_body || E'\n' || v_i || '. ' || v_q;
  end loop;

  insert into public.messages (application_id, sender_id, body)
  values (p_application_id, auth.uid(), v_body);
  return json_build_object('ok', true);
end; $function$;

grant execute on function public.send_interview_questions(uuid, uuid) to authenticated;
