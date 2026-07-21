-- daywork★1対策①：見送りの沈黙を殺す／②「はじめての人OK」求人属性
create or replace function public.approve_application(p_application_id uuid, p_approve boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid; v_farmer uuid; v_worker uuid; v_status text; v_job int; v_new text;
  v_link text := 'https://chitose-bank.com/#/profile/worker/approved';
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
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募が承認されました：求人 #' || v_job,
        '求人 #' || v_job || ' への応募が承認されました。' || E'\n' ||
        'サイト内のチャットで、日程や集合場所を打ち合わせましょう。' || E'\n\n' ||
        '承認された応募とチャットはこちら：' || E'\n' || v_link,
        '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">'
        || '<h2 style="font-size:17px;color:#222;">応募が承認されました</h2>'
        || '<p style="font-size:14px;color:#222;">求人 #' || v_job || ' への応募が承認されました。<br/>'
        || 'サイト内のチャットで、日程や集合場所を打ち合わせましょう。</p>'
        || '<a href="' || v_link || '" style="display:inline-block;background:#00A86B;color:#fff;'
        || 'padding:14px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:bold;">'
        || 'チャットを開く</a>'
        || '<p style="font-size:11px;color:#B0B0B0;margin-top:14px;">chitose-bankは場の提供のみを行い、採否には関与しません。</p></div>'
      );
    exception when others then null; end;
  else
    insert into public.notifications (farmer_id, type, message)
    values (v_worker, 'application_declined',
            '求人 #' || v_job || '：今回はご縁がありませんでした。他の求人もぜひご覧ください');
    begin
      perform public.send_user_email(v_worker,
        '[chitose-bank] 応募の結果について：求人 #' || v_job,
        '求人 #' || v_job || ' への応募は、今回はご縁がありませんでした。' || E'\n' ||
        'ご応募ありがとうございました。' || E'\n\n' ||
        '募集の人数や日程の都合による見送りも多くあります。' || E'\n' ||
        'プロフィールを充実させると、承認されやすくなります。' || E'\n\n' ||
        '他の求人を見る：https://chitose-bank.com/#/search');
    exception when others then null; end;
  end if;

  return json_build_object('ok', true, 'status', v_new);
end; $$;

alter table public.jobs add column if not exists beginner_ok boolean not null default false;