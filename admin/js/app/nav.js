/* The app's nav bar and its buttons. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

// Top bar: Home and Championships on the left, League settings hard right. Inside League settings a second row holds
// General, Points systems, Drivers and Admins.
function navHtml(active, sub) {
  var h = '<div class="row scrollrow" style="margin-bottom:12px"><button type="button" id="nav-h"' + (active === "h" ? ' class="primary"' : "") + '>Home</button><button type="button" id="nav-c"' + (active === "c" ? ' class="primary"' : "") + '>Championships</button><button type="button" id="nav-k"' + (active === "k" ? ' class="primary"' : "") + '>Cars</button><button type="button" id="nav-t"' + (active === "t" ? ' class="primary"' : "") + '>Track guide</button><button type="button" id="nav-r"' + (active === "r" ? ' class="primary"' : "") + '>Results</button>' +
    (state.owner ? '<button type="button" id="nav-adm"' + (active === "adm" ? ' class="primary"' : "") + '>Admin</button>' : "") + '<button type="button" id="nav-l" style="margin-left:auto"' + (active === "l" ? ' class="primary"' : "") + '>League settings</button></div>';
  if (active === "l") h += '<div class="row scrollrow" style="margin:-4px 0 12px">' + [["g", "General"], ["p", "Points systems"], ["d", "Drivers"], ["a", "Admins"], ["s", "Sharing"]].map(function (t) {
    return '<button type="button" id="sub-' + t[0] + '"' + (t[0] === sub ? ' class="primary"' : "") + ">" + t[1] + "</button>";
  }).join("") + "</div>";
  return h;
}
// Results from anywhere: a list of the championships, pick one to enter its results.
function goResults() {
  sb.from("championships").select("id,name").eq("league_id", state.league.id).order("created_at", { ascending: false }).then(function (r) {
    if (r.error) { app.innerHTML = navHtml("r") + '<div class="card err">' + esc(dbError(r.error)) + "</div>"; bindNav(); return; }
    state.champs = r.data || [];
    app.innerHTML = navHtml("r") + '<div class="card"><h2>Results</h2><p class="muted" style="margin:0 0 8px">Pick a championship to enter or correct its results.</p><div class="list">' +
      (state.champs.length ? state.champs.map(function (c) { return '<button type="button" class="item" data-rc="' + esc(c.id) + '"><span>' + esc(c.name) + "</span></button>"; }).join("") : '<p class="muted">No championships yet.</p>') + "</div></div>";
    app.querySelectorAll("[data-rc]").forEach(function (b) { b.addEventListener("click", function () { state.wantTab = "results"; state.nav = { view: "champ" }; openChamp(b.dataset.rc, { view: "champ" }); }); });
    bindNav();
  });
}
function bindNav() {
var go = { "nav-h": renderHome, "nav-c": loadChamps, "nav-k": renderCars, "nav-t": renderTracks, "nav-r": goResults, "nav-l": renderLeague, "nav-adm": function () { renderAdminPage("o"); }, "sub-g": renderLeague, "sub-p": renderLeaguePoints, "sub-d": renderDrivers, "sub-a": renderLeagueAdmins, "sub-s": renderSharing };
Object.keys(go).forEach(function (id) { var b = document.getElementById(id); if (b) b.addEventListener("click", go[id]); });
}
