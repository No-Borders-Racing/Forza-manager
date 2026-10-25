-- Keep the car data light: body/doors and topless are not needed.
alter table public.cars drop column if exists body;
alter table public.cars drop column if exists topless;
