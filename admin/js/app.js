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
        return '<button type="button" class="item" data-id="' + esc(c.id) + '"><span>' + esc(c.name) + '</span><span class="muted">' + esc(c.status) + (c.visibility ? " · " + esc(c.visibility) : " · visibility not set") + "</span></button>";
      }).join("") : '<p class="muted">None yet.</p>') + "</div></div>" +
      '<div class="card"><h3 style="margin-top:0">New championship</h3><div class="row"><div class="field grow"><label for="nn">Name</label><input id="nn" type="text"></div><button class="primary" id="nadd" type="button">Create</button></div><div class="msg" id="nm"></div>' +
      '<p class="muted">It starts as a draft with every other setting blank.</p></div>';
    app.querySelectorAll("button.item").forEach(function (b) { b.addEventListener("click", function () { openChamp(b.dataset.id); }); });
    $("#nadd").addEventListener("click", function () {
      var n = $("#nn").value.trim(); if (!n) { msg($("#nm"), "Type a name first.", "err"); return; }
      sb.from("championships").insert({ name: n }).select("id").single().then(function (r) {
        if (r.error) { msg($("#nm"), dbError(r.error), "err"); return; }
        openChamp(r.data.id);
      });
    });
  }
  function openChamp(id) {
    Promise.all([
      sb.from("championships").select("*").eq("id", id).single(),
      sb.from("seasons").select("*").eq("championship_id", id).order("starts_on", { ascending: true, nullsFirst: false }),
    ]).then(function (rs) {
      if (rs[0].error) { app.innerHTML = '<div class="card err">' + esc(dbError(rs[0].error)) + "</div>"; return; }
      var seasons = rs[1].data || [], ids = seasons.map(function (s) { return s.id; });
      var evP = ids.length ? sb.from("events").select("*").in("season_id", ids).order("starts_at", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] });
      var srP = ids.length ? sb.from("event_series").select("*").in("season_id", ids) : Promise.resolve({ data: [] });
      Promise.all([evP, srP]).then(function (xs) {
        state.sel = { champ: rs[0].data, seasons: seasons, events: xs[0].data || [], series: xs[1].data || [] };
        renderChamp();
        refreshMissing();
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
      '<div class="field" style="margin-top:8px"><label for="cd">Description</label><textarea id="cd">' + esc(c.description || "") + "</textarea></div>" +
      '<div class="row" style="margin-top:8px"><button class="primary" id="csave" type="button">Save</button></div><div class="msg" id="cm"></div>' +
      '<h3>Ready to publish?</h3><div id="missing" class="muted">Checking…</div></div>';
    S.seasons.forEach(function (s) { h += seasonHtml(s); });
    h += '<div class="card"><h3 style="margin-top:0">Add a season</h3><div class="row"><div class="field grow"><label for="sn">Name</label><input id="sn"></div>' +
      '<button id="sadd" type="button">Add season without rounds</button></div><div class="msg" id="sm"></div>' + genHtml("new") + "</div>";
    app.innerHTML = h;
    $("#back").addEventListener("click", loadChamps);
    $("#csave").addEventListener("click", saveChamp);
    $("#sadd").addEventListener("click", addSeason);
    app.querySelectorAll("[data-sv]").forEach(function (b) { b.addEventListener("click", function () { saveSeason(b.dataset.sv); }); });
    app.querySelectorAll("[data-sd]").forEach(function (b) { b.addEventListener("click", function () { del("seasons", b.dataset.sd, b); }); });
    app.querySelectorAll("[data-gp]").forEach(function (b) { b.addEventListener("click", function () { previewRounds(b.dataset.gp); }); });
    app.querySelectorAll("[data-gc]").forEach(function (b) { b.addEventListener("click", function () { createRounds(b.dataset.gc); }); });
    app.querySelectorAll("[data-gf]").forEach(function (el) { el.addEventListener("change", function () { toggleGen(el.dataset.gf); delete plans[el.dataset.gf]; var pv = $("#gv-" + el.dataset.gf); if (pv) pv.innerHTML = ""; }); toggleGen(el.dataset.gf); });
    app.querySelectorAll("[data-ea]").forEach(function (b) { b.addEventListener("click", function () { addEvent(b.dataset.ea); }); });
    app.querySelectorAll("[data-es]").forEach(function (b) { b.addEventListener("click", function () { saveEvent(b.dataset.es); }); });
    app.querySelectorAll("[data-ed]").forEach(function (b) { b.addEventListener("click", function () { del("events", b.dataset.ed, b); }); });
  }
  function saveChamp() {
    var c = state.sel.champ, m = $("#cm");
    var patch = { name: $("#cn").value.trim(), visibility: nul($("#cv").value), intended_timezone: nul($("#ct").value), description: nul($("#cd").value), status: $("#cs").value };
    if (!patch.name) { msg(m, "The name cannot be blank.", "err"); return; }
    msg(m, "Saving…");
    sb.from("championships").update(patch).eq("id", c.id).select("*").single().then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      state.sel.champ = r.data; renderChamp(); msg($("#cm"), "Saved.", "ok"); refreshMissing();
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
      "<h3>Events (" + evs.length + ")</h3>";
    evs.forEach(function (e) { h += eventHtml(e); });
    h += genHtml(s.id);
    h += '<div class="card" style="margin:12px 0 0"><div class="lbl" style="margin-bottom:6px">Add a single event</div>' + eventFields("new-" + s.id, {}) +
      '<div class="row" style="margin-top:8px"><button class="primary" data-ea="' + s.id + '" type="button">Add event</button></div><div class="msg" id="em-new-' + s.id + '"></div></div></div>';
    return h;
  }
  /* ---------- the season's schedule ---------- */
  // The frequency, start time and zone belong to the season. They are set once, either when the
  // season is created or the first time rounds are added, and later rounds reuse them.
  var FREQ_OPTS = { weekly: { l: "Weekly", pattern: "weekly", n: 1 }, fortnightly: { l: "Fortnightly", pattern: "fortnightly", n: 2 }, w3: { l: "Every 3 weeks", pattern: "custom", n: 3 }, w4: { l: "Every 4 weeks", pattern: "custom", n: 4 } };
  function leagueZone() { return state.sel && state.sel.champ.intended_timezone || null; }
  var FREQ = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", custom: "Custom" };
  function seriesFor(sid) { return (state.sel.series || []).filter(function (x) { return x.season_id === sid; })[0] || null; }
  function scheduleText(r) {
    var f = FREQ[r.pattern] || r.pattern;
    if (r.pattern === "custom") f = "Every " + r.interval_count + " " + r.interval_unit + (r.interval_count > 1 ? "s" : "");
    if (r.monthly_mode) f += r.monthly_mode === "nth_weekday" ? ", same weekday" : ", same day of the month";
    return f + " · " + String(r.local_time).slice(0, 5) + " " + r.timezone + " · first round " + r.first_local_date + " · " + r.occurrence_count + " round" + (r.occurrence_count === 1 ? "" : "s") + " so far";
  }
  function genHtml(k) {
    var ser = k === "new" ? null : seriesFor(k);
    var title = k === "new" ? "Schedule (optional): create the season with its rounds" : ser ? "Add more rounds" : "Set the season's schedule and add rounds";
    var h = '<div class="card" style="margin:12px 0 0"><div class="lbl" style="margin-bottom:6px">' + title + "</div>";
    if (ser) {
      h += '<p class="muted" style="margin:0 0 8px">Schedule for this season: ' + esc(scheduleText(ser)) + ". New rounds follow it.</p>" +
        '<div class="row"><div class="field"><label for="gn-' + k + '">Number of rounds to add</label><input id="gn-' + k + '" type="number" min="1" max="200" style="width:110px"></div></div>';
    } else {
      var lz = leagueZone();
      h += '<div class="row"><div class="field"><label for="gn-' + k + '">Number of rounds</label><input id="gn-' + k + '" type="number" min="1" max="200" style="width:110px"></div>' +
        '<div class="field"><label for="gf-' + k + '">Frequency</label><select id="gf-' + k + '" data-gf="' + k + '">' + opts(Object.keys(FREQ_OPTS).map(function (x) { return [x, FREQ_OPTS[x].l]; }), "", "Not set") + "</select></div>" +
        '<div class="field"><label for="gd-' + k + '">Starting date</label><input id="gd-' + k + '" type="date"></div>' +
        '<div class="field"><label for="gt-' + k + '">Start time</label><input id="gt-' + k + '" type="time"></div></div>' +
        (lz ? '<p class="muted" style="margin:8px 0 0">Times are in the league time zone: ' + esc(lz) + ".</p>" : '<p class="err" style="margin:8px 0 0">Set the league time zone at the top of this page and save before adding rounds.</p>');
    }
    return h + '<div class="row" style="margin-top:8px"><button data-gp="' + k + '" type="button">Preview rounds</button></div><div id="gv-' + k + '"></div></div>';
  }
  function toggleGen() { /* the frequency has no dependent fields any more */ }
  function previewRounds(k) {
    var box = $("#gv-" + k), sid = k === "new" ? null : k; delete plans[k];
    var ser = sid ? seriesFor(sid) : null, done = ser ? ser.occurrence_count : 0, extra = numOrNull($("#gn-" + k).value), cfgv;
    if (ser) cfgv = { pattern: ser.pattern, mode: ser.monthly_mode || "", ic: ser.interval_count, iu: ser.interval_unit, start: ser.first_local_date, t: String(ser.local_time).slice(0, 5), z: ser.timezone };
    else {
      var fo = FREQ_OPTS[$("#gf-" + k).value];
      cfgv = { pattern: fo ? fo.pattern : "", mode: "", ic: fo ? fo.n : null, iu: "week", start: $("#gd-" + k).value, t: $("#gt-" + k).value, z: leagueZone() };
      if (!cfgv.z) { box.innerHTML = '<p class="err">Set the league time zone at the top of this page and save first.</p>'; return; }
    }
    if (k === "new" && !$("#sn").value.trim()) { box.innerHTML = '<p class="err">Type the season name first.</p>'; return; }
    if (!(extra >= 1)) { box.innerHTML = '<p class="err">Enter the number of rounds.</p>'; return; }
    var g = SCH.generate({ start: cfgv.start, count: done + extra, pattern: cfgv.pattern, monthlyMode: cfgv.mode, intervalCount: cfgv.ic, intervalUnit: cfgv.iu });
    if (g.error) { box.innerHTML = '<p class="err">' + esc(g.error) + "</p>"; return; }
    if (!cfgv.t) { box.innerHTML = '<p class="err">Choose the start time.</p>'; return; }
    var dates = g.dates.slice(done);
    var evs = sid ? state.sel.events.filter(function (e) { return e.season_id === sid; }) : [];
    var first = evs.reduce(function (m, e) { return Math.max(m, e.round_number || 0); }, 0) + 1;
    var bad = 0, rows = dates.map(function (d, i) {
      var r = TZ.zonedToInstant(d, cfgv.t, cfgv.z), n = first + i, line;
      if (r.error) { bad++; line = '<span class="err">' + esc(d) + " " + esc(cfgv.t) + ": " + (r.error === "nonexistent" ? "this time does not exist in " + esc(cfgv.z) + " that day, because the clocks skip forward" : r.error === "ambiguous" ? "this time happens twice in " + esc(cfgv.z) + " that day, because the clocks go back" : "not valid") + "</span>"; }
      else { var mine = TZ.localText(Date.parse(r.instant), viewerTz); line = esc(d + " " + cfgv.t) + (viewerTz !== cfgv.z ? ' <span class="muted">(your time: ' + esc(mine.date + " " + mine.time) + ")</span>" : ""); }
      return { d: d, n: n, inst: r.instant, line: "<li>Round " + n + " · " + line + "</li>" };
    });
    var last = g.dates[g.dates.length - 1], season = sid ? state.sel.seasons.filter(function (x) { return x.id === sid; })[0] : null;
    var h = '<ul class="missing" style="margin-top:8px">' + rows.map(function (r) { return r.line; }).join("") + "</ul>";
    if (bad) h += '<p class="err">Change the start time, the date or the zone so every round is valid, then preview again.</p>';
    else {
      h += "<p>" + (k === "new" ? "The season will start on <b>" + esc(g.dates[0]) + "</b> and end on <b>" + esc(last) + "</b>." : "The season end date will be set to <b>" + esc(last) + "</b>" + (season && season.ends_on && season.ends_on !== last ? ' <span class="muted">(it is currently ' + esc(season.ends_on) + ")</span>" : "") + ".") + "</p>" +
        (evs.length ? '<p class="muted">This season already has ' + evs.length + " event" + (evs.length === 1 ? "" : "s") + ", so numbering continues from round " + first + ".</p>" : "") +
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
        ruleP = sb.from("event_series").insert(series).select("id").single();
      }
      ruleP.then(function (rr) {
        if (rr.error) { fail(dbError(rr.error), undoSeason); return; }
        var undoRule = function () {
          var u = pl.ser ? sb.from("event_series").update({ occurrence_count: pl.done }).eq("id", pl.ser.id) : sb.from("event_series").delete().eq("id", rr.data.id);
          return u.then(undoSeason);
        };
        // 3. the events
        var evs = pl.rows.map(function (r) { return { season_id: sid, series_id: rr.data.id, occurrence_date: r.d, round_number: r.n, starts_at: r.inst, original_starts_at: r.inst, timezone: cf.z }; });
        sb.from("events").insert(evs).then(function (er) {
          if (er.error) { fail("No rounds were created: " + dbError(er.error), undoRule); return; }
          // 4. the season end date
          sb.from("seasons").update({ ends_on: pl.last }).eq("id", sid).then(function (ur) {
            delete plans[k];
            openChamp(state.sel.champ.id);
            if (ur.error) setTimeout(function () { msg($("#sm-" + sid), "Rounds were created, but the season end date could not be set: " + dbError(ur.error), "err"); }, 600);
          });
        });
      });
    });
  }

  function addSeason() {
    var m = $("#sm"), name = $("#sn").value.trim();
    if (!name) { msg(m, "Type a season name first.", "err"); return; }
    sb.from("seasons").insert({ championship_id: state.sel.champ.id, name: name, starts_on: null, ends_on: null }).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      openChamp(state.sel.champ.id);
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
  function eventFields(k, e) {
    var loc = e.starts_at && e.timezone ? TZ.localText(Date.parse(e.starts_at), e.timezone) : { date: "", time: "" };
    return '<div class="row"><div class="field grow"><label for="en-' + k + '">Name</label><input id="en-' + k + '" value="' + esc(e.name || "") + '"></div>' +
      '<div class="field"><label for="er-' + k + '">Round</label><input id="er-' + k + '" type="number" min="1" style="width:80px" value="' + esc(e.round_number == null ? "" : e.round_number) + '"></div></div>' +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="ed-' + k + '">Date</label><input id="ed-' + k + '" type="date" value="' + esc(loc.date) + '"></div>' +
      '<div class="field"><label for="et-' + k + '">Start time</label><input id="et-' + k + '" type="time" value="' + esc(loc.time) + '"></div>' +
      '<div class="field grow"><span class="lbl">Time zone</span><div id="ez-' + k + '" style="padding:7px 0">' + esc(e.timezone || leagueZone() || "Set the league time zone first") + (e.timezone && leagueZone() && e.timezone !== leagueZone() ? ' <span class="muted">(differs from the league zone)</span>' : "") + "</div></div></div>" +
      (e.id ? '<div class="row" style="margin-top:8px"><div class="field"><label for="eu-' + k + '">Status</label><select id="eu-' + k + '">' + opts([["scheduled", "Scheduled"], ["cancelled", "Cancelled"], ["completed", "Completed"]], e.status, "").replace('<option value=""></option>', "") + "</select></div></div>" : "") +
      '<div class="field" style="margin-top:8px"><label for="eo-' + k + '">Notes for racers (tire wear, damage, weather and anything else)</label><textarea id="eo-' + k + '">' + esc(e.notes || "") + "</textarea></div>";
  }
  function eventHtml(e) {
    var when = "Date and time not set";
    if (e.starts_at && e.timezone) {
      var a = TZ.localText(Date.parse(e.starts_at), e.timezone), b = TZ.localText(Date.parse(e.starts_at), viewerTz);
      when = a.date + " " + a.time + " " + e.timezone + (viewerTz !== e.timezone ? " (your time: " + b.date + " " + b.time + ")" : "");
    }
    return '<details class="ev"><summary><span><b>' + (e.round_number ? "Round " + esc(e.round_number) + " · " : "") + esc(e.name || "Unnamed event") + '</b> <span class="pill">' + esc(e.status) + '</span></span><span class="muted">' + esc(when) + "</span></summary>" +
      '<div style="margin-top:10px">' + eventFields(e.id, e) +
      '<div class="row" style="margin-top:8px"><button class="primary" data-es="' + e.id + '" type="button">Save event</button><button class="danger" data-ed="' + e.id + '" type="button">Delete event</button></div><div class="msg" id="em-' + e.id + '"></div></div></details>';
  }
  function readEvent(k, m) {
    var d = $("#ed-" + k).value, t = $("#et-" + k).value, ev = state.sel.events.filter(function (x) { return x.id === k; })[0];
    var z = (ev && ev.timezone) || leagueZone() || "";
    var out = { name: nul($("#en-" + k).value), round_number: numOrNull($("#er-" + k).value), notes: nul($("#eo-" + k).value) };
    var any = d || t;
    if (any) {
      if (!z) { msg(m, "Set the league time zone at the top of this page and save first.", "err"); return null; }
      if (!d || !t) { msg(m, "Set the date and the start time together, or leave both blank.", "err"); return null; }
      var r = TZ.zonedToInstant(d, t, z);
      if (r.error === "nonexistent") { msg(m, "That time does not exist in " + z + " on that date, because the clocks skip forward. Pick another time.", "err"); return null; }
      if (r.error === "ambiguous") { msg(m, "That time happens twice in " + z + " on that date, because the clocks go back. Pick a time outside that hour.", "err"); return null; }
      if (r.error) { msg(m, "The date, time or time zone is not valid.", "err"); return null; }
      out.starts_at = r.instant; out.timezone = z;
    } else { out.starts_at = null; out.timezone = null; }
    return out;
  }
  function addEvent(sid) {
    var k = "new-" + sid, m = $("#em-" + k), v = readEvent(k, m); if (!v) return;
    v.season_id = sid;
    sb.from("events").insert(v).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      openChamp(state.sel.champ.id);
    });
  }
  function saveEvent(id) {
    var m = $("#em-" + id), v = readEvent(id, m); if (!v) return;
    v.status = $("#eu-" + id).value;
    var old = state.sel.events.filter(function (e) { return e.id === id; })[0];
    // Moving an event that came from a schedule marks it as an override; the original time is kept.
    if (old && old.series_id && old.starts_at !== v.starts_at) v.is_override = true;
    sb.from("events").update(v).eq("id", id).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      openChamp(state.sel.champ.id);
    });
  }

  /* ---------- delete (two clicks, no dialog) ---------- */
  function del(table, id, btn) {
    var key = table + id;
    if (armed !== key) { armed = key; btn.textContent = "Click again to delete for good"; return; }
    armed = null;
    sb.from(table).delete().eq("id", id).then(function (r) {
      if (r.error) { btn.textContent = dbError(r.error); return; }
      openChamp(state.sel.champ.id);
    });
  }

  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") showLogin(); });
  boot();
})();
