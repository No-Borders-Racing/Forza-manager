-- A site owner can delete a whole league: its championships (with seasons, rounds, races and results),
-- drivers, points systems and builds. This cannot be undone. Championships go first because a league
-- will not delete while it still has them.
create or replace function public.delete_league(lid uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only a site owner can delete a league'; end if;
  if not exists (select 1 from public.leagues where id = lid) then raise exception 'That league does not exist'; end if;
  delete from public.championships where league_id = lid;
  delete from public.leagues where id = lid;
end $$;
revoke all on function public.delete_league(uuid) from public, anon;
grant execute on function public.delete_league(uuid) to authenticated;
notify pgrst, 'reload schema';
