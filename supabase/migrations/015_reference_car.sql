-- The car a round's reference lap was driven in (optional free text label, taken from the championship's cars).
alter table public.events add column if not exists reference_car text;
notify pgrst, 'reload schema';
