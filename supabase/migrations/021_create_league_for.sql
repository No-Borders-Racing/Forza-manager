-- A site owner can create a league for another login: that login becomes its admin, and so does the owner,
-- so the owner can still see and help in it.
create or replace function public.create_league_for(league_name text, league_slug text, admin_email text)
returns uuid
language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.create_league_for(text, text, text) from public, anon;
grant execute on function public.create_league_for(text, text, text) to authenticated;
notify pgrst, 'reload schema';
