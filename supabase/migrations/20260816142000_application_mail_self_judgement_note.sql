-- 応募通知（M02・0時間）に、自身の判断とサイト外連絡時の扱いを明記する
-- （2026-08-16たきと指示の督促表「0時間」の本文の趣旨を、既存M02に取り込む）
--
-- 【なぜ差し替えでなく追記か】0時間の枠は既存 M02（trg_notify_application）が担っている。
--   件名を指定文の「応募が届きました｜内容をご確認ください」に変えると mail_registry の
--   M02 パターン（'応募が入りました'）が外れてメール番号が付かなくなるため、件名は据え置き、
--   本文に2文だけ足す。
--
-- 【なぜ全文を書き直さないか】trg_notify_application は本文（テキスト＋HTML）で100行超あり、
--   全文の写経は取り違えの危険が大きい。目印の一意性を先に確認したうえで、
--   その1箇所だけを置換する。目印が見つからない・複数ある場合は例外で止める（黙って通さない）。

do $$
declare v_src text; v_new text; v_cnt int;
begin
  select prosrc into v_src from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'trg_notify_application';
  if v_src is null then raise exception 'trg_notify_application が見つかりません'; end if;

  -- 目印はそれぞれ1箇所だけであること
  select (length(v_src) - length(replace(v_src, '''承認・見送りはこちら：''', '')))
         / length('''承認・見送りはこちら：''') into v_cnt;
  if v_cnt <> 1 then raise exception 'テキストの目印が % 箇所（1箇所であるべき）', v_cnt; end if;
  select (length(v_src) - length(replace(v_src, '承認・見送りのページを開く</a>', '')))
         / length('承認・見送りのページを開く</a>') into v_cnt;
  if v_cnt <> 1 then raise exception 'HTMLの目印が % 箇所（1箇所であるべき）', v_cnt; end if;

  -- すでに追記済みなら何もしない（再実行しても二重にならない）
  if position('ご自身でご判断ください' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    '''承認・見送りはこちら：''',
    '''応募者のプロフィールをご確認のうえ、承認・見送り等をご自身でご判断ください。'' || E''\n'' ||'
    || E'\n    ''サイト外で連絡した場合も、対応状況を更新してください。'' || E''\n\n'' ||'
    || E'\n    ''承認・見送りはこちら：''');

  v_new := replace(v_new,
    '''承認・見送りのページを開く</a>''',
    '''承認・見送りのページを開く</a>'''
    || E'\n    || ''<p style="font-size:12px;color:#717171;margin-top:14px;line-height:1.8;">'''
    || E'\n    || ''応募者のプロフィールをご確認のうえ、承認・見送り等をご自身でご判断ください。<br />'''
    || E'\n    || ''サイト外で連絡した場合も、対応状況を更新してください。</p>''');

  execute 'create or replace function public.trg_notify_application() returns trigger '
       || 'language plpgsql security definer set search_path to ''public'' as $fn$'
       || v_new || '$fn$';
end $$;
