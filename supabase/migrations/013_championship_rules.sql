-- Free-text rules for a championship (penalties, tuning limits, protests, conduct).
alter table public.championships add column if not exists rules text;
