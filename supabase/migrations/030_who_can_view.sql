-- Who can view: Public or Admin only (migration 030)
-- Everything starts Public. "Admin only" hides a page from visitors; signed-in league admins can still open it to preview.
-- A build is only public once it is marked complete. The league page also carries each championship's current standings.
alter table public.championships alter column page_published set default true;
alter table public.seasons alter column calendar_published set default true;
alter table public.build_sheets alter column published set default true;
update public.championships set page_published = true;
update public.seasons set calendar_published = true;
update public.build_sheets set published = true;

create or replace function public.public_calendar(sid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'season_id', s.id,
    'championship_id', c.id,
    'league_id', l.id,
    'can_edit', public.can_admin_league(l.id),
    'is_public', s.calendar_published,
    'league', l.name,
    'palette', l.palette,
    'championship', c.name,
    'season', s.name,
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round', e.round_number,
        'name', e.name,
        'status', e.status,
        'bonus', e.is_bonus,
        'starts_at', e.starts_at,
        'lobby_opens_at', e.lobby_opens_at,
        'notes', e.notes,
        'track', case when t.id is null then null else jsonb_build_object('venue', v.name, 'layout', t.name, 'length_km', t.length_km) end,
        'races', coalesce((
          select jsonb_agg(jsonb_build_object('name', r.name, 'type', r.session_type, 'laps', r.laps,
                                              'distance_km', r.target_distance_km, 'minutes', r.duration_minutes)
                           order by r.sort_order)
          from public.races r where r.event_id = e.id), '[]'::jsonb)
      ) order by e.starts_at nulls last, e.round_number nulls last)
      from public.events e
      left join public.track_layouts t on t.id = e.track_layout_id
      left join public.track_venues v on v.id = t.venue_id
      where e.season_id = s.id), '[]'::jsonb))
  from public.seasons s
  join public.championships c on c.id = s.championship_id
  join public.leagues l on l.id = c.league_id
  where s.id = sid and (s.calendar_published or public.can_admin_league(l.id))
$$;
revoke all on function public.public_calendar(uuid) from public;
grant execute on function public.public_calendar(uuid) to anon, authenticated;

create or replace function public.public_build(bid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('league_id', l.id, 'can_edit', public.can_admin_league(l.id), 'is_public', (b.published and b.status = 'completed'), 'name', b.name, 'league', l.name, 'palette', l.palette, 'data', b.data)
  from public.build_sheets b
  join public.leagues l on l.id = b.league_id
  where b.id = bid and ((b.published and b.status = 'completed') or public.can_admin_league(b.league_id))
$$;
revoke all on function public.public_build(uuid) from public;
grant execute on function public.public_build(uuid) to anon, authenticated;

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
                                  'points', x.points_awarded, 'fastest_lap', x.fastest_lap, 'best_lap_ms', x.best_lap_ms)
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
            select jsonb_agg(jsonb_build_object('driver', g.dn, 'points', g.pts, 'wins', g.w, 'podiums', g.p, 'fl', g.f)
                             order by g.pts desc, g.w desc, g.p desc, g.dn)
            from (select d.display_name as dn, coalesce(sum(x.points_awarded), 0) as pts,
                         count(*) filter (where x.position = 1 and x.status in ('finished', 'dnf')) as w,
                         count(*) filter (where x.position <= 3 and x.status in ('finished', 'dnf')) as p,
                         count(*) filter (where x.fastest_lap) as f
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
notify pgrst, 'reload schema';
