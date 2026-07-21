-- 凍結トリガーの一本化：CC版(trg_consign_freeze_spec・repo管理)を正とし、先行版を撤去
drop trigger if exists consignment_snapshot on public.consignment_deals;
drop function if exists public.trg_consignment_snapshot();