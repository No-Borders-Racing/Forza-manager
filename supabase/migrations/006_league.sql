-- League settings (one row) and admin management. Run once in the SQL editor.

create table if not exists public.league (
  id boolean primary key default true check (id),
  name text check (name is null or length(btrim(name)) > 0),
  timezone text check (timezone is null or public.is_valid_timezone(timezone)),
  updated_at timestamptz not null default now()
);
alter table public.league enable row level security;
drop policy if exists league_admin_all on public.league;
create policy league_admin_all on public.league for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.list_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select a.user_id, u.email::text, a.created_at
    from public.admins a join auth.users u on u.id = a.user_id order by a.created_at;
end $$;

create or replace function public.add_admin(admin_email text)
returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(admin_email));
  if uid is null then
    raise exception 'No login with that email. Create it in Supabase under Authentication > Users first, then add it here.';
  end if;
  insert into public.admins (user_id) values (uid) on conflict do nothing;
end $$;

create or replace function public.remove_admin(uid uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if uid = auth.uid() then raise exception 'You cannot remove yourself.'; end if;
  delete from public.admins where user_id = uid;
end $$;

revoke all on function public.list_admins() from public, anon;
revoke all on function public.add_admin(text) from public, anon;
revoke all on function public.remove_admin(uuid) from public, anon;
grant execute on function public.list_admins() to authenticated;
grant execute on function public.add_admin(text) to authenticated;
grant execute on function public.remove_admin(uuid) to authenticated;
