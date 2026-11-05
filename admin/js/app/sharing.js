/* Sharing: who can view each public page, with copy links. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

// League settings > Sharing: who can view each page, with its link, and whether to open the league page first at sign-in.
function renderSharing() {
  var lg = state.league; state.sel = null; state.nav = { view: "champ" };
  app.innerHTML = navHtml("l", "s") + '<div class="card"><h2>Sharing</h2><div id="hm" class="muted">Loading…</div></div>';
  bindNav();
  sb.from("championships").select("*").eq("league_id", lg.id).order("created_at", { ascending: false }).then(function (cr) {
    if (cr.error) { $("#hm").innerHTML = '<span class="err">' + esc(dbError(cr.error)) + "</span>"; return; }
    var champs = cr.data || [], cids = champs.map(function (c) { return c.id; });
    (cids.length ? sb.from("seasons").select("*").in("championship_id", cids) : Promise.resolve({ data: [] })).then(function (sr) {
      var seasons = sr.data || [], champOf = {}; champs.forEach(function (c) { champOf[c.id] = c; });
      drawSharing({ champs: champs, seasons: seasons, champOf: champOf });
    });
  });
}
function drawSharing(d) {
  var lg = state.league, box = $("#hm"); if (!box) return;
  var rows = [], pub = function (on, url, name, go, id) {
    return '<div class="row" style="align-items:center;margin:4px 0"><span style="flex:1 1 180px">' + esc(name) + "</span>" + (on ? copyBtnHtml(url) : '<span class="pill">Admin only</span><button type="button" data-hgo="' + go + '"' + (id ? ' data-id="' + esc(id) + '"' : "") + ">Change…</button>") + "</div>";
  };
  rows.push(pub(!!lg.page_published, pageLink("l", lg.id), "League page", "league"));
  d.champs.forEach(function (c) { rows.push(pub(!!c.page_published, pageLink("c", c.id), c.name + " page", "champ", c.id)); });
  d.seasons.forEach(function (x) { var c = d.champOf[x.championship_id]; rows.push(pub(!!x.calendar_published, calendarLink(x.id), (c ? c.name + " · " : "") + x.name + " calendar", "champ", x.championship_id)); });
  var h = '<p class="muted" style="margin:0 0 8px">Who can view each page, with its link to share.</p>' + rows.join("");
  box.className = ""; box.innerHTML = h;
  box.querySelectorAll("[data-hgo]").forEach(function (b) { b.addEventListener("click", function () {
    if (b.dataset.hgo === "league") { renderLeague(); return; }
    state.wantTab = "settings"; openChamp(b.dataset.id);
  }); });
}
/* ---------- public championship and league pages ---------- */
function pageLink(kind, id) { return new URL("../league/?" + kind + "=" + encodeURIComponent(id), location.href).href; }
// Who can view a page: Public (anyone with the link) or Admin only (league admins, signed in). New pages start Public.
function whoSelHtml(attr, id, isPublic) {
  return '<div class="field" style="max-width:260px"><label for="ws-' + attr + '-' + esc(id) + '">Who can view?</label><select id="ws-' + attr + '-' + esc(id) + '" data-' + attr + '="' + esc(id) + '">' +
    '<option value="public"' + (isPublic ? " selected" : "") + '>Public</option><option value="admin"' + (isPublic ? "" : " selected") + ">Admin only</option></select></div>";
}
// kind "c" = a championship page (builds, calendar, results, standings); "l" = the league page.
function pagePublishHtml(kind, row) {
  var what = kind === "c" ? "Championship page" : "League page", on = row.page_published !== false && !!row.page_published, link = pageLink(kind, row.id);
  var h = '<div class="card"><h3 style="margin-top:0">' + what + '</h3>' + whoSelHtml("pgsel", kind, on);
  if (on) {
    h += '<div class="row" style="align-items:center;margin-top:8px"><input readonly id="pgl-' + kind + '" value="' + esc(link) + '" style="flex:1 1 260px" aria-label="Page link">' +
      '<button type="button" data-pgcopy="' + kind + '">Copy link</button><a href="' + esc(link) + '" target="_blank" rel="noopener"><button type="button">Open</button></a></div>' +
      '<p class="muted" style="margin:6px 0 0">' + (kind === "c" ? "Anyone with the link sees this championship\'s calendars, results, standings and the car builds that belong to its cars. It updates as you edit. Driver gamertags are not shown." : "Anyone with the link sees the league profile and its championships. It updates as you edit.") + "</p>";
  } else {
    h += '<p class="muted" style="margin:8px 0 0">Only league admins who are signed in can open this page. Visitors see a "not available" message.</p>';
  }
  return h + '<div class="msg" id="pgm-' + kind + '"></div></div>';
}
function setPagePublished(kind, on) {
  var row = kind === "c" ? state.sel.champ : state.league, m = $("#pgm-" + kind);
  sb.from(kind === "c" ? "championships" : "leagues").update({ page_published: on }).eq("id", row.id).then(function (r) {
    if (r.error) { msg(m, dbError(r.error) + (/page_published|schema cache/i.test(r.error.message || "") ? " (has migration 030 been run?)" : ""), "err"); return; }
    row.page_published = on;
    if (kind === "c") renderChamp(); else renderLeague();
    setTimeout(function () { var mm = $("#pgm-" + kind); if (mm) msg(mm, on ? "Anyone with the link can view this page." : "Only admins can view this page now.", "ok"); }, 50);
  });
}
document.addEventListener("change", function (e) {
  var t = e.target; if (!t || !t.dataset) return;
  if (t.dataset.pgsel) setPagePublished(t.dataset.pgsel, t.value === "public");
  else if (t.dataset.cpsel) setCalendarPublished(t.dataset.cpsel, t.value === "public");
});
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-pgcopy]"); if (!b) return;
  var inp = $("#pgl-" + b.dataset.pgcopy), m = $("#pgm-" + b.dataset.pgcopy); inp.select();
  copyText(inp.value, function (ok) { msg(m, ok ? "Link copied." : "Press Ctrl+C to copy the selected link.", ok ? "ok" : ""); });
});
/* ---------- seasons ---------- */
function calendarLink(sid) { return new URL("../calendar/?s=" + encodeURIComponent(sid), location.href).href; }
function calendarPublishHtml(s) {
  var on = !!s.calendar_published, h = '<div style="margin:12px 0 4px">' + whoSelHtml("cpsel", s.id, on);
  if (on) {
    h += '<div class="row" style="align-items:center;margin-top:8px"><input readonly id="cpl-' + s.id + '" value="' + esc(calendarLink(s.id)) + '" style="flex:1 1 260px" aria-label="Calendar link">' +
      '<button type="button" data-cpcopy="' + s.id + '">Copy link</button><a href="' + esc(calendarLink(s.id)) + '" target="_blank" rel="noopener"><button type="button">Open</button></a></div>' +
      '<p class="muted" style="margin:6px 0 0">Anyone with the link can see this season\'s rounds, dates (in their own time zone), tracks, races and notes. It updates as you edit.</p>';
  } else {
    h += '<p class="muted" style="margin:8px 0 0">Only league admins who are signed in can open this calendar.</p>';
  }
  return h + '<div class="msg" id="cpm-' + s.id + '"></div></div>';
}
function setCalendarPublished(sid, on) {
  var m = $("#cpm-" + sid);
  sb.from("seasons").update({ calendar_published: on }).eq("id", sid).then(function (r) {
    if (r.error) { msg(m, dbError(r.error) + (/calendar_published|schema cache/i.test(r.error.message || "") ? " (has migration 030 been run?)" : ""), "err"); return; }
    openChamp(state.sel.champ.id);
    setTimeout(function () { var mm = $("#cpm-" + sid); if (mm) msg(mm, on ? "Anyone with the link can view this calendar." : "Only admins can view this calendar now.", "ok"); }, 600);
  });
}
