-- エラー記録のDB側レート制限（2026-09-28・たきと指示「ふせげ」）
-- 背景：1台の端末（Instagram経由の訪問者・外部スクリプト起因の Script error）が
-- 16:46〜17:57 JST の71分間に約26,000行を app_errors に書いた。クライアント側の間引き
-- （src/app/diagnostics/errorThrottle.js＝同じ文言5件/読み込み・全体50件）は、デプロイ前の
-- 古いJSを掴んだままのタブと、APIを直に叩く相手には効かない＝DBが最後の壁になる。
-- 規則（数字はこの関数の中だけ・変える時はここ）：
--   同じ session_id ＝ 1分に20件まで・1日に200件まで
--   全体          ＝ 1分に300件まで（session_id を毎回変える直叩きへの保険）
-- 超えた挿入は黙って捨てる（return null）＝クライアントにエラーを返さない。
-- エラー記録の失敗がさらにエラーを生む輪を作らないため。エラー記録は診断であって
-- 利用者のアクションの記録ではない＝行動記録の憲法の対象外（捨ててよい）。

-- 数える索引（session_id ごとの1分・1日の窓）。全体の窓は既存 app_errors_created_at_idx が受ける
create index if not exists app_errors_session_created_idx
  on public.app_errors (session_id, created_at desc);

create or replace function public.app_errors_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  -- session_id が null（直叩き等）は「nullの束」として同じ枠で数える。
  -- is not distinct from は索引を使えないので if で分ける
  if new.session_id is null then
    select count(*) into v_n from public.app_errors
      where session_id is null and created_at > now() - interval '1 minute';
    if v_n >= 20 then return null; end if;
    select count(*) into v_n from public.app_errors
      where session_id is null and created_at > now() - interval '1 day';
    if v_n >= 200 then return null; end if;
  else
    select count(*) into v_n from public.app_errors
      where session_id = new.session_id and created_at > now() - interval '1 minute';
    if v_n >= 20 then return null; end if;
    select count(*) into v_n from public.app_errors
      where session_id = new.session_id and created_at > now() - interval '1 day';
    if v_n >= 200 then return null; end if;
  end if;

  select count(*) into v_n from public.app_errors
    where created_at > now() - interval '1 minute';
  if v_n >= 300 then return null; end if;

  return new;
end;
$$;

-- トリガー関数は RPC の面に出ない（returns trigger）が、作成時の PUBLIC 自動付与は
-- 剥がしておく（2026-08-06の教訓の習慣。発火は所有者の権限で走るので機能は壊れない）
revoke all on function public.app_errors_rate_limit() from public, anon, authenticated;

drop trigger if exists trg_app_errors_rate_limit on public.app_errors;
create trigger trg_app_errors_rate_limit
  before insert on public.app_errors
  for each row execute function public.app_errors_rate_limit();
