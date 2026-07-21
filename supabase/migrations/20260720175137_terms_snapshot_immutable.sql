-- 契約スナップショットの不変化：凍結後のterms_snapshot・確認日時は全経路で変更不可。
-- 記録を持つ応募行の削除も不可。解除は将来のmigration（＝意図的で記録の残る操作）のみ。
create or replace function public.trg_protect_terms_snapshot()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.terms_snapshot is not null then
      raise exception '契約記録（凍結済みスナップショット）のある応募は削除できません';
    end if;
    return old;
  end if;
  if old.terms_snapshot is not null then
    if new.terms_snapshot is distinct from old.terms_snapshot
       or new.terms_confirmed_worker_at is distinct from old.terms_confirmed_worker_at
       or new.terms_confirmed_farmer_at is distinct from old.terms_confirmed_farmer_at then
      raise exception '凍結済みの契約記録は変更できません（全経路で不変）';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists protect_terms_snapshot on public.applications;
create trigger protect_terms_snapshot
  before update or delete on public.applications
  for each row execute function public.trg_protect_terms_snapshot();