-- Separate leagues ("folders"): every league has its own championships, drivers, points systems
-- and admins, and cannot see or change another league's data. Run once in the SQL editor.
-- No DO blocks, so it runs in the Supabase editor. Safe to run again.
-- Site owners (rows in public.admins) can create leagues; league admins (public.league_admins) run one.

-- 1. Leagues and their admins
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone text check (timezone is null or public.is_valid_timezone(timezone)),
  units text check (units is null or units in ('imperial', 'metric')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.league_admins (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table public.leagues enable row level security;
alter table public.league_admins enable row level security;

-- 1b. League columns first, so the functions below can refer to them
alter table public.championships add column if not exists league_id uuid references public.leagues (id) on delete restrict;
alter table public.drivers add column if not exists league_id uuid references public.leagues (id) on delete cascade;
alter table public.categories add column if not exists league_id uuid references public.leagues (id) on delete cascade;
alter table public.points_systems add column if not exists league_id uuid references public.leagues (id) on delete cascade;
alter table public.spec_fields add column if not exists league_id uuid references public.leagues (id) on delete cascade;
alter table public.results_audit add column if not exists league_id uuid;

-- 2. Helpers. Each follows the chain up to the league, with the rights of the function owner
--    so the policies do not recurse.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
create or replace function public.can_admin_league(lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.league_admins where league_id = lid and user_id = auth.uid())
$$;
-- True for a site owner or an admin of any league (used to gate the admin screen and shared reference data).
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
      or exists (select 1 from public.league_admins where user_id = auth.uid())
$$;
create or replace function public.league_is_public(lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.championships where league_id = lid and status = 'published' and visibility = 'public')
$$;

-- 3. The existing data becomes the first league (only when there is data to keep)
insert into public.leagues (name, slug, timezone)
select coalesce((select name from public.league limit 1), 'My league'),
       coalesce(nullif(btrim(lower(regexp_replace(coalesce((select name from public.league limit 1), 'my league'), '[^A-Za-z0-9]+', '-', 'g')), '-'), ''), 'league'),
       (select timezone from public.league limit 1)
where not exists (select 1 from public.leagues)
  and (exists (select 1 from public.championships) or exists (select 1 from public.drivers) or exists (select 1 from public.categories));
insert into public.league_admins (league_id, user_id)
select (select id from public.leagues order by created_at limit 1), a.user_id
from public.admins a
where exists (select 1 from public.leagues) and not exists (select 1 from public.league_admins)
on conflict do nothing;

-- 4. League columns
alter table public.championships add column if not exists league_id uuid references public.leagues (id) on delete restrict;
update public.championships set league_id = (select id from public.leagues order by created_at limit 1) where league_id is null;
alter table public.championships alter column league_id set not null;
create index if not exists championships_league_idx on public.championships (league_id);

alter table public.drivers add column if not exists league_id uuid references public.leagues (id) on delete cascade;
update public.drivers set league_id = (select id from public.leagues order by created_at limit 1) where league_id is null;
alter table public.drivers alter column league_id set not null;

alter table public.categories add column if not exists league_id uuid references public.leagues (id) on delete cascade;
update public.categories set league_id = (select id from public.leagues order by created_at limit 1) where league_id is null;
alter table public.categories alter column league_id set not null;
alter table public.categories drop constraint if exists categories_name_key;
create unique index if not exists categories_league_name_uq on public.categories (league_id, name);

-- A league's own saved points systems: league_id set, championship_id null. The real-world library has neither.
alter table public.points_systems add column if not exists league_id uuid references public.leagues (id) on delete cascade;
alter table public.points_systems drop constraint if exists points_systems_one_owner;
alter table public.points_systems add constraint points_systems_one_owner check (championship_id is null or league_id is null);

-- Built-in upgrade parts have no league; a part a league adds belongs to that league.
alter table public.spec_fields add column if not exists league_id uuid references public.leagues (id) on delete cascade;
alter table public.results_audit add column if not exists league_id uuid;
update public.results_audit set league_id = (select id from public.leagues order by created_at limit 1) where league_id is null;
alter table public.spec_fields drop constraint if exists spec_fields_group_name_name_key;
create unique index if not exists spec_fields_builtin_uq on public.spec_fields (group_name, name) where league_id is null;
create unique index if not exists spec_fields_league_uq on public.spec_fields (league_id, group_name, name) where league_id is not null;

-- 5. Scope helpers for everything below a championship
create or replace function public.can_admin_champ(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.championships c
                 join public.league_admins la on la.league_id = c.league_id and la.user_id = auth.uid()
                 where c.id = cid)
$$;
create or replace function public.can_admin_season(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.seasons s where s.id = sid and public.can_admin_champ(s.championship_id))
$$;
create or replace function public.can_admin_event(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events e where e.id = eid and public.can_admin_season(e.season_id))
$$;
create or replace function public.can_admin_race(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.races r where r.id = rid and public.can_admin_event(r.event_id))
$$;
create or replace function public.can_admin_class(clid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes c where c.id = clid and public.can_admin_champ(c.championship_id))
$$;
create or replace function public.can_admin_build_spec(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.build_specs b where b.id = bid and public.can_admin_champ(b.championship_id))
$$;
create or replace function public.can_admin_points_system(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.points_systems p where p.id = pid and (
    (p.championship_id is not null and public.can_admin_champ(p.championship_id))
    or (p.championship_id is null and p.league_id is not null and public.can_admin_league(p.league_id))
    or (p.championship_id is null and p.league_id is null and public.is_owner())))
$$;
create or replace function public.can_read_points_system(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_admin_points_system(pid)
      or exists (select 1 from public.points_systems p where p.id = pid and p.championship_id is null and p.league_id is null and public.is_admin())
$$;

-- 6. Policies: replace "any admin can do everything" with "an admin of this league"
drop policy if exists championships_admin_all on public.championships;
create policy championships_admin_all on public.championships for all to authenticated
  using (public.can_admin_league(league_id)) with check (public.can_admin_league(league_id));
drop policy if exists seasons_admin_all on public.seasons;
create policy seasons_admin_all on public.seasons for all to authenticated
  using (public.can_admin_champ(championship_id)) with check (public.can_admin_champ(championship_id));
drop policy if exists event_series_admin_all on public.event_series;
create policy event_series_admin_all on public.event_series for all to authenticated
  using (public.can_admin_season(season_id)) with check (public.can_admin_season(season_id));
drop policy if exists events_admin_all on public.events;
create policy events_admin_all on public.events for all to authenticated
  using (public.can_admin_season(season_id)) with check (public.can_admin_season(season_id));
drop policy if exists races_admin_all on public.races;
create policy races_admin_all on public.races for all to authenticated
  using (public.can_admin_event(event_id)) with check (public.can_admin_event(event_id));
drop policy if exists race_templates_admin_all on public.race_templates;
create policy race_templates_admin_all on public.race_templates for all to authenticated
  using (public.can_admin_champ(championship_id)) with check (public.can_admin_champ(championship_id));
drop policy if exists classes_admin_all on public.classes;
create policy classes_admin_all on public.classes for all to authenticated
  using (public.can_admin_champ(championship_id)) with check (public.can_admin_champ(championship_id));
drop policy if exists class_rules_admin_all on public.class_rules;
create policy class_rules_admin_all on public.class_rules for all to authenticated
  using (public.can_admin_class(class_id)) with check (public.can_admin_class(class_id));
drop policy if exists build_specs_admin_all on public.build_specs;
create policy build_specs_admin_all on public.build_specs for all to authenticated
  using (public.can_admin_champ(championship_id)) with check (public.can_admin_champ(championship_id));
drop policy if exists build_spec_values_admin_all on public.build_spec_values;
create policy build_spec_values_admin_all on public.build_spec_values for all to authenticated
  using (public.can_admin_build_spec(build_spec_id)) with check (public.can_admin_build_spec(build_spec_id));
drop policy if exists drivers_admin_all on public.drivers;
create policy drivers_admin_all on public.drivers for all to authenticated
  using (public.can_admin_league(league_id)) with check (public.can_admin_league(league_id));
drop policy if exists results_admin_all on public.results;
create policy results_admin_all on public.results for all to authenticated
  using (public.can_admin_race(race_id)) with check (public.can_admin_race(race_id));
drop policy if exists results_audit_admin_all on public.results_audit;
drop policy if exists results_audit_admin_read on public.results_audit;
create policy results_audit_admin_read on public.results_audit for select to authenticated
  using (league_id is not null and public.can_admin_league(league_id));

drop policy if exists points_systems_admin_all on public.points_systems;
create policy points_systems_admin_all on public.points_systems for all to authenticated
  using (public.can_admin_points_system(id)
         or (championship_id is null and league_id is not null and public.can_admin_league(league_id))
         or (championship_id is null and league_id is null and public.is_owner()))
  with check ((championship_id is not null and public.can_admin_champ(championship_id))
         or (championship_id is null and league_id is not null and public.can_admin_league(league_id))
         or (championship_id is null and league_id is null and public.is_owner()));
drop policy if exists points_systems_library_read on public.points_systems;
create policy points_systems_library_read on public.points_systems for select to authenticated
  using (championship_id is null and league_id is null and public.is_admin());
drop policy if exists points_table_entries_admin_all on public.points_table_entries;
create policy points_table_entries_admin_all on public.points_table_entries for all to authenticated
  using (public.can_admin_points_system(points_system_id)) with check (public.can_admin_points_system(points_system_id));
drop policy if exists points_table_entries_library_read on public.points_table_entries;
create policy points_table_entries_library_read on public.points_table_entries for select to authenticated
  using (public.can_read_points_system(points_system_id));
drop policy if exists points_status_rules_admin_all on public.points_status_rules;
create policy points_status_rules_admin_all on public.points_status_rules for all to authenticated
  using (public.can_admin_points_system(points_system_id)) with check (public.can_admin_points_system(points_system_id));
drop policy if exists points_status_rules_library_read on public.points_status_rules;
create policy points_status_rules_library_read on public.points_status_rules for select to authenticated
  using (public.can_read_points_system(points_system_id));
drop policy if exists points_bonuses_admin_all on public.points_bonuses;
create policy points_bonuses_admin_all on public.points_bonuses for all to authenticated
  using (public.can_admin_points_system(points_system_id)) with check (public.can_admin_points_system(points_system_id));
drop policy if exists points_bonuses_library_read on public.points_bonuses;
create policy points_bonuses_library_read on public.points_bonuses for select to authenticated
  using (public.can_read_points_system(points_system_id));

-- Categories belong to a league; so do the parts a league adds. Built-in parts are shared and owner-managed.
drop policy if exists categories_admin_all on public.categories;
create policy categories_admin_all on public.categories for all to authenticated
  using (public.can_admin_league(league_id)) with check (public.can_admin_league(league_id));
drop policy if exists car_categories_admin_all on public.car_categories;
create policy car_categories_admin_all on public.car_categories for all to authenticated
  using (exists (select 1 from public.categories k where k.id = category_id and public.can_admin_league(k.league_id)))
  with check (exists (select 1 from public.categories k where k.id = category_id and public.can_admin_league(k.league_id)));
drop policy if exists spec_fields_admin_all on public.spec_fields;
create policy spec_fields_admin_all on public.spec_fields for all to authenticated
  using ((league_id is not null and public.can_admin_league(league_id)) or (league_id is null and public.is_owner()))
  with check ((league_id is not null and public.can_admin_league(league_id)) or (league_id is null and public.is_owner()));
drop policy if exists spec_fields_public_read on public.spec_fields;
create policy spec_fields_public_read on public.spec_fields for select to anon, authenticated
  using (league_id is null or public.league_is_public(league_id) or public.can_admin_league(league_id));

-- The car and track catalogues are shared reference data: any admin can read, only a site owner can change.
drop policy if exists cars_admin_all on public.cars;
drop policy if exists cars_admin_read on public.cars;
create policy cars_admin_read on public.cars for select to authenticated using (public.is_admin());
drop policy if exists cars_owner_write on public.cars;
create policy cars_owner_write on public.cars for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists track_venues_admin_all on public.track_venues;
drop policy if exists track_venues_admin_read on public.track_venues;
create policy track_venues_admin_read on public.track_venues for select to authenticated using (public.is_admin());
drop policy if exists track_venues_owner_write on public.track_venues;
create policy track_venues_owner_write on public.track_venues for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists track_layouts_admin_all on public.track_layouts;
drop policy if exists track_layouts_admin_read on public.track_layouts;
create policy track_layouts_admin_read on public.track_layouts for select to authenticated using (public.is_admin());
drop policy if exists track_layouts_owner_write on public.track_layouts;
create policy track_layouts_owner_write on public.track_layouts for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- Leagues: an admin sees and edits their own; visitors see a league that has a published public championship.
drop policy if exists leagues_admin_read on public.leagues;
create policy leagues_admin_read on public.leagues for select to authenticated using (public.can_admin_league(id));
drop policy if exists leagues_admin_update on public.leagues;
create policy leagues_admin_update on public.leagues for update to authenticated
  using (public.can_admin_league(id)) with check (public.can_admin_league(id));
drop policy if exists leagues_public_read on public.leagues;
create policy leagues_public_read on public.leagues for select to anon, authenticated using (public.league_is_public(id));
drop policy if exists league_admins_read on public.league_admins;
create policy league_admins_read on public.league_admins for select to authenticated using (public.can_admin_league(league_id));
drop trigger if exists leagues_set_updated_at on public.leagues;
create trigger leagues_set_updated_at before update on public.leagues for each row execute function public.set_updated_at();

-- 7. Functions that must respect leagues
create or replace function public.audit_results() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  select c.league_id into lid
  from public.races r
  join public.events e on e.id = r.event_id
  join public.seasons s on s.id = e.season_id
  join public.championships c on c.id = s.championship_id
  where r.id = coalesce(new.race_id, old.race_id);
  if tg_op = 'DELETE' then
    insert into public.results_audit (result_id, action, changed_by, before_row, league_id)
    values (old.id, 'delete', auth.uid(), to_jsonb(old), lid);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.results_audit (result_id, action, changed_by, before_row, after_row, league_id)
    values (new.id, 'update', auth.uid(), to_jsonb(old), to_jsonb(new), lid);
    return new;
  else
    insert into public.results_audit (result_id, action, changed_by, after_row, league_id)
    values (new.id, 'insert', auth.uid(), to_jsonb(new), lid);
    return new;
  end if;
end $$;

create or replace function public.default_build_values() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.build_specs set wheel_source = 'stock' where id = new.id and wheel_source is null;
  insert into public.build_spec_values (build_spec_id, field_id, rule, tier)
  select new.id, f.id, 'required', 'stock'
  from public.spec_fields f
  join public.championships c on c.id = new.championship_id
  where f.league_id is null or f.league_id = c.league_id
  on conflict do nothing;
  return new;
end $$;

create or replace function public.default_field_values() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.build_spec_values (build_spec_id, field_id, rule, tier)
  select b.id, new.id, 'required', 'stock'
  from public.build_specs b
  join public.championships c on c.id = b.championship_id
  where new.league_id is null or new.league_id = c.league_id
  on conflict do nothing;
  return new;
end $$;

create or replace function public.championship_missing_items(cid uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare c public.championships;
begin
  if not public.can_admin_champ(cid) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.championships where id = cid;
  if not found then return array['championship not found']; end if;
  return public.championship_missing(c.id, c.visibility, c.intended_timezone);
end $$;

-- 8. League and admin management (functions, so the checks live in the database)
drop function if exists public.list_admins();
drop function if exists public.add_admin(text);
drop function if exists public.remove_admin(uuid);

create or replace function public.create_league(league_name text, league_slug text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare lid uuid; s text;
begin
  if not public.is_owner() then raise exception 'Only a site owner can create a league'; end if;
  if length(btrim(coalesce(league_name, ''))) = 0 then raise exception 'Give the league a name'; end if;
  s := coalesce(nullif(btrim(lower(regexp_replace(coalesce(league_slug, league_name), '[^A-Za-z0-9]+', '-', 'g')), '-'), ''), 'league');
  if exists (select 1 from public.leagues where slug = s) then raise exception 'The address "%" is already used by another league', s; end if;
  insert into public.leagues (name, slug) values (btrim(league_name), s) returning id into lid;
  insert into public.league_admins (league_id, user_id) values (lid, auth.uid());
  return lid;
end $$;

create or replace function public.list_league_admins(lid uuid)
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_admin_league(lid) then raise exception 'Admins only'; end if;
  return query select a.user_id, u.email::text, a.created_at
    from public.league_admins a join auth.users u on u.id = a.user_id
    where a.league_id = lid order by a.created_at;
end $$;

create or replace function public.add_league_admin(lid uuid, admin_email text)
returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.can_admin_league(lid) then raise exception 'Admins only'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(admin_email));
  if uid is null then
    raise exception 'No login with that email. Create it in Supabase under Authentication > Users first, then add it here.';
  end if;
  insert into public.league_admins (league_id, user_id) values (lid, uid) on conflict do nothing;
end $$;

create or replace function public.remove_league_admin(lid uuid, uid uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_admin_league(lid) then raise exception 'Admins only'; end if;
  if uid = auth.uid() then raise exception 'You cannot remove yourself.'; end if;
  delete from public.league_admins where league_id = lid and user_id = uid;
end $$;

revoke all on function public.create_league(text, text) from public, anon;
revoke all on function public.list_league_admins(uuid) from public, anon;
revoke all on function public.add_league_admin(uuid, text) from public, anon;
revoke all on function public.remove_league_admin(uuid, uuid) from public, anon;
grant execute on function public.create_league(text, text) to authenticated;
grant execute on function public.list_league_admins(uuid) to authenticated;
grant execute on function public.add_league_admin(uuid, text) to authenticated;
grant execute on function public.remove_league_admin(uuid, uuid) to authenticated;

-- 9. Keep rows inside one league: a result can only point at its own league's driver, class and
--    build; a championship or race can only use the library, its league's or its own points system.
create or replace function public.champ_league(cid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select league_id from public.championships where id = cid
$$;
create or replace function public.race_league(rid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.league_id from public.races r
    join public.events e on e.id = r.event_id
    join public.seasons s on s.id = e.season_id
    join public.championships c on c.id = s.championship_id
  where r.id = rid
$$;
create or replace function public.points_system_fits(pid uuid, lid uuid, cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select pid is null or exists (
    select 1 from public.points_systems p where p.id = pid and (
      (p.championship_id is null and p.league_id is null)
      or (p.championship_id is null and p.league_id = lid)
      or (p.championship_id is not null and public.champ_league(p.championship_id) = lid)))
$$;

create or replace function public.guard_result_league() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  lid := public.race_league(new.race_id);
  if not exists (select 1 from public.drivers where id = new.driver_id and league_id = lid) then
    raise exception 'That driver belongs to another league';
  end if;
  if new.class_id is not null and not exists (
      select 1 from public.classes c where c.id = new.class_id and public.champ_league(c.championship_id) = lid) then
    raise exception 'That class belongs to another league';
  end if;
  if new.build_spec_id is not null and not exists (
      select 1 from public.build_specs b where b.id = new.build_spec_id and public.champ_league(b.championship_id) = lid) then
    raise exception 'That build sheet belongs to another league';
  end if;
  if not public.points_system_fits(new.scored_with_system_id, lid, null) then
    raise exception 'That points system belongs to another league';
  end if;
  return new;
end $$;
drop trigger if exists results_guard_league on public.results;
create trigger results_guard_league before insert or update on public.results
for each row execute function public.guard_result_league();

create or replace function public.guard_points_league() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  if tg_table_name = 'championships' then
    lid := new.league_id;
    if tg_op = 'UPDATE' and new.league_id <> old.league_id then
      raise exception 'A championship cannot move to another league';
    end if;
    if not public.points_system_fits(new.points_system_id, lid, null) then
      raise exception 'That points system belongs to another league';
    end if;
  elsif tg_table_name = 'races' then
    if not public.points_system_fits(new.points_system_id, public.event_league(new.event_id), null) then
      raise exception 'That points system belongs to another league';
    end if;
  else
    if not public.points_system_fits(new.points_system_id, public.champ_league(new.championship_id), null) then
      raise exception 'That points system belongs to another league';
    end if;
  end if;
  return new;
end $$;
create or replace function public.event_league(eid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.league_id from public.events e
    join public.seasons s on s.id = e.season_id
    join public.championships c on c.id = s.championship_id
  where e.id = eid
$$;
drop trigger if exists championships_guard_points on public.championships;
create trigger championships_guard_points before insert or update on public.championships
for each row execute function public.guard_points_league();
drop trigger if exists races_guard_points on public.races;
create trigger races_guard_points before insert or update on public.races
for each row execute function public.guard_points_league();
drop trigger if exists race_templates_guard_points on public.race_templates;
create trigger race_templates_guard_points before insert or update on public.race_templates
for each row execute function public.guard_points_league();
