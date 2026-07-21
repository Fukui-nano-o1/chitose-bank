-- 承認/見送りの判断日時を記録する（応募日時 created_at と対になる監査列）
alter table public.applications add column if not exists decided_at timestamptz;

create or replace function public.approve_application(p_application_id uuid, p_approve boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid; v_farmer uuid; v_worker uuid; v_status text; v_job int; v_new text;
begin
  v_caller := auth.uid();
  if v_caller is null then return json_build_object('ok', false, 'reason', 'not_logged_in'); end if;

  select farmer_id, worker_id, status, job_number
    into v_farmer, v_worker, v_status, v_job
    from public.applications where id = p_application_id;

  if v_farmer is null then return json_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_farmer <> v_caller then return json_build_object('ok', false, 'reason', 'not_your_application'); end if;
  if v_status <> 'applied' then return json_build_object('ok', false, 'reason', 'already_decided', 'status', v_status); end if;

  v_new := case when p_approve then 'approved' else 'rejected' end;
  update public.applications set status = v_new, decided_at = now() where id = p_application_id;

  if p_approve then
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_approved',
            '応募が承認されました：求人 #' || v_job || '　チャットで日程を打ち合わせましょう');
    begin
      perform public.send_user_email(
        v_worker,
        '[chitose-bank] 応募が承認されました：求人 #' || v_job,
        '求人 #' || v_job || ' への応募が承認されました。' || E'\n' ||
        'サイト内のチャットで、日程や集合場所を打ち合わせましょう。' || E'\n\n' ||
        'https://chitose-bank.com'
      );
    exception when others then null;
    end;
  end if;

  return json_build_object('ok', true, 'status', v_new);
end;
$$;