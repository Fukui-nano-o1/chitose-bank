-- 雇い手プロフィール「住所・所在地」の分割入力（2026-08-01たきと指示）
-- 郵便番号／都道府県／市区町村／町名・番地・建物名 の4分割カラムを新設。
-- recruiter_address（1行の合成値）は従来どおり保存を続ける＝表示経路（job_employer_profile RPC・
-- 求人ページ「募集者情報」・求人フローの引用）は無改修で不変。分割値が真実の座、合成は保存時にフロントで行う。
-- consignment_profiles は employer_profiles の LIKE 複製で、EmployerProfileEdit が同じ payload を
-- upsert するため同列を追加する（無いと委託プロフィールの保存が列不明エラーで全滅する）。
alter table public.employer_profiles
  add column if not exists recruiter_zip text,
  add column if not exists recruiter_prefecture text,
  add column if not exists recruiter_city text,
  add column if not exists recruiter_address_detail text;

alter table public.consignment_profiles
  add column if not exists recruiter_zip text,
  add column if not exists recruiter_prefecture text,
  add column if not exists recruiter_city text,
  add column if not exists recruiter_address_detail text;
