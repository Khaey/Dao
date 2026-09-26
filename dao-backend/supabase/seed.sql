-- Minimal synthetic territory data for E2E project forms.
-- These rows are local test fixtures; production data remains migration/deployment managed.
insert into public.governorates (code, name_fr, name_ar)
values ('E2E_TEST', 'Gouvernorat E2E', 'ولاية الاختبار')
on conflict (code) do update
set name_fr = excluded.name_fr,
    name_ar = excluded.name_ar;

insert into public.delegations (governorate_id, code, name_fr, name_ar)
select id, 'E2E_TEST_DELEGATION', 'Délégation E2E', 'معتمدية الاختبار'
from public.governorates
where code = 'E2E_TEST'
on conflict (code) do update
set governorate_id = excluded.governorate_id,
    name_fr = excluded.name_fr,
    name_ar = excluded.name_ar;

insert into public.localities (delegation_id, name_fr, name_ar)
select d.id, 'Localité E2E', 'محلية الاختبار'
from public.delegations d
where d.code = 'E2E_TEST_DELEGATION'
  and not exists (
    select 1
    from public.localities l
    where l.delegation_id = d.id
      and l.name_fr = 'Localité E2E'
  );
