-- プッシュ通知に「誰から・どんな内容か」を出す（2026-08-18たきと裁定）。
-- 従来は固定文「新しいメッセージが届きました」＋遷移先はチャット一覧に固定だった（2026-07-19 B案）。
-- 判断の材料：Web Pushのpayloadは購読ごとの鍵で暗号化され、配信サービス（Apple/Google）は中身を読めない
-- ＝プラポリ第5条「通知の本文は暗号化して送ります」の記載どおり。露出するのは端末のロック画面のみ。
-- 出す名前は表示名（働き手のニックネーム／雇い手の農園名）＝本名ではない（2026-07-30裁定に非抵触）。
--
-- ★本文はトリガーからEdge Functionへ渡さない：pg_netは送信bodyをキュー表に保存するため、
--   会話の中身がそこに溜まる。トリガーはidだけを渡し、中身はEdge Functionがこの関数で引く。
-- ★表示文言（題名・本文・遷移先・まとめ方）はこの関数1本に集約＝SWとEdge Functionに散らさない。
create or replace function public.push_payload(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_app_id uuid; v_sender uuid; v_body text;
  v_worker uuid; v_farmer uuid; v_recipient uuid; v_sender_is_worker boolean;
  v_name text; v_snippet text; v_url text; v_tag text;
begin
  if p_kind = 'message' then
    select application_id, sender_id, body into v_app_id, v_sender, v_body
      from public.messages where id = p_id;
    if v_app_id is null then return null; end if;
    select worker_id, farmer_id into v_worker, v_farmer
      from public.applications where id = v_app_id;
    if v_worker is null then return null; end if;
    v_sender_is_worker := (v_sender = v_worker);
    v_recipient := case when v_sender_is_worker then v_farmer else v_worker end;
    if v_recipient is null then return null; end if;
    -- 名前は「その取引での役割」で解決する（2026-08-03 get_my_calendar_jobs と同じ規則）。
    -- 両方の顔を持つ利用者がいるため、働き手優先で解決すると
    -- 農家として出ている取引で働き手名が出てしまう
    if v_sender_is_worker then
      select nullif(btrim(nickname), '') into v_name
        from public.worker_profiles where auth_id = v_sender;
    else
      select nullif(btrim(nickname), '') into v_name
        from public.employer_profiles where auth_id = v_sender;
    end if;
    if v_name is null then
      -- 退会した利用者は名前を出さない（2026-08-07の名前解決と同じ扱い）
      if exists (select 1 from auth.users u
                  where u.id = v_sender and u.email like 'withdrawn+%@withdrawn.invalid') then
        v_name := '退会した利用者';
      else
        v_name := 'お相手';
      end if;
    end if;
    v_url := '/#/chat/' || v_app_id::text;
    -- まとめ方はスレッドごと＝別のチャットの通知が互いに上書きしない（従来は 'cb-chat' 固定で潰れていた）
    v_tag := 'cb-chat-' || v_app_id::text;
  elsif p_kind = 'admin' then
    select user_id, body into v_recipient, v_body
      from public.admin_messages where id = p_id and from_admin;
    if v_recipient is null then return null; end if;
    v_name := '運営';
    v_url := '/#/chats';
    v_tag := 'cb-dm';
  else
    return null;
  end if;

  -- 本文の冒頭だけ（改行・連続空白は1つに畳んでから40文字＋…）
  v_snippet := btrim(regexp_replace(coalesce(v_body, ''), '\s+', ' ', 'g'));
  if v_snippet = '' then v_snippet := '新しいメッセージが届きました'; end if;
  if length(v_snippet) > 40 then v_snippet := left(v_snippet, 40) || '…'; end if;

  return jsonb_build_object(
    'recipient_id', v_recipient,
    'title', v_name,
    'body', v_snippet,
    'url', v_url,
    'tag', v_tag
  );
end; $$;

-- バックエンド専用（Edge Functionがservice_roleで呼ぶ）。クライアントからは叩かせない。
-- ★revokeは from public と from anon の両方が要る（2026-08-06の教訓：作成時にanonへ明示付与される）
revoke all on function public.push_payload(text, uuid) from public;
revoke all on function public.push_payload(text, uuid) from anon;
revoke all on function public.push_payload(text, uuid) from authenticated;

-- トリガーはidだけを渡す（本文はキュー表に残さない）
create or replace function public.notify_push_on_message()
returns trigger language plpgsql security definer set search_path to 'public','net' as $$
declare v_worker uuid; v_farmer uuid; v_recipient uuid; v_secret text; v_url text;
begin
  select worker_id, farmer_id into v_worker, v_farmer from public.applications where id = new.application_id;
  if v_worker is null then return new; end if;
  v_recipient := case when new.sender_id = v_worker then v_farmer else v_worker end;
  if v_recipient is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions ps where ps.auth_id = v_recipient) then return new; end if;
  select trigger_secret into v_secret from public.push_config where id = 1;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/functions/v1/send-push';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-trigger-secret', v_secret),
    body := jsonb_build_object('recipient_id', v_recipient, 'kind', 'message', 'id', new.id));
  return new;
exception when others then return new; end; $$;

create or replace function public.notify_push_on_admin_message()
returns trigger language plpgsql security definer set search_path to 'public','net' as $$
declare v_secret text; v_url text;
begin
  if not new.from_admin then return new; end if;
  if not exists (select 1 from public.push_subscriptions ps where ps.auth_id = new.user_id) then return new; end if;
  select trigger_secret into v_secret from public.push_config where id = 1;
  v_url := 'https://aegwepgtmwcnwzybpgsh.supabase.co/functions/v1/send-push';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-trigger-secret', v_secret),
    body := jsonb_build_object('recipient_id', new.user_id, 'kind', 'admin', 'id', new.id));
  return new;
exception when others then return new; end; $$;
