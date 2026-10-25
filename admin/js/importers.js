/* Data importers for the admin app. Currently: tracks. Exposes window.FCMImport. */
(function () {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], f = "", q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"' && f === "") q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = ""; rows.push(row); row = [];
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ""); });
  }

  /* ---------- tracks ---------- */
  var ALIASES = {
    ordinal: ["ordinal", "trackordinal", "id"],
    venue: ["venue", "track", "trackname", "circuit"],
    location: ["location", "city"],
    country: ["country", "countrycode"],
    layout: ["layout", "layoutname", "variant"],
    km: ["km", "length", "lengthkm"]
  };
  var HEADERLESS = { ordinal: 0, venue: 1, location: 2, country: 3, layout: 4, km: 5 };

  function analyzeTracks(text) {
    var table = parseCSV(text);
    if (!table.length) return { fatal: "No rows found." };
    var map, start, first = table[0], hasHeader = !/^\s*\d+\s*$/.test(first[0] || "");
    if (hasHeader) {
      var norm = first.map(function (h) { return h.toLowerCase().replace(/[^a-z0-9]/g, ""); });
      map = {}; start = 1;
      Object.keys(ALIASES).forEach(function (k) {
        for (var n = 0; n < norm.length; n++) if (ALIASES[k].indexOf(norm[n]) >= 0) { map[k] = n; break; }
      });
      var miss = ["ordinal", "venue", "layout", "km"].filter(function (k) { return map[k] === undefined; });
      if (miss.length) return { fatal: "The header row has no column for: " + miss.join(", ") + "." };
    } else {
      map = HEADERLESS; start = 0;
      if (first.length < 6) return { fatal: "Expected at least 6 columns: ordinal, venue, location, country, layout, km." };
    }
    var issues = [], layouts = [], seenOrd = {}, seenName = {}, venueInfo = {}, r, c, rowNo;
    function add(level, row, text) { issues.push({ level: level, row: row, text: text }); }
    for (r = start; r < table.length; r++) {
      c = table[r]; rowNo = r + 1;
      var ord = (c[map.ordinal] || "").trim(), venue = (c[map.venue] || "").trim(), layout = (c[map.layout] || "").trim(),
          km = (c[map.km] || "").trim(),
          loc = map.location === undefined ? "" : (c[map.location] || "").trim(),
          ctry = map.country === undefined ? "" : (c[map.country] || "").trim();
      if (!/^\d+$/.test(ord)) { add("error", rowNo, "Ordinal is not a whole number (row skipped): " + ord); continue; }
      if (!venue) { add("error", rowNo, "Venue is blank (row skipped)"); continue; }
      if (!layout) { add("error", rowNo, "Layout name is blank (row skipped)"); continue; }
      var kmN = Number(km);
      if (km === "" || !isFinite(kmN) || kmN <= 0) { add("error", rowNo, "Length is not a positive number (row skipped): " + km); continue; }
      if (seenOrd[ord]) { add("error", rowNo, "Duplicate ordinal " + ord + " (row skipped), first at row " + seenOrd[ord]); continue; }
      var key = venue.toLowerCase() + "|" + layout.toLowerCase();
      if (seenName[key]) { add("error", rowNo, "Same venue and layout as row " + seenName[key] + " (row skipped)"); continue; }
      seenOrd[ord] = rowNo; seenName[key] = rowNo;
      if (kmN < 0.3 || kmN > 30) add("warn", rowNo, "Length outside 0.3–30 km: " + kmN + " (" + venue + ", " + layout + ")");
      if (!loc) add("warn", rowNo, "Location is blank (" + venue + ")");
      if (!ctry) add("warn", rowNo, "Country is blank (" + venue + ")");
      var vi = venueInfo[venue];
      if (!vi) venueInfo[venue] = { name: venue, location: loc || null, country: ctry || null };
      else if ((loc && vi.location && loc !== vi.location) || (ctry && vi.country && ctry !== vi.country))
        add("warn", rowNo, "Location or country differs from an earlier layout of " + venue + " (first one kept)");
      else { if (!vi.location && loc) vi.location = loc; if (!vi.country && ctry) vi.country = ctry; }
      layouts.push({ ordinal: Number(ord), venue: venue, name: layout, km: kmN, reverse: /\breverse\b/i.test(layout) });
    }
    return {
      layouts: layouts, venues: Object.keys(venueInfo).map(function (k) { return venueInfo[k]; }),
      issues: issues, hasHeader: hasHeader, errors: issues.filter(function (i) { return i.level === "error"; }).length,
      warns: issues.filter(function (i) { return i.level === "warn"; }).length
    };
  }

  function sourceLabel(a) { return "Imported from pasted CSV, " + new Date().toISOString().slice(0, 10) + " (unverified)"; }

  function renderTracks(host, sb, back) {
    host.innerHTML = '<p><button type="button" id="imback">← Back</button></p>' +
      '<div class="card"><h2>Import tracks</h2>' +
      '<p class="muted">Paste or choose the track CSV. Expected columns: ordinal, venue, location, country, layout, length in km (a header row is optional; extra columns are ignored). Nothing is saved until you approve the preview. Imported tracks are marked unverified.</p>' +
      '<div class="field"><label for="imfile">CSV file</label><input id="imfile" type="file" accept=".csv,.txt,text/csv,text/plain"></div>' +
      '<div class="field" style="margin-top:8px"><label for="imtext">or paste here</label><textarea id="imtext" style="min-height:120px"></textarea></div>' +
      '<div class="row" style="margin-top:8px"><button class="primary" id="imprev" type="button">Preview</button></div>' +
      '<div class="msg" id="immsg"></div><div id="imout"></div></div>' +
      '<div class="card"><h3 style="margin-top:0">Tracks already loaded</h3><div id="imhave" class="muted">Checking…</div></div>';
    var $ = function (s) { return host.querySelector(s); };
    $("#imback").addEventListener("click", back);
    function setMsg(t, k) { var m = $("#immsg"); m.className = "msg " + (k || ""); m.textContent = t || ""; }
    function loadCount() {
      Promise.all([
        sb.from("track_layouts").select("id", { count: "exact", head: true }),
        sb.from("track_venues").select("id", { count: "exact", head: true })
      ]).then(function (rs) {
        var el = $("#imhave");
        if (rs[0].error || rs[1].error) { el.className = "err"; el.textContent = (rs[0].error || rs[1].error).message; return; }
        el.textContent = rs[1].count + " venue(s), " + rs[0].count + " layout(s).";
      });
    }
    loadCount();
    $("#imfile").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader(); rd.onload = function () { $("#imtext").value = String(rd.result); }; rd.readAsText(f);
    });
    $("#imprev").addEventListener("click", function () {
      var a = analyzeTracks($("#imtext").value);
      var out = $("#imout"); out.innerHTML = ""; setMsg("");
      if (a.fatal) { setMsg(a.fatal, "err"); return; }
      var h = '<h3>Preview</h3><p>' + a.layouts.length + " layouts at " + a.venues.length + " venues will be imported. " +
        (a.hasHeader ? "Header row found." : "No header row, using the standard column order.") + " " +
        a.errors + " row(s) skipped, " + a.warns + " warning(s).</p>";
      if (a.issues.length) {
        h += '<details' + (a.errors ? " open" : "") + '><summary>Problems</summary><ul>' + a.issues.slice(0, 200).map(function (i) {
          return '<li class="' + (i.level === "error" ? "err" : "muted") + '">Row ' + i.row + ": " + esc(i.text) + "</li>";
        }).join("") + (a.issues.length > 200 ? "<li>…and " + (a.issues.length - 200) + " more</li>" : "") + "</ul></details>";
      }
      var byV = {};
      a.layouts.forEach(function (l) { (byV[l.venue] = byV[l.venue] || []).push(l); });
      h += '<details><summary>Venues and layouts</summary><ul>' + a.venues.map(function (v) {
        return "<li><b>" + esc(v.name) + "</b> " + esc([v.location, v.country].filter(Boolean).join(", ")) + "<ul>" +
          byV[v.name].map(function (l) { return "<li>" + esc(l.name) + " · " + l.km + " km" + (l.reverse ? " · reverse" : "") + "</li>"; }).join("") + "</ul></li>";
      }).join("") + "</ul></details>";
      if (a.layouts.length) h += '<div class="row" style="margin-top:10px"><button class="primary" id="imgo" type="button">Import ' + a.layouts.length + " layouts</button></div>";
      out.innerHTML = h;
      var go = $("#imgo"); if (go) go.addEventListener("click", function () { save(a, go); });
    });

    function save(a, btn) {
      btn.disabled = true; setMsg("Saving…");
      var src = sourceLabel();
      sb.from("track_venues").upsert(a.venues.map(function (v) { return { name: v.name, location: v.location, country: v.country }; }), { onConflict: "name" })
        .select("id,name").then(function (vr) {
          if (vr.error) { btn.disabled = false; setMsg(vr.error.message, "err"); return; }
          var vid = {}; vr.data.forEach(function (v) { vid[v.name] = v.id; });
          sb.from("track_layouts").select("imported_ordinal,verified").then(function (er) {
            if (er.error) { btn.disabled = false; setMsg(er.error.message, "err"); return; }
            var locked = {}; er.data.forEach(function (x) { if (x.verified && x.imported_ordinal != null) locked[x.imported_ordinal] = true; });
            var rows = a.layouts.filter(function (l) { return !locked[l.ordinal]; }).map(function (l) {
              return { venue_id: vid[l.venue], name: l.name, length_km: l.km, is_reverse: l.reverse, imported_ordinal: l.ordinal, source: src };
            });
            var skipped = a.layouts.length - rows.length;
            sb.from("track_layouts").upsert(rows, { onConflict: "imported_ordinal" }).then(function (lr) {
              if (lr.error) { btn.disabled = false; setMsg(lr.error.message, "err"); return; }
              setMsg("Imported " + rows.length + " layouts." + (skipped ? " " + skipped + " already-verified layout(s) were left unchanged." : ""), "ok");
              $("#imout").innerHTML = ""; loadCount();
            });
          });
        });
    }
  }

  window.FCMImport = { renderTracks: renderTracks, analyzeTracks: analyzeTracks, parseCSV: parseCSV };
})();
