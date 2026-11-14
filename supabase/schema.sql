-- Forza Championship Manager: database schema (Supabase / PostgreSQL 15+)
--
-- This file is the complete, current structure of the database, for a NEW project.
-- An existing project does not need it: apply the files in supabase/migrations/ instead.
--
-- HOW TO RUN
--   1. Supabase dashboard > SQL Editor > paste this whole file > Run.
--   2. Create your admin account in Authentication > Users, then run:
--        insert into public.admins (user_id)
--        select id from auth.users where email = 'YOUR-ADMIN-EMAIL';
--      The people in public.admins are the site owners. Everyone else is a league admin
--      (public.league_admins) and can only manage their own league.
--   3. Optional: run supabase/points_library.sql for ready-made points tables.
--
-- RULES THIS SCHEMA ENFORCES
--   * No implicit defaults: championship settings start blank. The only defaults are
--     system states (scheduled, unverified), never rules, scoring, cars or schedules.
--   * Anonymous visitors cannot read any table. Public pages call the public_*
--     functions, which return a page's content only when it is set to Public.
--   * The imported car and track tables are admin only.
--   * Build sheets are always public by link.

set check_function_bodies = false;


-- ---------------------------------------------------------------------------
-- FUNCTIONS
-- ---------------------------------------------------------------------------

-- Trigger functions

CREATE OR REPLACE FUNCTION public.audit_results() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare lid uuid;
begin
  select c.league_id into lid
  from public.races r
  join public.events e on e.id = r.event_id
  join public.seasons s on s.id = e.season_id
  join public.championships c on c.id = s.championship_id
  where r.id = coalesce(new.race_id, old.race_id);
  if tg_op = 'DELETE' then
    insert into public.results_audit (result_id, action, changed_by, before_row, league_id)
    values (old.id, 'delete', auth.uid(), to_jsonb(old), lid);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.results_audit (result_id, action, changed_by, before_row, after_row, league_id)
    values (new.id, 'update', auth.uid(), to_jsonb(old), to_jsonb(new), lid);
    return new;
  else
    insert into public.results_audit (result_id, action, changed_by, after_row, league_id)
    values (new.id, 'insert', auth.uid(), to_jsonb(new), lid);
    return new;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.build_sheets_always_public() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.status := 'completed';
  new.published := true;
  return new;
end
$$;

CREATE OR REPLACE FUNCTION public.default_dnf_rule() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  insert into public.points_status_rules (points_system_id, status, points)
  values (new.id, 'dnf', 0) on conflict do nothing;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.guard_build_league() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION public.guard_points_league() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare lid uuid;
begin
  if tg_table_name = 'championships' then
    lid := new.league_id;
    if tg_op = 'UPDATE' and new.league_id <> old.league_id then
      raise exception 'A championship cannot move to another league';
    end if;
    if not public.points_system_fits(new.points_system_id, lid, null) then
      raise exception 'That points system belongs to another league';
    end if;
  elsif tg_table_name = 'races' then
    if not public.points_system_fits(new.points_system_id, public.event_league(new.event_id), null) then
      raise exception 'That points system belongs to another league';
    end if;
  else
    if not public.points_system_fits(new.points_system_id, public.champ_league(new.championship_id), null) then
      raise exception 'That points system belongs to another league';
    end if;
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.guard_result_league() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare lid uuid;
begin
  lid := public.race_league(new.race_id);
  if lid is null then
    return new;
  end if;
  if not exists (select 1 from public.drivers where id = new.driver_id and league_id = lid) then
    raise exception 'That driver belongs to another league';
  end if;
  if not public.points_system_fits(new.scored_with_system_id, lid, null) then
    raise exception 'That points system belongs to another league';
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.touch_build_sheet() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin new.updated_at := now(); return new; end $$;

CREATE OR REPLACE FUNCTION public.touch_division() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin new.updated_at := now(); return new; end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

-- Permission helpers (follow the chain up to the league)

CREATE OR REPLACE FUNCTION public.can_admin_champ(cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.championships c
                 join public.league_admins la on la.league_id = c.league_id and la.user_id = auth.uid()
                 where c.id = cid)
$$;

CREATE OR REPLACE FUNCTION public.can_admin_event(eid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.events e where e.id = eid and public.can_admin_season(e.season_id))
$$;

