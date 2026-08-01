-- cron_watchdog：一過性の「job startup timeout」で誤報しないようにする（2026-08-01）
--
-- 背景（2026-08-01 00:05 JST の誤報から）：
--   auto-start-work が「job startup timeout」で1回だけ失敗し、watchdog が管理者へ
--   「🚨定時処理の失敗」メールを送った。だが調べると：
--     ・job_pid が null＝pg_cron が背景ワーカーを起動できなかった（関数の中身は無関係）
--     ・前後の毎時実行（14:05／16:05 UTC）はいずれも成功、次の 01:05 も成功して取りこぼしを回収
--     ・auto_start_work は冪等（started_at が null の採用済みを毎時走査し、開始時刻を過ぎたものを
--       開始する）ので、1回飛んでも次の毎時実行が必ず追いつく＝データ被害ゼロ
--   つまり Supabase 側の一過性のワーカー起動失敗で、自己回復済み。呼ぶべき修理は無い。
--   同種は14日で2件だけ・別々のジョブ（session-summary 07/27・auto-start-work 07/31）＝infra起因。
--
-- 方針：一過性で自己回復する「job startup timeout」は鳴らさない。ただし恒久的な失敗は必ず鳴らす。
--   ・鳴らさない条件（両方満たす時のみ）：
--       (1) return_message が 'job startup timeout'（＝関数のSQLエラーではなくワーカー起動の失敗）
--       (2) その直前の同一ジョブの実行が成功している（＝孤立した瞬間的な失敗）
--   ・逆に、直前も失敗していれば＝ワーカー枯渇が続いている恒久障害so鳴らす。
--   ・'job startup timeout' 以外（summarize_sessions の window-in-agg のような本物のSQLエラー等）は
--     従来どおり即・鳴らす。
--
-- 二頭運転の整理（2026-07-21ルール）：cron_watchdog はこれまで repo migration に無く
-- DB直接適用のみだった。恒久物so本ファイルで版管理に写し、正本を repo 側に統一する。
-- （現行定義をそのまま採録し、WHERE 句にだけ抑制条件を足した。文面・宛先・65分窓は不変）

create or replace function public.cron_watchdog()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_lines text; v_count int;
begin
  select count(*), string_agg(
    '・' || coalesce(j.jobname,'(不明)') || '：' ||
    to_char(d.start_time at time zone 'Asia/Tokyo','MM/DD HH24:MI') || E'\n  ' ||
    left(coalesce(d.return_message,'(詳細なし)'), 200), E'\n')
    into v_count, v_lines
    from cron.job_run_details d
    left join cron.job j on j.jobid = d.jobid
   where d.status = 'failed'
     and d.start_time > now() - interval '65 minutes'
     -- 一過性かつ自己回復（直前の実行が成功）した「job startup timeout」は誤報so除外。
     -- 直前も失敗＝ワーカー枯渇が継続、または他のSQLエラーなら、従来どおり鳴らす。
     and not (
       d.return_message = 'job startup timeout'
       and coalesce((
         select p.status = 'succeeded'
           from cron.job_run_details p
          where p.jobid = d.jobid
            and p.start_time < d.start_time
          order by p.start_time desc
          limit 1
       ), false)
     );
  if v_count > 0 then
    perform public.send_admin_email(
      '🚨[chitose-bank] 定時処理の失敗：' || v_count || '件',
      '過去1時間で失敗した定時処理：' || E'\n\n' || v_lines || E'\n\n' ||
      '（このメールが来たら、Claudeに「cronが失敗した」と伝えてください。' || E'\n' ||
      '  失敗の中身を調べて修理します）');
  end if;
end; $function$;

revoke all on function public.cron_watchdog() from public, anon, authenticated;
