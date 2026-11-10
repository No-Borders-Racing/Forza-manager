/* Divisions: a group of cars with rules every car must follow. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

/* The parts and their groups are the build sheet's own (keep in step with PARTS in builds/sheet.html). */
var DIV_GROUPS = [
  ["Fuel and Air", ["Fuel System", "Ignition", "Exhaust", "Air Filter", "Restrictor Plate", "Intake Manifold and Throttle Body"]],
  ["Engine", ["Camshaft", "Valves", "Displacement", "Pistons and Compression", "Flywheel", "Oil and Cooling"]],
  ["Platform and Handling", ["Brakes", "Spring and Dampers", "Front Anti-roll Bars", "Rear Anti-roll Bars", "Weight Reduction", "Chassis Reinforcement and Roll Cage", "Ballast"]],
  ["Tires", ["Tire Compound", "Front Tire Width", "Rear Tire Width"]],
  ["Drivetrain", ["Clutch", "Transmission", "Driveline", "Differential"]],
  ["Aero and Appearance", ["Rear Wing", "Front Bumper", "Rear Bumper", "Hood"]],
  ["Conversion", ["Engine Swap", "Drivetrain Swap", "Aspiration Conversion"]]
];
var DIV_LEVELS = ["Open", "Stock", "Street", "Sport", "Race"];
var DIV_CARS_SHOWN = 40;
state.divs = state.divs || [];
state.vf = state.vf || freshCarFilter();
state.dedit = state.dedit || null;

/* championship_cars rows, with division_id once migration 034 has been run (older databases get the plain columns). */
function fetchCC(cols, apply) {
  return apply(sb.from("championship_cars").select(cols + ",division_id")).then(function (r) {
    if (r.error && /division_id/.test(r.error.message || "")) return apply(sb.from("championship_cars").select(cols));
    return r;
  });
}
function loadDivisions(done) {
  sb.from("divisions").select("id,name,pi_limit,min_weight_lb,other_rules,parts,updated_at").eq("league_id", state.league.id).order("name", { ascending: true }).then(function (r) {
    if (r.error) { state.divs = []; state.divErr = dbError(r.error); done(); return; }
    state.divErr = ""; state.divs = r.data || [];
    Promise.all(state.divs.map(function (d) {
      return sb.from("division_cars").select("car_id", { count: "exact", head: true }).eq("division_id", d.id).then(function (x) { d.n = x.count || 0; });
    })).then(function () { done(); });
  });
}
function divSummary(d) {
  var bits = [(d.n || 0) + " car" + (d.n === 1 ? "" : "s")];
  if (d.pi_limit) bits.push("PI limit " + d.pi_limit);
  var used = usedIn("division", d.id); if (used.length) bits.push("In: " + used.join(", "));
  return bits.join(" · ");
}
/* Division rows, shown in the Builds list on the Cars page (a division is saved next to the builds). */
function divisionRowsHtml(q) {
  q = (q || "").toLowerCase();
  return state.divs.filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0; }).map(function (d) {
    return '<div class="row" style="align-items:center;margin:4px 0;gap:8px"><div class="grow" style="min-width:220px"><b>' + esc(d.name) + '</b> <span class="pill">Division</span><div class="muted">' + esc(divSummary(d)) + "</div></div>" +
      (state.useChs.length ? '<button type="button" data-usediv="' + esc(d.id) + '">Use in ' + esc(useChName()) + "</button>" : "") +
      '<button type="button" data-opendiv="' + esc(d.id) + '">Open</button><button class="danger" type="button" data-deldiv="' + esc(d.id) + '">Delete</button></div>';
  }).join("");
}
function bindDivisionRows(box) {
  box.querySelectorAll("[data-opendiv]").forEach(function (x) { x.addEventListener("click", function () { openDivision(x.dataset.opendiv); }); });
  box.querySelectorAll("[data-usediv]").forEach(function (x) { x.addEventListener("click", function () { useIn("division", x.dataset.usediv); }); });
  box.querySelectorAll("[data-deldiv]").forEach(function (x) { x.addEventListener("click", function () {
    var id = x.dataset.deldiv;
    if (armed !== "dd" + id) { armed = "dd" + id; x.textContent = "Click again to delete"; return; }
    armed = null; x.disabled = true;
    sb.from("divisions").delete().eq("id", id).then(function (r) {
      if (r.error) { msg($("#cmsg"), dbError(r.error), "err"); x.disabled = false; return; }
      state.divs = state.divs.filter(function (d) { return d.id !== id; }); state.useCC = state.useCC.filter(function (y) { return y.division_id !== id; }); renderCarsBody();
    });
  }); });
}