CREATE OR REPLACE FUNCTION public.can_admin_league(lid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.league_admins where league_id = lid and user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_admin_points_system(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.points_systems p where p.id = pid and (
    (p.championship_id is not null and public.can_admin_champ(p.championship_id))
    or (p.championship_id is null and p.league_id is not null and public.can_admin_league(p.league_id))
    or (p.championship_id is null and p.league_id is null and public.is_owner())))
$$;

CREATE OR REPLACE FUNCTION public.can_admin_race(rid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.races r where r.id = rid and public.can_admin_event(r.event_id))
$$;

CREATE OR REPLACE FUNCTION public.can_admin_season(sid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.seasons s where s.id = sid and public.can_admin_champ(s.championship_id))
$$;

CREATE OR REPLACE FUNCTION public.can_read_points_system(pid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.can_admin_points_system(pid)
      or exists (select 1 from public.points_systems p where p.id = pid and p.championship_id is null and p.league_id is null and public.is_admin())
$$;

CREATE OR REPLACE FUNCTION public.champ_league(cid uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select league_id from public.championships where id = cid
$$;

CREATE OR REPLACE FUNCTION public.event_league(eid uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select c.league_id from public.events e
    join public.seasons s on s.id = e.season_id
    join public.championships c on c.id = s.championship_id
  where e.id = eid
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.admins where user_id = auth.uid())
      or exists (select 1 from public.league_admins where user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog'
    AS $$
  select tz is not null and exists (select 1 from pg_timezone_names where name = tz)
$$;

CREATE OR REPLACE FUNCTION public.points_system_fits(pid uuid, lid uuid, cid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select pid is null or exists (
    select 1 from public.points_systems p where p.id = pid and (
      (p.championship_id is null and p.league_id is null)
      or (p.championship_id is null and p.league_id = lid)
      or (p.championship_id is not null and public.champ_league(p.championship_id) = lid)))
$$;

CREATE OR REPLACE FUNCTION public.race_league(rid uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select c.league_id from public.races r
    join public.events e on e.id = r.event_id
    join public.seasons s on s.id = e.season_id
    join public.championships c on c.id = s.championship_id
  where r.id = rid
$$;

-- Admin and owner tools

CREATE OR REPLACE FUNCTION public.add_league_admin(lid uuid, admin_email text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare uid uuid;
begin
  if not public.can_admin_league(lid) then raise exception 'Admins only'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(admin_email));
  if uid is null then
    raise exception 'No login with that email. Create it in Supabase under Authentication > Users first, then add it here.';
  end if;
  insert into public.league_admins (league_id, user_id) values (lid, uid) on conflict do nothing;
end $$;

REVOKE ALL ON FUNCTION public.add_league_admin(lid uuid, admin_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_league_admin(lid uuid, admin_email text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_league(league_name text, league_slug text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare lid uuid; s text;
begin
  if not public.is_owner() then raise exception 'Only a site owner can create a league'; end if;
  if length(btrim(coalesce(league_name, ''))) = 0 then raise exception 'Give the league a name'; end if;
  s := coalesce(nullif(btrim(lower(regexp_replace(coalesce(league_slug, league_name), '[^A-Za-z0-9]+', '-', 'g')), '-'), ''), 'league');
  if exists (select 1 from public.leagues where slug = s) then raise exception 'The address "%" is already used by another league', s; end if;
  insert into public.leagues (name, slug) values (btrim(league_name), s) returning id into lid;
  insert into public.league_admins (league_id, user_id) values (lid, auth.uid());
  return lid;
end $$;

REVOKE ALL ON FUNCTION public.create_league(league_name text, league_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_league(league_name text, league_slug text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_league_for(league_name text, league_slug text, admin_email text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare lid uuid; uid uuid; s text;
begin
  if not public.is_owner() then raise exception 'Only a site owner can create a league'; end if;
  if length(btrim(coalesce(league_name, ''))) = 0 then raise exception 'Give the league a name'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(admin_email));
  if uid is null then raise exception 'No login with that email.'; end if;
  s := coalesce(nullif(btrim(lower(regexp_replace(coalesce(league_slug, league_name), '[^A-Za-z0-9]+', '-', 'g')), '-'), ''), 'league');
  if exists (select 1 from public.leagues where slug = s) then
    s := s || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5);
  end if;
  insert into public.leagues (name, slug) values (btrim(league_name), s) returning id into lid;
  insert into public.league_admins (league_id, user_id) values (lid, uid) on conflict do nothing;
  insert into public.league_admins (league_id, user_id) values (lid, auth.uid()) on conflict do nothing;
  return lid;
end $$;

REVOKE ALL ON FUNCTION public.create_league_for(league_name text, league_slug text, admin_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_league_for(league_name text, league_slug text, admin_email text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_league(lid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_owner() then raise exception 'Only a site owner can delete a league'; end if;
  if not exists (select 1 from public.leagues where id = lid) then raise exception 'That league does not exist'; end if;
  delete from public.championships where league_id = lid;
  delete from public.leagues where id = lid;
end $$;

REVOKE ALL ON FUNCTION public.delete_league(lid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_league(lid uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_drivers(keep_id uuid, drop_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  k record; d record; n int; clash int; al text[]; where_ text;
begin
  select * into k from public.drivers where id = keep_id;
  select * into d from public.drivers where id = drop_id;
  if k.id is null or d.id is null then raise exception 'Driver not found'; end if;
  if k.id = d.id then raise exception 'Choose two different drivers'; end if;
  if k.league_id <> d.league_id then raise exception 'Both drivers must be in the same league'; end if;
  if not public.can_admin_league(k.league_id) then raise exception 'Admins only'; end if;

  select count(*), string_agg(distinct coalesce(e.name, 'Round ' || e.round_number) || ' ' || r.name, ', ')
    into clash, where_
    from public.results a
    join public.results b on a.race_id = b.race_id
    join public.races r on r.id = a.race_id
    join public.events e on e.id = r.event_id
   where a.driver_id = keep_id and b.driver_id = drop_id;
  if clash > 0 then
    raise exception '% and % both have a result in the same race (%). Open that race, remove one of the two rows, then merge.', k.display_name, d.display_name, where_;
  end if;

  update public.results set driver_id = keep_id where driver_id = drop_id;
  get diagnostics n = row_count;

  select coalesce(array_agg(a order by a), '{}') into al from (
    select distinct on (lower(t.a)) t.a as a
    from unnest(coalesce(k.aliases, '{}') || coalesce(d.aliases, '{}') || array[d.display_name]) as t(a)
    where lower(t.a) <> lower(k.display_name)
    order by lower(t.a), t.a
  ) s;
  update public.drivers set aliases = al where id = keep_id;
  delete from public.drivers where id = drop_id;

  return jsonb_build_object('moved', n, 'kept', k.display_name, 'merged', d.display_name);
end $$;

REVOKE ALL ON FUNCTION public.merge_drivers(keep_id uuid, drop_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_drivers(keep_id uuid, drop_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_login(uid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_owner() then raise exception 'Only a site owner can delete a login'; end if;
  if uid = auth.uid() then raise exception 'You cannot delete your own login.'; end if;
  if exists (select 1 from public.admins where user_id = uid) then raise exception 'That login is a site owner, so it cannot be deleted here.'; end if;
  delete from auth.users where id = uid;
end $$;

REVOKE ALL ON FUNCTION public.delete_login(uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_login(uid uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_league_admins(lid uuid) RETURNS TABLE(user_id uuid, email text, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.can_admin_league(lid) then raise exception 'Admins only'; end if;
  return query select a.user_id, u.email::text, a.created_at
    from public.league_admins a join auth.users u on u.id = a.user_id
    where a.league_id = lid order by a.created_at;
end $$;

REVOKE ALL ON FUNCTION public.list_league_admins(lid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_league_admins(lid uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_db_stats() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

REVOKE ALL ON FUNCTION public.owner_db_stats() FROM PUBLIC;
GRANT ALL ON FUNCTION public.owner_db_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_site_overview() RETURNS TABLE(league_id uuid, name text, admins bigint, championships bigint, drivers bigint, results bigint, last_activity timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

REVOKE ALL ON FUNCTION public.owner_site_overview() FROM PUBLIC;
GRANT ALL ON FUNCTION public.owner_site_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_league_admin(lid uuid, uid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.can_admin_league(lid) then raise exception 'Admins only'; end if;
  if uid = auth.uid() then raise exception 'You cannot remove yourself.'; end if;
  delete from public.league_admins where league_id = lid and user_id = uid;
end $$;

REVOKE ALL ON FUNCTION public.remove_league_admin(lid uuid, uid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_league_admin(lid uuid, uid uuid) TO authenticated;

-- Public page functions (what anonymous visitors can read)

CREATE OR REPLACE FUNCTION public.public_build(bid uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object('league_id', l.id, 'can_edit', public.can_admin_league(l.id), 'is_public', (b.published and b.status = 'completed'), 'name', b.name, 'league', l.name, 'palette', l.palette, 'data', b.data)
  from public.build_sheets b
  join public.leagues l on l.id = b.league_id
  where b.id = bid and ((b.published and b.status = 'completed') or public.can_admin_league(b.league_id))
$$;

REVOKE ALL ON FUNCTION public.public_build(bid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.public_build(bid uuid) TO anon;
GRANT ALL ON FUNCTION public.public_build(bid uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.public_calendar(sid uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'season_id', s.id,
    'championship_id', c.id,
    'league_id', l.id,
    'can_edit', public.can_admin_league(l.id),
    'is_public', s.calendar_published,
    'league', l.name,
    'palette', l.palette,
    'championship', c.name,
    'description', c.description,
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

REVOKE ALL ON FUNCTION public.public_calendar(sid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.public_calendar(sid uuid) TO anon;
GRANT ALL ON FUNCTION public.public_calendar(sid uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.public_championship(cid uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

REVOKE ALL ON FUNCTION public.public_championship(cid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.public_championship(cid uuid) TO anon;
GRANT ALL ON FUNCTION public.public_championship(cid uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.public_league(lid uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

REVOKE ALL ON FUNCTION public.public_league(lid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.public_league(lid uuid) TO anon;
GRANT ALL ON FUNCTION public.public_league(lid uuid) TO authenticated;


-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------


-- ACCESS: leagues and who can manage them

-- admins
CREATE TABLE public.admins (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (user_id);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- leagues
CREATE TABLE public.leagues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    timezone text,
    units text,
    palette text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    page_published boolean DEFAULT true NOT NULL,
    tagline text,
    about text,
    join_text text,
    banner_url text,
    links jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT leagues_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT leagues_palette_check CHECK (((palette IS NULL) OR (palette = ANY (ARRAY['rwb'::text, 'rosso'::text, 'gulf'::text, 'brg'::text, 'papaya'::text, 'mono'::text])))),
    CONSTRAINT leagues_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT leagues_timezone_check CHECK (((timezone IS NULL) OR public.is_valid_timezone(timezone))),
    CONSTRAINT leagues_units_check CHECK (((units IS NULL) OR (units = ANY (ARRAY['imperial'::text, 'metric'::text]))))
);
ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_slug_key UNIQUE (slug);
CREATE TRIGGER leagues_set_updated_at BEFORE UPDATE ON public.leagues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
CREATE POLICY leagues_admin_read ON public.leagues FOR SELECT TO authenticated USING (public.can_admin_league(id));
CREATE POLICY leagues_admin_update ON public.leagues FOR UPDATE TO authenticated USING (public.can_admin_league(id)) WITH CHECK (public.can_admin_league(id));

-- league_admins
CREATE TABLE public.league_admins (
    league_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.league_admins
    ADD CONSTRAINT league_admins_pkey PRIMARY KEY (league_id, user_id);
ALTER TABLE public.league_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY league_admins_read ON public.league_admins FOR SELECT TO authenticated USING (public.can_admin_league(league_id));

-- league
CREATE TABLE public.league (
    id boolean DEFAULT true NOT NULL,
    name text,
    timezone text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT league_id_check CHECK (id),
    CONSTRAINT league_name_check CHECK (((name IS NULL) OR (length(btrim(name)) > 0))),
    CONSTRAINT league_timezone_check CHECK (((timezone IS NULL) OR public.is_valid_timezone(timezone)))
);
ALTER TABLE ONLY public.league
    ADD CONSTRAINT league_pkey PRIMARY KEY (id);
ALTER TABLE public.league ENABLE ROW LEVEL SECURITY;
CREATE POLICY league_admin_all ON public.league TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


-- DRIVERS

-- drivers
CREATE TABLE public.drivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    gamertag text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    league_id uuid NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT drivers_display_name_check CHECK ((length(btrim(display_name)) > 0))
);
ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX drivers_league_name_uq ON public.drivers USING btree (league_id, lower(display_name));
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY drivers_admin_all ON public.drivers TO authenticated USING (public.can_admin_league(league_id)) WITH CHECK (public.can_admin_league(league_id));


-- POINTS SYSTEMS

-- points_systems
CREATE TABLE public.points_systems (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid,
    name text NOT NULL,
    source_series text,
    source_version text,
    source_url text,
    copied_from uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    league_id uuid,
    copied_at timestamp with time zone,
    dnf_rank_by_best_lap boolean DEFAULT false NOT NULL,
    CONSTRAINT points_systems_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT points_systems_one_owner CHECK (((championship_id IS NULL) OR (league_id IS NULL)))
);
ALTER TABLE ONLY public.points_systems
    ADD CONSTRAINT points_systems_pkey PRIMARY KEY (id);
CREATE TRIGGER points_systems_default_dnf AFTER INSERT ON public.points_systems FOR EACH ROW EXECUTE FUNCTION public.default_dnf_rule();
CREATE TRIGGER points_systems_set_updated_at BEFORE UPDATE ON public.points_systems FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.points_systems ENABLE ROW LEVEL SECURITY;
CREATE POLICY points_systems_admin_all ON public.points_systems TO authenticated USING ((((championship_id IS NOT NULL) AND public.can_admin_champ(championship_id)) OR ((championship_id IS NULL) AND (league_id IS NOT NULL) AND public.can_admin_league(league_id)) OR ((championship_id IS NULL) AND (league_id IS NULL) AND public.is_owner()))) WITH CHECK ((((championship_id IS NOT NULL) AND public.can_admin_champ(championship_id)) OR ((championship_id IS NULL) AND (league_id IS NOT NULL) AND public.can_admin_league(league_id)) OR ((championship_id IS NULL) AND (league_id IS NULL) AND public.is_owner())));
CREATE POLICY points_systems_library_read ON public.points_systems FOR SELECT TO authenticated USING (((championship_id IS NULL) AND (league_id IS NULL) AND public.is_admin()));

-- points_table_entries
CREATE TABLE public.points_table_entries (
    points_system_id uuid NOT NULL,
    "position" integer NOT NULL,
    points numeric NOT NULL,
    CONSTRAINT points_table_entries_position_check CHECK (("position" > 0))
);
ALTER TABLE ONLY public.points_table_entries
    ADD CONSTRAINT points_table_entries_pkey PRIMARY KEY (points_system_id, "position");
ALTER TABLE public.points_table_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY points_table_entries_admin_all ON public.points_table_entries TO authenticated USING (public.can_admin_points_system(points_system_id)) WITH CHECK (public.can_admin_points_system(points_system_id));
CREATE POLICY points_table_entries_library_read ON public.points_table_entries FOR SELECT TO authenticated USING (public.can_read_points_system(points_system_id));

-- points_status_rules
CREATE TABLE public.points_status_rules (
    points_system_id uuid NOT NULL,
    status text NOT NULL,
    points numeric NOT NULL,
    CONSTRAINT points_status_rules_status_check CHECK ((status = ANY (ARRAY['dnf'::text, 'dns'::text, 'dsq'::text, 'other'::text])))
);
ALTER TABLE ONLY public.points_status_rules
    ADD CONSTRAINT points_status_rules_pkey PRIMARY KEY (points_system_id, status);
ALTER TABLE public.points_status_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY points_status_rules_admin_all ON public.points_status_rules TO authenticated USING (public.can_admin_points_system(points_system_id)) WITH CHECK (public.can_admin_points_system(points_system_id));
CREATE POLICY points_status_rules_library_read ON public.points_status_rules FOR SELECT TO authenticated USING (public.can_read_points_system(points_system_id));

-- points_bonuses
CREATE TABLE public.points_bonuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    points_system_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    points numeric NOT NULL,
    description text,
    CONSTRAINT points_bonuses_kind_check CHECK ((kind = ANY (ARRAY['bonus'::text, 'penalty'::text])))
);
ALTER TABLE ONLY public.points_bonuses
    ADD CONSTRAINT points_bonuses_pkey PRIMARY KEY (id);
ALTER TABLE public.points_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY points_bonuses_admin_all ON public.points_bonuses TO authenticated USING (public.can_admin_points_system(points_system_id)) WITH CHECK (public.can_admin_points_system(points_system_id));
CREATE POLICY points_bonuses_library_read ON public.points_bonuses FOR SELECT TO authenticated USING (public.can_read_points_system(points_system_id));


-- CHAMPIONSHIPS, SEASONS, ROUNDS AND RACES

-- championships
CREATE TABLE public.championships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    intended_timezone text,
    schedule_every_weeks integer,
    lobby_local_time time without time zone,
    race_local_time time without time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    points_system_id uuid,
    league_id uuid NOT NULL,
    rules text,
    page_published boolean DEFAULT true NOT NULL,
    track_places boolean DEFAULT true NOT NULL,
    CONSTRAINT championships_intended_timezone_check CHECK (((intended_timezone IS NULL) OR public.is_valid_timezone(intended_timezone))),
    CONSTRAINT championships_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT championships_schedule_every_weeks_check CHECK (((schedule_every_weeks IS NULL) OR ((schedule_every_weeks >= 1) AND (schedule_every_weeks <= 4))))
);
ALTER TABLE ONLY public.championships
    ADD CONSTRAINT championships_pkey PRIMARY KEY (id);
CREATE INDEX championships_league_idx ON public.championships USING btree (league_id);
CREATE TRIGGER championships_guard_points BEFORE INSERT OR UPDATE ON public.championships FOR EACH ROW EXECUTE FUNCTION public.guard_points_league();
CREATE TRIGGER championships_set_updated_at BEFORE UPDATE ON public.championships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.championships ENABLE ROW LEVEL SECURITY;
CREATE POLICY championships_admin_all ON public.championships TO authenticated USING (public.can_admin_league(league_id)) WITH CHECK (public.can_admin_league(league_id));

-- event_series
CREATE TABLE public.event_series (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    name text,
    pattern text,
    interval_count integer,
    interval_unit text,
    monthly_mode text,
    first_local_date date,
    local_time time without time zone,
    lobby_local_time time without time zone,
    timezone text,
    end_type text,
    until_date date,
    occurrence_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_series_check CHECK (((end_type IS DISTINCT FROM 'on_date'::text) OR (until_date IS NOT NULL))),
    CONSTRAINT event_series_check1 CHECK (((end_type IS DISTINCT FROM 'after_count'::text) OR (occurrence_count IS NOT NULL))),
    CONSTRAINT event_series_end_type_check CHECK ((end_type = ANY (ARRAY['on_date'::text, 'after_count'::text]))),
    CONSTRAINT event_series_interval_count_check CHECK (((interval_count IS NULL) OR (interval_count > 0))),
    CONSTRAINT event_series_interval_unit_check CHECK ((interval_unit = ANY (ARRAY['day'::text, 'week'::text, 'month'::text]))),
    CONSTRAINT event_series_monthly_mode_check CHECK ((monthly_mode = ANY (ARRAY['day_of_month'::text, 'nth_weekday'::text]))),
    CONSTRAINT event_series_occurrence_count_check CHECK (((occurrence_count IS NULL) OR (occurrence_count > 0))),
    CONSTRAINT event_series_pattern_check CHECK ((pattern = ANY (ARRAY['weekly'::text, 'fortnightly'::text, 'monthly'::text, 'custom'::text]))),
    CONSTRAINT event_series_timezone_check CHECK (((timezone IS NULL) OR public.is_valid_timezone(timezone)))
);
ALTER TABLE ONLY public.event_series
    ADD CONSTRAINT event_series_pkey PRIMARY KEY (id);
CREATE INDEX event_series_season_idx ON public.event_series USING btree (season_id);
CREATE TRIGGER event_series_set_updated_at BEFORE UPDATE ON public.event_series FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_series_admin_all ON public.event_series TO authenticated USING (public.can_admin_season(season_id)) WITH CHECK (public.can_admin_season(season_id));

-- race_templates
CREATE TABLE public.race_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    sort_order integer NOT NULL,
    name text NOT NULL,
    laps integer,
    points_system_id uuid,
    CONSTRAINT race_templates_laps_check CHECK (((laps IS NULL) OR (laps > 0))),
    CONSTRAINT race_templates_name_check CHECK ((length(btrim(name)) > 0))
);
ALTER TABLE ONLY public.race_templates
    ADD CONSTRAINT race_templates_championship_id_sort_order_key UNIQUE (championship_id, sort_order);
ALTER TABLE ONLY public.race_templates
    ADD CONSTRAINT race_templates_pkey PRIMARY KEY (id);
CREATE TRIGGER race_templates_guard_points BEFORE INSERT OR UPDATE ON public.race_templates FOR EACH ROW EXECUTE FUNCTION public.guard_points_league();
ALTER TABLE public.race_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY race_templates_admin_all ON public.race_templates TO authenticated USING (public.can_admin_champ(championship_id)) WITH CHECK (public.can_admin_champ(championship_id));

-- seasons
CREATE TABLE public.seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    name text NOT NULL,
    starts_on date,
    ends_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calendar_published boolean DEFAULT true NOT NULL,
    CONSTRAINT seasons_check CHECK (((starts_on IS NULL) OR (ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT seasons_name_check CHECK ((length(btrim(name)) > 0))
);
ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);
CREATE INDEX seasons_championship_idx ON public.seasons USING btree (championship_id);
CREATE TRIGGER seasons_set_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY seasons_admin_all ON public.seasons TO authenticated USING (public.can_admin_champ(championship_id)) WITH CHECK (public.can_admin_champ(championship_id));

-- events
CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_id uuid NOT NULL,
    series_id uuid,
    occurrence_date date,
    name text,
    round_number integer,
    starts_at timestamp with time zone,
    lobby_opens_at timestamp with time zone,
    timezone text,
    original_starts_at timestamp with time zone,
    is_override boolean DEFAULT false NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    track_layout_id uuid,
    is_bonus boolean DEFAULT false NOT NULL,
    reference_lap_ms integer,
    reference_car text,
    CONSTRAINT events_check CHECK (((starts_at IS NULL) = (timezone IS NULL))),
    CONSTRAINT events_lobby_before_start CHECK (((lobby_opens_at IS NULL) OR ((starts_at IS NOT NULL) AND (lobby_opens_at <= starts_at)))),
    CONSTRAINT events_reference_lap_ms_check CHECK (((reference_lap_ms IS NULL) OR (reference_lap_ms > 0))),
    CONSTRAINT events_round_number_check CHECK (((round_number IS NULL) OR (round_number > 0))),
    CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'completed'::text]))),
    CONSTRAINT events_timezone_check CHECK (((timezone IS NULL) OR public.is_valid_timezone(timezone)))
);
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);
CREATE INDEX events_season_idx ON public.events USING btree (season_id);
CREATE UNIQUE INDEX events_series_occurrence_uq ON public.events USING btree (series_id, occurrence_date) WHERE (series_id IS NOT NULL);
CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_admin_all ON public.events TO authenticated USING (public.can_admin_season(season_id)) WITH CHECK (public.can_admin_season(season_id));

-- races
CREATE TABLE public.races (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    name text,
    sort_order integer NOT NULL,
    session_type text,
    starts_at timestamp with time zone,
    laps integer,
    target_distance_km numeric,
    duration_minutes integer,
    points_system_id uuid,
    double_points boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT races_duration_minutes_check CHECK (((duration_minutes IS NULL) OR (duration_minutes > 0))),
    CONSTRAINT races_laps_check CHECK (((laps IS NULL) OR (laps > 0))),
    CONSTRAINT races_target_distance_km_check CHECK (((target_distance_km IS NULL) OR (target_distance_km > (0)::numeric)))
);
ALTER TABLE ONLY public.races
    ADD CONSTRAINT races_pkey PRIMARY KEY (id);
CREATE INDEX races_event_idx ON public.races USING btree (event_id);
CREATE TRIGGER races_guard_points BEFORE INSERT OR UPDATE ON public.races FOR EACH ROW EXECUTE FUNCTION public.guard_points_league();
CREATE TRIGGER races_set_updated_at BEFORE UPDATE ON public.races FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;
CREATE POLICY races_admin_all ON public.races TO authenticated USING (public.can_admin_event(event_id)) WITH CHECK (public.can_admin_event(event_id));


-- RESULTS

-- results
CREATE TABLE public.results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    car_id uuid,
    "position" integer,
    status text NOT NULL,
    laps_completed integer,
    total_time_ms bigint,
    adjustment_points numeric,
    adjustment_reason text,
    points_awarded numeric,
    scored_with_system_id uuid,
    scored_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    best_lap_ms integer,
    race_time_ms bigint,
    penalty_ms integer,
    fastest_lap boolean DEFAULT false NOT NULL,
    places_gained integer,
    CONSTRAINT results_best_lap_ms_check CHECK (((best_lap_ms IS NULL) OR (best_lap_ms > 0))),
    CONSTRAINT results_laps_completed_check CHECK (((laps_completed IS NULL) OR (laps_completed >= 0))),
    CONSTRAINT results_penalty_ms_check CHECK (((penalty_ms IS NULL) OR (penalty_ms >= 0))),
    CONSTRAINT results_position_check CHECK ((("position" IS NULL) OR ("position" > 0))),
    CONSTRAINT results_race_time_ms_check CHECK (((race_time_ms IS NULL) OR (race_time_ms >= 0))),
    CONSTRAINT results_status_check CHECK ((status = ANY (ARRAY['finished'::text, 'dnf'::text, 'dns'::text, 'dsq'::text, 'other'::text]))),
    CONSTRAINT results_total_time_ms_check CHECK (((total_time_ms IS NULL) OR (total_time_ms >= 0)))
);
ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_race_id_driver_id_key UNIQUE (race_id, driver_id);
CREATE INDEX results_race_idx ON public.results USING btree (race_id);
CREATE TRIGGER results_audit_trg AFTER INSERT OR DELETE OR UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION public.audit_results();
CREATE TRIGGER results_guard_league BEFORE INSERT OR UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION public.guard_result_league();
CREATE TRIGGER results_set_updated_at BEFORE UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
CREATE POLICY results_admin_all ON public.results TO authenticated USING (public.can_admin_race(race_id)) WITH CHECK (public.can_admin_race(race_id));

-- results_audit
CREATE TABLE public.results_audit (
    id bigint NOT NULL,
    result_id uuid NOT NULL,
    action text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by uuid,
    before_row jsonb,
    after_row jsonb,
    league_id uuid
);
ALTER TABLE public.results_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.results_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
ALTER TABLE ONLY public.results_audit
    ADD CONSTRAINT results_audit_pkey PRIMARY KEY (id);
ALTER TABLE public.results_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY results_audit_admin_read ON public.results_audit FOR SELECT TO authenticated USING (((league_id IS NOT NULL) AND public.can_admin_league(league_id)));


-- CARS AND TRACKS (reference data, admin only)

-- cars
CREATE TABLE public.cars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ordinal integer NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    year integer NOT NULL,
    nickname text,
    division text NOT NULL,
    country text,
    pi integer NOT NULL,
    speed numeric,
    braking numeric,
    handling numeric,
    acceleration numeric,
    power_kw numeric,
    power_ps numeric,
    power_hp numeric,
    mass_kg numeric,
    mass_lb numeric,
    torque_nm numeric,
    torque_ftlb numeric,
    drivetrain text,
    engine_position text,
    displacement_l numeric,
    engine_layout text,
    cylinders integer,
    induction text,
    model_type text,
    steering_position text,
    verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cars_drivetrain_check CHECK ((drivetrain = ANY (ARRAY['RWD'::text, 'AWD'::text, 'FWD'::text]))),
    CONSTRAINT cars_pi_check CHECK ((pi > 0))
);
ALTER TABLE ONLY public.cars
    ADD CONSTRAINT cars_ordinal_key UNIQUE (ordinal);
ALTER TABLE ONLY public.cars
    ADD CONSTRAINT cars_pkey PRIMARY KEY (id);
CREATE INDEX cars_division_idx ON public.cars USING btree (division);
CREATE INDEX cars_make_idx ON public.cars USING btree (make);
CREATE TRIGGER cars_set_updated_at BEFORE UPDATE ON public.cars FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
CREATE POLICY cars_admin_read ON public.cars FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY cars_owner_write ON public.cars TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

-- track_venues
CREATE TABLE public.track_venues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    location text,
    country text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text,
    based_on text,
    opened_year integer,
    history text,
    source_url text,
    direction text,
    corners integer,
    corners_layout text,
    length_note text,
    elevation_note text,
    facts text[],
    surface text,
    surface_note text,
    circuit_type text,
    type_note text,
    CONSTRAINT track_venues_circuit_type_check CHECK (((circuit_type IS NULL) OR (circuit_type = ANY (ARRAY['purpose-built'::text, 'public-road'::text, 'airfield'::text, 'oval'::text])))),
    CONSTRAINT track_venues_corners_check CHECK (((corners IS NULL) OR (corners > 0))),
    CONSTRAINT track_venues_kind_check CHECK (((kind IS NULL) OR (kind = ANY (ARRAY['real'::text, 'fictional'::text])))),
    CONSTRAINT track_venues_opened_year_check CHECK (((opened_year IS NULL) OR ((opened_year >= 1800) AND (opened_year <= 2100))))
);
ALTER TABLE ONLY public.track_venues
    ADD CONSTRAINT track_venues_name_key UNIQUE (name);
ALTER TABLE ONLY public.track_venues
    ADD CONSTRAINT track_venues_pkey PRIMARY KEY (id);
ALTER TABLE public.track_venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY track_venues_admin_read ON public.track_venues FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY track_venues_owner_write ON public.track_venues TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

-- track_layouts
CREATE TABLE public.track_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    name text NOT NULL,
    length_km numeric NOT NULL,
    length_mi numeric GENERATED ALWAYS AS (round((length_km / 1.609344), 3)) STORED,
    is_reverse boolean NOT NULL,
    imported_ordinal integer,
    verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT track_layouts_length_km_check CHECK ((length_km > (0)::numeric))
);
ALTER TABLE ONLY public.track_layouts
    ADD CONSTRAINT track_layouts_imported_ordinal_key UNIQUE (imported_ordinal);
ALTER TABLE ONLY public.track_layouts
    ADD CONSTRAINT track_layouts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.track_layouts
    ADD CONSTRAINT track_layouts_venue_id_name_key UNIQUE (venue_id, name);
CREATE TRIGGER track_layouts_set_updated_at BEFORE UPDATE ON public.track_layouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.track_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY track_layouts_admin_read ON public.track_layouts FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY track_layouts_owner_write ON public.track_layouts TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());


-- BUILDS, FAVOURITES AND DIVISIONS

-- build_sheets
CREATE TABLE public.build_sheets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    car_id uuid,
    name text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    class_letter text,
    pi integer,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published boolean DEFAULT true NOT NULL,
    CONSTRAINT build_sheets_class_letter_check CHECK (((class_letter IS NULL) OR (class_letter ~ '^[A-Z]$'::text))),
    CONSTRAINT build_sheets_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT build_sheets_pi_check CHECK (((pi IS NULL) OR ((pi >= 0) AND (pi <= 999)))),
    CONSTRAINT build_sheets_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'completed'::text])))
);
ALTER TABLE ONLY public.build_sheets
    ADD CONSTRAINT build_sheets_pkey PRIMARY KEY (id);
CREATE INDEX build_sheets_car_idx ON public.build_sheets USING btree (car_id);
CREATE INDEX build_sheets_league_idx ON public.build_sheets USING btree (league_id);
CREATE UNIQUE INDEX build_sheets_league_name_uq ON public.build_sheets USING btree (league_id, lower(name));
CREATE TRIGGER build_sheets_public BEFORE INSERT OR UPDATE ON public.build_sheets FOR EACH ROW EXECUTE FUNCTION public.build_sheets_always_public();
CREATE TRIGGER build_sheets_touch BEFORE UPDATE ON public.build_sheets FOR EACH ROW EXECUTE FUNCTION public.touch_build_sheet();
ALTER TABLE public.build_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY build_sheets_admin_all ON public.build_sheets TO authenticated USING (public.can_admin_league(league_id)) WITH CHECK (public.can_admin_league(league_id));
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.build_sheets TO authenticated;

-- league_favourites
CREATE TABLE public.league_favourites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    car_id uuid,
    build_id uuid,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT league_favourites_check CHECK (((car_id IS NOT NULL) <> (build_id IS NOT NULL)))
);
ALTER TABLE ONLY public.league_favourites
    ADD CONSTRAINT league_favourites_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX league_favourites_build_uq ON public.league_favourites USING btree (league_id, build_id) WHERE (build_id IS NOT NULL);
CREATE UNIQUE INDEX league_favourites_car_uq ON public.league_favourites USING btree (league_id, car_id) WHERE (car_id IS NOT NULL);
CREATE TRIGGER league_favourites_guard BEFORE INSERT OR UPDATE ON public.league_favourites FOR EACH ROW EXECUTE FUNCTION public.guard_build_league();
ALTER TABLE public.league_favourites ENABLE ROW LEVEL SECURITY;
CREATE POLICY league_favourites_admin_all ON public.league_favourites TO authenticated USING (public.can_admin_league(league_id)) WITH CHECK (public.can_admin_league(league_id));
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.league_favourites TO authenticated;


--
-- PostgreSQL database dump complete
--

-- divisions
CREATE TABLE public.divisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id uuid NOT NULL,
    name text NOT NULL,
    pi_limit text,
    min_weight_lb integer,
    other_rules text,
    parts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT divisions_min_weight_lb_check CHECK (((min_weight_lb IS NULL) OR (min_weight_lb > 0))),
    CONSTRAINT divisions_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT divisions_pi_limit_check CHECK (((pi_limit IS NULL) OR (length(btrim(pi_limit)) > 0)))
);
ALTER TABLE ONLY public.divisions
    ADD CONSTRAINT divisions_pkey PRIMARY KEY (id);
CREATE INDEX divisions_league_idx ON public.divisions USING btree (league_id);
CREATE UNIQUE INDEX divisions_league_name_uq ON public.divisions USING btree (league_id, lower(name));
CREATE TRIGGER divisions_touch BEFORE UPDATE ON public.divisions FOR EACH ROW EXECUTE FUNCTION public.touch_division();
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY divisions_admin_all ON public.divisions TO authenticated USING (public.can_admin_league(league_id)) WITH CHECK (public.can_admin_league(league_id));
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.divisions TO authenticated;

-- division_cars
CREATE TABLE public.division_cars (
    division_id uuid NOT NULL,
    car_id uuid NOT NULL
);
ALTER TABLE ONLY public.division_cars
    ADD CONSTRAINT division_cars_pkey PRIMARY KEY (division_id, car_id);
CREATE INDEX division_cars_car_idx ON public.division_cars USING btree (car_id);
ALTER TABLE public.division_cars ENABLE ROW LEVEL SECURITY;
CREATE POLICY division_cars_admin_all ON public.division_cars TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.divisions d
  WHERE ((d.id = division_cars.division_id) AND public.can_admin_league(d.league_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.divisions d
  WHERE ((d.id = division_cars.division_id) AND public.can_admin_league(d.league_id)))));
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.division_cars TO authenticated;

-- championship_cars
CREATE TABLE public.championship_cars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    championship_id uuid NOT NULL,
    car_id uuid,
    build_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    division_id uuid,
    CONSTRAINT championship_cars_one_kind CHECK ((((((car_id IS NOT NULL))::integer + ((build_id IS NOT NULL))::integer) + ((division_id IS NOT NULL))::integer) = 1))
);
ALTER TABLE ONLY public.championship_cars
    ADD CONSTRAINT championship_cars_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX championship_cars_build_uq ON public.championship_cars USING btree (championship_id, build_id) WHERE (build_id IS NOT NULL);
CREATE UNIQUE INDEX championship_cars_car_uq ON public.championship_cars USING btree (championship_id, car_id) WHERE (car_id IS NOT NULL);
CREATE INDEX championship_cars_champ_idx ON public.championship_cars USING btree (championship_id);
CREATE UNIQUE INDEX championship_cars_division_uq ON public.championship_cars USING btree (championship_id, division_id) WHERE (division_id IS NOT NULL);
CREATE TRIGGER championship_cars_guard BEFORE INSERT OR UPDATE ON public.championship_cars FOR EACH ROW EXECUTE FUNCTION public.guard_build_league();
ALTER TABLE public.championship_cars ENABLE ROW LEVEL SECURITY;
CREATE POLICY championship_cars_admin_all ON public.championship_cars TO authenticated USING (public.can_admin_champ(championship_id)) WITH CHECK (public.can_admin_champ(championship_id));
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.championship_cars TO authenticated;


-- ---------------------------------------------------------------------------
-- RELATIONSHIPS (foreign keys)
-- ---------------------------------------------------------------------------

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.build_sheets
    ADD CONSTRAINT build_sheets_car_id_fkey FOREIGN KEY (car_id) REFERENCES public.cars(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.build_sheets
    ADD CONSTRAINT build_sheets_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.championship_cars
    ADD CONSTRAINT championship_cars_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.build_sheets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.championship_cars
    ADD CONSTRAINT championship_cars_car_id_fkey FOREIGN KEY (car_id) REFERENCES public.cars(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.championship_cars
    ADD CONSTRAINT championship_cars_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.championship_cars
    ADD CONSTRAINT championship_cars_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.championships
    ADD CONSTRAINT championships_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.championships
    ADD CONSTRAINT championships_points_system_id_fkey FOREIGN KEY (points_system_id) REFERENCES public.points_systems(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.division_cars
    ADD CONSTRAINT division_cars_car_id_fkey FOREIGN KEY (car_id) REFERENCES public.cars(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.division_cars
    ADD CONSTRAINT division_cars_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.divisions
    ADD CONSTRAINT divisions_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.event_series
    ADD CONSTRAINT event_series_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.event_series(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_track_layout_id_fkey FOREIGN KEY (track_layout_id) REFERENCES public.track_layouts(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.league_admins
    ADD CONSTRAINT league_admins_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.league_admins
    ADD CONSTRAINT league_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.league_favourites
    ADD CONSTRAINT league_favourites_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.build_sheets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.league_favourites
    ADD CONSTRAINT league_favourites_car_id_fkey FOREIGN KEY (car_id) REFERENCES public.cars(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.league_favourites
    ADD CONSTRAINT league_favourites_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.points_bonuses
    ADD CONSTRAINT points_bonuses_points_system_id_fkey FOREIGN KEY (points_system_id) REFERENCES public.points_systems(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.points_status_rules
    ADD CONSTRAINT points_status_rules_points_system_id_fkey FOREIGN KEY (points_system_id) REFERENCES public.points_systems(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.points_systems
    ADD CONSTRAINT points_systems_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.points_systems
    ADD CONSTRAINT points_systems_copied_from_fkey FOREIGN KEY (copied_from) REFERENCES public.points_systems(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.points_systems
    ADD CONSTRAINT points_systems_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.points_table_entries
    ADD CONSTRAINT points_table_entries_points_system_id_fkey FOREIGN KEY (points_system_id) REFERENCES public.points_systems(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.race_templates
    ADD CONSTRAINT race_templates_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.race_templates
    ADD CONSTRAINT race_templates_points_system_id_fkey FOREIGN KEY (points_system_id) REFERENCES public.points_systems(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.races
    ADD CONSTRAINT races_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.races
    ADD CONSTRAINT races_points_system_id_fkey FOREIGN KEY (points_system_id) REFERENCES public.points_systems(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_car_id_fkey FOREIGN KEY (car_id) REFERENCES public.cars(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.races(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_scored_with_system_id_fkey FOREIGN KEY (scored_with_system_id) REFERENCES public.points_systems(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_championship_id_fkey FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.track_layouts
    ADD CONSTRAINT track_layouts_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.track_venues(id) ON DELETE CASCADE;
