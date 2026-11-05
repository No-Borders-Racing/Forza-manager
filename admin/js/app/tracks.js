/* Track guide. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

/* Tracks: a read-only reference library of every venue and its layouts. */
state.tf = state.tf || { q: "", country: "", kind: "" };
function renderTracks() {
  app.innerHTML = navHtml("t") + '<div class="card muted">Loading the track guide…</div>'; bindNav();
  Promise.all([sb.from("track_venues").select("*").order("name", { ascending: true }), sb.from("track_layouts").select("id,venue_id,name,length_km,is_reverse").order("name", { ascending: true })]).then(function (rs) {
    var bad = rs.filter(function (r) { return r.error; })[0];
    if (bad) { app.innerHTML = navHtml("t") + '<div class="card err">' + esc(dbError(bad.error)) + " Has migration 016 been run?</div>"; bindNav(); return; }
    state.venues = (rs[0].data || []).map(function (v) { v.country = v.country ? String(v.country).toUpperCase() : v.country; return v; }); state.venueLayouts = rs[1].data || []; renderTracksBody();
  });
}
function venueMatches(v) {
  var f = state.tf, q = f.q.trim().toLowerCase();
  if (f.country && v.country !== f.country) return false;
  if (f.kind && v.kind !== f.kind) return false;
  if (q) { var lay = state.venueLayouts.filter(function (l) { return l.venue_id === v.id; }).map(function (l) { return l.name; }).join(" "); if ((v.name + " " + (v.location || "") + " " + (v.based_on || "") + " " + lay).toLowerCase().indexOf(q) < 0) return false; }
  return true;
}
function factTile(k, v) { return v ? '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div></div>" : ""; }
function dirText(d) { return { clockwise: "Clockwise", anticlockwise: "Anticlockwise", "point-to-point": "Point to point" }[d] || d || ""; }
function typeText(t) { return { "purpose-built": "Purpose-built circuit", "public-road": "Public road circuit", airfield: "Former airfield", oval: "Oval / speedway" }[t] || ""; }
function surfaceShort(x) { return x || ""; }
function circuitNotes(v) {
  var rows = [["Type", v.type_note], ["Surface", v.surface_note], ["Corners counted on", v.corners_layout], ["Length", v.length_note], ["Elevation", v.elevation_note]].filter(function (r) { return r[1]; });
  return rows.length ? '<div style="margin-top:12px">' + rows.map(function (r) { return '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid var(--line)"><span class="muted">' + esc(r[0]) + '</span><span style="text-align:right">' + esc(r[1]) + "</span></div>"; }).join("") + "</div>" : "";
}
function factsHtml(v) {
  var f = Array.isArray(v.facts) ? v.facts : []; if (!f.length) return "";
  return '<h3 style="margin:16px 0 4px">Did you know</h3><ul style="margin:0;padding-left:20px">' + f.map(function (x) { return '<li style="margin:4px 0">' + esc(x) + "</li>"; }).join("") + "</ul>";
}
function venueDetailHtml(v) {
  var lays = state.venueLayouts.filter(function (l) { return l.venue_id === v.id; }), place = [v.location, COUNTRY_NAME[v.country] || v.country].filter(Boolean).join(", ");
  var longest = lays.reduce(function (m, l) { return Math.max(m, Number(l.length_km) || 0); }, 0);
  var src = /^https?:\/\//i.test(v.source_url || "") ? ' · <a href="' + esc(v.source_url) + '" target="_blank" rel="noopener noreferrer">Source</a>' : "";
  var map = place ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.name + (place ? ", " + place : "")) + '" target="_blank" rel="noopener noreferrer">Open on a map</a>' : "";
  return '<div class="card" style="margin:0"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px"><div><h2 style="font-size:22px;margin:0">' + esc(v.name) + '</h2><div class="muted" style="margin-top:2px">' + esc(place) + "</div></div>" +
    (v.kind ? '<span class="pill">' + (v.kind === "real" ? "Real circuit" : "Fictional") + "</span>" : "") + "</div>" +
    '<div class="row" style="margin-top:14px;gap:10px">' + factTile("Opened", v.kind === "fictional" ? "Fictional" : v.opened_year) + factTile("Country", COUNTRY_NAME[v.country] || v.country) + factTile("Layouts", String(lays.length)) + factTile("Longest layout", longest ? lenText(longest) : "") + factTile("Corners", v.corners ? String(v.corners) : "") + factTile("Direction", dirText(v.direction)) + factTile("Type", typeText(v.circuit_type).replace(" circuit", "")) + factTile("Surface", surfaceShort(v.surface)) + "</div>" + circuitNotes(v) +
    '<h3 style="margin:16px 0 4px">Where it is</h3><div>' + esc(place || "Location not recorded") + (map ? " · " + map : "") + "</div>" + (v.based_on ? '<div class="muted" style="margin-top:4px">' + esc((v.kind === "fictional" ? "Modelled on: " : "Also known as: ") + v.based_on) + "</div>" : "") +
    '<h3 style="margin:16px 0 4px">About</h3>' + (v.history ? '<p style="margin:0">' + esc(v.history) + "</p>" : '<p class="muted" style="margin:0">No background details yet.</p>') + (src ? '<p class="muted" style="margin:6px 0 0">' + src.slice(3) + "</p>" : "") + factsHtml(v) +
    '<h3 style="margin:16px 0 4px">Layouts</h3>' + (lays.length ? lays.map(function (l) { return '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)"><span>' + esc(l.name) + (l.is_reverse ? ' <span class="pill">Reverse</span>' : "") + "</span><b>" + esc(lenText(l.length_km)) + "</b></div>"; }).join("") : '<p class="muted" style="margin:0">None.</p>') + "</div>";
}
function renderTracksBody() {
  var f = state.tf, countries = uniq(state.venues.map(function (v) { return v.country; })).sort(function (a, b) { return (COUNTRY_NAME[a] || a).localeCompare(COUNTRY_NAME[b] || b); });
  app.innerHTML = navHtml("t") + '<div class="card"><h2 style="font-size:18px;margin:0">Track guide</h2><p class="muted" style="margin:4px 0 10px">Every venue and its layouts, with background where we have it. Lengths follow the league units.</p>' +
    '<div class="row" style="align-items:flex-end"><div class="field grow"><label for="tq">Search</label><input id="tq" value="' + esc(f.q) + '" placeholder="Venue, place or layout" autocomplete="off"></div>' +
    '<div class="field"><label for="tco">Country</label><select id="tco">' + selOpts(countries.map(function (c) { return [c, COUNTRY_NAME[c] || c]; }), f.country, "Any") + '</select></div>' +
    '<div class="field"><label for="tkd">Type</label><select id="tkd">' + selOpts([["real", "Real circuits"], ["fictional", "Fictional"]], f.kind, "Any") + '</select></div></div>' +
    '<div class="muted" id="tnote" style="margin-top:8px"></div></div><div class="tgrid"><div id="tlist" class="card" style="margin:0;padding:6px;max-height:75vh;overflow:auto"></div><div id="tdetail"></div></div>';
  bindNav();
  function draw() {
    var rows = state.venues.filter(venueMatches); $("#tnote").textContent = rows.length + " of " + state.venues.length + " venues";
    if (!rows.some(function (v) { return v.id === state.tsel; })) state.tsel = rows.length ? rows[0].id : "";
    $("#tlist").innerHTML = rows.map(function (v) {
      var on = v.id === state.tsel, place = [v.location, COUNTRY_NAME[v.country] || v.country].filter(Boolean).join(", ");
      return '<button type="button" data-venue="' + esc(v.id) + '" aria-pressed="' + (on ? "true" : "false") + '" class="' + (on ? "primary" : "") + '" style="display:block;width:100%;text-align:left;margin:2px 0;padding:8px 10px"><b>' + esc(v.name) + '</b><div style="font-size:12px;opacity:.8">' + esc(place) + (v.kind ? " · " + (v.kind === "real" ? "Real" : "Fictional") : "") + "</div></button>";
    }).join("") || '<p class="muted" style="padding:8px">No venues match.</p>';
    var cur = state.venues.filter(function (v) { return v.id === state.tsel; })[0]; $("#tdetail").innerHTML = cur ? venueDetailHtml(cur) : "";
    app.querySelectorAll("[data-venue]").forEach(function (x) { x.addEventListener("click", function () { state.tsel = x.dataset.venue; draw(); if (window.innerWidth <= 700) $("#tdetail").scrollIntoView({ block: "start" }); }); });
  }
  $("#tq").addEventListener("input", function () { f.q = this.value; draw(); }); $("#tco").addEventListener("change", function () { f.country = this.value; draw(); }); $("#tkd").addEventListener("change", function () { f.kind = this.value; draw(); });
  draw();
}
