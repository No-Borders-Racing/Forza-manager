-- What the game's results screen shows, plus the DNF ranking switch and driver nicknames.
alter table public.points_systems add column if not exists dnf_rank_by_best_lap boolean not null default false;
alter table public.results add column if not exists best_lap_ms integer check (best_lap_ms is null or best_lap_ms > 0);
alter table public.results add column if not exists race_time_ms bigint check (race_time_ms is null or race_time_ms >= 0);
alter table public.results add column if not exists penalty_ms integer check (penalty_ms is null or penalty_ms >= 0);
alter table public.results add column if not exists fastest_lap boolean not null default false;
alter table public.drivers add column if not exists aliases text[] not null default '{}';
create unique index if not exists drivers_league_name_uq on public.drivers (league_id, lower(display_name));
