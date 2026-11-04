-- 031: remove the old publish system and unused tables.
-- Public pages now read through the public_* functions only, so the direct-read
-- policies, the public views, the publish guard and the old class / build-spec tables are dead.

-- Direct anonymous read policies (visitors use the public_* functions instead)
drop policy if exists championships_public_read on public.championships;
drop policy if exists seasons_public_read on public.seasons;
drop policy if exists events_public_read on public.events;
drop policy if exists points_systems_public_read on public.points_systems;
drop policy if exists points_table_public_read on public.points_table_entries;
drop policy if exists points_status_public_read on public.points_status_rules;
drop policy if exists points_bonuses_public_read on public.points_bonuses;
drop policy if exists classes_public_read on public.classes;
drop policy if exists races_public_read on public.races;
drop policy if exists spec_fields_public_read on public.spec_fields;
drop policy if exists build_specs_public_read on public.build_specs;
drop policy if exists build_spec_values_public_read on public.build_spec_values;
drop policy if exists drivers_public_read on public.drivers;
drop policy if exists results_public_read on public.results;
drop policy if exists leagues_public_read on public.leagues;

-- Old public views and the publish guard
drop view if exists public.public_class_cars;
drop view if exists public.public_races;
drop view if exists public.public_build_specs;
drop trigger if exists championships_guard_publish on public.championships;
drop function if exists public.guard_publish();
drop function if exists public.championship_missing(uuid, text, text);
drop function if exists public.championship_missing_items(uuid);

-- Old "is it published" helpers
drop function if exists public.championship_is_public(uuid);
drop function if exists public.season_is_public(uuid);
drop function if exists public.event_is_public(uuid);
drop function if exists public.race_is_public(uuid);
drop function if exists public.points_system_is_public(uuid);
drop function if exists public.build_spec_is_public(uuid);
drop function if exists public.driver_is_public(uuid);
drop function if exists public.league_is_public(uuid);
drop function if exists public.class_is_public(uuid);

-- Unused tables (classes, categories and the old build spec tables) and their helpers
-- Results no longer point at classes or old build specs
create or replace function public.guard_result_league() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  lid := public.race_league(new.race_id);
  if not exists (select 1 from public.drivers where id = new.driver_id and league_id = lid) then
    raise exception 'That driver belongs to another league';
  end if;
  if not public.points_system_fits(new.scored_with_system_id, lid, null) then
    raise exception 'That points system belongs to another league';
  end if;
  return new;
end $$;
alter table public.results drop column if exists class_id;
alter table public.results drop column if exists build_spec_id;
alter table public.races drop column if exists class_id;
drop function if exists public.class_eligible_cars(uuid);
drop function if exists public.default_build_values() cascade;
drop function if exists public.default_field_values() cascade;
drop table if exists public.build_spec_values;
drop table if exists public.build_specs;
drop table if exists public.spec_fields;
drop table if exists public.class_rules;
drop table if exists public.car_categories;
drop table if exists public.categories;
drop table if exists public.classes;
drop function if exists public.can_admin_class(uuid);
drop function if exists public.can_admin_build_spec(uuid);

-- Old site-owner helpers (the app uses the league admin functions)
drop function if exists public.list_admins();
drop function if exists public.add_admin(text);
drop function if exists public.remove_admin(uuid);

-- The old status / visibility columns on championships
alter table public.championships drop column if exists status;
alter table public.championships drop column if exists visibility;

notify pgrst, 'reload schema';
