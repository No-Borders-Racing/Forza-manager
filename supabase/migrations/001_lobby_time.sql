-- Adds the optional lobby-open time. Run once in the Supabase SQL editor on a database that was
-- created from an earlier schema.sql. A fresh install from the current schema.sql already has this.
alter table public.event_series add column if not exists lobby_local_time time;
alter table public.events add column if not exists lobby_opens_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_lobby_before_start') then
    alter table public.events add constraint events_lobby_before_start
      check (lobby_opens_at is null or (starts_at is not null and lobby_opens_at <= starts_at));
  end if;
end $$;
