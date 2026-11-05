/* Points systems. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

function pointsCardHtml() {
  var S = state.sel;
  return '<div class="card"><h2>Default points system</h2><p class="muted" style="margin:0 0 8px">Every race uses this one unless you pick another for that race on its weekend, for example one system for Sprint and another for Main.</p>' +
    (S.points.length ? '<div class="field"><label for="cpts">Points system</label><select id="cpts">' + opts(S.points.map(function (x) { return [x.id, x.name]; }), state.sel.champ.points_system_id, "Not set") + '</select></div>' : '<p class="muted" style="margin:0">None to choose from yet. Add a points system below, then pick it here.</p>') + '<div class="msg" id="cptsm"></div></div>' +
    '<div class="card"><h2>Points systems</h2><p class="muted" style="margin:0 0 8px">The systems this championship has. Open one to edit it, or add another below. Systems saved for the whole league are managed under <button type="button" id="tolp" style="padding:2px 8px">League points systems</button>.</p><div class="list">' +
    (S.points.length ? S.points.map(function (x) { return '<button type="button" class="item" data-pp="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="muted">' + (updAvail(x) ? '<span class="pill">league version changed</span>' : "") + "</span></button>"; }).join("") : '<p class="muted">None yet.</p>') + "</div>" +
    '<div class="row" style="margin-top:10px"><div class="field grow"><label for="plib">Add from</label><select id="plib">' + fromOpts(S.leaguePts, S.library) + "</select></div>" +
    '<button class="primary" id="padd" type="button">Add points system</button></div><div id="pprev" class="muted" style="margin-top:8px"></div><div class="msg" id="pm"></div></div>';
}
/* ---------- race format template ---------- */
// Each race shows an actual system. One that was never picked shows the championship's default, so nothing says "same as".
function pointsOpts(cur) { var pre = cur || (state.sel.champ && state.sel.champ.points_system_id) || ""; return opts(state.sel.points.map(function (x) { return [x.id, x.name]; }), pre, state.sel.points.length ? "Select a points system" : "No points systems yet"); }
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
    '<div class="row" style="margin-top:10px"><button type="button" id="tadd">Add a race</button><button class="primary" type="button" id="tsave">Save race format</button><button type="button" data-cancel="reset">Cancel</button></div><div class="msg" id="tm"></div></div>';
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
var ORD = function (n) { var v = n % 100; return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"); };
// Shows what a points system awards, so you can see it before adding it.
function showPointsPreview(srcId, box) {
  if (!box) return;
  if (!srcId) { box.textContent = "An empty system with no points yet. You can fill it in after adding it."; return; }
  box.textContent = "Loading…";
  Promise.all([
    sb.from("points_table_entries").select("position,points").eq("points_system_id", srcId).order("position", { ascending: true }),
    sb.from("points_bonuses").select("name,kind,points").eq("points_system_id", srcId)
  ]).then(function (rs) {
    if (box.dataset.src !== undefined && false) return;
    var cur = box.parentNode.querySelector("select"); if (cur && cur.value !== srcId) return;
    var bad = rs.filter(function (r) { return r.error; })[0];
    if (bad) { box.textContent = dbError(bad.error); return; }
    var ents = rs[0].data || [], bns = rs[1].data || [];
    var line = ents.length ? ents.map(function (e) { return ORD(e.position) + " " + e.points; }).join(" · ") : "No positions listed.";
    box.innerHTML = '<div><b>Points by finishing position</b></div><div style="margin:2px 0 6px">' + esc(line) + "</div>" +
      (bns.length ? "<div><b>Bonuses</b></div><div>" + esc(bns.map(function (x) { return x.name + " " + (x.points > 0 ? "+" : "") + x.points; }).join(" · ")) + "</div>" : "");
  });
}
function addPoints() {
  var C = state.sel.champ, m = $("#pm"), sid = $("#plib").value;
  msg(m, "Adding…");
  var go = sid ? copySystem(sid, { championship_id: C.id }) :
    sb.from("points_systems").insert({ championship_id: C.id, name: "New points system" }).select("id").single().then(function (r) { if (r.error) throw r.error; return r.data.id; });
  go.then(function (nid) {
    // The first system added becomes the championship's default, so there is no second step.
    return C.points_system_id ? nid : sb.from("championships").update({ points_system_id: nid }).eq("id", C.id).then(function () { return nid; });
  }).then(function () { state.tab = "points"; openChamp(C.id, { view: "champ" }); setTimeout(function () { msg($("#pm"), "Added.", "ok"); }, 700); }, function (e) { msg(m, dbError(e), "err"); });
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
  go.then(function () { renderLeaguePoints(); setTimeout(function () { msg($("#lpm"), "Added.", "ok"); }, 500); }, function (e) { msg(m, dbError(e), "err"); });
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
      '<div class="row" style="margin-top:14px"><button class="primary" id="psave" type="button">Save</button><button type="button" data-cancel="back">Cancel</button><button class="danger" data-pd="' + esc(pid) + '" type="button">Delete this points system</button></div><div class="msg" id="pm2"></div></div>';
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
