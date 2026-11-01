-- Reference information for the Tracks tab. All optional.
alter table public.track_venues add column if not exists kind text check (kind is null or kind in ('real', 'fictional'));
alter table public.track_venues add column if not exists based_on text;       -- the real place a fictional track is modelled on
alter table public.track_venues add column if not exists opened_year integer check (opened_year is null or (opened_year >= 1800 and opened_year <= 2100));
alter table public.track_venues add column if not exists history text;
alter table public.track_venues add column if not exists source_url text;
notify pgrst, 'reload schema';
