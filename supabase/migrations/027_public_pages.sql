-- Public championship and league pages (migration 027)
-- Publishing a championship page makes its published builds, calendars, results and standings public.
-- Publishing a league page makes a list of its published championships public. Anon cannot read the
-- tables; two functions hand the page exactly what it shows, and only when published.
alter table public.championships add column if not exists page_published boolean not null default false;
alter table public.leagues add column if not exists page_published boolean not null default false;

create or replace function public.public_championship(cid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'championship_id', c.id,
    'league_id', l.id,
    'league_published', l.page_published,
    'can_edit', public.can_admin_league(l.id),
    'league', l.name,
    'palette', l.palette,
    'championship', c.name,
    'description', c.description,
    'rules', c.rules,
    'builds', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'car',
               case when k.id is null then null else k.year || ' ' || k.make || ' ' || k.model end,
               'class', b.class_letter, 'pi', b.pi) order by b.name)
      from public.build_sheets b
      left join public.cars k on k.id = b.car_id
      where b.published and b.league_id = l.id and (
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
  where c.id = cid and c.page_published
$$;
revoke all on function public.public_championship(uuid) from public;
grant execute on function public.public_championship(uuid) to anon, authenticated;

create or replace function public.public_league(lid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'league_id', l.id, 'can_edit', public.can_admin_league(l.id), 'league', l.name, 'palette', l.palette,
    'championships', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.name)
      from public.championships c where c.league_id = l.id and c.page_published), '[]'::jsonb))
  from public.leagues l where l.id = lid and l.page_published
$$;
revoke all on function public.public_league(uuid) from public;
grant execute on function public.public_league(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
