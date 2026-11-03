-- League profile and a public league page that is on by default (migration 028)
-- The league page lists only published championships, so making it public by default shows nothing
-- beyond the league's name and profile until a championship is published.
alter table public.leagues alter column page_published set default true;
update public.leagues set page_published = true;
alter table public.leagues add column if not exists tagline text;
alter table public.leagues add column if not exists about text;
alter table public.leagues add column if not exists join_text text;
alter table public.leagues add column if not exists banner_url text;
alter table public.leagues add column if not exists links jsonb not null default '{}'::jsonb;

create or replace function public.public_league(lid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'league_id', l.id, 'can_edit', public.can_admin_league(l.id), 'league', l.name, 'palette', l.palette,
    'tagline', l.tagline, 'about', l.about, 'join_text', l.join_text, 'banner_url', l.banner_url, 'links', l.links,
    'championships', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.name)
      from public.championships c where c.league_id = l.id and c.page_published), '[]'::jsonb),
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