/* ---------- the division editor ---------- */
function newDivision() { state.dedit = { id: null, name: "", pi: "", wt: "", rules: "", parts: {}, cars: [], saved: [], dirty: false }; state.vf = freshCarFilter(); renderDivisionEditor(); }
function openDivision(id) {
  var d = state.divs.filter(function (x) { return x.id === id; })[0]; if (!d) return;
  var ids = [];
  function page(from) {
    return sb.from("division_cars").select("car_id").eq("division_id", id).range(from, from + 999).then(function (r) {
      if (r.error) return r.error;
      ids = ids.concat((r.data || []).map(function (x) { return x.car_id; }));
      return (r.data || []).length === 1000 ? page(from + 1000) : null;
    });
  }
  page(0).then(function (err) {
    if (err) { msg($("#cmsg"), dbError(err), "err"); return; }
    state.dedit = { id: id, name: d.name, pi: d.pi_limit || "", wt: d.min_weight_lb || "", rules: d.other_rules || "", parts: Object.assign({}, d.parts || {}), cars: ids.slice(), saved: ids.slice(), dirty: false };
    state.vf = freshCarFilter(); renderDivisionEditor();
  });
}
function renderDivisionEditor() {
  var E = state.dedit;
  if (!state.carsAll) { fetchAllCars().then(function (r) { state.carsAll = r.data || []; renderDivisionEditor(); }); return; }
  app.innerHTML = navHtml("k") + '<p><button type="button" id="dback">← Cars</button></p>' +
    '<div class="card"><h2 style="font-size:18px;margin:0 0 8px">' + (E.id ? "Division" : "New division") + '</h2>' +
    '<div class="row" style="align-items:flex-end"><div class="field grow"><label for="dname">Division name</label><input id="dname" value="' + esc(E.name) + '" placeholder="For example American Muscle" autocomplete="off"></div>' +
    '<div class="field"><label for="dpi">PI limit</label><input id="dpi" value="' + esc(E.pi) + '" placeholder="For example B600" style="width:110px" autocomplete="off"></div>' +
    '</div>' +
    '<div class="field" style="margin-top:10px"><label for="drules">Other rules</label><textarea id="drules" rows="3" placeholder="For example: American cars only. No conversions.">' + esc(E.rules) + "</textarea></div></div>" +
    '<div class="card" id="dcars"></div>' +
    '<div class="card"><h2 style="font-size:18px;margin:0 0 4px">Build requirements</h2><p class="muted" style="margin:0 0 8px">What every car must meet. Set a minimum weight, then for each part choose Open (drivers decide), Stock (no upgrade allowed), or the level every car must have. Open parts are not listed on the public page.</p><div class="field" style="margin-bottom:10px"><label for="dwt">Minimum weight (lbs)</label><input id="dwt" type="number" min="1" value="' + esc(E.wt) + '" style="width:130px"></div><div id="dparts"></div></div>' +
    '<div class="card"><div class="row" style="align-items:center"><button class="primary" type="button" id="dsave">Save division</button>' + (E.id ? '<button class="danger" type="button" id="ddel">Delete division</button>' : "") + '<span class="msg" id="dmsg" role="status"></span></div></div>';
  bindNav(); drawDivCars(); drawDivParts();
  ["dname", "dpi", "dwt", "drules"].forEach(function (id) { $("#" + id).addEventListener("input", function () { E.dirty = true; }); });
  $("#dback").addEventListener("click", function () {
    if (E.dirty && !window.confirm("This division has unsaved changes. Leave without saving?")) return;
    state.dedit = null; renderCars();
  });
  $("#dsave").addEventListener("click", saveDivision);
  var dl = $("#ddel"); if (dl) dl.addEventListener("click", function () {
    if (armed !== "ded" + E.id) { armed = "ded" + E.id; dl.textContent = "Click again to delete"; return; }
    armed = null; dl.disabled = true;
    sb.from("divisions").delete().eq("id", E.id).then(function (r) { if (r.error) { msg($("#dmsg"), dbError(r.error), "err"); dl.disabled = false; return; } state.dedit = null; renderCars(); });
  });
}
/* The cars card: the cars chosen so far (each with a cross to remove it), then the same search and filters as the Cars tab. */
function drawDivCars() {
  var E = state.dedit, box = $("#dcars"); if (!box) return;
  var byCar = {}, has = {}, f = state.vf; state.carsAll.forEach(function (c) { byCar[c.id] = c; }); E.cars.forEach(function (id) { has[id] = 1; });
  var names = E.cars.map(function (id) { return byCar[id] ? { id: id, n: carName(byCar[id]) } : null; }).filter(Boolean).sort(function (a, b) { return a.n.localeCompare(b.n); });
  var divs = uniq(state.carsAll.map(function (c) { return c.division; })).sort();
  var chips = names.map(function (x) { return '<span class="chip">' + esc(x.n) + '<button type="button" data-drm="' + esc(x.id) + '" aria-label="Remove ' + esc(x.n) + '">×</button></span>'; }).join("");
  box.innerHTML = '<h2 style="font-size:18px;margin:0 0 8px">Eligible cars (' + names.length + ")</h2>" +
    (names.length ? (names.length > DIV_CARS_SHOWN ? '<details><summary class="muted" style="cursor:pointer">Show the ' + names.length + ' cars</summary><div class="chips" style="margin-top:8px">' + chips + "</div></details>" : '<div class="chips">' + chips + "</div>") : '<p class="muted" style="margin:0">No cars yet. Add them below.</p>') +
    '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><div class="muted" style="margin-bottom:6px">Add cars. Search and filter the same way as the Cars tab, then add one car, a whole game division, or everything that matches.</div>' + carFilterHtml(f, "v") +
    '<div class="row" style="margin-top:12px;align-items:flex-end"><div class="field grow"><label for="vsel">One car</label><select id="vsel"></select></div><button class="primary" type="button" id="vaddone">Add this car</button></div>' +
    '<div class="muted" id="vnote" style="margin-top:6px"></div>' +
    '<div class="row" style="margin-top:10px;align-items:flex-end"><div class="field grow"><label for="vwdiv">A whole game division</label><select id="vwdiv">' + selOpts(divs, "", "Choose a division") + '</select></div><button type="button" id="vadddiv">Add the whole game division</button></div>' +
    '<div class="row" style="margin-top:10px"><button type="button" id="vaddall">Add all matching the search and filters</button></div><div class="msg" id="vmsg" role="status"></div></div>';
  function remaining() { return filterCars(f).filter(function (c) { return !has[c.id]; }); }
  function repick() {
    var rows = remaining(), shown = rows.slice(0, PICK_MAX), fav = favSet("car");
    $("#vsel").innerHTML = shown.length ? shown.map(function (c) { return '<option value="' + esc(c.id) + '">' + (fav[c.id] ? "★ " : "") + esc(carName(c) + " · " + classOf(c.pi) + " " + c.pi) + "</option>"; }).join("") : '<option value="">No cars match</option>';
    $("#vnote").textContent = rows.length + " car" + (rows.length === 1 ? "" : "s") + " match and " + (rows.length === 1 ? "is" : "are") + " not in the division yet." + (rows.length > shown.length ? " Showing the first " + shown.length + " in the list." : "");
    $("#vaddall").textContent = "Add all " + rows.length + " matching the search and filters"; $("#vaddall").disabled = !rows.length;
  }
  function addCars(list, what) {
    if (!list.length) { msg($("#vmsg"), "Nothing to add: those cars are already in this division.", "err"); return; }
    if (list.length > 25 && !window.confirm("Add " + list.length + " cars" + (what ? " (" + what + ")" : "") + " to this division?")) return;
    list.forEach(function (c) { E.cars.push(c.id); }); E.dirty = true; drawDivCars();
    msg($("#vmsg"), "Added " + list.length + " car" + (list.length === 1 ? "" : "s") + ". Press Save division to keep them.", "ok");
  }
  bindCarFilter(f, "v", repick, drawDivCars); repick();
  box.querySelectorAll("[data-drm]").forEach(function (x) { x.addEventListener("click", function () { E.cars = E.cars.filter(function (id) { return id !== x.dataset.drm; }); E.dirty = true; drawDivCars(); }); });
  $("#vaddone").addEventListener("click", function () { var v = $("#vsel").value, c = byCar[v]; if (c) addCars([c], ""); else msg($("#vmsg"), "Pick a car first.", "err"); });
  $("#vaddall").addEventListener("click", function () { addCars(remaining(), "everything that matches the search and filters"); });
  $("#vadddiv").addEventListener("click", function () {
    var d = $("#vwdiv").value; if (!d) { msg($("#vmsg"), "Choose a division first.", "err"); return; }
    addCars(state.carsAll.filter(function (c) { return c.division === d && !has[c.id]; }), d);
  });
}
function drawDivParts() {
  var E = state.dedit, box = $("#dparts"); if (!box) return;
  var open = {}; box.querySelectorAll("details").forEach(function (d) { open[d.dataset.g] = d.open; });
  box.innerHTML = DIV_GROUPS.map(function (g) {
    var set = g[1].filter(function (p) { return E.parts[p] && E.parts[p] !== "Open"; }).length;
    return '<details class="grp" data-g="' + esc(g[0]) + '"' + (open[g[0]] ? " open" : "") + '><summary style="cursor:pointer;padding:8px 0;display:flex;justify-content:space-between;gap:10px"><b>' + esc(g[0]) + '</b><span class="muted">' + (set ? set + " set" : "all open") + "</span></summary>" +
      g[1].map(function (p) {
        return '<div class="row" style="align-items:center;justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)"><span>' + esc(p) + '</span><span class="row" style="gap:4px" role="group" aria-label="' + esc(p) + '">' +
          DIV_LEVELS.map(function (l) { var on = (E.parts[p] || "Open") === l; return '<button type="button" data-part="' + esc(p) + '" data-level="' + l + '" aria-pressed="' + on + '" class="' + (on ? "primary" : "") + '" style="padding:4px 10px">' + l + "</button>"; }).join("") + "</span></div>";
      }).join("") + "</details>";
  }).join("");
  box.querySelectorAll("[data-part]").forEach(function (b) { b.addEventListener("click", function () {
    if (b.dataset.level === "Open") delete E.parts[b.dataset.part]; else E.parts[b.dataset.part] = b.dataset.level;
    E.dirty = true; drawDivParts();
  }); });
}
function saveDivision() {
  var E = state.dedit, name = $("#dname").value.trim(), wtRaw = $("#dwt").value.trim(), wt = wtRaw ? Math.round(Number(wtRaw)) : null, out = $("#dmsg");
  if (!name) { msg(out, "Give the division a name first.", "err"); return; }
  if (wtRaw && !(wt > 0)) { msg(out, "The minimum weight must be a number above zero.", "err"); return; }
  E.name = name; E.pi = $("#dpi").value.trim(); E.wt = wt || ""; E.rules = $("#drules").value.trim();
  var row = { name: name, pi_limit: E.pi || null, min_weight_lb: wt, other_rules: E.rules || null, parts: E.parts };
  $("#dsave").disabled = true; msg(out, "Saving…");
  var q = E.id ? sb.from("divisions").update(row).eq("id", E.id).select("id").single() : sb.from("divisions").insert(Object.assign({ league_id: state.league.id }, row)).select("id").single();
  q.then(function (r) {
    if (r.error) { $("#dsave").disabled = false; msg(out, r.error.code === "23505" ? "Another division in this league already has that name. Pick a different name." : dbError(r.error), "err"); return; }
    E.id = r.data.id;
    var have = {}, want = {}; E.saved.forEach(function (id) { have[id] = 1; }); E.cars.forEach(function (id) { want[id] = 1; });
    var add = E.cars.filter(function (id) { return !have[id]; }), drop = E.saved.filter(function (id) { return !want[id]; }), err = null, p = Promise.resolve(), i;
    function chunk(list) { var out2 = []; for (var j = 0; j < list.length; j += 200) out2.push(list.slice(j, j + 200)); return out2; }
    chunk(add).forEach(function (ch) { p = p.then(function () { if (err) return; return sb.from("division_cars").insert(ch.map(function (id) { return { division_id: E.id, car_id: id }; })).then(function (x) { if (x.error) err = x.error; }); }); });
    chunk(drop).forEach(function (ch) { p = p.then(function () { if (err) return; return sb.from("division_cars").delete().eq("division_id", E.id).in("car_id", ch).then(function (x) { if (x.error) err = x.error; }); }); });
    p.then(function () {
      $("#dsave").disabled = false;
      if (err) { msg(out, "Saved the rules, but the cars did not all save: " + dbError(err), "err"); return; }
      E.saved = E.cars.slice(); E.dirty = false; msg(out, "Saved.", "ok");
      if (!$("#ddel")) renderDivisionEditor(); // a new division gets its Delete button
    });
  });
}
