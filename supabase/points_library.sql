-- Reference library of real-world points systems (championship_id is null). A championship copies one
-- and may edit its copy. Sources and caveats are recorded on each row. Every table stops at 24 places
-- because Forza lobbies hold at most 24 players. Re-running REPLACES these library rows with the
-- current versions below; copies already made inside championships are not touched.
do $$
declare sid uuid;
begin
  delete from public.points_systems where championship_id is null and name in (
    'Formula 1 Grand Prix', 'Formula 1 Sprint', 'IndyCar Series', 'NASCAR Cup Series (finishing points)',
    'Supercars 2026: Sprint race (80 for a win)', 'Supercars 2026: Sprint race 3 (140 for a win)',
    'Supercars 2026: Enduro (300 for a win)', 'BTCC 2026: Race', 'BTCC 2026: Qualifying race');

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('Formula 1 Grand Prix', 'Formula 1', '2026. No fastest-lap point since 2025. Places 11 to 24 are entered as 0 because only the top 10 score. The source page garbled this table, so check it against the FIA.', 'https://racingnews365.com/f1-rules-explained')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, case when p <= 10 then (array[25,18,15,12,10,8,6,4,2,1])[p] else 0 end from generate_series(1, 24) p;

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('Formula 1 Sprint', 'Formula 1', '2026. Top 8 score. Places 9 to 24 are entered as 0.', 'https://racingnews365.com/f1-rules-explained')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, case when p <= 8 then 9 - p else 0 end from generate_series(1, 24) p;

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('IndyCar Series', 'NTT IndyCar Series', '2026 as described by openwheelworld.net, not checked against the official rulebook (the official page returned "not found"). Excludes the Indianapolis 500, which has its own points. The real table gives 5 points from 25th down; this one stops at 24th.', 'https://www.openwheelworld.net/en/indycar101/80/Points_System')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, (array[50,40,35,32,30,28,26,24,22,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6])[p] from generate_series(1, 24) p;
  insert into public.points_bonuses (points_system_id, name, kind, points, description) values
    (sid, 'Pole position', 'bonus', 1, null),
    (sid, 'Led a lap', 'bonus', 1, null),
    (sid, 'Led the most laps', 'bonus', 2, 'In addition to the point for leading a lap');

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('NASCAR Cup Series (finishing points)', 'NASCAR Cup Series', '2026. Sources state: 1st = 55, 2nd = 35, 3rd = 34, 4th = 33. 5th onward is derived by me as one less per place, so check it. The real field is 40 cars and 36th to 40th get 1; this table stops at 24th, where a place is worth 13. Stage points (top 10 in stages 1 and 2) are not included because this tool has no per-position stage points yet.', 'https://www.nascar.com/?p=497155')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, case when p = 1 then 55 else 37 - p end from generate_series(1, 24) p;

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('Supercars 2026: Sprint race (80 for a win)', 'Repco Supercars Championship', '2026 Sprint Cup, Rounds 3-5 and 8-9, Races 1 and 2. From the Wikipedia page, not checked against the official rulebook. The real table runs to 25th; this one stops at 24th. Points only go to cars that finish at least 75% of the distance, and that rule is not enforced here.', 'https://en.wikipedia.org/wiki/2026_Supercars_Championship')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, (array[80,74,68,62,57,53,49,45,41,38,35,32,29,27,25,23,21,19,18,16,15,14,13,12])[p] from generate_series(1, 24) p;
  insert into public.points_bonuses (points_system_id, name, kind, points, description) values (sid, 'Fastest lap', 'bonus', 5, null);

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('Supercars 2026: Sprint race 3 (140 for a win)', 'Repco Supercars Championship', '2026 Sprint Cup, Rounds 3-5 and 8-9, Race 3. From the Wikipedia page, not checked against the official rulebook. Stops at 24th. The 75% distance rule is not enforced here.', 'https://en.wikipedia.org/wiki/2026_Supercars_Championship')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, (array[140,129,118,109,100,92,85,78,72,66,61,56,51,47,44,40,37,34,31,29,26,24,22,21])[p] from generate_series(1, 24) p;
  insert into public.points_bonuses (points_system_id, name, kind, points, description) values (sid, 'Fastest lap', 'bonus', 5, null);

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('Supercars 2026: Enduro (300 for a win)', 'Repco Supercars Championship', '2026 Enduro Cup (The Bend 500 and Bathurst 1000). From the Wikipedia page, not checked against the official rulebook. Stops at 24th. No fastest-lap bonus is listed for it. The Finals Series and some other sprint formats use different tables not included here.', 'https://en.wikipedia.org/wiki/2026_Supercars_Championship')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, (array[300,276,258,240,222,204,192,180,168,156,144,138,132,126,120,114,108,102,96,90,84,78,72,66])[p] from generate_series(1, 24) p;

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('BTCC 2026: Race', 'British Touring Car Championship', '2026 Sunday races: top 15 score, places 16 to 24 are entered as 0. Two sources agree on this table. BTCC also gives bonus points for fastest lap and leading a lap, but the 2026 sources do not give the amounts, so no bonuses are included. Add them yourself once you have confirmed them.', 'https://www.touringcartimes.com/2025/11/24/btcc-confirms-points-system-for-new-qualifying-race')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, case when p <= 15 then (array[20,17,15,13,11,10,9,8,7,6,5,4,3,2,1])[p] else 0 end from generate_series(1, 24) p;

  insert into public.points_systems (name, source_series, source_version, source_url)
  values ('BTCC 2026: Qualifying race', 'British Touring Car Championship', '2026 new qualifying race: top 15 score (half the points of a Sunday race), no bonus points. Places 16 to 24 are entered as 0.', 'https://www.touringcartimes.com/2025/11/24/btcc-confirms-points-system-for-new-qualifying-race')
  returning id into sid;
  insert into public.points_table_entries (points_system_id, position, points)
  select sid, p, case when p <= 15 then (array[10,9,8,7,6,5,5,4,4,3,3,2,2,1,1])[p] else 0 end from generate_series(1, 24) p;
end $$;
