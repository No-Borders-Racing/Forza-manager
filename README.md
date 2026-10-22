# Forza Championship Manager

A league manager for Forza Motorsport (2023): championships, seasons, recurring event schedules with proper time zones, cars and classes, tracks and race distances, results and standings, and a public calendar.

Status: database is live on Supabase. The admin app (`admin/`) has login, championships, seasons and events so far. Recurring schedules, importers, classes, build specs, results and the public page are not built yet.

## Stack

- Database and login: Supabase (PostgreSQL)
- Hosting: GitHub Pages (static site that talks to Supabase from the browser)
- Because the site's code is public, security comes from login and row level security in the database, not from hiding pages.

## Scope

1. Championships, seasons and events, with recurring schedules and time zones, and one free-text notes field per event.
2. Cars, classes and eligibility, using an imported car catalogue.
3. Tracks, layouts (including reverse variants) and a distance calculator, using an imported track list.
4. Build specs per car per championship: admin-defined fields, tune policy, notes.
5. Results, an admin-defined points system, and standings.
6. A public calendar and standings page.

Deliberately left out: any attempt to list or control Forza's lobby settings. Race conditions go in the event notes.

## Design decisions in `supabase/schema.sql`

**Blank stays blank.** Championship settings are nullable and start empty. The only defaults are system states: a new championship is `draft`, a new event is `scheduled`, imported cars and tracks are `unverified`. A points table entry or status rule that does not exist means "not set", never zero.

**Publishing is guarded.** A database trigger refuses to publish a championship until it has visibility, an intended time zone, at least one season with start and end dates, and a date and time for every event that is not cancelled. `championship_missing_items(id)` returns the list so the admin screen can show what is left. The check runs when the championship itself is saved as published. An event added or edited afterwards is not blocked, so the app should call `championship_missing_items` after event edits and warn the admin.

**Time zones.** Each event stores an exact instant (`starts_at`, timestamptz) and the IANA zone it was meant in (`timezone`, validated against the database's zone list). Viewers see it converted in their own browser.

**Recurring schedules.** `event_series` holds the rule. Events are generated as real rows. A unique index on `(series_id, occurrence_date)` stops regeneration from creating duplicates. `original_starts_at` keeps what the rule produced, and `is_override` marks an event that has been moved or edited, so the original schedule and the overrides stay distinguishable. Cancelling keeps the row with status `cancelled`.

**Classes are rules, not car lists.** A class has include and exclude rules by division, by admin-defined category, or by individual car. Precedence, most specific first: exclude car, include car, exclude division or category, include division or category, otherwise not eligible. Official Forza divisions (a column on `cars`) are kept apart from admin categories (`categories`).

**Builds are separate from the catalogue.** `build_specs` is per championship and per car. The tune policy (`drivers_own` or `prescribed`) is independent of the build type. The upgrade fields live in `spec_fields`, seeded from screenshots of the in-game Upgrade Shop (8 tabs, using the game's own part names), and the admin can edit them. Each field a build sets is one row in `build_spec_values`: a rule (allowed, prohibited, required or note), an optional part tier (stock, street, sport or race) and free text. For an allowed part the tier is the highest permitted; for a required part it is the tier that must be fitted. A new build spec starts with every part at Required, Stock tier, like a stock car in the game's shop, so the manager only changes the parts that may be upgraded (this is the one deliberate exception to "blank stays blank", requested by the league admin, and a trigger applies it, including to parts added later). Wheels are the exception to the tier list: a build spec has stock wheels, or an aftermarket wheel chosen by category then style, which also opens a rim size (stored on `build_specs` as `wheel_source`, `wheel_category`, `wheel_style`, `rim_size`; category, style and rim size are free text because the game's lists are not in any data source). A part with no row is left out. Not every car offers every part or tier, so the app records the rule and cannot check availability.

**Results.** Each result stores its status, position and which points system scored it, and every change is written to `results_audit`. Points are calculated by application code from approved results, so a change to the scoring rules can be applied to future results only or recalculated across past ones, as the admin chooses.

**Public access.** Anonymous visitors can read only published, public championships and what hangs off them. The imported `cars` and `track_*` tables are admin-only because the licence of the community data is unverified. Visitors see cars by name and tracks by layout through `public_class_cars`, `public_races` and `public_build_specs`.

**Lobby and race start.** A season's schedule has an optional lobby-open time and a race start time, both in the league time zone. Every round inherits both, and either can be changed on a single round. The lobby must open at or before the race start on the same day. A database that was created before this was added needs `supabase/migrations/001_lobby_time.sql` run once.

**Points systems.** A championship has any number of named points systems, each with points per position, optional DNF/DNS/DSQ points and bonuses or penalties. A library of real-world tables (`supabase/points_library.sql`, run once after the schema) can be copied into a championship and edited; each library row records its source and caveats. The tool does not yet model per-position stage points (NASCAR stages).

## Not done yet

- The licence of the FM23Data files has not been checked, and there is no licence file in that repository.
- Imported car and track values are unverified community data.
- The schema has not been run against a real Supabase project.
- Admin app: login, championships, seasons and events are built and were tested only against a fake in-memory database, not your real Supabase project.
- No importer, schedule generator, class, build spec, results or scoring screens yet, and no public page.

## Setup (when the app exists)

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Create your admin user under Authentication, then add them to `public.admins` (the exact statement is at the top of the schema file).
4. Put only the project URL and the public anon key in the site's config. Never commit the `service_role` key.
