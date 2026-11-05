-- hh calls the rouble `RUR`; everything else in the system says `RUB`.
update vacancy set salary_currency = 'RUB' where salary_currency = 'RUR';
update resume set salary_currency = 'RUB' where salary_currency = 'RUR';
update preset set filter = replace(filter::text, '"RUR"', '"RUB"')::jsonb where filter::text like '%"RUR"%';
update apply_filter set filter = replace(filter::text, '"RUR"', '"RUB"')::jsonb where filter::text like '%"RUR"%';
