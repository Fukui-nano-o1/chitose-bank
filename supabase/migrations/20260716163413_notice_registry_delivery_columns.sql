-- お知らせ配信の基盤（2026-07-16）：対象・期間・公開フラグを追加し、公開中のみ全ユーザーが読めるようにする
alter table public.admin_notice_registry
  add column audience text not null default 'all' check (audience in ('all','farmer','worker')),
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column published boolean not null default false;

-- 公開中（published かつ 期間内）のお知らせは誰でも読める（本文は運営が書く告知文のみ＝個人情報なし）。
-- 書き込みは従来どおり admin ALL ポリシーのみ
create policy "notices public read active" on public.admin_notice_registry
  for select to anon, authenticated
  using (
    published
    and (starts_at is null or now() >= starts_at)
    and (ends_at is null or now() <= ends_at)
  );

-- 運営判断（2026-07-16・Claude決定）の3本を公開状態で投入
insert into public.admin_notice_registry (name, body, sort, audience, starts_at, ends_at, published) values
  ('【重要】ログイン方法が変わりました',
   '次回ログイン時は「パスワードを忘れた方・未設定の方」から、メールに届く6桁コードで認証のうえ、パスワード（8文字以上）を設定してください。以降はメールアドレスとパスワードでログインできます。',
   -3, 'all', '2026-07-16 00:00+09', '2026-08-31 23:59+09', true),
  ('操作が少し変わりました',
   '求人フローの各ページは左右スワイプで進む・戻るができます。作成中と公開中もスワイプで切り替えられます。働き手プロフィールの「承認済み」は「チェック」に名前が変わり、カレンダーはプロフィール内でそのまま開きます。',
   -2, 'all', '2026-07-16 00:00+09', '2026-07-31 23:59+09', true),
  ('熱中症にご注意ください',
   '暑い日の作業は、こまめな水分補給と休憩をお願いします。帽子・飲み物をお忘れなく。体調がすぐれないときは、無理をせず作業の中止・延期をご相談ください。',
   -1, 'all', '2026-07-16 00:00+09', '2026-09-15 23:59+09', true);