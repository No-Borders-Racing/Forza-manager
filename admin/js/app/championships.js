/* Championships: the list, one championship's screen and its settings. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

/* ---------- championships ---------- */
function loadChamps() {
  sb.from("championships").select("id,name").eq("league_id", state.league.id).order("created_at", { ascending: false }).then(function (r) {
    if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + "</div>"; return; }
    state.champs = r.data; state.sel = null;
    renderChampList();
  });
}
function renderChampList() {
  var lg = state.league;
  app.innerHTML = navHtml("c") + '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">' + esc(lg && lg.name ? lg.name : "League not named yet") + '</h2><span class="muted">League time zone: ' + esc(lg && lg.timezone ? lg.timezone : "not set") + '</span></div><div class="row">' + ((state.leagues || []).length > 1 || state.owner ? '<button type="button" id="switchbtn">Switch league</button>' : "") + '</div></div></div>' +
    '<div class="card"><h2>Championships</h2><div class="list">' +
    (state.champs.length ? state.champs.map(function (c) {
      return '<div style="display:flex;gap:6px;align-items:center"><button type="button" class="item" data-id="' + esc(c.id) + '"><span>' + esc(c.name) + '</span></button><button type="button" class="danger" data-ldel="' + esc(c.id) + '">Delete</button></div>';
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
  if (state.focusNew) { state.focusNew = false; var nf = $("#nn"); if (nf) { nf.focus(); try { nf.scrollIntoView({ block: "center" }); } catch (e) {} } }
  if ($("#switchbtn")) $("#switchbtn").addEventListener("click", renderLeaguePicker);
  $("#nadd").addEventListener("click", function () {
    var n = $("#nn").value.trim(); if (!n) { msg($("#nm"), "Type a name first.", "err"); return; }
    sb.from("championships").insert({ name: n, league_id: state.league.id, intended_timezone: (state.league && state.league.timezone) || browserZone() }).select("id").single().then(function (r) {
      if (r.error) { msg($("#nm"), dbError(r.error), "err"); return; }
      openChamp(r.data.id);
    });
  });
}
/* The championship's cars as plain labels, for the "Car used" choice beside a reference lap. Cheap: only the chosen cars are read. */
function carOptLabels(cc, cars, builds) {
  var out = [];
  cc.forEach(function (x) { if (x.car_id) { var c = cars[x.car_id]; if (c) out.push(carName(c)); } else if (x.build_id) { var b = builds[x.build_id]; if (b) out.push(b.name + " (custom)"); } });
  return out.sort(function (a, b) { return a.localeCompare(b); });
}
function loadChampCarOpts(cid, done) {
  fetchCC("id,car_id,build_id", function (q) { return q.eq("championship_id", cid); }).then(function (r) {
    var cc = r.data || []; state.sel.ccrows = cc; state.sel.ccopts = [];
    if (r.error || !cc.length) { done(0); return; }
    function chunked(table, cols, ids) {
      var parts = []; for (var i = 0; i < ids.length; i += 100) parts.push(sb.from(table).select(cols).in("id", ids.slice(i, i + 100)));
      return Promise.all(parts).then(function (rs) { var m = {}; rs.forEach(function (x) { (x.data || []).forEach(function (y) { m[y.id] = y; }); }); return m; });
    }
    var dids = cc.filter(function (x) { return x.division_id; }).map(function (x) { return x.division_id; });
    // A division adds every car in its list.
    (dids.length ? sb.from("division_cars").select("car_id").in("division_id", dids) : Promise.resolve({ data: [] })).then(function (dr) {
      var extra = (dr.data || []).map(function (x) { return x.car_id; });
      var cids = cc.filter(function (x) { return x.car_id; }).map(function (x) { return x.car_id; }).concat(extra), bids = cc.filter(function (x) { return x.build_id; }).map(function (x) { return x.build_id; });
      Promise.all([chunked("cars", "id,make,model,year,nickname", cids), chunked("build_sheets", "id,name", bids)]).then(function (xs) {
        var rows = cc.filter(function (x) { return !x.division_id; }).concat(extra.map(function (id) { return { car_id: id }; }));
        state.sel.ccopts = carOptLabels(rows, xs[0], xs[1]).filter(function (v, k, a) { return a.indexOf(v) === k; }); done(cc.length);
      });
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
        state.lastChamp = id;
        state.sel = { champ: rs[0].data, seasons: seasons, events: evList, series: xs[1].data || [], points: xs[2].data || [], library: xs[3].data || [], leaguePts: xs[6].data || [], templates: xs[4].data || [], races: rr.data || [] };
        state.tracks = xs[5].data || [];
        if (!prev) state.tab = "seasons";
        if (state.wantTab) { state.tab = state.wantTab; state.wantTab = null; }
        state.nav = nav || prev || { view: "champ" };
        if (state.nav.view === "season" && !seasons.some(function (x) { return x.id === state.nav.sid; })) state.nav = { view: "champ" };
        loadChampCarOpts(id, function () { renderCurrent(); });
      });
    });
  });
}
function leagueZone() { return (state.league && state.league.timezone) || browserZone() || null; }
state.tzTried = state.tzTried || {};
function scheduleCardHtml(c) {
  return '<div class="card"><h2>Schedule</h2>' +
      '<p class="muted" style="margin:0 0 6px">How often you race and when. Every weekend follows it. Times are in the championship time zone.</p>' +
      '<div class="row"><div class="field"><label for="cfreq">Frequency</label><select id="cfreq">' + opts([["1", "Weekly"], ["2", "Fortnightly"], ["3", "Every 3 weeks"], ["4", "Every 4 weeks"]], c.schedule_every_weeks == null ? "" : String(c.schedule_every_weeks), "Not set") + "</select></div>" +
      '<div class="field"><label for="clob">Lobby opens (optional)</label><input id="clob" type="time" value="' + esc(c.lobby_local_time ? String(c.lobby_local_time).slice(0, 5) : "") + '"></div>' +
      '<div class="field"><label for="crace">Race start</label><input id="crace" type="time" value="' + esc(c.race_local_time ? String(c.race_local_time).slice(0, 5) : "") + '"></div></div>' +
    '<div class="row" style="margin-top:8px"><button class="primary" id="schsave" type="button">Save schedule</button><button type="button" data-cancel="reset">Cancel</button><span class="muted">Time zone: ' + esc(c.intended_timezone || champZone() || "not set") + '</span></div><div class="msg" id="schm"></div></div>';
}
function champHeadHtml(c, tab) {
  var inSet = tab === "settings";
  var tabs = [["cars", "Cars"], ["points", "Points"], ["seasons", "Calendar"], ["results", "Results"], ["standings", "Standings"]];
  return navHtml("c") +
    '<div class="card" style="padding-bottom:8px"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">' + esc(c.name) + '</h2></div>' +
    '<div class="row scrollrow" style="margin-top:10px">' + tabs.map(function (t) { return '<button type="button" data-tab="' + t[0] + '"' + (t[0] === tab ? ' class="primary"' : "") + ">" + t[1] + "</button>"; }).join("") +
    '<button type="button" data-tab="settings" style="margin-left:auto"' + (inSet ? ' class="primary"' : "") + ">Championship settings</button></div>" +
    "</div>";
}
function renderChamp() {
  var S = state.sel, c = S.champ, tab = state.tab || "seasons";
  var h = champHeadHtml(c, tab);
  if (tab === "settings") {
    // Older championships have no zone: fill it in from the league once, without a click.
    if (!c.intended_timezone && leagueZone() && !state.tzTried[c.id]) {
      state.tzTried[c.id] = true;
      sb.from("championships").update({ intended_timezone: leagueZone() }).eq("id", c.id).select("*").single().then(function (r) {
        if (!r.error && r.data && state.sel && state.sel.champ.id === c.id) { state.sel.champ = r.data; if (state.tab === "settings") renderChamp(); }
      });
    }
    var tzNote = c.intended_timezone ? '<b>' + esc(c.intended_timezone) + '</b> · ' + esc(gmt(c.intended_timezone)) + ' <span class="muted">(the league time zone when this championship was created; viewers see times in their own zone)</span>' :
      '<span class="err">Not set.</span> <button type="button" id="cusetz">Use the league time zone (' + esc(leagueZone() || "none found") + ")</button>";
    h += '<div class="card">' +
      '<p style="margin:10px 0 0"><span class="lbl">Time zone</span><br>' + tzNote + "</p>" +
      '<div class="field" style="margin-top:8px"><label for="cd">Championship overview</label><textarea id="cd" rows="6" placeholder="What racers need to know about every round: cars, format, qualifying, grid rules. Shown at the top of the public calendar and championship page.">' + esc(c.description || "") + "</textarea></div>" +
      '<div class="field" style="margin-top:8px"><label for="cr">Rules</label><textarea id="cr" rows="6" placeholder="Anything racers must follow: penalties, tuning limits, protests, conduct">' + esc(c.rules || "") + "</textarea></div>" +
      '<div class="row" style="margin-top:8px"><button class="primary" id="csave" type="button">Save</button><button type="button" data-cancel="reset">Cancel</button><button id="crename" type="button">Rename</button></div><div class="msg" id="cm"></div>' +
      '<div id="renamebox"></div></div>';
    h += pagePublishHtml("c", c);
    h += '<div class="card"><h3 style="margin-top:0">Delete this championship</h3><p class="muted" style="margin:0 0 8px">This permanently deletes the championship with all of its seasons, rounds, races, points systems, classes and race format. It cannot be undone. To confirm, type its name: <b>' + esc(c.name) + '</b></p>' +
      '<div class="row"><div class="field grow"><label for="cdn">Championship name</label><input id="cdn" autocomplete="off"></div><button class="danger" id="cdel" type="button" disabled>Delete championship</button></div><div class="msg" id="cdm"></div></div>';
  } else if (tab === "points") h += pointsCardHtml();
  else if (tab === "format") h += templateCardHtml();
  else if (tab === "cars") h += champCarsHtml();
  else if (tab === "results") h += resultsTabHtml();
  else if (tab === "standings") h += '<div class="card"><h2>Standings</h2><div id="stand" class="muted">Loading…</div></div>';
  else {
    h += scheduleCardHtml(c);
    if (!S.seasons.length) {
      h += '<div class="card"><h2>Create the calendar</h2><p class="muted" style="margin:0 0 8px">Choose how many weekends and when the first one is. They follow the schedule above. You then set the venue and laps for each weekend.</p>' +
        '<div class="field"><label for="sn">Season name</label><input id="sn" value="Season 1"></div><div class="msg" id="sm"></div>' + genHtml("new") +
        '<div class="row" style="margin-top:12px"><button id="sadd" type="button">Add season without weekends</button></div></div>';
    } else {
      var cur = S.seasons.filter(function (x) { return x.id === state.curSeason; })[0] || S.seasons[S.seasons.length - 1];
      if (S.seasons.length > 1) h += '<div class="card"><div class="field"><label for="curseason">Season</label><select id="curseason">' + S.seasons.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></div></div>";
      h += seasonHtml(cur);
      h += '<div style="margin-top:12px"><button id="newseasonbtn" type="button">Start a new season</button></div>';
    }
  }
  app.innerHTML = h;
  bindAll(); bindNav();
  if (tab === "cars") fillChampCars();
  if (tab === "results") fillCounts();
  if (tab === "standings") renderStandings();
}
function renderCurrent() {
  var n = state.nav || { view: "champ" };
  if (n.view === "race") renderRaceResults(n.rid); else if (n.view === "points") renderPoints(n.pid); else if (n.view === "season") { state.curSeason = n.sid; state.tab = "seasons"; state.nav = { view: "champ" }; renderChamp(); } else if (n.view === "newseason") renderNewSeason(); else renderChamp();
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
  on("[data-tab]", function (b) { state.tab = b.dataset.tab; renderChamp(); });
  on("#csave", saveChamp);
  on("#schsave", saveSchedule);
  on("#newseasonbtn", function () { state.nav = { view: "newseason" }; renderCurrent(); });
  var cs = $("#curseason"); if (cs) cs.addEventListener("change", function () { state.curSeason = cs.value; renderChamp(); });
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
  var cdn = $("#cdn"); if (cdn) cdn.addEventListener("input", function () { $("#cdel").disabled = cdn.value.trim() !== state.sel.champ.name; });
  on("[data-rr]", function (b) { state.nav = { view: "race", rid: b.dataset.rr }; renderCurrent(); });
  on("#tolp", function () { renderLeaguePoints(); });
  on("[data-pp]", function (b) { state.pscope = "champ"; state.nav = { view: "points", pid: b.dataset.pp }; renderCurrent(); });
  on("#padd", addPoints);
  var plib = $("#plib"); if (plib) plib.addEventListener("change", function () { showPointsPreview(plib.value, $("#pprev")); });
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
      var ins = document.querySelectorAll("#rc-" + k + " [data-rl]");
      if (!ins.length) { box.textContent = "There are no races below yet. Add a race first."; return; }
      ins.forEach(function (i) { i.value = laps; i.style.outline = "2px solid var(--ok, #4a9)"; setTimeout(function () { i.style.outline = ""; }, 1500); });
      refreshDistances(k);
      box.textContent = "Done: " + laps + (laps === 1 ? " lap" : " laps") + " set on " + ins.length + (ins.length === 1 ? " race" : " races") + " in Races in this round, below.";
      ins[0].scrollIntoView({ block: "center", behavior: "smooth" });
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
  on("[data-rup]", function (b) { stepRound(b.dataset.rup, -1); });
  on("[data-rdn]", function (b) { stepRound(b.dataset.rdn, 1); });
  on("[data-bye]", function (b) { byeWeek(b.dataset.bye); });
  on("[data-cpcopy]", function (b) {
    var inp = $("#cpl-" + b.dataset.cpcopy), m = $("#cpm-" + b.dataset.cpcopy); inp.select();
    copyText(inp.value, function (ok) { msg(m, ok ? "Link copied." : "Press Ctrl+C to copy the selected link.", ok ? "ok" : ""); });
  });
  on("[data-sd]", function (b) { del("seasons", b.dataset.sd, b); });
  on("[data-gp]", function (b) { previewRounds(b.dataset.gp); });
  on("[data-gc]", function (b) { createRounds(b.dataset.gc); });
  on("[data-ea]", function (b) { addEvent(b.dataset.ea); });
  on("[data-es]", function (b) { saveEvent(b.dataset.es); });
  on("[data-ed]", function (b) { del("events", b.dataset.ed, b); });
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
  var patch = { name: $("#cn") ? $("#cn").value.trim() : c.name, description: nul($("#cd").value) };
  var rl = $("#cr"); if (rl && (nul(rl.value) !== null || c.rules != null)) patch.rules = nul(rl.value);
  if (!patch.name) { msg(m, "The name cannot be blank.", "err"); return; }
  msg(m, "Saving…");
  sb.from("championships").update(patch).eq("id", c.id).select("*").single().then(function (r) {
    if (r.error) { msg(m, dbError(r.error), "err"); return; }
    state.sel.champ = r.data; renderChamp(); msg($("#cm"), "Saved.", "ok");
  });
}
function saveSchedule() {
  var c = state.sel.champ, m = $("#schm");
  var patch = { schedule_every_weeks: numOrNull($("#cfreq").value), lobby_local_time: nul($("#clob").value), race_local_time: nul($("#crace").value) };
  if (patch.lobby_local_time && !patch.race_local_time) { msg(m, "Set the race start as well as the lobby time.", "err"); return; }
  if (patch.lobby_local_time && patch.lobby_local_time > patch.race_local_time) { msg(m, "The lobby must open at or before the race start, on the same day.", "err"); return; }
  // A new race or lobby time also applies to rounds that are already made, except rounds that were moved by hand, completed or cancelled.
  var hhmm = function (v) { return v ? String(v).slice(0, 5) : ""; };
  var nr = hhmm(patch.race_local_time), nl = hhmm(patch.lobby_local_time), changed = nr && (nr !== hhmm(c.race_local_time) || nl !== hhmm(c.lobby_local_time));
  var targets = changed ? (state.sel.events || []).filter(function (e) { return e.starts_at && e.timezone && !e.is_override && e.status === "scheduled"; }) : [], moves = [], bad = null;
  targets.forEach(function (e) {
    var a = TZ.localText(Date.parse(e.starts_at), e.timezone), r = TZ.zonedToInstant(a.date, nr, e.timezone), u = { starts_at: r.instant, lobby_opens_at: null };
    if (r.error) { bad = bad || roundLabel(e) + " (" + a.date + " " + nr + ")"; return; }
    if (e.original_starts_at) u.original_starts_at = r.instant;
    if (nl) { var lr = TZ.zonedToInstant(a.date, nl, e.timezone); if (lr.error) { bad = bad || roundLabel(e) + " lobby"; return; } u.lobby_opens_at = lr.instant; }
    moves.push({ id: e.id, upd: u });
  });
  if (bad) { msg(m, "Nothing was changed. " + bad + " would land on a time that does not exist or happens twice because the clocks change. Move that round by hand first.", "err"); return; }
  var apply = moves.length > 0 && window.confirm("Save the new time and also move the " + moves.length + " scheduled round" + (moves.length === 1 ? "" : "s") + " already made to race " + nr + (nl ? " (lobby " + nl + ")" : "") + "?\n\nOK = move them too.\nCancel = only use the new time for rounds you add later.\n(Rounds you moved by hand, completed or cancelled rounds are never changed.)");
  msg(m, "Saving…");
  sb.from("championships").update(patch).eq("id", c.id).select("*").single().then(function (r) {
    if (r.error) { msg(m, dbError(r.error), "err"); return; }
    state.sel.champ = r.data;
    if (!apply) { renderChamp(); msg($("#schm"), "Saved." + (moves.length ? " Existing rounds were left as they are." : ""), "ok"); return; }
    var sids = {}; moves.forEach(function (x) { var ev = targets.filter(function (e) { return e.id === x.id; })[0]; if (ev) sids[ev.season_id] = true; });
    var serP = Object.keys(sids).map(function (sid) { return sb.from("event_series").update({ local_time: nr, lobby_local_time: nl || null }).eq("season_id", sid); });
    Promise.all(moves.map(function (x) { return sb.from("events").update(x.upd).eq("id", x.id); }).concat(serP)).then(function (rs) {
      var e2 = rs.filter(function (x) { return x.error; })[0];
      openChamp(c.id);
      setTimeout(function () {
        var mm = $("#schm"); if (!mm) return;
        if (e2) msg(mm, "The schedule was saved, but some rounds could not be moved: " + dbError(e2.error), "err");
        else msg(mm, "Saved. " + moves.length + " round" + (moves.length === 1 ? "" : "s") + " moved to " + nr + ".", "ok");
      }, 600);
    });
  });
}
