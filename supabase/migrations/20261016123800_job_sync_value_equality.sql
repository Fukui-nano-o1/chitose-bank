-- 求人同期の再送比較だけを修正する。列・RLS・許可項目・同意・所有者・ロックは不変。
-- 1. timestamptzの表記差を同じ型へ揃える（UTC/JST、小数秒。マイクロ秒は保持）。
-- 2. JSON包含ではなく項目ごとの完全一致。配列の削除・順序・重複も変更として扱う。
-- 既存関数の定義を使い、既に適用されたdraft_step_id等の差分を消さない。
-- 全関数の変更を1個のDOで原子的に実行し、想定外の定義では変更せず停止する。
do $migration$
declare
  fn regprocedure;
  src text;
  old_check text;
  new_check text;
  n integer;
  normalization text := $body$
    -- job_sync_value_equality_v1: 比較前に同意時刻だけをDB型へ揃える。
    -- 本人・同意・許可列・行ロック・状態検査を通過した行にのみ適用する。
    if p_patch ? 'work_video_consent_at' then
      p_patch := p_patch || jsonb_build_object('work_video_consent_at',
        (p_patch->>'work_video_consent_at')::timestamptz);
    end if;
    if jsonb_typeof(p_expected) = 'object' and p_expected ? 'work_video_consent_at' then
      p_expected := p_expected || jsonb_build_object('work_video_consent_at',
        (p_expected->>'work_video_consent_at')::timestamptz);
    end if;
$body$;
begin
  foreach fn in array array[
    'public.sync_my_job_draft(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.sync_my_open_job(uuid,uuid,jsonb,jsonb)'::regprocedure
  ] loop
    src := pg_get_functiondef(fn);
    if fn = 'public.sync_my_job_draft(uuid,uuid,jsonb,jsonb)'::regprocedure then
      old_check := 'if v_job.status=''draft'' and to_jsonb(v_job) @> p_patch then';
      new_check := $body$if v_job.status='draft' and not exists (
      select 1 from jsonb_each(p_patch) p
      where (to_jsonb(v_job)->p.key) is distinct from p.value
    ) then$body$;
    else
      old_check := 'if to_jsonb(v_job) @> (p_patch - ''draft_step'') then';
      new_check := $body$if not exists (
    select 1 from jsonb_each(p_patch - 'draft_step') p
    where (to_jsonb(v_job)->p.key) is distinct from p.value
  ) then$body$;
    end if;
    n := (length(src) - length(replace(src, old_check, ''))) / length(old_check);
    if position('job_sync_value_equality_v1' in src) > 0 then
      if n <> 0 or position(new_check in src) = 0 or position(normalization in src) = 0 then
        raise exception 'job sync equality: incomplete existing patch for %', fn;
      end if;
      continue;
    end if;
    if n <> 1 then
      raise exception 'job sync equality: anchor count % for % (expected 1)', n, fn;
    end if;
    execute replace(src, old_check, normalization || new_check);
  end loop;
end $migration$;
