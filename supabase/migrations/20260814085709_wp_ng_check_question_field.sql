-- 自由記述NG検査の穴：Q&Aの【質問欄】が未検査だった（2026-08-14 バグ狩りQ5aで発見・修理）
--
-- 【穴】trg_wp_z_publish_texts のNG検査は回答（a/answer）だけを見ており、質問文（q/question）に
--   電話番号・メール・URLを書くと素通りして公開された（実弾で「連絡は090-…へ」の公開を確認）。
--   UIの質問は定型プリセットだが、API直叩きなら任意の文字列を q に入れられる
--   ＝「正規経路にはある検証が別経路に無い」型（レビュー捏造・仮応募の来られる日と同族）。
-- 【修理】質問欄も同じ profile_text_ng で検査。畳み・FYI・原子性（1つでもNGなら全体不成立）は不変。

create or replace function public.wp_z_publish_texts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_folded boolean := false; v_ng text; v_e jsonb; v_qa_text text;
begin
  if new.pr_pending is not null then
    new.pr := nullif(btrim(new.pr_pending), '');
    new.pr_pending := null;
    v_folded := true;
  end if;
  if new.pr_qa_pending is not null then
    new.pr_qa := new.pr_qa_pending;
    new.pr_qa_pending := null;
    v_folded := true;
  end if;
  if v_folded then
    new.pr_submitted_at := null;
    new.pr_revision_targets := null;
  end if;

  if (tg_op = 'INSERT' and new.pr is not null)
     or (tg_op = 'UPDATE' and new.pr is distinct from old.pr) then
    v_ng := public.profile_text_ng(new.pr);
    if v_ng is not null then raise exception '自己紹介：%', v_ng; end if;
  end if;
  if (tg_op = 'INSERT' and new.pr_qa is not null)
     or (tg_op = 'UPDATE' and new.pr_qa is distinct from old.pr_qa) then
    for v_e in select value from jsonb_array_elements(coalesce(new.pr_qa, '[]'::jsonb))
    loop
      -- 質問欄も検査（2026-08-14修理）：定型プリセット外の文字列がAPI直叩きで入るため
      v_ng := public.profile_text_ng(coalesce(v_e->>'q', v_e->>'question'));
      if v_ng is not null then raise exception 'Q&Aの質問：%', v_ng; end if;
      v_ng := public.profile_text_ng(coalesce(v_e->>'a', v_e->>'answer'));
      if v_ng is not null then raise exception 'Q&Aの回答：%', v_ng; end if;
    end loop;
  end if;

  if v_folded and not exists (select 1 from public.app_admins a where a.auth_id = new.auth_id) then
    begin
      select string_agg('Q：' || coalesce(e->>'q', e->>'question','？') || E'\n' ||
                        'A：' || coalesce(e->>'a', e->>'answer','（未回答）'), E'\n\n')
        into v_qa_text
        from jsonb_array_elements(coalesce(new.pr_qa, '[]'::jsonb)) e;
      perform public.send_admin_email(
        '[公開・事後確認] 自己紹介が公開されました：' || coalesce(nullif(new.nickname,''),'（名前未設定）'),
        '働き手の自由記述が公開されました（保存＝即公開・2026-08-14承認プロセス廃止）。' || E'\n' ||
        '電話番号・メール・URLは保存時に自動拒否済み。' || E'\n\n' ||
        '■ 自己紹介：' || E'\n' || coalesce(new.pr, '（なし）') || E'\n\n' ||
        '■ Q&A：' || E'\n' || coalesce(v_qa_text, '（なし）') || E'\n\n' ||
        '公開後の確認：個人の特定・不適切な表現があれば、管理画面アカウント面の運営DMで修正を依頼するか、直接対処してください。');
    exception when others then null;
    end;
  end if;
  return new;
end; $$;
