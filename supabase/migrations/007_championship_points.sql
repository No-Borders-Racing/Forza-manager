-- The championship's own points system: chosen once, used by every race unless a race sets a different one.
alter table public.championships
  add column if not exists points_system_id uuid references public.points_systems (id) on delete set null;
