-- Forza Championship Manager: database schema (Supabase / PostgreSQL 15+)
--
-- HOW TO RUN
--   1. Supabase dashboard > SQL Editor > paste this whole file > Run.
--   2. Create your admin account in Authentication > Users, then run:
--        insert into public.admins (user_id)
--        select id from auth.users where email = 'YOUR-ADMIN-EMAIL';
--      Only people listed in public.admins can edit anything.
--
-- RULES THIS SCHEMA ENFORCES
--   * No implicit defaults: championship settings are nullable and start blank.
--     The only defaults are system states (draft, scheduled, unverified), never
--     rules, scoring, cars, tracks, distances or schedule values. The one exception,
--     requested by the league admin: a new build spec starts with every upgrade part
--     at Required, Stock tier.
--   * Publishing is blocked while required items are missing (see guard_publish).
--   * Anonymous visitors can read only championships that are published AND public.
--     The imported car and track tables are admin-only; the public sees cars by
--     name and tracks by layout through the public_* views at the end of this file.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.is_valid_timezone(tz text) returns boolean
language sql stable set search_path = pg_catalog as $$
  select tz is not null and exists (select 1 from pg_timezone_names where name = tz)
$$;

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Championship > Season > Event > Race
-- ---------------------------------------------------------------------------

create table public.championships (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  visibility text check (visibility in ('public', 'private')),
  -- IANA name such as 'Australia/Sydney'. Blank until the admin chooses one.
  intended_timezone text check (intended_timezone is null or public.is_valid_timezone(intended_timezone)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create index seasons_championship_idx on public.seasons (championship_id);

-- The recurrence rule. Events are generated from it and stored as real rows,
-- so each one can be edited, moved or cancelled on its own.
create table public.event_series (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text,
  pattern text check (pattern in ('weekly', 'fortnightly', 'monthly', 'custom')),
  -- Used by 'custom' (for example every 3 weeks). Weekly and fortnightly imply 1 and 2 weeks.
  interval_count integer check (interval_count is null or interval_count > 0),
  interval_unit text check (interval_unit in ('day', 'week', 'month')),
  monthly_mode text check (monthly_mode in ('day_of_month', 'nth_weekday')),
  first_local_date date,
  local_time time,                      -- the race start, in the series' time zone
  lobby_local_time time,                -- optional: when the lobby opens, same local day
  timezone text check (timezone is null or public.is_valid_timezone(timezone)),
  end_type text check (end_type in ('on_date', 'after_count')),
  until_date date,
  occurrence_count integer check (occurrence_count is null or occurrence_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_type is distinct from 'on_date' or until_date is not null),
  check (end_type is distinct from 'after_count' or occurrence_count is not null)
);
create index event_series_season_idx on public.event_series (season_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  series_id uuid references public.event_series (id) on delete set null,
  -- The local calendar date the series rule generated. With series_id it identifies
  -- the occurrence, so regenerating a series can never create a duplicate.
  occurrence_date date,
  name text,
  round_number integer check (round_number is null or round_number > 0),
  -- A well-defined instant plus the zone it was meant in. Viewers see it converted.
  starts_at timestamptz,                -- the race start
  lobby_opens_at timestamptz,           -- optional: when the lobby opens
  timezone text check (timezone is null or public.is_valid_timezone(timezone)),
  -- What the series rule produced. Differs from starts_at once the event is moved.
  original_starts_at timestamptz,
  is_override boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'completed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((starts_at is null) = (timezone is null)),
  constraint events_lobby_before_start check (lobby_opens_at is null or (starts_at is not null and lobby_opens_at <= starts_at))
);
create index events_season_idx on public.events (season_id);
create unique index events_series_occurrence_uq on public.events (series_id, occurrence_date)
  where series_id is not null;

-- ---------------------------------------------------------------------------
-- Tracks (imported from community data, unverified until an admin verifies them)
-- ---------------------------------------------------------------------------

create table public.track_venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  country text,
  created_at timestamptz not null default now()
);

create table public.track_layouts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.track_venues (id) on delete cascade,
  name text not null,
  length_km numeric not null check (length_km > 0),
  length_mi numeric generated always as (round(length_km / 1.609344, 3)) stored,
  is_reverse boolean not null,
  imported_ordinal integer unique,
  source text not null,
  verified boolean not null default false,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, name)
);

