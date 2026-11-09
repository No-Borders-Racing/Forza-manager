# Forza Championship Manager

A league manager for Forza Motorsport (2023). League admins build the data (championships, seasons, rounds, cars, builds, results) in the admin app. Everyone else sees the finished result on public pages: a league home page, a page per championship, season calendars and car build sheets.

Live site: https://no-borders-racing.github.io/Forza-manager/ (admin at `/admin/`).

## Stack

- Database and login: Supabase (PostgreSQL, row level security).
- Hosting: GitHub Pages, a static site that talks to Supabase from the browser. No build step.
- The site's code is public, so security is login plus row level security in the database, never hidden pages. Only the project URL and the public anon key go in `admin/js/config.js`. Never commit the `service_role` key.

## Layout

| Path | What it is |
| --- | --- |
| `admin/` | The manager app: `index.html`, `js/app/` (the app, one file per section: core, nav, auth, leagues, home, sharing, leaguesettings, drivers, championships, schedule, seasons, rounds, points, cars, tracks, results, main; they share one global scope and load in the order listed in `index.html`), `js/schedule.js` and `js/tz.js` (round generation and time zones), `builds/sheet.html` (the custom build sheet; also the public build page when opened with `?pub=<id>`). |
| `league/` | Public league page (`?l=<league id>`) and public championship page (`?c=<championship id>`). |
| `calendar/` | Public season calendar (`?s=<season id>`). |
| `assets/` | `app.css` (the one stylesheet for the admin and every public page), `public.css`, `chrome.js` (top bar, nav bar and footer on public pages), `public.js` (helpers shared by the public pages), `menu.js` (the hamburger menu), `og.png` (social preview image). |
| `results/engine.js` | The scoring engine. Points are worked out in application code and stored on each result. |
| `supabase/` | `schema.sql` (the full schema, for a fresh project), `migrations/` (001 to 031, each change in order, for an existing project), `points_library.sql` (real-world points tables, run once after the schema). |

## How it fits together

**Structure.** League, then championship, then season, then round (stored in `events`), then race. Every league is its own folder: its championships, drivers, points systems, build sheets and admins are visible and editable only to that league's admins.

**Roles.** Site owners (rows in `admins`) create and delete leagues and logins and maintain the shared car and track lists. League admins (`league_admins`) manage their own league. A new login can be created from the app, with a username instead of an email and a forced password change on first sign-in.

**Public pages.** Everything is Public by default. A "Who can view?" setting (Public or Admin only) on a league page, championship page, season calendar or build controls what visitors see. Anonymous visitors cannot read any table directly: they call `security definer` functions (`public_league`, `public_championship`, `public_calendar`, `public_build`) that return exactly what a page shows, and only when that item is Public. A build only shows once it is marked complete. Driver gamertags are never exposed, only display names. Signed-in admins see the app's nav bar on every public page. Admins land on the manager Home (quick actions and the next race, with the latest results and standings in a sidebar); the public league page uses the same two-column layout and opens from the "View league page" button. Who can view each page, with its share link, is under League settings > Sharing.

**Time zones.** Each round stores an exact instant (`starts_at`) and the IANA zone it was meant in. Public pages show every date and time in the viewer's own zone.

**Schedules.** A season supplies a start date and a number of rounds, generated from the championship's pattern (weekly, fortnightly, monthly or custom). Moving a season's start shifts every round. Rounds can be swapped, skipped or edited singly.

**Results and points.** Drivers are per league. Results are typed from the game's results screen. Each championship has named points systems (copyable from the library), chosen per race. Standings are the sum of the points stored on the results.

**Cars and builds.** The Cars page holds the stock catalogue and the league's saved custom builds. A build is a build sheet saved under its own name, so one car can have several versions.

**Palettes.** Each league picks a colour palette (`data-palette` on `<html>`). The admin, the public pages and the build sheet all follow it.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor, then `supabase/points_library.sql`.
3. Create your login under Authentication and add it to `public.admins` (the exact statement is at the top of the schema file).
4. Put the project URL and the public anon key in `admin/js/config.js`.
5. Turn on GitHub Pages for the repository. In Supabase, switch "Confirm email" off while testing with made-up addresses.

An existing project is updated by running any migrations it is missing, in order, from `supabase/migrations/`. `schema.sql` already contains all of them.

## Not done yet

- A real sign-up flow with email confirmation and password reset (today, an owner creates logins).
- The AI results scan (reading results from a screenshot).
- The licence of the FM23Data car and track files has not been checked, and imported values are unverified community data. For that reason the `cars` and `track_*` tables are admin-only; visitors see cars by name only through builds.
- Deliberately left out: anything that lists or controls Forza's lobby settings. Race conditions go in the event notes.
