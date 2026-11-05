/* Rounds and races: the round form, its races, saving and deleting. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

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
function refCarOpts(cur) {
  var list = (state.sel.ccopts || []).slice(); if (cur && list.indexOf(cur) < 0) list.push(cur);
  return '<option value="">' + (list.length ? "Not recorded" : "Add cars to the championship first") + "</option>" + list.map(function (n) { return '<option value="' + esc(n) + '"' + (n === cur ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
}
function trackFields(k, e) {
  var t = trackById(e.track_layout_id);
  return '<div class="row" style="margin-top:8px"><div class="field grow"><label for="etv-' + k + '">Venue</label><select id="etv-' + k + '">' + venueOpts(e.track_layout_id) + "</select></div>" +
    '<div class="field grow"><label for="etk-' + k + '">Layout</label><select id="etk-' + k + '">' + layoutOpts(t && t.venue_id, e.track_layout_id) + "</select></div>" +
    '</div>' +
    '<div class="row" style="margin-top:8px"><div class="field"><label for="erl-' + k + '">Reference lap</label><input id="erl-' + k + '" style="width:130px" placeholder="1:25.876" autocomplete="off" value="' + esc(e.reference_lap_ms ? fmtMs(e.reference_lap_ms) : "") + '"></div>' +
    '<div class="field grow"><label for="erc-' + k + '">Car used for the reference lap</label><select id="erc-' + k + '">' + refCarOpts(e.reference_car) + '</select></div></div>' +
    '<div class="row" style="margin-top:8px;align-items:flex-end"><div class="field"><span class="lbl">Race length. Fill in one, the others work themselves out</span><div class="row" style="margin-top:4px;align-items:flex-end">' +
    '<div class="field"><label for="ecl-' + k + '">Laps</label><input id="ecl-' + k + '" type="number" min="1" step="1" style="width:90px" placeholder="Eg 23"></div>' +
    '<div class="field"><label for="ect-' + k + '">Total race time</label><input id="ect-' + k + '" style="width:150px" autocomplete="off"' + (e.reference_lap_ms ? ' placeholder="Eg 33 or 32:55"' : ' disabled placeholder="Needs a reference lap"') + '></div>' +
    '<div class="field"><label for="ecd-' + k + '">Total distance (' + (isMetric() ? "km" : "mi") + ')</label><input id="ecd-' + k + '" type="number" min="0" step="any" style="width:150px" autocomplete="off"' + (t ? ' placeholder="Eg 71.5"' : ' disabled placeholder="Needs a layout"') + '></div>' +
    '<button type="button" data-calcapply="' + k + '" disabled>Copy laps to all races below</button></div></div></div>' +
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
  var tEl = g("ect"), dEl = g("ecd");
  tEl.disabled = !ref; tEl.placeholder = ref ? "Eg 33 or 32:55" : "Needs a reference lap";
  dEl.disabled = !len; dEl.placeholder = len ? "Eg 71.5" : "Needs a layout";
  if (from === "ecl") laps = Math.round(Number(g("ecl").value)) || 0;
  else if (from === "ect") { var tm = parseRaceTime(g("ect").value); if (tm && isFinite(tm)) { if (ref) laps = Math.max(1, Math.round(tm / ref)); else hint = "Enter a reference lap first"; } }
  else if (from === "ecd") { var d = numOrNull(g("ecd").value); if (d) { if (len) laps = Math.max(1, Math.round((isMetric() ? d : d * 1.609344) / len)); else hint = "Pick a layout first"; } }
  else laps = calcLaps[k] || 0;   // reference lap or layout changed: keep the laps, redo the rest
  calcLaps[k] = laps;
  if (from !== "ecl") g("ecl").value = laps || "";
  if (from !== "ect") g("ect").value = laps && ref ? fmtMs(Math.round(laps * ref / 1000) * 1000).replace(/\.\d+$/, "").replace(/^0(?=\d:)/, "") : "";
  if (from !== "ecd") g("ecd").value = laps && len ? (function (km) { return isMetric() ? km.toFixed(1) : (km / 1.609344).toFixed(1); })(laps * len) : "";
  if (!hint && laps && !ref) hint = "Add a reference lap to see the total time.";
  if (!hint && laps && !len) hint = "Pick a layout to see the distance.";
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
    '<div class="row" style="margin-top:8px"><button class="primary" data-es="' + e.id + '" type="button">Save round</button><button type="button" data-cancel="reset">Cancel</button><button class="danger" data-ed="' + e.id + '" type="button">Delete round</button></div><div class="msg" id="em-' + e.id + '"></div></div></details>';
}
function readEvent(k, m) {
  var d = $("#ed-" + k).value, t = $("#et-" + k).value, ev = state.sel.events.filter(function (x) { return x.id === k; })[0];
  var z = (ev && ev.timezone) || champZone() || "";
  var out = { round_number: numOrNull($("#er-" + k).value), notes: nul($("#eo-" + k).value), track_layout_id: nul($("#etk-" + k).value), is_bonus: $("#eb-" + k).checked };
  var rl = parseLap($("#erl-" + k).value);
  if (rl !== null && !isFinite(rl)) { msg(m, "The reference lap should look like 1:25.876.", "err"); return null; }
  if (rl !== null || (ev && ev.reference_lap_ms != null)) out.reference_lap_ms = rl;
  var rc = nul($("#erc-" + k).value); if (rc !== null || (ev && ev.reference_car != null)) out.reference_car = rc;
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
