/* Results entry and standings. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

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
      if (rows.length) { drawRace(); return; }
      // Nothing saved for this race yet: start from the drivers in the most recent earlier race that has results.
      var order = raceOrder(), at = order.map(function (r) { return r.id; }).indexOf(rid), prev = at > 0 ? order.slice(0, at).map(function (r) { return r.id; }) : [];
      (prev.length ? sb.from("results").select("race_id,driver_id,position,status").in("race_id", prev) : Promise.resolve({ data: [] })).then(function (pr) {
        var by = {}; (pr.data || []).forEach(function (x) { (by[x.race_id] = by[x.race_id] || []).push(x); });
        var src = null; for (var k = prev.length - 1; k >= 0; k--) if (by[prev[k]]) { src = by[prev[k]]; break; }
        if (src) {
          src.sort(function (a, b) { return (a.position == null ? 1e9 : a.position) - (b.position == null ? 1e9 : b.position); });
          src.forEach(function (x) { var n = driverName(x.driver_id); if (n) { var b = blankRow(); b.driver = n; rows.push(b); } });
          state.rr.copied = rows.length;
        }
        while (rows.length < 6) rows.push(blankRow());
        drawRace();
      });
    }, function (e) { app.innerHTML = '<div class="card err">' + esc(dbError(e)) + "</div>"; });
  });
}
// Every race of the championship in calendar order: rounds by number then start, races by their order within the round.
function raceOrder() {
  var evs = state.sel.events.slice().sort(function (a, b) { return (a.round_number || 1e9) - (b.round_number || 1e9) || String(a.starts_at || "").localeCompare(String(b.starts_at || "")); }), out = [];
  evs.forEach(function (e) { state.sel.races.filter(function (r) { return r.event_id === e.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; }).forEach(function (r) { out.push(r); }); });
  return out;
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
      '<td><div style="display:flex;align-items:center;gap:3px;flex-wrap:nowrap"><input data-f="driver" list="dl" value="' + esc(r.driver) + '" placeholder="Type or pick" autocomplete="off" style="min-width:150px;flex:1 1 auto"><select data-pick aria-label="Pick a driver" title="Pick a driver" style="width:34px;flex:0 0 34px"><option value="">▾</option>' + state.drivers.map(function (d) { return '<option value="' + esc(d.display_name) + '">' + esc(d.display_name) + "</option>"; }).join("") + '</select><span class="pill" data-new style="margin-left:4px"></span></div></td>' +
      '<td><select data-f="status">' + STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (r.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select>" + (r.ranked ? ' <span class="pill">ranked</span>' : "") + "</td>" +
      '<td><input data-f="best" value="' + esc(r.best) + '" placeholder="00:39.328" style="width:92px"></td>' +
      '<td><input data-f="raceT" value="' + esc(r.raceT) + '" placeholder="22:14.742" style="width:104px"></td>' +
      '<td><input data-f="pen" type="number" step="any" min="0" value="' + esc(r.pen) + '" style="width:62px"></td>' +
      '<td><input data-f="total" value="' + esc(r.total) + '" placeholder="22:14.742" style="width:104px"></td>' +
      '<td data-pts style="text-align:right"></td>' +
      '<td style="white-space:nowrap"><button type="button" data-up="' + i + '" title="Move up">↑</button><button type="button" data-dn="' + i + '" title="Move down">↓</button><button type="button" data-rm="' + i + '" title="Remove row">✕</button></td></tr>';
  }).join("");
  state.tab = "results";
  var sibs = state.sel.races.filter(function (r) { return r.event_id === race.event_id; }).sort(function (x, y) { return x.sort_order - y.sort_order; });
  var raceTabs = sibs.length > 1 ? '<div class="row" style="margin:0 0 12px">' + sibs.map(function (r) { return '<button type="button" data-rtab="' + esc(r.id) + '"' + (r.id === race.id ? ' class="primary"' : "") + ">" + esc(r.name || "Race") + "</button>"; }).join("") + "</div>" : "";
  app.innerHTML = champHeadHtml(state.sel.champ, "results") +
    '<div class="card">' + raceTabs + '<h2>' + esc((ev ? roundLabel(ev) + " · " : "") + (race.name || "Race")) + ' results</h2>' +
    '<p class="muted" style="margin:0 0 8px">' + (rr.sys ? "Points system: <b>" + esc(rr.sys.name) + "</b>" + (rr.sys.dnfRank ? ". DNFs are ranked after the finishers by best lap." : ". DNFs score by the system\'s DNF rule.") : '<span class="err">No points system is set for this race or the championship, so points are not calculated.</span>') + "</p>" +
    '<p class="muted" style="margin:0 0 8px">' + (rr.copied ? rr.copied + " driver" + (rr.copied === 1 ? " is" : "s are") + " filled in from the previous race. Remove anyone who is not racing. " : "") + 'Type the rows as the game shows them, in order. Times look like 22:14.742. Penalties are seconds. Position follows the order of the rows; use the arrows to adjust the final grid.</p>' +
    '<div class="row" style="margin:0 0 10px;align-items:center"><button type="button" id="rimg">Read from a screenshot or photo</button><input type="file" id="rimgf" accept="image/*" hidden><span class="muted" id="rimgm" role="status">Fills the rows below from the game\'s results screen. Nothing is saved until you press Save results.</span></div>' +
    '<div id="rprog" class="card" hidden style="margin:0 0 10px" role="status" aria-live="polite"></div>' +
    (rr.shot ? '<details open style="margin:0 0 10px"><summary class="muted" style="cursor:pointer">The image you read from</summary><img src="' + rr.shot + '" alt="Results screenshot" style="max-width:100%;max-height:340px;margin-top:6px;border:1px solid var(--line);border-radius:4px"></details>' : "") +
    '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th>Pos</th><th style="text-align:left">Driver</th><th>Status</th><th>Best lap</th><th>Race time</th><th>Pen. (s)</th><th>Total</th><th>Points</th><th></th></tr></thead><tbody>' + rowsH + "</tbody></table></div>" +
    '<datalist id="dl">' + state.drivers.map(function (d) { return '<option value="' + esc(d.display_name) + '">'; }).join("") + "</datalist>" +
    '<div class="row" style="margin-top:8px"><button type="button" id="radd">Add a row</button><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="rdbl"' + (rr.dbl ? " checked" : "") + '> Double points for this race</label></div>' +
    '<div class="row" style="margin-top:12px"><button type="button" id="rarr">Arrange final grid</button><button class="primary" id="rsave" type="button">Save results</button><button type="button" data-cancel="back">Cancel</button></div>' +
    '<p class="muted" style="margin:6px 0 0">"Arrange final grid" keeps finishers in the order typed, ranks DNFs after them by best lap when the points system says so (a DNF with no lap time becomes DNS), and marks the fastest lap. You can still move rows before saving.</p>' +
    '<div class="msg" id="rm"></div></div>';
  bindNav();
  app.querySelectorAll("[data-tab]").forEach(function (t) { t.addEventListener("click", function () { state.tab = t.dataset.tab; state.nav = { view: "champ" }; renderCurrent(); }); });
  app.querySelectorAll("[data-rtab]").forEach(function (t) { t.addEventListener("click", function () {
    if (t.dataset.rtab === race.id) return;
    if (rr.dirty && !confirm("You have unsaved changes on this race. Switch anyway?")) return;
    state.nav = { view: "race", rid: t.dataset.rtab }; renderRaceResults(t.dataset.rtab); }); });
  app.querySelectorAll("[data-pick]").forEach(function (sel) { sel.addEventListener("change", function () { if (sel.value) { rr.dirty = true; sel.closest("td").querySelector("[data-f=driver]").value = sel.value; sel.value = ""; refreshGrid(); } }); });
  app.querySelectorAll("tr[data-ri] input, tr[data-ri] select:not([data-pick]), #rdbl").forEach(function (el) {
    el.addEventListener("input", function () { rr.dirty = true; refreshGrid(); });
    el.addEventListener("change", function () { rr.dirty = true; if (el.dataset.f === "status") { syncRows(); drawRace(); } else refreshGrid(); });
  });
  function move(i, d) { syncRows(); var rows = state.rr.rows, j = i + d; if (j < 0 || j >= rows.length) return; var t = rows[i]; rows[i] = rows[j]; rows[j] = t; drawRace(); }
  app.querySelectorAll("[data-up]").forEach(function (b) { b.addEventListener("click", function () { move(Number(b.dataset.up), -1); }); });
  app.querySelectorAll("[data-dn]").forEach(function (b) { b.addEventListener("click", function () { move(Number(b.dataset.dn), 1); }); });
  app.querySelectorAll("[data-rm]").forEach(function (b) { b.addEventListener("click", function () { syncRows(); state.rr.rows.splice(Number(b.dataset.rm), 1); drawRace(); }); });
  $("#radd").addEventListener("click", function () { syncRows(); state.rr.rows.push(blankRow()); drawRace(); });
  $("#rarr").addEventListener("click", arrangeGrid);
  $("#rsave").addEventListener("click", saveRace);
  $("#rimg").addEventListener("click", function () { $("#rimgf").click(); });
  $("#rimgf").addEventListener("change", function () { var f = this.files && this.files[0]; this.value = ""; if (f) readResultsImage(f); });
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
        // With more than one kind of race (a Sprint and a Main, say) each kind gets its own points column after the total.
        var kinds = []; st.raceColumns.forEach(function (c) { if (kinds.indexOf(c.race) < 0) kinds.push(c.race); });
        if (kinds.length < 2) kinds = [];
        function kindPts(r, k) { var n = null; st.raceColumns.forEach(function (c) { if (c.race === k && r.perRace[c.key] != null) n = (n || 0) + r.perRace[c.key]; }); return n; }
        box.innerHTML = (noSys ? '<p class="err">Some races have no points system, so they score 0.</p>' : "") + '<div style="overflow-x:auto"><table class="zebra" style="border-collapse:collapse;width:100%"><thead><tr><th>#</th><th style="text-align:left">Driver</th><th>Total</th>' + kinds.map(function (k) { return "<th>" + esc(k) + "</th>"; }).join("") +
          st.raceColumns.map(function (c) { return '<th title="' + esc(c.round + " " + c.race) + '">' + esc(c.round + " " + c.race) + "</th>"; }).join("") + "<th>Wins</th><th>Podiums</th><th>Fastest laps</th></tr></thead><tbody>" +
          st.rows.map(function (r) {
            return '<tr><td style="text-align:center">' + r.rank + "</td><td>" + esc(r.driver) + '</td><td style="text-align:center"><b>' + r.total + "</b></td>" + kinds.map(function (k) { var n = kindPts(r, k); return '<td style="text-align:center">' + (n == null ? "–" : +n.toFixed(2)) + "</td>"; }).join("") +
              st.raceColumns.map(function (c) { return '<td style="text-align:center">' + (r.perRace[c.key] == null ? "–" : r.perRace[c.key]) + "</td>"; }).join("") +
              '<td style="text-align:center">' + r.wins + '</td><td style="text-align:center">' + r.podiums + '</td><td style="text-align:center">' + r.fastestLaps + "</td></tr>";
          }).join("") + "</tbody></table></div>";
      }, function (e) { box.innerHTML = '<span class="err">' + esc(dbError(e)) + "</span>"; });
    });
  });
}

/* ---------- read a results screenshot or photo (Supabase Edge Function read-results, which calls Gemini) ---------- */
function normName(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
// A driver already in the league whose name or other name matches once case, spaces and punctuation are ignored; otherwise the name as read.
function matchDriverName(raw) {
  var k = normName(raw); if (!k) return raw;
  var d = state.drivers.filter(function (x) { return normName(x.display_name) === k || (x.aliases || []).some(function (a) { return normName(a) === k; }); })[0];
  return d ? d.display_name : raw;
}
// Shrinks the picture (phone photos are huge) and returns { mime, data } with data as base64.
function shrinkImage(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var max = 1800, sc = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      var data = c.toDataURL("image/jpeg", 0.85); URL.revokeObjectURL(url);
      resolve({ mime: "image/jpeg", data: data.slice(data.indexOf(",") + 1), preview: data });
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file could not be opened as an image.")); };
    img.src = url;
  });
}
/* While an image is being read: a progress panel with a timer, a warning if the page is left, and a Cancel after a while. */
var reading = null;
function readingGuard(e) {
  if (!reading) return;
  var t = e.target && e.target.closest ? e.target.closest("a[href], [id^=nav-], [data-tab], [data-rtab], [data-cancel], .hnav a, .hbi") : null;
  if (!t || t.closest("#rprog")) return;
  e.preventDefault(); e.stopPropagation(); var m = $("#rprogwarn"); if (m) m.textContent = "Still reading the image. Please wait here, or press Cancel.";
}
function beforeLeave(e) { if (reading) { e.preventDefault(); e.returnValue = ""; return ""; } }
function startReading() {
  var box = $("#rprog"), t0 = Date.now(), job = { id: t0, step: "Preparing the image" };
  reading = job; window.addEventListener("beforeunload", beforeLeave); document.addEventListener("click", readingGuard, true);
  box.hidden = false;
  function draw() {
    if (reading !== job) return;
    var secs = Math.floor((Date.now() - t0) / 1000), slow = secs >= 45;
    box.innerHTML = '<div class="row" style="align-items:center;gap:12px"><span class="spin" aria-hidden="true"></span><div class="grow"><b>' + esc(slow ? "Still working. This is taking longer than usual." : job.step + "…") + '</b><div class="muted">Reading the screenshot usually takes 10 to 30 seconds. Keep this page open. <span id="rprogt">' + secs + ' s</span></div></div>' +
      (slow ? '<button type="button" id="rprogx">Cancel</button>' : "") + '</div><div class="muted" id="rprogwarn" role="status" style="margin-top:6px"></div>';
    var x = $("#rprogx"); if (x) x.addEventListener("click", function () { stopReading(job); msg($("#rimgm"), "Cancelled. You can try again.", ""); });
  }
  draw(); job.timer = setInterval(function () { if (reading !== job) { clearInterval(job.timer); return; } var el = $("#rprogt"), secs = Math.floor((Date.now() - t0) / 1000); if (secs === 45) draw(); else if (el) el.textContent = secs + " s"; }, 1000);
  job.setStep = function (n) { job.step = n; draw(); };
  return job;
}
function stopReading(job) {
  if (reading !== job) return; reading = null; clearInterval(job.timer);
  window.removeEventListener("beforeunload", beforeLeave); document.removeEventListener("click", readingGuard, true);
  var box = $("#rprog"); if (box) { box.hidden = true; box.innerHTML = ""; } var b = $("#rimg"); if (b) b.disabled = false;
}
function readResultsImage(file) {
  var rr = state.rr, m = $("#rimgm"), btn = $("#rimg");
  if (!/^image\//.test(file.type || "")) { msg(m, "Choose an image file.", "err"); return; }
  syncRows();
  var filled = rr.rows.filter(function (r) { return r.driver.trim(); }).length;
  if (filled && !window.confirm("This replaces the " + filled + " row" + (filled === 1 ? "" : "s") + " already typed. Continue?")) return;
  btn.disabled = true; msg(m, "");
  var job = startReading();
  shrinkImage(file).then(function (img) {
    if (reading !== job) throw new Error("cancelled");
    job.setStep("Reading the results");
    return sb.functions.invoke("read-results", { body: { league_id: state.league.id, image: img.data, mime: img.mime, drivers: state.drivers.map(function (d) { return d.display_name; }) } })
      .then(function (r) { return { r: r, img: img }; });
  }).then(function (x) {
    if (reading !== job) throw new Error("cancelled");
    job.setStep("Filling in the rows");
    var r = x.r, err = r.error, data = r.data;
    if (err) {
      if (err.context && typeof err.context.text === "function") {
        var st = err.context.status;
        return err.context.text().then(function (t) {
          var j = null; try { j = JSON.parse(t); } catch (e) {}
          var m2 = j && (j.error || j.message) ? (j.error || j.message) : String(t || "").slice(0, 200);
          throw new Error((m2 || err.message) + (st ? " (status " + st + ")" : ""));
        }, function () { throw new Error(err.message + (st ? " (status " + st + ")" : "")); });
      }
      throw new Error(err.message);
    }
    if (!data || data.error) throw new Error(data && data.error ? data.error : "No answer came back.");
    var rows = (data.rows || []).map(function (o) {
      return { driver: matchDriverName(o.driver), status: o.status || "finished", ranked: false, best: o.best_lap || "", raceT: o.race_time || "", pen: o.penalty_seconds ? String(o.penalty_seconds) : "", total: o.total_time || "" };
    });
    if (!rows.length) throw new Error("No results were found in that image." + (data.unreadable ? " " + data.unreadable : ""));
    stopReading(job);
    rr.rows = rows; rr.copied = 0; rr.dirty = true; rr.shot = x.img.preview;
    var unknown = rows.filter(function (r) { return !driverByName(r.driver); }).length;
    drawRace();
    msg($("#rimgm"), "Read " + rows.length + " row" + (rows.length === 1 ? "" : "s") + ". Check every row against the image" + (unknown ? " (" + unknown + " driver" + (unknown === 1 ? " is" : "s are") + " not in the league yet, marked new driver)" : "") + ", then press Arrange final grid and Save results." + (data.unreadable ? " The reader said: " + data.unreadable : ""), "ok");
  }).catch(function (e) {
    if (reading !== job && String(e && e.message) === "cancelled") return;
    stopReading(job);
    msg($("#rimgm"), String(e && e.message || e), "err");
  });
}
