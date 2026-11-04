-- Operator-chosen colour of an hh account (#rrggbb), shown as a dot/initials
-- chip across the UI. Null means "use the automatic colour".
alter table hh_account add column if not exists color text
  check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
