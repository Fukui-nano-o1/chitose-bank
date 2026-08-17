-- さがすページの「まもなく公開」カード（2026-08-12たきと指示
-- 「タップできない求人カードをさがすページに追加。タップしてもまもなく公開されますのボックス展開のみ。
--   ただしトップ写真だけはカードで見せよう」）。
--
-- 【出すもの＝トップ写真と求人番号だけ】掲載申請済み（pending）の求人は運営の公開ゲートを
--   まだ通っていない。so jobs_public には入れない（法務境界＝2026-08-05「draft/pendingは出さない」は不変）。
--   代わりに専用の窓口を1本置き、カードに必要な最小限＝トップ写真のURLと求人番号だけを返す。
--   作物・作業・地域・報酬・募集主・日程・番地は【一切返さない】＝求人情報の提供にはならない
--   （データ最小化・データ憲法／職安法上の募集情報等提供の範囲を広げない）。
--
-- 【キルスイッチ】app_settings.pending_preview_on_search を 'false' に1行UPDATEすれば即座に
--   0件になる（デプロイ不要・signup_open / third_party_publish_allowed と同じ作法）。
--   未審査の写真が公開面に出る仕組みなので、問題があれば即止められる形にしておく。
--
-- 【出さないもの】取り下げた求人（unlisted_reason 非NULL）／停止中アカウントの求人／写真の無い求人
--   （写真がカードの中身の全部so、無ければ出しようがない＝ダミーを置かない・憲法3条）。

insert into public.app_settings (key, value)
values ('pending_preview_on_search', 'true')
on conflict (key) do nothing;

create or replace function public.pending_job_previews()
returns table (job_number integer, photo text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select j.job_number,
         coalesce(
           j.photos->0->>'thumb',                                              -- カード用サムネ（640px）
           j.photos->0->>'url',                                                -- 原寸へフォールバック
           case when jsonb_typeof(j.photos->0) = 'string' then j.photos->>0 end -- 旧string形式
         ) as photo
    from public.jobs j
   where coalesce((select s.value = 'true' from public.app_settings s
                    where s.key = 'pending_preview_on_search'), false)          -- キルスイッチ
     and j.status = 'pending'
     and j.unlisted_reason is null
     and not public.is_account_moderated(j.farmer_id)
     and coalesce(
           j.photos->0->>'thumb',
           j.photos->0->>'url',
           case when jsonb_typeof(j.photos->0) = 'string' then j.photos->>0 end
         ) is not null
   order by j.created_at desc;
$$;

comment on function public.pending_job_previews() is
  'さがすの「まもなく公開」カード用。掲載申請済み求人のトップ写真と求人番号だけを返す。'
  '作物・作業・地域・報酬・募集主は返さない（データ最小化）。'
  'app_settings.pending_preview_on_search=''false'' で即停止';

revoke all on function public.pending_job_previews() from public;
grant execute on function public.pending_job_previews() to anon, authenticated;
