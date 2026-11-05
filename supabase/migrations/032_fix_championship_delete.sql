-- 032: deleting a championship failed with "That driver belongs to another league".
-- Deleting it also deletes its points systems, which clears the points system on each result.
-- That update ran the league check after the race was already gone, so the check failed.
-- The check now skips a result whose race no longer exists, because that result is being deleted too.
create or replace function public.guard_result_league() returns trigger
language plpgsql security definer set search_path = '' as $$
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

notify pgrst, 'reload schema';