-- ---------------------------------------------------------------------------
-- Scoring (points are calculated by application code from these rules, never by AI)
-- ---------------------------------------------------------------------------

create table public.points_systems (
  id uuid primary key default gen_random_uuid(),
  -- Null for the reference library; set for a system a championship actually uses.
  championship_id uuid references public.championships (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- For library entries copied from a real series: which series, season/version, source.
  source_series text,
  source_version text,
  source_url text,
  copied_from uuid references public.points_systems (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.points_table_entries (
  points_system_id uuid not null references public.points_systems (id) on delete cascade,
  position integer not null check (position > 0),
  points numeric not null,
  primary key (points_system_id, position)
);

-- What each non-finishing status scores. A missing row means "not set", not zero.
create table public.points_status_rules (
  points_system_id uuid not null references public.points_systems (id) on delete cascade,
  status text not null check (status in ('dnf', 'dns', 'dsq', 'other')),
  points numeric not null,
  primary key (points_system_id, status)
);

create table public.points_bonuses (
  id uuid primary key default gen_random_uuid(),
  points_system_id uuid not null references public.points_systems (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('bonus', 'penalty')),
  points numeric not null,
  description text
);

-- ---------------------------------------------------------------------------
-- Cars (imported catalogue, kept separate from championship builds)
-- ---------------------------------------------------------------------------

create table public.cars (
  id uuid primary key default gen_random_uuid(),
  ordinal integer not null unique,
  make text not null,
  model text not null,
  year integer not null,
  nickname text,
  division text not null,               -- the official Forza division, as imported
  country text,
  pi integer not null check (pi > 0),
  speed numeric, braking numeric, handling numeric, acceleration numeric,
  power_kw numeric, power_ps numeric, power_hp numeric,
  mass_kg numeric, mass_lb numeric,
  torque_nm numeric, torque_ftlb numeric,
  drivetrain text check (drivetrain in ('RWD', 'AWD', 'FWD')),
  engine_position text, displacement_l numeric, engine_layout text,
  cylinders integer, induction text,
  model_type text, body text, topless boolean, steering_position text,
  source text not null,
  verified boolean not null default false,
  verified_at timestamptz,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cars_make_idx on public.cars (make);
create index cars_division_idx on public.cars (division);

-- Administrator-defined categories (NASCAR, GTX, vintage...). Separate from divisions.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0)
);
create table public.car_categories (
  car_id uuid not null references public.cars (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (car_id, category_id)
);

-- ---------------------------------------------------------------------------
-- Classes and eligibility
-- ---------------------------------------------------------------------------

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  sort_order integer,
  unique (championship_id, name)
);

-- A class is a set of rules, so "all NASCAR cars" needs one row, not one per car.
create table public.class_rules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  rule_type text not null check (rule_type in (
    'include_division', 'exclude_division',
    'include_category', 'exclude_category',
    'include_car', 'exclude_car')),
  division text,
  category_id uuid references public.categories (id) on delete cascade,
  car_id uuid references public.cars (id) on delete cascade,
  check (
    (rule_type in ('include_division', 'exclude_division') and division is not null and category_id is null and car_id is null) or
    (rule_type in ('include_category', 'exclude_category') and category_id is not null and division is null and car_id is null) or
    (rule_type in ('include_car', 'exclude_car') and car_id is not null and division is null and category_id is null)
  )
);
create index class_rules_class_idx on public.class_rules (class_id);

-- Precedence, most specific first:
--   1. exclude_car   -> not eligible
--   2. include_car   -> eligible
--   3. exclude_division / exclude_category match -> not eligible
--   4. include_division / include_category match -> eligible
--   5. otherwise not eligible
-- So "all GTX except two specific cars" and "only these two GTX cars" both work.

create or replace function public.class_is_public(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classes cl
    join public.championships ch on ch.id = cl.championship_id
    where cl.id = cid and ch.status = 'published' and ch.visibility = 'public')
$$;

create or replace function public.class_eligible_cars(p_class uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id
  from public.cars c
  where (public.is_admin() or public.class_is_public(p_class))
    and case
      when exists (select 1 from public.class_rules r
                   where r.class_id = p_class and r.rule_type = 'exclude_car' and r.car_id = c.id) then false
      when exists (select 1 from public.class_rules r
                   where r.class_id = p_class and r.rule_type = 'include_car' and r.car_id = c.id) then true
      when exists (select 1 from public.class_rules r
                   where r.class_id = p_class and r.rule_type = 'exclude_division' and r.division = c.division)
        or exists (select 1 from public.class_rules r
                   join public.car_categories cc on cc.category_id = r.category_id
                   where r.class_id = p_class and r.rule_type = 'exclude_category' and cc.car_id = c.id) then false
      else exists (select 1 from public.class_rules r
                   where r.class_id = p_class and r.rule_type = 'include_division' and r.division = c.division)
        or exists (select 1 from public.class_rules r
                   join public.car_categories cc on cc.category_id = r.category_id
                   where r.class_id = p_class and r.rule_type = 'include_category' and cc.car_id = c.id)
    end
$$;

-- ---------------------------------------------------------------------------
-- Races (individual sessions inside an event) and which classes run in each
-- ---------------------------------------------------------------------------

create table public.races (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text,
  sort_order integer not null,
  session_type text,                    -- free text, for example "Sprint" or "Feature"
  starts_at timestamptz,
  track_layout_id uuid references public.track_layouts (id) on delete restrict,
  laps integer check (laps is null or laps > 0),
  target_distance_km numeric check (target_distance_km is null or target_distance_km > 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  points_system_id uuid references public.points_systems (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index races_event_idx on public.races (event_id);

create table public.race_classes (
  race_id uuid not null references public.races (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  -- Optional class-specific scoring, overriding the race's points system.
  points_system_id uuid references public.points_systems (id) on delete set null,
  primary key (race_id, class_id)
);

-- ---------------------------------------------------------------------------
-- Build specifications (per championship, separate from the car catalogue)
-- ---------------------------------------------------------------------------

-- The list of upgrade fields. Starts with the in-game Upgrade Shop tabs and parts
-- (see the seed at the end of this file); the admin can add, rename or remove fields.
create table public.spec_fields (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  name text not null,
  sort_order integer not null,
  is_builtin boolean not null default false,
  unique (group_name, name)
);

create table public.build_specs (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  car_id uuid not null references public.cars (id) on delete restrict,
  class_id uuid references public.classes (id) on delete set null,
  name text,
  build_type text check (build_type in ('stock', 'custom', 'approved')),
  pi_limit integer check (pi_limit is null or pi_limit > 0),
  power_kw numeric, torque_nm numeric, weight_kg numeric,
  -- Independent of build_type: a custom build does not imply a tune policy.
  tune_policy text check (tune_policy in ('drivers_own', 'prescribed')),
  prescribed_tune text,                 -- free text: a share code or the values
  notes text,
  -- Wheels differ from the other parts: stock wheels, or an aftermarket wheel picked by
  -- category then style, which also opens a rim size.
  wheel_source text check (wheel_source in ('stock', 'aftermarket')),
  wheel_category text,                  -- as listed in the game, free text
  wheel_style text,
  rim_size text,                        -- only meaningful when wheel_source is aftermarket
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index build_specs_championship_idx on public.build_specs (championship_id);

-- One row per field the admin has actually set. No row means not set.
create table public.build_spec_values (
  build_spec_id uuid not null references public.build_specs (id) on delete cascade,
  field_id uuid not null references public.spec_fields (id) on delete restrict,
  rule text not null check (rule in ('allowed', 'prohibited', 'required', 'note')),
  -- Part tier. For 'allowed' it is the highest tier permitted; for 'required' it is
  -- the tier that must be fitted. Not every car offers every tier.
  tier text check (tier in ('stock', 'street', 'sport', 'race')),
  value text,
  primary key (build_spec_id, field_id)
);

-- Every part starts as Required, Stock tier (a stock car), as in the game's upgrade
-- shop, and the manager then changes the parts that may be upgraded. This is a
-- deliberate exception to "blank stays blank", requested by the league admin.
create or replace function public.default_build_values() returns trigger
language plpgsql as $$
begin
  update public.build_specs set wheel_source = 'stock' where id = new.id and wheel_source is null;
  insert into public.build_spec_values (build_spec_id, field_id, rule, tier)
  select new.id, f.id, 'required', 'stock' from public.spec_fields f
  on conflict do nothing;
  return new;
end $$;

create trigger build_specs_default_values
after insert on public.build_specs
for each row execute function public.default_build_values();

-- A part added later reaches existing build specs as stock too.
create or replace function public.default_field_values() returns trigger
language plpgsql as $$
begin
  insert into public.build_spec_values (build_spec_id, field_id, rule, tier)
  select b.id, new.id, 'required', 'stock' from public.build_specs b
  on conflict do nothing;
  return new;
end $$;

create trigger spec_fields_default_values
after insert on public.spec_fields
for each row execute function public.default_field_values();

-- ---------------------------------------------------------------------------
-- Drivers and results
-- ---------------------------------------------------------------------------

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) > 0),
  gamertag text,
  created_at timestamptz not null default now()
);

create table public.results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete restrict,
  class_id uuid references public.classes (id) on delete set null,
  car_id uuid references public.cars (id) on delete set null,
  build_spec_id uuid references public.build_specs (id) on delete set null,
  position integer check (position is null or position > 0),
  status text not null check (status in ('finished', 'dnf', 'dns', 'dsq', 'other')),
  laps_completed integer check (laps_completed is null or laps_completed >= 0),
  total_time_ms bigint check (total_time_ms is null or total_time_ms >= 0),
  adjustment_points numeric,
  adjustment_reason text,
  -- Written by the scoring code, which records which rules it used.
  points_awarded numeric,
  scored_with_system_id uuid references public.points_systems (id) on delete set null,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (race_id, driver_id)
);
create index results_race_idx on public.results (race_id);

-- Every change to a result is kept, so amendments can be reviewed.
create table public.results_audit (
  id bigint generated always as identity primary key,
  result_id uuid not null,
  action text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  before_row jsonb,
  after_row jsonb
);

create or replace function public.audit_results() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.results_audit (result_id, action, changed_by, before_row)
    values (old.id, 'delete', auth.uid(), to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.results_audit (result_id, action, changed_by, before_row, after_row)
    values (new.id, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.results_audit (result_id, action, changed_by, after_row)
    values (new.id, 'insert', auth.uid(), to_jsonb(new));
    return new;
  end if;
end $$;

create trigger results_audit_trg
after insert or update or delete on public.results
for each row execute function public.audit_results();

-- ---------------------------------------------------------------------------
-- Publishing guard
-- ---------------------------------------------------------------------------

create or replace function public.championship_missing(cid uuid, vis text, tz text) returns text[]
language plpgsql stable as $$
declare
  m text[] := '{}';
begin
  if vis is null then m := m || 'visibility'::text; end if;
  if tz is null then m := m || 'intended time zone'::text; end if;
  if not exists (select 1 from public.seasons where championship_id = cid) then
    m := m || 'at least one season'::text;
  end if;
  if exists (select 1 from public.seasons where championship_id = cid and (starts_on is null or ends_on is null)) then
    m := m || 'season start and end dates'::text;
  end if;
  if exists (select 1 from public.events e join public.seasons s on s.id = e.season_id
             where s.championship_id = cid and e.status <> 'cancelled' and e.starts_at is null) then
    m := m || 'a date and time for every event'::text;
  end if;
  return m;
end $$;
revoke all on function public.championship_missing(uuid, text, text) from public, anon, authenticated;

create or replace function public.guard_publish() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m text[];
begin
  if new.status = 'published' then
    m := public.championship_missing(new.id, new.visibility, new.intended_timezone);
    if coalesce(array_length(m, 1), 0) > 0 then
      raise exception 'Cannot publish: missing %', array_to_string(m, ', ') using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger championships_guard_publish
before insert or update on public.championships
for each row execute function public.guard_publish();

-- Lets the admin screen list what is still missing before pressing Publish.
create or replace function public.championship_missing_items(cid uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.championships;
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into c from public.championships where id = cid;
  if not found then
    return array['championship not found'];
  end if;
  return public.championship_missing(c.id, c.visibility, c.intended_timezone);
end $$;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['championships', 'seasons', 'event_series', 'events', 'track_layouts',
                           'points_systems', 'cars', 'races', 'build_specs', 'results']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Access rules (row level security)
-- ---------------------------------------------------------------------------

create or replace function public.championship_is_public(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.championships
                 where id = cid and status = 'published' and visibility = 'public')
$$;

create or replace function public.season_is_public(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.seasons s join public.championships c on c.id = s.championship_id
                 where s.id = sid and c.status = 'published' and c.visibility = 'public')
$$;

create or replace function public.event_is_public(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events e
                 join public.seasons s on s.id = e.season_id
                 join public.championships c on c.id = s.championship_id
                 where e.id = eid and c.status = 'published' and c.visibility = 'public')
$$;

create or replace function public.race_is_public(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.races r
                 join public.events e on e.id = r.event_id
                 join public.seasons s on s.id = e.season_id
                 join public.championships c on c.id = s.championship_id
                 where r.id = rid and c.status = 'published' and c.visibility = 'public')
$$;

create or replace function public.points_system_is_public(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.points_systems p
                 join public.championships c on c.id = p.championship_id
                 where p.id = pid and c.status = 'published' and c.visibility = 'public')
$$;

create or replace function public.build_spec_is_public(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.build_specs b
                 join public.championships c on c.id = b.championship_id
                 where b.id = bid and c.status = 'published' and c.visibility = 'public')
$$;

create or replace function public.driver_is_public(did uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.results r where r.driver_id = did and public.race_is_public(r.race_id))
$$;

do $$
declare t text;
begin
  foreach t in array array['admins', 'championships', 'seasons', 'event_series', 'events', 'track_venues',
    'track_layouts', 'points_systems', 'points_table_entries', 'points_status_rules', 'points_bonuses',
    'cars', 'categories', 'car_categories', 'classes', 'class_rules', 'races', 'race_classes',
    'spec_fields', 'build_specs', 'build_spec_values', 'drivers', 'results', 'results_audit']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Admins can do everything on every table except the admins list itself.
  foreach t in array array['championships', 'seasons', 'event_series', 'events', 'track_venues',
    'track_layouts', 'points_systems', 'points_table_entries', 'points_status_rules', 'points_bonuses',
    'cars', 'categories', 'car_categories', 'classes', 'class_rules', 'races', 'race_classes',
    'spec_fields', 'build_specs', 'build_spec_values', 'drivers', 'results', 'results_audit']
  loop
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_all', t);
  end loop;
end $$;

-- Public read access: published and public championships only.
create policy championships_public_read on public.championships for select to anon, authenticated
  using (status = 'published' and visibility = 'public');
create policy seasons_public_read on public.seasons for select to anon, authenticated
  using (public.championship_is_public(championship_id));
create policy events_public_read on public.events for select to anon, authenticated
  using (public.season_is_public(season_id));
create policy races_public_read on public.races for select to anon, authenticated
  using (public.event_is_public(event_id));
create policy race_classes_public_read on public.race_classes for select to anon, authenticated
  using (public.race_is_public(race_id));
create policy classes_public_read on public.classes for select to anon, authenticated
  using (public.championship_is_public(championship_id));
create policy points_systems_public_read on public.points_systems for select to anon, authenticated
  using (championship_id is not null and public.championship_is_public(championship_id));
create policy points_table_public_read on public.points_table_entries for select to anon, authenticated
  using (public.points_system_is_public(points_system_id));
create policy points_status_public_read on public.points_status_rules for select to anon, authenticated
  using (public.points_system_is_public(points_system_id));
create policy points_bonuses_public_read on public.points_bonuses for select to anon, authenticated
  using (public.points_system_is_public(points_system_id));
create policy spec_fields_public_read on public.spec_fields for select to anon, authenticated
  using (true);
create policy build_specs_public_read on public.build_specs for select to anon, authenticated
  using (public.championship_is_public(championship_id));
create policy build_spec_values_public_read on public.build_spec_values for select to anon, authenticated
  using (public.build_spec_is_public(build_spec_id));
create policy drivers_public_read on public.drivers for select to anon, authenticated
  using (public.driver_is_public(id));
create policy results_public_read on public.results for select to anon, authenticated
  using (public.race_is_public(race_id));

-- ---------------------------------------------------------------------------
-- Public views: only what a visitor needs, only for published public championships.
-- These run with the view owner's rights on purpose, so they can expose a few
-- columns of the admin-only car and track tables without opening the tables.
-- ---------------------------------------------------------------------------

create view public.public_class_cars as
select cl.id as class_id, cl.championship_id, c.id as car_id, c.year, c.make, c.model, c.nickname
from public.classes cl
join public.championships ch on ch.id = cl.championship_id
 and ch.status = 'published' and ch.visibility = 'public'
cross join lateral public.class_eligible_cars(cl.id) as e(car_id)
join public.cars c on c.id = e.car_id;

create view public.public_races as
select r.id as race_id, r.event_id, r.name, r.session_type, r.sort_order, r.starts_at,
       r.laps, r.target_distance_km, r.duration_minutes,
       v.name as venue, l.name as layout, l.length_km, l.length_mi, l.is_reverse, l.verified as length_verified
from public.races r
join public.events e on e.id = r.event_id
join public.seasons s on s.id = e.season_id
join public.championships ch on ch.id = s.championship_id
 and ch.status = 'published' and ch.visibility = 'public'
left join public.track_layouts l on l.id = r.track_layout_id
left join public.track_venues v on v.id = l.venue_id;

create view public.public_build_specs as
select b.id as build_spec_id, b.championship_id, b.class_id, b.name, b.build_type, b.pi_limit,
       b.power_kw, b.torque_nm, b.weight_kg, b.tune_policy, b.prescribed_tune, b.notes,
       b.wheel_source, b.wheel_category, b.wheel_style, b.rim_size,
       c.year, c.make, c.model, c.nickname
from public.build_specs b
join public.championships ch on ch.id = b.championship_id
 and ch.status = 'published' and ch.visibility = 'public'
join public.cars c on c.id = b.car_id;

grant select on public.public_class_cars, public.public_races, public.public_build_specs to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Starting set of build fields
-- Taken from screenshots of the in-game Upgrade Shop (Forza Motorsport 2023), using
-- the game's own tab and part names. Not every car offers every part. Editable.
-- ---------------------------------------------------------------------------

insert into public.spec_fields (group_name, name, sort_order, is_builtin) values
  ('Fuel and Air', 'Fuel System', 110, true),
  ('Fuel and Air', 'Ignition', 120, true),
  ('Fuel and Air', 'Exhaust', 130, true),
  ('Fuel and Air', 'Air Filter', 140, true),
  ('Fuel and Air', 'Intake Manifold and Throttle Body', 150, true),
  ('Engine', 'Camshaft', 210, true),
  ('Engine', 'Valves', 220, true),
  ('Engine', 'Displacement', 230, true),
  ('Engine', 'Pistons and Compression', 240, true),
  ('Engine', 'Flywheel', 250, true),
  ('Engine', 'Oil and Cooling', 260, true),
  ('Platform and Handling', 'Brakes', 310, true),
  ('Platform and Handling', 'Spring and Dampers', 320, true),
  ('Platform and Handling', 'Front Anti-roll Bars', 330, true),
  ('Platform and Handling', 'Rear Anti-roll Bars', 340, true),
  ('Platform and Handling', 'Weight Reduction', 350, true),
  ('Platform and Handling', 'Chassis Reinforcement and Roll Cage', 360, true),
  ('Platform and Handling', 'Ballast', 370, true),
  ('Tires', 'Tire Compound', 410, true),
  ('Tires', 'Front Tire Width', 420, true),
  ('Tires', 'Rear Tire Width', 430, true),
  ('Drivetrain', 'Clutch', 610, true),
  ('Drivetrain', 'Transmission', 620, true),
  ('Drivetrain', 'Driveline', 630, true),
  ('Drivetrain', 'Differential', 640, true),
  ('Aero and Appearance', 'Rear Wing', 710, true),
  ('Aero and Appearance', 'Front Bumper', 720, true),
  ('Aero and Appearance', 'Rear Bumper', 730, true),
  ('Aero and Appearance', 'Hood', 740, true),
  ('Conversion', 'Engine Swap', 810, true),
  ('Conversion', 'Drivetrain Swap', 820, true),
  ('Conversion', 'Aspiration Conversion', 830, true)
on conflict (group_name, name) do nothing;
