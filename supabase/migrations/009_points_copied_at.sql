-- When a points system was last copied from its source (a league's saved system or the master list).
-- Lets a championship show "the league's version has changed since you copied it".
alter table public.points_systems add column if not exists copied_at timestamptz;
update public.points_systems set copied_at = created_at where copied_from is not null and copied_at is null;
