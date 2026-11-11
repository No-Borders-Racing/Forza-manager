/* The owner's Admin page: a counts table for every league, the admin tools for any league, and the site's health. Owner only. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

var ADMIN_TABS = [["o", "Site overview"], ["a", "Admins and logins"], ["h", "Health and usage"]];
state.adminPage = null;
state.readerTest = null;

function adminWhen(iso) {
  if (!iso) return "";
  var d = new Date(iso), now = new Date(), days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  var t = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  if (days <= 0) return "Today, " + t;
  if (days === 1) return "Yesterday, " + t;
  if (days < 30) return days + " days ago";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(d);
}
function adminMb(bytes) { return Math.max(1, Math.round(bytes / 1048576)); }

function renderAdminPage(tab) {
  if (!state.owner) { app.innerHTML = navHtml("h") + '<div class="card err">The Admin page is for the site owner.</div>'; bindNav(); return; }
  var lg = state.league || {};
  state.adminPage = Object.assign({ lid: lg.id, name: lg.name || "" }, state.adminPage || {}, { tab: tab || "o" });
  var t = state.adminPage.tab;
  app.innerHTML = navHtml("adm") + '<h2 style="font-size:20px;margin:0 0 10px">Admin</h2>' +
    '<div class="row" role="group" aria-label="Admin" style="margin:0 0 12px;gap:8px">' + ADMIN_TABS.map(function (x) { return '<button type="button" data-atab="' + x[0] + '" aria-pressed="' + (x[0] === t ? "true" : "false") + '"' + (x[0] === t ? ' class="primary"' : "") + ">" + x[1] + "</button>"; }).join("") + '</div><div id="abody"><p class="muted">Loading…</p></div>';
  bindNav();
  app.querySelectorAll("[data-atab]").forEach(function (b) { b.addEventListener("click", function () { renderAdminPage(b.dataset.atab); }); });
  if (t === "o") adminOverview(); else if (t === "a") adminAdmins(); else adminHealth();
}

/* Site overview: one row of counts per league. No names, emails or sign-in details. */
function adminOverview() {
  sb.rpc("owner_site_overview").then(function (r) {
    var box = $("#abody"); if (!box) return;
    if (r.error) { box.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + (/does not exist|schema cache/i.test(r.error.message || "") ? " (has migration 035 been run?)" : "") + "</div>"; return; }
    var rows = r.data || [];
    box.innerHTML = '<div class="card"><h2>Leagues (' + rows.length + ')</h2><div style="overflow-x:auto"><table class="zebra" style="border-collapse:collapse;width:100%"><thead><tr><th style="text-align:left">League</th><th>Admins</th><th>Championships</th><th>Drivers</th><th style="text-align:left">Last activity</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) { return "<tr><td><b>" + esc(x.name) + '</b></td><td style="text-align:center">' + x.admins + '</td><td style="text-align:center">' + x.championships + '</td><td style="text-align:center">' + x.drivers + '</td><td>' + esc(adminWhen(x.last_activity)) + '</td><td style="text-align:right"><button class="danger" type="button" data-adel="' + esc(x.league_id) + '">Delete</button></td></tr>'; }).join("") +
      '</tbody></table></div></div><div id="adelbox"></div>';
    box.querySelectorAll("[data-adel]").forEach(function (b) {
      b.addEventListener("click", function () {
        var row = rows.filter(function (x) { return x.league_id === b.dataset.adel; })[0]; if (row) adminDeleteLeague(row);
      });
    });
  });
}

/* Delete a whole league from the overview. The owner must type the league's name first. */
function adminDeleteLeague(row) {
  var box = $("#adelbox"); if (!box) return;
  box.innerHTML = '<div class="card"><h3 style="margin-top:0">Delete ' + esc(row.name) + '?</h3><p class="muted" style="margin:0 0 8px">This permanently deletes the league with all of its ' + row.championships + ' championship(s), ' + row.drivers + ' driver(s) and ' + row.results + ' result(s), plus its seasons, rounds, races, points systems and builds. Logins are not deleted. It cannot be undone. Type the league name to confirm.</p>' +
    '<div class="row"><div class="field grow"><label for="adn">League name</label><input id="adn" autocomplete="off"></div><button class="danger" id="adgo" type="button" disabled>Delete league</button><button type="button" id="adno">Cancel</button></div><div class="msg" id="adm"></div></div>';
  var inp = $("#adn"), go = $("#adgo"); inp.focus();
  box.scrollIntoView && box.scrollIntoView({ block: "nearest" });
  inp.addEventListener("input", function () { go.disabled = inp.value.trim() !== row.name; });
  $("#adno").addEventListener("click", function () { box.innerHTML = ""; });
  go.addEventListener("click", function () {
    go.disabled = true; msg($("#adm"), "Deleting…");
    sb.rpc("delete_league", { lid: row.league_id }).then(function (x) {
      if (x.error) { msg($("#adm"), dbError(x.error) + (/does not exist|schema cache/i.test(x.error.message || "") ? " (has migration 025 been run?)" : ""), "err"); go.disabled = false; return; }
      state.leagues = (state.leagues || []).filter(function (l) { return l.id !== row.league_id; });
      if (state.league && state.league.id === row.league_id) { state.league = null; state.sel = null; try { window.localStorage.removeItem("fcm.league"); } catch (e) {} applyPalette(""); }
      if (state.adminPage && state.adminPage.lid === row.league_id) state.adminPage.lid = null;
      adminOverview();
    });
  });
}

