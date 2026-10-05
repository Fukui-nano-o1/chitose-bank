-- YouTube作業動画のMVP土台。
-- 既存求人はすべてNULLのまま。画面表示・掲載条件はこのmigrationでは変更しない。
alter table public.jobs
  add column if not exists work_video_url text,
  add column if not exists work_video_job_consent boolean,
  add column if not exists work_video_related_consent boolean,
  add column if not exists work_video_consent_at timestamptz,
  add column if not exists work_video_consent_version text;

comment on column public.jobs.work_video_url is 'YouTube作業動画URL。MVPではYouTubeのみ。';
comment on column public.jobs.work_video_job_consent is '当該求人内（詳細・説明・メディアギャラリー）への埋め込み表示同意。';
comment on column public.jobs.work_video_related_consent is 'Chitose-bank内の他求人等で関連動画として掲載する任意同意。';
comment on column public.jobs.work_video_consent_at is '動画利用同意を確定した日時。';
comment on column public.jobs.work_video_consent_version is '動画利用同意文面の版。';
