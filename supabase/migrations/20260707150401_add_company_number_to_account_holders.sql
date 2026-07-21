-- 法人番号（国税庁13桁・法人の一意特定・訴訟時の被告特定の鍵）
-- entity_type=corporate の時のみ入る。個人はnull。
-- 必須化はUI側で届出後に行うため、DB制約は今は掛けない（nullable）。
alter table account_holders add column company_number text;