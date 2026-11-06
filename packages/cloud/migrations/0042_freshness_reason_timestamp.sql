-- The freshness reason keeps the vacancy's publication instant (ISO 8601), not a rendered age like "561h old".
update decision d
set reasons = (
  select jsonb_agg(
    case
      when r->>'code' = 'freshness' then
        case
          when v.published_at is null then r - 'detail'
          else jsonb_set(r, '{detail}', to_jsonb(to_char(v.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
        end
      else r
    end
    order by ord)
  from jsonb_array_elements(d.reasons) with ordinality as e(r, ord)
  join vacancy v on v.id = d.vacancy_id
)
where exists (
  select 1 from jsonb_array_elements(d.reasons) r where r->>'code' = 'freshness'
);
