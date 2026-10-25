-- Per-row source notes are not needed on cars and tracks.
alter table public.track_layouts drop column if exists source;
alter table public.cars drop column if exists source;
