/* League settings: General, test logins, league profile and the Admins page. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

// A plain name such as "tester1" becomes tester1@example.com. Supabase needs an email-shaped sign-in; this one never receives mail.
function loginEmail(v) { v = String(v || "").trim().toLowerCase(); return v && v.indexOf("@") < 0 ? v.replace(/\s+/g, "") + "@example.com" : v; }
function randomPassword() {
  var a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "", r = new Uint32Array(12);
  (window.crypto || window.msCrypto).getRandomValues(r); for (var i = 0; i < r.length; i++) out += a[r[i] % a.length]; return out;
}
// A second client does the sign-up so this admin stays signed in as themselves.
function createTestLogin() {
  var m = $("#tlm"), email = loginEmail($("#tle").value), pw = $("#tlp").value;
  if (!email || email.indexOf("@") < 1) { msg(m, "Type a username first.", "err"); return; }
  if (pw.length < 8) { msg(m, "The password needs at least 8 characters.", "err"); return; }
  var b = $("#tlgo"); b.disabled = true; msg(m, "Creating…");
  var c2 = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  c2.auth.signUp({ email: email, password: pw, options: { data: { must_change_password: $("#tlchg").checked } } }).then(function (r) {
    // With Confirm email off, Supabase says so outright when the login already exists; carry on and just add it.
    if (r.error && /already (been )?registered|user_already_exists|already exists/i.test((r.error.message || "") + " " + (r.error.code || ""))) r = { data: { user: { identities: [] }, session: null }, error: null };
    if (r.error) { b.disabled = false; var em = r.error.message || "", why = /not allowed|disabled/i.test(em) ? "Sign-ups are switched off in Supabase. Turn them on under Authentication > Sign In / Providers > Allow new users to sign up."
      : /rate limit/i.test(em) ? "Supabase has hit its email limit because Confirm email is switched on, so it tried to send a confirmation message. Turn Confirm email off under Authentication > Sign In / Providers > Email, then wait up to an hour and try again."
      : /invalid/i.test(em) ? em + ". Supabase only accepts addresses on a domain that can receive mail, so the made-up domain was refused."
      : em;
    msg(m, why, "err"); return; }
    var u = r.data && r.data.user, existed = u && u.identities && u.identities.length === 0, needsConfirm = !(r.data && r.data.session);
    var own = (document.querySelector("input[name=tlw]:checked") || {}).value === "own", base = email.replace(/@example\.com$/, "").replace(/@.*$/, "");
    (own ? sb.rpc("create_league_for", { league_name: base + " league", league_slug: null, admin_email: email })
         : sb.rpc("add_league_admin", { lid: adminLid(), admin_email: email })).then(function (x) {
      b.disabled = false;
      if (x.error) { msg(m, dbError(x.error) + (own && /does not exist|schema cache/i.test(x.error.message || "") ? " (has migration 021 been run?)" : ""), "err"); return; }
      if (own) sb.from("leagues").select("*").order("name", { ascending: true }).then(function (lr) { if (!lr.error) state.leagues = lr.data || state.leagues; });
      $("#tle").value = ""; $("#tlp").value = randomPassword();
      var kind = existed || needsConfirm ? "err" : "ok", txt = (existed ? "That email already had a login, so it was only added as an admin. Its password is unchanged." : (own ? "Their own league \"" + base + " league\" was created. " : "") + "Created " + email + " (sign in with " + (email.slice(-12) === "@example.com" ? email.slice(0, -12) : email) + ") with password " + pw + ". Copy it now; it is not shown again.") +
        (needsConfirm && !existed ? " Supabase is asking for email confirmation, so this login cannot sign in until it is confirmed. To skip that for test logins, turn off Confirm email under Authentication > Sign In / Providers > Email." : "");
      refreshAdmins(); setTimeout(function () { var mm = $("#tlm"); if (mm) msg(mm, txt, kind); }, 50);
    });
  });
}
function renderLeague() { renderLeagueBody("g"); }
function renderLeagueAdmins() { renderLeagueBody("a"); }
function renderLeaguePoints() { loadLeaguePts(renderLeaguePointsBody); }
function renderLeaguePointsBody() {
  app.innerHTML = navHtml("l", "p") +
    '<div class="card"><h2>Points systems</h2><p class="muted" style="margin:0 0 8px">Saved for the whole league. Pick one for a championship and it is copied there, so changing it here never changes a running championship.</p><div class="list">' +
    (state.lpts.length ? state.lpts.map(function (x) { return '<button type="button" class="item" data-lpp="' + esc(x.id) + '"><span>' + esc(x.name) + '</span></button>'; }).join("") : '<p class="muted">None yet.</p>') + "</div>" +
    '<div class="row" style="margin-top:10px"><div class="field grow"><label for="lplib">Add from</label><select id="lplib">' + fromOpts([], state.master) + '</select></div><button class="primary" id="lpadd" type="button">Add points system</button></div><div id="lprev" class="muted" style="margin-top:8px"></div><div class="msg" id="lpm"></div></div>';
  bindNav();
  $("#lpadd").addEventListener("click", addLeaguePoints);
  $("#lplib").addEventListener("change", function () { showPointsPreview($("#lplib").value, $("#lprev")); });
  app.querySelectorAll("[data-lpp]").forEach(function (b) { b.addEventListener("click", function () { state.pscope = "league"; state.nav = { view: "points", pid: b.dataset.lpp }; renderPoints(b.dataset.lpp); }); });
}
/* The Admins card and the owner's test-login card. Used by League settings and by the owner's Admin page, which can aim them at any league. */
function adminLid() { return state.adminPage ? state.adminPage.lid : state.league.id; }
function adminLeagueName() { return state.adminPage ? state.adminPage.name : (state.league && state.league.name) || ""; }
function refreshAdmins() { if (state.adminPage) renderAdminPage(state.adminPage.tab); else renderLeagueAdmins(); }
function adminToolsHtml() {
  var lg = { name: adminLeagueName() };
  return '<div class="card"><h2>Admins</h2><div id="ladmins" class="muted">Loading…</div>' +
    '<h3>Add an admin</h3><p class="muted" style="margin:0 0 6px">They need a login first: create it in Supabase under Authentication, Users. Then enter the same email here.</p>' +
    '<div class="row"><div class="field grow"><label for="lae">Email or username</label><input id="lae" type="text" autocapitalize="none" autocomplete="off"></div><button id="laadd" type="button">Add admin</button></div><div class="msg" id="lam"></div></div>' +
    (state.owner ? '<div class="card"><h2>Create a test login</h2><p class="muted" style="margin:0 0 8px">Makes a new sign-in and gives it a league to work in, in one step, so someone else can test. Just type a name such as tester1. Behind the scenes it becomes tester1@example.com, which is only used to sign in and never receives mail. You can type a full email instead.</p>' +
    '<div class="row" style="align-items:flex-end"><div class="field grow"><label for="tle">Username</label><input id="tle" type="text" autocomplete="off" placeholder="tester1"></div>' +
    '<div class="field"><label for="tlp">Password</label><input id="tlp" type="text" autocomplete="off" value="' + esc(randomPassword()) + '" style="width:190px"></div>' +
    '<button type="button" id="tlnew" title="Make another password">New password</button></div>' +
    '<div style="margin-top:10px"><span class="lbl">Where should they work?</span>' +
    '<label style="display:flex;align-items:center;gap:6px;margin-top:4px"><input type="radio" name="tlw" value="here" checked> In this league (' + esc(lg.name || "") + '), alongside you</label>' +
    '<label style="display:flex;align-items:center;gap:6px;margin-top:4px"><input type="radio" name="tlw" value="own"> In a new empty league of their own, which no one else can see</label></div>' +
    '<label style="display:flex;align-items:center;gap:6px;margin-top:10px"><input type="checkbox" id="tlchg" checked> They must choose their own password the first time they sign in</label>' +
    '<div class="row" style="margin-top:8px"><button class="primary" id="tlgo" type="button">Create login</button></div><div class="msg" id="tlm"></div></div>' : "") ;
}
function loadAdmins() {
  sb.rpc("list_league_admins", { lid: adminLid() }).then(function (r) {
    var el = $("#ladmins");
    if (r.error) { el.className = "err"; el.textContent = dbError(r.error) + " (has migration 008 been run?)"; return; }
    el.className = "";
    el.innerHTML = r.data.map(function (a) {
      var me = state.user && a.user_id === state.user.id;
      return '<div class="row" style="justify-content:space-between;align-items:center;margin:4px 0"><span>' + esc(a.email) + (me ? ' <span class="pill">you</span>' : "") + "</span>" +
        (me ? "" : '<span><button type="button" data-ladel="' + esc(a.user_id) + '">Remove from league</button>' + (state.owner ? ' <button type="button" class="danger" data-ladelog="' + esc(a.user_id) + '">Delete login</button>' : "") + "</span>") + "</div>";
    }).join("");
    el.querySelectorAll("[data-ladelog]").forEach(function (b) { b.addEventListener("click", function () {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Click again to delete the whole login"; setTimeout(function () { b.dataset.armed = ""; b.textContent = "Delete login"; }, 6000); return; }
      sb.rpc("delete_login", { uid: b.dataset.ladelog }).then(function (x) {
        if (x.error) { msg($("#lam"), dbError(x.error) + (/does not exist|schema cache/i.test(x.error.message || "") ? " (has migration 024 been run?)" : ""), "err"); return; }
        msg($("#lam"), "The login was deleted.", "ok"); loadAdmins();
      });
    }); });
    el.querySelectorAll("[data-ladel]").forEach(function (b) { b.addEventListener("click", function () {
      sb.rpc("remove_league_admin", { lid: adminLid(), uid: b.dataset.ladel }).then(function (x) { if (x.error) msg($("#lam"), dbError(x.error), "err"); else loadAdmins(); });
    }); });
  });
}
function bindAdminTools() {
  loadAdmins();
  if ($("#tlnew")) $("#tlnew").addEventListener("click", function () { $("#tlp").value = randomPassword(); });
  if ($("#tlgo")) $("#tlgo").addEventListener("click", createTestLogin);
  $("#laadd").addEventListener("click", function () {
    var e = loginEmail($("#lae").value); if (!e) { msg($("#lam"), "Type an email or username first.", "err"); return; }
    sb.rpc("add_league_admin", { lid: adminLid(), admin_email: e }).then(function (x) {
      if (x.error) { msg($("#lam"), dbError(x.error), "err"); return; }
      $("#lae").value = ""; msg($("#lam"), "Added.", "ok"); loadAdmins();
    });
  });
}
function renderLeagueBody(sub) {
  state.adminPage = null;
  var lg = state.league || {}, tz = lg.timezone || browserZone() || "";
  var gen = sub !== "a";
  app.innerHTML = navHtml("l", gen ? "g" : "a") + (gen ?
    '<div class="card"><h2>League settings</h2><div class="field"><label for="ln">League name</label><input id="ln" value="' + esc(lg.name || "") + '"></div>' +
    '<div class="field" style="margin-top:8px"><label for="lz">League time zone</label><select id="lz">' + zoneOpts(tz, "Not set") + '</select></div>' +
    '<div class="field" style="margin-top:8px"><label for="lu">Units of measurement</label><select id="lu">' + opts([["imperial", "Imperial (hp, lb-ft, lbs, mi)"], ["metric", "Metric (kW, N·m, kg, km)"]], lg.units || "", "Not set") + '</select></div>' +
    '<div class="field" style="margin-top:8px"><label for="lpal">Colour palette</label><select id="lpal">' + PALETTES.map(function (o) { return '<option value="' + o[0] + '"' + ((lg.palette || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></div>' +
    '<p class="muted" style="margin:6px 0 0">' + (lg.timezone ? "New championships start with this time zone. Viewers still see every time in their own local time." : "Not saved yet. The time zone shown is detected from this browser; click Save to keep it.") + '</p>' +
    '<div class="row" style="margin-top:8px"><button class="primary" id="lsave" type="button">Save</button><button type="button" data-cancel="reset">Cancel</button></div><div class="msg" id="lm"></div></div>' +
    (gen ? profileCardHtml(lg) : "") + (gen ? pagePublishHtml("l", lg) : "") +
    (state.owner ? '<div class="card"><h3 style="margin-top:0">Delete this league</h3><p class="muted" style="margin:0 0 8px">This permanently deletes the league with all of its championships, seasons, rounds, races, results, drivers, points systems and builds. Logins are not deleted. It cannot be undone. Type the league name to confirm.</p>' +
      '<div class="row"><div class="field grow"><label for="ldn">League name</label><input id="ldn" autocomplete="off"></div><button class="danger" id="ldel" type="button" disabled>Delete league</button></div><div class="msg" id="ldm"></div></div>' : "") :
    adminToolsHtml());
  bindNav();
  if (gen && $("#ldel")) {
    $("#ldn").addEventListener("input", function () { $("#ldel").disabled = $("#ldn").value.trim() !== (state.league.name || ""); });
    $("#ldel").addEventListener("click", function () {
      var m = $("#ldm"), id = state.league.id; $("#ldel").disabled = true; msg(m, "Deleting…");
      sb.rpc("delete_league", { lid: id }).then(function (x) {
        if (x.error) { msg(m, dbError(x.error) + (/does not exist|schema cache/i.test(x.error.message || "") ? " (has migration 025 been run?)" : ""), "err"); $("#ldel").disabled = false; return; }
        try { window.localStorage.removeItem("fcm.league"); } catch (e) {}
        state.league = null; state.sel = null; applyPalette("");
        loadLeagues();
      });
    });
  }
  if (gen) $("#lpal").addEventListener("change", function () { applyPalette($("#lpal").value); });
  if (gen && $("#lpsave")) $("#lpsave").addEventListener("click", saveProfile);
  if (gen) $("#lsave").addEventListener("click", function () {
    var row = { name: nul($("#ln").value), timezone: nul($("#lz").value), units: nul($("#lu").value), palette: nul($("#lpal").value) };
    if (!row.name) { msg($("#lm"), "A league needs a name.", "err"); return; }
    sb.from("leagues").update(row).eq("id", state.league.id).then(function (r) {
      if (r.error) { msg($("#lm"), dbError(r.error), "err"); return; }
      state.league = Object.assign({}, state.league, row);
      state.leagues = state.leagues.map(function (l) { return l.id === state.league.id ? state.league : l; });
      applyPalette(row.palette || "");
      msg($("#lm"), "Saved.", "ok");
    });
  });
  if (!gen) bindAdminTools();
}
/* ---------- league profile (shown on the public league page) ---------- */
var SOCIALS = [["website", "Website"], ["discord", "Discord invite"], ["youtube", "YouTube"], ["twitch", "Twitch"], ["x", "X"], ["instagram", "Instagram"]];
function profileCardHtml(lg) {
  var L = lg.links || {};
  return '<div class="card"><h2>League profile</h2><p class="muted" style="margin:0 0 8px">Shown on the public league page. Everything here is optional; blank items are left out.</p>' +
    '<div class="field"><label for="lptag">Tagline</label><input id="lptag" maxlength="120" placeholder="Eg Sunday night GT racing, all skill levels" value="' + esc(lg.tagline || "") + '"></div>' +
    '<div class="field" style="margin-top:8px"><label for="lpabout">About the league</label><textarea id="lpabout" rows="4" maxlength="2000">' + esc(lg.about || "") + '</textarea></div>' +
    '<div class="field" style="margin-top:8px"><label for="lpjoin">How to join</label><textarea id="lpjoin" rows="3" maxlength="1000" placeholder="Eg Join our Discord, then add the gamertag NBR Admin">' + esc(lg.join_text || "") + '</textarea></div>' +
    '<div class="field" style="margin-top:8px"><label for="lpban">Banner image link</label><input id="lpban" type="url" autocapitalize="none" placeholder="https://… (a wide image, shown at the top of the page)" value="' + esc(lg.banner_url || "") + '"></div>' +
    '<div class="two" style="margin-top:8px">' + SOCIALS.map(function (o) { return '<div class="field"><label for="lps-' + o[0] + '">' + o[1] + '</label><input id="lps-' + o[0] + '" type="url" autocapitalize="none" placeholder="https://…" value="' + esc(L[o[0]] || "") + '"></div>'; }).join("") + "</div>" +
    '<div class="row" style="margin-top:8px"><button class="primary" id="lpsave" type="button">Save profile</button><button type="button" data-cancel="reset">Cancel</button></div><div class="msg" id="lpm"></div></div>';
}
function saveProfile() {
  var m = $("#lpm"), links = {}, bad = null, url = function (v) { v = String(v || "").trim(); return v && !/^https?:\/\/\S+$/i.test(v) ? null : v; };
  SOCIALS.forEach(function (o) { var v = url($("#lps-" + o[0]).value); if (v === null) bad = o[1]; else if (v) links[o[0]] = v; });
  var ban = url($("#lpban").value); if (ban === null) bad = "Banner image link";
  if (bad) { msg(m, bad + " must be a full link starting with https://", "err"); return; }
  var row = { tagline: nul($("#lptag").value), about: nul($("#lpabout").value), join_text: nul($("#lpjoin").value), banner_url: ban || null, links: links };
  sb.from("leagues").update(row).eq("id", state.league.id).then(function (r) {
    if (r.error) { msg(m, dbError(r.error) + (/schema cache|column/i.test(r.error.message || "") ? " (has migration 028 been run?)" : ""), "err"); return; }
    state.league = Object.assign({}, state.league, row);
    state.leagues = state.leagues.map(function (l) { return l.id === state.league.id ? state.league : l; });
    msg(m, "Saved. The public league page shows this now.", "ok");
  });
}
