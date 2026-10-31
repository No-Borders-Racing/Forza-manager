-- Saved build sheets (a named build of a catalogue car, per league), shared favourites, and the car list of a championship.
-- Plain statements only (the Supabase SQL editor cannot run DO blocks).

create table if not exists public.build_sheets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  car_id uuid references public.cars (id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'draft' check (status in ('draft', 'completed')),
  class_letter text check (class_letter is null or class_letter ~ '^[A-Z]$'),
  pi integer check (pi is null or (pi >= 0 and pi <= 999)),
  data jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists build_sheets_league_name_uq on public.build_sheets (league_id, lower(name));
create index if not exists build_sheets_league_idx on public.build_sheets (league_id);
create index if not exists build_sheets_car_idx on public.build_sheets (car_id);

-- Shared favourites: one star list per league. A row stars a catalogue car or a saved build.
create table if not exists public.league_favourites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  car_id uuid references public.cars (id) on delete cascade,
  build_id uuid references public.build_sheets (id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check ((car_id is not null) <> (build_id is not null))
);
create unique index if not exists league_favourites_car_uq on public.league_favourites (league_id, car_id) where car_id is not null;
create unique index if not exists league_favourites_build_uq on public.league_favourites (league_id, build_id) where build_id is not null;

-- The cars a championship uses: a catalogue car is "stock unmodified", a saved build is "custom built".
create table if not exists public.championship_cars (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  car_id uuid references public.cars (id) on delete cascade,
  build_id uuid references public.build_sheets (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((car_id is not null) <> (build_id is not null))
);
create unique index if not exists championship_cars_car_uq on public.championship_cars (championship_id, car_id) where car_id is not null;
create unique index if not exists championship_cars_build_uq on public.championship_cars (championship_id, build_id) where build_id is not null;
create index if not exists championship_cars_champ_idx on public.championship_cars (championship_id);

-- Keep builds inside their own league.
create or replace function public.guard_build_league() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bl uuid; lid uuid;
begin
  if new.build_id is null then return new; end if;
  select league_id into bl from public.build_sheets where id = new.build_id;
  if tg_table_name = 'league_favourites' then lid := new.league_id;
  else select league_id into lid from public.championships where id = new.championship_id; end if;
  if bl is distinct from lid then raise exception 'That build belongs to another league'; end if;
  return new;
end $$;
drop trigger if exists league_favourites_guard on public.league_favourites;
create trigger league_favourites_guard before insert or update on public.league_favourites
for each row execute function public.guard_build_league();
drop trigger if exists championship_cars_guard on public.championship_cars;
create trigger championship_cars_guard before insert or update on public.championship_cars
for each row execute function public.guard_build_league();

create or replace function public.touch_build_sheet() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists build_sheets_touch on public.build_sheets;
create trigger build_sheets_touch before update on public.build_sheets
for each row execute function public.touch_build_sheet();

alter table public.build_sheets enable row level security;
alter table public.league_favourites enable row level security;
alter table public.championship_cars enable row level security;

drop policy if exists build_sheets_admin_all on public.build_sheets;
create policy build_sheets_admin_all on public.build_sheets for all to authenticated
  using (public.can_admin_league(league_id)) with check (public.can_admin_league(league_id));
drop policy if exists league_favourites_admin_all on public.league_favourites;
create policy league_favourites_admin_all on public.league_favourites for all to authenticated
  using (public.can_admin_league(league_id)) with check (public.can_admin_league(league_id));
drop policy if exists championship_cars_admin_all on public.championship_cars;
create policy championship_cars_admin_all on public.championship_cars for all to authenticated
  using (public.can_admin_champ(championship_id)) with check (public.can_admin_champ(championship_id));

grant select, insert, update, delete on public.build_sheets, public.league_favourites, public.championship_cars to authenticated;
