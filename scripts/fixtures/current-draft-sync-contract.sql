-- テストDB専用。2026-10-14に本番の関数定義・列定義を読み取り確認した差分。
-- 本番の v_allowed には draft_step_id がある。旧リポジトリのfixtureにはない。
-- アプリ側の項目定数から作らず、この差分を独立して適用して契約のズレを検出する。
alter table public.jobs add column draft_step_id text;
do $$
declare
  signature text;
  definition text;
begin
  foreach signature in array array[
    'public.sync_my_job_draft(uuid,uuid,jsonb,jsonb)',
    'public.sync_my_open_job(uuid,uuid,jsonb,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('''draft_step''' in definition) = 0 then
      raise exception 'Fixture contract changed: %', signature;
    end if;
    execute replace(definition, '''draft_step'',''lat''', '''draft_step'',''draft_step_id'',''lat''');
  end loop;
end $$;
