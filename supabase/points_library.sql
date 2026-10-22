-- Reference library of real-world points systems (championship_id is null). A championship copies
-- one and may edit its copy. Sources and caveats are recorded on each row. Re-running is harmless.
do $$
declare sid uuid;
begin
  -- Formula 1 Grand Prix
  if not exists (select 1 from public.points_systems where championship_id is null and name = 'Formula 1 Grand Prix') then
    insert into public.points_systems (name, source_series, source_version, source_url)
    values ('Formula 1 Grand Prix', 'Formula 1', '2026. No fastest-lap point since 2025. Positions 11 to 22 are entered as 0 because only the top 10 score.', 'https://racingnews365.com/f1-rules-explained')
    returning id into sid;
    insert into public.points_table_entries (points_system_id, position, points)
    select sid, p, case p when 1 then 25 when 2 then 18 when 3 then 15 when 4 then 12 when 5 then 10 when 6 then 8 when 7 then 6 when 8 then 4 when 9 then 2 when 10 then 1 else 0 end
    from generate_series(1, 22) p;
  end if;
  -- Formula 1 Sprint
  if not exists (select 1 from public.points_systems where championship_id is null and name = 'Formula 1 Sprint') then
    insert into public.points_systems (name, source_series, source_version, source_url)
    values ('Formula 1 Sprint', 'Formula 1', '2026. Top 8 score. Positions 9 to 22 are entered as 0.', 'https://racingnews365.com/f1-rules-explained')
    returning id into sid;
    insert into public.points_table_entries (points_system_id, position, points)
    select sid, p, case when p <= 8 then 9 - p else 0 end from generate_series(1, 22) p;
  end if;
  -- IndyCar
  if not exists (select 1 from public.points_systems where championship_id is null and name = 'IndyCar Series') then
    insert into public.points_systems (name, source_series, source_version, source_url)
    values ('IndyCar Series', 'NTT IndyCar Series', '2026 as described by openwheelworld.net, not checked against the official rulebook. Excludes the Indianapolis 500, which has its own points. 25th and lower is entered as 5 down to 33rd.', 'https://www.openwheelworld.net/en/indycar101/80/Points_System')
    returning id into sid;
    insert into public.points_table_entries (points_system_id, position, points)
    select sid, p, case when p <= 24 then (array[50,40,35,32,30,28,26,24,22,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6])[p] else 5 end
    from generate_series(1, 33) p;
    insert into public.points_bonuses (points_system_id, name, kind, points, description) values
      (sid, 'Pole position', 'bonus', 1, null),
      (sid, 'Led a lap', 'bonus', 1, null),
      (sid, 'Led the most laps', 'bonus', 2, 'In addition to the point for leading a lap');
  end if;
  -- NASCAR Cup
  if not exists (select 1 from public.points_systems where championship_id is null and name = 'NASCAR Cup Series (finishing points)') then
    insert into public.points_systems (name, source_series, source_version, source_url)
    values ('NASCAR Cup Series (finishing points)', 'NASCAR Cup Series', '2026. Stated by sources: 1st = 55, 2nd = 35, 3rd = 34, 4th = 33, 36th to 40th = 1. 5th to 35th are derived by me as one less per place, so check them. Stage points (top 10 in stages 1 and 2) are not included because this tool has no per-position stage points yet.', 'https://www.nascar.com/?p=497155')
    returning id into sid;
    insert into public.points_table_entries (points_system_id, position, points)
    select sid, p, case when p = 1 then 55 when p between 2 and 35 then 37 - p else 1 end from generate_series(1, 40) p;
  end if;
end $$;
