-- A round can carry a reference lap time, used to turn a race length in minutes into laps.
alter table public.events add column if not exists reference_lap_ms integer check (reference_lap_ms is null or reference_lap_ms > 0);
