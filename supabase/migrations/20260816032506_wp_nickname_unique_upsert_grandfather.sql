-- ニックネーム重複禁止のupsert対応（2026-08-14たきと報告「アイコンを変えて保存すると重複エラー」）。
-- 原因：クライアントの保存は INSERT ... ON CONFLICT DO UPDATE（upsert）で、既存行があっても
-- PostgreSQLはまず BEFORE INSERT を発火する。グランドファーザー（変更なしの保存は通す）は
-- UPDATE分岐にしか無かったため、既知の残置重複（「たき」×2）のアカウントは名前を変えなくても
-- 保存のたびに拒否されていた（アイコン変更は無関係＝保存自体が引き金）。
-- 修理：INSERT試行でも「自分の既存行と同名（正規化一致）」なら変更なし扱いで通す。
-- 本物の新規INSERTは自分の行が無いので従来どおり一意検査。使用中の名前への変更も従来どおり拒否。
-- 実測（upsert形・ロールバック付き）：重複残置のupsert保存=通過／新規の奪取=拒否／他人の名前へ変更=拒否。
-- ★教訓：upsertを使うクライアントに対するBEFOREトリガーは、INSERT分岐にも「既存行の自分」を
--   考慮すること（UPDATE分岐だけの救済はupsertで素通りされる）。検証もupsert形で撃つ。
CREATE OR REPLACE FUNCTION public.wp_nickname_unique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_norm text;
begin
  v_norm := public.wp_nickname_norm(new.nickname);
  if v_norm = '' then return new; end if;  -- 空は既定名トリガー(wp_default_nickname)の領分
  if tg_op = 'UPDATE' and v_norm = public.wp_nickname_norm(old.nickname) then
    return new;  -- 変更なしの保存は通す（既存重複の残置＝グランドファーザー）
  end if;
  -- upsertのINSERT試行（既存行あり）でも、自分の行と同名なら変更なし扱いで通す（2026-08-14）
  if tg_op = 'INSERT' and exists (
    select 1 from public.worker_profiles w
     where w.auth_id = new.auth_id
       and public.wp_nickname_norm(w.nickname) = v_norm
  ) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wp_nickname:' || v_norm, 0));
  if exists (select 1 from public.worker_profiles w
              where w.auth_id <> new.auth_id
                and public.wp_nickname_norm(w.nickname) = v_norm) then
    raise exception 'このニックネームは既に使われています。別のニックネームにしてください';
  end if;
  return new;
end; $function$;
