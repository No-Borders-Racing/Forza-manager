alter table public.leagues add column if not exists palette text check (palette is null or palette in ('rwb','rosso','gulf','brg','papaya','mono'));
notify pgrst, 'reload schema';
