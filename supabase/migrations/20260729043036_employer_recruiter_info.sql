-- 募集者の情報（2026-07-27たきと指示）：農家プロフィール編集に
-- 「募集者の氏名または名称／住所・所在地／連絡先」の入力を追加する。
--
-- 公開範囲：この3列は employer_profiles_public（働き手が読む公開ビュー・列を明示列挙）に
-- 含めない＝本人と運営だけが見る。RLSも従来どおり本人(ep owner select/update)と管理者のみ。
-- 求人票への掲載は別の判断（利用規約・プライバシーポリシーの改訂と本人同意が必要）。
alter table public.employer_profiles
  add column if not exists recruiter_name    text,
  add column if not exists recruiter_address text,
  add column if not exists recruiter_contact text;

comment on column public.employer_profiles.recruiter_name    is '募集者の氏名または名称（本人と運営のみ・公開ビュー非掲載）';
comment on column public.employer_profiles.recruiter_address is '募集者の住所・所在地（本人と運営のみ・公開ビュー非掲載）';
comment on column public.employer_profiles.recruiter_contact is '募集者の連絡先（本人と運営のみ・公開ビュー非掲載。表示・交換機能は運営ポリシーで未実装）';
