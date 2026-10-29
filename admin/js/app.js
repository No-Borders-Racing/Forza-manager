(function () {
  "use strict";
  var TZ = window.FCM_TZ, SCH = window.FCM_SCHEDULE, cfg = window.FCM_CONFIG;
  var app = document.getElementById("app");
  var sb = window.supabase.createClient(cfg.url, cfg.key);
  var zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).slice();
  if (zones.indexOf("UTC") < 0) zones.unshift("UTC");
  var viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  var plans = {}; // preview of generated rounds per season, waiting for the admin to confirm
  var armed = null; // key of the delete button that has been clicked once

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function opts(list, cur, blank) {
    return '<option value="">' + esc(blank) + "</option>" + list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(l) + "</option>";
    }).join("");
  }
  // Time zone dropdown: popular zones first, then every other zone. Values stay as IANA names
  // (needed for daylight saving); the label shows today's offset from GMT.
  var COMMON = [
    ["Australia/Sydney", "Sydney, Australia"], ["Australia/Melbourne", "Melbourne, Australia"], ["Australia/Brisbane", "Brisbane, Australia"],
    ["Australia/Adelaide", "Adelaide, Australia"], ["Australia/Perth", "Perth, Australia"], ["Pacific/Auckland", "Auckland, New Zealand"],
    ["America/New_York", "US Eastern (New York)"], ["America/Chicago", "US Central (Chicago)"], ["America/Denver", "US Mountain (Denver)"],
    ["America/Los_Angeles", "US Pacific (Los Angeles)"], ["America/Toronto", "Toronto, Canada"], ["Europe/London", "London, UK"],
    ["Europe/Berlin", "Central Europe (Berlin)"], ["Asia/Tokyo", "Tokyo, Japan"], ["Asia/Singapore", "Singapore"], ["UTC", "UTC"]
  ];
  function gmt(tz) {
    var m = Math.round(TZ.offsetMs(Date.now(), tz) / 60000), a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
    return "GMT" + (m < 0 ? "-" : "+") + h + (mm ? ":" + (mm < 10 ? "0" : "") + mm : "");
  }
  function zoneOpts(cur, blank) {
    function one(v, label) { return '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(label + " · " + gmt(v)) + "</option>"; }
    var common = COMMON.filter(function (c) { return zones.indexOf(c[0]) >= 0; });
    var names = common.map(function (c) { return c[0]; });
    return '<option value="">' + esc(blank) + "</option>" +
      '<optgroup label="Common">' + common.map(function (c) { return one(c[0], c[1]); }).join("") + "</optgroup>" +
      '<optgroup label="All other time zones">' + zones.filter(function (z) { return names.indexOf(z) < 0; }).map(function (z) { return one(z, z.replace(/_/g, " ")); }).join("") + "</optgroup>";
  }
  function browserZone() {
    try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z && zones.indexOf(z) >= 0 ? z : null; } catch (e) { return null; }
  }
  function msg(el, text, kind) { if (el) { el.className = "msg " + (kind || ""); el.textContent = text || ""; } }
  function nul(v) { v = (v || "").trim(); return v === "" ? null : v; }
  function numOrNull(v) { v = (v || "").trim(); return v === "" || !isFinite(Number(v)) ? null : Number(v); }
  function dbError(e) { return e && e.message ? e.message : "Something went wrong."; }

  var state = { user: null, admin: false, champs: [], sel: null };

  /* ---------- sign in ---------- */
  function showLogin(note) {
    $("#who").textContent = "";
    app.innerHTML = '<div class="card" style="max-width:380px;margin:40px auto"><h2>Sign in</h2>' +
      '<div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username"></div>' +
      '<div class="field" style="margin-top:8px"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"></div>' +
      '<div class="msg err" id="lm">' + esc(note || "") + '</div><button class="primary" id="go" type="button">Sign in</button></div>';
    var go = function () {
      var b = $("#go"); b.disabled = true; msg($("#lm"), "Signing in…");
      sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value }).then(function (r) {
        b.disabled = false;
        if (r.error) { msg($("#lm"), r.error.message, "err"); return; }
        boot();
      });
    };
    $("#go").addEventListener("click", go);
    $("#pw").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }
  function boot() {
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) { showLogin(); return; }
      state.user = s.user;
      $("#who").innerHTML = esc(s.user.email) + ' · <button id="out" type="button">Sign out</button>';
      $("#out").addEventListener("click", function () { sb.auth.signOut().then(function () { state.admin = false; showLogin(); }); });
      sb.rpc("is_admin").then(function (a) {
        if (a.error) { app.innerHTML = '<div class="card err">Could not check admin access: ' + esc(a.error.message) + "</div>"; return; }
        state.admin = a.data === true;
        if (!state.admin) { app.innerHTML = '<div class="card"><h2>Signed in, but not an admin</h2><p>This login is not in the admins list, so it cannot change anything. Add it to the <code>admins</code> table in Supabase.</p></div>'; return; }
        sb.rpc("is_owner").then(function (o) {
          state.owner = o.data === true;
          loadLeagues();
        });
      });
    });
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  // Each league is its own folder: the admin works inside one league at a time.
  function loadLeagues(pick) {
    sb.from("leagues").select("id,name,slug,timezone,units").order("name", { ascending: true }).then(function (r) {
      if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + " Has migration 008 (leagues) been run?</div>"; return; }
      state.leagues = r.data || [];
      var want = pick || lsGet("fcm.league"), cur = state.leagues.filter(function (l) { return l.id === want; })[0] || (state.leagues.length === 1 ? state.leagues[0] : null);
      if (!cur) { renderLeaguePicker(); return; }
      state.league = cur; lsSet("fcm.league", cur.id); loadChamps();
    });
  }
  function renderLeaguePicker() {
    app.innerHTML = '<div class="card"><h2>Choose a league</h2>' +
      (state.leagues.length ? '<div class="list">' + state.leagues.map(function (l) {
        return '<button type="button" class="item" data-lg="' + esc(l.id) + '"><span>' + esc(l.name) + "</span></button>";
      }).join("") + "</div>" : '<p class="muted">' + (state.owner ? "No leagues yet. Create the first one below." : "This login is not an admin of any league yet. Ask a league admin to add you.") + "</p>") + "</div>" +
      (state.owner ? '<div class="card"><h3 style="margin-top:0">New league</h3><div class="row"><div class="field grow"><label for="nln">League name</label><input id="nln" type="text"></div><button class="primary" id="nlgo" type="button">Create league</button></div><div class="msg" id="nlm"></div></div>' : "");
    app.querySelectorAll("[data-lg]").forEach(function (b) { b.addEventListener("click", function () { loadLeagues(b.dataset.lg); }); });
    var go = $("#nlgo");
    if (go) go.addEventListener("click", function () {
      var n = $("#nln").value.trim(); if (!n) { msg($("#nlm"), "Type a name first.", "err"); return; }
      sb.rpc("create_league", { league_name: n, league_slug: null }).then(function (x) {
        if (x.error) { msg($("#nlm"), dbError(x.error), "err"); return; }
        loadLeagues(x.data);
      });
    });
  }

  /* ---------- championships ---------- */
  function loadChamps() {
    sb.from("championships").select("id,name,status,visibility").eq("league_id", state.league.id).order("created_at", { ascending: false }).then(function (r) {
      if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + "</div>"; return; }
      state.champs = r.data; state.sel = null;
      renderChampList();
    });
  }
  function navHtml(active) {
    return '<div class="row" style="margin-bottom:12px">' + [["c", "Championships"], ["d", "Drivers"], ["p", "Points systems"], ["l", "League settings"]].map(function (t) {
      return '<button type="button" id="nav-' + t[0] + '"' + (t[0] === active ? ' class="primary"' : "") + ">" + t[1] + "</button>";
    }).join("") + "</div>";
  }
  function bindNav() {
    var c = $("#nav-c"), p = $("#nav-p"), l = $("#nav-l"), d = $("#nav-d");
    if (d) d.addEventListener("click", renderDrivers);
    if (c) c.addEventListener("click", renderChampList);
    if (p) p.addEventListener("click", renderLeaguePoints);
    if (l) l.addEventListener("click", renderLeague);
  }
  function renderLeague() { renderLeagueBody(); }
  function renderLeaguePoints() { loadLeaguePts(renderLeaguePointsBody); }
  function renderLeaguePointsBody() {
    app.innerHTML = navHtml("p") +
      '<div class="card"><h2>Points systems</h2><p class="muted" style="margin:0 0 8px">Saved for the whole league. Pick one for a championship and it is copied there, so changing it here never changes a running championship.</p><div class="list">' +
      (state.lpts.length ? state.lpts.map(function (x) { return '<button type="button" class="item" data-lpp="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="muted">' + esc(x.source_series ? "from " + x.source_series : "custom") + "</span></button>"; }).join("") : '<p class="muted">None yet.</p>') + "</div>" +
      '<div class="row" style="margin-top:10px"><div class="field grow"><label for="lplib">Start from</label><select id="lplib">' + fromOpts([], state.master) + '</select></div><button class="primary" id="lpadd" type="button">Add points system</button></div><div class="msg" id="lpm"></div></div>';
    bindNav();
    $("#lpadd").addEventListener("click", addLeaguePoints);
    app.querySelectorAll("[data-lpp]").forEach(function (b) { b.addEventListener("click", function () { state.pscope = "league"; state.nav = { view: "points", pid: b.dataset.lpp }; renderPoints(b.dataset.lpp); }); });
  }
  function renderLeagueBody() {
    var lg = state.league || {}, tz = lg.timezone || browserZone() || "";
    app.innerHTML = navHtml("l") +
      '<div class="card"><h2>League settings</h2><div class="field"><label for="ln">League name</label><input id="ln" value="' + esc(lg.name || "") + '"></div>' +
      '<div class="field" style="margin-top:8px"><label for="lz">League time zone</label><select id="lz">' + zoneOpts(tz, "Not set") + '</select></div>' +
      '<div class="field" style="margin-top:8px"><label for="lu">Units of measurement</label><select id="lu">' + opts([["imperial", "Imperial (hp, lb-ft, lbs, mi)"], ["metric", "Metric (kW, N·m, kg, km)"]], lg.units || "", "Not set") + '</select></div>' +
      '<p class="muted" style="margin:6px 0 0">' + (lg.timezone ? "New championships start with this time zone. Viewers still see every time in their own local time." : "Not saved yet. The time zone shown is detected from this browser; click Save to keep it.") + '</p>' +
      '<div class="row" style="margin-top:8px"><button class="primary" id="lsave" type="button">Save</button></div><div class="msg" id="lm"></div></div>' +
      '<div class="card"><h2>Admins</h2><div id="ladmins" class="muted">Loading…</div>' +
      '<h3>Add an admin</h3><p class="muted" style="margin:0 0 6px">They need a login first: create it in Supabase under Authentication, Users. Then enter the same email here.</p>' +
      '<div class="row"><div class="field grow"><label for="lae">Email</label><input id="lae" type="email"></div><button id="laadd" type="button">Add admin</button></div><div class="msg" id="lam"></div></div>';
    bindNav();
    $("#lsave").addEventListener("click", function () {
      var row = { name: nul($("#ln").value), timezone: nul($("#lz").value), units: nul($("#lu").value) };
      if (!row.name) { msg($("#lm"), "A league needs a name.", "err"); return; }
      sb.from("leagues").update(row).eq("id", state.league.id).then(function (r) {
        if (r.error) { msg($("#lm"), dbError(r.error), "err"); return; }
        state.league = Object.assign({}, state.league, row);
        state.leagues = state.leagues.map(function (l) { return l.id === state.league.id ? state.league : l; });
        msg($("#lm"), "Saved.", "ok");
      });
    });
    function loadAdmins() {
      sb.rpc("list_league_admins", { lid: state.league.id }).then(function (r) {
        var el = $("#ladmins");
        if (r.error) { el.className = "err"; el.textContent = dbError(r.error) + " (has migration 008 been run?)"; return; }
        el.className = "";
        el.innerHTML = r.data.map(function (a) {
          var me = state.user && a.user_id === state.user.id;
          return '<div class="row" style="justify-content:space-between;align-items:center;margin:4px 0"><span>' + esc(a.email) + (me ? ' <span class="pill">you</span>' : "") + "</span>" +
            (me ? "" : '<button type="button" class="danger" data-ladel="' + esc(a.user_id) + '">Remove</button>') + "</div>";
        }).join("");
        el.querySelectorAll("[data-ladel]").forEach(function (b) { b.addEventListener("click", function () {
          sb.rpc("remove_league_admin", { lid: state.league.id, uid: b.dataset.ladel }).then(function (x) { if (x.error) msg($("#lam"), dbError(x.error), "err"); else loadAdmins(); });
        }); });
      });
    }
    loadAdmins();
    $("#laadd").addEventListener("click", function () {
      var e = $("#lae").value.trim(); if (!e) { msg($("#lam"), "Type an email first.", "err"); return; }
      sb.rpc("add_league_admin", { lid: state.league.id, admin_email: e }).then(function (x) {
        if (x.error) { msg($("#lam"), dbError(x.error), "err"); return; }
        $("#lae").value = ""; msg($("#lam"), "Added.", "ok"); loadAdmins();
      });
    });
  }
  function renderChampList() {
    var lg = state.league;
    app.innerHTML = navHtml("c") + '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">' + esc(lg && lg.name ? lg.name : "League not named yet") + '</h2><span class="muted">League time zone: ' + esc(lg && lg.timezone ? lg.timezone : "not set") + '</span></div><div class="row">' + ((state.leagues || []).length > 1 || state.owner ? '<button type="button" id="switchbtn">Switch league</button>' : "") + '</div></div></div>' +
      '<div class="card"><h2>Championships</h2><div class="list">' +
      (state.champs.length ? state.champs.map(function (c) {
        return '<div style="display:flex;gap:6px;align-items:center"><button type="button" class="item" data-id="' + esc(c.id) + '"><span>' + esc(c.name) + '</span><span class="muted">' + esc(c.status) + (c.visibility ? " · " + esc(c.visibility) : " · visibility not set") + '</span></button><button type="button" class="danger" data-ldel="' + esc(c.id) + '">Delete</button></div>';
      }).join("") : '<p class="muted">None yet.</p>') + '</div><div id="ldelbox"></div></div>' +
      '<div class="card"><h3 style="margin-top:0">New championship</h3><div class="row"><div class="field grow"><label for="nn">Name</label><input id="nn" type="text"></div><button class="primary" id="nadd" type="button">Create</button></div><div class="msg" id="nm"></div>' +
      '<p class="muted">It starts as a draft. The time zone is filled in from the league settings, or from this browser if the league has none (you can change it on the championship page); every other setting is blank.</p></div>';
    app.querySelectorAll("button.item").forEach(function (b) { b.addEventListener("click", function () { openChamp(b.dataset.id); }); });
    app.querySelectorAll("[data-ldel]").forEach(function (b) { b.addEventListener("click", function () {
      var c = state.champs.filter(function (x) { return x.id === b.dataset.ldel; })[0], box = $("#ldelbox");
      box.innerHTML = '<div class="card" style="border-color:var(--err)"><p style="margin:0 0 8px">Permanently delete <b>' + esc(c.name) + '</b> with all of its seasons, rounds, races, points systems, classes and race format? It cannot be undone. Type its name to confirm.</p>' +
        '<div class="row"><div class="field grow"><label for="ldn">Championship name</label><input id="ldn" autocomplete="off"></div><button class="danger" id="ldgo" type="button" disabled>Delete</button><button id="ldno" type="button">Cancel</button></div><div class="msg" id="ldm"></div></div>';
      var inp = $("#ldn"); inp.focus();
      inp.addEventListener("input", function () { $("#ldgo").disabled = inp.value.trim() !== c.name; });
      $("#ldno").addEventListener("click", function () { box.innerHTML = ""; });
      $("#ldgo").addEventListener("click", function () {
        $("#ldgo").disabled = true; msg($("#ldm"), "Deleting…");
        sb.from("championships").delete().eq("id", c.id).then(function (r) {
          if (r.error) { msg($("#ldm"), dbError(r.error), "err"); $("#ldgo").disabled = false; return; }
          loadChamps();
        });
      });
    }); });
    bindNav();
    if ($("#switchbtn")) $("#switchbtn").addEventListener("click", renderLeaguePicker);
    $("#nadd").addEventListener("click", function () {
      var n = $("#nn").value.trim(); if (!n) { msg($("#nm"), "Type a name first.", "err"); return; }
      sb.from("championships").insert({ name: n, league_id: state.league.id, intended_timezone: (state.league && state.league.timezone) || browserZone() }).select("id").single().then(function (r) {
        if (r.error) { msg($("#nm"), dbError(r.error), "err"); return; }
        openChamp(r.data.id);
      });
    });
  }
  function openChamp(id, nav) {
    var prev = state.sel && state.sel.champ.id === id ? state.nav : null;
    if (!prev) state.tab = "settings";
    Promise.all([
      sb.from("championships").select("*").eq("id", id).single(),
      sb.from("seasons").select("*").eq("championship_id", id).order("starts_on", { ascending: true, nullsFirst: false }),
    ]).then(function (rs) {
      if (rs[0].error) { app.innerHTML = '<div class="card err">' + esc(dbError(rs[0].error)) + "</div>"; return; }
      var seasons = rs[1].data || [], ids = seasons.map(function (s) { return s.id; });
      var evP = ids.length ? sb.from("events").select("*").in("season_id", ids).order("starts_at", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] });
      var srP = ids.length ? sb.from("event_series").select("*").in("season_id", ids) : Promise.resolve({ data: [] });
      var psP = sb.from("points_systems").select("id,name,source_series,copied_from,copied_at").eq("championship_id", id).order("name", { ascending: true });
      var libP = sb.from("points_systems").select("id,name,source_series,source_version").is("championship_id", null).is("league_id", null).order("name", { ascending: true });
      var lpP = sb.from("points_systems").select("id,name,updated_at").eq("league_id", state.league.id).is("championship_id", null).order("name", { ascending: true });
      var tplP = sb.from("race_templates").select("*").eq("championship_id", id).order("sort_order", { ascending: true });
      var trkP = sb.from("track_layouts").select("id,venue_id,name,length_km,is_reverse,track_venues(name)").order("name", { ascending: true });
      Promise.all([evP, srP, psP, libP, tplP, trkP, lpP]).then(function (xs) {
        var evList = xs[0].data || [];
        var raceP = evList.length ? sb.from("races").select("*").in("event_id", evList.map(function (e) { return e.id; })).order("sort_order", { ascending: true }) : Promise.resolve({ data: [] });
        raceP.then(function (rr) {
          var bad = [xs[4], xs[5], rr].filter(function (x) { return x.error; })[0];
          if (bad) { app.innerHTML = '<div class="card err">' + esc(dbError(bad.error)) + ' Has the latest database change (migrations/003_round_race_structure.sql) been run?</div>'; return; }
          state.sel = { champ: rs[0].data, seasons: seasons, events: evList, series: xs[1].data || [], points: xs[2].data || [], library: xs[3].data || [], leaguePts: xs[6].data || [], templates: xs[4].data || [], races: rr.data || [] };
          state.tracks = xs[5].data || [];
          state.nav = nav || prev || { view: "champ" };
          if (state.nav.view === "season" && !seasons.some(function (x) { return x.id === state.nav.sid; })) state.nav = { view: "champ" };
          renderCurrent();
        });
      });
    });
  }
  function refreshMissing() {
    var c = state.sel.champ, el = $("#missing"); if (!el) return;
    sb.rpc("championship_missing_items", { cid: c.id }).then(function (r) {
      if (r.error) { el.innerHTML = '<span class="err">' + esc(dbError(r.error)) + "</span>"; return; }
      var m = r.data || [];
      el.innerHTML = m.length ? '<span class="err">Not ready to publish. Still missing:</span><ul class="missing">' + m.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : '<span class="ok">Nothing missing. This championship can be published.</span>';
      if (c.status === "published" && m.length) el.innerHTML += '<p class="err">It is already published, so visitors can see these gaps.</p>';
    });
  }

  function leagueZone() { return (state.league && state.league.timezone) || browserZone() || null; }
  state.tzTried = state.tzTried || {};
  function renderChamp() {
    var S = state.sel, c = S.champ, tab = state.tab || "settings";
    var tabs = [["settings", "Settings"], ["points", "Points"], ["seasons", "Seasons"], ["results", "Results"], ["standings", "Standings"]];
    var h = '<p><button type="button" id="back">← All championships</button></p>' +
      '<div class="card" style="padding-bottom:8px"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">' + esc(c.name) + ' <span class="pill">' + esc(c.status) + '</span></h2></div>' +
      '<div class="row" style="margin-top:10px">' + tabs.map(function (t) { return '<button type="button" data-tab="' + t[0] + '"' + (t[0] === tab ? ' class="primary"' : "") + ">" + t[1] + "</button>"; }).join("") + "</div></div>";
    if (tab === "settings") {
      // Older championships have no zone: fill it in from the league once, without a click.
      if (!c.intended_timezone && leagueZone() && !state.tzTried[c.id]) {
        state.tzTried[c.id] = true;
        sb.from("championships").update({ intended_timezone: leagueZone() }).eq("id", c.id).select("*").single().then(function (r) {
          if (!r.error && r.data && state.sel && state.sel.champ.id === c.id) { state.sel.champ = r.data; if (state.tab === "settings" || !state.tab) renderChamp(); }
        });
      }
      var tzNote = c.intended_timezone ? '<b>' + esc(c.intended_timezone) + '</b> · ' + esc(gmt(c.intended_timezone)) + ' <span class="muted">(the league time zone when this championship was created; viewers see times in their own zone)</span>' :
        '<span class="err">Not set.</span> <button type="button" id="cusetz">Use the league time zone (' + esc(leagueZone() || "none found") + ")</button>";
      h += '<div class="card"><div class="row"><div class="field"><label for="cv">Visibility</label><select id="cv">' + opts([["public", "Public"], ["private", "Private"]], c.visibility, "Not set") + "</select></div>" +
        '<div class="field"><label for="cs">Status</label><select id="cs">' + opts([["draft", "Draft"], ["published", "Published"], ["archived", "Archived"]], c.status, "") .replace('<option value=""></option>', "") + "</select></div></div>" +
        '<p style="margin:10px 0 0"><span class="lbl">Time zone</span><br>' + tzNote + "</p>" +
        '<h3>Schedule pattern</h3><p class="muted" style="margin:0 0 6px">Every season and round inherits this. A season only asks for a starting date and a number of rounds. Times are in the time zone above.</p>' +
        '<div class="row"><div class="field"><label for="cfreq">Frequency</label><select id="cfreq">' + opts([["1", "Weekly"], ["2", "Fortnightly"], ["3", "Every 3 weeks"], ["4", "Every 4 weeks"]], c.schedule_every_weeks == null ? "" : String(c.schedule_every_weeks), "Not set") + "</select></div>" +
        '<div class="field"><label for="clob">Lobby opens (optional)</label><input id="clob" type="time" value="' + esc(c.lobby_local_time ? String(c.lobby_local_time).slice(0, 5) : "") + '"></div>' +
        '<div class="field"><label for="crace">Race start</label><input id="crace" type="time" value="' + esc(c.race_local_time ? String(c.race_local_time).slice(0, 5) : "") + '"></div></div>' +
        '<div class="field" style="margin-top:8px"><label for="cd">Description</label><textarea id="cd">' + esc(c.description || "") + "</textarea></div>" +
        '<div class="row" style="margin-top:8px"><button class="primary" id="csave" type="button">Save</button><button id="crename" type="button">Rename</button><button class="danger" id="cgodel" type="button">Delete championship…</button></div><div class="msg" id="cm"></div>' +
        '<div id="renamebox"></div>' +
        '<h3>Ready to publish?</h3><div id="missing" class="muted">Checking…</div></div>';
      h += '<div class="card"><h3 style="margin-top:0">Delete this championship</h3><p class="muted" style="margin:0 0 8px">This permanently deletes the championship with all of its seasons, rounds, races, points systems, classes and race format. It cannot be undone. To confirm, type its name: <b>' + esc(c.name) + '</b></p>' +
        '<div class="row"><div class="field grow"><label for="cdn">Championship name</label><input id="cdn" autocomplete="off"></div><button class="danger" id="cdel" type="button" disabled>Delete championship</button></div><div class="msg" id="cdm"></div></div>';
    } else if (tab === "points") h += pointsCardHtml();
    else if (tab === "format") h += templateCardHtml();
    else if (tab === "results") h += resultsTabHtml();
    else if (tab === "standings") h += '<div class="card"><h2>Standings</h2><div id="stand" class="muted">Loading…</div></div>';
    else {
      h += '<div class="card"><h2>Seasons</h2><div class="list">' + (S.seasons.length ? S.seasons.map(function (x) {
        var n = S.events.filter(function (e) { return e.season_id === x.id; }).length;
        return '<button type="button" class="item" data-open="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="muted">' + (x.starts_on ? esc(x.starts_on) + " → " + esc(x.ends_on || "?") : "no dates yet") + " · " + n + " round" + (n === 1 ? "" : "s") + "</span></button>";
      }).join("") : '<p class="muted">No seasons yet.</p>') + '</div><div style="margin-top:10px"><button class="primary" id="newseason" type="button">Add a season</button></div></div>';
    }
    app.innerHTML = h;
    bindAll();
    refreshMissing();
    if (tab === "results") fillCounts();
    if (tab === "standings") renderStandings();
  }
  function renderCurrent() {
    var n = state.nav || { view: "champ" };
    if (n.view === "race") renderRaceResults(n.rid); else if (n.view === "points") renderPoints(n.pid); else if (n.view === "season") renderSeason(n.sid); else if (n.view === "newseason") renderNewSeason(); else renderChamp();
  }
  function renderSeason(sid) {
    var s = state.sel.seasons.filter(function (x) { return x.id === sid; })[0];
    app.innerHTML = '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>" + seasonHtml(s);
    bindAll();
  }
  function renderNewSeason() {
    app.innerHTML = '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>" +
      '<div class="card"><h2>New season</h2><div class="row"><div class="field grow"><label for="sn">Season name</label><input id="sn"></div></div><div class="msg" id="sm"></div>' +
      genHtml("new") + '<div class="row" style="margin-top:12px"><button id="sadd" type="button">Add season without rounds</button></div></div>';
    bindAll();
  }
  function bindAll() {
    function on(sel, fn) { app.querySelectorAll(sel).forEach(function (b) { b.addEventListener("click", function () { fn(b); }); }); }
    on("#back", function () { loadChamps(); });
    on("#backchamp", function () { state.nav = { view: "champ" }; renderCurrent(); });
    on("#newseason", function () { state.nav = { view: "newseason" }; renderCurrent(); });
    on("[data-open]", function (b) { state.nav = { view: "season", sid: b.dataset.open }; renderCurrent(); });
    on("[data-tab]", function (b) { state.tab = b.dataset.tab; renderChamp(); });
    on("#csave", saveChamp);
    on("#crename", function () {
      $("#renamebox").innerHTML = '<div class="row" style="margin-top:8px"><div class="field grow"><label for="cn">New name</label><input id="cn" value="' + esc(state.sel.champ.name) + '"></div></div><p class="muted" style="margin:4px 0 0">Click Save to apply.</p>';
      $("#cn").focus();
    });
    on("#cusetz", function () {
      var z = leagueZone(); if (!z) return;
      sb.from("championships").update({ intended_timezone: z }).eq("id", state.sel.champ.id).select("*").single().then(function (r) {
        if (r.error) { msg($("#cm"), dbError(r.error), "err"); return; }
        state.sel.champ = r.data; renderChamp();
      });
    });
    var cpts = $("#cpts"); if (cpts) cpts.addEventListener("change", function () {
      var v = nul(cpts.value);
      sb.from("championships").update({ points_system_id: v }).eq("id", state.sel.champ.id).select("*").single().then(function (r) {
        if (r.error) { msg($("#cptsm"), dbError(r.error), "err"); return; }
        state.sel.champ = r.data; msg($("#cptsm"), "Saved.", "ok");
      });
    });
    on("#cdel", deleteChamp);
    on("#cgodel", function () { var t = $("#cdn"); t.scrollIntoView({ block: "center" }); t.focus(); });
    var cdn = $("#cdn"); if (cdn) cdn.addEventListener("input", function () { $("#cdel").disabled = cdn.value.trim() !== state.sel.champ.name; });
    on("[data-rr]", function (b) { state.nav = { view: "race", rid: b.dataset.rr }; renderCurrent(); });
    on("[data-pp]", function (b) { state.pscope = "champ"; state.nav = { view: "points", pid: b.dataset.pp }; renderCurrent(); });
    on("#padd", addPoints);
    on("#tadd", function () { $("#tpl").insertAdjacentHTML("beforeend", templateRow({})); });
    on("[data-trm]", function (b) { b.closest(".trow").remove(); });
    on("#tsave", saveTemplates);
    on("[data-radd]", function (b) { $("#rc-" + b.dataset.radd).insertAdjacentHTML("beforeend", raceRow({}, b.dataset.radd)); });
    on("[data-rrm]", function (b) { b.closest(".rrow").remove(); });
    if (!app._trk) {
      app._trk = true;
      app.addEventListener("change", function (e) {
        var t = e.target, id = t.id || "";
        if (id.indexOf("etv-") === 0) { var k = id.slice(4), cur = document.getElementById("etk-" + k); cur.innerHTML = layoutOpts(t.value, ""); refreshDistances(k); calcUpdate(k, "etk"); }
        else if (id.indexOf("etk-") === 0) { refreshDistances(id.slice(4)); calcUpdate(id.slice(4), "etk"); }
      });
      app.addEventListener("input", function (e) {
        var t = e.target, id = t.id || "";
        if (t.hasAttribute && t.hasAttribute("data-rl")) { var rw = t.closest(".rrow"), bx = rw && rw.parentNode; if (bx && bx.id) refreshDistances(bx.id.slice(3)); return; }
        var m = id.match(/^(erl|ecl|ect|ecd)-(.+)$/); if (m) calcUpdate(m[2], m[1] === "erl" ? "" : m[1]);
      });
      app.addEventListener("click", function (e) {
        var t = e.target.closest && e.target.closest("[data-calcapply]"); if (!t) return;
        var k = t.dataset.calcapply, box = document.getElementById("ecr-" + k), laps = box && Number(box.dataset.laps);
        if (!laps) return;
        document.querySelectorAll("#rc-" + k + " [data-rl]").forEach(function (i) { i.value = laps; });
        refreshDistances(k);
      });
    }
    on("#psave", savePoints);
    on("#pbadd", function () { var box = $("#pbonus"); box.insertAdjacentHTML("beforeend", bonusRow({})); });
    on("[data-pbrm]", function (b) { b.closest(".brow2").remove(); });
    on("[data-pd]", function (b) { del("points_systems", b.dataset.pd, b); });
    on("[data-pupd]", function (b) { updateFromLeague($("#pid").value, b.dataset.pupd, b); });
    on("#lpback", function () { renderLeaguePoints(); });

    on("#sadd", addSeason);
    on("[data-sv]", function (b) { saveSeason(b.dataset.sv); });
    on("[data-sd]", function (b) { del("seasons", b.dataset.sd, b); });
    on("[data-gp]", function (b) { previewRounds(b.dataset.gp); });
    on("[data-gc]", function (b) { createRounds(b.dataset.gc); });
    on("[data-ea]", function (b) { addEvent(b.dataset.ea); });
    on("[data-es]", function (b) { saveEvent(b.dataset.es); });
    on("[data-ed]", function (b) { del("events", b.dataset.ed, b); });
    app.querySelectorAll("[data-gf]").forEach(function (el) { el.addEventListener("change", function () { delete plans[el.dataset.gf]; var pv = $("#gv-" + el.dataset.gf); if (pv) pv.innerHTML = ""; }); });
  }
  function deleteChamp() {
    var c = state.sel.champ, m = $("#cdm");
    if ($("#cdn").value.trim() !== c.name) { msg(m, "Type the championship name exactly to confirm.", "err"); return; }
    $("#cdel").disabled = true; msg(m, "Deleting…");
    sb.from("championships").delete().eq("id", c.id).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); $("#cdel").disabled = false; return; }
      loadChamps();
    });
  }
  function saveChamp() {
    var c = state.sel.champ, m = $("#cm");
    var patch = { name: $("#cn") ? $("#cn").value.trim() : c.name, visibility: nul($("#cv").value), description: nul($("#cd").value), status: $("#cs").value,
      schedule_every_weeks: numOrNull($("#cfreq").value), lobby_local_time: nul($("#clob").value), race_local_time: nul($("#crace").value) };
    if (!patch.name) { msg(m, "The name cannot be blank.", "err"); return; }
    if (patch.lobby_local_time && !patch.race_local_time) { msg(m, "Set the race start as well as the lobby time.", "err"); return; }
    if (patch.lobby_local_time && patch.lobby_local_time > patch.race_local_time) { msg(m, "The lobby must open at or before the race start, on the same day.", "err"); return; }
    msg(m, "Saving…");
    sb.from("championships").update(patch).eq("id", c.id).select("*").single().then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      state.sel.champ = r.data; renderChamp(); msg($("#cm"), "Saved.", "ok");
    });
  }

  /* ---------- seasons ---------- */
  function seasonHtml(s) {
    var evs = state.sel.events.filter(function (e) { return e.season_id === s.id; });
    var h = '<div class="card"><h2>Season: ' + esc(s.name) + "</h2>" +
      '<div class="row"><div class="field grow"><label for="sn-' + s.id + '">Name</label><input id="sn-' + s.id + '" value="' + esc(s.name) + '"></div>' +
      '<div class="field"><label for="ss-' + s.id + '">Starts</label><input id="ss-' + s.id + '" type="date" value="' + esc(s.starts_on || "") + '"></div>' +
      '<div class="field"><label for="se-' + s.id + '">Ends</label><input id="se-' + s.id + '" type="date" value="' + esc(s.ends_on || "") + '"></div>' +
      '<button data-sv="' + s.id + '" type="button">Save season</button><button class="danger" data-sd="' + s.id + '" type="button">Delete season</button></div><div class="msg" id="sm-' + s.id + '"></div>' +
      "<h3>Rounds (" + evs.length + ")</h3>";
    evs.forEach(function (e) { h += eventHtml(e); });
    h += genHtml(s.id);
    h += '<details class="ev" style="margin-top:12px"><summary><span class="muted">Add a single round outside the schedule</span></summary><div style="margin-top:10px">' + eventFields("new-" + s.id, {}) +
      '<h3>Races in this round</h3><div id="rc-new-' + s.id + '">' + raceRow({}, "new-" + s.id) + '</div><div style="margin-top:8px"><button type="button" data-radd="new-' + s.id + '">Add a race</button></div>' +
      '<div class="row" style="margin-top:8px"><button class="primary" data-ea="' + s.id + '" type="button">Add round</button></div><div class="msg" id="em-new-' + s.id + '"></div></div></details></div>';
    return h;
  }
  /* ---------- points systems ---------- */
  function updAvail(x) {
    var src = state.sel.leaguePts.filter(function (l) { return l.id === x.copied_from; })[0];
    return !!(src && x.copied_at && src.updated_at && src.updated_at > x.copied_at);
  }
  function pointsCardHtml() {
    var S = state.sel;
    return '<div class="card"><h2>Points system in use</h2><p class="muted" style="margin:0 0 8px">Every race uses this one, unless you set a different one for a particular race on a round.</p>' +
      (S.points.length ? '<div class="field"><label for="cpts">Points system</label><select id="cpts">' + opts(S.points.map(function (x) { return [x.id, x.name]; }), state.sel.champ.points_system_id, "Not set") + '</select></div>' : '<p class="muted" style="margin:0">None to choose from yet. Add a points system below, then pick it here.</p>') + '<div class="msg" id="cptsm"></div></div>' +
      '<div class="card"><h2>Add a points system</h2><p class="muted" style="margin:0 0 8px">The systems this championship has. Copy one from your league or the master list, or build your own.</p><div class="list">' +
      (S.points.length ? S.points.map(function (x) { return '<button type="button" class="item" data-pp="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="muted">' + esc(x.copied_from ? "copied" + (x.source_series ? " from " + x.source_series : "") : "custom") + (updAvail(x) ? ' <span class="pill">league version changed</span>' : "") + "</span></button>"; }).join("") : '<p class="muted">None yet.</p>') + "</div>" +
      '<div class="row" style="margin-top:10px"><div class="field grow"><label for="plib">Start from</label><select id="plib">' + fromOpts(S.leaguePts, S.library) + "</select></div>" +
      '<button class="primary" id="padd" type="button">Add points system</button></div><div class="msg" id="pm"></div>' +
      (S.library.length ? '<p class="muted" style="margin:6px 0 0">Systems are copied into this championship and can be edited without changing the league or master list. Each one lists its source and any caveats once you open it.</p>' : "") + "</div>";
  }
  /* ---------- race format template ---------- */
  function pointsOpts(cur) { return opts(state.sel.points.map(function (x) { return [x.id, x.name]; }), cur, "Same as the championship"); }
  function templateRow(t) {
    return '<div class="row trow" style="margin-top:6px"><div class="field grow"><label>Race name</label><input data-tn value="' + esc(t.name || "") + '" placeholder="For example Sprint"></div>' +
      '<div class="field"><label>Laps</label><input data-tl type="number" min="1" style="width:90px" value="' + esc(t.laps == null ? "" : t.laps) + '"></div>' +
      '<div class="field grow"><label>Points system</label><select data-tp>' + pointsOpts(t.points_system_id) + "</select></div>" +
      '<button type="button" data-trm>Remove</button></div>';
  }
  function templateCardHtml() {
    var S = state.sel;
    return '<div class="card"><h2>Race format</h2><p class="muted" style="margin:0 0 8px">The races every new round starts with. You can change or remove them on any one round. Rounds that already exist are not changed when you edit this.</p>' +
      '<div id="tpl">' + S.templates.map(templateRow).join("") + '</div>' +
      '<div class="row" style="margin-top:10px"><button type="button" id="tadd">Add a race</button><button class="primary" type="button" id="tsave">Save race format</button></div><div class="msg" id="tm"></div></div>';
  }
  function saveTemplates() {
    var m = $("#tm"), rows = [], bad = null;
    document.querySelectorAll("#tpl .trow").forEach(function (r) {
      var name = r.querySelector("[data-tn]").value.trim(), laps = numOrNull(r.querySelector("[data-tl]").value), pts = nul(r.querySelector("[data-tp]").value);
      if (!name) { bad = "Every race needs a name."; return; }
      if (laps != null && (laps < 1 || Math.floor(laps) !== laps)) { bad = "Laps must be a whole number of 1 or more."; return; }
      rows.push({ championship_id: state.sel.champ.id, sort_order: rows.length + 1, name: name, laps: laps, points_system_id: pts });
    });
    if (bad) { msg(m, bad, "err"); return; }
    msg(m, "Saving…");
    var fin = function (e) { if (e) { msg(m, dbError(e), "err"); return; } openChamp(state.sel.champ.id); setTimeout(function () { msg($("#tm"), "Saved.", "ok"); }, 500); };
    var cid = state.sel.champ.id;
    (rows.length ? sb.from("race_templates").upsert(rows, { onConflict: "championship_id,sort_order" }) : Promise.resolve({})).then(function (r1) {
      if (r1.error) { fin(r1.error); return; }
      sb.from("race_templates").delete().eq("championship_id", cid).gt("sort_order", rows.length).then(function (r2) { fin(r2.error); });
    });
  }
  // The races a new round starts with, copied from the championship's race format.
  function racesForNewRounds(events) {
    var T = state.sel.templates.length ? state.sel.templates : [{ sort_order: 1, name: "Race 1", laps: null, points_system_id: null }], out = [];
    events.forEach(function (e) { T.forEach(function (t) { out.push({ event_id: e.id, sort_order: t.sort_order, name: t.name, laps: t.laps, points_system_id: t.points_system_id }); }); });
    return out;
  }
  function insertRaces(events) {
    var rows = racesForNewRounds(events);
    return rows.length ? sb.from("races").insert(rows) : Promise.resolve({});
  }

  // Points systems are copied, never shared: master list -> league -> championship. A copy remembers where it came from.
  function readSystem(srcId) {
    return Promise.all([
      sb.from("points_systems").select("*").eq("id", srcId).single(),
      sb.from("points_table_entries").select("*").eq("points_system_id", srcId),
      sb.from("points_status_rules").select("*").eq("points_system_id", srcId),
      sb.from("points_bonuses").select("*").eq("points_system_id", srcId)
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) throw bad.error;
      return { src: rs[0].data, ents: rs[1].data || [], sts: rs[2].data || [], bns: rs[3].data || [] };
    });
  }
  function writeChildren(nid, d) {
    var steps = [];
    var ents = d.ents.map(function (e) { return { points_system_id: nid, position: e.position, points: e.points }; });
    var sts = d.sts.map(function (e) { return { points_system_id: nid, status: e.status, points: e.points }; });
    var bns = d.bns.map(function (e) { return { points_system_id: nid, name: e.name, kind: e.kind, points: e.points, description: e.description }; });
    if (ents.length) steps.push(sb.from("points_table_entries").insert(ents));
    if (sts.length) steps.push(sb.from("points_status_rules").upsert(sts, { onConflict: "points_system_id,status" }));
    if (bns.length) steps.push(sb.from("points_bonuses").insert(bns));
    return Promise.all(steps).then(function (xs) {
      var e2 = xs.filter(function (x) { return x.error; })[0];
      if (e2) throw e2.error;
    });
  }
  // owner is { championship_id } or { league_id }; resolves with the new system's id.
  function copySystem(srcId, owner) {
    return readSystem(srcId).then(function (d) {
      var row = Object.assign({ name: d.src.name, source_series: d.src.source_series, source_version: d.src.source_version, source_url: d.src.source_url, dnf_rank_by_best_lap: !!d.src.dnf_rank_by_best_lap, copied_from: d.src.id, copied_at: new Date().toISOString() }, owner);
      return sb.from("points_systems").insert(row).select("id").single().then(function (r) {
        if (r.error) throw r.error;
        var nid = r.data.id;
        return writeChildren(nid, d).then(function () { return nid; }, function (e) {
          return sb.from("points_systems").delete().eq("id", nid).then(function () { throw e; });
        });
      });
    });
  }
  function fromOpts(league, master) {
    function grp(label, list) { return list.length ? '<optgroup label="' + esc(label) + '">' + list.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.name) + "</option>"; }).join("") + "</optgroup>" : ""; }
    return '<option value="">Empty custom system</option>' + grp("This league's systems", league) + grp("Master list", master);
  }
  function addPoints() {
    var C = state.sel.champ, m = $("#pm"), sid = $("#plib").value;
    msg(m, "Adding…");
    var go = sid ? copySystem(sid, { championship_id: C.id }) :
      sb.from("points_systems").insert({ championship_id: C.id, name: "New points system" }).select("id").single().then(function (r) { if (r.error) throw r.error; return r.data.id; });
    go.then(function (nid) { state.pscope = "champ"; openChamp(C.id, { view: "points", pid: nid }); }, function (e) { msg(m, dbError(e), "err"); });
  }
  function loadLeaguePts(done) {
    var lid = state.league.id;
    Promise.all([
      sb.from("points_systems").select("id,name,source_series,updated_at").eq("league_id", lid).is("championship_id", null).order("name", { ascending: true }),
      sb.from("points_systems").select("id,name,source_series,source_version").is("championship_id", null).is("league_id", null).order("name", { ascending: true })
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { app.innerHTML = '<div class="card err">' + esc(dbError(bad.error)) + "</div>"; return; }
      state.lpts = rs[0].data || []; state.master = rs[1].data || []; done();
    });
  }
  function addLeaguePoints() {
    var m = $("#lpm"), sid = $("#lplib").value;
    msg(m, "Adding…");
    var go = sid ? copySystem(sid, { league_id: state.league.id }) :
      sb.from("points_systems").insert({ league_id: state.league.id, name: "New points system" }).select("id").single().then(function (r) { if (r.error) throw r.error; return r.data.id; });
    go.then(function (nid) { state.pscope = "league"; state.nav = { view: "points", pid: nid }; renderPoints(nid); }, function (e) { msg(m, dbError(e), "err"); });
  }
  function updateFromLeague(pid, srcId, btn) {
    if (armed !== "upd" + pid) { armed = "upd" + pid; btn.textContent = "This replaces this system with the league's version, losing any edits you made here. Click again to confirm"; return; }
    armed = null; btn.disabled = true;
    readSystem(srcId).then(function (d) {
      return Promise.all([
        sb.from("points_table_entries").delete().eq("points_system_id", pid),
        sb.from("points_status_rules").delete().eq("points_system_id", pid),
        sb.from("points_bonuses").delete().eq("points_system_id", pid)
      ]).then(function (xs) {
        var e = xs.filter(function (x) { return x.error; })[0]; if (e) throw e.error;
        return writeChildren(pid, d);
      }).then(function () {
        return sb.from("points_systems").update({ name: d.src.name, dnf_rank_by_best_lap: !!d.src.dnf_rank_by_best_lap, copied_at: new Date().toISOString() }).eq("id", pid);
      });
    }).then(function () { openChamp(state.sel.champ.id, { view: "points", pid: pid }); }, function (e) { btn.disabled = false; btn.textContent = dbError(e); });
  }
  function bonusRow(b) {
    return '<div class="row brow2" style="margin-top:6px"><div class="field grow"><label>Name</label><input data-bn value="' + esc(b.name || "") + '"></div>' +
      '<div class="field"><label>Type</label><select data-bk>' + opts([["bonus", "Bonus"], ["penalty", "Penalty"]], b.kind, "Not set") + "</select></div>" +
      '<div class="field"><label>Points</label><input data-bp type="number" step="any" style="width:90px" value="' + esc(b.points == null ? "" : b.points) + '"></div>' +
      '<div class="field grow"><label>Note</label><input data-bd value="' + esc(b.description || "") + '"></div>' +
      '<button type="button" data-pbrm>Remove</button></div>';
  }
  function renderPoints(pid) {
    app.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all([
      sb.from("points_systems").select("*").eq("id", pid).single(),
      sb.from("points_table_entries").select("*").eq("points_system_id", pid).order("position", { ascending: true }),
      sb.from("points_status_rules").select("*").eq("points_system_id", pid),
      sb.from("points_bonuses").select("*").eq("points_system_id", pid)
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { app.innerHTML = '<div class="card err">' + esc(dbError(bad.error)) + "</div>"; return; }
      var sys = rs[0].data, ents = (rs[1].data || []).slice().sort(function (a, b) { return a.position - b.position; });
      var st = {}; (rs[2].data || []).forEach(function (x) { st[x.status] = x.points; });
      var lines = ents.map(function (e) { return e.points; }).join("\n");
      var gap = ents.some(function (e, i) { return e.position !== i + 1; });
      var lsc = state.pscope === "league", srcL = !lsc && sys.copied_from ? state.sel.leaguePts.filter(function (l) { return l.id === sys.copied_from; })[0] : null;
      app.innerHTML = (lsc ? '<p><button type="button" id="lpback">← Points systems</button></p>' : '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>") +
        '<div class="card"><h2>Points system' + (lsc ? " (saved for the whole league)" : "") + '</h2>' +
        (srcL && updAvail(sys) ? '<p class="err" style="margin:0 0 8px">The league\'s version of <b>' + esc(srcL.name) + '</b> has changed since this was copied. Nothing here has been changed. <button type="button" data-pupd="' + esc(srcL.id) + '">Update from the league\'s version</button></p>' : "") + '<input type="hidden" id="pid" value="' + esc(pid) + '">' +
        '<div class="field"><label for="pn">Name</label><input id="pn" value="' + esc(sys.name) + '"></div>' +
        (sys.source_series ? '<p class="muted" style="margin:8px 0 0">Copied from ' + esc(sys.source_series) + ". " + esc(sys.source_version || "") + (sys.source_url ? ' <a href="' + esc(sys.source_url) + '" target="_blank" rel="noopener">Source</a>' : "") + "</p>" : "") +
        '<div class="field" style="margin-top:10px"><label for="pt">Points per finishing position: one number per line, 1st place first</label><textarea id="pt" style="min-height:160px">' + esc(lines) + "</textarea></div>" +
        (gap ? '<p class="err">This system has gaps in its positions. Saving renumbers it from 1.</p>' : "") +
        '<p class="muted" style="margin:4px 0 0">A position with no line has no points set. Enter 0 where a place scores nothing.</p>' +
        '<h3>Non-finishers</h3><label style="display:flex;align-items:center;gap:6px;margin:0 0 8px"><input type="checkbox" id="pdr"' + (sys.dnf_rank_by_best_lap ? " checked" : "") + '> Rank DNFs after the last finisher by best lap, and score them for the position they land in</label>' +
        '<p class="muted" style="margin:0 0 6px">With that ticked, a DNF with no recorded lap counts as DNS (0 points). Otherwise a DNF scores 0 unless you change it here. Leave a box blank to leave it unset.</p><div class="row">' +
        ["dnf", "dns", "dsq", "other"].map(function (k) { return '<div class="field"><label for="ps-' + k + '">' + k.toUpperCase() + '</label><input id="ps-' + k + '" type="number" step="any" style="width:90px" value="' + esc(st[k] == null ? "" : st[k]) + '"></div>'; }).join("") + "</div>" +
        '<h3>Bonuses and penalties</h3><div id="pbonus">' + (rs[3].data || []).map(bonusRow).join("") + '</div><div style="margin-top:8px"><button type="button" id="pbadd">Add bonus or penalty</button></div>' +
        '<div class="row" style="margin-top:14px"><button class="primary" id="psave" type="button">Save</button><button class="danger" data-pd="' + esc(pid) + '" type="button">Delete this points system</button></div><div class="msg" id="pm2"></div></div>';
      bindAll();
    });
  }
  function savePoints() {
    var pid = $("#pid").value, m = $("#pm2"), name = $("#pn").value.trim();
    if (!name) { msg(m, "The name cannot be blank.", "err"); return; }
    var ents = [], lines = $("#pt").value.split("\n").map(function (x) { return x.trim(); }).filter(function (x) { return x !== ""; });
    for (var i = 0; i < lines.length; i++) {
      if (!isFinite(Number(lines[i]))) { msg(m, "Line " + (i + 1) + " is not a number: " + lines[i], "err"); return; }
      ents.push({ points_system_id: pid, position: i + 1, points: Number(lines[i]) });
    }
    if (!ents.length) { msg(m, "Enter the points for at least 1st place.", "err"); return; }
    var sts = [];
    ["dnf", "dns", "dsq", "other"].forEach(function (k) { var v = numOrNull($("#ps-" + k).value); if (v != null) sts.push({ points_system_id: pid, status: k, points: v }); });
    var bns = [], badb = null;
    document.querySelectorAll("#pbonus .brow2").forEach(function (r) {
      var bn = r.querySelector("[data-bn]").value.trim(), bk = r.querySelector("[data-bk]").value, bp = numOrNull(r.querySelector("[data-bp]").value);
      if (!bn && !bk && bp == null) return;
      if (!bn || !bk || bp == null) { badb = "Every bonus or penalty needs a name, a type and a points value."; return; }
      bns.push({ points_system_id: pid, name: bn, kind: bk, points: bp, description: nul(r.querySelector("[data-bd]").value) });
    });
    if (badb) { msg(m, badb, "err"); return; }
    msg(m, "Saving…");
    var fail = function (x) { msg(m, x ? dbError(x) : "Could not save.", "err"); };
    sb.from("points_systems").update({ name: name, dnf_rank_by_best_lap: $("#pdr").checked }).eq("id", pid).then(function (r1) {
      if (r1.error) { fail(r1.error); return; }
      sb.from("points_table_entries").upsert(ents, { onConflict: "points_system_id,position" }).then(function (r2) {
        if (r2.error) { fail(r2.error); return; }
        sb.from("points_table_entries").delete().eq("points_system_id", pid).gt("position", ents.length).then(function (r3) {
          if (r3.error) { fail(r3.error); return; }
          sb.from("points_status_rules").delete().eq("points_system_id", pid).then(function (r4) {
            if (r4.error) { fail(r4.error); return; }
            var p5 = sts.length ? sb.from("points_status_rules").insert(sts) : Promise.resolve({});
            p5.then(function (r5) {
              if (r5.error) { fail(r5.error); return; }
              sb.from("points_bonuses").delete().eq("points_system_id", pid).then(function (r6) {
                if (r6.error) { fail(r6.error); return; }
                var p7 = bns.length ? sb.from("points_bonuses").insert(bns) : Promise.resolve({});
                p7.then(function (r7) {
                  if (r7.error) { fail(r7.error); return; }
                  if (state.pscope === "league") { renderPoints(pid); } else openChamp(state.sel.champ.id, { view: "points", pid: pid });
                  setTimeout(function () { msg($("#pm2"), "Saved.", "ok"); }, 500);
                });
              });
            });
          });
        });
      });
    });
  }

  /* ---------- the season's schedule ---------- */
  // The frequency, start time and zone belong to the season. They are set once, either when the
  // season is created or the first time rounds are added, and later rounds reuse them.
  var FREQ_OPTS = { weekly: { l: "Weekly", pattern: "weekly", n: 1 }, fortnightly: { l: "Fortnightly", pattern: "fortnightly", n: 2 }, w3: { l: "Every 3 weeks", pattern: "custom", n: 3 }, w4: { l: "Every 4 weeks", pattern: "custom", n: 4 } };
  // The schedule pattern lives on the championship; a season copies it when its rounds are first made.
  function champPattern() {
    var c = state.sel.champ, fo = { 1: "weekly", 2: "fortnightly", 3: "w3", 4: "w4" }[c.schedule_every_weeks];
    if (!fo || !c.race_local_time || !c.intended_timezone) return { error: "Set the frequency, the race start and the time zone on the championship page first, then save." };
    var o = FREQ_OPTS[fo], race = String(c.race_local_time).slice(0, 5), lob = c.lobby_local_time ? String(c.lobby_local_time).slice(0, 5) : "";
    return { pattern: o.pattern, n: o.n, t: race, l: lob, z: c.intended_timezone, text: o.l + " · " + (lob ? "lobby " + lob + ", race " : "race ") + race + " " + c.intended_timezone };
  }
  function champZone() { return (state.sel && state.sel.champ.intended_timezone) || leagueZone() || null; }
  var FREQ = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", custom: "Custom" };
  function seriesFor(sid) { return (state.sel.series || []).filter(function (x) { return x.season_id === sid; })[0] || null; }
  function scheduleText(r) {
    var f = FREQ[r.pattern] || r.pattern;
    if (r.pattern === "custom") f = "Every " + r.interval_count + " " + r.interval_unit + (r.interval_count > 1 ? "s" : "");
    if (r.monthly_mode) f += r.monthly_mode === "nth_weekday" ? ", same weekday" : ", same day of the month";
    return f + " · " + (r.lobby_local_time ? "lobby " + String(r.lobby_local_time).slice(0, 5) + ", race " : "race ") + String(r.local_time).slice(0, 5) + " " + r.timezone + " · first round " + r.first_local_date + " · " + r.occurrence_count + " round" + (r.occurrence_count === 1 ? "" : "s") + " so far";
  }
  function genHtml(k) {
    var ser = k === "new" ? null : seriesFor(k);
    var title = k === "new" ? "Schedule (optional): create the season with its rounds" : ser ? "Add more rounds" : "Set the season's schedule and add rounds";
    var h = '<div class="card" style="margin:12px 0 0"><div class="lbl" style="margin-bottom:6px">' + title + "</div>";
    if (ser) {
      h += '<p class="muted" style="margin:0 0 8px">Schedule for this season: ' + esc(scheduleText(ser)) + ". New rounds follow it.</p>" +
        '<div class="row"><div class="field"><label for="gn-' + k + '">Number of rounds to add</label><input id="gn-' + k + '" type="number" min="1" max="200" style="width:110px"></div></div>';
    } else {
      var pat = champPattern();
      h += (pat.error ? '<p class="err" style="margin:0 0 8px">' + esc(pat.error) + "</p>" : '<p class="muted" style="margin:0 0 8px">Schedule from the championship: ' + esc(pat.text) + ".</p>") +
        '<div class="row"><div class="field"><label for="gn-' + k + '">Number of rounds</label><input id="gn-' + k + '" type="number" min="1" max="200" style="width:110px"></div>' +
        '<div class="field"><label for="gd-' + k + '">Starting date</label><input id="gd-' + k + '" type="date"></div></div>';
    }
    return h + '<div class="row" style="margin-top:8px"><button data-gp="' + k + '" type="button">Preview rounds</button></div><div id="gv-' + k + '"></div></div>';
  }
  function toggleGen() { /* the frequency has no dependent fields any more */ }
  function previewRounds(k) {
    var box = $("#gv-" + k), sid = k === "new" ? null : k; delete plans[k];
    var ser = sid ? seriesFor(sid) : null, done = ser ? ser.occurrence_count : 0, extra = numOrNull($("#gn-" + k).value), cfgv;
    if (ser) cfgv = { pattern: ser.pattern, mode: ser.monthly_mode || "", ic: ser.interval_count, iu: ser.interval_unit, start: ser.first_local_date, t: String(ser.local_time).slice(0, 5), l: ser.lobby_local_time ? String(ser.lobby_local_time).slice(0, 5) : "", z: ser.timezone };
    else {
      var pt = champPattern();
      if (pt.error) { box.innerHTML = '<p class="err">' + esc(pt.error) + "</p>"; return; }
      cfgv = { pattern: pt.pattern, mode: "", ic: pt.n, iu: "week", start: $("#gd-" + k).value, t: pt.t, l: pt.l, z: pt.z };
    }
    if (k === "new" && !$("#sn").value.trim()) { box.innerHTML = '<p class="err">Type the season name first.</p>'; return; }
    if (!(extra >= 1)) { box.innerHTML = '<p class="err">Enter the number of rounds.</p>'; return; }
    var g = SCH.generate({ start: cfgv.start, count: done + extra, pattern: cfgv.pattern, monthlyMode: cfgv.mode, intervalCount: cfgv.ic, intervalUnit: cfgv.iu });
    if (g.error) { box.innerHTML = '<p class="err">' + esc(g.error) + "</p>"; return; }
    if (!cfgv.t) { box.innerHTML = '<p class="err">Choose the race start time.</p>'; return; }
    if (cfgv.l && cfgv.l > cfgv.t) { box.innerHTML = '<p class="err">The lobby must open at or before the race start, on the same day.</p>'; return; }
    var dates = g.dates.slice(done);
    var evs = sid ? state.sel.events.filter(function (e) { return e.season_id === sid; }) : [];
    var first = evs.reduce(function (m, e) { return Math.max(m, e.round_number || 0); }, 0) + 1;
    var bad = 0, rows = dates.map(function (d, i) {
      var r = TZ.zonedToInstant(d, cfgv.t, cfgv.z), n = first + i, line, lr = cfgv.l ? TZ.zonedToInstant(d, cfgv.l, cfgv.z) : null;
      if (!r.error && lr && lr.error) { r = lr; }
      if (r.error) { bad++; line = '<span class="err">' + esc(d) + " " + esc(cfgv.t) + ": " + (r.error === "nonexistent" ? "this time does not exist in " + esc(cfgv.z) + " that day, because the clocks skip forward" : r.error === "ambiguous" ? "this time happens twice in " + esc(cfgv.z) + " that day, because the clocks go back" : "not valid") + "</span>"; }
      else { var mine = TZ.localText(Date.parse(r.instant), viewerTz); line = esc(d + " " + (cfgv.l ? "lobby " + cfgv.l + ", race " : "race ") + cfgv.t) + (viewerTz !== cfgv.z ? ' <span class="muted">(your time: ' + esc(mine.date + " " + mine.time) + ")</span>" : ""); }
      return { d: d, n: n, inst: r.instant, lobby: lr && !lr.error ? lr.instant : null, line: "<li>Round " + n + " · " + line + "</li>" };
    });
    var last = g.dates[g.dates.length - 1], season = sid ? state.sel.seasons.filter(function (x) { return x.id === sid; })[0] : null;
    var h = '<ul class="missing" style="margin-top:8px">' + rows.map(function (r) { return r.line; }).join("") + "</ul>";
    if (bad) h += '<p class="err">Change the start time, the date or the zone so every round is valid, then preview again.</p>';
    else {
      h += "<p>" + (k === "new" ? "The season will start on <b>" + esc(g.dates[0]) + "</b> and end on <b>" + esc(last) + "</b>." : "The season end date will be set to <b>" + esc(last) + "</b>" + (season && season.ends_on && season.ends_on !== last ? ' <span class="muted">(it is currently ' + esc(season.ends_on) + ")</span>" : "") + ".") + "</p>" +
        (evs.length ? '<p class="muted">This season already has ' + evs.length + " round" + (evs.length === 1 ? "" : "s") + ", so numbering continues from round " + first + ".</p>" : "") +
        '<button class="primary" data-gc="' + k + '" type="button">' + (k === "new" ? "Create season with " : "Create ") + rows.length + " round" + (rows.length === 1 ? "" : "s") + '</button><div class="msg" id="gm2-' + k + '"></div>';
      plans[k] = { rows: rows, first: g.dates[0], last: last, cfg: cfgv, done: done, ser: ser };
    }
    box.innerHTML = h;
    var cb = box.querySelector("[data-gc]"); if (cb) cb.addEventListener("click", function () { createRounds(k); });
  }
  function createRounds(k) {
    var pl = plans[k], m = $("#gm2-" + k); if (!pl) return;
    var btn = $("#gv-" + k + " [data-gc]"); if (btn) btn.disabled = true;
    msg(m, "Creating…");
    var fail = function (text, undo) { (undo ? undo() : Promise.resolve()).then(function () { msg(m, text, "err"); if (btn) btn.disabled = false; }); };
    var cf = pl.cfg;
    // 1. the season (new seasons only)
    var seasonP = k === "new"
      ? sb.from("seasons").insert({ championship_id: state.sel.champ.id, name: $("#sn").value.trim(), starts_on: pl.first, ends_on: pl.last }).select("id").single()
      : Promise.resolve({ data: { id: k }, error: null });
    seasonP.then(function (sr) {
      if (sr.error) { fail(dbError(sr.error)); return; }
      var sid = sr.data.id;
      var undoSeason = function () { return k === "new" ? sb.from("seasons").delete().eq("id", sid) : Promise.resolve(); };
      // 2. the schedule rule
      var ruleP;
      if (pl.ser) ruleP = sb.from("event_series").update({ occurrence_count: pl.done + pl.rows.length }).eq("id", pl.ser.id).select("id").single();
      else {
        var series = { season_id: sid, pattern: cf.pattern, first_local_date: cf.start, local_time: cf.t, timezone: cf.z, end_type: "after_count", occurrence_count: pl.rows.length };
        series.interval_count = cf.ic; series.interval_unit = "week";
        if (cf.l) series.lobby_local_time = cf.l;
        ruleP = sb.from("event_series").insert(series).select("id").single();
      }
      ruleP.then(function (rr) {
        if (rr.error) { fail(dbError(rr.error), undoSeason); return; }
        var undoRule = function () {
          var u = pl.ser ? sb.from("event_series").update({ occurrence_count: pl.done }).eq("id", pl.ser.id) : sb.from("event_series").delete().eq("id", rr.data.id);
          return u.then(undoSeason);
        };
        // 3. the events
        var evs = pl.rows.map(function (r) { var o = { season_id: sid, series_id: rr.data.id, occurrence_date: r.d, round_number: r.n, starts_at: r.inst, original_starts_at: r.inst, timezone: cf.z }; if (r.lobby) o.lobby_opens_at = r.lobby; return o; });
        sb.from("events").insert(evs).select("id").then(function (er) {
          if (er.error) { fail("No rounds were created: " + dbError(er.error), undoRule); return; }
          insertRaces(er.data || []).then(function (rrs) { if (rrs.error) setTimeout(function () { msg($("#sm-" + sid), "Rounds were created, but their races could not be added: " + dbError(rrs.error), "err"); }, 600); });
          // 4. the season end date
          sb.from("seasons").update({ ends_on: pl.last }).eq("id", sid).then(function (ur) {
            delete plans[k];
            openChamp(state.sel.champ.id, { view: "season", sid: sid });
            if (ur.error) setTimeout(function () { msg($("#sm-" + sid), "Rounds were created, but the season end date could not be set: " + dbError(ur.error), "err"); }, 600);
          });
        });
      });
    });
  }

  function addSeason() {
    var m = $("#sm"), name = $("#sn").value.trim();
    if (!name) { msg(m, "Type a season name first.", "err"); return; }
    sb.from("seasons").insert({ championship_id: state.sel.champ.id, name: name, starts_on: null, ends_on: null }).select("id").single().then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      openChamp(state.sel.champ.id, { view: "season", sid: r.data.id });
    });
  }
  function saveSeason(id) {
    var m = $("#sm-" + id), name = $("#sn-" + id).value.trim();
    if (!name) { msg(m, "The name cannot be blank.", "err"); return; }
    sb.from("seasons").update({ name: name, starts_on: nul($("#ss-" + id).value), ends_on: nul($("#se-" + id).value) }).eq("id", id).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      openChamp(state.sel.champ.id);
    });
  }

  /* ---------- events ---------- */
  function trackById(id) { return (state.tracks || []).filter(function (t) { return t.id === id; })[0] || null; }
  function venueName(t) { return t && t.track_venues && t.track_venues.name ? t.track_venues.name : "Unknown venue"; }
  function isMetric() { return !!(state.league && state.league.units === "metric"); }
  function lenText(km) { km = Number(km); if (!km) return ""; return isMetric() ? km.toFixed(2) + " km" : (km / 1.609344).toFixed(2) + " mi"; }
  function venueOpts(cur) {
    var T = state.tracks || [];
    if (!T.length) return '<option value="">No tracks loaded yet</option>';
    var seen = {}, vs = [];
    T.forEach(function (t) { if (t.venue_id && !seen[t.venue_id]) { seen[t.venue_id] = 1; vs.push({ id: t.venue_id, name: venueName(t) }); } });
    vs.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var cv = trackById(cur); cv = cv && cv.venue_id;
    return '<option value="">Not set</option>' + vs.map(function (v) { return '<option value="' + esc(v.id) + '"' + (cv === v.id ? " selected" : "") + ">" + esc(v.name) + "</option>"; }).join("");
  }
  function layoutOpts(venueId, cur) {
    if (!venueId) return '<option value="">Pick a venue first</option>';
    var L = (state.tracks || []).filter(function (t) { return t.venue_id === venueId; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return '<option value="">Not set</option>' + L.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (cur === t.id ? " selected" : "") + ">" + esc(t.name + (t.is_reverse && !/reverse/i.test(t.name) ? " (reverse)" : "") + (t.length_km ? " · " + lenText(t.length_km) : "")) + "</option>";
    }).join("");
  }
  function trackFields(k, e) {
    var t = trackById(e.track_layout_id);
    return '<div class="row" style="margin-top:8px"><div class="field grow"><label for="etv-' + k + '">Venue</label><select id="etv-' + k + '">' + venueOpts(e.track_layout_id) + "</select></div>" +
      '<div class="field grow"><label for="etk-' + k + '">Layout</label><select id="etk-' + k + '">' + layoutOpts(t && t.venue_id, e.track_layout_id) + "</select></div>" +
      '</div>' +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="erl-' + k + '">Reference lap</label><input id="erl-' + k + '" style="width:130px" placeholder="1:25.876" autocomplete="off" value="' + esc(e.reference_lap_ms ? fmtMs(e.reference_lap_ms) : "") + '"></div></div>' +
      '<div class="row" style="margin-top:8px;align-items:flex-end"><div class="field"><span class="lbl">Race length. Fill in one, the others work themselves out</span><div class="row" style="margin-top:4px;align-items:flex-end">' +
      '<div class="field"><label for="ecl-' + k + '">Laps</label><input id="ecl-' + k + '" type="number" min="1" step="1" style="width:90px" placeholder="Eg 23"></div>' +
      '<div class="field"><label for="ect-' + k + '">Total race time</label><input id="ect-' + k + '" style="width:110px" placeholder="Eg 33 or 32:55" autocomplete="off"></div>' +
      '<div class="field"><label for="ecd-' + k + '">Total distance (' + (isMetric() ? "km" : "mi") + ')</label><input id="ecd-' + k + '" type="number" min="0" step="any" style="width:130px" placeholder="Eg 71.5"></div>' +
      '<button type="button" data-calcapply="' + k + '" disabled>Set laps on every race</button></div></div></div>' +
      '<div class="muted" id="ecr-' + k + '" style="margin-top:4px;min-height:1.2em"></div>';
  }
  function raceRow(r, eid) {
    return '<div class="row rrow" data-rid="' + esc(r.id || "") + '" style="margin-top:6px"><div class="field grow"><label>Race</label><input data-rn value="' + esc(r.name || "") + '" placeholder="For example Sprint"></div>' +
      '<div class="field"><label>Laps</label><input data-rl type="number" min="1" style="width:90px" value="' + esc(r.laps == null ? "" : r.laps) + '"></div>' +
      '<div class="field grow"><label>Points system</label><select data-rp>' + pointsOpts(r.points_system_id) + "</select></div>" +
      '<div class="field"><span class="lbl">Distance</span><div style="padding:7px 0" class="muted" data-rd>' + esc(raceDistance(r, eid)) + "</div></div>" +
      '<button type="button" data-rrm>Remove</button></div>';
  }
  function trackLabel(e) { var t = trackById(e.track_layout_id); return t ? venueName(t) + " · " + t.name : ""; }
  // Lap calculator. Laps, total time and total distance are one target: type one and the others fill in.
  // Time needs the reference lap and distance needs the layout; without them that box stays blank.
  var calcLaps = {};
  function parseRaceTime(v) { v = (v || "").trim(); if (!v) return null; if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 60000); var r = parseMs(v); return r == null || !isFinite(r) || r <= 0 ? NaN : r; }
  function calcUpdate(k, from) {
    var g = function (p) { return document.getElementById(p + "-" + k); };
    var out = g("ecr"), btn = document.querySelector('[data-calcapply="' + k + '"]'); if (!out) return;
    var ref = parseLap(g("erl").value); if (ref !== null && !isFinite(ref)) ref = null;
    var len = layoutLen(k), laps = 0, hint = "";
    if (from === "ecl") laps = Math.round(Number(g("ecl").value)) || 0;
    else if (from === "ect") { var tm = parseRaceTime(g("ect").value); if (tm && isFinite(tm)) { if (ref) laps = Math.max(1, Math.round(tm / ref)); else hint = "Enter a reference lap first"; } }
    else if (from === "ecd") { var d = numOrNull(g("ecd").value); if (d) { if (len) laps = Math.max(1, Math.round((isMetric() ? d : d * 1.609344) / len)); else hint = "Pick a layout first"; } }
    else laps = calcLaps[k] || 0;   // reference lap or layout changed: keep the laps, redo the rest
    calcLaps[k] = laps;
    if (from !== "ecl") g("ecl").value = laps || "";
    if (from !== "ect") g("ect").value = laps && ref ? fmtMs(Math.round(laps * ref / 1000) * 1000).replace(/\.\d+$/, "").replace(/^0(?=\d:)/, "") : "";
    if (from !== "ecd") g("ecd").value = laps && len ? (function (km) { return isMetric() ? km.toFixed(1) : (km / 1.609344).toFixed(1); })(laps * len) : "";
    if (!hint && laps && !ref && from !== "ect") hint = "Add a reference lap to see the total time";
    if (!hint && laps && !len && from !== "ecd") hint = "Pick a layout to see the distance";
    out.textContent = hint; out.dataset.laps = laps || ""; if (btn) btn.disabled = !laps;
  }
  function layoutLen(eid) { var sel = document.getElementById("etk-" + eid), t = trackById(sel ? sel.value : (state.sel.events.filter(function (e) { return e.id === eid; })[0] || {}).track_layout_id); return t && Number(t.length_km) ? Number(t.length_km) : 0; }
  function raceDistance(r, eid) {
    var len = layoutLen(eid); if (!len || !r.laps) return "";
    var km = len * r.laps; return "≈ " + (isMetric() ? km.toFixed(1) + " km" : (km / 1.609344).toFixed(1) + " mi");
  }
  function refreshDistances(eid) {
    var box = document.getElementById("rc-" + eid); if (!box) return;
    box.querySelectorAll(".rrow").forEach(function (row) { var l = numOrNull(row.querySelector("[data-rl]").value); row.querySelector("[data-rd]").textContent = raceDistance({ laps: l }, eid); });
  }
  function racesBlock(e) {
    var rs = state.sel.races.filter(function (r) { return r.event_id === e.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; });
    return '<h3>Races in this round</h3><div id="rc-' + e.id + '">' + rs.map(function (r) { return raceRow(r, e.id); }).join("") + '</div><div style="margin-top:8px"><button type="button" data-radd="' + e.id + '">Add a race</button></div>';
  }
  function eventFields(k, e) {
    var loc = e.starts_at && e.timezone ? TZ.localText(Date.parse(e.starts_at), e.timezone) : { date: "", time: "" };
    var lob = e.lobby_opens_at && e.timezone ? TZ.localText(Date.parse(e.lobby_opens_at), e.timezone) : { date: "", time: "" };
    return trackFields(k, e) +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="er-' + k + '">Round</label><input id="er-' + k + '" type="number" min="1" style="width:80px" value="' + esc(e.round_number == null ? "" : e.round_number) + '"></div>' +
      '<div class="field"><label for="ed-' + k + '">Date</label><input id="ed-' + k + '" type="date" value="' + esc(loc.date) + '"></div>' +
      '<div class="field"><label for="el-' + k + '">Lobby opens (optional)</label><input id="el-' + k + '" type="time" value="' + esc(lob.time) + '"></div>' +
      '<div class="field"><label for="et-' + k + '">Race start</label><input id="et-' + k + '" type="time" value="' + esc(loc.time) + '"></div>' +
      '<div class="field grow"><span class="lbl">Time zone</span><div id="ez-' + k + '" style="padding:7px 0">' + esc(e.timezone || champZone() || "Set the league time zone first") + (e.timezone && champZone() && e.timezone !== champZone() ? ' <span class="muted">(differs from the league zone)</span>' : "") + "</div></div></div>" +
      (e.id ? '<div class="row" style="margin-top:8px"><div class="field"><label for="eu-' + k + '">Status</label><select id="eu-' + k + '">' + opts([["scheduled", "Scheduled"], ["cancelled", "Cancelled"], ["completed", "Completed"]], e.status, "").replace('<option value=""></option>', "") + "</select></div></div>" : "") +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="eb-' + k + '">Bonus round</label><label style="display:flex;gap:6px;align-items:center;padding:7px 0"><input id="eb-' + k + '" type="checkbox"' + (e.is_bonus ? " checked" : "") + "> Counts as a bonus round</label></div></div>" +
      '<div class="field" style="margin-top:8px"><label for="eo-' + k + '">Notes for racers (tire wear, damage, weather and anything else)</label><textarea id="eo-' + k + '">' + esc(e.notes || "") + "</textarea></div>";
  }
  function eventHtml(e) {
    var when = "Date and time not set";
    if (e.starts_at && e.timezone) {
      var a = TZ.localText(Date.parse(e.starts_at), e.timezone), b = TZ.localText(Date.parse(e.starts_at), viewerTz);
      var lb = e.lobby_opens_at ? TZ.localText(Date.parse(e.lobby_opens_at), e.timezone).time : "";
      when = a.date + " " + (lb ? "lobby " + lb + ", race " : "") + a.time + " " + e.timezone + (viewerTz !== e.timezone ? " (your time: " + b.date + " " + b.time + ")" : "");
    }
    return '<details class="ev"><summary><span><b>' + (e.round_number ? "Round " + esc(e.round_number) + " · " : "") + esc(trackLabel(e) || e.name || "Round") + (e.is_bonus ? ' <span class="pill">bonus</span>' : "") + '</b> <span class="pill">' + esc(e.status) + '</span></span><span class="muted">' + esc(when) + "</span></summary>" +
      '<div style="margin-top:10px">' + eventFields(e.id, e) + racesBlock(e) +
      '<div class="row" style="margin-top:8px"><button class="primary" data-es="' + e.id + '" type="button">Save round</button><button class="danger" data-ed="' + e.id + '" type="button">Delete round</button></div><div class="msg" id="em-' + e.id + '"></div></div></details>';
  }
  function readEvent(k, m) {
    var d = $("#ed-" + k).value, t = $("#et-" + k).value, ev = state.sel.events.filter(function (x) { return x.id === k; })[0];
    var z = (ev && ev.timezone) || champZone() || "";
    var out = { round_number: numOrNull($("#er-" + k).value), notes: nul($("#eo-" + k).value), track_layout_id: nul($("#etk-" + k).value), is_bonus: $("#eb-" + k).checked };
    var rl = parseLap($("#erl-" + k).value);
    if (rl !== null && !isFinite(rl)) { msg(m, "The reference lap should look like 1:25.876.", "err"); return null; }
    if (rl !== null || (ev && ev.reference_lap_ms != null)) out.reference_lap_ms = rl;
    var lt = $("#el-" + k).value, any = d || t;
    if (lt && !t) { msg(m, "Set the race start time as well as the lobby time.", "err"); return null; }
    if (any) {
      if (!z) { msg(m, "Set the league time zone at the top of this page and save first.", "err"); return null; }
      if (!d || !t) { msg(m, "Set the date and the start time together, or leave both blank.", "err"); return null; }
      var r = TZ.zonedToInstant(d, t, z);
      if (r.error === "nonexistent") { msg(m, "That time does not exist in " + z + " on that date, because the clocks skip forward. Pick another time.", "err"); return null; }
      if (r.error === "ambiguous") { msg(m, "That time happens twice in " + z + " on that date, because the clocks go back. Pick a time outside that hour.", "err"); return null; }
      if (r.error) { msg(m, "The date, time or time zone is not valid.", "err"); return null; }
      out.starts_at = r.instant; out.timezone = z;
      if (lt) {
        if (lt > t) { msg(m, "The lobby must open at or before the race start, on the same day.", "err"); return null; }
        var lr = TZ.zonedToInstant(d, lt, z);
        if (lr.error) { msg(m, "The lobby time is not valid in " + z + " on that date (the clocks change around then). Pick another time.", "err"); return null; }
        out.lobby_opens_at = lr.instant;
      } else if (ev && ev.lobby_opens_at) out.lobby_opens_at = null;
    } else {
      if (ev && ev.lobby_opens_at) out.lobby_opens_at = null; out.starts_at = null; out.timezone = null; }
    return out;
  }
  function addEvent(sid) {
    var k = "new-" + sid, m = $("#em-" + k), v = readEvent(k, m); if (!v) return;
    v.season_id = sid;
    var rows = readRaces(k, m); if (!rows) return;
    sb.from("events").insert(v).select("id").then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      var eid = r.data && r.data[0] && r.data[0].id;
      (eid && rows.length ? sb.from("races").insert(rows.map(function (x) { return { event_id: eid, sort_order: x.sort_order, name: x.name, laps: x.laps, points_system_id: x.points_system_id }; })) : Promise.resolve({})).then(function (rr) {
        if (rr.error) { msg(m, "The round was created, but its races could not be added: " + dbError(rr.error), "err"); return; }
        openChamp(state.sel.champ.id);
      });
    });
  }
  function readRaces(eid, m) {
    var out = [], bad = null;
    document.querySelectorAll("#rc-" + eid + " .rrow").forEach(function (r) {
      var name = r.querySelector("[data-rn]").value.trim(), laps = numOrNull(r.querySelector("[data-rl]").value);
      if (!name) name = "Race " + (out.length + 1);
      if (laps != null && (laps < 1 || Math.floor(laps) !== laps)) { bad = "Laps must be a whole number of 1 or more."; return; }
      out.push({ id: r.dataset.rid || null, name: name, laps: laps, points_system_id: nul(r.querySelector("[data-rp]").value), sort_order: out.length + 1 });
    });
    if (bad) { msg(m, bad, "err"); return null; }
    return out;
  }
  function syncRaces(eid, rows) {
    var keep = rows.filter(function (r) { return r.id; }).map(function (r) { return r.id; });
    var gone = state.sel.races.filter(function (r) { return r.event_id === eid && keep.indexOf(r.id) < 0; }).map(function (r) { return r.id; });
    var ops = [];
    rows.forEach(function (r) {
      var f = { name: r.name, laps: r.laps, points_system_id: r.points_system_id, sort_order: r.sort_order };
      if (r.id) ops.push(sb.from("races").update(f).eq("id", r.id)); else { f.event_id = eid; ops.push(sb.from("races").insert(f)); }
    });
    if (gone.length) ops.push(sb.from("races").delete().in("id", gone));
    return Promise.all(ops).then(function (xs) { var e = xs.filter(function (x) { return x && x.error; })[0]; return e ? e.error : null; });
  }
  function saveEvent(id) {
    var m = $("#em-" + id), v = readEvent(id, m); if (!v) return;
    v.status = $("#eu-" + id).value;
    var old = state.sel.events.filter(function (e) { return e.id === id; })[0];
    // Moving an event that came from a schedule marks it as an override; the original time is kept.
    if (old && old.series_id && old.starts_at !== v.starts_at) v.is_override = true;
    var rr = readRaces(id, m); if (!rr) return;
    sb.from("events").update(v).eq("id", id).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      syncRaces(id, rr).then(function (e2) {
        if (e2) { msg(m, "The round was saved, but its races were not: " + dbError(e2), "err"); return; }
        openChamp(state.sel.champ.id);
      });
    });
  }

  /* ---------- delete (two clicks, no dialog) ---------- */
  function del(table, id, btn) {
    var key = table + id;
    if (armed !== key) { armed = key; btn.textContent = "Click again to delete for good"; return; }
    armed = null;
    sb.from(table).delete().eq("id", id).then(function (r) {
      if (r.error) { btn.textContent = dbError(r.error); return; }
      if (table === "points_systems" && state.pscope === "league") { renderLeaguePoints(); return; }
      openChamp(state.sel.champ.id, table === "seasons" || table === "points_systems" ? { view: "champ" } : undefined);
    });
  }

  /* ---------- drivers, results and standings ---------- */
  var ENG = window.FCMResults;
  function fmtMs(ms) {
    if (ms == null) return "";
    var t = Math.round(ms), h = Math.floor(t / 3600000), m = Math.floor(t % 3600000 / 60000), s = Math.floor(t % 60000 / 1000), r = t % 1000;
    function p(n, w) { return ("00" + n).slice(-w); }
    return (h ? h + ":" : "") + p(m, 2) + ":" + p(s, 2) + "." + ("000" + r).slice(-3);
  }
  // "22:14.742", "1:22:14.742" or "39.328" -> milliseconds. Blank -> null, unreadable -> NaN.
  function parseMs(v) {
    v = (v || "").trim(); if (!v) return null;
    var parts = v.split(":"); if (parts.length > 3) return NaN;
    var secs = Number(parts.pop().replace(",", "."));
    if (!isFinite(secs) || secs < 0) return NaN;
    var ms = secs * 1000, mult = 60;
    while (parts.length) { var n = Number(parts.pop()); if (!isFinite(n) || n < 0 || n % 1) return NaN; ms += n * mult * 1000; mult *= 60; }
    return Math.round(ms);
  }
  // A lap time as typed: "1:25.876", "01:25.876" or "01.25.876" (minutes.seconds.thousandths). Blank -> null, unreadable -> NaN.
  function parseLap(v) {
    v = (v || "").trim(); if (!v) return null;
    var m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,3})$/);
    if (m) { var ms = Number((m[3] + "00").slice(0, 3)); return Number(m[1]) * 60000 + Number(m[2]) * 1000 + ms; }
    var r = parseMs(v); return r != null && r <= 0 ? NaN : r;
  }
  function loadDrivers(done) {
    sb.from("drivers").select("id,display_name,aliases").eq("league_id", state.league.id).order("display_name", { ascending: true }).then(function (r) {
      if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + " Has migration 010 been run?</div>"; return; }
      state.drivers = r.data || []; done();
    });
  }
  function driverByName(name) {
    var n = (name || "").trim().toLowerCase(); if (!n) return null;
    return state.drivers.filter(function (d) { return d.display_name.toLowerCase() === n || (d.aliases || []).some(function (a) { return a.toLowerCase() === n; }); })[0] || null;
  }
  function driverName(id) { var d = state.drivers.filter(function (x) { return x.id === id; })[0]; return d ? d.display_name : "?"; }

  function renderDrivers() { loadDrivers(renderDriversBody); }
  function renderDriversBody() {
    app.innerHTML = navHtml("d") + '<div class="card"><h2>Drivers</h2><p class="muted" style="margin:0 0 8px">The league\'s drivers. Use the name exactly as the game shows it. Other names are spellings the screenshot scan or you might use for the same person; results entry matches on either.</p>' +
      (state.drivers.length ? state.drivers.map(function (d) {
        return '<div class="row" data-did="' + esc(d.id) + '" style="align-items:flex-end;margin:6px 0"><div class="field grow"><label>Name in the game</label><input data-dn value="' + esc(d.display_name) + '"></div>' +
          '<div class="field grow"><label>Other names (comma separated)</label><input data-da value="' + esc((d.aliases || []).join(", ")) + '"></div>' +
          '<button type="button" data-dsave>Save</button><button type="button" class="danger" data-ddel>Delete</button></div>';
      }).join("") : '<p class="muted">No drivers yet. They are also added automatically when you type a new name in results entry.</p>') + '<div class="msg" id="dm"></div></div>' +
      '<div class="card"><h3 style="margin-top:0">Add a driver</h3><div class="row"><div class="field grow"><label for="dnew">Name in the game</label><input id="dnew"></div><button class="primary" id="dadd" type="button">Add</button></div><div class="msg" id="dam"></div></div>';
    bindNav();
    function aliasList(v) { return v.split(",").map(function (x) { return x.trim(); }).filter(function (x) { return x; }); }
    app.querySelectorAll("[data-dsave]").forEach(function (b) { b.addEventListener("click", function () {
      var row = b.closest("[data-did]"), name = row.querySelector("[data-dn]").value.trim();
      if (!name) { msg($("#dm"), "A driver needs a name.", "err"); return; }
      sb.from("drivers").update({ display_name: name, aliases: aliasList(row.querySelector("[data-da]").value) }).eq("id", row.dataset.did).then(function (r) { msg($("#dm"), r.error ? dbError(r.error) : "Saved.", r.error ? "err" : "ok"); });
    }); });
    app.querySelectorAll("[data-ddel]").forEach(function (b) { b.addEventListener("click", function () {
      var row = b.closest("[data-did]"), key = "dd" + row.dataset.did;
      if (armed !== key) { armed = key; b.textContent = "Click again to delete"; return; }
      armed = null;
      sb.from("drivers").delete().eq("id", row.dataset.did).then(function (r) {
        if (r.error) { msg($("#dm"), /foreign key|violates/i.test(r.error.message || "") ? "This driver has results, so they cannot be deleted." : dbError(r.error), "err"); b.textContent = "Delete"; return; }
        renderDrivers();
      });
    }); });
    $("#dadd").addEventListener("click", function () {
      var n = $("#dnew").value.trim(); if (!n) { msg($("#dam"), "Type a name first.", "err"); return; }
      sb.from("drivers").insert({ league_id: state.league.id, display_name: n, aliases: [] }).then(function (r) {
        if (r.error) { msg($("#dam"), /duplicate|unique/i.test(r.error.message || "") ? "There is already a driver with that name." : dbError(r.error), "err"); return; }
        renderDrivers();
      });
    });
  }

  // The points system a race uses, as the scoring engine wants it. Resolves null when none is set.
  function loadSystem(id) {
    if (!id) return Promise.resolve(null);
    return Promise.all([
      sb.from("points_systems").select("*").eq("id", id).single(),
      sb.from("points_table_entries").select("*").eq("points_system_id", id),
      sb.from("points_status_rules").select("*").eq("points_system_id", id),
      sb.from("points_bonuses").select("*").eq("points_system_id", id)
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) throw bad.error;
      var sys = { id: id, name: rs[0].data.name, table: {}, status: {}, fastestLap: null, dnfRank: !!rs[0].data.dnf_rank_by_best_lap };
      (rs[1].data || []).forEach(function (e) { sys.table[e.position] = Number(e.points); });
      (rs[2].data || []).forEach(function (e) { sys.status[e.status] = Number(e.points); });
      (rs[3].data || []).forEach(function (b) { if (/fastest/i.test(b.name || "") && b.kind === "bonus" && sys.fastestLap == null) sys.fastestLap = Number(b.points); });
      return sys;
    });
  }
  function raceSystemId(race) { return race.points_system_id || state.sel.champ.points_system_id || null; }
  function roundLabel(e) { var n = trackLabel(e) || e.name; return (e.round_number ? "Round " + e.round_number : "") + (e.round_number && n ? " · " : "") + (n || (e.round_number ? "" : "Round")); }

  function resultsTabHtml() {
    var S = state.sel, h = '<div class="card"><h2>Results</h2><p class="muted" style="margin:0 0 6px">Pick a race to enter or correct its results.</p>', any = false;
    S.seasons.forEach(function (season) {
      var evs = S.events.filter(function (e) { return e.season_id === season.id; });
      if (!evs.length) return;
      h += "<h3>" + esc(season.name) + "</h3>";
      evs.forEach(function (e) {
        var rs = S.races.filter(function (r) { return r.event_id === e.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; });
        if (!rs.length) return; any = true;
        h += '<div class="row" style="align-items:center;margin:4px 0"><span style="min-width:200px">' + esc(roundLabel(e)) + "</span>" + rs.map(function (r) {
          return '<button type="button" data-rr="' + esc(r.id) + '">' + esc(r.name || "Race") + ' <span class="muted" data-rc="' + esc(r.id) + '"></span></button>';
        }).join("") + "</div>";
      });
    });
    return h + (any ? "" : '<p class="muted">No races yet. Add a season and rounds first.</p>') + "</div>";
  }
  function fillCounts() {
    var ids = state.sel.races.map(function (r) { return r.id; }); if (!ids.length) return;
    sb.from("results").select("race_id").in("race_id", ids).then(function (r) {
      var c = {}; (r.data || []).forEach(function (x) { c[x.race_id] = (c[x.race_id] || 0) + 1; });
      app.querySelectorAll("[data-rc]").forEach(function (el) { var n = c[el.dataset.rc]; el.textContent = n ? "✓ " + n : ""; });
    });
  }

  var STATUSES = [["finished", "Finished"], ["dnf", "DNF"], ["dns", "DNS"], ["dsq", "DSQ"]];
  function renderRaceResults(rid) {
    var S = state.sel, race = S.races.filter(function (r) { return r.id === rid; })[0];
    if (!race) { state.nav = { view: "champ" }; renderCurrent(); return; }
    app.innerHTML = '<p class="muted">Loading…</p>';
    loadDrivers(function () {
      Promise.all([sb.from("results").select("*").eq("race_id", rid), loadSystem(raceSystemId(race))]).then(function (xs) {
        if (xs[0].error) { app.innerHTML = '<div class="card err">' + esc(dbError(xs[0].error)) + "</div>"; return; }
        var rows = (xs[0].data || []).slice().sort(function (a, b) { return (a.position == null ? 1e9 : a.position) - (b.position == null ? 1e9 : b.position); }).map(function (r) {
          return { driver: driverName(r.driver_id), status: r.status === "other" ? "dns" : r.status, ranked: r.status === "dnf" && r.position != null,
            best: fmtMs(r.best_lap_ms), raceT: fmtMs(r.race_time_ms), pen: r.penalty_ms ? String(r.penalty_ms / 1000) : "", total: fmtMs(r.total_time_ms) };
        });
        state.rr = { race: race, sys: xs[1], rows: rows, dbl: !!race.double_points };
        if (!rows.length) for (var i = 0; i < 6; i++) rows.push(blankRow());
        drawRace();
      }, function (e) { app.innerHTML = '<div class="card err">' + esc(dbError(e)) + "</div>"; });
    });
  }
  function blankRow() { return { driver: "", status: "finished", ranked: false, best: "", raceT: "", pen: "", total: "" }; }
  function syncRows() {
    var rr = state.rr; if (!rr) return;
    var trs = app.querySelectorAll("tr[data-ri]"); if (!trs.length) return;
    rr.rows = Array.prototype.map.call(trs, function (tr) {
      var old = rr.rows[Number(tr.dataset.ri)] || blankRow(), st = tr.querySelector("[data-f=status]").value;
      return { driver: tr.querySelector("[data-f=driver]").value, status: st, ranked: st === "dnf" && st === old.status ? old.ranked : false,
        best: tr.querySelector("[data-f=best]").value, raceT: tr.querySelector("[data-f=raceT]").value, pen: tr.querySelector("[data-f=pen]").value, total: tr.querySelector("[data-f=total]").value };
    });
    var d = $("#rdbl"); if (d) rr.dbl = d.checked;
  }
  // Grid positions and points from the rows as they stand, in grid order.
  function gridResults() {
    var rr = state.rr, pos = 0, fastest = -1, bestMs = null;
    rr.rows.forEach(function (r, i) { var b = parseMs(r.best); if (r.driver.trim() && b != null && isFinite(b) && (bestMs == null || b < bestMs)) { bestMs = b; fastest = i; } });
    return rr.rows.map(function (r, i) {
      var positioned = r.status === "finished" || (r.status === "dnf" && r.ranked), p = positioned && r.driver.trim() ? ++pos : null;
      var res = { position: p, status: r.status === "finished" ? null : r.status, fastestLap: i === fastest };
      return { position: p, res: res, points: rr.sys && r.driver.trim() ? ENG.resultPoints(rr.sys, res, rr.dbl) : null };
    });
  }
  function refreshGrid() {
    syncRows();
    var g = gridResults();
    app.querySelectorAll("tr[data-ri]").forEach(function (tr) {
      var i = Number(tr.dataset.ri), x = g[i], r = state.rr.rows[i];
      tr.querySelector("[data-pos]").textContent = x.position != null ? x.position : "–";
      tr.querySelector("[data-pts]").textContent = x.points == null ? "" : x.points + (x.res.fastestLap && state.rr.sys && state.rr.sys.fastestLap ? " (FL)" : "");
      var m = !r.driver.trim() ? "" : driverByName(r.driver) ? "" : "new driver";
      tr.querySelector("[data-new]").textContent = m;
    });
  }
  function drawRace() {
    var rr = state.rr, race = rr.race, ev = state.sel.events.filter(function (e) { return e.id === race.event_id; })[0];
    var rowsH = rr.rows.map(function (r, i) {
      return '<tr data-ri="' + i + '"><td data-pos style="text-align:center"></td>' +
        '<td><input data-f="driver" list="dl" value="' + esc(r.driver) + '" style="min-width:160px"><span class="pill" data-new style="margin-left:4px"></span></td>' +
        '<td><select data-f="status">' + STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (r.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select>" + (r.ranked ? ' <span class="pill">ranked</span>' : "") + "</td>" +
        '<td><input data-f="best" value="' + esc(r.best) + '" placeholder="00:39.328" style="width:92px"></td>' +
        '<td><input data-f="raceT" value="' + esc(r.raceT) + '" placeholder="22:14.742" style="width:104px"></td>' +
        '<td><input data-f="pen" type="number" step="any" min="0" value="' + esc(r.pen) + '" style="width:62px"></td>' +
        '<td><input data-f="total" value="' + esc(r.total) + '" placeholder="22:14.742" style="width:104px"></td>' +
        '<td data-pts style="text-align:right"></td>' +
        '<td style="white-space:nowrap"><button type="button" data-up="' + i + '" title="Move up">↑</button><button type="button" data-dn="' + i + '" title="Move down">↓</button><button type="button" data-rm="' + i + '" title="Remove row">✕</button></td></tr>';
    }).join("");
    app.innerHTML = '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>" +
      '<div class="card"><h2>' + esc((ev ? roundLabel(ev) + " · " : "") + (race.name || "Race")) + ' results</h2>' +
      '<p class="muted" style="margin:0 0 8px">' + (rr.sys ? "Points system: <b>" + esc(rr.sys.name) + "</b>" + (rr.sys.dnfRank ? ". DNFs are ranked after the finishers by best lap." : ". DNFs score by the system\'s DNF rule.") : '<span class="err">No points system is set for this race or the championship, so points are not calculated.</span>') + "</p>" +
      '<p class="muted" style="margin:0 0 8px">Type the rows as the game shows them, in order. Times look like 22:14.742. Penalties are seconds. Position follows the order of the rows; use the arrows to adjust the final grid.</p>' +
      '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th>Pos</th><th style="text-align:left">Driver</th><th>Status</th><th>Best lap</th><th>Race time</th><th>Pen. (s)</th><th>Total</th><th>Points</th><th></th></tr></thead><tbody>' + rowsH + "</tbody></table></div>" +
      '<datalist id="dl">' + state.drivers.map(function (d) { return '<option value="' + esc(d.display_name) + '">'; }).join("") + "</datalist>" +
      '<div class="row" style="margin-top:8px"><button type="button" id="radd">Add a row</button><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="rdbl"' + (rr.dbl ? " checked" : "") + '> Double points for this race</label></div>' +
      '<div class="row" style="margin-top:12px"><button type="button" id="rarr">Arrange final grid</button><button class="primary" id="rsave" type="button">Save results</button></div>' +
      '<p class="muted" style="margin:6px 0 0">"Arrange final grid" keeps finishers in the order typed, ranks DNFs after them by best lap when the points system says so (a DNF with no lap time becomes DNS), and marks the fastest lap. You can still move rows before saving.</p>' +
      '<div class="msg" id="rm"></div></div>';
    $("#backchamp").addEventListener("click", function () { state.nav = { view: "champ" }; renderCurrent(); });
    app.querySelectorAll("tr[data-ri] input, tr[data-ri] select, #rdbl").forEach(function (el) {
      el.addEventListener("input", refreshGrid);
      el.addEventListener("change", function () { if (el.dataset.f === "status") { syncRows(); drawRace(); } else refreshGrid(); });
    });
    function move(i, d) { syncRows(); var rows = state.rr.rows, j = i + d; if (j < 0 || j >= rows.length) return; var t = rows[i]; rows[i] = rows[j]; rows[j] = t; drawRace(); }
    app.querySelectorAll("[data-up]").forEach(function (b) { b.addEventListener("click", function () { move(Number(b.dataset.up), -1); }); });
    app.querySelectorAll("[data-dn]").forEach(function (b) { b.addEventListener("click", function () { move(Number(b.dataset.dn), 1); }); });
    app.querySelectorAll("[data-rm]").forEach(function (b) { b.addEventListener("click", function () { syncRows(); state.rr.rows.splice(Number(b.dataset.rm), 1); drawRace(); }); });
    $("#radd").addEventListener("click", function () { syncRows(); state.rr.rows.push(blankRow()); drawRace(); });
    $("#rarr").addEventListener("click", arrangeGrid);
    $("#rsave").addEventListener("click", saveRace);
    refreshGrid();
  }
  function arrangeGrid() {
    syncRows();
    var rr = state.rr, old = rr.rows.filter(function (r) { return r.driver.trim(); });
    var entries = old.map(function (r, i) { var b = parseMs(r.best); return { driver: String(i), position: i + 1, status: r.status, bestLapMs: b != null && isFinite(b) ? b : null }; });
    var out = ENG.arrangeRace(entries, { dnfRank: !!(rr.sys && rr.sys.dnfRank) });
    rr.rows = out.map(function (o) { var r = old[Number(o.driver)]; r.status = o.status || "finished"; r.ranked = o.status === "dnf" && o.position != null; return r; });
    drawRace(); msg($("#rm"), "Grid arranged. Check it, then save.", "ok");
  }
  function saveRace() {
    syncRows();
    var rr = state.rr, m = $("#rm"), rows = rr.rows.filter(function (r) { return r.driver.trim(); });
    if (!rows.length) { msg(m, "Enter at least one driver first.", "err"); return; }
    var seen = {}, parsed = [], err = null;
    rows.forEach(function (r, i) {
      var key = r.driver.trim().toLowerCase(), d = driverByName(r.driver);
      if (d) key = d.id;
      if (seen[key]) err = r.driver.trim() + " appears twice."; seen[key] = true;
      var best = parseMs(r.best), rt = parseMs(r.raceT), tot = parseMs(r.total), pen = r.pen.trim() === "" ? null : Number(r.pen);
      if ([best, rt, tot].some(function (v) { return v !== null && !isFinite(v); }) || (pen !== null && (!isFinite(pen) || pen < 0))) err = "Row " + (i + 1) + " (" + r.driver.trim() + "): a time is not in a readable format. Use 22:14.742.";
      parsed.push({ best: best, rt: rt, tot: tot, pen: pen });
    });
    if (err) { msg(m, err, "err"); return; }
    var origRows = rr.rows; rr.rows = rows; var grid = gridResults(); rr.rows = origRows;
    var fresh = [], names = {};
    rows.forEach(function (r) { var n = r.driver.trim(); if (!driverByName(n) && !names[n.toLowerCase()]) { names[n.toLowerCase()] = true; fresh.push(n); } });
    var $s = $("#rsave"); $s.disabled = true; msg(m, "Saving…");
    var fail = function (e) { $s.disabled = false; msg(m, dbError(e), "err"); };
    (fresh.length ? sb.from("drivers").insert(fresh.map(function (n) { return { league_id: state.league.id, display_name: n, aliases: [] }; })).select("id,display_name,aliases") : Promise.resolve({ data: [] })).then(function (dr) {
      if (dr.error) { fail(dr.error); return; }
      (dr.data || []).forEach(function (d) { state.drivers.push(d); });
      var now = new Date().toISOString();
      var out = rows.map(function (r, i) {
        var d = driverByName(r.driver), g = grid[i], p = parsed[i];
        return { race_id: rr.race.id, driver_id: d.id, position: g.position, status: r.status, best_lap_ms: p.best, race_time_ms: p.rt, penalty_ms: p.pen == null ? null : Math.round(p.pen * 1000),
          total_time_ms: p.tot, fastest_lap: !!g.res.fastestLap, points_awarded: g.points, scored_with_system_id: rr.sys ? rr.sys.id : null, scored_at: rr.sys ? now : null };
      });
      sb.from("results").delete().eq("race_id", rr.race.id).then(function (x) {
        if (x.error) { fail(x.error); return; }
        sb.from("results").insert(out).then(function (y) {
          if (y.error) { fail(y.error); return; }
          sb.from("races").update({ double_points: rr.dbl }).eq("id", rr.race.id).then(function (z) {
            if (z.error) { fail(z.error); return; }
            openChamp(state.sel.champ.id, { view: "race", rid: rr.race.id });
            setTimeout(function () { msg($("#rm"), "Saved " + out.length + " results" + (fresh.length ? ". New drivers added: " + fresh.join(", ") : "") + ".", "ok"); }, 600);
          });
        });
      });
    });
  }

  function renderStandings() {
    var S = state.sel, box = $("#stand"); if (!box) return;
    var ids = S.races.map(function (r) { return r.id; });
    if (!ids.length) { box.innerHTML = '<p class="muted">No races yet.</p>'; return; }
    loadDrivers(function () {
      sb.from("results").select("*").in("race_id", ids).then(function (rr) {
        if (rr.error) { box.innerHTML = '<span class="err">' + esc(dbError(rr.error)) + "</span>"; return; }
        var results = rr.data || [], sysIds = [];
        S.races.forEach(function (r) { var id = raceSystemId(r); if (id && sysIds.indexOf(id) < 0) sysIds.push(id); });
        Promise.all(sysIds.map(loadSystem)).then(function (systems) {
          var byId = {}; systems.forEach(function (s) { if (s) byId[s.id] = s; });
          var empty = { table: {}, status: {}, fastestLap: null }, noSys = false;
          var evs = S.events.slice().sort(function (a, b) { return String(a.starts_at || "~").localeCompare(String(b.starts_at || "~")) || (a.round_number || 0) - (b.round_number || 0); });
          var rounds = evs.map(function (e) {
            var races = S.races.filter(function (r) { return r.event_id === e.id && results.some(function (x) { return x.race_id === r.id; }); }).sort(function (a, b) { return a.sort_order - b.sort_order; }).map(function (r) {
              var sys = byId[raceSystemId(r)]; if (!sys) noSys = true;
              return { id: r.id, name: r.name || "Race", double: !!r.double_points, system: sys || empty,
                results: results.filter(function (x) { return x.race_id === r.id; }).map(function (x) { return { driver: driverName(x.driver_id), position: x.position, status: x.status === "finished" ? null : x.status, fastestLap: !!x.fastest_lap }; }) };
            });
            return { id: e.id, name: e.round_number ? "R" + e.round_number : (e.name || "Round"), races: races };
          }).filter(function (r) { return r.races.length; });
          if (!rounds.length) { box.innerHTML = '<p class="muted">No results entered yet. Enter them on the Results tab.</p>'; return; }
          var st = ENG.standings(empty, rounds);
          box.innerHTML = (noSys ? '<p class="err">Some races have no points system, so they score 0.</p>' : "") + '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th>#</th><th style="text-align:left">Driver</th><th>Points</th>' +
            st.raceColumns.map(function (c) { return '<th title="' + esc(c.round + " " + c.race) + '">' + esc(c.round + " " + c.race) + "</th>"; }).join("") + "<th>Wins</th><th>Podiums</th><th>Fastest laps</th></tr></thead><tbody>" +
            st.rows.map(function (r) {
              return '<tr><td style="text-align:center">' + r.rank + "</td><td>" + esc(r.driver) + '</td><td style="text-align:center"><b>' + r.total + "</b></td>" +
                st.raceColumns.map(function (c) { return '<td style="text-align:center">' + (r.perRace[c.key] == null ? "–" : r.perRace[c.key]) + "</td>"; }).join("") +
                '<td style="text-align:center">' + r.wins + '</td><td style="text-align:center">' + r.podiums + '</td><td style="text-align:center">' + r.fastestLaps + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        }, function (e) { box.innerHTML = '<span class="err">' + esc(dbError(e)) + "</span>"; });
      });
    });
  }

  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") showLogin(); });
  boot();
})();
