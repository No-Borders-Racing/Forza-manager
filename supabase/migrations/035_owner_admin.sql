-- Owner Admin page (migration 035)
-- Two read-only functions for the site owner: a table of counts per league, and database size and row counts.
-- Only counts are returned. No names, emails or sign-in details. Anyone who is not a site owner is refused.
-- Plain statements only (the Supabase SQL editor cannot run DO blocks).

create or replace function public.owner_site_overview()
returns table (league_id uuid, name text, admins bigint, championships bigint, drivers bigint, results bigint, last_activity timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Owners only'; end if;
  return query
  select l.id, l.name,
    (select count(*) from public.league_admins a where a.league_id = l.id),
    (select count(*) from public.championships c where c.league_id = l.id),
    (select count(*) from public.drivers d where d.league_id = l.id),
    (select count(*) from public.results x
       join public.races r on r.id = x.race_id
       join public.events e on e.id = r.event_id
       join public.seasons s on s.id = e.season_id
       join public.championships c on c.id = s.championship_id
      where c.league_id = l.id),
    greatest(
      (select max(c.updated_at) from public.championships c where c.league_id = l.id),
      (select max(d.created_at) from public.drivers d where d.league_id = l.id),
      (select max(x.updated_at) from public.results x
         join public.races r on r.id = x.race_id
         join public.events e on e.id = r.event_id
         join public.seasons s on s.id = e.season_id
         join public.championships c on c.id = s.championship_id
        where c.league_id = l.id),
      (select max(e.updated_at) from public.events e
         join public.seasons s on s.id = e.season_id
         join public.championships c on c.id = s.championship_id
        where c.league_id = l.id),
      l.created_at)
  from public.leagues l
  order by l.name;
end $$;

create or replace function public.owner_db_stats()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Owners only'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'limit_bytes', 524288000,
    'leagues', (select count(*) from public.leagues),
    'championships', (select count(*) from public.championships),
    'rounds', (select count(*) from public.events),
    'drivers', (select count(*) from public.drivers),
    'results', (select count(*) from public.results),
    'cars', (select count(*) from public.cars));
end $$;

revoke all on function public.owner_site_overview() from public, anon;
revoke all on function public.owner_db_stats() from public, anon;
grant execute on function public.owner_site_overview() to authenticated;
grant execute on function public.owner_db_stats() to authenticated;
notify pgrst, 'reload schema';
