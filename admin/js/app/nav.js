/* The app's nav bar and its buttons. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

// Top bar: Home and Championships on the left, League settings hard right. Inside League settings a second row holds
// General, Points systems, Drivers and Admins.
function navHtml(active, sub) {
  var h = '<div class="row scrollrow" style="margin-bottom:12px"><button type="button" id="nav-h"' + (active === "h" ? ' class="primary"' : "") + '>Home</button><button type="button" id="nav-c"' + (active === "c" ? ' class="primary"' : "") + '>Championships</button><button type="button" id="nav-k"' + (active === "k" ? ' class="primary"' : "") + '>Cars</button><button type="button" id="nav-t"' + (active === "t" ? ' class="primary"' : "") + '>Tracks</button><button type="button" id="nav-r">Results</button>' +
    '<button type="button" id="nav-l" style="margin-left:auto"' + (active === "l" ? ' class="primary"' : "") + '>League settings</button></div>';
  if (active === "l") h += '<div class="row scrollrow" style="margin:-4px 0 12px">' + [["g", "General"], ["p", "Points systems"], ["d", "Drivers"], ["a", "Admins"], ["s", "Sharing"]].map(function (t) {
    return '<button type="button" id="sub-' + t[0] + '"' + (t[0] === sub ? ' class="primary"' : "") + ">" + t[1] + "</button>";
  }).join("") + "</div>";
  return h;
}
// Results from anywhere: the championship you were last in, or the newest one if you have not opened any.
function goResults() {
var id = state.lastChamp || (state.champs && state.champs[0] && state.champs[0].id);
if (id && state.league) { state.wantTab = "results"; state.nav = { view: "champ" }; openChamp(id, { view: "champ" }); return; }
sb.from("championships").select("id").eq("league_id", state.league.id).order("created_at", { ascending: false }).limit(1).then(function (r) {
  var c = r.data && r.data[0];
  if (!c) { loadChamps(); return; }
  state.wantTab = "results"; state.nav = { view: "champ" }; openChamp(c.id, { view: "champ" });
});
}
function bindNav() {
var go = { "nav-h": renderHome, "nav-c": loadChamps, "nav-k": renderCars, "nav-t": renderTracks, "nav-r": goResults, "nav-l": renderLeague, "sub-g": renderLeague, "sub-p": renderLeaguePoints, "sub-d": renderDrivers, "sub-a": renderLeagueAdmins, "sub-s": renderSharing };
Object.keys(go).forEach(function (id) { var b = document.getElementById(id); if (b) b.addEventListener("click", go[id]); });
}
