/* Cars, builds, comparing builds and the championship car list. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

/* ---------- cars: catalogue, saved builds, favourites ---------- */
var PI_CLASSES = [["E", 100, 300], ["D", 301, 400], ["C", 401, 500], ["B", 501, 600], ["A", 601, 700], ["S", 701, 800], ["R", 801, 900], ["P", 901, 998], ["X", 999, 999]];
function classOf(pi) { pi = Number(pi); for (var i = 0; i < PI_CLASSES.length; i++) if (pi >= PI_CLASSES[i][1] && pi <= PI_CLASSES[i][2]) return PI_CLASSES[i][0]; return ""; }
var COUNTRY_TOP = ["USA", "GER", "JPN", "GBR", "ITA"];
var COUNTRY_NAME = { USA: "United States", GER: "Germany", JPN: "Japan", GBR: "United Kingdom", ITA: "Italy", FRA: "France", AUS: "Australia", KOR: "South Korea", SWE: "Sweden", CHN: "China", AUT: "Austria", CRO: "Croatia", NED: "Netherlands", ESP: "Spain", MEX: "Mexico", DEN: "Denmark", BEL: "Belgium", RSA: "South Africa", UAE: "United Arab Emirates", CAN: "Canada", BRA: "Brazil" };
var CAR_COLS = "id,make,model,year,nickname,division,country,pi,drivetrain,model_type";
var CARS_SHOWN = 100;
state.cf = { q: "", cls: "", div: "", make: "", yf: "", yt: "", country: "", drive: "", fav: false, letters: "", sort: "make", dir: "asc", shown: CARS_SHOWN };
state.bf = { q: "", cls: "", fav: false, sort: "name", dir: "asc" };
function carName(c) { return c.nickname || (c.year + " " + c.make + " " + c.model); }
function carFull(c) { return c.year + " " + c.make + " " + c.model; }
function favSet(kind) { var o = {}; (state.favs || []).forEach(function (f) { var k = kind === "car" ? f.car_id : f.build_id; if (k) o[k] = f.id; }); return o; }
// Supabase returns at most 1000 rows per request, so read the catalogue in pages until it is all here.
function fetchAllCars() {
  var all = [], size = 1000;
  function page(from) {
    return sb.from("cars").select(CAR_COLS).order("ordinal", { ascending: true }).range(from, from + size - 1).then(function (r) {
      if (r.error) return { error: r.error };
      all = all.concat(r.data || []);
      return (r.data || []).length === size ? page(from + size) : { data: all };
    });
  }
  return page(0);
}
function loadCarsData(done) {
  var lid = state.league.id;
  var catP = state.carsAll ? Promise.resolve({ data: state.carsAll }) : fetchAllCars();
  Promise.all([catP,
    sb.from("league_favourites").select("id,car_id,build_id").eq("league_id", lid),
    sb.from("build_sheets").select("id,name,status,class_letter,pi,car_id,updated_at").eq("league_id", lid).order("name", { ascending: true }),
    sb.from("championships").select("id,name").eq("league_id", lid).order("name", { ascending: true })
  ]).then(function (rs) {
    var bad = rs.filter(function (r) { return r.error; })[0];
    if (bad) { app.innerHTML = navHtml("k") + '<div class="card err">' + esc(dbError(bad.error)) + " Has migration 014 been run?</div>"; bindNav(); return; }
    state.carsAll = rs[0].data || []; state.favs = rs[1].data || []; state.builds = rs[2].data || []; state.useChs = rs[3].data || [];
    var ids = state.useChs.map(function (c) { return c.id; });
    (ids.length ? fetchCC("championship_id,car_id,build_id", function (q) { return q.in("championship_id", ids); }) : Promise.resolve({ data: [] })).then(function (r) { state.useCC = r.data || []; done(); });
  });
}
/* "Use in championship": writes the same championship_cars rows as the championship's own Cars tab, so there is one list, not two. */
state.useCC = state.useCC || [];
 state.useChs = state.useChs || [];
 state.useCh = state.useCh || "";
