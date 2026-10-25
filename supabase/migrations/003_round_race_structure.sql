-- Restructures rounds and races. Run once in the Supabase SQL editor on a database created from an
-- earlier schema.sql. Safe to run twice. It: moves the track from the race to the round, adds the
-- bonus-round and double-points flags, puts the schedule pattern on the championship, adds the
-- championship's race template, and removes per-race classes (classes belong to the championship).
-- Any track already chosen on a race is lost; no race screen existed before this, so none are expected.

alter table public.championships
  add column if not exists schedule_every_weeks integer,
  add column if not exists lobby_local_time time,
  add column if not exists race_local_time time;
alter table public.championships drop constraint if exists championships_schedule_every_weeks_check;
alter table public.championships add constraint championships_schedule_every_weeks_check
  check (schedule_every_weeks is null or schedule_every_weeks between 1 and 4);

alter table public.events
  add column if not exists track_layout_id uuid references public.track_layouts (id) on delete restrict,
  add column if not exists is_bonus boolean not null default false;

drop view if exists public.public_races;
alter table public.races drop column if exists track_layout_id;
alter table public.races add column if not exists double_points boolean not null default false;
drop table if exists public.race_classes;

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
grant select on public.public_races to anon, authenticated;

create table if not exists public.race_templates (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  sort_order integer not null,
  name text not null check (length(btrim(name)) > 0),
  laps integer check (laps is null or laps > 0),
  points_system_id uuid references public.points_systems (id) on delete set null,
  unique (championship_id, sort_order)
);
alter table public.race_templates enable row level security;
drop policy if exists race_templates_admin_all on public.race_templates;
create policy race_templates_admin_all on public.race_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
