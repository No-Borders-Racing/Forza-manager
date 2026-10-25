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
        loadChamps();
      });
    });
  }

  /* ---------- championships ---------- */
  function loadChamps() {
    sb.from("championships").select("id,name,status,visibility").order("created_at", { ascending: false }).then(function (r) {
      if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + "</div>"; return; }
      state.champs = r.data; state.sel = null; renderChampList();
    });
  }
  function renderChampList() {
    app.innerHTML = '<div class="card"><h2>Championships</h2><div class="list">' +
      (state.champs.length ? state.champs.map(function (c) {
        return '<div style="display:flex;gap:6px;align-items:center"><button type="button" class="item" data-id="' + esc(c.id) + '"><span>' + esc(c.name) + '</span><span class="muted">' + esc(c.status) + (c.visibility ? " · " + esc(c.visibility) : " · visibility not set") + '</span></button><button type="button" class="danger" data-ldel="' + esc(c.id) + '">Delete</button></div>';
      }).join("") : '<p class="muted">None yet.</p>') + '</div><div id="ldelbox"></div></div>' +
      '<div class="card"><h3 style="margin-top:0">New championship</h3><div class="row"><div class="field grow"><label for="nn">Name</label><input id="nn" type="text"></div><button class="primary" id="nadd" type="button">Create</button></div><div class="msg" id="nm"></div>' +
      '<p class="muted">It starts as a draft with every other setting blank.</p></div>';
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
    $("#nadd").addEventListener("click", function () {
      var n = $("#nn").value.trim(); if (!n) { msg($("#nm"), "Type a name first.", "err"); return; }
      sb.from("championships").insert({ name: n }).select("id").single().then(function (r) {
        if (r.error) { msg($("#nm"), dbError(r.error), "err"); return; }
        openChamp(r.data.id);
      });
    });
  }
  function openChamp(id, nav) {
    var prev = state.sel && state.sel.champ.id === id ? state.nav : null;
    Promise.all([
      sb.from("championships").select("*").eq("id", id).single(),
      sb.from("seasons").select("*").eq("championship_id", id).order("starts_on", { ascending: true, nullsFirst: false }),
    ]).then(function (rs) {
      if (rs[0].error) { app.innerHTML = '<div class="card err">' + esc(dbError(rs[0].error)) + "</div>"; return; }
      var seasons = rs[1].data || [], ids = seasons.map(function (s) { return s.id; });
      var evP = ids.length ? sb.from("events").select("*").in("season_id", ids).order("starts_at", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] });
      var srP = ids.length ? sb.from("event_series").select("*").in("season_id", ids) : Promise.resolve({ data: [] });
      var psP = sb.from("points_systems").select("id,name,source_series").eq("championship_id", id).order("name", { ascending: true });
      var libP = sb.from("points_systems").select("id,name,source_series,source_version").is("championship_id", null).order("name", { ascending: true });
      var tplP = sb.from("race_templates").select("*").eq("championship_id", id).order("sort_order", { ascending: true });
      var trkP = sb.from("track_layouts").select("id,name,length_km,is_reverse,track_venues(name)").order("name", { ascending: true });
      Promise.all([evP, srP, psP, libP, tplP, trkP]).then(function (xs) {
        var evList = xs[0].data || [];
        var raceP = evList.length ? sb.from("races").select("*").in("event_id", evList.map(function (e) { return e.id; })).order("sort_order", { ascending: true }) : Promise.resolve({ data: [] });
        raceP.then(function (rr) {
          var bad = [xs[4], xs[5], rr].filter(function (x) { return x.error; })[0];
          if (bad) { app.innerHTML = '<div class="card err">' + esc(dbError(bad.error)) + ' Has the latest database change (migrations/003_round_race_structure.sql) been run?</div>'; return; }
          state.sel = { champ: rs[0].data, seasons: seasons, events: evList, series: xs[1].data || [], points: xs[2].data || [], library: xs[3].data || [], templates: xs[4].data || [], races: rr.data || [] };
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

  function renderChamp() {
    var S = state.sel, c = S.champ;
    var h = '<p><button type="button" id="back">← All championships</button></p>' +
      '<div class="card"><h2>' + esc(c.name) + ' <span class="pill">' + esc(c.status) + "</span></h2>" +
      '<div class="row"><div class="field grow"><label for="cn">Name</label><input id="cn" value="' + esc(c.name) + '"></div>' +
      '<div class="field"><label for="cv">Visibility</label><select id="cv">' + opts([["public", "Public"], ["private", "Private"]], c.visibility, "Not set") + "</select></div>" +
      '<div class="field"><label for="cs">Status</label><select id="cs">' + opts([["draft", "Draft"], ["published", "Published"], ["archived", "Archived"]], c.status, "") .replace('<option value=""></option>', "") + "</select></div></div>" +
      '<div class="field" style="margin-top:8px"><label for="ct">League time zone</label><select id="ct">' + zoneOpts(c.intended_timezone, "Not set") + "</select></div>" +
      '<h3>Schedule pattern</h3><p class="muted" style="margin:0 0 6px">Every season and round inherits this. A season only asks for a starting date and a number of rounds. Times are in the league time zone.</p>' +
      '<div class="row"><div class="field"><label for="cfreq">Frequency</label><select id="cfreq">' + opts([["1", "Weekly"], ["2", "Fortnightly"], ["3", "Every 3 weeks"], ["4", "Every 4 weeks"]], c.schedule_every_weeks == null ? "" : String(c.schedule_every_weeks), "Not set") + "</select></div>" +
      '<div class="field"><label for="clob">Lobby opens (optional)</label><input id="clob" type="time" value="' + esc(c.lobby_local_time ? String(c.lobby_local_time).slice(0, 5) : "") + '"></div>' +
      '<div class="field"><label for="crace">Race start</label><input id="crace" type="time" value="' + esc(c.race_local_time ? String(c.race_local_time).slice(0, 5) : "") + '"></div></div>' +
      '<div class="field" style="margin-top:8px"><label for="cd">Description</label><textarea id="cd">' + esc(c.description || "") + "</textarea></div>" +
      '<div class="row" style="margin-top:8px"><button class="primary" id="csave" type="button">Save</button><button class="danger" id="cgodel" type="button">Delete championship…</button></div><div class="msg" id="cm"></div>' +
      '<h3>Ready to publish?</h3><div id="missing" class="muted">Checking…</div></div>';
    h += pointsCardHtml() + templateCardHtml();
    h += '<div class="card"><h2>Seasons</h2><div class="list">' + (S.seasons.length ? S.seasons.map(function (x) {
      var n = S.events.filter(function (e) { return e.season_id === x.id; }).length;
      return '<button type="button" class="item" data-open="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="muted">' + (x.starts_on ? esc(x.starts_on) + " → " + esc(x.ends_on || "?") : "no dates yet") + " · " + n + " round" + (n === 1 ? "" : "s") + "</span></button>";
    }).join("") : '<p class="muted">No seasons yet.</p>') + '</div><div style="margin-top:10px"><button class="primary" id="newseason" type="button">Add a season</button></div></div>';
    h += '<div class="card"><h3 style="margin-top:0">Delete this championship</h3><p class="muted" style="margin:0 0 8px">This permanently deletes the championship with all of its seasons, rounds, races, points systems, classes and race format. It cannot be undone. To confirm, type its name: <b>' + esc(c.name) + '</b></p>' +
      '<div class="row"><div class="field grow"><label for="cdn">Championship name</label><input id="cdn" autocomplete="off"></div><button class="danger" id="cdel" type="button" disabled>Delete championship</button></div><div class="msg" id="cdm"></div></div>';
    app.innerHTML = h;
    bindAll();
    refreshMissing();
  }
  function renderCurrent() {
    var n = state.nav || { view: "champ" };
    if (n.view === "points") renderPoints(n.pid); else if (n.view === "season") renderSeason(n.sid); else if (n.view === "newseason") renderNewSeason(); else renderChamp();
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
    on("#csave", saveChamp);
    on("#cdel", deleteChamp);
    on("#cgodel", function () { var t = $("#cdn"); t.scrollIntoView({ block: "center" }); t.focus(); });
    var cdn = $("#cdn"); if (cdn) cdn.addEventListener("input", function () { $("#cdel").disabled = cdn.value.trim() !== state.sel.champ.name; });
    on("[data-pp]", function (b) { state.nav = { view: "points", pid: b.dataset.pp }; renderCurrent(); });
    on("#padd", addPoints);
    on("#tadd", function () { $("#tpl").insertAdjacentHTML("beforeend", templateRow({})); });
    on("[data-trm]", function (b) { b.closest(".trow").remove(); });
    on("#tsave", saveTemplates);
    on("[data-radd]", function (b) { $("#rc-" + b.dataset.radd).insertAdjacentHTML("beforeend", raceRow({}, b.dataset.radd)); });
    on("[data-rrm]", function (b) { b.closest(".rrow").remove(); });
    on("#psave", savePoints);
    on("#pbadd", function () { var box = $("#pbonus"); box.insertAdjacentHTML("beforeend", bonusRow({})); });
    on("[data-pbrm]", function (b) { b.closest(".brow2").remove(); });
    on("[data-pd]", function (b) { del("points_systems", b.dataset.pd, b); });
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
    var patch = { name: $("#cn").value.trim(), visibility: nul($("#cv").value), intended_timezone: nul($("#ct").value), description: nul($("#cd").value), status: $("#cs").value,
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
      '<div class="row" style="margin-top:8px"><button class="primary" data-ea="' + s.id + '" type="button">Add round</button></div><div class="msg" id="em-new-' + s.id + '"></div></div></details></div>';
    return h;
  }
  /* ---------- points systems ---------- */
  function pointsCardHtml() {
    var S = state.sel;
    return '<div class="card"><h2>Points systems</h2><p class="muted" style="margin:0 0 8px">A championship can have several, such as one for sprints and one for features. Every race picks one.</p><div class="list">' +
      (S.points.length ? S.points.map(function (x) { return '<button type="button" class="item" data-pp="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="muted">' + esc(x.source_series ? "from " + x.source_series : "custom") + "</span></button>"; }).join("") : '<p class="muted">None yet.</p>') + "</div>" +
      '<div class="row" style="margin-top:10px"><div class="field grow"><label for="plib">Start from</label><select id="plib">' + opts([["", "Empty custom system"]].concat(S.library.map(function (l) { return [l.id, l.name]; })), "", "Choose…") .replace('<option value="">Choose…</option>', "") + "</select></div>" +
      '<button class="primary" id="padd" type="button">Add points system</button></div><div class="msg" id="pm"></div>' +
      (S.library.length ? '<p class="muted" style="margin:6px 0 0">Library tables are copied into this championship and can be edited. Each one lists its source and any caveats once you open it.</p>' : "") + "</div>";
  }
  /* ---------- race format template ---------- */
  function pointsOpts(cur) { return opts(state.sel.points.map(function (x) { return [x.id, x.name]; }), cur, "Not set"); }
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
    var T = state.sel.templates, out = [];
    events.forEach(function (e) { T.forEach(function (t) { out.push({ event_id: e.id, sort_order: t.sort_order, name: t.name, laps: t.laps, points_system_id: t.points_system_id }); }); });
    return out;
  }
  function insertRaces(events) {
    var rows = racesForNewRounds(events);
    return rows.length ? sb.from("races").insert(rows) : Promise.resolve({});
  }

  function addPoints() {
    var C = state.sel.champ, m = $("#pm"), lid = $("#plib").value;
    var lib = state.sel.library.filter(function (x) { return x.id === lid; })[0];
    msg(m, "Adding…");
    if (!lib) {
      sb.from("points_systems").insert({ championship_id: C.id, name: "New points system" }).select("id").single().then(function (r) {
        if (r.error) { msg(m, dbError(r.error), "err"); return; }
        openChamp(C.id, { view: "points", pid: r.data.id });
      });
      return;
    }
    Promise.all([
      sb.from("points_systems").select("*").eq("id", lid).single(),
      sb.from("points_table_entries").select("*").eq("points_system_id", lid),
      sb.from("points_status_rules").select("*").eq("points_system_id", lid),
      sb.from("points_bonuses").select("*").eq("points_system_id", lid)
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { msg(m, dbError(bad.error), "err"); return; }
      var src = rs[0].data;
      sb.from("points_systems").insert({ championship_id: C.id, name: src.name, source_series: src.source_series, source_version: src.source_version, source_url: src.source_url, copied_from: src.id }).select("id").single().then(function (r) {
        if (r.error) { msg(m, dbError(r.error), "err"); return; }
        var nid = r.data.id, undo = function (t) { return sb.from("points_systems").delete().eq("id", nid).then(function () { msg(m, "Nothing was added: " + t, "err"); }); };
        var ents = (rs[1].data || []).map(function (e) { return { points_system_id: nid, position: e.position, points: e.points }; });
        var sts = (rs[2].data || []).map(function (e) { return { points_system_id: nid, status: e.status, points: e.points }; });
        var bns = (rs[3].data || []).map(function (e) { return { points_system_id: nid, name: e.name, kind: e.kind, points: e.points, description: e.description }; });
        var steps = [];
        if (ents.length) steps.push(sb.from("points_table_entries").insert(ents));
        if (sts.length) steps.push(sb.from("points_status_rules").upsert(sts, { onConflict: "points_system_id,status" }));
        if (bns.length) steps.push(sb.from("points_bonuses").insert(bns));
        Promise.all(steps).then(function (xs) {
          var e2 = xs.filter(function (x) { return x.error; })[0];
          if (e2) { undo(dbError(e2.error)); return; }
          openChamp(C.id, { view: "points", pid: nid });
        });
      });
    });
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
      app.innerHTML = '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>" +
        '<div class="card"><h2>Points system</h2><input type="hidden" id="pid" value="' + esc(pid) + '">' +
        '<div class="field"><label for="pn">Name</label><input id="pn" value="' + esc(sys.name) + '"></div>' +
        (sys.source_series ? '<p class="muted" style="margin:8px 0 0">Copied from ' + esc(sys.source_series) + ". " + esc(sys.source_version || "") + (sys.source_url ? ' <a href="' + esc(sys.source_url) + '" target="_blank" rel="noopener">Source</a>' : "") + "</p>" : "") +
        '<div class="field" style="margin-top:10px"><label for="pt">Points per finishing position: one number per line, 1st place first</label><textarea id="pt" style="min-height:160px">' + esc(lines) + "</textarea></div>" +
        (gap ? '<p class="err">This system has gaps in its positions. Saving renumbers it from 1.</p>' : "") +
        '<p class="muted" style="margin:4px 0 0">A position with no line has no points set. Enter 0 where a place scores nothing.</p>' +
        '<h3>Non-finishers</h3><p class="muted" style="margin:0 0 6px">A DNF scores 0 unless you change it here. Leave a box blank to leave it unset.</p><div class="row">' +
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
    sb.from("points_systems").update({ name: name }).eq("id", pid).then(function (r1) {
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
                  openChamp(state.sel.champ.id, { view: "points", pid: pid });
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
  function leagueZone() { return state.sel && state.sel.champ.intended_timezone || null; }
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
  function trackOpts(cur) {
    var T = state.tracks || [];
    if (!T.length) return '<option value="">No tracks loaded yet</option>';
    return '<option value="">Not set</option>' + T.map(function (t) {
      var v = t.track_venues && t.track_venues.name ? t.track_venues.name : "";
      return '<option value="' + esc(t.id) + '"' + (cur === t.id ? " selected" : "") + ">" + esc((v ? v + " · " : "") + t.name + (t.length_km ? " (" + Number(t.length_km).toFixed(2) + " km)" : "")) + "</option>";
    }).join("");
  }
  function trackById(id) { return (state.tracks || []).filter(function (t) { return t.id === id; })[0] || null; }
  function raceRow(r, eid) {
    return '<div class="row rrow" data-rid="' + esc(r.id || "") + '" style="margin-top:6px"><div class="field grow"><label>Race</label><input data-rn value="' + esc(r.name || "") + '" placeholder="For example Sprint"></div>' +
      '<div class="field"><label>Laps</label><input data-rl type="number" min="1" style="width:90px" value="' + esc(r.laps == null ? "" : r.laps) + '"></div>' +
      '<div class="field grow"><label>Points system</label><select data-rp>' + pointsOpts(r.points_system_id) + "</select></div>" +
      '<div class="field"><span class="lbl">Distance</span><div style="padding:7px 0" class="muted" data-rd>' + esc(raceDistance(r, eid)) + "</div></div>" +
      '<button type="button" data-rrm>Remove</button></div>';
  }
  function raceDistance(r, eid) {
    var ev = state.sel.events.filter(function (e) { return e.id === eid; })[0], t = ev && trackById(ev.track_layout_id);
    return t && r.laps && t.length_km ? "≈ " + (Number(t.length_km) * r.laps).toFixed(1) + " km" : "";
  }
  function racesBlock(e) {
    var rs = state.sel.races.filter(function (r) { return r.event_id === e.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; });
    return '<h3>Races in this round</h3><div id="rc-' + e.id + '">' + rs.map(function (r) { return raceRow(r, e.id); }).join("") + '</div><div style="margin-top:8px"><button type="button" data-radd="' + e.id + '">Add a race</button></div>';
  }
  function eventFields(k, e) {
    var loc = e.starts_at && e.timezone ? TZ.localText(Date.parse(e.starts_at), e.timezone) : { date: "", time: "" };
    var lob = e.lobby_opens_at && e.timezone ? TZ.localText(Date.parse(e.lobby_opens_at), e.timezone) : { date: "", time: "" };
    return '<div class="row"><div class="field grow"><label for="en-' + k + '">Name</label><input id="en-' + k + '" value="' + esc(e.name || "") + '"></div>' +
      '<div class="field"><label for="er-' + k + '">Round</label><input id="er-' + k + '" type="number" min="1" style="width:80px" value="' + esc(e.round_number == null ? "" : e.round_number) + '"></div></div>' +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="ed-' + k + '">Date</label><input id="ed-' + k + '" type="date" value="' + esc(loc.date) + '"></div>' +
      '<div class="field"><label for="el-' + k + '">Lobby opens (optional)</label><input id="el-' + k + '" type="time" value="' + esc(lob.time) + '"></div>' +
      '<div class="field"><label for="et-' + k + '">Race start</label><input id="et-' + k + '" type="time" value="' + esc(loc.time) + '"></div>' +
      '<div class="field grow"><span class="lbl">Time zone</span><div id="ez-' + k + '" style="padding:7px 0">' + esc(e.timezone || leagueZone() || "Set the league time zone first") + (e.timezone && leagueZone() && e.timezone !== leagueZone() ? ' <span class="muted">(differs from the league zone)</span>' : "") + "</div></div></div>" +
      (e.id ? '<div class="row" style="margin-top:8px"><div class="field"><label for="eu-' + k + '">Status</label><select id="eu-' + k + '">' + opts([["scheduled", "Scheduled"], ["cancelled", "Cancelled"], ["completed", "Completed"]], e.status, "").replace('<option value=""></option>', "") + "</select></div></div>" : "") +
      '<div class="row" style="margin-top:8px"><div class="field grow"><label for="etk-' + k + '">Track and layout</label><select id="etk-' + k + '">' + trackOpts(e.track_layout_id) + "</select></div>" +
      '<div class="field"><label for="eb-' + k + '">Bonus round</label><label style="display:flex;gap:6px;align-items:center;padding:7px 0"><input id="eb-' + k + '" type="checkbox"' + (e.is_bonus ? " checked" : "") + "> Counts as a bonus round</label></div></div>" +
      '<div class="field" style="margin-top:8px"><label for="eo-' + k + '">Notes for racers (tire wear, damage, weather and anything else)</label><textarea id="eo-' + k + '">' + esc(e.notes || "") + "</textarea></div>";
  }
  function eventHtml(e) {
    var when = "Date and time not set";
    if (e.starts_at && e.timezone) {
      var a = TZ.localText(Date.parse(e.starts_at), e.timezone), b = TZ.localText(Date.parse(e.starts_at), viewerTz);
      var lb = e.lobby_opens_at ? TZ.localText(Date.parse(e.lobby_opens_at), e.timezone).time : "";
      when = a.date + " " + (lb ? "lobby " + lb + ", race " : "") + a.time + " " + e.timezone + (viewerTz !== e.timezone ? " (your time: " + b.date + " " + b.time + ")" : "");
    }
    return '<details class="ev"><summary><span><b>' + (e.round_number ? "Round " + esc(e.round_number) + " · " : "") + esc(e.name || "Unnamed round") + (e.is_bonus ? ' <span class="pill">bonus</span>' : "") + '</b> <span class="pill">' + esc(e.status) + '</span></span><span class="muted">' + esc(when) + "</span></summary>" +
      '<div style="margin-top:10px">' + eventFields(e.id, e) + racesBlock(e) +
      '<div class="row" style="margin-top:8px"><button class="primary" data-es="' + e.id + '" type="button">Save round</button><button class="danger" data-ed="' + e.id + '" type="button">Delete round</button></div><div class="msg" id="em-' + e.id + '"></div></div></details>';
  }
  function readEvent(k, m) {
    var d = $("#ed-" + k).value, t = $("#et-" + k).value, ev = state.sel.events.filter(function (x) { return x.id === k; })[0];
    var z = (ev && ev.timezone) || leagueZone() || "";
    var out = { name: nul($("#en-" + k).value), round_number: numOrNull($("#er-" + k).value), notes: nul($("#eo-" + k).value), track_layout_id: nul($("#etk-" + k).value), is_bonus: $("#eb-" + k).checked };
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
    sb.from("events").insert(v).select("id").then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      insertRaces(r.data || []).then(function (rr) {
        if (rr.error) { msg(m, "The round was created, but its races could not be added: " + dbError(rr.error), "err"); return; }
        openChamp(state.sel.champ.id);
      });
    });
  }
  function readRaces(eid, m) {
    var out = [], bad = null;
    document.querySelectorAll("#rc-" + eid + " .rrow").forEach(function (r) {
      var name = r.querySelector("[data-rn]").value.trim(), laps = numOrNull(r.querySelector("[data-rl]").value);
      if (!name) { bad = "Every race needs a name."; return; }
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
      openChamp(state.sel.champ.id, table === "seasons" || table === "points_systems" ? { view: "champ" } : undefined);
    });
  }

  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") showLogin(); });
  boot();
})();