/* Admins and logins: the League settings tools, aimed at whichever league is chosen here. */
function adminAdmins() {
  var P = state.adminPage, box = $("#abody");
  if (!state.leagues || !state.leagues.length) { box.innerHTML = '<p class="muted">No leagues yet.</p>'; return; }
  if (!state.leagues.some(function (l) { return l.id === P.lid; })) { P.lid = state.leagues[0].id; P.name = state.leagues[0].name; }
  box.innerHTML = '<div class="card"><div class="row" style="align-items:flex-end"><div class="field" style="min-width:240px"><label for="alg">League</label><select id="alg">' +
    state.leagues.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === P.lid ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("") + '</select></div><span class="muted">Everything below applies to the league chosen here.</span></div></div>' + adminToolsHtml();
  $("#alg").addEventListener("change", function () {
    var l = state.leagues.filter(function (x) { return x.id === $("#alg").value; })[0]; if (!l) return;
    P.lid = l.id; P.name = l.name; adminAdmins();
  });
  bindAdminTools();
}

/* Health and usage: database size and counts, and a check that the screenshot reader answers. */
function adminHealth() {
  sb.rpc("owner_db_stats").then(function (r) {
    var box = $("#abody"); if (!box) return;
    if (r.error) { box.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + (/does not exist|schema cache/i.test(r.error.message || "") ? " (has migration 035 been run?)" : "") + "</div>"; return; }
    var d = r.data || {}, pct = d.limit_bytes ? Math.min(100, d.db_bytes / d.limit_bytes * 100) : 0;
    function kv(k, v) { return '<div class="row" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)"><span>' + esc(k) + "</span><b>" + esc(v) + "</b></div>"; }
    box.innerHTML = '<div class="card"><h2>Database</h2><div class="row" style="justify-content:space-between"><span>Size</span><b>' + adminMb(d.db_bytes) + " MB of " + adminMb(d.limit_bytes) + ' MB</b></div>' +
      '<div style="height:10px;background:var(--line);border-radius:5px;overflow:hidden;margin:6px 0"><div style="height:100%;width:' + pct.toFixed(1) + "%;background:" + (pct >= 80 ? "var(--err, #ff8a7a)" : "var(--accent)") + '"></div></div>' +
      '<p class="muted" style="margin:0 0 8px">' + (pct >= 80 ? '<b class="err">Getting close to the free plan limit.</b> ' : "") + 'The free Supabase plan allows 500 MB.</p>' +
      kv("Leagues", d.leagues) + kv("Championships", d.championships) + kv("Rounds", d.rounds) + kv("Drivers", d.drivers) + kv("Results", d.results) + kv("Cars in the catalogue", d.cars) + "</div>" +
      '<div class="card"><h2>Screenshot reader</h2><div id="rdstat"></div><div class="row" style="margin-top:8px"><button class="primary" type="button" id="rdtest">Run a test</button></div>' +
      '<p class="muted" style="margin:8px 0 0">The test sends a short text-only request to check the key and model are accepted. It uses no image and touches no results. Google\'s remaining allowance cannot be read from here, so this shows only whether it answers and how fast.</p></div>';
    drawReaderStat();
    $("#rdtest").addEventListener("click", runReaderTest);
  });
}
function drawReaderStat() {
  var el = $("#rdstat"); if (!el) return; var t = state.readerTest;
  function kv(k, v, cls) { return '<div class="row" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)"><span>' + esc(k) + "</span><b" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(v) + "</b></div>"; }
  if (!t) { el.innerHTML = kv("Status", "Not tested yet"); return; }
  if (t.running) { el.innerHTML = kv("Status", "Testing…"); return; }
  el.innerHTML = t.ok ? kv("Status", "Working", "ok") + kv("Model", t.model || "") + kv("Answered in", t.secs + " s") + kv("Tested", adminWhen(t.at))
    : kv("Status", "Not working", "err") + '<p class="err" style="margin:6px 0 0">' + esc(t.error) + "</p>";
}
function runReaderTest() {
  var t0 = Date.now(), btn = $("#rdtest"); if (btn) btn.disabled = true;
  state.readerTest = { running: true }; drawReaderStat();
  sb.functions.invoke("read-results", { body: { ping: true } }).then(function (r) {
    function fail(m) { state.readerTest = { ok: false, error: m, at: new Date().toISOString() }; }
    if (r.error) {
      var c = r.error.context, st = c && c.status;
      return (c && typeof c.text === "function" ? c.text() : Promise.resolve("")).then(function (txt) {
        var j = null; try { j = JSON.parse(txt); } catch (e) {}
        fail(((j && (j.error || j.message)) || String(txt || "").slice(0, 200) || r.error.message) + (st ? " (status " + st + ")" : ""));
      });
    }
    var d = r.data || {};
    if (d.error || !d.ok) fail(d.error || "No answer came back."); else state.readerTest = { ok: true, model: d.model, secs: ((Date.now() - t0) / 1000).toFixed(1), at: new Date().toISOString() };
  }).catch(function (e) { state.readerTest = { ok: false, error: String(e && e.message || e), at: new Date().toISOString() }; }).then(function () {
    drawReaderStat(); var b = $("#rdtest"); if (b) b.disabled = false;
  });
}
