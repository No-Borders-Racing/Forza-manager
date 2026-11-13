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
| `supabase/` | `schema.sql` (the full schema, for a fresh project), `migrations/` (001 to 038, each change in order, for an existing project), `points_library.sql` (real-world points tables, run once after the schema). |

## How it fits together

**Structure.** League, then championship, then season, then round (stored in `events`), then race. Every league is its own folder: its championships, drivers, points systems, build sheets and admins are visible and editable only to that league's admins.

**Roles.** Site owners (rows in `admins`) create and delete leagues and logins and maintain the shared car and track lists. League admins (`league_admins`) manage their own league. A new login can be created from the app, with a username instead of an email and a forced password change on first sign-in.

**Overviews.** A league and each championship have an overview text, shown at the top of the public league page, championship page and season calendar (migration 037).

**Public pages.** Everything is Public by default. A "Who can view?" setting (Public or Admin only) on a league page, championship page or season calendar controls what visitors see. Build sheets are always public by link (migration 038), with a Share button for social apps. Anonymous visitors cannot read any table directly: they call `security definer` functions (`public_league`, `public_championship`, `public_calendar`, `public_build`) that return exactly what a page shows, and only when that item is Public. Driver gamertags are never exposed, only display names. Signed-in admins see the app's nav bar on every public page. Admins land on the manager Home (quick actions and the next race, with the latest results and standings in a sidebar); the public league page uses the same two-column layout and opens from the "View league page" button. Who can view each page, with its share link, is under League settings > Sharing.

**Owner Admin page.** The site owner (the account in `owners`) gets an Admin button in the menu with three tabs: Site overview (per league: admins, championships, drivers, results, last activity; counts only, no names or emails), Admins and logins (the same tools as League settings, for any league), and Health and usage (database size against the 500 MB free limit with an 80% warning, row counts, and a "Run a test" for the screenshot reader). Data comes from `owner_site_overview()` and `owner_db_stats()` (migration 035), both refused for anyone but the owner.

**Places gained and lost, and driver stats.** Each result can carry the places gained (+) or lost (-) that the game's results screen shows next to the position (migration 036). It is entered on the Results page and the screenshot reader fills it in; the reader also warns when the screen says "Race in progress". It shows on the public results tables and never changes standings or points. A hidden field `championships.track_places` (default on, no admin screen) turns it off for one championship; it is off for Friday GTX Stock Car Racing. The public league page has a Stats tab (`league/stats.js`): a sortable table of every driver, a driver card (championship titles, podium split, average finish, fastest laps by track, distance, places gained and lost) and a head to head. It is worked out in the browser from the same `public_championship` data the results pages use, so it shows only what visitors can already see. A title is awarded when every round of a season is completed.

**Reading results from an image.** On a race's results page, "Read from a screenshot or photo" fills the rows from the game's results screen using Google Gemini. It runs as the Supabase Edge Function `supabase/functions/read-results`, so the Gemini key stays on the server: set the secret `GEMINI_API_KEY` (Edge Functions > Secrets) and deploy the function. Only signed-in admins of the league can use it. Nothing is saved until the admin has checked the rows and pressed Save results.

**Divisions.** A division (Cars page > Divisions) is a named group of cars with rules every car must follow: a PI limit, minimum weight, other rules, and a level (Open, Stock, Street, Sport, Race) for each build-sheet part. Cars are chosen with the same search and filters as builds, including adding a whole game division. A championship adds a division from its Cars tab, and its Car builds tab then shows the rules and the eligible cars. Car names in a division are shown publicly, the same as builds.

**Time zones.** Each round stores an exact instant (`starts_at`) and the IANA zone it was meant in. Public pages show every date and time in the viewer's own zone.

**Schedules.** A season supplies a start date and a number of rounds, generated from the championship's pattern (weekly, fortnightly, monthly or custom). Moving a season's start shifts every round. Rounds can be swapped, skipped or edited singly.

**Results and points.** Drivers are per league. Results are typed from the game's results screen. Each championship has named points systems (copyable from the library), chosen per race. Standings are the sum of the points stored on the results.

**Cars and builds.** The Cars page holds the stock catalogue and the league's saved custom builds. A build is a build sheet saved under its own name, so one car can have several versions. A championship's Cars tab is the same Search / Builds / Divisions page plus an "In this championship" list of the cars it allows.

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
- The licence of the FM23Data car and track files has not been checked, and imported values are unverified community data. For that reason the `cars` and `track_*` tables are admin-only; visitors see cars by name only through builds.
- Deliberately left out: anything that lists or controls Forza's lobby settings. Race conditions go in the event notes.
