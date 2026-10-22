-- Makes a DNF worth 0 by default for every points system, existing and new. Run once in the
-- Supabase SQL editor on a database created from an earlier schema.sql. Safe to run twice.

-- A DNF scores 0 unless the admin changes it. This is a deliberate exception to "blank stays blank",
-- requested by the league admin. The admin can edit or clear it. DNS and DSQ stay unset.
create or replace function public.default_dnf_rule() returns trigger
language plpgsql as $$
begin
  insert into public.points_status_rules (points_system_id, status, points)
  values (new.id, 'dnf', 0) on conflict do nothing;
  return new;
end $$;

drop trigger if exists points_systems_default_dnf on public.points_systems;
create trigger points_systems_default_dnf
after insert on public.points_systems
for each row execute function public.default_dnf_rule();

insert into public.points_status_rules (points_system_id, status, points)
select id, 'dnf', 0 from public.points_systems
on conflict do nothing;
