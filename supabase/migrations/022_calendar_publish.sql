-- Publishing a season's calendar makes just the calendar public: one function hands the public page
-- exactly the names, dates, tracks, race lengths and notes, and nothing else.
alter table public.seasons add column if not exists calendar_published boolean not null default false;

create or replace function public.public_calendar(sid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
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
  where s.id = sid and s.calendar_published
$$;
revoke all on function public.public_calendar(uuid) from public;
grant execute on function public.public_calendar(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
