-- Divisions (migration 034)
-- A division is a group of cars with rules every car must follow: a PI limit, a minimum weight, other rules, and a level for each part
-- (Stock, Street, Sport or Race; a part left out is open). A championship can use a division like a car or a build.
-- Plain statements only (the Supabase SQL editor cannot run DO blocks).

create table if not exists public.divisions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  pi_limit text check (pi_limit is null or length(btrim(pi_limit)) > 0),
  min_weight_lb integer check (min_weight_lb is null or min_weight_lb > 0),
  other_rules text,
  parts jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists divisions_league_name_uq on public.divisions (league_id, lower(name));
create index if not exists divisions_league_idx on public.divisions (league_id);

create table if not exists public.division_cars (
  division_id uuid not null references public.divisions (id) on delete cascade,
  car_id uuid not null references public.cars (id) on delete cascade,
  primary key (division_id, car_id)
);
create index if not exists division_cars_car_idx on public.division_cars (car_id);

create or replace function public.touch_division() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists divisions_touch on public.divisions;
create trigger divisions_touch before update on public.divisions
for each row execute function public.touch_division();

alter table public.divisions enable row level security;
alter table public.division_cars enable row level security;
drop policy if exists divisions_admin_all on public.divisions;
create policy divisions_admin_all on public.divisions for all to authenticated
  using (public.can_admin_league(league_id)) with check (public.can_admin_league(league_id));
drop policy if exists division_cars_admin_all on public.division_cars;
create policy division_cars_admin_all on public.division_cars for all to authenticated
  using (exists (select 1 from public.divisions d where d.id = division_id and public.can_admin_league(d.league_id)))
  with check (exists (select 1 from public.divisions d where d.id = division_id and public.can_admin_league(d.league_id)));
grant select, insert, update, delete on public.divisions, public.division_cars to authenticated;

-- A championship's car list can now hold a division too: each row is a car, a build or a division.
alter table public.championship_cars add column if not exists division_id uuid references public.divisions (id) on delete cascade;
alter table public.championship_cars drop constraint if exists championship_cars_check;
alter table public.championship_cars drop constraint if exists championship_cars_one_kind;
alter table public.championship_cars add constraint championship_cars_one_kind
  check ((car_id is not null)::int + (build_id is not null)::int + (division_id is not null)::int = 1);
create unique index if not exists championship_cars_division_uq on public.championship_cars (championship_id, division_id) where division_id is not null;

-- Keep builds and divisions inside their own league.
create or replace function public.guard_build_league() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bl uuid; lid uuid;
begin
  if tg_table_name = 'championship_cars' then
    if new.division_id is not null then
      select league_id into bl from public.divisions where id = new.division_id;
      select league_id into lid from public.championships where id = new.championship_id;
      if bl is distinct from lid then raise exception 'That division belongs to another league'; end if;
    end if;
  end if;
  if new.build_id is null then return new; end if;
  select league_id into bl from public.build_sheets where id = new.build_id;
  if tg_table_name = 'league_favourites' then lid := new.league_id;
  else select league_id into lid from public.championships where id = new.championship_id; end if;
  if bl is distinct from lid then raise exception 'That build belongs to another league'; end if;
  return new;
end $$;

-- The public championship page also carries each division it uses: its rules and its cars, by name.
create or replace function public.public_championship(cid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'championship_id', c.id,
    'league_id', l.id,
    'league_published', l.page_published,
    'is_public', c.page_published,
    'can_edit', public.can_admin_league(l.id),
    'league', l.name,
    'palette', l.palette,
    'championship', c.name,
    'description', c.description,
    'rules', c.rules,
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object('id', dv.id, 'name', dv.name, 'pi_limit', dv.pi_limit, 'min_weight_lb', dv.min_weight_lb,
               'other_rules', dv.other_rules, 'parts', dv.parts,
               'cars', coalesce((select jsonb_agg(k.year || ' ' || k.make || ' ' || k.model order by k.make, k.model, k.year)
                                 from public.division_cars dc join public.cars k on k.id = dc.car_id where dc.division_id = dv.id), '[]'::jsonb))
               order by dv.name)
      from public.divisions dv
      where dv.league_id = l.id
        and exists (select 1 from public.championship_cars cc where cc.championship_id = c.id and cc.division_id = dv.id)
    ), '[]'::jsonb),
    'builds', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'car',
               case when k.id is null then null else k.year || ' ' || k.make || ' ' || k.model end,
               'class', b.class_letter, 'pi', b.pi) order by b.name)
      from public.build_sheets b
      left join public.cars k on k.id = b.car_id
      where b.published and b.status = 'completed' and b.league_id = l.id and (
        exists (select 1 from public.championship_cars cc where cc.championship_id = c.id and cc.build_id = b.id)
        or exists (select 1 from public.championship_cars cc where cc.championship_id = c.id and cc.car_id = b.car_id))
    ), '[]'::jsonb),
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on,
        'rounds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'round', e.round_number, 'name', e.name, 'status', e.status,
            'starts_at', e.starts_at, 'lobby_opens_at', e.lobby_opens_at, 'notes', e.notes,
            'track', case when t.id is null then null else jsonb_build_object('venue', v.name, 'layout', t.name, 'length_km', t.length_km) end,
            'races', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'type', r.session_type, 'laps', r.laps,
                       'distance_km', r.target_distance_km, 'minutes', r.duration_minutes,
                       'results', coalesce((
                         select jsonb_agg(jsonb_build_object('driver', d.display_name, 'position', x.position, 'status', x.status,
                                  'points', x.points_awarded, 'fastest_lap', x.fastest_lap, 'best_lap_ms', x.best_lap_ms)
                                  order by x.position nulls last, d.display_name)
                         from public.results x join public.drivers d on d.id = x.driver_id where x.race_id = r.id), '[]'::jsonb)
                     ) order by r.sort_order)
              from public.races r where r.event_id = e.id), '[]'::jsonb)
          ) order by e.starts_at nulls last, e.round_number nulls last)
          from public.events e
          left join public.track_layouts t on t.id = e.track_layout_id
          left join public.track_venues v on v.id = t.venue_id
          where e.season_id = s.id), '[]'::jsonb)
      ) order by s.starts_on nulls last, s.created_at)
      from public.seasons s where s.championship_id = c.id), '[]'::jsonb))
  from public.championships c
  join public.leagues l on l.id = c.league_id
  where c.id = cid and (c.page_published or public.can_admin_league(l.id))
$$;
revoke all on function public.public_championship(uuid) from public;
grant execute on function public.public_championship(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
