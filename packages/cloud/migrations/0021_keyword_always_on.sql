-- Keywords can no longer be switched off: every dictionary term is matched.
alter table keyword drop column if exists enabled;
