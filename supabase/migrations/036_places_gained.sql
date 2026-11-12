-- Places gained and lost (migration 036)
-- Each result can carry the places gained (positive) or lost (negative) that the results screen shows next to the position.
-- Blank means not recorded. A championship can switch tracking off (a hidden field with no admin screen); it is on by default.
-- The public league and championship pages now include it with each result. Standings are not changed.
-- Plain statements only (the Supabase SQL editor cannot run DO blocks).

alter table public.results add column if not exists places_gained integer;
alter table public.championships add column if not exists track_places boolean not null default true;
update public.championships set track_places = false where name = 'Friday GTX Stock Car Racing';

create or replace function public.public_league(lid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'league_id', l.id, 'can_edit', public.can_admin_league(l.id), 'is_public', l.page_published, 'league', l.name, 'palette', l.palette,
    'tagline', l.tagline, 'about', l.about, 'join_text', l.join_text, 'banner_url', l.banner_url, 'links', l.links,
    'championships', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.name)
      from public.championships c where c.league_id = l.id and c.page_published), '[]'::jsonb),
    'calendar', coalesce((
      select jsonb_agg(q.j order by q.sa) from (
        select e.starts_at as sa, jsonb_build_object(
          'round', e.round_number, 'name', e.name, 'status', e.status, 'starts_at', e.starts_at, 'lobby_opens_at', e.lobby_opens_at,
          'championship', c.name, 'championship_id', c.id,
          'track', case when t.id is null then null else jsonb_build_object('venue', v.name, 'layout', t.name, 'length_km', t.length_km) end,
          'races', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'type', r.session_type, 'laps', r.laps,
                       'distance_km', r.target_distance_km, 'minutes', r.duration_minutes) order by r.sort_order)
                     from public.races r where r.event_id = e.id), '[]'::jsonb)) as j
        from public.events e
        join public.seasons s on s.id = e.season_id
        join public.championships c on c.id = s.championship_id
        left join public.track_layouts t on t.id = e.track_layout_id
        left join public.track_venues v on v.id = t.venue_id
        where c.league_id = l.id and c.page_published and e.status <> 'cancelled' and e.starts_at >= now()
        order by e.starts_at limit 30) q), '[]'::jsonb),
    'latest', coalesce((
      select jsonb_agg(q.j order by q.cn) from (
        select c.name as cn, jsonb_build_object(
          'championship', c.name, 'championship_id', c.id, 'round', le.round_number, 'name', le.name, 'starts_at', le.starts_at,
          'track', case when t.id is null then null else jsonb_build_object('venue', v.name, 'layout', t.name) end,
          'races', coalesce((select jsonb_agg(jsonb_build_object('name', r.name,
                       'results', coalesce((select jsonb_agg(jsonb_build_object('driver', d.display_name, 'position', x.position, 'status', x.status,
                                  'points', x.points_awarded, 'fastest_lap', x.fastest_lap, 'best_lap_ms', x.best_lap_ms, 'places_gained', x.places_gained)
                                  order by x.position nulls last, d.display_name)
                                from public.results x join public.drivers d on d.id = x.driver_id where x.race_id = r.id), '[]'::jsonb))
                     order by r.sort_order)
                     from public.races r where r.event_id = le.id and exists (select 1 from public.results x where x.race_id = r.id)), '[]'::jsonb)) as j
        from public.championships c
        join lateral (
          select e.* from public.events e join public.seasons s on s.id = e.season_id
          where s.championship_id = c.id and exists (select 1 from public.races r join public.results x on x.race_id = r.id where r.event_id = e.id)
          order by e.starts_at desc nulls last, e.round_number desc nulls last limit 1) le on true
        left join public.track_layouts t on t.id = le.track_layout_id
        left join public.track_venues v on v.id = t.venue_id
        where c.league_id = l.id and c.page_published) q), '[]'::jsonb),
    'standings', coalesce((
      select jsonb_agg(q.j order by q.cn) from (
        select c.name as cn, jsonb_build_object('championship', c.name, 'championship_id', c.id, 'season', se.name,
          'rows', coalesce((
            select jsonb_agg(jsonb_build_object('driver', g.dn, 'points', g.pts, 'wins', g.w, 'podiums', g.p, 'fl', g.f, 'by_race', g.br)
                             order by g.pts desc, g.w desc, g.p desc, g.dn)
            from (select d.display_name as dn, coalesce(sum(x.points_awarded), 0) as pts,
                         count(*) filter (where x.position = 1 and x.status in ('finished', 'dnf')) as w,
                         count(*) filter (where x.position <= 3 and x.status in ('finished', 'dnf')) as p,
                         count(*) filter (where x.fastest_lap) as f,
                         (select jsonb_agg(jsonb_build_object('name', k.rn, 'points', k.p) order by k.so) from (
                            select r2.name as rn, min(r2.sort_order) as so, sum(x2.points_awarded) as p
                            from public.events e2 join public.races r2 on r2.event_id = e2.id join public.results x2 on x2.race_id = r2.id
                            where e2.season_id = se.id and x2.driver_id = d.id group by r2.name) k) as br
                  from public.events e join public.races r on r.event_id = e.id
                  join public.results x on x.race_id = r.id join public.drivers d on d.id = x.driver_id
                  where e.season_id = se.id group by d.id, d.display_name) g), '[]'::jsonb)) as j
        from public.championships c
        join lateral (
          select s.* from public.seasons s
          where s.championship_id = c.id and exists (select 1 from public.events e join public.races r on r.event_id = e.id
                                                     join public.results x on x.race_id = r.id where e.season_id = s.id)
          order by (select max(e.starts_at) from public.events e where e.season_id = s.id) desc nulls last, s.created_at desc limit 1) se on true
        where c.league_id = l.id and c.page_published) q), '[]'::jsonb),
    'next', (
      select jsonb_build_object('round', e.round_number, 'name', e.name, 'starts_at', e.starts_at,
               'championship', c.name, 'championship_id', c.id,
               'track', case when t.id is null then null else jsonb_build_object('venue', v.name, 'layout', t.name) end)
      from public.events e
      join public.seasons s on s.id = e.season_id
      join public.championships c on c.id = s.championship_id
      left join public.track_layouts t on t.id = e.track_layout_id
      left join public.track_venues v on v.id = t.venue_id
      where c.league_id = l.id and c.page_published and e.status <> 'cancelled' and e.starts_at >= now()
      order by e.starts_at limit 1))
  from public.leagues l where l.id = lid and (l.page_published or public.can_admin_league(l.id))
$$;
revoke all on function public.public_league(uuid) from public;
grant execute on function public.public_league(uuid) to anon, authenticated;

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
    'track_places', c.track_places,
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
                                  'points', x.points_awarded, 'fastest_lap', x.fastest_lap, 'best_lap_ms', x.best_lap_ms, 'places_gained', x.places_gained)
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
