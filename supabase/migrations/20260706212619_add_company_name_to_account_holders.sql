-- 法人名（封筒宛先に不可欠。個人はnull）
alter table account_holders add column company_name text;

-- DB層の整合性: 法人なら法人名必須（個人はnull可）
alter table account_holders
  add constraint corporate_needs_name
  check (entity_type = 'individual' or company_name is not null);