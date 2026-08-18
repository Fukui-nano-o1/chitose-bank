-- ============================================================================
-- 定期点検スクリプト（2026-08-06 制定・読み取り専用・何も書き換えない）
--
-- 【目的】「静かに消える」型の事故を、1本流すだけで検出する。
--   契機＝2026-08-06 実機一周：訪問者への位置マスクthat別作業のビュー作り直しで
--   静かに外れていた（エラーも出ず誰も気づかない）。この型は目視では拾えないso、
--   機械の点検に落とす。
--
-- 【流し方】SupabaseのSQLエディタ（またはMCPのexecute_sql）にこのファイル全文を貼って実行。
--   結果は raise exception のメッセージとして出る（例外で終わるthat仕様＝
--   読み取り専用を担保するため。エラー扱いに驚かない）。
--   [NG] の行thatあれば、その項目の見出しコメントを読んで対処する。
--
-- 【流すタイミング】ビュー・RPC・RLSを触った日の作業終了前／月1回の定期。
-- ============================================================================
do $audit$
declare
  L text := ''; rec record; n int; names text;
begin

  -- ── ① 訪問者（anon）マスク：jobs_public ─────────────────────────────
  -- 町域・最寄り駅・番地・募集主=0件、座標の小数桁<=2、半径>=3000 でOK。
  -- NGなら 20260806110501 の定義でビューを作り直す（必ず今の本番定義を土台に）。
  execute 'set local role anon';
  select count(*) cnt, coalesce(max(scale(lat)),0) latscale, coalesce(min(geo_radius_m),9999) minr,
         count(nearest_station) st, count(town) tw, count(work_address) wa, count(recruiter_name) rn
    into rec from public.jobs_public;
  execute 'reset role';
  L := L || case when rec.latscale<=2 and rec.minr>=3000 and rec.st=0 and rec.tw=0 and rec.wa=0 and rec.rn=0
                 then '[OK] ' else '[NG] ' end
    || '① 訪問者マスク: 行='||rec.cnt||' 座標桁='||rec.latscale||' 半径min='||rec.minr
    || ' 駅='||rec.st||' 町域='||rec.tw||' 番地='||rec.wa||' 募集主='||rec.rn || E'\n';

  -- ── ② 審査プレビューの42P13（列ズレ）─────────────────────────────
  -- jobs_public に列を足して admin_preview_job を直し忘れると、呼び出し時に
  -- 42P13 で審査プレビューthat全滅する（前例2回）。実際に呼んで確かめる。
  begin
    perform set_config('request.jwt.claims',
      json_build_object('role','authenticated','sub',(select auth_id from public.app_admins limit 1))::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.admin_preview_job(
      (select min(job_number) from public.jobs where status in ('open','pending')));
    execute 'reset role';
    L := L || '[OK] ② 審査プレビュー admin_preview_job: '||n||'行（42P13なし）' || E'\n';
  exception when others then
    execute 'reset role';
    L := L || '[NG] ② 審査プレビュー: '||left(sqlerrm,100)||'（jobs_publicと列を同数・同順に）' || E'\n';
  end;
  perform set_config('request.jwt.claims','',true);

  -- ── ③ anonから実行できる SECURITY DEFINER 関数（トリガー関数は除く）──────
  -- 新しいRPCの revoke 忘れを拾う。一覧を目視し、訪問者に開けてよいものだけか確認する
  -- （signup_open・job_employer_trust_info 等、意図して開けているものはある＝一覧は情報表示）。
  -- prorettype=trigger は実際にはRPCとして叩けないので除外（一覧のノイズを消す）。
  select count(*), string_agg(p.proname, ' / ' order by p.proname) into n, names
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.prokind='f' and p.prosecdef
     and pg_get_function_result(p.oid) <> 'trigger'
     and has_function_privilege('anon', p.oid, 'execute');
  L := L || '[目視] ③ anonから実行できる実RPC: '||n||'本 → '||coalesce(names,'なし') || E'\n';

  -- ── ③b バックエンド専用that anonに開いていないか（送信・cron・内部）──────────
  -- send_/notify_/expire_/summarize_ で始まる関数は、フロントから直接呼ばない裏方。
  -- anonに開いていると、既知UUIDへの任意メール送信・cronの手動発火など副作用を撃てる。
  -- 2026-08-03に resolve_actor_name/unread_count_for をrevokeしたのと同じ観点。
  select count(*), string_agg(p.proname, ' / ' order by p.proname) into n, names
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.prokind='f' and p.prosecdef
     and pg_get_function_result(p.oid) <> 'trigger'
     and (p.proname like 'send\_%' or p.proname like 'notify\_%'
          or p.proname like 'expire\_%' or p.proname like 'summarize\_%')
     and p.proname <> 'send_interview_questions'  -- フロントthauthenticatedで呼ぶ正当なRPC（内部にfarmer本人ゲート）
     and has_function_privilege('anon', p.oid, 'execute');
  L := L || case when n=0 then '[OK] ' else '[NG] ' end
    || '③b バックエンド専用のanon露出: '||n||'本'||coalesce(' → '||names,'') || E'\n';

  -- ── ③c 当事者ゲート無しのDefinerヘルパーthat直叩き露出していないか（名前でなく構造で拾う）──
  -- ③bは名前（send_/notify_…）でしか拾えず、app_work_dates（応募の稼働日）・job_ref（下書き求人の
  -- 農園名）that名前規則の隙間から漏れた（2026-08-07）。ここは構造で拾う＝
  -- 「SECURITY DEFINER・id引数を取る（リソース指定型）・本体に auth.uid()/app_admins の当事者判定that無い・
  --  anon か authenticated にEXECUTE可」。列挙は目視（訪問者に見せる仕様のもの＝下記WHITELISTは除外）。
  -- WHITELIST（求人詳細で訪問者に見せる公開情報・RLS内で評価される判定）：
  --   employer_public_jobs/employer_public_job_counts/job_employer_profile/job_employer_trust_info/
  --   job_exists/is_account_moderated/is_measured/employer_trust_info/signup_open/push_vapid_public/
  --   is_worker_profile_ready（boolean・uuid推測不能・フロントthat本人uidで呼ぶ）
  select count(*), string_agg(p.proname, ' / ' order by p.proname) into n, names
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.prokind='f' and p.prosecdef
     and pg_get_function_result(p.oid) <> 'trigger'
     and pg_get_function_arguments(p.oid) ~* '(uuid|integer|bigint)'
     and not (pg_get_functiondef(p.oid) ~* 'auth\.uid\(\)')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
     and p.proname not in ('employer_public_jobs','employer_public_job_counts','job_employer_profile',
       'job_employer_trust_info','job_exists','is_account_moderated','is_measured','employer_trust_info',
       'signup_open','push_vapid_public','is_worker_profile_ready');
  L := L || case when n=0 then '[OK] ' else '[NG(要判断)] ' end
    || '③c 当事者ゲート無しDefinerの露出（WHITELIST外）: '||n||'本'||coalesce(' → '||names,'') || E'\n';

  -- ── ④ フェイルオープン候補（auth.uid()のNULL弾き忘れ）───────────────────
  -- `auth.uid() <> x and not exists(...)` の型は、未ログインで auth.uid() が NULL →
  -- 条件全体がNULL＝偽になり拒否に入らない（前例2回：worker_trust_info・worker_want_again_count）。
  -- SECURITY DEFINERで auth.uid() を比較に使うのに「is null」を先に弾いていない関数を列挙。
  select count(*), string_agg(p.proname, ' / ' order by p.proname) into n, names
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.prokind='f' and p.prosecdef
     and pg_get_functiondef(p.oid) ~* 'auth\.uid\(\)\s*<>'
     and pg_get_functiondef(p.oid) !~* 'auth\.uid\(\)\s+is\s+null';
  L := L || case when n=0 then '[OK] ' else '[NG] ' end
    || '④ フェイルオープン候補: '||n||'本'||coalesce(' → '||names,'') || E'\n';

  -- ── ⑤ ビューの書き込み権限（SELECT専用ルール 2026-07-19）──────────────
  -- 単純ビューは自動更新可能so、書き込みgrantが残ると基表のRLSを迂回できる。
  select count(*), string_agg(distinct g.table_name||':'||g.grantee||':'||g.privilege_type, ' / ') into n, names
    from information_schema.role_table_grants g
   where g.table_schema='public'
     and g.table_name in (select viewname from pg_views where schemaname='public')
     and g.grantee in ('anon','authenticated')
     and g.privilege_type <> 'SELECT';
  L := L || case when n=0 then '[OK] ' else '[NG] ' end
    || '⑤ ビューの書き込み権限: '||n||'件'||coalesce(' → '||names,'') || E'\n';

  -- ── ⑥ 入口（新規登録の設定that生きているか）──────────────────────────
  -- Confirm email thatOFFだと、メールを1通も送らずに「確認済み」アカウントthatできる
  -- （2026-08-04の幽霊行の型）。直近7日にそれthat再発していないかを数える。
  select count(*) filter (where confirmation_sent_at is null and email_confirmed_at is not null
                            and created_at >= now() - interval '7 days') as ghosts,
         count(*) filter (where created_at >= now() - interval '7 days') as recent
    into rec from auth.users;
  L := L || case when rec.ghosts=0 then '[OK] ' else '[NG] ' end
    || '⑥ 入口: 直近7日の登録='||rec.recent||'件 うち確認メール無しで確認済み='||rec.ghosts||'件' || E'\n';

  -- ── ⑦ 応募の条件が1本のままか（段A/B/C・2026-08-17）────────────────────
  -- 応募には3つの入口がある：正面(apply_to_job)／仮応募(create_pending_application)／
  -- 昇格(promote_my_pending_applications)。昇格は applications へ直接INSERTするため
  -- apply_to_job を通らず、条件が割れると「正面は弾かれるのに仮応募経由は通る」が起きる。
  -- ★巻き戻しの地雷：apply_to_job の【旧定義（Q&Aゲート入り）】を丸ごと持つ migration が
  --   6本ある（20260713041511 / 20260724090000 / 20260725170000 / 20260813052942 /
  --   20260816033926 / 20260816040500）。create or replace なので、そのどれかを土台にすると
  --   段Cが無言で巻き戻る。現行の正は 20260817100956（apply_to_job）と 20260817100444
  --   （is_worker_profile_ready）。NGが出たらこの2本の定義で作り直す。
  select
    (select pg_get_functiondef(oid) ilike '%is_worker_profile_ready%' from pg_proc where proname='apply_to_job') as a_ready,
    (select pg_get_functiondef(oid) ilike '%qa_required%'            from pg_proc where proname='apply_to_job') as a_qa,
    (select pg_get_functiondef(oid) ilike '%emergency_contacts%'     from pg_proc where proname='is_worker_profile_ready') as r_emg,
    (select pg_get_functiondef(oid) ilike '%btrim(w.transport)%'     from pg_proc where proname='is_worker_profile_ready') as r_tr,
    (select pg_get_functiondef(oid) ilike '%own_job%'                from pg_proc where proname='create_pending_application') as p_own,
    (select pg_get_functiondef(oid) ilike '%is_account_moderated%'   from pg_proc where proname='create_pending_application') as p_ban,
    (select pg_get_functiondef(oid) ilike '%account_holders%'        from pg_proc where proname='promote_my_pending_applications') as g_reg
    into rec;
  L := L || case when rec.a_ready and not rec.a_qa and rec.r_emg and not rec.r_tr
                      and rec.p_own and rec.p_ban and rec.g_reg
                 then '[OK] ' else '[NG] ' end
    || '⑦ 応募の条件が1本: 正面が4項目を見る='||rec.a_ready||' 旧Q&Aゲート残='||rec.a_qa
    || ' 4項目(緊急連絡先)='||rec.r_emg||' 旧項目(移動手段)残='||rec.r_tr
    || ' 仮応募の壁(自分の求人/BAN)='||rec.p_own||'/'||rec.p_ban
    || ' 昇格の本人確認='||rec.g_reg || E'\n';

  raise exception E'\n===== 定期点検の結果（読み取り専用・この例外は仕様）=====\n%', L;
end $audit$;
