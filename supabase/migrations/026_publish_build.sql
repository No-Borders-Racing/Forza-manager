-- Publishing a custom build gives it a public read-only page. One function hands the page the build and
-- the league's name and palette, and only when the build has been published.
alter table public.build_sheets add column if not exists published boolean not null default false;

create or replace function public.public_build(bid uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', b.name, 'league', l.name, 'palette', l.palette, 'data', b.data)
  from public.build_sheets b
  join public.leagues l on l.id = b.league_id
  where b.id = bid and b.published
$$;
revoke all on function public.public_build(uuid) from public;
grant execute on function public.public_build(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