function useChId() { var ok = state.useChs.some(function (c) { return c.id === state.useCh; }); if (!ok) state.useCh = state.useChs.length ? state.useChs[0].id : ""; return state.useCh; }
function useChName() { var c = state.useChs.filter(function (x) { return x.id === useChId(); })[0]; return c ? c.name : ""; }
function usedIn(kind, id) { var names = []; state.useCC.forEach(function (x) { if ((kind === "car" ? x.car_id : kind === "division" ? x.division_id : x.build_id) === id) { var c = state.useChs.filter(function (y) { return y.id === x.championship_id; })[0]; if (c) names.push(c.name); } }); return names; }
function useRowHtml() {
  if (!state.useChs.length) return '<p class="muted" style="margin:10px 0 0">Create a championship to use cars in it.</p>';
  useChId();
  return '<div class="row" style="margin-top:10px;align-items:flex-end"><div class="field"><label for="cuse">Championship</label><select id="cuse">' + state.useChs.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === state.useCh ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + '</select></div><button type="button" id="cusebtn">Use this car in the championship</button></div><div class="muted" id="cin" style="margin-top:4px"></div>';
}
function updateCin() { var el = $("#cin"); if (!el) return; var n = state.cpick ? usedIn("car", state.cpick) : []; el.textContent = n.length ? "Stock car in: " + n.join(", ") : ""; }
function useIn(kind, id) {
  var ch = useChId(), nm = useChName(); if (!ch || !id) return;
  var row = { championship_id: ch }; row[kind === "car" ? "car_id" : kind === "division" ? "division_id" : "build_id"] = id;
  sb.from("championship_cars").insert(row).select(kind === "division" ? "championship_id,car_id,build_id,division_id" : "championship_id,car_id,build_id").single().then(function (r) {
    if (r.error && r.error.code !== "23505") { msg($("#cmsg"), dbError(r.error), "err"); return; }
    if (!r.error) state.useCC.push(r.data);
    msg($("#cmsg"), r.error ? "Already in " + nm + "." : "Added to " + nm + ".", r.error ? "" : "ok");
    updateCin(); var box = $("#clist"); if (box) { box.innerHTML = buildListHtml(); bindCarList(); }
  });
}
function selOpts(list, cur, blank) { return '<option value="">' + esc(blank) + "</option>" + list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(l) + "</option>"; }).join(""); }
function uniq(arr) { var o = {}; arr.forEach(function (x) { if (x) o[x] = 1; }); return Object.keys(o); }
function countryList() {
  var all = uniq(state.carsAll.map(function (c) { return c.country; })), top = COUNTRY_TOP.filter(function (c) { return all.indexOf(c) >= 0; });
  var rest = all.filter(function (c) { return top.indexOf(c) < 0; }).sort(function (a, b) { return (COUNTRY_NAME[a] || a).localeCompare(COUNTRY_NAME[b] || b); });
  return top.concat(rest).map(function (c) { return [c, COUNTRY_NAME[c] || c]; });
}
/* Every word typed must appear somewhere in the car's name, nickname, game division or body type. "hatch backs" also finds "hatchback", and a trailing s is ignored ("mustangs"). */
function carMatches(c, qs) {
  var hay = (carFull(c) + " " + (c.nickname || "") + " " + (c.division || "") + " " + (c.model_type || "")).toLowerCase(), flat = hay.replace(/[^a-z0-9]/g, "");
  if (qs.length > 1 && flat.indexOf(qs.join("")) >= 0) return true;
  return qs.every(function (w) { return hay.indexOf(w) >= 0 || (w.length > 3 && w.slice(-1) === "s" && hay.indexOf(w.slice(0, -1)) >= 0); });
}
function filterCars(f0) {
  var f = f0 || state.cf, qs = f.q.trim().toLowerCase().split(/[\s,]+/).filter(Boolean), fav = favSet("car");
  var out = state.carsAll.filter(function (c) {
    if (qs.length && !carMatches(c, qs)) return false;
    if (f.cls && classOf(c.pi) !== f.cls) return false;
    if (f.div && c.division !== f.div) return false;
    if (f.make && c.make !== f.make) return false;
    if (f.yf && c.year < Number(f.yf)) return false;
    if (f.yt && c.year > Number(f.yt)) return false;
    if (f.country && c.country !== f.country) return false;
    if (f.drive && c.drivetrain !== f.drive) return false;
    if (f.fav && !fav[c.id]) return false;
    if (f.letters && !inLetters(c, f.letters)) return false;
    return true;
  });
  var key = { name: function (c) { return carName(c).toLowerCase(); }, year: function (c) { return c.year; }, make: function (c) { return c.make.toLowerCase(); }, model: function (c) { return c.model.toLowerCase(); } }[f.sort] || function (c) { return c.make.toLowerCase(); };
  var d = f.dir === "desc" ? -1 : 1;
  out.sort(function (a, b) {
    var x = key(a), y = key(b); if (x < y) return -d; if (x > y) return d;
    return (a.make + " " + a.model).localeCompare(b.make + " " + b.model) || a.year - b.year;
  });
  return out;
}
// Alphabet chips: letters of the make, grouped so each range holds a similar number of cars.
function letterOf(c) { var l = String(c.make || "").charAt(0).toUpperCase(); return l >= "A" && l <= "Z" ? l : "A"; }
function letterRanges() {
  var cnt = {}, tot = state.carsAll.length, L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  state.carsAll.forEach(function (c) { var l = letterOf(c); cnt[l] = (cnt[l] || 0) + 1; });
  var present = L.filter(function (l) { return cnt[l]; }), target = tot / 7, out = [], cur = null, n = 0;
  present.forEach(function (l) {
    if (!cur) { cur = { a: l, b: l }; n = 0; }
    cur.b = l; n += cnt[l];
    if (n >= target) { out.push(cur); cur = null; }
  });
  if (cur) { if (out.length && n < target / 2) out[out.length - 1].b = cur.b; else out.push(cur); }
  return out.map(function (r) { return r.a + "-" + r.b; });
}
function inLetters(c, rng) { var l = letterOf(c), p = rng.split("-"); return l >= p[0] && l <= p[1]; }
function letterChipsHtml(f) {
  var cur = f.letters, rs = letterRanges();
  function chip(v, label) { return '<button type="button" data-let="' + esc(v) + '" aria-pressed="' + (cur === v ? "true" : "false") + '" class="' + (cur === v ? "primary" : "") + '" style="padding:5px 10px">' + esc(label) + "</button>"; }
  return '<div class="row" style="margin-top:8px;gap:6px" role="group" aria-label="Filter by first letter of the make">' + chip("", "All") + rs.map(function (r) { return chip(r, r.replace("-", "–")); }).join("") + "</div>";
}
function starBtn(kind, id, on) { return '<button type="button" class="star' + (on ? " on" : "") + '" data-star="' + kind + ":" + esc(id) + '" aria-label="' + (on ? "Remove from favourites" : "Add to favourites") + '" aria-pressed="' + (on ? "true" : "false") + '" style="min-width:34px;font-size:18px;line-height:1;padding:4px 8px">' + (on ? "★" : "☆") + "</button>"; }
function filterBuilds() {
  var f = state.bf, q = f.q.trim().toLowerCase(), fav = favSet("build"), byId = {};
  state.carsAll.forEach(function (c) { byId[c.id] = c; });
  var out = state.builds.filter(function (b) {
    var c = byId[b.car_id];
    if (q && (b.name + " " + (c ? carFull(c) + " " + (c.nickname || "") : "")).toLowerCase().indexOf(q) < 0) return false;
    if (f.cls && b.class_letter !== f.cls) return false;
    if (f.fav && !fav[b.id]) return false;
    return true;
  });
  var d = f.dir === "desc" ? -1 : 1;
  out.sort(function (a, b) {
    var x = f.sort === "pi" ? (a.pi || 0) : f.sort === "updated" ? a.updated_at : a.name.toLowerCase(), y = f.sort === "pi" ? (b.pi || 0) : f.sort === "updated" ? b.updated_at : b.name.toLowerCase();
    return x < y ? -d : x > y ? d : 0;
  });
  return { rows: out, byId: byId };
}
function buildListHtml() {
  var r = filterBuilds(), fav = favSet("build");
  return '<div class="muted" style="margin:6px 0">' + r.rows.length + " build" + (r.rows.length === 1 ? "" : "s") + "</div>" +
    (r.rows.length ? r.rows.map(function (b) {
      var c = r.byId[b.car_id];
      return '<div class="row" style="align-items:center;margin:4px 0;gap:8px">' + starBtn("build", b.id, !!fav[b.id]) + '<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-cmpbuild="' + esc(b.id) + '"' + (cmpHas("build:" + b.id) ? " checked" : "") + "> Compare</label>" +
        '<div class="grow" style="min-width:220px"><b>' + esc(b.name) + '</b><div class="muted">' + esc((c ? carFull(c) : "Car no longer in the catalogue") + (usedIn("build", b.id).length ? " · In: " + usedIn("build", b.id).join(", ") : "")) + "</div></div>" +
        '<div class="muted" style="min-width:110px">' + esc((b.class_letter || "") + " " + (b.pi || "")).trim() + '</div>' +
        (state.useChs.length ? '<button type="button" data-usebuild="' + esc(b.id) + '">Use in ' + esc(useChName()) + "</button>" : "") + '<button type="button" data-copybuild="' + esc(b.id) + '">Copy link</button><button type="button" data-openbuild="' + esc(b.id) + '">Open</button><button class="danger" type="button" data-delbuild="' + esc(b.id) + '">Delete</button></div>';
    }).join("") : '<p class="muted">No saved builds yet. Open the Stock cars tab, find a car and press Build this car.</p>');
}
function renderCars() { state.dedit = null; loadCarsData(function () { loadDivisions(renderCarsBody); }); }
var PICK_MAX = 300;
function pickOptsHtml() {
  var rows = filterCars(), fav = favSet("car"), shown = rows.slice(0, PICK_MAX);
  if (!state.cpick || !shown.some(function (c) { return c.id === state.cpick; })) state.cpick = shown.length ? shown[0].id : "";
  return { html: shown.length ? shown.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === state.cpick ? " selected" : "") + ">" + (fav[c.id] ? "★ " : "") + esc(carName(c) + " · " + classOf(c.pi) + " " + c.pi) + "</option>"; }).join("") : '<option value="">No cars match</option>',
    note: rows.length + " car" + (rows.length === 1 ? " matches" : "s match") + (rows.length > shown.length ? ". Showing the first " + shown.length + ", keep typing or add a filter to narrow it down." : ".") };
}
// The selected car's stats, from the full catalogue row (fetched once per car).
function statsHtml(c) {
  var met = isMetric(), num = function (v, d) { return v == null || v === "" ? "—" : Number(v).toFixed(d == null ? 0 : d).replace(/\.0+$/, ""); };
  function kv(k, v) { return '<div class="kv" style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line, #333)"><span class="muted">' + esc(k) + "</span><b>" + esc(v) + "</b></div>"; }
  function bar(k, v) { var n = Number(v) || 0; return '<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span class="muted" style="width:90px">' + esc(k) + '</span><span style="flex:1;height:8px;background:var(--line, #333);border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(0, Math.min(100, n * 10)) + '%;background:var(--accent, #4a8)"></span></span><b style="width:34px;text-align:right">' + num(v, 1) + "</b></div>"; }
  var pos = { F: "Front", MR: "Mid / rear", R: "Rear", Dual: "Dual (electric)" }[c.engine_position] || c.engine_position, lay = { V: "V", I: "Inline", F: "Flat", R: "Rotary", W: "W", E: "Electric", VR: "VR" }[c.engine_layout] || c.engine_layout;
  var ind = { NA: "Naturally aspirated", T: "Turbo", TT: "Twin turbo", PDS: "Supercharger (PDS)", CS: "Supercharger (CS)", EV: "Electric", T4: "Quad turbo" }[c.induction] || c.induction;
  return '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line, #333)"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b style="font-size:17px">' + esc(carName(c)) + '</b><div class="muted">' + esc(carFull(c) + " · " + c.division + " · " + (COUNTRY_NAME[c.country] || c.country || "")) + '</div></div><div style="font-size:26px;font-weight:700;border:2px solid currentColor;border-radius:4px;padding:2px 10px">' + esc(classOf(c.pi)) + " " + esc(c.pi) + "</div></div>" +
    '<div class="row" style="margin-top:8px;align-items:flex-start;gap:24px"><div class="grow" style="min-width:240px">' +
    kv("Power", met ? num(c.power_kw) + " kW" : num(c.power_hp) + " hp") + kv("Torque", met ? num(c.torque_nm) + " N·m" : num(c.torque_ftlb) + " lb-ft") + kv("Weight", met ? num(c.mass_kg) + " kg" : num(c.mass_lb) + " lbs") + kv("Drivetrain", c.drivetrain || "—") +
    '</div><div class="grow" style="min-width:240px">' +
    kv("Engine", [c.displacement_l != null ? num(c.displacement_l, 1) + "L" : "", lay, c.cylinders ? c.cylinders + " cyl" : ""].filter(Boolean).join(" ") || "—") + kv("Induction", ind || "—") + kv("Engine position", pos || "—") + kv("Type", [c.model_type, c.steering_position === "L" ? "left-hand drive" : c.steering_position === "R" ? "right-hand drive" : c.steering_position === "C" ? "centre steering" : ""].filter(Boolean).join(" · ") || "—") +
    '</div><div class="grow" style="min-width:240px"><div class="muted" style="margin-bottom:2px">Stock ratings (0 to 10)</div>' + bar("Speed", c.speed) + bar("Braking", c.braking) + bar("Handling", c.handling) + bar("Acceleration", c.acceleration) + "</div></div></div>";
}
state.carFull = state.carFull || {};
function showStats() {
  updateCin(); var box = $("#cstats"); if (!box) return;
  var id = state.cpick; if (!id) { box.innerHTML = ""; return; }
  if (state.carFull[id]) { box.innerHTML = statsHtml(state.carFull[id]); return; }
  box.innerHTML = '<div class="muted" style="margin-top:10px">Loading stats…</div>';
  sb.from("cars").select("*").eq("id", id).single().then(function (r) {
    if (r.error || !r.data) { if (state.cpick === id) box.innerHTML = '<div class="err" style="margin-top:10px">' + esc(dbError(r.error)) + "</div>"; return; }
    state.carFull[id] = r.data; if (state.cpick === id) box.innerHTML = statsHtml(r.data);
  });
}
function carFilterHtml(f, pre) {
  var clsList = PI_CLASSES.map(function (c) { return [c[0], c[0]]; });
  return '<div id="' + pre + 'filt"><div class="row" style="align-items:flex-end"><div class="field grow"><label for="' + pre + 'q">Search the catalogue</label><input id="' + pre + 'q" value="' + esc(f.q) + '" placeholder="For example Mustang, 1991, NASCAR, GT3, hot hatch" autocomplete="off"></div><button class="primary" type="button" id="' + pre + 'go">Search</button><button type="button" id="' + pre + 'clr">Clear</button>' +
    '</div>' + letterChipsHtml(f) +
    '<details style="margin-top:8px"' + (f.cls || f.div || f.make || f.yf || f.yt || f.country || f.drive || f.fav ? " open" : "") + '><summary class="muted" style="cursor:pointer">Filters and sorting</summary>' +
    '<div class="row" style="margin-top:8px;align-items:flex-end"><div class="field"><label for="' + pre + 'c">Class</label><select id="' + pre + 'c">' + selOpts(clsList, f.cls, "Any") + "</select></div>" +
    '<div class="field"><label for="' + pre + 'd">Drivetrain</label><select id="' + pre + 'd">' + selOpts(["RWD", "AWD", "FWD"], f.drive, "Any") + "</select></div>" +
    '<div class="field grow"><label for="' + pre + 'div">Division</label><select id="' + pre + 'div">' + selOpts(uniq(state.carsAll.map(function (c) { return c.division; })).sort(), f.div, "Any") + "</select></div>" +
    '<div class="field"><label for="' + pre + 'mk">Make</label><select id="' + pre + 'mk">' + selOpts(uniq(state.carsAll.map(function (c) { return c.make; })).sort(), f.make, "Any") + "</select></div>" +
    '<div class="field"><label for="' + pre + 'co">Country</label><select id="' + pre + 'co">' + selOpts(countryList(), f.country, "Any") + "</select></div></div>" +
    '<div class="row" style="margin-top:8px;align-items:flex-end"><div class="field"><label for="' + pre + 'yf">Year from</label><input id="' + pre + 'yf" type="number" min="1900" max="2100" style="width:90px" value="' + esc(f.yf) + '"></div>' +
    '<div class="field"><label for="' + pre + 'yt">to</label><input id="' + pre + 'yt" type="number" min="1900" max="2100" style="width:90px" value="' + esc(f.yt) + '"></div>' +
    '<div class="field"><label for="' + pre + 'sort">Sort by</label><select id="' + pre + 'sort">' + [["make", "Alphabetical (make, model, year)"], ["model", "Model"], ["name", "Name or nickname"], ["year", "Year"]].map(function (o) { return '<option value="' + o[0] + '"' + (f.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></div>' +
    '<button type="button" id="' + pre + 'dir" aria-label="Sort direction">' + (f.dir === "desc" ? "Z to A ↓" : "A to Z ↑") + '</button>' +
    '<div class="field"><label for="' + pre + 'fav">Favourites</label><label style="display:flex;gap:6px;align-items:center;padding:7px 0"><input id="' + pre + 'fav" type="checkbox"' + (f.fav ? " checked" : "") + "> Only favourites</label></div>" +
    '<button type="button" id="' + pre + 'reset">Clear filters</button></div></details></div>';
}
/* Every car that matches the search and filters, as a list (100 at a time). o.btn(car) gives each row's button, o.pick(id) runs when it is pressed. */
function carSearching(f) { return !!(f.q || f.cls || f.div || f.make || f.yf || f.yt || f.country || f.drive || f.fav || f.letters); }
function drawCarResults(pre, f, o) {
  var box = document.getElementById(pre + "res"); if (!box) return;
  if (!carSearching(f)) { box.innerHTML = '<p class="muted" style="margin:10px 0 0">Type a car, make or game division and press Search, or use the filters, to list every match.</p>'; return; }
  var old = box.querySelector(".resl"), top = old ? old.scrollTop : 0;
  var rows = filterCars(f), fav = favSet("car"), n = f.rn || 100, shown = rows.slice(0, n);
  box.innerHTML = '<div class="row" style="justify-content:space-between;align-items:center;margin:10px 0 4px"><b>' + rows.length + " car" + (rows.length === 1 ? "" : "s") + " found</b>" + (o.head ? o.head(rows) : "") + "</div>" +
    (rows.length ? '<div class="resl" style="max-height:440px;overflow:auto;border:1px solid var(--line);border-radius:6px">' + shown.map(function (c) {
      return '<div class="row" style="align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--line)"><div class="grow" style="min-width:200px"><b>' + (fav[c.id] ? "★ " : "") + esc(carName(c)) + '</b><div class="muted">' + esc(carFull(c) + " · " + c.division) + '</div></div><span class="muted">' + esc(classOf(c.pi) + " " + c.pi) + "</span>" + o.btn(c) + "</div>";
    }).join("") + (rows.length > n ? '<div style="padding:8px 10px;border-top:1px solid var(--line)"><button type="button" data-rmore>Show ' + Math.min(100, rows.length - n) + " more</button> <span class=\"muted\">" + (rows.length - n) + " not shown yet</span></div>" : "") + "</div>" : '<p class="muted">No cars match. Try fewer words or clear a filter.</p>');
  var l = box.querySelector(".resl"); if (l) l.scrollTop = top;
  box.querySelectorAll("[data-rpick]").forEach(function (x) { x.addEventListener("click", function () { o.pick(x.dataset.rpick); }); });
  var mb = box.querySelector("[data-rmore]"); if (mb) mb.addEventListener("click", function () { f.rn = n + 100; drawCarResults(pre, f, o); });
  if (o.after) o.after(box, rows);
}
function freshCarFilter(keep) { return { q: keep || "", cls: "", div: "", make: "", yf: "", yt: "", country: "", drive: "", fav: false, letters: "", sort: "make", dir: "asc", shown: CARS_SHOWN }; }
function bindCarFilter(f, pre, changed, reset) {
  function wire(id, key, kind) { var el = document.getElementById(pre + id); if (!el) return; el.addEventListener(kind, function () { f[key] = el.type === "checkbox" ? el.checked : el.value; f.rn = 0; changed(); }); }
  var qi = document.getElementById(pre + "q"), go = document.getElementById(pre + "go");
  function commit() { f.q = qi.value; f.rn = 0; changed(); }
  if (qi) { qi.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commit(); } }); qi.addEventListener("input", function () { f.qdraft = qi.value; }); }
  if (go) go.addEventListener("click", commit);
  var clr = document.getElementById(pre + "clr");
  if (clr) clr.addEventListener("click", function () { Object.keys(f).forEach(function (k) { delete f[k]; }); Object.assign(f, freshCarFilter("")); reset(); });
  wire("c", "cls", "change"); wire("d", "drive", "change"); wire("fav", "fav", "change"); wire("div", "div", "change"); wire("mk", "make", "change");
  wire("co", "country", "change"); wire("yf", "yf", "input"); wire("yt", "yt", "input"); wire("sort", "sort", "change");
  var root = document.getElementById(pre + "filt"); if (!root) return;
  root.querySelectorAll("[data-let]").forEach(function (x) { x.addEventListener("click", function () {
    f.letters = x.dataset.let; root.querySelectorAll("[data-let]").forEach(function (y) { var on = y.dataset.let === f.letters; y.setAttribute("aria-pressed", on ? "true" : "false"); y.className = on ? "primary" : ""; }); changed(); }); });
  var fd = document.getElementById(pre + "dir"); if (fd) fd.addEventListener("click", function () { f.dir = f.dir === "desc" ? "asc" : "desc"; fd.textContent = f.dir === "desc" ? "Z to A ↓" : "A to Z ↑"; changed(); });
  var fr = document.getElementById(pre + "reset"); if (fr) fr.addEventListener("click", function () { var keep = f.q; Object.keys(f).forEach(function (k) { delete f[k]; }); Object.assign(f, freshCarFilter(keep)); reset(); });
}
function renderCarsBody() {
  var f = state.cf, b = state.bf, fav = favSet("car");
  var clsList = PI_CLASSES.map(function (c) { return [c[0], c[0]]; });
  var cv = state.cview || "s";
  function subBtn(v, label) { return '<button type="button" data-cview="' + v + '" aria-pressed="' + (cv === v ? "true" : "false") + '" class="' + (cv === v ? "primary" : "") + '">' + label + "</button>"; }
  var h = navHtml("k") + '<div class="row" role="group" aria-label="Cars" style="margin:0 0 12px;gap:8px">' + subBtn("s", "Search") + subBtn("b", "Builds") + subBtn("d", "Divisions") + '</div>' +
    '<div id="cv-s"' + (cv === "s" ? "" : " hidden") + '><div class="card"><h2 style="font-size:18px;margin:0">Cars</h2><p class="muted" style="margin:4px 0 10px">Search the catalogue and pick a car to see its stats. Press Modify to start a build sheet for it. It starts as a draft with the car\'s stock class, PI, engine, power, torque and weight filled in and every part on Stock.</p>' +
    carFilterHtml(f, "f") +
    '<div id="fres"></div>' +
    '<div class="row" style="margin-top:12px;align-items:center"><div class="grow" id="cselname"></div>' +
    '<button type="button" id="cfavsel" aria-label="Favourite this car" style="min-width:40px;font-size:18px">' + (fav[state.cpick] ? "★" : "☆") + '</button>' +
    '<button type="button" id="caddcmp">Compare +</button><button class="primary" type="button" id="caddbuild">Modify</button></div>' +
    useRowHtml() + '<div id="cstats"></div>' +
    '<div class="msg" id="cmsg"></div></div>' +
    '<div id="cmpbox" style="margin:14px 0"></div></div>' +
    '<div id="cv-b"' + (cv === "b" ? "" : " hidden") + '><div class="card"><div class="row" style="justify-content:space-between;align-items:center;margin:0 0 8px"><h2 style="font-size:18px;margin:0">Builds (' + state.builds.length + ')</h2><button class="primary" type="button" id="bnew">New build</button></div>' +
    '<div class="row" style="align-items:flex-end"><div class="field grow"><label for="bq">Search</label><input id="bq" value="' + esc(b.q) + '" placeholder="Build name or car" autocomplete="off"></div>' +
    '<div class="field"><label for="bc">Class</label><select id="bc">' + selOpts(clsList, b.cls, "Any") + "</select></div>" +
    '<div class="field"><label for="bsort">Sort by</label><select id="bsort">' + [["name", "Name"], ["pi", "PI"], ["updated", "Last changed"]].map(function (o) { return '<option value="' + o[0] + '"' + (b.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></div>' +
    '<button type="button" id="bdir">' + (b.dir === "desc" ? "Z to A ↓" : "A to Z ↑") + '</button>' +
    '<div class="field"><label for="bfav">Favourites</label><label style="display:flex;gap:6px;align-items:center;padding:7px 0"><input id="bfav" type="checkbox"' + (b.fav ? " checked" : "") + "> Only favourites</label></div></div>" +
    '<div id="clist">' + buildListHtml() + "</div></div></div>" +
    '<div id="cv-d"' + (cv === "d" ? "" : " hidden") + '><div class="card"><div class="row" style="justify-content:space-between;align-items:center;margin:0 0 8px"><h2 style="font-size:18px;margin:0">Divisions (' + state.divs.length + ')</h2><button class="primary" type="button" id="dvnew">New division</button></div>' +
    '<p class="muted" style="margin:0 0 8px">A division is a group of cars with rules every car must follow.</p>' + (state.divErr ? '<p class="err">' + esc(state.divErr) + " Has migration 034 been run?</p>" : "") +
    (state.divs.length ? divisionRowsHtml("") : '<p class="muted">No divisions yet. Press New division to make one.</p>') + "</div></div>";
  app.innerHTML = h; bindNav(); bindCars(); drawCmp("cars");
}
function bindCars() {
  var f = state.cf, b = state.bf;
  function pickCar(id) { state.cpick = id; repick(); }
  function repick() {
    drawCarResults("f", f, { btn: function (c) { return '<button type="button" data-rpick="' + esc(c.id) + '"' + (c.id === state.cpick ? ' class="primary"' : "") + ">" + (c.id === state.cpick ? "Selected" : "Select") + "</button>"; }, pick: pickCar });
    var cur = state.carsAll.filter(function (c) { return c.id === state.cpick; })[0];
    $("#cselname").innerHTML = cur ? "<b>" + esc(carName(cur)) + '</b> <span class="muted">' + esc(carFull(cur)) + "</span>" : '<span class="muted">No car selected. Search above and press Select on a car.</span>';
    $("#cfavsel").textContent = favSet("car")[state.cpick] ? "★" : "☆"; showStats();
  }
  function relist() { var box = $("#clist"); if (box) { box.innerHTML = buildListHtml(); bindCarList(); } }
  function wire(id, obj, key, kind, after) {
    var el = document.getElementById(id); if (!el) return;
    el.addEventListener(kind || "input", function () { obj[key] = el.type === "checkbox" ? el.checked : el.value; after(); });
  }
  bindCarFilter(f, "f", repick, renderCarsBody);
  wire("bq", b, "q", "input", relist); wire("bc", b, "cls", "change", relist); wire("bsort", b, "sort", "change", relist); wire("bfav", b, "fav", "change", relist);
  var ub = $("#cusebtn"); if (ub) ub.addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } useIn("car", state.cpick); });
  var us = $("#cuse"); if (us) us.addEventListener("change", function () { state.useCh = us.value; relist(); });
  $("#caddcmp").addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } cmpToggle("car:" + state.cpick, true); drawCmp("cars"); });
  $("#caddbuild").addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } startBuild(state.cpick); });
  $("#cfavsel").addEventListener("click", function () {
    if (!state.cpick) return; var id = state.cpick;
    toggleFav("car:" + id, function () { repick(); });
  });
  var bd = $("#bdir"); if (bd) bd.addEventListener("click", function () { b.dir = b.dir === "desc" ? "asc" : "desc"; bd.textContent = b.dir === "desc" ? "Z to A ↓" : "A to Z ↑"; relist(); });
  $("#dvnew").addEventListener("click", function () { newDivision(); });
  $("#bnew").addEventListener("click", function () { showCview("s"); var c = $("#fq"); if (c) { c.scrollIntoView({ block: "center" }); c.focus(); } });
  function showCview(v) { state.cview = v; ["s", "b", "d"].forEach(function (k) { var sec = document.getElementById("cv-" + k); if (sec) sec.hidden = k !== v; }); app.querySelectorAll("[data-cview]").forEach(function (x) { var on = x.dataset.cview === v; x.setAttribute("aria-pressed", on ? "true" : "false"); x.className = on ? "primary" : ""; }); }
  app.querySelectorAll("[data-cview]").forEach(function (x) { x.addEventListener("click", function () { showCview(x.dataset.cview); }); });
  bindDivisionRows(app);
  bindCarList(); repick();
}
function bindCarList() {
  app.querySelectorAll("[data-star]").forEach(function (x) { x.addEventListener("click", function () { toggleFav(x.dataset.star); }); });
  app.querySelectorAll("[data-cmpbuild]").forEach(function (x) { x.addEventListener("change", function () { cmpToggle("build:" + x.dataset.cmpbuild, x.checked); drawCmp("cars"); }); });
  app.querySelectorAll("[data-usebuild]").forEach(function (x) { x.addEventListener("click", function () { useIn("build", x.dataset.usebuild); }); });
  app.querySelectorAll("[data-copybuild]").forEach(function (x) { x.addEventListener("click", function () {
    var u = buildLink(x.dataset.copybuild), done = function () { var o = x.textContent; x.textContent = "Link copied"; setTimeout(function () { x.textContent = o; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, function () { window.prompt("Copy this link", u); }); else window.prompt("Copy this link", u);
  }); });
  app.querySelectorAll("[data-openbuild]").forEach(function (x) { x.addEventListener("click", function () { openBuild(x.dataset.openbuild); }); });
  app.querySelectorAll("[data-delbuild]").forEach(function (x) { x.addEventListener("click", function () { deleteBuildFromList(x); }); });
}
function toggleFav(key, after) {
  var kind = key.split(":")[0], id = key.slice(kind.length + 1), cur = favSet(kind)[id];
  var q = cur ? sb.from("league_favourites").delete().eq("id", cur) : sb.from("league_favourites").insert(kind === "car" ? { league_id: state.league.id, car_id: id } : { league_id: state.league.id, build_id: id }).select("id,car_id,build_id").single();
  q.then(function (r) {
    if (r.error) { msg($("#cmsg"), dbError(r.error), "err"); return; }
    if (cur) state.favs = state.favs.filter(function (x) { return x.id !== cur; }); else state.favs.push(r.data);
    if (after) { after(); return; }
    if (state.bf.fav) { var box = $("#clist"); if (box) { box.innerHTML = buildListHtml(); bindCarList(); } return; }
    var btn = app.querySelector('[data-star="' + key + '"]');
    if (btn) { var on = !cur; btn.textContent = on ? "★" : "☆"; btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on ? "true" : "false"); btn.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites"); }
  });
}
function deleteBuildFromList(btn) {
  var id = btn.dataset.delbuild;
  if (armed !== "bd" + id) { armed = "bd" + id; btn.textContent = "Click again to delete"; return; }
  armed = null; btn.disabled = true;
  sb.from("build_sheets").delete().eq("id", id).then(function (r) {
    if (r.error) { msg($("#cmsg"), dbError(r.error), "err"); btn.disabled = false; return; }
    state.builds = state.builds.filter(function (b) { return b.id !== id; }); state.favs = state.favs.filter(function (x) { return x.build_id !== id; });
    renderCarsBody();
  });
}
/* The build sheet runs in a frame (builds/sheet.html) and talks to this page with messages. */
function startBuild(carId) {
  if (state.carFull && state.carFull[carId]) { state.editor = { buildId: null, carId: carId, car: state.carFull[carId], name: "", dirty: false }; renderBuildEditor(); return; }
  sb.from("cars").select("*").eq("id", carId).single().then(function (r) {
    if (r.error) { msg($("#cmsg") || $("#clist"), dbError(r.error), "err"); return; }
    state.editor = { buildId: null, carId: carId, car: r.data, name: "", dirty: false }; renderBuildEditor();
  });
}
function openBuild(id) {
  sb.from("build_sheets").select("*").eq("id", id).single().then(function (r) {
    if (r.error) { msg($("#cmsg"), dbError(r.error), "err"); return; }
    state.editor = { buildId: id, carId: r.data.car_id, data: r.data.data, name: r.data.name, published: !!r.data.published, dirty: false }; renderBuildEditor();
  });
}
/* Compare: any number of stock cars and saved builds, shown two across and as many rows as needed. */
state.cmp = state.cmp || [];
 state.buildFull = state.buildFull || {};
 state.cmpq = state.cmpq || "";
function cmpHas(k) { return state.cmp.indexOf(k) >= 0; }
function cmpToggle(k, on) { var i = state.cmp.indexOf(k); if (on && i < 0) state.cmp.push(k); if (!on && i >= 0) state.cmp.splice(i, 1); }
function cmpLoad(keys, done) {
  var jobs = keys.filter(function (k) { var p = k.split(":"); return p[0] === "car" ? !state.carFull[p[1]] : !state.buildFull[p[1]]; }).map(function (k) {
    var p = k.split(":"), car = p[0] === "car";
    return sb.from(car ? "cars" : "build_sheets").select("*").eq("id", p[1]).single().then(function (r) { if (!r.error && r.data) (car ? state.carFull : state.buildFull)[p[1]] = r.data; });
  });
  Promise.all(jobs).then(done);
}
function cmpInfo(k) {
  var p = k.split(":"), met = isMetric(), n = function (v) { return v == null || v === "" || !isFinite(Number(v)) || Number(v) === 0 ? "—" : String(Math.round(Number(v))); };
  function unit(v, u) { return v === "—" ? v : v + " " + u; }
  if (p[0] === "car") {
    var c = state.carFull[p[1]]; if (!c) return null;
    return { title: carName(c), sub: carFull(c) + " · Stock", badge: classOf(c.pi) + " " + c.pi, custom: false, rows: [
      ["Power", met ? unit(n(c.power_kw), "kW") : unit(n(c.power_hp), "hp")], ["Torque", met ? unit(n(c.torque_nm), "N·m") : unit(n(c.torque_ftlb), "lb-ft")],
      ["Weight", met ? unit(n(c.mass_kg), "kg") : unit(n(c.mass_lb), "lbs")], ["Drivetrain", c.drivetrain || "—"],
      ["Engine", [c.displacement_l != null ? Number(c.displacement_l).toFixed(1) + "L" : "", c.cylinders ? c.cylinders + " cyl" : "", c.induction || ""].filter(Boolean).join(" ") || "—"]],
      bars: [["Speed", c.speed], ["Braking", c.braking], ["Handling", c.handling], ["Acceleration", c.acceleration]] };
  }
  var row = state.buildFull[p[1]]; if (!row) return null;
  var d = row.data || {}, car = (state.carsAll || []).filter(function (x) { return x.id === row.car_id; })[0], bl = d.built || {};
  var hp = n(d.hp), tq = n(d.tq), lb = n(d.lb);
  return { title: row.name, sub: (car ? carFull(car) : "Car no longer in the catalogue") + " · Custom build", badge: ((d.cls || row.class_letter || "") + " " + (d.pi || row.pi || "")).trim() || "—", custom: true, rows: [
    ["Power", met ? unit(hp === "—" ? hp : String(Math.round(d.hp * 0.7457)), "kW") : unit(hp, "hp")], ["Torque", met ? unit(tq === "—" ? tq : String(Math.round(d.tq * 1.35582)), "N·m") : unit(tq, "lb-ft")],
    ["Weight", met ? unit(lb === "—" ? lb : String(Math.round(d.lb * 0.453592)), "kg") : unit(lb, "lbs")], ["Drivetrain", (car && car.drivetrain) || "—"], ["Engine", d.engine || "—"]],
    bars: [["Speed", bl.speed], ["Braking", bl.braking], ["Handling", bl.handling], ["Acceleration", bl.accel]] };
}
function cmpCard(k, locked) {
  var i = cmpInfo(k); if (!i) return '<div class="card muted">Loading…</div>';
  return '<div class="card" style="margin:0"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px"><div style="min-width:0"><b style="font-size:16px">' + esc(i.title) + '</b><div class="muted">' + esc(i.sub) + '</div></div>' +
    '<div style="font-size:20px;font-weight:700;border:2px solid currentColor;border-radius:4px;padding:2px 8px;white-space:nowrap">' + esc(i.badge) + "</div></div>" +
    i.rows.map(function (r) { return '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line)"><span class="muted">' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>"; }).join("") +
    '<div class="muted" style="margin:8px 0 2px">' + (i.custom ? "Ratings from the build sheet (0 to 10)" : "Stock ratings (0 to 10)") + "</div>" +
    i.bars.map(function (b) { var v = Number(b[1]) || 0; return '<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span class="muted" style="width:90px">' + esc(b[0]) + '</span><span style="flex:1;height:8px;background:var(--line);border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(0, Math.min(100, v * 10)) + '%;background:var(--accent)"></span></span><span style="width:28px;text-align:right">' + (v ? v : "—") + "</span></div>"; }).join("") +
    (locked ? '<div class="muted" style="margin-top:8px">This build</div>' : '<div style="margin-top:8px"><button type="button" data-cmprm="' + esc(k) + '">Remove</button></div>') + "</div>";
}
function cmpPickerHtml(curKey) {
  var q = state.cmpq.trim().toLowerCase(), hit = function (t) { return !q || t.toLowerCase().indexOf(q) >= 0; }, o = "";
  var bs = (state.builds || []).filter(function (b) { return "build:" + b.id !== curKey && !cmpHas("build:" + b.id) && hit(b.name); });
  var cs = (state.carsAll || []).filter(function (c) { return !cmpHas("car:" + c.id) && hit(carFull(c) + " " + (c.nickname || "")); }).slice(0, 100);
  if (bs.length) o += '<optgroup label="Saved builds">' + bs.map(function (b) { return '<option value="build:' + esc(b.id) + '">' + esc(b.name) + "</option>"; }).join("") + "</optgroup>";
  if (cs.length) o += '<optgroup label="Stock cars">' + cs.map(function (c) { return '<option value="car:' + esc(c.id) + '">' + esc(carName(c) + " · " + classOf(c.pi) + " " + c.pi) + "</option>"; }).join("") + "</optgroup>";
  return '<div class="row" style="align-items:flex-end;margin-bottom:10px"><div class="field grow"><label for="cmpq">Find a car or build to compare</label><input id="cmpq" value="' + esc(state.cmpq) + '" placeholder="Search" autocomplete="off"></div>' +
    '<div class="field grow"><label for="cmpsel">Add</label><select id="cmpsel">' + (o || '<option value="">Nothing matches</option>') + '</select></div><button class="primary" type="button" id="cmpadd">Add to compare</button></div>';
}
// box: "cars" (Cars page) or "editor" (build screen, where the open build is always the first card)
function drawCmp(mode) {
  var box = $("#cmpbox"); if (!box) return;
  var E = state.editor, cur = mode === "editor" && E && E.buildId ? "build:" + E.buildId : "";
  var keys = (cur ? [cur] : []).concat(state.cmp.filter(function (k) { return k !== cur; }));
  if (mode === "cars" && !keys.length) { box.innerHTML = ""; return; }
  var head = '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="font-size:18px;margin:0">Compare (' + keys.length + ')</h2>' + (state.cmp.length ? '<button type="button" id="cmpclear">Clear all</button>' : "") + "</div>";
  var hint = mode === "editor" && !cur ? '<p class="muted" style="margin:0 0 8px">Save this build to include it in the comparison.</p>' : keys.length < 2 ? '<p class="muted" style="margin:0 0 8px">Add one more car or build to compare.</p>' : "";
  box.innerHTML = '<div class="card">' + head + (mode === "editor" ? cmpPickerHtml(cur) : "") + hint + '<div class="cmpgrid" id="cmpgrid"></div></div>';
  function grid() { var g = $("#cmpgrid"); if (g) g.innerHTML = keys.map(function (k) { return cmpCard(k, k === cur); }).join(""); bindGrid(); }
  function bindGrid() { app.querySelectorAll("[data-cmprm]").forEach(function (x) { x.addEventListener("click", function () { cmpToggle(x.dataset.cmprm, false); syncCmpChecks(); drawCmp(mode); }); }); }
  cmpLoad(keys, grid); grid();
  var cl = $("#cmpclear"); if (cl) cl.addEventListener("click", function () { state.cmp = []; syncCmpChecks(); drawCmp(mode); });
  var q = $("#cmpq"); if (q) q.addEventListener("input", function () { state.cmpq = q.value; var sel = $("#cmpsel"); sel.innerHTML = cmpPickerHtml(cur).match(/<select id="cmpsel">([\s\S]*?)<\/select>/)[1]; });
  var ad = $("#cmpadd"); if (ad) ad.addEventListener("click", function () { var v = $("#cmpsel").value; if (!v) return; cmpToggle(v, true); drawCmp(mode); });
}
function syncCmpChecks() { app.querySelectorAll("[data-cmpbuild]").forEach(function (x) { x.checked = cmpHas("build:" + x.dataset.cmpbuild); }); }
function renderBuildEditor() {
  var E = state.editor;
  app.innerHTML = navHtml("k") + '<p><button type="button" id="bback">← Cars</button></p><iframe id="bsframe" allow="web-share" title="Build sheet" src="builds/sheet.html?v=20261112f" style="width:100%;height:700px;border:0;background:transparent"></iframe><div id="cmpbox" style="margin-top:14px"></div>';
  bindNav(); drawCmp("editor");
  $("#bback").addEventListener("click", function () {
    if (E.dirty && !window.confirm("This build has unsaved changes. Leave without saving?")) return;
    state.editor = null; renderCars();
  });
}
window.addEventListener("message", function (e) {
  var fr = document.getElementById("bsframe"), E = state.editor;
  if (!fr || !E || e.source !== fr.contentWindow) return;
  var m = e.data; if (!m || typeof m !== "object") return;
  function post(x) { try { fr.contentWindow.postMessage(x, "*"); } catch (er) {} }
  if (m.fcm === "ready") post(E.car ? { fcm: "new", car: E.car, name: E.name || "" } : { fcm: "load", data: E.data, name: E.name, published: !!E.published, url: E.buildId ? buildLink(E.buildId) : "" });
  else if (m.fcm === "height" && m.h) fr.style.height = Math.max(400, Math.min(m.h + 24, 20000)) + "px";
  else if (m.fcm === "dirty") E.dirty = true;
  else if (m.fcm === "save") saveBuild(m, post);
  else if (m.fcm === "publish") {
    if (!E.buildId) { post({ fcm: "error", message: "Save the build first, then choose who can view it." }); return; }
    var on = !!m.on;
    sb.from("build_sheets").update({ published: on }).eq("id", E.buildId).then(function (r) {
      if (r.error) { post({ fcm: "error", message: dbError(r.error) + (/published|schema cache/i.test(r.error.message || "") ? " (has migration 030 been run?)" : "") }); return; }
      E.published = on; post({ fcm: "published", on: on, url: buildLink(E.buildId) });
    });
  }
  else if (m.fcm === "delete") {
    if (!E.buildId) { state.editor = null; renderCars(); return; }
    sb.from("build_sheets").delete().eq("id", E.buildId).then(function (r) {
      if (r.error) { post({ fcm: "error", message: dbError(r.error) }); return; }
      state.editor = null; renderCars();
    });
  }
});
function buildLink(id) { return new URL("builds/sheet.html?pub=" + encodeURIComponent(id), location.href).href; }
function saveBuild(m, post) {
  var E = state.editor, d = m.data || {}, name = String(m.name || "").trim();
  if (!name) { post({ fcm: "error", message: "Give the build a name first." }); return; }
  var row = { name: name, status: "completed", class_letter: /^[A-Z]$/.test(d.cls || "") ? d.cls : null, pi: d.pi ? Math.max(0, Math.min(999, Math.round(Number(d.pi)))) : null, data: d };
  var q = (m.copy || !E.buildId) ? sb.from("build_sheets").insert(Object.assign({ league_id: state.league.id, car_id: E.carId }, row)).select("id,published").single()
    : sb.from("build_sheets").update(row).eq("id", E.buildId).select("id,published").single();
  q.then(function (r) {
    if (r.error) { post({ fcm: "error", message: r.error.code === "23505" ? "Another build in this league already has that name. Pick a different name." : dbError(r.error) }); return; }
    E.buildId = r.data.id; E.name = name; E.car = null; E.data = d; E.dirty = false; E.published = !!r.data.published; post({ fcm: "saved", name: name, published: E.published, url: buildLink(E.buildId) });
  });
}
/* A championship's cars: stock (catalogue) and custom (saved builds) */
function champCarsHtml() { return '<div class="card"><h2>Cars</h2><p class="muted" style="margin:0 0 8px">The cars racers can use in this championship. Stock cars are unmodified. Custom builds come from the league\'s Cars page.</p><div id="cc" class="muted">Loading…</div></div>'; }
function fillChampCars() {
  var cid = state.sel.champ.id, lid = state.league.id, box = $("#cc"); if (!box) return;
  var catP = state.carsAll ? Promise.resolve({ data: state.carsAll }) : fetchAllCars();
  Promise.all([catP, fetchCC("id,car_id,build_id", function (q) { return q.eq("championship_id", cid); }), sb.from("build_sheets").select("id,name,status,class_letter,pi,car_id").eq("league_id", lid).order("name", { ascending: true }),
    sb.from("league_favourites").select("id,car_id,build_id").eq("league_id", lid), sb.from("divisions").select("id,name,pi_limit").eq("league_id", lid).order("name", { ascending: true })]).then(function (rs) {
    var bad = rs.slice(0, 4).filter(function (r) { return r.error; })[0];
    if (bad) { box.className = "err"; box.textContent = dbError(bad.error) + " Has migration 014 been run?"; return; }
    state.carsAll = rs[0].data || []; state.cc = rs[1].data || []; state.builds = rs[2].data || []; state.favs = rs[3].data || []; state.ccdivs = rs[4].error ? [] : (rs[4].data || []);
    drawChampCars();
  });
}
state.ccf = state.ccf || freshCarFilter();
function drawChampCars() {
  var box = $("#cc"); if (!box) return;
  var byCar = {}, byBuild = {}; state.carsAll.forEach(function (c) { byCar[c.id] = c; }); state.builds.forEach(function (b) { byBuild[b.id] = b; });
  var stock = state.cc.filter(function (x) { return x.car_id; }), custom = state.cc.filter(function (x) { return x.build_id; }), dvrows = state.cc.filter(function (x) { return x.division_id; });
  var byDiv = {}, dvAll = state.ccdivs || [], dvInUse = {}; dvAll.forEach(function (d) { byDiv[d.id] = d; }); dvrows.forEach(function (x) { dvInUse[x.division_id] = 1; });
  var dvAvail = dvAll.filter(function (d) { return !dvInUse[d.id]; });
  var usedBuild = {}, inStock = {}; custom.forEach(function (x) { usedBuild[x.build_id] = 1; }); stock.forEach(function (x) { inStock[x.car_id] = 1; });
  var avail = state.builds.filter(function (b) { return !usedBuild[b.id]; });
  var favB = favSet("build"), f = state.ccf; state.sel.ccopts = carOptLabels(state.cc, byCar, byBuild);
  avail.sort(function (a, b) { return (favB[b.id] ? 1 : 0) - (favB[a.id] ? 1 : 0) || a.name.localeCompare(b.name); });
  stock.sort(function (x, y) { var a = byCar[x.car_id], b = byCar[y.car_id]; return a && b ? (a.make + " " + a.model).localeCompare(b.make + " " + b.model) || a.year - b.year : 0; });
  var divs = uniq(state.carsAll.map(function (c) { return c.division; })).sort();
  box.className = "";
  box.innerHTML = '<h3 style="margin-top:0">Stock unmodified (' + stock.length + ")</h3>" +
    (stock.length ? '<details' + (stock.length <= 12 ? " open" : "") + '><summary class="muted" style="cursor:pointer">Show the ' + stock.length + ' stock cars</summary>' + stock.map(function (x) { var c = byCar[x.car_id]; return '<div class="row" style="align-items:center;margin:4px 0"><div class="grow"><b>' + esc(c ? carName(c) : "Unknown car") + '</b> <span class="muted">' + esc(c ? carFull(c) + " · " + classOf(c.pi) + " " + c.pi : "") + '</span></div><button type="button" data-ccrm="' + esc(x.id) + '">Remove</button></div>'; }).join("") + '<div style="margin-top:8px"><button type="button" class="danger" id="ccrmall">Remove all stock cars</button></div></details>' : '<p class="muted">None yet.</p>') +
    '<h3>Divisions (' + dvrows.length + ")</h3>" +
    (dvrows.length ? dvrows.map(function (x) { var d = byDiv[x.division_id]; return '<div class="row" style="align-items:center;margin:4px 0"><div class="grow"><b>' + esc(d ? d.name : "Unknown division") + '</b> <span class="muted">' + esc(d && d.pi_limit ? "PI limit " + d.pi_limit : "") + '</span></div><button type="button" data-ccrm="' + esc(x.id) + '">Remove</button></div>'; }).join("") : '<p class="muted" style="margin:4px 0">No divisions. A division lets any car in its list race, as long as it follows the division\'s rules. Make one on the Cars page.</p>') +
    '<h3>Custom built (' + custom.length + ")</h3>" +
    (custom.length ? custom.map(function (x) { var b = byBuild[x.build_id], c = b && byCar[b.car_id]; return '<div class="row" style="align-items:center;margin:4px 0"><div class="grow"><b>' + esc(b ? b.name : "Unknown build") + '</b> <span class="muted">' + esc((c ? carFull(c) : "") + (b && b.pi ? " · " + (b.class_letter || "") + " " + b.pi : "")) + '</span></div><button type="button" data-ccrm="' + esc(x.id) + '">Remove</button></div>'; }).join("") : '<p class="muted">None yet.</p>') +
    '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><div class="muted" style="margin-bottom:6px">Add stock cars. Search and filter the same way as the Cars tab, then add one car or everything that matches.</div>' + carFilterHtml(f, "g") +
    '<div id="gres"></div>' +
    '<div class="row" style="margin-top:12px;align-items:center"><div class="grow" id="cselname"></div><button type="button" id="cfavsel" aria-label="Favourite this car" style="min-width:40px;font-size:18px">☆</button><button type="button" id="caddcmp">Compare +</button><button class="primary" type="button" id="ccaddsel">Add to championship</button></div>' +
    '<div id="cstats"></div><div class="msg" id="cmsg"></div><div id="cmpbox" style="margin:14px 0"></div>' +
    '<div class="row" style="margin-top:10px;align-items:flex-end"><div class="field grow"><label for="ccdiv">A whole division</label><select id="ccdiv">' + selOpts(divs, "", "Choose a division") + '</select></div><button type="button" id="ccadddiv">Add the whole division</button></div>' +
    '</div>' +
    '<div class="row" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line);align-items:flex-end"><div class="field grow"><label for="ccb">Add a custom build</label><select id="ccb">' + (avail.length ? selOpts(avail.map(function (b) { return [b.id, (favB[b.id] ? "★ " : "") + b.name]; }), "", "Choose a build") : '<option value="">No more builds to add</option>') + '</select></div><button type="button" id="ccbadd">Add</button></div>' +
    (dvAll.length ? '<div class="row" style="margin-top:12px;align-items:flex-end"><div class="field grow"><label for="ccdv">Add a division</label><select id="ccdv">' + (dvAvail.length ? selOpts(dvAvail.map(function (d) { return [d.id, d.name]; }), "", "Choose a division") : '<option value="">No more divisions to add</option>') + '</select></div><button type="button" id="ccdvadd">Add</button></div>' : "") + '<div class="msg" id="ccm"></div>';

  function remaining() { return filterCars(f).filter(function (c) { return !inStock[c.id]; }); }
  var repickCC = function () {
    drawCarResults("g", f, {
      btn: function (c) { return '<button type="button" data-rpick="' + esc(c.id) + '"' + (c.id === state.cpick ? ' class="primary"' : "") + ">" + (c.id === state.cpick ? "Selected" : "Select") + "</button>" + (inStock[c.id] ? ' <span class="muted">In championship</span>' : ""); },
      pick: function (id) { state.cpick = id; repickCC(); },
      head: function (rows) { var n = rows.filter(function (c) { return !inStock[c.id]; }).length; return '<button type="button" id="ccaddall"' + (n ? "" : " disabled") + ">Add all " + n + " results</button>"; },
      after: function (bx, rows) { var a = bx.querySelector("#ccaddall"); if (a) a.addEventListener("click", function () { bulk(rows.filter(function (c) { return !inStock[c.id]; }), "everything that matches the search and filters"); }); }
    });
  };
  function bulk(list, what) {
    if (!list.length) { msg($("#ccm"), "Nothing to add: those cars are already in this championship.", "err"); return; }
    if (list.length > 25 && !window.confirm("Add " + list.length + " cars" + (what ? " (" + what + ")" : "") + " to this championship?")) return;
    msg($("#ccm"), "Adding " + list.length + "…");
    var chunks = [], i; for (i = 0; i < list.length; i += 200) chunks.push(list.slice(i, i + 200));
    var added = [], err = null;
    chunks.reduce(function (p, ch) { return p.then(function () { if (err) return; return sb.from("championship_cars").insert(ch.map(function (c) { return { championship_id: state.sel.champ.id, car_id: c.id }; })).select("id,car_id,build_id").then(function (r) { if (r.error) err = r.error; else added = added.concat(r.data || []); }); }); }, Promise.resolve()).then(function () {
      state.cc = state.cc.concat(added); drawChampCars();
      msg($("#ccm"), err ? "Added " + added.length + " then stopped: " + dbError(err) : "Added " + added.length + " car" + (added.length === 1 ? "" : "s") + ".", err ? "err" : "ok");
    });
  }
  function add(row) { msg($("#ccm"), "Adding…"); sb.from("championship_cars").insert(Object.assign({ championship_id: state.sel.champ.id }, row)).select(row.division_id ? "id,car_id,build_id,division_id" : "id,car_id,build_id").single().then(function (r) { if (r.error) { msg($("#ccm"), r.error.code === "23505" ? "That car is already in this championship." : dbError(r.error), "err"); return; } state.cc.push(r.data); drawChampCars(); }); }
  function selPanel() {
    var cur = state.carsAll.filter(function (c) { return c.id === state.cpick; })[0], ad = $("#ccaddsel");
    $("#cselname").innerHTML = cur ? "<b>" + esc(carName(cur)) + '</b> <span class="muted">' + esc(carFull(cur)) + (inStock[cur.id] ? " · already in this championship" : "") + "</span>" : '<span class="muted">No car selected. Search above and press Select on a car.</span>';
    $("#cfavsel").textContent = favSet("car")[state.cpick] ? "★" : "☆";
    ad.disabled = !cur || !!inStock[state.cpick]; ad.textContent = cur && inStock[cur.id] ? "Added" : "Add to championship";
    showStats();
  }
  var rp = repickCC; repickCC = function () { rp(); selPanel(); };
  bindCarFilter(f, "g", repickCC, drawChampCars); repickCC(); drawCmp("cars");
  $("#ccaddsel").addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } add({ car_id: state.cpick }); });
  $("#caddcmp").addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } cmpToggle("car:" + state.cpick, true); drawCmp("cars"); });
  $("#cfavsel").addEventListener("click", function () { if (!state.cpick) return; toggleFav("car:" + state.cpick, function () { repickCC(); }); });
  box.querySelectorAll("[data-ccrm]").forEach(function (x) { x.addEventListener("click", function () { sb.from("championship_cars").delete().eq("id", x.dataset.ccrm).then(function (r) { if (r.error) { msg($("#ccm"), dbError(r.error), "err"); return; } state.cc = state.cc.filter(function (y) { return y.id !== x.dataset.ccrm; }); drawChampCars(); }); }); });
  var ra = $("#ccrmall"); if (ra) ra.addEventListener("click", function () {
    if (!window.confirm("Remove all " + stock.length + " stock cars from this championship? Custom builds stay.")) return;
    sb.from("championship_cars").delete().eq("championship_id", state.sel.champ.id).not("car_id", "is", null).then(function (r) { if (r.error) { msg($("#ccm"), dbError(r.error), "err"); return; } state.cc = state.cc.filter(function (y) { return !y.car_id; }); drawChampCars(); });
  });
  $("#ccadddiv").addEventListener("click", function () {
    var d = $("#ccdiv").value; if (!d) { msg($("#ccm"), "Choose a division first.", "err"); return; }
    bulk(state.carsAll.filter(function (c) { return c.division === d && !inStock[c.id]; }), d);
  });
  $("#ccbadd").addEventListener("click", function () { var v = $("#ccb").value; if (v) add({ build_id: v }); });
  var dva = $("#ccdvadd"); if (dva) dva.addEventListener("click", function () { var v = $("#ccdv").value; if (v) add({ division_id: v }); else msg($("#ccm"), "Choose a division first.", "err"); });
}
