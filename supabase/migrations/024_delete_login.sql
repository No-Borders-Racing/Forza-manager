-- A site owner can delete a whole login (not just remove its admin rights). It cannot be used on yourself
-- or on another site owner. The login's admin rows go with it; leagues and their data stay.
create or replace function public.delete_login(uid uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'Only a site owner can delete a login'; end if;
  if uid = auth.uid() then raise exception 'You cannot delete your own login.'; end if;
  if exists (select 1 from public.admins where user_id = uid) then raise exception 'That login is a site owner, so it cannot be deleted here.'; end if;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_login(uuid) from public, anon;
grant execute on function public.delete_login(uuid) to authenticated;
notify pgrst, 'reload schema';
