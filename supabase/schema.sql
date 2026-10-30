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
  -- The schedule pattern every season and round inherits. Blank until the admin sets it.
  schedule_every_weeks integer check (schedule_every_weeks is null or schedule_every_weeks between 1 and 4),
  lobby_local_time time,                -- optional: when the lobby opens, in intended_timezone
  race_local_time time,                 -- race start, in intended_timezone
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
  verified boolean not null default false,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, name)
);

-- A round (stored in events) is held at one track layout; its races share it.
alter table public.events
  add column track_layout_id uuid references public.track_layouts (id) on delete restrict,
  add column is_bonus boolean not null default false;

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
  model_type text, steering_position text,
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
  laps integer check (laps is null or laps > 0),
  target_distance_km numeric check (target_distance_km is null or target_distance_km > 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  points_system_id uuid references public.points_systems (id) on delete set null,
  -- Ticked by the admin when results are uploaded for this race. The scoring code doubles points.
  double_points boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index races_event_idx on public.races (event_id);

-- The races every new round starts with, set once on the championship. Existing rounds are not
-- rewritten when this changes. Classes belong to the championship, not to a race.
create table public.race_templates (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  sort_order integer not null,
  name text not null check (length(btrim(name)) > 0),
  laps integer check (laps is null or laps > 0),
  points_system_id uuid references public.points_systems (id) on delete set null,
  unique (championship_id, sort_order)
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
    'cars', 'categories', 'car_categories', 'classes', 'class_rules', 'races', 'race_templates',
    'spec_fields', 'build_specs', 'build_spec_values', 'drivers', 'results', 'results_audit']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Admins can do everything on every table except the admins list itself.
  foreach t in array array['championships', 'seasons', 'event_series', 'events', 'track_venues',
    'track_layouts', 'points_systems', 'points_table_entries', 'points_status_rules', 'points_bonuses',
    'cars', 'categories', 'car_categories', 'classes', 'class_rules', 'races', 'race_templates',
    'spec_fields', 'build_specs', 'build_spec_values', 'drivers', 'results', 'results_audit']
  loop
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_all', t);
  end loop;
end $$;

-- The championship's own points system (same as migrations/007_championship_points.sql).
alter table public.championships
  add column if not exists points_system_id uuid references public.points_systems (id) on delete set null;

-- League settings and admin management (same as migrations/006_league.sql).
create table if not exists public.league (
  id boolean primary key default true check (id),
  name text check (name is null or length(btrim(name)) > 0),
  timezone text check (timezone is null or public.is_valid_timezone(timezone)),
  updated_at timestamptz not null default now()
);
alter table public.league enable row level security;
drop policy if exists league_admin_all on public.league;
create policy league_admin_all on public.league for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.list_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select a.user_id, u.email::text, a.created_at
    from public.admins a join auth.users u on u.id = a.user_id order by a.created_at;
end $$;

create or replace function public.add_admin(admin_email text)
returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(admin_email));
  if uid is null then
    raise exception 'No login with that email. Create it in Supabase under Authentication > Users first, then add it here.';
  end if;
  insert into public.admins (user_id) values (uid) on conflict do nothing;
end $$;

create or replace function public.remove_admin(uid uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if uid = auth.uid() then raise exception 'You cannot remove yourself.'; end if;
  delete from public.admins where user_id = uid;
end $$;

revoke all on function public.list_admins() from public, anon;
revoke all on function public.add_admin(text) from public, anon;
revoke all on function public.remove_admin(uuid) from public, anon;
grant execute on function public.list_admins() to authenticated;
grant execute on function public.add_admin(text) to authenticated;
grant execute on function public.remove_admin(uuid) to authenticated;

-- Public read access: published and public championships only.
create policy championships_public_read on public.championships for select to anon, authenticated
  using (status = 'published' and visibility = 'public');
create policy seasons_public_read on public.seasons for select to anon, authenticated
  using (public.championship_is_public(championship_id));
create policy events_public_read on public.events for select to anon, authenticated
  using (public.season_is_public(season_id));
create policy races_public_read on public.races for select to anon, authenticated
  using (public.event_is_public(event_id));
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
       r.double_points, e.is_bonus, r.laps, r.target_distance_km, r.duration_minutes,
       v.name as venue, l.name as layout, l.length_km, l.length_mi, l.is_reverse, l.verified as length_verified
from public.races r
join public.events e on e.id = r.event_id
join public.seasons s on s.id = e.season_id
join public.championships ch on ch.id = s.championship_id
 and ch.status = 'published' and ch.visibility = 'public'
left join public.track_layouts l on l.id = e.track_layout_id
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

-- ---------------------------------------------------------------------------
-- Separate leagues (same as migrations/008_leagues.sql)
-- ---------------------------------------------------------------------------
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
  using ((championship_id is not null and public.can_admin_champ(championship_id))
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

-- Points copy time (same as migrations/009_points_copied_at.sql)
-- When a points system was last copied from its source (a league's saved system or the master list).
-- Lets a championship show "the league's version has changed since you copied it".
alter table public.points_systems add column if not exists copied_at timestamptz;
update public.points_systems set copied_at = created_at where copied_from is not null and copied_at is null;

-- Results fields (same as migrations/010_results_fields.sql)
-- What the game's results screen shows, plus the DNF ranking switch and driver nicknames.
alter table public.points_systems add column if not exists dnf_rank_by_best_lap boolean not null default false;
alter table public.results add column if not exists best_lap_ms integer check (best_lap_ms is null or best_lap_ms > 0);
alter table public.results add column if not exists race_time_ms bigint check (race_time_ms is null or race_time_ms >= 0);
alter table public.results add column if not exists penalty_ms integer check (penalty_ms is null or penalty_ms >= 0);
alter table public.results add column if not exists fastest_lap boolean not null default false;
alter table public.drivers add column if not exists aliases text[] not null default '{}';
create unique index if not exists drivers_league_name_uq on public.drivers (league_id, lower(display_name));

-- Reference lap for timed races (migration 011)
alter table public.events add column if not exists reference_lap_ms integer check (reference_lap_ms is null or reference_lap_ms > 0);

-- Championship rules (migration 013)
alter table public.championships add column if not exists rules text;
