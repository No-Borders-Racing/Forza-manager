-- Every build sheet is public by link: no draft status and no "admin only" switch.
update public.build_sheets set status = 'completed', published = true where status <> 'completed' or published is not true;

create or replace function public.build_sheets_always_public()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := 'completed';
  new.published := true;
  return new;
end
$$;

drop trigger if exists build_sheets_public on public.build_sheets;
create trigger build_sheets_public before insert or update on public.build_sheets
  for each row execute function public.build_sheets_always_public();

notify pgrst, 'reload schema';
