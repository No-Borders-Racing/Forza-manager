/* Leagues: loading, the league picker and the landing view. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

// Each league is its own folder: the admin works inside one league at a time.
function loadLeagues(pick) {
  sb.from("leagues").select("*").order("name", { ascending: true }).then(function (r) {
    if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + " Has migration 008 (leagues) been run?</div>"; return; }
    state.leagues = r.data || [];
    var want = pick || (state.deep && state.deep.l) || lsGet("fcm.league"), cur = state.leagues.filter(function (l) { return l.id === want; })[0] || (state.leagues.length === 1 ? state.leagues[0] : null);
    if (!cur) { renderLeaguePicker(); return; }
    if (state.league && state.league.id !== cur.id) state.lastChamp = null;
    state.league = cur; applyPalette(cur.palette || ""); lsSet("fcm.league", cur.id);
    var dp = state.deep; state.deep = null;
    // From the nav bar on a public page: ?v=home|champs|cars|tracks|results|league
    if (dp && dp.v && !dp.c) { try { history.replaceState(null, "", location.pathname); } catch (e) {} var VW = { home: renderHome, sharing: renderSharing, champs: loadChamps, cars: renderCars, tracks: renderTracks, results: goResults, league: renderLeague }; (VW[dp.v] || startView)(); return; }
    if (dp && dp.l === cur.id && dp.c) { try { history.replaceState(null, "", location.pathname); } catch (e) {} openChamp(dp.c, dp.s ? { view: "season", sid: dp.s } : null); return; }
    startView();
  });
}
function renderLeaguePicker() {
  app.innerHTML = '<div class="card"><h2>Choose a league</h2>' +
    (state.leagues.length ? '<div class="list">' + state.leagues.map(function (l) {
      return '<button type="button" class="item" data-lg="' + esc(l.id) + '"><span>' + esc(l.name) + "</span></button>";
    }).join("") + "</div>" : '<p class="muted">' + (state.owner ? "No leagues yet. Create the first one below." : "This login is not an admin of any league yet. Ask a league admin to add you.") + "</p>") + "</div>" +
    (state.owner ? '<div class="card"><h3 style="margin-top:0">New league</h3><div class="row"><div class="field grow"><label for="nln">League name</label><input id="nln" type="text"></div><button class="primary" id="nlgo" type="button">Create league</button></div><div class="msg" id="nlm"></div></div>' : "");
  app.querySelectorAll("[data-lg]").forEach(function (b) { b.addEventListener("click", function () { loadLeagues(b.dataset.lg); }); });
  var go = $("#nlgo");
  if (go) go.addEventListener("click", function () {
    var n = $("#nln").value.trim(); if (!n) { msg($("#nlm"), "Type a name first.", "err"); return; }
    sb.rpc("create_league", { league_name: n, league_slug: null }).then(function (x) {
      if (x.error) { msg($("#nlm"), dbError(x.error), "err"); return; }
      loadLeagues(x.data);
    });
  });
}
/* ---------- home: what needs doing, at a glance ---------- */
// A per-login choice kept on the login itself (user metadata), so it follows the admin to any device. On unless switched off.
function startView() { renderHome(); }
// Home is the league's public page (the final product everyone sees). It carries the admin shortcuts for signed-in admins.
