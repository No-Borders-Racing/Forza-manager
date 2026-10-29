-- Adding a points system to a championship failed with "new row violates row-level security policy":
-- the insert is followed by a read of the new row, and the read rule looked the row up by id in a
-- helper, which cannot see a row created by the statement that is still running. Check the
-- championship directly instead, like the league and master-list cases already do.
drop policy if exists points_systems_admin_all on public.points_systems;
create policy points_systems_admin_all on public.points_systems for all to authenticated
  using ((championship_id is not null and public.can_admin_champ(championship_id))
         or (championship_id is null and league_id is not null and public.can_admin_league(league_id))
         or (championship_id is null and league_id is null and public.is_owner()))
  with check ((championship_id is not null and public.can_admin_champ(championship_id))
         or (championship_id is null and league_id is not null and public.can_admin_league(league_id))
         or (championship_id is null and league_id is null and public.is_owner()));
