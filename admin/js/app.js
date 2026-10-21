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
      evP.then(function (er) {
        state.sel = { champ: rs[0].data, seasons: seasons, events: er.data || [] };
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
      '<div class="field" style="margin-top:8px"><label for="ct">League time zone</label><select id="ct">' + opts(zones, c.intended_timezone, "Not set") + "</select></div>" +
      '<div class="field" style="margin-top:8px"><label for="cd">Description</label><textarea id="cd">' + esc(c.description || "") + "</textarea></div>" +
      '<div class="row" style="margin-top:8px"><button class="primary" id="csave" type="button">Save</button></div><div class="msg" id="cm"></div>' +
      '<h3>Ready to publish?</h3><div id="missing" class="muted">Checking…</div></div>';
    S.seasons.forEach(function (s) { h += seasonHtml(s); });
    h += '<div class="card"><h3 style="margin-top:0">Add a season</h3><div class="row"><div class="field grow"><label for="sn">Name</label><input id="sn"></div>' +
      '<div class="field"><label for="ss">Starts</label><input id="ss" type="date"></div><div class="field"><label for="se">Ends</label><input id="se" type="date"></div>' +
      '<button class="primary" id="sadd" type="button">Add season</button></div><div class="msg" id="sm"></div></div>';
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
  /* ---------- rounds from a schedule ---------- */
  function genHtml(sid) {
    var k = sid;
    return '<div class="card" style="margin:12px 0 0"><div class="lbl" style="margin-bottom:6px">Add rounds from a schedule</div>' +
      '<div class="row"><div class="field"><label for="gn-' + k + '">Number of rounds</label><input id="gn-' + k + '" type="number" min="1" max="200" style="width:110px"></div>' +
      '<div class="field"><label for="gf-' + k + '">Frequency</label><select id="gf-' + k + '" data-gf="' + k + '">' + opts([["weekly", "Weekly"], ["fortnightly", "Fortnightly"], ["monthly", "Monthly"], ["custom", "Custom"]], "", "Not set") + "</select></div>" +
      '<div class="field" id="gmw-' + k + '" hidden><label for="gm-' + k + '">Monthly on</label><select id="gm-' + k + '">' + opts([["day_of_month", "Same day of the month"], ["nth_weekday", "Same weekday (e.g. 2nd Tuesday)"]], "", "Not set") + "</select></div>" +
      '<div class="field" id="gcw-' + k + '" hidden><label for="gi-' + k + '">Every</label><div class="row" style="gap:6px"><input id="gi-' + k + '" type="number" min="1" style="width:80px"><select id="gu-' + k + '" data-gf="' + k + '">' + opts([["day", "days"], ["week", "weeks"], ["month", "months"]], "", "Not set") + "</select></div></div></div>" +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="gd-' + k + '">Starting date</label><input id="gd-' + k + '" type="date"></div>' +
      '<div class="field"><label for="gt-' + k + '">Start time</label><input id="gt-' + k + '" type="time"></div>' +
      '<div class="field grow"><label for="gz-' + k + '">Time zone the time is in</label><select id="gz-' + k + '">' + opts(zones, "", "Not set") + "</select></div></div>" +
      '<div class="row" style="margin-top:8px"><button data-gp="' + k + '" type="button">Preview rounds</button></div><div id="gv-' + k + '"></div></div>';
  }
  function toggleGen(k) {
    var f = $("#gf-" + k).value;
    $("#gmw-" + k).hidden = !(f === "monthly" || (f === "custom" && $("#gu-" + k).value === "month")); $("#gcw-" + k).hidden = f !== "custom";
  }
  function previewRounds(sid) {
    var k = sid, box = $("#gv-" + k); delete plans[sid];
    var z = $("#gz-" + k).value, t = $("#gt-" + k).value;
    var g = SCH.generate({ start: $("#gd-" + k).value, count: numOrNull($("#gn-" + k).value), pattern: $("#gf-" + k).value, monthlyMode: $("#gm-" + k).value, intervalCount: numOrNull($("#gi-" + k).value), intervalUnit: $("#gu-" + k).value });
    if (g.error) { box.innerHTML = '<p class="err">' + esc(g.error) + "</p>"; return; }
    if (!t || !z) { box.innerHTML = '<p class="err">Choose the start time and the time zone.</p>'; return; }
    var evs = state.sel.events.filter(function (e) { return e.season_id === sid; });
    var first = evs.reduce(function (m, e) { return Math.max(m, e.round_number || 0); }, 0) + 1;
    var bad = 0, rows = g.dates.map(function (d, i) {
      var r = TZ.zonedToInstant(d, t, z), n = first + i, line;
      if (r.error) { bad++; line = '<span class="err">' + esc(d) + " " + esc(t) + ": " + (r.error === "nonexistent" ? "this time does not exist in " + esc(z) + " that day, because the clocks skip forward" : r.error === "ambiguous" ? "this time happens twice in " + esc(z) + " that day, because the clocks go back" : "not valid") + "</span>"; }
      else { var mine = TZ.localText(Date.parse(r.instant), viewerTz); line = esc(d + " " + t) + (viewerTz !== z ? ' <span class="muted">(your time: ' + esc(mine.date + " " + mine.time) + ")</span>" : ""); }
      return { d: d, n: n, inst: r.instant, line: "<li>Round " + n + " · " + line + "</li>" };
    });
    var last = g.dates[g.dates.length - 1], season = state.sel.seasons.filter(function (x) { return x.id === sid; })[0];
    var h = '<ul class="missing" style="margin-top:8px">' + rows.map(function (r) { return r.line; }).join("") + "</ul>";
    if (bad) { h += '<p class="err">Change the start time, the date or the zone so every round is valid, then preview again.</p>'; }
    else {
      h += '<p>The season end date will be set to <b>' + esc(last) + "</b>" + (season && season.ends_on && season.ends_on !== last ? ' <span class="muted">(it is currently ' + esc(season.ends_on) + ")</span>" : "") + ".</p>" +
        (evs.length ? '<p class="muted">This season already has ' + evs.length + " event" + (evs.length === 1 ? "" : "s") + ", so numbering continues from round " + first + ".</p>" : "") +
        '<button class="primary" data-gc="' + sid + '" type="button">Create ' + rows.length + " round" + (rows.length === 1 ? "" : "s") + '</button><div class="msg" id="gm2-' + sid + '"></div>';
      plans[sid] = { rows: rows, last: last, z: z, t: t, pattern: $("#gf-" + k).value, mode: $("#gm-" + k).value, ic: numOrNull($("#gi-" + k).value), iu: $("#gu-" + k).value, start: $("#gd-" + k).value };
    }
    box.innerHTML = h;
    var cb = box.querySelector("[data-gc]"); if (cb) cb.addEventListener("click", function () { createRounds(sid); });
  }
  function createRounds(sid) {
    var pl = plans[sid], m = $("#gm2-" + sid); if (!pl) return;
    var btn = $("#gv-" + sid + " [data-gc]"); if (btn) btn.disabled = true;
    msg(m, "Creating…");
    var series = { season_id: sid, pattern: pl.pattern, first_local_date: pl.start, local_time: pl.t, timezone: pl.z, end_type: "after_count", occurrence_count: pl.rows.length };
    if (pl.pattern === "monthly") { series.interval_count = 1; series.interval_unit = "month"; series.monthly_mode = pl.mode; }
    else if (pl.pattern === "custom") { series.interval_count = pl.ic; series.interval_unit = pl.iu; if (pl.iu === "month") series.monthly_mode = pl.mode || null; }
    else { series.interval_count = pl.pattern === "weekly" ? 1 : 2; series.interval_unit = "week"; }
    sb.from("event_series").insert(series).select("id").single().then(function (sr) {
      if (sr.error) { msg(m, dbError(sr.error), "err"); if (btn) btn.disabled = false; return; }
      var evs = pl.rows.map(function (r) { return { season_id: sid, series_id: sr.data.id, occurrence_date: r.d, round_number: r.n, starts_at: r.inst, original_starts_at: r.inst, timezone: pl.z }; });
      sb.from("events").insert(evs).then(function (er) {
        if (er.error) { sb.from("event_series").delete().eq("id", sr.data.id).then(function () { msg(m, "No rounds were created: " + dbError(er.error), "err"); if (btn) btn.disabled = false; }); return; }
        sb.from("seasons").update({ ends_on: pl.last }).eq("id", sid).then(function (ur) {
          delete plans[sid];
          openChamp(state.sel.champ.id);
          if (ur.error) setTimeout(function () { var el = $("#sm-" + sid); msg(el, "Rounds were created, but the season end date could not be set: " + dbError(ur.error), "err"); }, 600);
        });
      });
    });
  }

  function addSeason() {
    var m = $("#sm"), name = $("#sn").value.trim();
    if (!name) { msg(m, "Type a season name first.", "err"); return; }
    sb.from("seasons").insert({ championship_id: state.sel.champ.id, name: name, starts_on: nul($("#ss").value), ends_on: nul($("#se").value) }).then(function (r) {
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
      '<div class="field grow"><label for="ez-' + k + '">Time zone the time is in</label><select id="ez-' + k + '">' + opts(zones, e.timezone, "Not set") + "</select></div></div>" +
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
    var d = $("#ed-" + k).value, t = $("#et-" + k).value, z = $("#ez-" + k).value;
    var out = { name: nul($("#en-" + k).value), round_number: numOrNull($("#er-" + k).value), notes: nul($("#eo-" + k).value) };
    var any = d || t || z;
    if (any) {
      if (!d || !t || !z) { msg(m, "Set the date, the start time and the time zone together, or leave all three blank.", "err"); return null; }
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
