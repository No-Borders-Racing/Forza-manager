-- The public league page also carries a snapshot of the whole league (migration 029):
-- upcoming rounds across its published championships, and each published championship's latest results.
create or replace function public.public_league(lid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'league_id', l.id, 'can_edit', public.can_admin_league(l.id), 'league', l.name, 'palette', l.palette,
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
  from public.leagues l where l.id = lid and l.page_published
$$;
revoke all on function public.public_league(uuid) from public;
grant execute on function public.public_league(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
