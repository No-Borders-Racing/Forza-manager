-- Merge two driver records that are really one person (for example a misspelt name that was added as a new driver).
-- All results of the duplicate move to the driver you keep; the duplicate's name is kept as another name; the duplicate is deleted.
-- Refuses if both drivers have a result in the same race (it cannot tell which row is right): fix that race first.

create or replace function public.merge_drivers(keep_id uuid, drop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.merge_drivers(uuid, uuid) from public;
grant execute on function public.merge_drivers(uuid, uuid) to authenticated;
