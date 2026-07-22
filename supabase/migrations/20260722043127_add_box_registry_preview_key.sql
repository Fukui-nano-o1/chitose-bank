-- ボックス一覧（admin_box_registry）で、行タップ時に本番の見た目を展開できるよう、
-- どの本番ボックスに対応するかを示す preview_key を追加。まずは段階お祝いボックス5種に付与。
alter table public.admin_box_registry add column if not exists preview_key text;

update public.admin_box_registry set preview_key = 'stage:w:approved' where name = '段階ボックス：承認されました！（働き手・②）';
update public.admin_box_registry set preview_key = 'stage:w:worked'   where name = '段階ボックス：お仕事おつかれさま（働き手・⑤）';
update public.admin_box_registry set preview_key = 'stage:w:reviewed' where name = '段階ボックス：評価を送りました（働き手・⑥）';
update public.admin_box_registry set preview_key = 'stage:f:applied'  where name = '段階ボックス：新しい応募が届きました（農家・①）';
update public.admin_box_registry set preview_key = 'stage:f:worked'   where name = '段階ボックス：作業が完了しました（農家・⑤）';
