/* Seasons: the schedule pattern and generating, moving and saving rounds. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

/* ---------- the season's schedule ---------- */
// The frequency, start time and zone belong to the season. They are set once, either when the
// season is created or the first time rounds are added, and later rounds reuse them.
var FREQ_OPTS = { weekly: { l: "Weekly", pattern: "weekly", n: 1 }, fortnightly: { l: "Fortnightly", pattern: "fortnightly", n: 2 }, w3: { l: "Every 3 weeks", pattern: "custom", n: 3 }, w4: { l: "Every 4 weeks", pattern: "custom", n: 4 } };
// The schedule pattern lives on the championship; a season copies it when its rounds are first made.
function champPattern() {
  var c = state.sel.champ, fo = { 1: "weekly", 2: "fortnightly", 3: "w3", 4: "w4" }[c.schedule_every_weeks];
  if (!fo || !c.race_local_time || !c.intended_timezone) return { error: "Set the frequency and race start in the schedule above and press Save schedule first." };
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
    h += "<p>" + (k === "new" ? "The season will start on <b>" + esc(g.dates[0]) + "</b>." : "") + "</p>" +
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
function shiftDate(d, n) { var t = Date.parse(d + "T00:00:00Z"); return new Date(t + n * 86400000).toISOString().slice(0, 10); }
function afterRoundMove(sid, msgText, err) {
  openChamp(state.sel.champ.id);
  setTimeout(function () { var mm = $("#rm2-" + sid); if (mm) msg(mm, msgText, err ? "err" : "ok"); }, 600);
}
function stepRound(id, dir) {
  var me = state.sel.events.filter(function (e) { return e.id === id; })[0]; if (!me) return;
  var sib = state.sel.events.filter(function (e) { return e.season_id === me.season_id; }), at = sib.indexOf(me), other = sib[at + dir];
  if (other) swapRounds(me.season_id, id, other.id);
}
function swapRounds(sid, a, b) {
  var m = $("#rm2-" + sid);
  var evs = state.sel.events, ea = evs.filter(function (e) { return e.id === a; })[0], eb = evs.filter(function (e) { return e.id === b; })[0];
  if (!ea || !eb) return;
  function take(from, to) {
    var u = { starts_at: from.starts_at, lobby_opens_at: from.lobby_opens_at, timezone: from.timezone, round_number: from.round_number };
    // The slots are the season's own, so a swap keeps the time of day; it only counts as a hand move when the time of day differs.
    if (to.series_id && to.timezone && from.starts_at && to.starts_at) {
      var x = TZ.localText(Date.parse(from.starts_at), from.timezone || to.timezone).time, y = TZ.localText(Date.parse(to.starts_at), to.timezone).time;
      u.is_override = x !== y;
    }
    return u;
  }
  var ua = take(eb, ea), ub = take(ea, eb), la = roundLabel(ea), lb = roundLabel(eb);
  Promise.all([sb.from("events").update(ua).eq("id", a), sb.from("events").update(ub).eq("id", b)]).then(function (rs) {
    var e = rs.filter(function (x) { return x.error; })[0];
    if (e) { msg(m, dbError(e.error), "err"); return; }
    renumberSeason(sid).then(function () { afterRoundMove(sid, "Swapped " + la + " and " + lb + ". Rounds renumbered by date.", false); });
  });
}
// Round numbers always follow the dates: the earliest round is Round 1, and so on. Undated rounds go last.
function renumberSeason(sid) {
  return sb.from("events").select("id,round_number,starts_at").eq("season_id", sid).then(function (r) {
    if (r.error || !r.data) return;
    var evs = r.data.slice().sort(function (a, b) { return String(a.starts_at || "~").localeCompare(String(b.starts_at || "~")) || (a.round_number || 0) - (b.round_number || 0); });
    var ch = evs.map(function (e, i) { return e.round_number === i + 1 ? null : sb.from("events").update({ round_number: i + 1 }).eq("id", e.id); }).filter(Boolean);
    return Promise.all(ch).then(function () { return ch.length; });
  });
}
function byeWeek(sid) {
  var m = $("#rm2-" + sid), after = $("#bye-" + sid).value, n = Math.round(Number($("#byn-" + sid).value));
  if (!(n >= 1 && n <= 26)) { msg(m, "Enter a whole number of weeks, 1 to 26.", "err"); return; }
  var evs = state.sel.events.filter(function (e) { return e.season_id === sid; }).sort(function (x, y) { return String(x.starts_at || "~").localeCompare(String(y.starts_at || "~")); });
  var at = evs.map(function (e) { return e.id; }).indexOf(after), later = evs.slice(at + 1).filter(function (e) { return e.starts_at && e.timezone; });
  if (!later.length) { msg(m, "There are no dated rounds after that one to move.", "err"); return; }
  var delta = n * 7, moves = [], bad = null;
  later.forEach(function (e) {
    var a = TZ.localText(Date.parse(e.starts_at), e.timezone), r = TZ.zonedToInstant(shiftDate(a.date, delta), a.time, e.timezone);
    if (r.error) { bad = bad || roundLabel(e); return; }
    var upd = { starts_at: r.instant };
    if (e.lobby_opens_at) { var lb = TZ.localText(Date.parse(e.lobby_opens_at), e.timezone), lr = TZ.zonedToInstant(shiftDate(lb.date, delta), lb.time, e.timezone); if (lr.error) { bad = bad || roundLabel(e); return; } upd.lobby_opens_at = lr.instant; }
    if (e.series_id) upd.is_override = true;
    moves.push({ id: e.id, upd: upd });
  });
  if (bad) { msg(m, "Nothing was changed. " + bad + " would land on a time that does not exist or happens twice because the clocks change. Move that round by hand first.", "err"); return; }
  Promise.all(moves.map(function (x) { return sb.from("events").update(x.upd).eq("id", x.id); })).then(function (rs) {
    var e = rs.filter(function (x) { return x.error; })[0];
    if (e) { afterRoundMove(sid, "Some rounds could not be moved: " + dbError(e.error), true); return; }
    afterRoundMove(sid, "Skipped " + n + " week" + (n === 1 ? "" : "s") + ": " + moves.length + " round" + (moves.length === 1 ? "" : "s") + " moved later.", false);
  });
}
function saveSeason(id) {
  var m = $("#sm-" + id), name = $("#sn-" + id).value.trim();
  if (!name) { msg(m, "The name cannot be blank.", "err"); return; }
  var old = state.sel.seasons.filter(function (x) { return x.id === id; })[0] || {}, ns = nul($("#ss-" + id).value);
  var delta = old.starts_on && ns && old.starts_on !== ns ? Math.round((Date.parse(ns + "T00:00:00Z") - Date.parse(old.starts_on + "T00:00:00Z")) / 86400000) : 0;
  var moves = [];
  if (delta) {
    var bad = null;
    state.sel.events.filter(function (e) { return e.season_id === id; }).forEach(function (e) {
      var upd = {};
      if (e.starts_at && e.timezone) {
        var a = TZ.localText(Date.parse(e.starts_at), e.timezone), r = TZ.zonedToInstant(shiftDate(a.date, delta), a.time, e.timezone);
        if (r.error) { bad = bad || (roundLabel(e) + " (" + shiftDate(a.date, delta) + " " + a.time + ")"); return; }
        upd.starts_at = r.instant;
        if (e.original_starts_at && !e.is_override) upd.original_starts_at = r.instant;
        if (e.lobby_opens_at) {
          var lb = TZ.localText(Date.parse(e.lobby_opens_at), e.timezone), lr = TZ.zonedToInstant(shiftDate(lb.date, delta), lb.time, e.timezone);
          if (lr.error) { bad = bad || (roundLabel(e) + " lobby"); return; }
          upd.lobby_opens_at = lr.instant;
        }
      }
      if (e.occurrence_date) upd.occurrence_date = shiftDate(e.occurrence_date, delta);
      if (Object.keys(upd).length) moves.push({ id: e.id, upd: upd });
    });
    if (bad) { msg(m, "Nothing was changed. " + bad + " would land on a time that does not exist or happens twice because the clocks change. Move that round by hand first, or pick a different start date.", "err"); return; }
  }
  // The end date moves with the start date; if it would land before the start (or there are no rounds to move) it is cleared, and is set again when rounds are added.
  var upd = { name: name, starts_on: ns };
  if (old.ends_on) {
    var ne = delta ? shiftDate(old.ends_on, delta) : old.ends_on;
    upd.ends_on = ns && ne < ns ? null : ne;
  }
  sb.from("seasons").update(upd).eq("id", id).then(function (r) {
    if (r.error) { msg(m, dbError(r.error), "err"); return; }
    Promise.all(moves.map(function (x) { return sb.from("events").update(x.upd).eq("id", x.id); })).then(function (rs) {
      var e2 = rs.filter(function (x) { return x.error; })[0];
      openChamp(state.sel.champ.id);
      setTimeout(function () {
        var mm = $("#sm-" + id); if (!mm) return;
        if (e2) msg(mm, "The season was saved, but some rounds could not be moved: " + dbError(e2.error), "err");
        else if (moves.length) msg(mm, "Saved. " + moves.length + " round" + (moves.length === 1 ? "" : "s") + " moved " + Math.abs(delta) + " day" + (Math.abs(delta) === 1 ? "" : "s") + (delta < 0 ? " earlier" : " later") + ".", "ok");
      }, 600);
    });
  });
}
