(function () {
  "use strict";
  var TZ = window.FCM_TZ, SCH = window.FCM_SCHEDULE, cfg = window.FCM_CONFIG;
  var app = document.getElementById("app");
  var PALETTES = [["", "Amber (default)"], ["rwb", "Red, white and blue"], ["rosso", "Rosso red"], ["gulf", "Gulf blue and orange"], ["brg", "British racing green"], ["papaya", "Papaya orange"], ["mono", "Silver and black"]];
  function applyPalette(k) { if (k) document.documentElement.setAttribute("data-palette", k); else document.documentElement.removeAttribute("data-palette"); try { localStorage.setItem("fcm.palette", k || ""); } catch (e) {} }
  try { applyPalette(localStorage.getItem("fcm.palette") || ""); } catch (e) {}
  // Footer: where you are, kept current without touching every screen.
  setInterval(function () {
    var el = document.getElementById("ftloc"); if (!el) return;
    var lg = state.league && state.league.name, ch = state.sel && state.sel.champ && state.sel.champ.name;
    if (ch && !document.querySelector("#app [data-tab]")) ch = null;
    var t = lg ? (ch ? lg + " · " + ch : lg) : "";
    if (el.dataset.t !== t) { el.dataset.t = t; el.innerHTML = t ? "<b>" + esc(lg) + "</b>" + (ch ? " · " + esc(ch) : "") : ""; }
  }, 400);
  // Cancel buttons next to every Save: "reset" redraws the screen from saved data, "back" returns to the previous page.
  app.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-cancel]");
    if (!b) return;
    var k = b.dataset.cancel;
    if (k === "reset" && document.getElementById("lsave")) applyPalette((state.league || {}).palette || "");
    if (k === "drivers") { renderDriversBody(); return; }
    if (k === "back") { var lb = document.getElementById("lpback"); if (lb) { renderLeaguePoints(); return; } state.nav = { view: "champ" }; renderCurrent(); return; }
    if (document.getElementById("lsave")) { renderLeague(); return; }
    renderCurrent();
  });
  var sb = window.supabase.createClient(cfg.url, cfg.key);
  var zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).slice();
  if (zones.indexOf("UTC") < 0) zones.unshift("UTC");
  var viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  var plans = {}; // preview of generated rounds per season, waiting for the admin to confirm
  var armed = null; // key of the delete button that has been clicked once

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function opts(list, cur, blank) {
    return '<option value="">' + esc(blank) + "</option>" + list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(l) + "</option>";
    }).join("");
  }
  // Time zone dropdown: popular zones first, then every other zone. Values stay as IANA names
  // (needed for daylight saving); the label shows today's offset from GMT.
  var COMMON = [
    ["Australia/Sydney", "Sydney, Australia"], ["Australia/Melbourne", "Melbourne, Australia"], ["Australia/Brisbane", "Brisbane, Australia"],
    ["Australia/Adelaide", "Adelaide, Australia"], ["Australia/Perth", "Perth, Australia"], ["Pacific/Auckland", "Auckland, New Zealand"],
    ["America/New_York", "US Eastern (New York)"], ["America/Chicago", "US Central (Chicago)"], ["America/Denver", "US Mountain (Denver)"],
    ["America/Los_Angeles", "US Pacific (Los Angeles)"], ["America/Toronto", "Toronto, Canada"], ["Europe/London", "London, UK"],
    ["Europe/Berlin", "Central Europe (Berlin)"], ["Asia/Tokyo", "Tokyo, Japan"], ["Asia/Singapore", "Singapore"], ["UTC", "UTC"]
  ];
  function gmt(tz) {
    var m = Math.round(TZ.offsetMs(Date.now(), tz) / 60000), a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
    return "GMT" + (m < 0 ? "-" : "+") + h + (mm ? ":" + (mm < 10 ? "0" : "") + mm : "");
  }
  function zoneOpts(cur, blank) {
    function one(v, label) { return '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(label + " · " + gmt(v)) + "</option>"; }
    var common = COMMON.filter(function (c) { return zones.indexOf(c[0]) >= 0; });
    var names = common.map(function (c) { return c[0]; });
    return '<option value="">' + esc(blank) + "</option>" +
      '<optgroup label="Common">' + common.map(function (c) { return one(c[0], c[1]); }).join("") + "</optgroup>" +
      '<optgroup label="All other time zones">' + zones.filter(function (z) { return names.indexOf(z) < 0; }).map(function (z) { return one(z, z.replace(/_/g, " ")); }).join("") + "</optgroup>";
  }
  function browserZone() {
    try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z && zones.indexOf(z) >= 0 ? z : null; } catch (e) { return null; }
  }
  function msg(el, text, kind) { if (el) { el.className = "msg " + (kind || ""); el.textContent = text || ""; } }
  function nul(v) { v = (v || "").trim(); return v === "" ? null : v; }
  function numOrNull(v) { v = (v || "").trim(); return v === "" || !isFinite(Number(v)) ? null : Number(v); }
  function dbError(e) { return e && e.message ? e.message : "Something went wrong."; }

  var state = { user: null, admin: false, champs: [], sel: null };

  /* ---------- sign in ---------- */
  function showLogin(note) {
    $("#who").textContent = "";
    app.innerHTML = '<div class="card" style="max-width:380px;margin:40px auto"><h2>Sign in</h2>' +
      '<div class="field"><label for="em">Email or username</label><input id="em" type="text" autocapitalize="none" autocomplete="username"></div>' +
      '<div class="field" style="margin-top:8px"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password"></div>' +
      '<div class="msg err" id="lm">' + esc(note || "") + '</div><button class="primary" id="go" type="button">Sign in</button></div>';
    var go = function () {
      var b = $("#go"); b.disabled = true; msg($("#lm"), "Signing in…");
      sb.auth.signInWithPassword({ email: loginEmail($("#em").value), password: $("#pw").value }).then(function (r) {
        b.disabled = false;
        if (r.error) { msg($("#lm"), r.error.message, "err"); return; }
        boot();
      });
    };
    $("#go").addEventListener("click", go);
    $("#pw").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }
  function boot() {
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s) { showLogin(); return; }
      state.user = s.user;
      $("#who").innerHTML = esc(s.user.email) + ' · <button id="out" type="button">Sign out</button>';
      $("#out").addEventListener("click", function () { sb.auth.signOut().then(function () { state.admin = false; showLogin(); }); });
      sb.rpc("is_admin").then(function (a) {
        if (a.error) { app.innerHTML = '<div class="card err">Could not check admin access: ' + esc(a.error.message) + "</div>"; return; }
        state.admin = a.data === true;
        if (!state.admin) { app.innerHTML = '<div class="card"><h2>Signed in, but not an admin</h2><p>This login is not in the admins list, so it cannot change anything. Add it to the <code>admins</code> table in Supabase.</p></div>'; return; }
        sb.rpc("is_owner").then(function (o) {
          state.owner = o.data === true;
          loadLeagues();
        });
      });
    });
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  // Each league is its own folder: the admin works inside one league at a time.
  function loadLeagues(pick) {
    sb.from("leagues").select("*").order("name", { ascending: true }).then(function (r) {
      if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + " Has migration 008 (leagues) been run?</div>"; return; }
      state.leagues = r.data || [];
      var want = pick || lsGet("fcm.league"), cur = state.leagues.filter(function (l) { return l.id === want; })[0] || (state.leagues.length === 1 ? state.leagues[0] : null);
      if (!cur) { renderLeaguePicker(); return; }
      state.league = cur; applyPalette(cur.palette || ""); lsSet("fcm.league", cur.id); loadChamps();
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

  /* ---------- championships ---------- */
  function loadChamps() {
    sb.from("championships").select("id,name,status,visibility").eq("league_id", state.league.id).order("created_at", { ascending: false }).then(function (r) {
      if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + "</div>"; return; }
      state.champs = r.data; state.sel = null;
      renderChampList();
    });
  }
  // Top bar: Championships on the left, League settings hard right. Inside League settings a second row holds
  // General, Points systems, Drivers and Admins.
  function navHtml(active, sub) {
    var h = '<div class="row" style="margin-bottom:12px"><button type="button" id="nav-c"' + (active === "c" ? ' class="primary"' : "") + '>Championships</button><button type="button" id="nav-k"' + (active === "k" ? ' class="primary"' : "") + '>Cars</button><button type="button" id="nav-t"' + (active === "t" ? ' class="primary"' : "") + '>Tracks</button>' +
      '<button type="button" id="nav-l" style="margin-left:auto"' + (active === "l" ? ' class="primary"' : "") + '>League settings</button></div>';
    if (active === "l") h += '<div class="row" style="margin:-4px 0 12px">' + [["g", "General"], ["p", "Points systems"], ["d", "Drivers"], ["a", "Admins"]].map(function (t) {
      return '<button type="button" id="sub-' + t[0] + '"' + (t[0] === sub ? ' class="primary"' : "") + ">" + t[1] + "</button>";
    }).join("") + "</div>";
    return h;
  }
  function bindNav() {
    var go = { "nav-c": loadChamps, "nav-k": renderCars, "nav-t": renderTracks, "nav-l": renderLeague, "sub-g": renderLeague, "sub-p": renderLeaguePoints, "sub-d": renderDrivers, "sub-a": renderLeagueAdmins };
    Object.keys(go).forEach(function (id) { var b = document.getElementById(id); if (b) b.addEventListener("click", go[id]); });
  }
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
    c2.auth.signUp({ email: email, password: pw }).then(function (r) {
      if (r.error) { b.disabled = false; msg(m, /not allowed|disabled/i.test(r.error.message || "") ? "Sign-ups are switched off in Supabase. Turn them on under Authentication > Sign In / Providers > Allow new users to sign up." : r.error.message, "err"); return; }
      var u = r.data && r.data.user, existed = u && u.identities && u.identities.length === 0, needsConfirm = !(r.data && r.data.session);
      sb.rpc("add_league_admin", { lid: state.league.id, admin_email: email }).then(function (x) {
        b.disabled = false;
        if (x.error) { msg(m, dbError(x.error), "err"); return; }
        $("#tle").value = ""; $("#tlp").value = randomPassword();
        var kind = existed || needsConfirm ? "err" : "ok", txt = (existed ? "That email already had a login, so it was only added as an admin. Its password is unchanged." : "Created " + email + " (sign in with " + (email.slice(-12) === "@example.com" ? email.slice(0, -12) : email) + ") with password " + pw + ". Copy it now; it is not shown again.") +
          (needsConfirm && !existed ? " Supabase is asking for email confirmation, so this login cannot sign in until it is confirmed. To skip that for test logins, turn off Confirm email under Authentication > Sign In / Providers > Email." : "");
        renderLeagueAdmins(); setTimeout(function () { var mm = $("#tlm"); if (mm) msg(mm, txt, kind); }, 50);
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
  function renderLeagueBody(sub) {
    var lg = state.league || {}, tz = lg.timezone || browserZone() || "";
    var gen = sub !== "a";
    app.innerHTML = navHtml("l", gen ? "g" : "a") + (gen ?
      '<div class="card"><h2>League settings</h2><div class="field"><label for="ln">League name</label><input id="ln" value="' + esc(lg.name || "") + '"></div>' +
      '<div class="field" style="margin-top:8px"><label for="lz">League time zone</label><select id="lz">' + zoneOpts(tz, "Not set") + '</select></div>' +
      '<div class="field" style="margin-top:8px"><label for="lu">Units of measurement</label><select id="lu">' + opts([["imperial", "Imperial (hp, lb-ft, lbs, mi)"], ["metric", "Metric (kW, N·m, kg, km)"]], lg.units || "", "Not set") + '</select></div>' +
      '<div class="field" style="margin-top:8px"><label for="lpal">Colour palette</label><select id="lpal">' + PALETTES.map(function (o) { return '<option value="' + o[0] + '"' + ((lg.palette || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></div>' +
      '<p class="muted" style="margin:6px 0 0">' + (lg.timezone ? "New championships start with this time zone. Viewers still see every time in their own local time." : "Not saved yet. The time zone shown is detected from this browser; click Save to keep it.") + '</p>' +
      '<div class="row" style="margin-top:8px"><button class="primary" id="lsave" type="button">Save</button><button type="button" data-cancel="reset">Cancel</button></div><div class="msg" id="lm"></div></div>' :
      '<div class="card"><h2>Admins</h2><div id="ladmins" class="muted">Loading…</div>' +
      '<h3>Add an admin</h3><p class="muted" style="margin:0 0 6px">They need a login first: create it in Supabase under Authentication, Users. Then enter the same email here.</p>' +
      '<div class="row"><div class="field grow"><label for="lae">Email</label><input id="lae" type="email"></div><button id="laadd" type="button">Add admin</button></div><div class="msg" id="lam"></div></div>' +
      '<div class="card"><h2>Create a test login</h2><p class="muted" style="margin:0 0 8px">Makes a new sign-in and adds it as an admin of this league in one step, so you can test as someone else. Just type a name such as tester1. Behind the scenes it becomes tester1@example.com, which is only used to sign in and never receives mail. You can type a full email instead.</p>' +
      '<div class="row" style="align-items:flex-end"><div class="field grow"><label for="tle">Username</label><input id="tle" type="text" autocomplete="off" placeholder="tester1"></div>' +
      '<div class="field"><label for="tlp">Password</label><input id="tlp" type="text" autocomplete="off" value="' + esc(randomPassword()) + '" style="width:190px"></div>' +
      '<button type="button" id="tlnew" title="Make another password">New password</button></div>' +
      '<div class="row" style="margin-top:8px"><button class="primary" id="tlgo" type="button">Create login</button></div><div class="msg" id="tlm"></div></div>');
    bindNav();
    if (gen) $("#lpal").addEventListener("change", function () { applyPalette($("#lpal").value); });
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
    function loadAdmins() {
      sb.rpc("list_league_admins", { lid: state.league.id }).then(function (r) {
        var el = $("#ladmins");
        if (r.error) { el.className = "err"; el.textContent = dbError(r.error) + " (has migration 008 been run?)"; return; }
        el.className = "";
        el.innerHTML = r.data.map(function (a) {
          var me = state.user && a.user_id === state.user.id;
          return '<div class="row" style="justify-content:space-between;align-items:center;margin:4px 0"><span>' + esc(a.email) + (me ? ' <span class="pill">you</span>' : "") + "</span>" +
            (me ? "" : '<button type="button" class="danger" data-ladel="' + esc(a.user_id) + '">Remove</button>') + "</div>";
        }).join("");
        el.querySelectorAll("[data-ladel]").forEach(function (b) { b.addEventListener("click", function () {
          sb.rpc("remove_league_admin", { lid: state.league.id, uid: b.dataset.ladel }).then(function (x) { if (x.error) msg($("#lam"), dbError(x.error), "err"); else loadAdmins(); });
        }); });
      });
    }
    if (!gen) loadAdmins();
    if (!gen) $("#tlnew").addEventListener("click", function () { $("#tlp").value = randomPassword(); });
    if (!gen) $("#tlgo").addEventListener("click", createTestLogin);
    if (!gen) $("#laadd").addEventListener("click", function () {
      var e = $("#lae").value.trim(); if (!e) { msg($("#lam"), "Type an email first.", "err"); return; }
      sb.rpc("add_league_admin", { lid: state.league.id, admin_email: e }).then(function (x) {
        if (x.error) { msg($("#lam"), dbError(x.error), "err"); return; }
        $("#lae").value = ""; msg($("#lam"), "Added.", "ok"); loadAdmins();
      });
    });
  }
  function renderChampList() {
    var lg = state.league;
    app.innerHTML = navHtml("c") + '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><h2 style="margin:0">' + esc(lg && lg.name ? lg.name : "League not named yet") + '</h2><span class="muted">League time zone: ' + esc(lg && lg.timezone ? lg.timezone : "not set") + '</span></div><div class="row">' + ((state.leagues || []).length > 1 || state.owner ? '<button type="button" id="switchbtn">Switch league</button>' : "") + '</div></div></div>' +
      '<div class="card"><h2>Championships</h2><div class="list">' +
      (state.champs.length ? state.champs.map(function (c) {
        return '<div style="display:flex;gap:6px;align-items:center"><button type="button" class="item" data-id="' + esc(c.id) + '"><span>' + esc(c.name) + '</span><span class="muted">' + esc(c.status) + (c.visibility ? " · " + esc(c.visibility) : " · visibility not set") + '</span></button><button type="button" class="danger" data-ldel="' + esc(c.id) + '">Delete</button></div>';
      }).join("") : '<p class="muted">None yet.</p>') + '</div><div id="ldelbox"></div></div>' +
      '<div class="card"><h3 style="margin-top:0">New championship</h3><div class="row"><div class="field grow"><label for="nn">Name</label><input id="nn" type="text"></div><button class="primary" id="nadd" type="button">Create</button></div><div class="msg" id="nm"></div>' +
      '<p class="muted">It starts as a draft. The time zone is filled in from the league settings, or from this browser if the league has none (you can change it on the championship page); every other setting is blank.</p></div>';
    app.querySelectorAll("button.item").forEach(function (b) { b.addEventListener("click", function () { openChamp(b.dataset.id); }); });
    app.querySelectorAll("[data-ldel]").forEach(function (b) { b.addEventListener("click", function () {
      var c = state.champs.filter(function (x) { return x.id === b.dataset.ldel; })[0], box = $("#ldelbox");
      box.innerHTML = '<div class="card" style="border-color:var(--err)"><p style="margin:0 0 8px">Permanently delete <b>' + esc(c.name) + '</b> with all of its seasons, rounds, races, points systems, classes and race format? It cannot be undone. Type its name to confirm.</p>' +
        '<div class="row"><div class="field grow"><label for="ldn">Championship name</label><input id="ldn" autocomplete="off"></div><button class="danger" id="ldgo" type="button" disabled>Delete</button><button id="ldno" type="button">Cancel</button></div><div class="msg" id="ldm"></div></div>';
      var inp = $("#ldn"); inp.focus();
      inp.addEventListener("input", function () { $("#ldgo").disabled = inp.value.trim() !== c.name; });
      $("#ldno").addEventListener("click", function () { box.innerHTML = ""; });
      $("#ldgo").addEventListener("click", function () {
        $("#ldgo").disabled = true; msg($("#ldm"), "Deleting…");
        sb.from("championships").delete().eq("id", c.id).then(function (r) {
          if (r.error) { msg($("#ldm"), dbError(r.error), "err"); $("#ldgo").disabled = false; return; }
          loadChamps();
        });
      });
    }); });
    bindNav();
    if ($("#switchbtn")) $("#switchbtn").addEventListener("click", renderLeaguePicker);
    $("#nadd").addEventListener("click", function () {
      var n = $("#nn").value.trim(); if (!n) { msg($("#nm"), "Type a name first.", "err"); return; }
      sb.from("championships").insert({ name: n, league_id: state.league.id, intended_timezone: (state.league && state.league.timezone) || browserZone() }).select("id").single().then(function (r) {
        if (r.error) { msg($("#nm"), dbError(r.error), "err"); return; }
        openChamp(r.data.id);
      });
    });
  }
  /* The championship's cars as plain labels, for the "Car used" choice beside a reference lap. Cheap: only the chosen cars are read. */
  function carOptLabels(cc, cars, builds) {
    var out = [];
    cc.forEach(function (x) { if (x.car_id) { var c = cars[x.car_id]; if (c) out.push(carName(c)); } else if (x.build_id) { var b = builds[x.build_id]; if (b) out.push(b.name + " (custom)"); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function loadChampCarOpts(cid, done) {
    sb.from("championship_cars").select("id,car_id,build_id").eq("championship_id", cid).then(function (r) {
      var cc = r.data || []; state.sel.ccrows = cc; state.sel.ccopts = [];
      if (r.error || !cc.length) { done(0); return; }
      function chunked(table, cols, ids) {
        var parts = []; for (var i = 0; i < ids.length; i += 100) parts.push(sb.from(table).select(cols).in("id", ids.slice(i, i + 100)));
        return Promise.all(parts).then(function (rs) { var m = {}; rs.forEach(function (x) { (x.data || []).forEach(function (y) { m[y.id] = y; }); }); return m; });
      }
      var cids = cc.filter(function (x) { return x.car_id; }).map(function (x) { return x.car_id; }), bids = cc.filter(function (x) { return x.build_id; }).map(function (x) { return x.build_id; });
      Promise.all([chunked("cars", "id,make,model,year,nickname", cids), chunked("build_sheets", "id,name", bids)]).then(function (xs) { state.sel.ccopts = carOptLabels(cc, xs[0], xs[1]); done(cc.length); });
    });
  }
  function openChamp(id, nav) {
    var prev = state.sel && state.sel.champ.id === id ? state.nav : null;
    Promise.all([
      sb.from("championships").select("*").eq("id", id).single(),
      sb.from("seasons").select("*").eq("championship_id", id).order("starts_on", { ascending: true, nullsFirst: false }),
    ]).then(function (rs) {
      if (rs[0].error) { app.innerHTML = '<div class="card err">' + esc(dbError(rs[0].error)) + "</div>"; return; }
      var seasons = rs[1].data || [], ids = seasons.map(function (s) { return s.id; });
      var evP = ids.length ? sb.from("events").select("*").in("season_id", ids).order("starts_at", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] });
      var srP = ids.length ? sb.from("event_series").select("*").in("season_id", ids) : Promise.resolve({ data: [] });
      var psP = sb.from("points_systems").select("id,name,source_series,copied_from,copied_at").eq("championship_id", id).order("name", { ascending: true });
      var libP = sb.from("points_systems").select("id,name,source_series,source_version").is("championship_id", null).is("league_id", null).order("name", { ascending: true });
      var lpP = sb.from("points_systems").select("id,name,updated_at").eq("league_id", state.league.id).is("championship_id", null).order("name", { ascending: true });
      var tplP = sb.from("race_templates").select("*").eq("championship_id", id).order("sort_order", { ascending: true });
      var trkP = sb.from("track_layouts").select("id,venue_id,name,length_km,is_reverse,track_venues(name)").order("name", { ascending: true });
      Promise.all([evP, srP, psP, libP, tplP, trkP, lpP]).then(function (xs) {
        var evList = xs[0].data || [];
        var raceP = evList.length ? sb.from("races").select("*").in("event_id", evList.map(function (e) { return e.id; })).order("sort_order", { ascending: true }) : Promise.resolve({ data: [] });
        raceP.then(function (rr) {
          var bad = [xs[4], xs[5], rr].filter(function (x) { return x.error; })[0];
          if (bad) { app.innerHTML = '<div class="card err">' + esc(dbError(bad.error)) + ' Has the latest database change (migrations/003_round_race_structure.sql) been run?</div>'; return; }
          state.sel = { champ: rs[0].data, seasons: seasons, events: evList, series: xs[1].data || [], points: xs[2].data || [], library: xs[3].data || [], leaguePts: xs[6].data || [], templates: xs[4].data || [], races: rr.data || [] };
          state.tracks = xs[5].data || [];
          if (!prev) state.tab = "seasons";
          state.nav = nav || prev || { view: "champ" };
          if (state.nav.view === "season" && !seasons.some(function (x) { return x.id === state.nav.sid; })) state.nav = { view: "champ" };
          loadChampCarOpts(id, function (n) { if (!prev && !nav && n === 0) state.tab = "cars"; renderCurrent(); });
        });
      });
    });
  }
  function refreshMissing() {
    var c = state.sel.champ, el = $("#missing"); if (!el) return;
    sb.rpc("championship_missing_items", { cid: c.id }).then(function (r) {
      if (r.error) { el.innerHTML = '<span class="err">' + esc(dbError(r.error)) + "</span>"; return; }
      var m = r.data || [];
      el.innerHTML = m.length ? '<span class="err">Not ready to publish. Still missing:</span><ul class="missing">' + m.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : '<span class="ok">Nothing missing. This championship can be published.</span>';
      if (c.status === "published" && m.length) el.innerHTML += '<p class="err">It is already published, so visitors can see these gaps.</p>';
    });
  }

  function leagueZone() { return (state.league && state.league.timezone) || browserZone() || null; }
  state.tzTried = state.tzTried || {};
  function scheduleCardHtml(c) {
    return '<div class="card"><h2>Schedule</h2>' +
        '<p class="muted" style="margin:0 0 6px">How often you race and when. Every weekend follows it. Times are in the championship time zone.</p>' +
        '<div class="row"><div class="field"><label for="cfreq">Frequency</label><select id="cfreq">' + opts([["1", "Weekly"], ["2", "Fortnightly"], ["3", "Every 3 weeks"], ["4", "Every 4 weeks"]], c.schedule_every_weeks == null ? "" : String(c.schedule_every_weeks), "Not set") + "</select></div>" +
        '<div class="field"><label for="clob">Lobby opens (optional)</label><input id="clob" type="time" value="' + esc(c.lobby_local_time ? String(c.lobby_local_time).slice(0, 5) : "") + '"></div>' +
        '<div class="field"><label for="crace">Race start</label><input id="crace" type="time" value="' + esc(c.race_local_time ? String(c.race_local_time).slice(0, 5) : "") + '"></div></div>' +
      '<div class="row" style="margin-top:8px"><button class="primary" id="schsave" type="button">Save schedule</button><button type="button" data-cancel="reset">Cancel</button><span class="muted">Time zone: ' + esc(c.intended_timezone || champZone() || "not set") + '</span></div><div class="msg" id="schm"></div></div>';
  }
  function champHeadHtml(c, tab) {
    var inSet = tab === "settings" || tab === "points";
    var tabs = [["cars", "Cars"], ["seasons", "Calendar"], ["results", "Results"], ["standings", "Standings"]];
    return navHtml("c") +
      '<div class="card" style="padding-bottom:8px"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">' + esc(c.name) + ' <span class="pill">' + esc(c.status) + '</span></h2></div>' +
      '<div class="row" style="margin-top:10px">' + tabs.map(function (t) { return '<button type="button" data-tab="' + t[0] + '"' + (t[0] === tab ? ' class="primary"' : "") + ">" + t[1] + "</button>"; }).join("") +
      '<button type="button" data-tab="settings" style="margin-left:auto"' + (inSet ? ' class="primary"' : "") + ">Championship settings</button></div>" +
      (inSet ? '<div class="row" style="margin-top:8px"><button type="button" data-tab="settings"' + (tab === "settings" ? ' class="primary"' : "") + '>General</button><button type="button" data-tab="points"' + (tab === "points" ? ' class="primary"' : "") + '>Points</button></div>' : "") + "</div>";
  }
  function renderChamp() {
    var S = state.sel, c = S.champ, tab = state.tab || "seasons";
    var h = champHeadHtml(c, tab);
    if (tab === "settings") {
      // Older championships have no zone: fill it in from the league once, without a click.
      if (!c.intended_timezone && leagueZone() && !state.tzTried[c.id]) {
        state.tzTried[c.id] = true;
        sb.from("championships").update({ intended_timezone: leagueZone() }).eq("id", c.id).select("*").single().then(function (r) {
          if (!r.error && r.data && state.sel && state.sel.champ.id === c.id) { state.sel.champ = r.data; if (state.tab === "settings") renderChamp(); }
        });
      }
      var tzNote = c.intended_timezone ? '<b>' + esc(c.intended_timezone) + '</b> · ' + esc(gmt(c.intended_timezone)) + ' <span class="muted">(the league time zone when this championship was created; viewers see times in their own zone)</span>' :
        '<span class="err">Not set.</span> <button type="button" id="cusetz">Use the league time zone (' + esc(leagueZone() || "none found") + ")</button>";
      h += '<div class="card"><div class="row"><div class="field"><label for="cv">Visibility</label><select id="cv">' + opts([["public", "Public"], ["private", "Private"]], c.visibility, "Not set") + "</select></div>" +
        '<div class="field"><label for="cs">Status</label><select id="cs">' + opts([["draft", "Draft"], ["published", "Published"], ["archived", "Archived"]], c.status, "") .replace('<option value=""></option>', "") + "</select></div></div>" +
        '<p style="margin:10px 0 0"><span class="lbl">Time zone</span><br>' + tzNote + "</p>" +
        '<div class="field" style="margin-top:8px"><label for="cd">Description</label><textarea id="cd">' + esc(c.description || "") + "</textarea></div>" +
        '<div class="field" style="margin-top:8px"><label for="cr">Rules</label><textarea id="cr" rows="6" placeholder="Anything racers must follow: penalties, tuning limits, protests, conduct">' + esc(c.rules || "") + "</textarea></div>" +
        '<div class="row" style="margin-top:8px"><button class="primary" id="csave" type="button">Save</button><button type="button" data-cancel="reset">Cancel</button><button id="crename" type="button">Rename</button></div><div class="msg" id="cm"></div>' +
        '<div id="renamebox"></div>' +
        '<h3>Ready to publish?</h3><div id="missing" class="muted">Checking…</div></div>';
      h += '<div class="card"><h3 style="margin-top:0">Delete this championship</h3><p class="muted" style="margin:0 0 8px">This permanently deletes the championship with all of its seasons, rounds, races, points systems, classes and race format. It cannot be undone. To confirm, type its name: <b>' + esc(c.name) + '</b></p>' +
        '<div class="row"><div class="field grow"><label for="cdn">Championship name</label><input id="cdn" autocomplete="off"></div><button class="danger" id="cdel" type="button" disabled>Delete championship</button></div><div class="msg" id="cdm"></div></div>';
    } else if (tab === "points") h += pointsCardHtml();
    else if (tab === "format") h += templateCardHtml();
    else if (tab === "cars") h += champCarsHtml();
    else if (tab === "results") h += resultsTabHtml();
    else if (tab === "standings") h += '<div class="card"><h2>Standings</h2><div id="stand" class="muted">Loading…</div></div>';
    else {
      h += scheduleCardHtml(c);
      if (!S.seasons.length) {
        h += '<div class="card"><h2>Create the calendar</h2><p class="muted" style="margin:0 0 8px">Choose how many weekends and when the first one is. They follow the schedule above. You then set the venue and laps for each weekend.</p>' +
          '<div class="field"><label for="sn">Season name</label><input id="sn" value="Season 1"></div><div class="msg" id="sm"></div>' + genHtml("new") +
          '<div class="row" style="margin-top:12px"><button id="sadd" type="button">Add season without weekends</button></div></div>';
      } else {
        var cur = S.seasons.filter(function (x) { return x.id === state.curSeason; })[0] || S.seasons[S.seasons.length - 1];
        if (S.seasons.length > 1) h += '<div class="card"><div class="field"><label for="curseason">Season</label><select id="curseason">' + S.seasons.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></div></div>";
        h += seasonHtml(cur);
        h += '<div style="margin-top:12px"><button id="newseasonbtn" type="button">Start a new season</button></div>';
      }
    }
    app.innerHTML = h;
    bindAll(); bindNav();
    refreshMissing();
    if (tab === "cars") fillChampCars();
    if (tab === "results") fillCounts();
    if (tab === "standings") renderStandings();
  }
  function renderCurrent() {
    var n = state.nav || { view: "champ" };
    if (n.view === "race") renderRaceResults(n.rid); else if (n.view === "points") renderPoints(n.pid); else if (n.view === "season") { state.curSeason = n.sid; state.tab = "seasons"; state.nav = { view: "champ" }; renderChamp(); } else if (n.view === "newseason") renderNewSeason(); else renderChamp();
  }
  function renderSeason(sid) {
    var s = state.sel.seasons.filter(function (x) { return x.id === sid; })[0];
    app.innerHTML = '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>" + seasonHtml(s);
    bindAll();
  }
  function renderNewSeason() {
    app.innerHTML = '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>" +
      '<div class="card"><h2>New season</h2><div class="row"><div class="field grow"><label for="sn">Season name</label><input id="sn"></div></div><div class="msg" id="sm"></div>' +
      genHtml("new") + '<div class="row" style="margin-top:12px"><button id="sadd" type="button">Add season without rounds</button></div></div>';
    bindAll();
  }
  function bindAll() {
    function on(sel, fn) { app.querySelectorAll(sel).forEach(function (b) { b.addEventListener("click", function () { fn(b); }); }); }
    on("#back", function () { loadChamps(); });
    on("#backchamp", function () { state.nav = { view: "champ" }; renderCurrent(); });
    on("#newseason", function () { state.nav = { view: "newseason" }; renderCurrent(); });
    on("[data-open]", function (b) { state.nav = { view: "season", sid: b.dataset.open }; renderCurrent(); });
    on("[data-tab]", function (b) { state.tab = b.dataset.tab; renderChamp(); });
    on("#csave", saveChamp);
    on("#schsave", saveSchedule);
    on("#newseasonbtn", function () { state.nav = { view: "newseason" }; renderCurrent(); });
    var cs = $("#curseason"); if (cs) cs.addEventListener("change", function () { state.curSeason = cs.value; renderChamp(); });
    on("#crename", function () {
      $("#renamebox").innerHTML = '<div class="row" style="margin-top:8px"><div class="field grow"><label for="cn">New name</label><input id="cn" value="' + esc(state.sel.champ.name) + '"></div></div><p class="muted" style="margin:4px 0 0">Click Save to apply.</p>';
      $("#cn").focus();
    });
    on("#cusetz", function () {
      var z = leagueZone(); if (!z) return;
      sb.from("championships").update({ intended_timezone: z }).eq("id", state.sel.champ.id).select("*").single().then(function (r) {
        if (r.error) { msg($("#cm"), dbError(r.error), "err"); return; }
        state.sel.champ = r.data; renderChamp();
      });
    });
    var cpts = $("#cpts"); if (cpts) cpts.addEventListener("change", function () {
      var v = nul(cpts.value);
      sb.from("championships").update({ points_system_id: v }).eq("id", state.sel.champ.id).select("*").single().then(function (r) {
        if (r.error) { msg($("#cptsm"), dbError(r.error), "err"); return; }
        state.sel.champ = r.data; msg($("#cptsm"), "Saved.", "ok");
      });
    });
    on("#cdel", deleteChamp);
    var cdn = $("#cdn"); if (cdn) cdn.addEventListener("input", function () { $("#cdel").disabled = cdn.value.trim() !== state.sel.champ.name; });
    on("[data-rr]", function (b) { state.nav = { view: "race", rid: b.dataset.rr }; renderCurrent(); });
    on("[data-pp]", function (b) { state.pscope = "champ"; state.nav = { view: "points", pid: b.dataset.pp }; renderCurrent(); });
    on("#padd", addPoints);
    var plib = $("#plib"); if (plib) plib.addEventListener("change", function () { showPointsPreview(plib.value, $("#pprev")); });
    on("#tadd", function () { $("#tpl").insertAdjacentHTML("beforeend", templateRow({})); });
    on("[data-trm]", function (b) { b.closest(".trow").remove(); });
    on("#tsave", saveTemplates);
    on("[data-radd]", function (b) { $("#rc-" + b.dataset.radd).insertAdjacentHTML("beforeend", raceRow({}, b.dataset.radd)); });
    on("[data-rrm]", function (b) { b.closest(".rrow").remove(); });
    if (!app._trk) {
      app._trk = true;
      app.addEventListener("change", function (e) {
        var t = e.target, id = t.id || "";
        if (id.indexOf("etv-") === 0) { var k = id.slice(4), cur = document.getElementById("etk-" + k); cur.innerHTML = layoutOpts(t.value, ""); refreshDistances(k); calcUpdate(k, "etk"); }
        else if (id.indexOf("etk-") === 0) { refreshDistances(id.slice(4)); calcUpdate(id.slice(4), "etk"); }
      });
      app.addEventListener("input", function (e) {
        var t = e.target, id = t.id || "";
        if (t.hasAttribute && t.hasAttribute("data-rl")) { var rw = t.closest(".rrow"), bx = rw && rw.parentNode; if (bx && bx.id) refreshDistances(bx.id.slice(3)); return; }
        var m = id.match(/^(erl|ecl|ect|ecd)-(.+)$/); if (m) calcUpdate(m[2], m[1] === "erl" ? "" : m[1]);
      });
      app.addEventListener("click", function (e) {
        var t = e.target.closest && e.target.closest("[data-calcapply]"); if (!t) return;
        var k = t.dataset.calcapply, box = document.getElementById("ecr-" + k), laps = box && Number(box.dataset.laps);
        if (!laps) return;
        var ins = document.querySelectorAll("#rc-" + k + " [data-rl]");
        if (!ins.length) { box.textContent = "There are no races below yet. Add a race first."; return; }
        ins.forEach(function (i) { i.value = laps; i.style.outline = "2px solid var(--ok, #4a9)"; setTimeout(function () { i.style.outline = ""; }, 1500); });
        refreshDistances(k);
        box.textContent = "Done: " + laps + (laps === 1 ? " lap" : " laps") + " set on " + ins.length + (ins.length === 1 ? " race" : " races") + " in Races in this round, below.";
        ins[0].scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
    on("#psave", savePoints);
    on("#pbadd", function () { var box = $("#pbonus"); box.insertAdjacentHTML("beforeend", bonusRow({})); });
    on("[data-pbrm]", function (b) { b.closest(".brow2").remove(); });
    on("[data-pd]", function (b) { del("points_systems", b.dataset.pd, b); });
    on("[data-pupd]", function (b) { updateFromLeague($("#pid").value, b.dataset.pupd, b); });
    on("#lpback", function () { renderLeaguePoints(); });

    on("#sadd", addSeason);
    on("[data-sv]", function (b) { saveSeason(b.dataset.sv); });
    on("[data-rup]", function (b) { stepRound(b.dataset.rup, -1); });
    on("[data-rdn]", function (b) { stepRound(b.dataset.rdn, 1); });
    on("[data-bye]", function (b) { byeWeek(b.dataset.bye); });
    on("[data-sd]", function (b) { del("seasons", b.dataset.sd, b); });
    on("[data-gp]", function (b) { previewRounds(b.dataset.gp); });
    on("[data-gc]", function (b) { createRounds(b.dataset.gc); });
    on("[data-ea]", function (b) { addEvent(b.dataset.ea); });
    on("[data-es]", function (b) { saveEvent(b.dataset.es); });
    on("[data-ed]", function (b) { del("events", b.dataset.ed, b); });
    app.querySelectorAll("[data-gf]").forEach(function (el) { el.addEventListener("change", function () { delete plans[el.dataset.gf]; var pv = $("#gv-" + el.dataset.gf); if (pv) pv.innerHTML = ""; }); });
  }
  function deleteChamp() {
    var c = state.sel.champ, m = $("#cdm");
    if ($("#cdn").value.trim() !== c.name) { msg(m, "Type the championship name exactly to confirm.", "err"); return; }
    $("#cdel").disabled = true; msg(m, "Deleting…");
    sb.from("championships").delete().eq("id", c.id).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); $("#cdel").disabled = false; return; }
      loadChamps();
    });
  }
  function saveChamp() {
    var c = state.sel.champ, m = $("#cm");
    var patch = { name: $("#cn") ? $("#cn").value.trim() : c.name, visibility: nul($("#cv").value), description: nul($("#cd").value), status: $("#cs").value };
    var rl = $("#cr"); if (rl && (nul(rl.value) !== null || c.rules != null)) patch.rules = nul(rl.value);
    if (!patch.name) { msg(m, "The name cannot be blank.", "err"); return; }
    msg(m, "Saving…");
    sb.from("championships").update(patch).eq("id", c.id).select("*").single().then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      state.sel.champ = r.data; renderChamp(); msg($("#cm"), "Saved.", "ok");
    });
  }

  function saveSchedule() {
    var c = state.sel.champ, m = $("#schm");
    var patch = { schedule_every_weeks: numOrNull($("#cfreq").value), lobby_local_time: nul($("#clob").value), race_local_time: nul($("#crace").value) };
    if (patch.lobby_local_time && !patch.race_local_time) { msg(m, "Set the race start as well as the lobby time.", "err"); return; }
    if (patch.lobby_local_time && patch.lobby_local_time > patch.race_local_time) { msg(m, "The lobby must open at or before the race start, on the same day.", "err"); return; }
    msg(m, "Saving…");
    sb.from("championships").update(patch).eq("id", c.id).select("*").single().then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      state.sel.champ = r.data; renderChamp(); msg($("#schm"), "Saved.", "ok");
    });
  }

  /* ---------- seasons ---------- */
  function seasonHtml(s) {
    var evs = state.sel.events.filter(function (e) { return e.season_id === s.id; });
    var h = '<div class="card"><h2>Season: ' + esc(s.name) + "</h2>" +
      '<div class="row"><div class="field grow"><label for="sn-' + s.id + '">Name</label><input id="sn-' + s.id + '" value="' + esc(s.name) + '"></div>' +
      '<div class="field"><label for="ss-' + s.id + '">Starts</label><input id="ss-' + s.id + '" type="date" value="' + esc(s.starts_on || "") + '"></div>' +
      '<button data-sv="' + s.id + '" type="button">Save season</button><button class="danger" data-sd="' + s.id + '" type="button">Delete season</button></div><div class="msg" id="sm-' + s.id + '"></div>' +
      "<h3>Rounds (" + evs.length + ")</h3>";
    evs.forEach(function (e, i) {
      h += '<div style="display:flex;gap:4px;align-items:flex-start"><div style="display:flex;gap:2px;margin-top:8px;flex:0 0 auto"><button type="button" data-rup="' + esc(e.id) + '" title="Swap with the round above"' + (i === 0 ? " disabled" : "") + '>↑</button><button type="button" data-rdn="' + esc(e.id) + '" title="Swap with the round below"' + (i === evs.length - 1 ? " disabled" : "") + '>↓</button></div><div style="flex:1;min-width:0">' + eventHtml(e) + "</div></div>";
    });
    h += genHtml(s.id);
    if (evs.length) {
      var ro = evs.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(roundLabel(e)) + "</option>"; }).join("");
      h += '<div class="card" style="margin:8px 0;border-top-width:1px"><h3 style="margin-top:0">Skip a week</h3>' +
        '<p class="muted" style="margin:0 0 8px">For a holiday or a break. Every round after the one you pick moves later by that many weeks, at the same local time. To change the order of rounds, use the arrows beside them.</p>' +
        '<div class="row" style="align-items:flex-end"><div class="field"><label for="bye-' + s.id + '">Skip after</label><select id="bye-' + s.id + '">' + ro + '</select></div>' +
        '<div class="field"><label for="byn-' + s.id + '">Weeks to skip</label><input id="byn-' + s.id + '" type="number" min="1" max="26" value="1" style="width:70px"></div>' +
        '<button type="button" data-bye="' + s.id + '">Skip weeks</button></div>' +
        '<div class="msg" id="rm2-' + s.id + '"></div></div>';
    }
    h += '<details class="ev" style="margin-top:12px"><summary><span class="muted">Add a single round outside the schedule</span></summary><div style="margin-top:10px">' + eventFields("new-" + s.id, {}) +
      '<h3>Races in this round</h3><div id="rc-new-' + s.id + '">' + raceRow({}, "new-" + s.id) + '</div><div style="margin-top:8px"><button type="button" data-radd="new-' + s.id + '">Add a race</button></div>' +
      '<div class="row" style="margin-top:8px"><button class="primary" data-ea="' + s.id + '" type="button">Add round</button></div><div class="msg" id="em-new-' + s.id + '"></div></div></details></div>';
    return h;
  }
  /* ---------- points systems ---------- */
  function updAvail(x) {
    var src = state.sel.leaguePts.filter(function (l) { return l.id === x.copied_from; })[0];
    return !!(src && x.copied_at && src.updated_at && src.updated_at > x.copied_at);
  }
  function pointsCardHtml() {
    var S = state.sel;
    return '<div class="card"><h2>Default points system</h2><p class="muted" style="margin:0 0 8px">Every race uses this one unless you pick another for that race on its weekend, for example one system for Sprint and another for Main.</p>' +
      (S.points.length ? '<div class="field"><label for="cpts">Points system</label><select id="cpts">' + opts(S.points.map(function (x) { return [x.id, x.name]; }), state.sel.champ.points_system_id, "Not set") + '</select></div>' : '<p class="muted" style="margin:0">None to choose from yet. Add a points system below, then pick it here.</p>') + '<div class="msg" id="cptsm"></div></div>' +
      '<div class="card"><h2>Points systems</h2><p class="muted" style="margin:0 0 8px">The systems this championship has. Open one to edit it, or add another below.</p><div class="list">' +
      (S.points.length ? S.points.map(function (x) { return '<button type="button" class="item" data-pp="' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="muted">' + (updAvail(x) ? '<span class="pill">league version changed</span>' : "") + "</span></button>"; }).join("") : '<p class="muted">None yet.</p>') + "</div>" +
      '<div class="row" style="margin-top:10px"><div class="field grow"><label for="plib">Add from</label><select id="plib">' + fromOpts(S.leaguePts, S.library) + "</select></div>" +
      '<button class="primary" id="padd" type="button">Add points system</button></div><div id="pprev" class="muted" style="margin-top:8px"></div><div class="msg" id="pm"></div></div>';
  }
  /* ---------- race format template ---------- */
  function pointsOpts(cur) { return opts(state.sel.points.map(function (x) { return [x.id, x.name]; }), cur, "Same as the championship"); }
  function templateRow(t) {
    return '<div class="row trow" style="margin-top:6px"><div class="field grow"><label>Race name</label><input data-tn value="' + esc(t.name || "") + '" placeholder="For example Sprint"></div>' +
      '<div class="field"><label>Laps</label><input data-tl type="number" min="1" style="width:90px" value="' + esc(t.laps == null ? "" : t.laps) + '"></div>' +
      '<div class="field grow"><label>Points system</label><select data-tp>' + pointsOpts(t.points_system_id) + "</select></div>" +
      '<button type="button" data-trm>Remove</button></div>';
  }
  function templateCardHtml() {
    var S = state.sel;
    return '<div class="card"><h2>Race format</h2><p class="muted" style="margin:0 0 8px">The races every new round starts with. You can change or remove them on any one round. Rounds that already exist are not changed when you edit this.</p>' +
      '<div id="tpl">' + S.templates.map(templateRow).join("") + '</div>' +
      '<div class="row" style="margin-top:10px"><button type="button" id="tadd">Add a race</button><button class="primary" type="button" id="tsave">Save race format</button><button type="button" data-cancel="reset">Cancel</button></div><div class="msg" id="tm"></div></div>';
  }
  function saveTemplates() {
    var m = $("#tm"), rows = [], bad = null;
    document.querySelectorAll("#tpl .trow").forEach(function (r) {
      var name = r.querySelector("[data-tn]").value.trim(), laps = numOrNull(r.querySelector("[data-tl]").value), pts = nul(r.querySelector("[data-tp]").value);
      if (!name) { bad = "Every race needs a name."; return; }
      if (laps != null && (laps < 1 || Math.floor(laps) !== laps)) { bad = "Laps must be a whole number of 1 or more."; return; }
      rows.push({ championship_id: state.sel.champ.id, sort_order: rows.length + 1, name: name, laps: laps, points_system_id: pts });
    });
    if (bad) { msg(m, bad, "err"); return; }
    msg(m, "Saving…");
    var fin = function (e) { if (e) { msg(m, dbError(e), "err"); return; } openChamp(state.sel.champ.id); setTimeout(function () { msg($("#tm"), "Saved.", "ok"); }, 500); };
    var cid = state.sel.champ.id;
    (rows.length ? sb.from("race_templates").upsert(rows, { onConflict: "championship_id,sort_order" }) : Promise.resolve({})).then(function (r1) {
      if (r1.error) { fin(r1.error); return; }
      sb.from("race_templates").delete().eq("championship_id", cid).gt("sort_order", rows.length).then(function (r2) { fin(r2.error); });
    });
  }
  // The races a new round starts with, copied from the championship's race format.
  function racesForNewRounds(events) {
    var T = state.sel.templates.length ? state.sel.templates : [{ sort_order: 1, name: "Race 1", laps: null, points_system_id: null }], out = [];
    events.forEach(function (e) { T.forEach(function (t) { out.push({ event_id: e.id, sort_order: t.sort_order, name: t.name, laps: t.laps, points_system_id: t.points_system_id }); }); });
    return out;
  }
  function insertRaces(events) {
    var rows = racesForNewRounds(events);
    return rows.length ? sb.from("races").insert(rows) : Promise.resolve({});
  }

  // Points systems are copied, never shared: master list -> league -> championship. A copy remembers where it came from.
  function readSystem(srcId) {
    return Promise.all([
      sb.from("points_systems").select("*").eq("id", srcId).single(),
      sb.from("points_table_entries").select("*").eq("points_system_id", srcId),
      sb.from("points_status_rules").select("*").eq("points_system_id", srcId),
      sb.from("points_bonuses").select("*").eq("points_system_id", srcId)
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) throw bad.error;
      return { src: rs[0].data, ents: rs[1].data || [], sts: rs[2].data || [], bns: rs[3].data || [] };
    });
  }
  function writeChildren(nid, d) {
    var steps = [];
    var ents = d.ents.map(function (e) { return { points_system_id: nid, position: e.position, points: e.points }; });
    var sts = d.sts.map(function (e) { return { points_system_id: nid, status: e.status, points: e.points }; });
    var bns = d.bns.map(function (e) { return { points_system_id: nid, name: e.name, kind: e.kind, points: e.points, description: e.description }; });
    if (ents.length) steps.push(sb.from("points_table_entries").insert(ents));
    if (sts.length) steps.push(sb.from("points_status_rules").upsert(sts, { onConflict: "points_system_id,status" }));
    if (bns.length) steps.push(sb.from("points_bonuses").insert(bns));
    return Promise.all(steps).then(function (xs) {
      var e2 = xs.filter(function (x) { return x.error; })[0];
      if (e2) throw e2.error;
    });
  }
  // owner is { championship_id } or { league_id }; resolves with the new system's id.
  function copySystem(srcId, owner) {
    return readSystem(srcId).then(function (d) {
      var row = Object.assign({ name: d.src.name, source_series: d.src.source_series, source_version: d.src.source_version, source_url: d.src.source_url, dnf_rank_by_best_lap: !!d.src.dnf_rank_by_best_lap, copied_from: d.src.id, copied_at: new Date().toISOString() }, owner);
      return sb.from("points_systems").insert(row).select("id").single().then(function (r) {
        if (r.error) throw r.error;
        var nid = r.data.id;
        return writeChildren(nid, d).then(function () { return nid; }, function (e) {
          return sb.from("points_systems").delete().eq("id", nid).then(function () { throw e; });
        });
      });
    });
  }
  function fromOpts(league, master) {
    function grp(label, list) { return list.length ? '<optgroup label="' + esc(label) + '">' + list.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.name) + "</option>"; }).join("") + "</optgroup>" : ""; }
    return '<option value="">Empty custom system</option>' + grp("This league's systems", league) + grp("Master list", master);
  }
  var ORD = function (n) { var v = n % 100; return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"); };
  // Shows what a points system awards, so you can see it before adding it.
  function showPointsPreview(srcId, box) {
    if (!box) return;
    if (!srcId) { box.textContent = "An empty system with no points yet. You can fill it in after adding it."; return; }
    box.textContent = "Loading…";
    Promise.all([
      sb.from("points_table_entries").select("position,points").eq("points_system_id", srcId).order("position", { ascending: true }),
      sb.from("points_bonuses").select("name,kind,points").eq("points_system_id", srcId)
    ]).then(function (rs) {
      if (box.dataset.src !== undefined && false) return;
      var cur = box.parentNode.querySelector("select"); if (cur && cur.value !== srcId) return;
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { box.textContent = dbError(bad.error); return; }
      var ents = rs[0].data || [], bns = rs[1].data || [];
      var line = ents.length ? ents.map(function (e) { return ORD(e.position) + " " + e.points; }).join(" · ") : "No positions listed.";
      box.innerHTML = '<div><b>Points by finishing position</b></div><div style="margin:2px 0 6px">' + esc(line) + "</div>" +
        (bns.length ? "<div><b>Bonuses</b></div><div>" + esc(bns.map(function (x) { return x.name + " " + (x.points > 0 ? "+" : "") + x.points; }).join(" · ")) + "</div>" : "");
    });
  }
  function addPoints() {
    var C = state.sel.champ, m = $("#pm"), sid = $("#plib").value;
    msg(m, "Adding…");
    var go = sid ? copySystem(sid, { championship_id: C.id }) :
      sb.from("points_systems").insert({ championship_id: C.id, name: "New points system" }).select("id").single().then(function (r) { if (r.error) throw r.error; return r.data.id; });
    go.then(function (nid) {
      // The first system added becomes the championship's default, so there is no second step.
      return C.points_system_id ? nid : sb.from("championships").update({ points_system_id: nid }).eq("id", C.id).then(function () { return nid; });
    }).then(function () { state.tab = "points"; openChamp(C.id, { view: "champ" }); setTimeout(function () { msg($("#pm"), "Added.", "ok"); }, 700); }, function (e) { msg(m, dbError(e), "err"); });
  }
  function loadLeaguePts(done) {
    var lid = state.league.id;
    Promise.all([
      sb.from("points_systems").select("id,name,source_series,updated_at").eq("league_id", lid).is("championship_id", null).order("name", { ascending: true }),
      sb.from("points_systems").select("id,name,source_series,source_version").is("championship_id", null).is("league_id", null).order("name", { ascending: true })
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { app.innerHTML = '<div class="card err">' + esc(dbError(bad.error)) + "</div>"; return; }
      state.lpts = rs[0].data || []; state.master = rs[1].data || []; done();
    });
  }
  function addLeaguePoints() {
    var m = $("#lpm"), sid = $("#lplib").value;
    msg(m, "Adding…");
    var go = sid ? copySystem(sid, { league_id: state.league.id }) :
      sb.from("points_systems").insert({ league_id: state.league.id, name: "New points system" }).select("id").single().then(function (r) { if (r.error) throw r.error; return r.data.id; });
    go.then(function () { renderLeaguePoints(); setTimeout(function () { msg($("#lpm"), "Added.", "ok"); }, 500); }, function (e) { msg(m, dbError(e), "err"); });
  }
  function updateFromLeague(pid, srcId, btn) {
    if (armed !== "upd" + pid) { armed = "upd" + pid; btn.textContent = "This replaces this system with the league's version, losing any edits you made here. Click again to confirm"; return; }
    armed = null; btn.disabled = true;
    readSystem(srcId).then(function (d) {
      return Promise.all([
        sb.from("points_table_entries").delete().eq("points_system_id", pid),
        sb.from("points_status_rules").delete().eq("points_system_id", pid),
        sb.from("points_bonuses").delete().eq("points_system_id", pid)
      ]).then(function (xs) {
        var e = xs.filter(function (x) { return x.error; })[0]; if (e) throw e.error;
        return writeChildren(pid, d);
      }).then(function () {
        return sb.from("points_systems").update({ name: d.src.name, dnf_rank_by_best_lap: !!d.src.dnf_rank_by_best_lap, copied_at: new Date().toISOString() }).eq("id", pid);
      });
    }).then(function () { openChamp(state.sel.champ.id, { view: "points", pid: pid }); }, function (e) { btn.disabled = false; btn.textContent = dbError(e); });
  }
  function bonusRow(b) {
    return '<div class="row brow2" style="margin-top:6px"><div class="field grow"><label>Name</label><input data-bn value="' + esc(b.name || "") + '"></div>' +
      '<div class="field"><label>Type</label><select data-bk>' + opts([["bonus", "Bonus"], ["penalty", "Penalty"]], b.kind, "Not set") + "</select></div>" +
      '<div class="field"><label>Points</label><input data-bp type="number" step="any" style="width:90px" value="' + esc(b.points == null ? "" : b.points) + '"></div>' +
      '<div class="field grow"><label>Note</label><input data-bd value="' + esc(b.description || "") + '"></div>' +
      '<button type="button" data-pbrm>Remove</button></div>';
  }
  function renderPoints(pid) {
    app.innerHTML = '<p class="muted">Loading…</p>';
    Promise.all([
      sb.from("points_systems").select("*").eq("id", pid).single(),
      sb.from("points_table_entries").select("*").eq("points_system_id", pid).order("position", { ascending: true }),
      sb.from("points_status_rules").select("*").eq("points_system_id", pid),
      sb.from("points_bonuses").select("*").eq("points_system_id", pid)
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { app.innerHTML = '<div class="card err">' + esc(dbError(bad.error)) + "</div>"; return; }
      var sys = rs[0].data, ents = (rs[1].data || []).slice().sort(function (a, b) { return a.position - b.position; });
      var st = {}; (rs[2].data || []).forEach(function (x) { st[x.status] = x.points; });
      var lines = ents.map(function (e) { return e.points; }).join("\n");
      var gap = ents.some(function (e, i) { return e.position !== i + 1; });
      var lsc = state.pscope === "league", srcL = !lsc && sys.copied_from ? state.sel.leaguePts.filter(function (l) { return l.id === sys.copied_from; })[0] : null;
      app.innerHTML = (lsc ? '<p><button type="button" id="lpback">← Points systems</button></p>' : '<p><button type="button" id="backchamp">← ' + esc(state.sel.champ.name) + "</button></p>") +
        '<div class="card"><h2>Points system' + (lsc ? " (saved for the whole league)" : "") + '</h2>' +
        (srcL && updAvail(sys) ? '<p class="err" style="margin:0 0 8px">The league\'s version of <b>' + esc(srcL.name) + '</b> has changed since this was copied. Nothing here has been changed. <button type="button" data-pupd="' + esc(srcL.id) + '">Update from the league\'s version</button></p>' : "") + '<input type="hidden" id="pid" value="' + esc(pid) + '">' +
        '<div class="field"><label for="pn">Name</label><input id="pn" value="' + esc(sys.name) + '"></div>' +
        (sys.source_series ? '<p class="muted" style="margin:8px 0 0">Copied from ' + esc(sys.source_series) + ". " + esc(sys.source_version || "") + (sys.source_url ? ' <a href="' + esc(sys.source_url) + '" target="_blank" rel="noopener">Source</a>' : "") + "</p>" : "") +
        '<div class="field" style="margin-top:10px"><label for="pt">Points per finishing position: one number per line, 1st place first</label><textarea id="pt" style="min-height:160px">' + esc(lines) + "</textarea></div>" +
        (gap ? '<p class="err">This system has gaps in its positions. Saving renumbers it from 1.</p>' : "") +
        '<p class="muted" style="margin:4px 0 0">A position with no line has no points set. Enter 0 where a place scores nothing.</p>' +
        '<h3>Non-finishers</h3><label style="display:flex;align-items:center;gap:6px;margin:0 0 8px"><input type="checkbox" id="pdr"' + (sys.dnf_rank_by_best_lap ? " checked" : "") + '> Rank DNFs after the last finisher by best lap, and score them for the position they land in</label>' +
        '<p class="muted" style="margin:0 0 6px">With that ticked, a DNF with no recorded lap counts as DNS (0 points). Otherwise a DNF scores 0 unless you change it here. Leave a box blank to leave it unset.</p><div class="row">' +
        ["dnf", "dns", "dsq", "other"].map(function (k) { return '<div class="field"><label for="ps-' + k + '">' + k.toUpperCase() + '</label><input id="ps-' + k + '" type="number" step="any" style="width:90px" value="' + esc(st[k] == null ? "" : st[k]) + '"></div>'; }).join("") + "</div>" +
        '<h3>Bonuses and penalties</h3><div id="pbonus">' + (rs[3].data || []).map(bonusRow).join("") + '</div><div style="margin-top:8px"><button type="button" id="pbadd">Add bonus or penalty</button></div>' +
        '<div class="row" style="margin-top:14px"><button class="primary" id="psave" type="button">Save</button><button type="button" data-cancel="back">Cancel</button><button class="danger" data-pd="' + esc(pid) + '" type="button">Delete this points system</button></div><div class="msg" id="pm2"></div></div>';
      bindAll();
    });
  }
  function savePoints() {
    var pid = $("#pid").value, m = $("#pm2"), name = $("#pn").value.trim();
    if (!name) { msg(m, "The name cannot be blank.", "err"); return; }
    var ents = [], lines = $("#pt").value.split("\n").map(function (x) { return x.trim(); }).filter(function (x) { return x !== ""; });
    for (var i = 0; i < lines.length; i++) {
      if (!isFinite(Number(lines[i]))) { msg(m, "Line " + (i + 1) + " is not a number: " + lines[i], "err"); return; }
      ents.push({ points_system_id: pid, position: i + 1, points: Number(lines[i]) });
    }
    if (!ents.length) { msg(m, "Enter the points for at least 1st place.", "err"); return; }
    var sts = [];
    ["dnf", "dns", "dsq", "other"].forEach(function (k) { var v = numOrNull($("#ps-" + k).value); if (v != null) sts.push({ points_system_id: pid, status: k, points: v }); });
    var bns = [], badb = null;
    document.querySelectorAll("#pbonus .brow2").forEach(function (r) {
      var bn = r.querySelector("[data-bn]").value.trim(), bk = r.querySelector("[data-bk]").value, bp = numOrNull(r.querySelector("[data-bp]").value);
      if (!bn && !bk && bp == null) return;
      if (!bn || !bk || bp == null) { badb = "Every bonus or penalty needs a name, a type and a points value."; return; }
      bns.push({ points_system_id: pid, name: bn, kind: bk, points: bp, description: nul(r.querySelector("[data-bd]").value) });
    });
    if (badb) { msg(m, badb, "err"); return; }
    msg(m, "Saving…");
    var fail = function (x) { msg(m, x ? dbError(x) : "Could not save.", "err"); };
    sb.from("points_systems").update({ name: name, dnf_rank_by_best_lap: $("#pdr").checked }).eq("id", pid).then(function (r1) {
      if (r1.error) { fail(r1.error); return; }
      sb.from("points_table_entries").upsert(ents, { onConflict: "points_system_id,position" }).then(function (r2) {
        if (r2.error) { fail(r2.error); return; }
        sb.from("points_table_entries").delete().eq("points_system_id", pid).gt("position", ents.length).then(function (r3) {
          if (r3.error) { fail(r3.error); return; }
          sb.from("points_status_rules").delete().eq("points_system_id", pid).then(function (r4) {
            if (r4.error) { fail(r4.error); return; }
            var p5 = sts.length ? sb.from("points_status_rules").insert(sts) : Promise.resolve({});
            p5.then(function (r5) {
              if (r5.error) { fail(r5.error); return; }
              sb.from("points_bonuses").delete().eq("points_system_id", pid).then(function (r6) {
                if (r6.error) { fail(r6.error); return; }
                var p7 = bns.length ? sb.from("points_bonuses").insert(bns) : Promise.resolve({});
                p7.then(function (r7) {
                  if (r7.error) { fail(r7.error); return; }
                  if (state.pscope === "league") { renderPoints(pid); } else openChamp(state.sel.champ.id, { view: "points", pid: pid });
                  setTimeout(function () { msg($("#pm2"), "Saved.", "ok"); }, 500);
                });
              });
            });
          });
        });
      });
    });
  }

  /* ---------- the season's schedule ---------- */
  // The frequency, start time and zone belong to the season. They are set once, either when the
  // season is created or the first time rounds are added, and later rounds reuse them.
  var FREQ_OPTS = { weekly: { l: "Weekly", pattern: "weekly", n: 1 }, fortnightly: { l: "Fortnightly", pattern: "fortnightly", n: 2 }, w3: { l: "Every 3 weeks", pattern: "custom", n: 3 }, w4: { l: "Every 4 weeks", pattern: "custom", n: 4 } };
  // The schedule pattern lives on the championship; a season copies it when its rounds are first made.
  function champPattern() {
    var c = state.sel.champ, fo = { 1: "weekly", 2: "fortnightly", 3: "w3", 4: "w4" }[c.schedule_every_weeks];
    if (!fo || !c.race_local_time || !c.intended_timezone) return { error: "Set the frequency and race start in the schedule above and press Save schedule first." };
    var o = FREQ_OPTS[fo], race = String(c.race_local_time).slice(0, 5), lob = c.lobby_local_time ? String(c.lobby_local_time).slice(0, 5) : "";
    return { pattern: o.pattern, n: o.n, t: race, l: lob, z: c.intended_timezone, text: o.l + " · " + (lob ? "lobby " + lob + ", race " : "race ") + race + " " + c.intended_timezone };
  }
  function champZone() { return (state.sel && state.sel.champ.intended_timezone) || leagueZone() || null; }
  var FREQ = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", custom: "Custom" };
  function seriesFor(sid) { return (state.sel.series || []).filter(function (x) { return x.season_id === sid; })[0] || null; }
  function scheduleText(r) {
    var f = FREQ[r.pattern] || r.pattern;
    if (r.pattern === "custom") f = "Every " + r.interval_count + " " + r.interval_unit + (r.interval_count > 1 ? "s" : "");
    if (r.monthly_mode) f += r.monthly_mode === "nth_weekday" ? ", same weekday" : ", same day of the month";
    return f + " · " + (r.lobby_local_time ? "lobby " + String(r.lobby_local_time).slice(0, 5) + ", race " : "race ") + String(r.local_time).slice(0, 5) + " " + r.timezone + " · first round " + r.first_local_date + " · " + r.occurrence_count + " round" + (r.occurrence_count === 1 ? "" : "s") + " so far";
  }
  function genHtml(k) {
    var ser = k === "new" ? null : seriesFor(k);
    var title = k === "new" ? "Schedule (optional): create the season with its rounds" : ser ? "Add more rounds" : "Set the season's schedule and add rounds";
    var h = '<div class="card" style="margin:12px 0 0"><div class="lbl" style="margin-bottom:6px">' + title + "</div>";
    if (ser) {
      h += '<p class="muted" style="margin:0 0 8px">Schedule for this season: ' + esc(scheduleText(ser)) + ". New rounds follow it.</p>" +
        '<div class="row"><div class="field"><label for="gn-' + k + '">Number of rounds to add</label><input id="gn-' + k + '" type="number" min="1" max="200" style="width:110px"></div></div>';
    } else {
      var pat = champPattern();
      h += (pat.error ? '<p class="err" style="margin:0 0 8px">' + esc(pat.error) + "</p>" : '<p class="muted" style="margin:0 0 8px">Schedule from the championship: ' + esc(pat.text) + ".</p>") +
        '<div class="row"><div class="field"><label for="gn-' + k + '">Number of rounds</label><input id="gn-' + k + '" type="number" min="1" max="200" style="width:110px"></div>' +
        '<div class="field"><label for="gd-' + k + '">Starting date</label><input id="gd-' + k + '" type="date"></div></div>';
    }
    return h + '<div class="row" style="margin-top:8px"><button data-gp="' + k + '" type="button">Preview rounds</button></div><div id="gv-' + k + '"></div></div>';
  }
  function toggleGen() { /* the frequency has no dependent fields any more */ }
  function previewRounds(k) {
    var box = $("#gv-" + k), sid = k === "new" ? null : k; delete plans[k];
    var ser = sid ? seriesFor(sid) : null, done = ser ? ser.occurrence_count : 0, extra = numOrNull($("#gn-" + k).value), cfgv;
    if (ser) cfgv = { pattern: ser.pattern, mode: ser.monthly_mode || "", ic: ser.interval_count, iu: ser.interval_unit, start: ser.first_local_date, t: String(ser.local_time).slice(0, 5), l: ser.lobby_local_time ? String(ser.lobby_local_time).slice(0, 5) : "", z: ser.timezone };
    else {
      var pt = champPattern();
      if (pt.error) { box.innerHTML = '<p class="err">' + esc(pt.error) + "</p>"; return; }
      cfgv = { pattern: pt.pattern, mode: "", ic: pt.n, iu: "week", start: $("#gd-" + k).value, t: pt.t, l: pt.l, z: pt.z };
    }
    if (k === "new" && !$("#sn").value.trim()) { box.innerHTML = '<p class="err">Type the season name first.</p>'; return; }
    if (!(extra >= 1)) { box.innerHTML = '<p class="err">Enter the number of rounds.</p>'; return; }
    var g = SCH.generate({ start: cfgv.start, count: done + extra, pattern: cfgv.pattern, monthlyMode: cfgv.mode, intervalCount: cfgv.ic, intervalUnit: cfgv.iu });
    if (g.error) { box.innerHTML = '<p class="err">' + esc(g.error) + "</p>"; return; }
    if (!cfgv.t) { box.innerHTML = '<p class="err">Choose the race start time.</p>'; return; }
    if (cfgv.l && cfgv.l > cfgv.t) { box.innerHTML = '<p class="err">The lobby must open at or before the race start, on the same day.</p>'; return; }
    var dates = g.dates.slice(done);
    var evs = sid ? state.sel.events.filter(function (e) { return e.season_id === sid; }) : [];
    var first = evs.reduce(function (m, e) { return Math.max(m, e.round_number || 0); }, 0) + 1;
    var bad = 0, rows = dates.map(function (d, i) {
      var r = TZ.zonedToInstant(d, cfgv.t, cfgv.z), n = first + i, line, lr = cfgv.l ? TZ.zonedToInstant(d, cfgv.l, cfgv.z) : null;
      if (!r.error && lr && lr.error) { r = lr; }
      if (r.error) { bad++; line = '<span class="err">' + esc(d) + " " + esc(cfgv.t) + ": " + (r.error === "nonexistent" ? "this time does not exist in " + esc(cfgv.z) + " that day, because the clocks skip forward" : r.error === "ambiguous" ? "this time happens twice in " + esc(cfgv.z) + " that day, because the clocks go back" : "not valid") + "</span>"; }
      else { var mine = TZ.localText(Date.parse(r.instant), viewerTz); line = esc(d + " " + (cfgv.l ? "lobby " + cfgv.l + ", race " : "race ") + cfgv.t) + (viewerTz !== cfgv.z ? ' <span class="muted">(your time: ' + esc(mine.date + " " + mine.time) + ")</span>" : ""); }
      return { d: d, n: n, inst: r.instant, lobby: lr && !lr.error ? lr.instant : null, line: "<li>Round " + n + " · " + line + "</li>" };
    });
    var last = g.dates[g.dates.length - 1], season = sid ? state.sel.seasons.filter(function (x) { return x.id === sid; })[0] : null;
    var h = '<ul class="missing" style="margin-top:8px">' + rows.map(function (r) { return r.line; }).join("") + "</ul>";
    if (bad) h += '<p class="err">Change the start time, the date or the zone so every round is valid, then preview again.</p>';
    else {
      h += "<p>" + (k === "new" ? "The season will start on <b>" + esc(g.dates[0]) + "</b>." : "") + "</p>" +
        (evs.length ? '<p class="muted">This season already has ' + evs.length + " round" + (evs.length === 1 ? "" : "s") + ", so numbering continues from round " + first + ".</p>" : "") +
        '<button class="primary" data-gc="' + k + '" type="button">' + (k === "new" ? "Create season with " : "Create ") + rows.length + " round" + (rows.length === 1 ? "" : "s") + '</button><div class="msg" id="gm2-' + k + '"></div>';
      plans[k] = { rows: rows, first: g.dates[0], last: last, cfg: cfgv, done: done, ser: ser };
    }
    box.innerHTML = h;
    var cb = box.querySelector("[data-gc]"); if (cb) cb.addEventListener("click", function () { createRounds(k); });
  }
  function createRounds(k) {
    var pl = plans[k], m = $("#gm2-" + k); if (!pl) return;
    var btn = $("#gv-" + k + " [data-gc]"); if (btn) btn.disabled = true;
    msg(m, "Creating…");
    var fail = function (text, undo) { (undo ? undo() : Promise.resolve()).then(function () { msg(m, text, "err"); if (btn) btn.disabled = false; }); };
    var cf = pl.cfg;
    // 1. the season (new seasons only)
    var seasonP = k === "new"
      ? sb.from("seasons").insert({ championship_id: state.sel.champ.id, name: $("#sn").value.trim(), starts_on: pl.first, ends_on: pl.last }).select("id").single()
      : Promise.resolve({ data: { id: k }, error: null });
    seasonP.then(function (sr) {
      if (sr.error) { fail(dbError(sr.error)); return; }
      var sid = sr.data.id;
      var undoSeason = function () { return k === "new" ? sb.from("seasons").delete().eq("id", sid) : Promise.resolve(); };
      // 2. the schedule rule
      var ruleP;
      if (pl.ser) ruleP = sb.from("event_series").update({ occurrence_count: pl.done + pl.rows.length }).eq("id", pl.ser.id).select("id").single();
      else {
        var series = { season_id: sid, pattern: cf.pattern, first_local_date: cf.start, local_time: cf.t, timezone: cf.z, end_type: "after_count", occurrence_count: pl.rows.length };
        series.interval_count = cf.ic; series.interval_unit = "week";
        if (cf.l) series.lobby_local_time = cf.l;
        ruleP = sb.from("event_series").insert(series).select("id").single();
      }
      ruleP.then(function (rr) {
        if (rr.error) { fail(dbError(rr.error), undoSeason); return; }
        var undoRule = function () {
          var u = pl.ser ? sb.from("event_series").update({ occurrence_count: pl.done }).eq("id", pl.ser.id) : sb.from("event_series").delete().eq("id", rr.data.id);
          return u.then(undoSeason);
        };
        // 3. the events
        var evs = pl.rows.map(function (r) { var o = { season_id: sid, series_id: rr.data.id, occurrence_date: r.d, round_number: r.n, starts_at: r.inst, original_starts_at: r.inst, timezone: cf.z }; if (r.lobby) o.lobby_opens_at = r.lobby; return o; });
        sb.from("events").insert(evs).select("id").then(function (er) {
          if (er.error) { fail("No rounds were created: " + dbError(er.error), undoRule); return; }
          insertRaces(er.data || []).then(function (rrs) { if (rrs.error) setTimeout(function () { msg($("#sm-" + sid), "Rounds were created, but their races could not be added: " + dbError(rrs.error), "err"); }, 600); });
          // 4. the season end date
          sb.from("seasons").update({ ends_on: pl.last }).eq("id", sid).then(function (ur) {
            delete plans[k];
            openChamp(state.sel.champ.id, { view: "season", sid: sid });
            if (ur.error) setTimeout(function () { msg($("#sm-" + sid), "Rounds were created, but the season end date could not be set: " + dbError(ur.error), "err"); }, 600);
          });
        });
      });
    });
  }

  function addSeason() {
    var m = $("#sm"), name = $("#sn").value.trim();
    if (!name) { msg(m, "Type a season name first.", "err"); return; }
    sb.from("seasons").insert({ championship_id: state.sel.champ.id, name: name, starts_on: null, ends_on: null }).select("id").single().then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      openChamp(state.sel.champ.id, { view: "season", sid: r.data.id });
    });
  }
  function shiftDate(d, n) { var t = Date.parse(d + "T00:00:00Z"); return new Date(t + n * 86400000).toISOString().slice(0, 10); }
  function afterRoundMove(sid, msgText, err) {
    openChamp(state.sel.champ.id);
    setTimeout(function () { var mm = $("#rm2-" + sid); if (mm) msg(mm, msgText, err ? "err" : "ok"); }, 600);
  }
  function stepRound(id, dir) {
    var me = state.sel.events.filter(function (e) { return e.id === id; })[0]; if (!me) return;
    var sib = state.sel.events.filter(function (e) { return e.season_id === me.season_id; }), at = sib.indexOf(me), other = sib[at + dir];
    if (other) swapRounds(me.season_id, id, other.id);
  }
  function swapRounds(sid, a, b) {
    var m = $("#rm2-" + sid);
    var evs = state.sel.events, ea = evs.filter(function (e) { return e.id === a; })[0], eb = evs.filter(function (e) { return e.id === b; })[0];
    if (!ea || !eb) return;
    function take(from, to) {
      var u = { starts_at: from.starts_at, lobby_opens_at: from.lobby_opens_at, timezone: from.timezone, round_number: from.round_number };
      if (to.series_id && (to.starts_at !== from.starts_at)) u.is_override = true;
      return u;
    }
    var ua = take(eb, ea), ub = take(ea, eb), la = roundLabel(ea), lb = roundLabel(eb);
    Promise.all([sb.from("events").update(ua).eq("id", a), sb.from("events").update(ub).eq("id", b)]).then(function (rs) {
      var e = rs.filter(function (x) { return x.error; })[0];
      if (e) { msg(m, dbError(e.error), "err"); return; }
      afterRoundMove(sid, "Swapped " + la + " and " + lb + ".", false);
    });
  }
  function byeWeek(sid) {
    var m = $("#rm2-" + sid), after = $("#bye-" + sid).value, n = Math.round(Number($("#byn-" + sid).value));
    if (!(n >= 1 && n <= 26)) { msg(m, "Enter a whole number of weeks, 1 to 26.", "err"); return; }
    var evs = state.sel.events.filter(function (e) { return e.season_id === sid; }).sort(function (x, y) { return String(x.starts_at || "~").localeCompare(String(y.starts_at || "~")); });
    var at = evs.map(function (e) { return e.id; }).indexOf(after), later = evs.slice(at + 1).filter(function (e) { return e.starts_at && e.timezone; });
    if (!later.length) { msg(m, "There are no dated rounds after that one to move.", "err"); return; }
    var delta = n * 7, moves = [], bad = null;
    later.forEach(function (e) {
      var a = TZ.localText(Date.parse(e.starts_at), e.timezone), r = TZ.zonedToInstant(shiftDate(a.date, delta), a.time, e.timezone);
      if (r.error) { bad = bad || roundLabel(e); return; }
      var upd = { starts_at: r.instant };
      if (e.lobby_opens_at) { var lb = TZ.localText(Date.parse(e.lobby_opens_at), e.timezone), lr = TZ.zonedToInstant(shiftDate(lb.date, delta), lb.time, e.timezone); if (lr.error) { bad = bad || roundLabel(e); return; } upd.lobby_opens_at = lr.instant; }
      if (e.series_id) upd.is_override = true;
      moves.push({ id: e.id, upd: upd });
    });
    if (bad) { msg(m, "Nothing was changed. " + bad + " would land on a time that does not exist or happens twice because the clocks change. Move that round by hand first.", "err"); return; }
    Promise.all(moves.map(function (x) { return sb.from("events").update(x.upd).eq("id", x.id); })).then(function (rs) {
      var e = rs.filter(function (x) { return x.error; })[0];
      if (e) { afterRoundMove(sid, "Some rounds could not be moved: " + dbError(e.error), true); return; }
      afterRoundMove(sid, "Skipped " + n + " week" + (n === 1 ? "" : "s") + ": " + moves.length + " round" + (moves.length === 1 ? "" : "s") + " moved later.", false);
    });
  }
  function saveSeason(id) {
    var m = $("#sm-" + id), name = $("#sn-" + id).value.trim();
    if (!name) { msg(m, "The name cannot be blank.", "err"); return; }
    var old = state.sel.seasons.filter(function (x) { return x.id === id; })[0] || {}, ns = nul($("#ss-" + id).value);
    var delta = old.starts_on && ns && old.starts_on !== ns ? Math.round((Date.parse(ns + "T00:00:00Z") - Date.parse(old.starts_on + "T00:00:00Z")) / 86400000) : 0;
    var moves = [];
    if (delta) {
      var bad = null;
      state.sel.events.filter(function (e) { return e.season_id === id; }).forEach(function (e) {
        var upd = {};
        if (e.starts_at && e.timezone) {
          var a = TZ.localText(Date.parse(e.starts_at), e.timezone), r = TZ.zonedToInstant(shiftDate(a.date, delta), a.time, e.timezone);
          if (r.error) { bad = bad || (roundLabel(e) + " (" + shiftDate(a.date, delta) + " " + a.time + ")"); return; }
          upd.starts_at = r.instant;
          if (e.original_starts_at && !e.is_override) upd.original_starts_at = r.instant;
          if (e.lobby_opens_at) {
            var lb = TZ.localText(Date.parse(e.lobby_opens_at), e.timezone), lr = TZ.zonedToInstant(shiftDate(lb.date, delta), lb.time, e.timezone);
            if (lr.error) { bad = bad || (roundLabel(e) + " lobby"); return; }
            upd.lobby_opens_at = lr.instant;
          }
        }
        if (e.occurrence_date) upd.occurrence_date = shiftDate(e.occurrence_date, delta);
        if (Object.keys(upd).length) moves.push({ id: e.id, upd: upd });
      });
      if (bad) { msg(m, "Nothing was changed. " + bad + " would land on a time that does not exist or happens twice because the clocks change. Move that round by hand first, or pick a different start date.", "err"); return; }
    }
    sb.from("seasons").update({ name: name, starts_on: ns }).eq("id", id).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      Promise.all(moves.map(function (x) { return sb.from("events").update(x.upd).eq("id", x.id); })).then(function (rs) {
        var e2 = rs.filter(function (x) { return x.error; })[0];
        openChamp(state.sel.champ.id);
        setTimeout(function () {
          var mm = $("#sm-" + id); if (!mm) return;
          if (e2) msg(mm, "The season was saved, but some rounds could not be moved: " + dbError(e2.error), "err");
          else if (moves.length) msg(mm, "Saved. " + moves.length + " round" + (moves.length === 1 ? "" : "s") + " moved " + Math.abs(delta) + " day" + (Math.abs(delta) === 1 ? "" : "s") + (delta < 0 ? " earlier" : " later") + ".", "ok");
        }, 600);
      });
    });
  }

  /* ---------- events ---------- */
  function trackById(id) { return (state.tracks || []).filter(function (t) { return t.id === id; })[0] || null; }
  function venueName(t) { return t && t.track_venues && t.track_venues.name ? t.track_venues.name : "Unknown venue"; }
  function isMetric() { return !!(state.league && state.league.units === "metric"); }
  function lenText(km) { km = Number(km); if (!km) return ""; return isMetric() ? km.toFixed(2) + " km" : (km / 1.609344).toFixed(2) + " mi"; }
  function venueOpts(cur) {
    var T = state.tracks || [];
    if (!T.length) return '<option value="">No tracks loaded yet</option>';
    var seen = {}, vs = [];
    T.forEach(function (t) { if (t.venue_id && !seen[t.venue_id]) { seen[t.venue_id] = 1; vs.push({ id: t.venue_id, name: venueName(t) }); } });
    vs.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var cv = trackById(cur); cv = cv && cv.venue_id;
    return '<option value="">Not set</option>' + vs.map(function (v) { return '<option value="' + esc(v.id) + '"' + (cv === v.id ? " selected" : "") + ">" + esc(v.name) + "</option>"; }).join("");
  }
  function layoutOpts(venueId, cur) {
    if (!venueId) return '<option value="">Pick a venue first</option>';
    var L = (state.tracks || []).filter(function (t) { return t.venue_id === venueId; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return '<option value="">Not set</option>' + L.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (cur === t.id ? " selected" : "") + ">" + esc(t.name + (t.is_reverse && !/reverse/i.test(t.name) ? " (reverse)" : "") + (t.length_km ? " · " + lenText(t.length_km) : "")) + "</option>";
    }).join("");
  }
  function refCarOpts(cur) {
    var list = (state.sel.ccopts || []).slice(); if (cur && list.indexOf(cur) < 0) list.push(cur);
    return '<option value="">' + (list.length ? "Not recorded" : "Add cars to the championship first") + "</option>" + list.map(function (n) { return '<option value="' + esc(n) + '"' + (n === cur ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
  }
  function trackFields(k, e) {
    var t = trackById(e.track_layout_id);
    return '<div class="row" style="margin-top:8px"><div class="field grow"><label for="etv-' + k + '">Venue</label><select id="etv-' + k + '">' + venueOpts(e.track_layout_id) + "</select></div>" +
      '<div class="field grow"><label for="etk-' + k + '">Layout</label><select id="etk-' + k + '">' + layoutOpts(t && t.venue_id, e.track_layout_id) + "</select></div>" +
      '</div>' +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="erl-' + k + '">Reference lap</label><input id="erl-' + k + '" style="width:130px" placeholder="1:25.876" autocomplete="off" value="' + esc(e.reference_lap_ms ? fmtMs(e.reference_lap_ms) : "") + '"></div>' +
      '<div class="field grow"><label for="erc-' + k + '">Car used for the reference lap</label><select id="erc-' + k + '">' + refCarOpts(e.reference_car) + '</select></div></div>' +
      '<div class="row" style="margin-top:8px;align-items:flex-end"><div class="field"><span class="lbl">Race length. Fill in one, the others work themselves out</span><div class="row" style="margin-top:4px;align-items:flex-end">' +
      '<div class="field"><label for="ecl-' + k + '">Laps</label><input id="ecl-' + k + '" type="number" min="1" step="1" style="width:90px" placeholder="Eg 23"></div>' +
      '<div class="field"><label for="ect-' + k + '">Total race time</label><input id="ect-' + k + '" style="width:150px" autocomplete="off"' + (e.reference_lap_ms ? ' placeholder="Eg 33 or 32:55"' : ' disabled placeholder="Needs a reference lap"') + '></div>' +
      '<div class="field"><label for="ecd-' + k + '">Total distance (' + (isMetric() ? "km" : "mi") + ')</label><input id="ecd-' + k + '" type="number" min="0" step="any" style="width:150px" autocomplete="off"' + (t ? ' placeholder="Eg 71.5"' : ' disabled placeholder="Needs a layout"') + '></div>' +
      '<button type="button" data-calcapply="' + k + '" disabled>Copy laps to all races below</button></div></div></div>' +
      '<div class="muted" id="ecr-' + k + '" style="margin-top:4px;min-height:1.2em"></div>';
  }
  function raceRow(r, eid) {
    return '<div class="row rrow" data-rid="' + esc(r.id || "") + '" style="margin-top:6px"><div class="field grow"><label>Race</label><input data-rn value="' + esc(r.name || "") + '" placeholder="For example Sprint"></div>' +
      '<div class="field"><label>Laps</label><input data-rl type="number" min="1" style="width:90px" value="' + esc(r.laps == null ? "" : r.laps) + '"></div>' +
      '<div class="field grow"><label>Points system</label><select data-rp>' + pointsOpts(r.points_system_id) + "</select></div>" +
      '<div class="field"><span class="lbl">Distance</span><div style="padding:7px 0" class="muted" data-rd>' + esc(raceDistance(r, eid)) + "</div></div>" +
      '<button type="button" data-rrm>Remove</button></div>';
  }
  function trackLabel(e) { var t = trackById(e.track_layout_id); return t ? venueName(t) + " · " + t.name : ""; }
  // Lap calculator. Laps, total time and total distance are one target: type one and the others fill in.
  // Time needs the reference lap and distance needs the layout; without them that box stays blank.
  var calcLaps = {};
  function parseRaceTime(v) { v = (v || "").trim(); if (!v) return null; if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 60000); var r = parseMs(v); return r == null || !isFinite(r) || r <= 0 ? NaN : r; }
  function calcUpdate(k, from) {
    var g = function (p) { return document.getElementById(p + "-" + k); };
    var out = g("ecr"), btn = document.querySelector('[data-calcapply="' + k + '"]'); if (!out) return;
    var ref = parseLap(g("erl").value); if (ref !== null && !isFinite(ref)) ref = null;
    var len = layoutLen(k), laps = 0, hint = "";
    var tEl = g("ect"), dEl = g("ecd");
    tEl.disabled = !ref; tEl.placeholder = ref ? "Eg 33 or 32:55" : "Needs a reference lap";
    dEl.disabled = !len; dEl.placeholder = len ? "Eg 71.5" : "Needs a layout";
    if (from === "ecl") laps = Math.round(Number(g("ecl").value)) || 0;
    else if (from === "ect") { var tm = parseRaceTime(g("ect").value); if (tm && isFinite(tm)) { if (ref) laps = Math.max(1, Math.round(tm / ref)); else hint = "Enter a reference lap first"; } }
    else if (from === "ecd") { var d = numOrNull(g("ecd").value); if (d) { if (len) laps = Math.max(1, Math.round((isMetric() ? d : d * 1.609344) / len)); else hint = "Pick a layout first"; } }
    else laps = calcLaps[k] || 0;   // reference lap or layout changed: keep the laps, redo the rest
    calcLaps[k] = laps;
    if (from !== "ecl") g("ecl").value = laps || "";
    if (from !== "ect") g("ect").value = laps && ref ? fmtMs(Math.round(laps * ref / 1000) * 1000).replace(/\.\d+$/, "").replace(/^0(?=\d:)/, "") : "";
    if (from !== "ecd") g("ecd").value = laps && len ? (function (km) { return isMetric() ? km.toFixed(1) : (km / 1.609344).toFixed(1); })(laps * len) : "";
    if (!hint && laps && !ref) hint = "Add a reference lap to see the total time.";
    if (!hint && laps && !len) hint = "Pick a layout to see the distance.";
    out.textContent = hint; out.dataset.laps = laps || ""; if (btn) btn.disabled = !laps;
  }
  function layoutLen(eid) { var sel = document.getElementById("etk-" + eid), t = trackById(sel ? sel.value : (state.sel.events.filter(function (e) { return e.id === eid; })[0] || {}).track_layout_id); return t && Number(t.length_km) ? Number(t.length_km) : 0; }
  function raceDistance(r, eid) {
    var len = layoutLen(eid); if (!len || !r.laps) return "";
    var km = len * r.laps; return "≈ " + (isMetric() ? km.toFixed(1) + " km" : (km / 1.609344).toFixed(1) + " mi");
  }
  function refreshDistances(eid) {
    var box = document.getElementById("rc-" + eid); if (!box) return;
    box.querySelectorAll(".rrow").forEach(function (row) { var l = numOrNull(row.querySelector("[data-rl]").value); row.querySelector("[data-rd]").textContent = raceDistance({ laps: l }, eid); });
  }
  function racesBlock(e) {
    var rs = state.sel.races.filter(function (r) { return r.event_id === e.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; });
    return '<h3>Races in this round</h3><div id="rc-' + e.id + '">' + rs.map(function (r) { return raceRow(r, e.id); }).join("") + '</div><div style="margin-top:8px"><button type="button" data-radd="' + e.id + '">Add a race</button></div>';
  }
  function eventFields(k, e) {
    var loc = e.starts_at && e.timezone ? TZ.localText(Date.parse(e.starts_at), e.timezone) : { date: "", time: "" };
    var lob = e.lobby_opens_at && e.timezone ? TZ.localText(Date.parse(e.lobby_opens_at), e.timezone) : { date: "", time: "" };
    return trackFields(k, e) +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="er-' + k + '">Round</label><input id="er-' + k + '" type="number" min="1" style="width:80px" value="' + esc(e.round_number == null ? "" : e.round_number) + '"></div>' +
      '<div class="field"><label for="ed-' + k + '">Date</label><input id="ed-' + k + '" type="date" value="' + esc(loc.date) + '"></div>' +
      '<div class="field"><label for="el-' + k + '">Lobby opens (optional)</label><input id="el-' + k + '" type="time" value="' + esc(lob.time) + '"></div>' +
      '<div class="field"><label for="et-' + k + '">Race start</label><input id="et-' + k + '" type="time" value="' + esc(loc.time) + '"></div>' +
      '<div class="field grow"><span class="lbl">Time zone</span><div id="ez-' + k + '" style="padding:7px 0">' + esc(e.timezone || champZone() || "Set the league time zone first") + (e.timezone && champZone() && e.timezone !== champZone() ? ' <span class="muted">(differs from the league zone)</span>' : "") + "</div></div></div>" +
      (e.id ? '<div class="row" style="margin-top:8px"><div class="field"><label for="eu-' + k + '">Status</label><select id="eu-' + k + '">' + opts([["scheduled", "Scheduled"], ["cancelled", "Cancelled"], ["completed", "Completed"]], e.status, "").replace('<option value=""></option>', "") + "</select></div></div>" : "") +
      '<div class="row" style="margin-top:8px"><div class="field"><label for="eb-' + k + '">Bonus round</label><label style="display:flex;gap:6px;align-items:center;padding:7px 0"><input id="eb-' + k + '" type="checkbox"' + (e.is_bonus ? " checked" : "") + "> Counts as a bonus round</label></div></div>" +
      '<div class="field" style="margin-top:8px"><label for="eo-' + k + '">Notes for racers (tire wear, damage, weather and anything else)</label><textarea id="eo-' + k + '">' + esc(e.notes || "") + "</textarea></div>";
  }
  function eventHtml(e) {
    var when = "Date and time not set";
    if (e.starts_at && e.timezone) {
      var a = TZ.localText(Date.parse(e.starts_at), e.timezone), b = TZ.localText(Date.parse(e.starts_at), viewerTz);
      var lb = e.lobby_opens_at ? TZ.localText(Date.parse(e.lobby_opens_at), e.timezone).time : "";
      when = a.date + " " + (lb ? "lobby " + lb + ", race " : "") + a.time + " " + e.timezone + (viewerTz !== e.timezone ? " (your time: " + b.date + " " + b.time + ")" : "");
    }
    return '<details class="ev"><summary><span><b>' + (e.round_number ? "Round " + esc(e.round_number) + " · " : "") + esc(trackLabel(e) || e.name || "Round") + (e.is_bonus ? ' <span class="pill">bonus</span>' : "") + '</b> <span class="pill">' + esc(e.status) + '</span></span><span class="muted">' + esc(when) + "</span></summary>" +
      '<div style="margin-top:10px">' + eventFields(e.id, e) + racesBlock(e) +
      '<div class="row" style="margin-top:8px"><button class="primary" data-es="' + e.id + '" type="button">Save round</button><button type="button" data-cancel="reset">Cancel</button><button class="danger" data-ed="' + e.id + '" type="button">Delete round</button></div><div class="msg" id="em-' + e.id + '"></div></div></details>';
  }
  function readEvent(k, m) {
    var d = $("#ed-" + k).value, t = $("#et-" + k).value, ev = state.sel.events.filter(function (x) { return x.id === k; })[0];
    var z = (ev && ev.timezone) || champZone() || "";
    var out = { round_number: numOrNull($("#er-" + k).value), notes: nul($("#eo-" + k).value), track_layout_id: nul($("#etk-" + k).value), is_bonus: $("#eb-" + k).checked };
    var rl = parseLap($("#erl-" + k).value);
    if (rl !== null && !isFinite(rl)) { msg(m, "The reference lap should look like 1:25.876.", "err"); return null; }
    if (rl !== null || (ev && ev.reference_lap_ms != null)) out.reference_lap_ms = rl;
    var rc = nul($("#erc-" + k).value); if (rc !== null || (ev && ev.reference_car != null)) out.reference_car = rc;
    var lt = $("#el-" + k).value, any = d || t;
    if (lt && !t) { msg(m, "Set the race start time as well as the lobby time.", "err"); return null; }
    if (any) {
      if (!z) { msg(m, "Set the league time zone at the top of this page and save first.", "err"); return null; }
      if (!d || !t) { msg(m, "Set the date and the start time together, or leave both blank.", "err"); return null; }
      var r = TZ.zonedToInstant(d, t, z);
      if (r.error === "nonexistent") { msg(m, "That time does not exist in " + z + " on that date, because the clocks skip forward. Pick another time.", "err"); return null; }
      if (r.error === "ambiguous") { msg(m, "That time happens twice in " + z + " on that date, because the clocks go back. Pick a time outside that hour.", "err"); return null; }
      if (r.error) { msg(m, "The date, time or time zone is not valid.", "err"); return null; }
      out.starts_at = r.instant; out.timezone = z;
      if (lt) {
        if (lt > t) { msg(m, "The lobby must open at or before the race start, on the same day.", "err"); return null; }
        var lr = TZ.zonedToInstant(d, lt, z);
        if (lr.error) { msg(m, "The lobby time is not valid in " + z + " on that date (the clocks change around then). Pick another time.", "err"); return null; }
        out.lobby_opens_at = lr.instant;
      } else if (ev && ev.lobby_opens_at) out.lobby_opens_at = null;
    } else {
      if (ev && ev.lobby_opens_at) out.lobby_opens_at = null; out.starts_at = null; out.timezone = null; }
    return out;
  }
  function addEvent(sid) {
    var k = "new-" + sid, m = $("#em-" + k), v = readEvent(k, m); if (!v) return;
    v.season_id = sid;
    var rows = readRaces(k, m); if (!rows) return;
    sb.from("events").insert(v).select("id").then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      var eid = r.data && r.data[0] && r.data[0].id;
      (eid && rows.length ? sb.from("races").insert(rows.map(function (x) { return { event_id: eid, sort_order: x.sort_order, name: x.name, laps: x.laps, points_system_id: x.points_system_id }; })) : Promise.resolve({})).then(function (rr) {
        if (rr.error) { msg(m, "The round was created, but its races could not be added: " + dbError(rr.error), "err"); return; }
        openChamp(state.sel.champ.id);
      });
    });
  }
  function readRaces(eid, m) {
    var out = [], bad = null;
    document.querySelectorAll("#rc-" + eid + " .rrow").forEach(function (r) {
      var name = r.querySelector("[data-rn]").value.trim(), laps = numOrNull(r.querySelector("[data-rl]").value);
      if (!name) name = "Race " + (out.length + 1);
      if (laps != null && (laps < 1 || Math.floor(laps) !== laps)) { bad = "Laps must be a whole number of 1 or more."; return; }
      out.push({ id: r.dataset.rid || null, name: name, laps: laps, points_system_id: nul(r.querySelector("[data-rp]").value), sort_order: out.length + 1 });
    });
    if (bad) { msg(m, bad, "err"); return null; }
    return out;
  }
  function syncRaces(eid, rows) {
    var keep = rows.filter(function (r) { return r.id; }).map(function (r) { return r.id; });
    var gone = state.sel.races.filter(function (r) { return r.event_id === eid && keep.indexOf(r.id) < 0; }).map(function (r) { return r.id; });
    var ops = [];
    rows.forEach(function (r) {
      var f = { name: r.name, laps: r.laps, points_system_id: r.points_system_id, sort_order: r.sort_order };
      if (r.id) ops.push(sb.from("races").update(f).eq("id", r.id)); else { f.event_id = eid; ops.push(sb.from("races").insert(f)); }
    });
    if (gone.length) ops.push(sb.from("races").delete().in("id", gone));
    return Promise.all(ops).then(function (xs) { var e = xs.filter(function (x) { return x && x.error; })[0]; return e ? e.error : null; });
  }
  function saveEvent(id) {
    var m = $("#em-" + id), v = readEvent(id, m); if (!v) return;
    v.status = $("#eu-" + id).value;
    var old = state.sel.events.filter(function (e) { return e.id === id; })[0];
    // Moving an event that came from a schedule marks it as an override; the original time is kept.
    if (old && old.series_id && old.starts_at !== v.starts_at) v.is_override = true;
    var rr = readRaces(id, m); if (!rr) return;
    sb.from("events").update(v).eq("id", id).then(function (r) {
      if (r.error) { msg(m, dbError(r.error), "err"); return; }
      syncRaces(id, rr).then(function (e2) {
        if (e2) { msg(m, "The round was saved, but its races were not: " + dbError(e2), "err"); return; }
        openChamp(state.sel.champ.id);
      });
    });
  }

  /* ---------- delete (two clicks, no dialog) ---------- */
  function del(table, id, btn) {
    var key = table + id;
    if (armed !== key) { armed = key; btn.textContent = "Click again to delete for good"; return; }
    armed = null;
    sb.from(table).delete().eq("id", id).then(function (r) {
      if (r.error) { btn.textContent = dbError(r.error); return; }
      if (table === "points_systems" && state.pscope === "league") { renderLeaguePoints(); return; }
      openChamp(state.sel.champ.id, table === "seasons" || table === "points_systems" ? { view: "champ" } : undefined);
    });
  }

  /* ---------- drivers, results and standings ---------- */
  var ENG = window.FCMResults;
  function fmtMs(ms) {
    if (ms == null) return "";
    var t = Math.round(ms), h = Math.floor(t / 3600000), m = Math.floor(t % 3600000 / 60000), s = Math.floor(t % 60000 / 1000), r = t % 1000;
    function p(n, w) { return ("00" + n).slice(-w); }
    return (h ? h + ":" : "") + p(m, 2) + ":" + p(s, 2) + "." + ("000" + r).slice(-3);
  }
  // "22:14.742", "1:22:14.742" or "39.328" -> milliseconds. Blank -> null, unreadable -> NaN.
  function parseMs(v) {
    v = (v || "").trim(); if (!v) return null;
    var parts = v.split(":"); if (parts.length > 3) return NaN;
    var secs = Number(parts.pop().replace(",", "."));
    if (!isFinite(secs) || secs < 0) return NaN;
    var ms = secs * 1000, mult = 60;
    while (parts.length) { var n = Number(parts.pop()); if (!isFinite(n) || n < 0 || n % 1) return NaN; ms += n * mult * 1000; mult *= 60; }
    return Math.round(ms);
  }
  // A lap time as typed: "1:25.876", "01:25.876" or "01.25.876" (minutes.seconds.thousandths). Blank -> null, unreadable -> NaN.
  function parseLap(v) {
    v = (v || "").trim(); if (!v) return null;
    var m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,3})$/);
    if (m) { var ms = Number((m[3] + "00").slice(0, 3)); return Number(m[1]) * 60000 + Number(m[2]) * 1000 + ms; }
    var r = parseMs(v); return r != null && r <= 0 ? NaN : r;
  }
  function loadDrivers(done) {
    sb.from("drivers").select("id,display_name,aliases").eq("league_id", state.league.id).order("display_name", { ascending: true }).then(function (r) {
      if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + " Has migration 010 been run?</div>"; return; }
      state.drivers = r.data || []; done();
    });
  }
  function driverByName(name) {
    var n = (name || "").trim().toLowerCase(); if (!n) return null;
    return state.drivers.filter(function (d) { return d.display_name.toLowerCase() === n || (d.aliases || []).some(function (a) { return a.toLowerCase() === n; }); })[0] || null;
  }
  function driverName(id) { var d = state.drivers.filter(function (x) { return x.id === id; })[0]; return d ? d.display_name : "?"; }

  /* ---------- cars: catalogue, saved builds, favourites ---------- */
  var PI_CLASSES = [["E", 100, 300], ["D", 301, 400], ["C", 401, 500], ["B", 501, 600], ["A", 601, 700], ["S", 701, 800], ["R", 801, 900], ["P", 901, 998], ["X", 999, 999]];
  function classOf(pi) { pi = Number(pi); for (var i = 0; i < PI_CLASSES.length; i++) if (pi >= PI_CLASSES[i][1] && pi <= PI_CLASSES[i][2]) return PI_CLASSES[i][0]; return ""; }
  var COUNTRY_TOP = ["USA", "GER", "JPN", "GBR", "ITA"];
  var COUNTRY_NAME = { USA: "United States", GER: "Germany", JPN: "Japan", GBR: "United Kingdom", ITA: "Italy", FRA: "France", AUS: "Australia", KOR: "South Korea", SWE: "Sweden", CHN: "China", AUT: "Austria", CRO: "Croatia", NED: "Netherlands", ESP: "Spain", MEX: "Mexico", DEN: "Denmark", BEL: "Belgium", RSA: "South Africa", UAE: "United Arab Emirates", CAN: "Canada", BRA: "Brazil" };
  var CAR_COLS = "id,make,model,year,nickname,division,country,pi,drivetrain";
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
      (ids.length ? sb.from("championship_cars").select("championship_id,car_id,build_id").in("championship_id", ids) : Promise.resolve({ data: [] })).then(function (r) { state.useCC = r.data || []; done(); });
    });
  }
  /* "Use in championship": writes the same championship_cars rows as the championship's own Cars tab, so there is one list, not two. */
  state.useCC = state.useCC || []; state.useChs = state.useChs || []; state.useCh = state.useCh || "";
  function useChId() { var ok = state.useChs.some(function (c) { return c.id === state.useCh; }); if (!ok) state.useCh = state.useChs.length ? state.useChs[0].id : ""; return state.useCh; }
  function useChName() { var c = state.useChs.filter(function (x) { return x.id === useChId(); })[0]; return c ? c.name : ""; }
  function usedIn(kind, id) { var names = []; state.useCC.forEach(function (x) { if ((kind === "car" ? x.car_id : x.build_id) === id) { var c = state.useChs.filter(function (y) { return y.id === x.championship_id; })[0]; if (c) names.push(c.name); } }); return names; }
  function useRowHtml() {
    if (!state.useChs.length) return '<p class="muted" style="margin:10px 0 0">Create a championship to use cars in it.</p>';
    useChId();
    return '<div class="row" style="margin-top:10px;align-items:flex-end"><div class="field"><label for="cuse">Championship</label><select id="cuse">' + state.useChs.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === state.useCh ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + '</select></div><button type="button" id="cusebtn">Use this car in the championship</button></div><div class="muted" id="cin" style="margin-top:4px"></div>';
  }
  function updateCin() { var el = $("#cin"); if (!el) return; var n = state.cpick ? usedIn("car", state.cpick) : []; el.textContent = n.length ? "Stock car in: " + n.join(", ") : ""; }
  function useIn(kind, id) {
    var ch = useChId(), nm = useChName(); if (!ch || !id) return;
    var row = { championship_id: ch }; row[kind === "car" ? "car_id" : "build_id"] = id;
    sb.from("championship_cars").insert(row).select("championship_id,car_id,build_id").single().then(function (r) {
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
  function filterCars(f0) {
    var f = f0 || state.cf, q = f.q.trim().toLowerCase(), fav = favSet("car");
    var out = state.carsAll.filter(function (c) {
      if (q && (carFull(c) + " " + (c.nickname || "")).toLowerCase().indexOf(q) < 0) return false;
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
          '<div class="muted" style="min-width:110px">' + esc((b.class_letter || "") + " " + (b.pi || "")).trim() + '</div><span class="pill">' + esc(b.status) + "</span>" +
          (state.useChs.length ? '<button type="button" data-usebuild="' + esc(b.id) + '">Use in ' + esc(useChName()) + "</button>" : "") + '<button type="button" data-openbuild="' + esc(b.id) + '">Open</button><button class="danger" type="button" data-delbuild="' + esc(b.id) + '">Delete</button></div>';
      }).join("") : '<p class="muted">No saved builds yet. Open the Stock cars tab, find a car and press Build this car.</p>');
  }
  function renderCars() { loadCarsData(renderCarsBody); }
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
    return '<div id="' + pre + 'filt"><div class="row" style="align-items:flex-end"><div class="field grow"><label for="' + pre + 'q">Search the catalogue</label><input id="' + pre + 'q" value="' + esc(f.q) + '" placeholder="For example Mustang, 1991, NASCAR" autocomplete="off"></div>' +
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
  function freshCarFilter(keep) { return { q: keep || "", cls: "", div: "", make: "", yf: "", yt: "", country: "", drive: "", fav: false, letters: "", sort: "make", dir: "asc", shown: CARS_SHOWN }; }
  function bindCarFilter(f, pre, changed, reset) {
    function wire(id, key, kind) { var el = document.getElementById(pre + id); if (!el) return; el.addEventListener(kind, function () { f[key] = el.type === "checkbox" ? el.checked : el.value; changed(); }); }
    wire("q", "q", "input"); wire("c", "cls", "change"); wire("d", "drive", "change"); wire("fav", "fav", "change"); wire("div", "div", "change"); wire("mk", "make", "change");
    wire("co", "country", "change"); wire("yf", "yf", "input"); wire("yt", "yt", "input"); wire("sort", "sort", "change");
    var root = document.getElementById(pre + "filt"); if (!root) return;
    root.querySelectorAll("[data-let]").forEach(function (x) { x.addEventListener("click", function () {
      f.letters = x.dataset.let; root.querySelectorAll("[data-let]").forEach(function (y) { var on = y.dataset.let === f.letters; y.setAttribute("aria-pressed", on ? "true" : "false"); y.className = on ? "primary" : ""; }); changed(); }); });
    var fd = document.getElementById(pre + "dir"); if (fd) fd.addEventListener("click", function () { f.dir = f.dir === "desc" ? "asc" : "desc"; fd.textContent = f.dir === "desc" ? "Z to A ↓" : "A to Z ↑"; changed(); });
    var fr = document.getElementById(pre + "reset"); if (fr) fr.addEventListener("click", function () { var keep = f.q; Object.keys(f).forEach(function (k) { delete f[k]; }); Object.assign(f, freshCarFilter(keep)); reset(); });
  }
  function renderCarsBody() {
    var f = state.cf, b = state.bf, pk = pickOptsHtml(), fav = favSet("car");
    var clsList = PI_CLASSES.map(function (c) { return [c[0], c[0]]; });
    var h = navHtml("k") + '<div class="card"><h2 style="font-size:18px;margin:0">Cars</h2><p class="muted" style="margin:4px 0 10px">Search the catalogue and pick a car to see its stats. Press Modify to start a build sheet for it. It starts as a draft with the car\'s stock class, PI, engine, power, torque and weight filled in and every part on Stock.</p>' +
      carFilterHtml(f, "f") +
      '<div class="row" style="margin-top:12px;align-items:flex-end">' +
      '<div class="field grow"><label for="carsel">Car</label><select id="carsel">' + pk.html + "</select></div>" +
      '<button type="button" id="cfavsel" aria-label="Favourite this car" style="min-width:40px;font-size:18px">' + (fav[state.cpick] ? "★" : "☆") + '</button>' +
      '<button type="button" id="caddcmp">Compare +</button><button class="primary" type="button" id="caddbuild">Modify</button></div>' +
      '<div class="muted" id="cpicknote" style="margin-top:6px">' + esc(pk.note) + '</div>' + useRowHtml() + '<div id="cstats"></div>' +
      '<div class="msg" id="cmsg"></div></div>' +
      '<div id="cmpbox" style="margin:14px 0"></div><div class="card"><h2 style="font-size:18px;margin:0 0 8px">Saved build sheets (' + state.builds.length + ")</h2>" +
      '<div class="row" style="align-items:flex-end"><div class="field grow"><label for="bq">Search</label><input id="bq" value="' + esc(b.q) + '" placeholder="Build name or car" autocomplete="off"></div>' +
      '<div class="field"><label for="bc">Class</label><select id="bc">' + selOpts(clsList, b.cls, "Any") + "</select></div>" +
      '<div class="field"><label for="bsort">Sort by</label><select id="bsort">' + [["name", "Name"], ["pi", "PI"], ["updated", "Last changed"]].map(function (o) { return '<option value="' + o[0] + '"' + (b.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></div>' +
      '<button type="button" id="bdir">' + (b.dir === "desc" ? "Z to A ↓" : "A to Z ↑") + '</button>' +
      '<div class="field"><label for="bfav">Favourites</label><label style="display:flex;gap:6px;align-items:center;padding:7px 0"><input id="bfav" type="checkbox"' + (b.fav ? " checked" : "") + "> Only favourites</label></div></div>" +
      '<div id="clist">' + buildListHtml() + "</div></div>";
    app.innerHTML = h; bindNav(); bindCars(); drawCmp("cars");
  }
  function bindCars() {
    var f = state.cf, b = state.bf;
    function repick() {
      var pk = pickOptsHtml(), sel = $("#carsel"), fav = favSet("car");
      sel.innerHTML = pk.html; $("#cpicknote").textContent = pk.note; $("#cfavsel").textContent = fav[state.cpick] ? "★" : "☆"; showStats();
    }
    function relist() { var box = $("#clist"); if (box) { box.innerHTML = buildListHtml(); bindCarList(); } }
    function wire(id, obj, key, kind, after) {
      var el = document.getElementById(id); if (!el) return;
      el.addEventListener(kind || "input", function () { obj[key] = el.type === "checkbox" ? el.checked : el.value; after(); });
    }
    bindCarFilter(f, "f", repick, renderCarsBody);
    wire("bq", b, "q", "input", relist); wire("bc", b, "cls", "change", relist); wire("bsort", b, "sort", "change", relist); wire("bfav", b, "fav", "change", relist);
    $("#carsel").addEventListener("change", function () { state.cpick = $("#carsel").value; $("#cfavsel").textContent = favSet("car")[state.cpick] ? "★" : "☆"; showStats(); });
    var ub = $("#cusebtn"); if (ub) ub.addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } useIn("car", state.cpick); });
    var us = $("#cuse"); if (us) us.addEventListener("change", function () { state.useCh = us.value; relist(); });
    $("#caddcmp").addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } cmpToggle("car:" + state.cpick, true); drawCmp("cars"); });
    $("#caddbuild").addEventListener("click", function () { if (!state.cpick) { msg($("#cmsg"), "Pick a car first.", "err"); return; } startBuild(state.cpick); });
    $("#cfavsel").addEventListener("click", function () {
      if (!state.cpick) return; var id = state.cpick;
      toggleFav("car:" + id, function () { repick(); });
    });
    var bd = $("#bdir"); if (bd) bd.addEventListener("click", function () { b.dir = b.dir === "desc" ? "asc" : "desc"; bd.textContent = b.dir === "desc" ? "Z to A ↓" : "A to Z ↑"; relist(); });
    bindCarList(); showStats();
  }
  function bindCarList() {
    app.querySelectorAll("[data-star]").forEach(function (x) { x.addEventListener("click", function () { toggleFav(x.dataset.star); }); });
    app.querySelectorAll("[data-cmpbuild]").forEach(function (x) { x.addEventListener("change", function () { cmpToggle("build:" + x.dataset.cmpbuild, x.checked); drawCmp("cars"); }); });
    app.querySelectorAll("[data-usebuild]").forEach(function (x) { x.addEventListener("click", function () { useIn("build", x.dataset.usebuild); }); });
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
      state.editor = { buildId: id, carId: r.data.car_id, data: r.data.data, name: r.data.name, dirty: false }; renderBuildEditor();
    });
  }
  /* Compare: any number of stock cars and saved builds, shown two across and as many rows as needed. */
  state.cmp = state.cmp || []; state.buildFull = state.buildFull || {}; state.cmpq = state.cmpq || "";
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
    app.innerHTML = navHtml("k") + '<p><button type="button" id="bback">← Cars</button></p><iframe id="bsframe" title="Build sheet" src="builds/sheet.html" style="width:100%;height:700px;border:0;background:transparent"></iframe><div id="cmpbox" style="margin-top:14px"></div>';
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
    if (m.fcm === "ready") post(E.car ? { fcm: "new", car: E.car, name: E.name || "" } : { fcm: "load", data: E.data, name: E.name });
    else if (m.fcm === "height" && m.h) fr.style.height = Math.max(400, Math.min(m.h + 24, 20000)) + "px";
    else if (m.fcm === "dirty") E.dirty = true;
    else if (m.fcm === "save") saveBuild(m, post);
    else if (m.fcm === "delete") {
      if (!E.buildId) { state.editor = null; renderCars(); return; }
      sb.from("build_sheets").delete().eq("id", E.buildId).then(function (r) {
        if (r.error) { post({ fcm: "error", message: dbError(r.error) }); return; }
        state.editor = null; renderCars();
      });
    }
  });
  function saveBuild(m, post) {
    var E = state.editor, d = m.data || {}, name = String(m.name || "").trim();
    if (!name) { post({ fcm: "error", message: "Give the build a name first." }); return; }
    var row = { name: name, status: d.done ? "completed" : "draft", class_letter: /^[A-Z]$/.test(d.cls || "") ? d.cls : null, pi: d.pi ? Math.max(0, Math.min(999, Math.round(Number(d.pi)))) : null, data: d };
    var q = (m.copy || !E.buildId) ? sb.from("build_sheets").insert(Object.assign({ league_id: state.league.id, car_id: E.carId }, row)).select("id").single()
      : sb.from("build_sheets").update(row).eq("id", E.buildId).select("id").single();
    q.then(function (r) {
      if (r.error) { post({ fcm: "error", message: r.error.code === "23505" ? "Another build in this league already has that name. Pick a different name." : dbError(r.error) }); return; }
      E.buildId = r.data.id; E.name = name; E.car = null; E.data = d; E.dirty = false; post({ fcm: "saved", name: name });
    });
  }
  /* A championship's cars: stock (catalogue) and custom (saved builds) */
  function champCarsHtml() { return '<div class="card"><h2>Cars</h2><p class="muted" style="margin:0 0 8px">The cars racers can use in this championship. Stock cars are unmodified. Custom builds come from the league\'s Cars page.</p><div id="cc" class="muted">Loading…</div></div>'; }
  function fillChampCars() {
    var cid = state.sel.champ.id, lid = state.league.id, box = $("#cc"); if (!box) return;
    var catP = state.carsAll ? Promise.resolve({ data: state.carsAll }) : fetchAllCars();
    Promise.all([catP, sb.from("championship_cars").select("id,car_id,build_id").eq("championship_id", cid), sb.from("build_sheets").select("id,name,status,class_letter,pi,car_id").eq("league_id", lid).order("name", { ascending: true }),
      sb.from("league_favourites").select("id,car_id,build_id").eq("league_id", lid)]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) { box.className = "err"; box.textContent = dbError(bad.error) + " Has migration 014 been run?"; return; }
      state.carsAll = rs[0].data || []; state.cc = rs[1].data || []; state.builds = rs[2].data || []; state.favs = rs[3].data || [];
      drawChampCars();
    });
  }
  state.ccf = state.ccf || freshCarFilter();
  function drawChampCars() {
    var box = $("#cc"); if (!box) return;
    var byCar = {}, byBuild = {}; state.carsAll.forEach(function (c) { byCar[c.id] = c; }); state.builds.forEach(function (b) { byBuild[b.id] = b; });
    var stock = state.cc.filter(function (x) { return x.car_id; }), custom = state.cc.filter(function (x) { return x.build_id; });
    var usedBuild = {}, inStock = {}; custom.forEach(function (x) { usedBuild[x.build_id] = 1; }); stock.forEach(function (x) { inStock[x.car_id] = 1; });
    var avail = state.builds.filter(function (b) { return !usedBuild[b.id]; });
    var favB = favSet("build"), f = state.ccf; state.sel.ccopts = carOptLabels(state.cc, byCar, byBuild);
    avail.sort(function (a, b) { return (favB[b.id] ? 1 : 0) - (favB[a.id] ? 1 : 0) || a.name.localeCompare(b.name); });
    stock.sort(function (x, y) { var a = byCar[x.car_id], b = byCar[y.car_id]; return a && b ? (a.make + " " + a.model).localeCompare(b.make + " " + b.model) || a.year - b.year : 0; });
    var divs = uniq(state.carsAll.map(function (c) { return c.division; })).sort();
    box.className = "";
    box.innerHTML = '<h3 style="margin-top:0">Stock unmodified (' + stock.length + ")</h3>" +
      (stock.length ? '<details' + (stock.length <= 12 ? " open" : "") + '><summary class="muted" style="cursor:pointer">Show the ' + stock.length + ' stock cars</summary>' + stock.map(function (x) { var c = byCar[x.car_id]; return '<div class="row" style="align-items:center;margin:4px 0"><div class="grow"><b>' + esc(c ? carName(c) : "Unknown car") + '</b> <span class="muted">' + esc(c ? carFull(c) + " · " + classOf(c.pi) + " " + c.pi : "") + '</span></div><button type="button" data-ccrm="' + esc(x.id) + '">Remove</button></div>'; }).join("") + '<div style="margin-top:8px"><button type="button" class="danger" id="ccrmall">Remove all stock cars</button></div></details>' : '<p class="muted">None yet.</p>') +
      '<h3>Custom built (' + custom.length + ")</h3>" +
      (custom.length ? custom.map(function (x) { var b = byBuild[x.build_id], c = b && byCar[b.car_id]; return '<div class="row" style="align-items:center;margin:4px 0"><div class="grow"><b>' + esc(b ? b.name : "Unknown build") + '</b> <span class="muted">' + esc((c ? carFull(c) : "") + (b && b.pi ? " · " + (b.class_letter || "") + " " + b.pi : "")) + '</span></div><button type="button" data-ccrm="' + esc(x.id) + '">Remove</button></div>'; }).join("") : '<p class="muted">None yet.</p>') +
      '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><div class="muted" style="margin-bottom:6px">Add stock cars. Search and filter the same way as the Cars tab, then add one car or everything that matches.</div>' + carFilterHtml(f, "g") +
      '<div class="row" style="margin-top:12px;align-items:flex-end"><div class="field grow"><label for="ccsel">One car</label><select id="ccsel"></select></div><button class="primary" type="button" id="ccaddone">Add this car</button></div>' +
      '<div class="muted" id="ccnote" style="margin-top:6px"></div>' +
      '<div class="row" style="margin-top:10px;align-items:flex-end"><div class="field grow"><label for="ccdiv">A whole division</label><select id="ccdiv">' + selOpts(divs, "", "Choose a division") + '</select></div><button type="button" id="ccadddiv">Add the whole division</button></div>' +
      '<div class="row" style="margin-top:10px"><button type="button" id="ccaddall">Add all matching the search and filters</button></div></div>' +
      '<div class="row" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line);align-items:flex-end"><div class="field grow"><label for="ccb">Add a custom build</label><select id="ccb">' + (avail.length ? selOpts(avail.map(function (b) { return [b.id, (favB[b.id] ? "★ " : "") + b.name]; }), "", "Choose a build") : '<option value="">No more builds to add</option>') + '</select></div><button type="button" id="ccbadd">Add</button></div><div class="msg" id="ccm"></div>';

    function remaining() { return filterCars(f).filter(function (c) { return !inStock[c.id]; }); }
    function repickCC() {
      var rows = remaining(), shown = rows.slice(0, PICK_MAX), fav = favSet("car");
      $("#ccsel").innerHTML = shown.length ? shown.map(function (c) { return '<option value="' + esc(c.id) + '">' + (fav[c.id] ? "★ " : "") + esc(carName(c) + " · " + classOf(c.pi) + " " + c.pi) + "</option>"; }).join("") : '<option value="">No cars match</option>';
      $("#ccnote").textContent = rows.length + " car" + (rows.length === 1 ? "" : "s") + " match and " + (rows.length === 1 ? "is" : "are") + " not in the championship yet." + (rows.length > shown.length ? " Showing the first " + shown.length + " in the list." : "");
      $("#ccaddall").textContent = "Add all " + rows.length + " matching the search and filters"; $("#ccaddall").disabled = !rows.length;
    }
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
    function add(row) { msg($("#ccm"), "Adding…"); sb.from("championship_cars").insert(Object.assign({ championship_id: state.sel.champ.id }, row)).select("id,car_id,build_id").single().then(function (r) { if (r.error) { msg($("#ccm"), r.error.code === "23505" ? "That car is already in this championship." : dbError(r.error), "err"); return; } state.cc.push(r.data); drawChampCars(); }); }
    bindCarFilter(f, "g", repickCC, drawChampCars); repickCC();
    box.querySelectorAll("[data-ccrm]").forEach(function (x) { x.addEventListener("click", function () { sb.from("championship_cars").delete().eq("id", x.dataset.ccrm).then(function (r) { if (r.error) { msg($("#ccm"), dbError(r.error), "err"); return; } state.cc = state.cc.filter(function (y) { return y.id !== x.dataset.ccrm; }); drawChampCars(); }); }); });
    var ra = $("#ccrmall"); if (ra) ra.addEventListener("click", function () {
      if (!window.confirm("Remove all " + stock.length + " stock cars from this championship? Custom builds stay.")) return;
      sb.from("championship_cars").delete().eq("championship_id", state.sel.champ.id).not("car_id", "is", null).then(function (r) { if (r.error) { msg($("#ccm"), dbError(r.error), "err"); return; } state.cc = state.cc.filter(function (y) { return !y.car_id; }); drawChampCars(); });
    });
    $("#ccaddone").addEventListener("click", function () { var v = $("#ccsel").value; if (v) add({ car_id: v }); else msg($("#ccm"), "Pick a car first.", "err"); });
    $("#ccaddall").addEventListener("click", function () { bulk(remaining(), "everything that matches the search and filters"); });
    $("#ccadddiv").addEventListener("click", function () {
      var d = $("#ccdiv").value; if (!d) { msg($("#ccm"), "Choose a division first.", "err"); return; }
      bulk(state.carsAll.filter(function (c) { return c.division === d && !inStock[c.id]; }), d);
    });
    $("#ccbadd").addEventListener("click", function () { var v = $("#ccb").value; if (v) add({ build_id: v }); });
  }

  /* Tracks: a read-only reference library of every venue and its layouts. */
  state.tf = state.tf || { q: "", country: "", kind: "" };
  function renderTracks() {
    app.innerHTML = navHtml("t") + '<div class="card muted">Loading tracks…</div>'; bindNav();
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
    app.innerHTML = navHtml("t") + '<div class="card"><h2 style="font-size:18px;margin:0">Tracks</h2><p class="muted" style="margin:4px 0 10px">Every venue and its layouts, with background where we have it. Lengths follow the league units.</p>' +
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
  function renderDrivers() { loadDrivers(renderDriversBody); }
  function renderDriversBody() {
    app.innerHTML = navHtml("l", "d") + '<div class="card"><h2>Drivers</h2><p class="muted" style="margin:0 0 8px">The league\'s drivers. Use the name exactly as the game shows it. Other names are spellings the screenshot scan or you might use for the same person; results entry matches on either.</p>' +
      (state.drivers.length ? state.drivers.map(function (d) {
        return '<div class="row" data-did="' + esc(d.id) + '" style="align-items:flex-end;margin:6px 0"><div class="field grow"><label>Name in the game</label><input data-dn value="' + esc(d.display_name) + '"></div>' +
          '<div class="field grow"><label>Other names (comma separated)</label><input data-da value="' + esc((d.aliases || []).join(", ")) + '"></div>' +
          '<button type="button" data-dsave>Save</button><button type="button" data-cancel="drivers">Cancel</button><button type="button" class="danger" data-ddel>Delete</button></div>';
      }).join("") : '<p class="muted">No drivers yet. They are also added automatically when you type a new name in results entry.</p>') + '<div class="msg" id="dm"></div></div>' +
      '<div class="card"><h3 style="margin-top:0">Add a driver</h3><div class="row"><div class="field grow"><label for="dnew">Name in the game</label><input id="dnew"></div><button class="primary" id="dadd" type="button">Add</button></div><div class="msg" id="dam"></div></div>';
    bindNav();
    function aliasList(v) { return v.split(",").map(function (x) { return x.trim(); }).filter(function (x) { return x; }); }
    app.querySelectorAll("[data-dsave]").forEach(function (b) { b.addEventListener("click", function () {
      var row = b.closest("[data-did]"), name = row.querySelector("[data-dn]").value.trim();
      if (!name) { msg($("#dm"), "A driver needs a name.", "err"); return; }
      sb.from("drivers").update({ display_name: name, aliases: aliasList(row.querySelector("[data-da]").value) }).eq("id", row.dataset.did).then(function (r) { msg($("#dm"), r.error ? dbError(r.error) : "Saved.", r.error ? "err" : "ok"); });
    }); });
    app.querySelectorAll("[data-ddel]").forEach(function (b) { b.addEventListener("click", function () {
      var row = b.closest("[data-did]"), key = "dd" + row.dataset.did;
      if (armed !== key) { armed = key; b.textContent = "Click again to delete"; return; }
      armed = null;
      var did = row.dataset.did;
      if (b.dataset.force) {
        sb.from("results").delete().eq("driver_id", did).then(function (r0) {
          if (r0.error) { msg($("#dm"), dbError(r0.error), "err"); return; }
          sb.from("drivers").delete().eq("id", did).then(function (r) {
            if (r.error) { msg($("#dm"), dbError(r.error), "err"); return; }
            renderDrivers();
          });
        });
        return;
      }
      sb.from("drivers").delete().eq("id", did).then(function (r) {
        if (!r.error) { renderDrivers(); return; }
        if (!/foreign key|violates/i.test(r.error.message || "")) { msg($("#dm"), dbError(r.error), "err"); b.textContent = "Delete"; return; }
        sb.from("results").select("id", { count: "exact", head: true }).eq("driver_id", did).then(function (c) {
          var n = c.count == null ? "their" : c.count;
          b.dataset.force = "1"; armed = key;
          b.textContent = "Delete driver and " + n + (n === 1 ? " result" : " results") + "? Click again";
          msg($("#dm"), "This driver has results. Deleting them removes those results from every race and changes the standings. This cannot be undone.", "err");
        });
      });
    }); });
    $("#dadd").addEventListener("click", function () {
      var n = $("#dnew").value.trim(); if (!n) { msg($("#dam"), "Type a name first.", "err"); return; }
      sb.from("drivers").insert({ league_id: state.league.id, display_name: n, aliases: [] }).then(function (r) {
        if (r.error) { msg($("#dam"), /duplicate|unique/i.test(r.error.message || "") ? "There is already a driver with that name." : dbError(r.error), "err"); return; }
        renderDrivers();
      });
    });
  }

  // The points system a race uses, as the scoring engine wants it. Resolves null when none is set.
  function loadSystem(id) {
    if (!id) return Promise.resolve(null);
    return Promise.all([
      sb.from("points_systems").select("*").eq("id", id).single(),
      sb.from("points_table_entries").select("*").eq("points_system_id", id),
      sb.from("points_status_rules").select("*").eq("points_system_id", id),
      sb.from("points_bonuses").select("*").eq("points_system_id", id)
    ]).then(function (rs) {
      var bad = rs.filter(function (r) { return r.error; })[0];
      if (bad) throw bad.error;
      var sys = { id: id, name: rs[0].data.name, table: {}, status: {}, fastestLap: null, dnfRank: !!rs[0].data.dnf_rank_by_best_lap };
      (rs[1].data || []).forEach(function (e) { sys.table[e.position] = Number(e.points); });
      (rs[2].data || []).forEach(function (e) { sys.status[e.status] = Number(e.points); });
      (rs[3].data || []).forEach(function (b) { if (/fastest/i.test(b.name || "") && b.kind === "bonus" && sys.fastestLap == null) sys.fastestLap = Number(b.points); });
      return sys;
    });
  }
  function raceSystemId(race) { return race.points_system_id || state.sel.champ.points_system_id || null; }
  function roundLabel(e) { var n = trackLabel(e) || e.name; return (e.round_number ? "Round " + e.round_number : "") + (e.round_number && n ? " · " : "") + (n || (e.round_number ? "" : "Round")); }

  function resultsTabHtml() {
    var S = state.sel, h = '<div class="card"><h2>Results</h2><p class="muted" style="margin:0 0 6px">Pick a race to enter or correct its results.</p>', any = false;
    S.seasons.forEach(function (season) {
      var evs = S.events.filter(function (e) { return e.season_id === season.id; });
      if (!evs.length) return;
      h += "<h3>" + esc(season.name) + "</h3>";
      evs.forEach(function (e) {
        var rs = S.races.filter(function (r) { return r.event_id === e.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; });
        if (!rs.length) return; any = true;
        h += '<div class="row" style="align-items:center;margin:4px 0"><span style="min-width:200px">' + esc(roundLabel(e)) + "</span>" + rs.map(function (r) {
          return '<button type="button" data-rr="' + esc(r.id) + '">' + esc(r.name || "Race") + ' <span class="muted" data-rc="' + esc(r.id) + '"></span></button>';
        }).join("") + "</div>";
      });
    });
    return h + (any ? "" : '<p class="muted">No races yet. Add a season and rounds first.</p>') + "</div>";
  }
  function fillCounts() {
    var ids = state.sel.races.map(function (r) { return r.id; }); if (!ids.length) return;
    sb.from("results").select("race_id").in("race_id", ids).then(function (r) {
      var c = {}; (r.data || []).forEach(function (x) { c[x.race_id] = (c[x.race_id] || 0) + 1; });
      app.querySelectorAll("[data-rc]").forEach(function (el) { var n = c[el.dataset.rc]; el.textContent = n ? "✓ " + n : ""; });
    });
  }

  var STATUSES = [["finished", "Finished"], ["dnf", "DNF"], ["dns", "DNS"], ["dsq", "DSQ"]];
  function renderRaceResults(rid) {
    var S = state.sel, race = S.races.filter(function (r) { return r.id === rid; })[0];
    if (!race) { state.nav = { view: "champ" }; renderCurrent(); return; }
    app.innerHTML = '<p class="muted">Loading…</p>';
    loadDrivers(function () {
      Promise.all([sb.from("results").select("*").eq("race_id", rid), loadSystem(raceSystemId(race))]).then(function (xs) {
        if (xs[0].error) { app.innerHTML = '<div class="card err">' + esc(dbError(xs[0].error)) + "</div>"; return; }
        var rows = (xs[0].data || []).slice().sort(function (a, b) { return (a.position == null ? 1e9 : a.position) - (b.position == null ? 1e9 : b.position); }).map(function (r) {
          return { driver: driverName(r.driver_id), status: r.status === "other" ? "dns" : r.status, ranked: r.status === "dnf" && r.position != null,
            best: fmtMs(r.best_lap_ms), raceT: fmtMs(r.race_time_ms), pen: r.penalty_ms ? String(r.penalty_ms / 1000) : "", total: fmtMs(r.total_time_ms) };
        });
        state.rr = { race: race, sys: xs[1], rows: rows, dbl: !!race.double_points };
        if (rows.length) { drawRace(); return; }
        // Nothing saved for this race yet: start from the drivers in the most recent earlier race that has results.
        var order = raceOrder(), at = order.map(function (r) { return r.id; }).indexOf(rid), prev = at > 0 ? order.slice(0, at).map(function (r) { return r.id; }) : [];
        (prev.length ? sb.from("results").select("race_id,driver_id,position,status").in("race_id", prev) : Promise.resolve({ data: [] })).then(function (pr) {
          var by = {}; (pr.data || []).forEach(function (x) { (by[x.race_id] = by[x.race_id] || []).push(x); });
          var src = null; for (var k = prev.length - 1; k >= 0; k--) if (by[prev[k]]) { src = by[prev[k]]; break; }
          if (src) {
            src.sort(function (a, b) { return (a.position == null ? 1e9 : a.position) - (b.position == null ? 1e9 : b.position); });
            src.forEach(function (x) { var n = driverName(x.driver_id); if (n) { var b = blankRow(); b.driver = n; rows.push(b); } });
            state.rr.copied = rows.length;
          }
          while (rows.length < 6) rows.push(blankRow());
          drawRace();
        });
      }, function (e) { app.innerHTML = '<div class="card err">' + esc(dbError(e)) + "</div>"; });
    });
  }
  // Every race of the championship in calendar order: rounds by number then start, races by their order within the round.
  function raceOrder() {
    var evs = state.sel.events.slice().sort(function (a, b) { return (a.round_number || 1e9) - (b.round_number || 1e9) || String(a.starts_at || "").localeCompare(String(b.starts_at || "")); }), out = [];
    evs.forEach(function (e) { state.sel.races.filter(function (r) { return r.event_id === e.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; }).forEach(function (r) { out.push(r); }); });
    return out;
  }
  function blankRow() { return { driver: "", status: "finished", ranked: false, best: "", raceT: "", pen: "", total: "" }; }
  function syncRows() {
    var rr = state.rr; if (!rr) return;
    var trs = app.querySelectorAll("tr[data-ri]"); if (!trs.length) return;
    rr.rows = Array.prototype.map.call(trs, function (tr) {
      var old = rr.rows[Number(tr.dataset.ri)] || blankRow(), st = tr.querySelector("[data-f=status]").value;
      return { driver: tr.querySelector("[data-f=driver]").value, status: st, ranked: st === "dnf" && st === old.status ? old.ranked : false,
        best: tr.querySelector("[data-f=best]").value, raceT: tr.querySelector("[data-f=raceT]").value, pen: tr.querySelector("[data-f=pen]").value, total: tr.querySelector("[data-f=total]").value };
    });
    var d = $("#rdbl"); if (d) rr.dbl = d.checked;
  }
  // Grid positions and points from the rows as they stand, in grid order.
  function gridResults() {
    var rr = state.rr, pos = 0, fastest = -1, bestMs = null;
    rr.rows.forEach(function (r, i) { var b = parseMs(r.best); if (r.driver.trim() && b != null && isFinite(b) && (bestMs == null || b < bestMs)) { bestMs = b; fastest = i; } });
    return rr.rows.map(function (r, i) {
      var positioned = r.status === "finished" || (r.status === "dnf" && r.ranked), p = positioned && r.driver.trim() ? ++pos : null;
      var res = { position: p, status: r.status === "finished" ? null : r.status, fastestLap: i === fastest };
      return { position: p, res: res, points: rr.sys && r.driver.trim() ? ENG.resultPoints(rr.sys, res, rr.dbl) : null };
    });
  }
  function refreshGrid() {
    syncRows();
    var g = gridResults();
    app.querySelectorAll("tr[data-ri]").forEach(function (tr) {
      var i = Number(tr.dataset.ri), x = g[i], r = state.rr.rows[i];
      tr.querySelector("[data-pos]").textContent = x.position != null ? x.position : "–";
      tr.querySelector("[data-pts]").textContent = x.points == null ? "" : x.points + (x.res.fastestLap && state.rr.sys && state.rr.sys.fastestLap ? " (FL)" : "");
      var m = !r.driver.trim() ? "" : driverByName(r.driver) ? "" : "new driver";
      tr.querySelector("[data-new]").textContent = m;
    });
  }
  function drawRace() {
    var rr = state.rr, race = rr.race, ev = state.sel.events.filter(function (e) { return e.id === race.event_id; })[0];
    var rowsH = rr.rows.map(function (r, i) {
      return '<tr data-ri="' + i + '"><td data-pos style="text-align:center"></td>' +
        '<td><div style="display:flex;align-items:center;gap:3px;flex-wrap:nowrap"><input data-f="driver" list="dl" value="' + esc(r.driver) + '" placeholder="Type or pick" autocomplete="off" style="min-width:150px;flex:1 1 auto"><select data-pick aria-label="Pick a driver" title="Pick a driver" style="width:34px;flex:0 0 34px"><option value="">▾</option>' + state.drivers.map(function (d) { return '<option value="' + esc(d.display_name) + '">' + esc(d.display_name) + "</option>"; }).join("") + '</select><span class="pill" data-new style="margin-left:4px"></span></div></td>' +
        '<td><select data-f="status">' + STATUSES.map(function (s) { return '<option value="' + s[0] + '"' + (r.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select>" + (r.ranked ? ' <span class="pill">ranked</span>' : "") + "</td>" +
        '<td><input data-f="best" value="' + esc(r.best) + '" placeholder="00:39.328" style="width:92px"></td>' +
        '<td><input data-f="raceT" value="' + esc(r.raceT) + '" placeholder="22:14.742" style="width:104px"></td>' +
        '<td><input data-f="pen" type="number" step="any" min="0" value="' + esc(r.pen) + '" style="width:62px"></td>' +
        '<td><input data-f="total" value="' + esc(r.total) + '" placeholder="22:14.742" style="width:104px"></td>' +
        '<td data-pts style="text-align:right"></td>' +
        '<td style="white-space:nowrap"><button type="button" data-up="' + i + '" title="Move up">↑</button><button type="button" data-dn="' + i + '" title="Move down">↓</button><button type="button" data-rm="' + i + '" title="Remove row">✕</button></td></tr>';
    }).join("");
    state.tab = "results";
    var sibs = state.sel.races.filter(function (r) { return r.event_id === race.event_id; }).sort(function (x, y) { return x.sort_order - y.sort_order; });
    var raceTabs = sibs.length > 1 ? '<div class="row" style="margin:0 0 12px">' + sibs.map(function (r) { return '<button type="button" data-rtab="' + esc(r.id) + '"' + (r.id === race.id ? ' class="primary"' : "") + ">" + esc(r.name || "Race") + "</button>"; }).join("") + "</div>" : "";
    app.innerHTML = champHeadHtml(state.sel.champ, "results") +
      '<div class="card">' + raceTabs + '<h2>' + esc((ev ? roundLabel(ev) + " · " : "") + (race.name || "Race")) + ' results</h2>' +
      '<p class="muted" style="margin:0 0 8px">' + (rr.sys ? "Points system: <b>" + esc(rr.sys.name) + "</b>" + (rr.sys.dnfRank ? ". DNFs are ranked after the finishers by best lap." : ". DNFs score by the system\'s DNF rule.") : '<span class="err">No points system is set for this race or the championship, so points are not calculated.</span>') + "</p>" +
      '<p class="muted" style="margin:0 0 8px">' + (rr.copied ? rr.copied + " driver" + (rr.copied === 1 ? " is" : "s are") + " filled in from the previous race. Remove anyone who is not racing. " : "") + 'Type the rows as the game shows them, in order. Times look like 22:14.742. Penalties are seconds. Position follows the order of the rows; use the arrows to adjust the final grid.</p>' +
      '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th>Pos</th><th style="text-align:left">Driver</th><th>Status</th><th>Best lap</th><th>Race time</th><th>Pen. (s)</th><th>Total</th><th>Points</th><th></th></tr></thead><tbody>' + rowsH + "</tbody></table></div>" +
      '<datalist id="dl">' + state.drivers.map(function (d) { return '<option value="' + esc(d.display_name) + '">'; }).join("") + "</datalist>" +
      '<div class="row" style="margin-top:8px"><button type="button" id="radd">Add a row</button><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="rdbl"' + (rr.dbl ? " checked" : "") + '> Double points for this race</label></div>' +
      '<div class="row" style="margin-top:12px"><button type="button" id="rarr">Arrange final grid</button><button class="primary" id="rsave" type="button">Save results</button><button type="button" data-cancel="back">Cancel</button></div>' +
      '<p class="muted" style="margin:6px 0 0">"Arrange final grid" keeps finishers in the order typed, ranks DNFs after them by best lap when the points system says so (a DNF with no lap time becomes DNS), and marks the fastest lap. You can still move rows before saving.</p>' +
      '<div class="msg" id="rm"></div></div>';
    bindNav();
    app.querySelectorAll("[data-tab]").forEach(function (t) { t.addEventListener("click", function () { state.tab = t.dataset.tab; state.nav = { view: "champ" }; renderCurrent(); }); });
    app.querySelectorAll("[data-rtab]").forEach(function (t) { t.addEventListener("click", function () {
      if (t.dataset.rtab === race.id) return;
      if (rr.dirty && !confirm("You have unsaved changes on this race. Switch anyway?")) return;
      state.nav = { view: "race", rid: t.dataset.rtab }; renderRaceResults(t.dataset.rtab); }); });
    app.querySelectorAll("[data-pick]").forEach(function (sel) { sel.addEventListener("change", function () { if (sel.value) { rr.dirty = true; sel.closest("td").querySelector("[data-f=driver]").value = sel.value; sel.value = ""; refreshGrid(); } }); });
    app.querySelectorAll("tr[data-ri] input, tr[data-ri] select:not([data-pick]), #rdbl").forEach(function (el) {
      el.addEventListener("input", function () { rr.dirty = true; refreshGrid(); });
      el.addEventListener("change", function () { rr.dirty = true; if (el.dataset.f === "status") { syncRows(); drawRace(); } else refreshGrid(); });
    });
    function move(i, d) { syncRows(); var rows = state.rr.rows, j = i + d; if (j < 0 || j >= rows.length) return; var t = rows[i]; rows[i] = rows[j]; rows[j] = t; drawRace(); }
    app.querySelectorAll("[data-up]").forEach(function (b) { b.addEventListener("click", function () { move(Number(b.dataset.up), -1); }); });
    app.querySelectorAll("[data-dn]").forEach(function (b) { b.addEventListener("click", function () { move(Number(b.dataset.dn), 1); }); });
    app.querySelectorAll("[data-rm]").forEach(function (b) { b.addEventListener("click", function () { syncRows(); state.rr.rows.splice(Number(b.dataset.rm), 1); drawRace(); }); });
    $("#radd").addEventListener("click", function () { syncRows(); state.rr.rows.push(blankRow()); drawRace(); });
    $("#rarr").addEventListener("click", arrangeGrid);
    $("#rsave").addEventListener("click", saveRace);
    refreshGrid();
  }
  function arrangeGrid() {
    syncRows();
    var rr = state.rr, old = rr.rows.filter(function (r) { return r.driver.trim(); });
    var entries = old.map(function (r, i) { var b = parseMs(r.best); return { driver: String(i), position: i + 1, status: r.status, bestLapMs: b != null && isFinite(b) ? b : null }; });
    var out = ENG.arrangeRace(entries, { dnfRank: !!(rr.sys && rr.sys.dnfRank) });
    rr.rows = out.map(function (o) { var r = old[Number(o.driver)]; r.status = o.status || "finished"; r.ranked = o.status === "dnf" && o.position != null; return r; });
    drawRace(); msg($("#rm"), "Grid arranged. Check it, then save.", "ok");
  }
  function saveRace() {
    syncRows();
    var rr = state.rr, m = $("#rm"), rows = rr.rows.filter(function (r) { return r.driver.trim(); });
    if (!rows.length) { msg(m, "Enter at least one driver first.", "err"); return; }
    var seen = {}, parsed = [], err = null;
    rows.forEach(function (r, i) {
      var key = r.driver.trim().toLowerCase(), d = driverByName(r.driver);
      if (d) key = d.id;
      if (seen[key]) err = r.driver.trim() + " appears twice."; seen[key] = true;
      var best = parseMs(r.best), rt = parseMs(r.raceT), tot = parseMs(r.total), pen = r.pen.trim() === "" ? null : Number(r.pen);
      if ([best, rt, tot].some(function (v) { return v !== null && !isFinite(v); }) || (pen !== null && (!isFinite(pen) || pen < 0))) err = "Row " + (i + 1) + " (" + r.driver.trim() + "): a time is not in a readable format. Use 22:14.742.";
      parsed.push({ best: best, rt: rt, tot: tot, pen: pen });
    });
    if (err) { msg(m, err, "err"); return; }
    var origRows = rr.rows; rr.rows = rows; var grid = gridResults(); rr.rows = origRows;
    var fresh = [], names = {};
    rows.forEach(function (r) { var n = r.driver.trim(); if (!driverByName(n) && !names[n.toLowerCase()]) { names[n.toLowerCase()] = true; fresh.push(n); } });
    var $s = $("#rsave"); $s.disabled = true; msg(m, "Saving…");
    var fail = function (e) { $s.disabled = false; msg(m, dbError(e), "err"); };
    (fresh.length ? sb.from("drivers").insert(fresh.map(function (n) { return { league_id: state.league.id, display_name: n, aliases: [] }; })).select("id,display_name,aliases") : Promise.resolve({ data: [] })).then(function (dr) {
      if (dr.error) { fail(dr.error); return; }
      (dr.data || []).forEach(function (d) { state.drivers.push(d); });
      var now = new Date().toISOString();
      var out = rows.map(function (r, i) {
        var d = driverByName(r.driver), g = grid[i], p = parsed[i];
        return { race_id: rr.race.id, driver_id: d.id, position: g.position, status: r.status, best_lap_ms: p.best, race_time_ms: p.rt, penalty_ms: p.pen == null ? null : Math.round(p.pen * 1000),
          total_time_ms: p.tot, fastest_lap: !!g.res.fastestLap, points_awarded: g.points, scored_with_system_id: rr.sys ? rr.sys.id : null, scored_at: rr.sys ? now : null };
      });
      sb.from("results").delete().eq("race_id", rr.race.id).then(function (x) {
        if (x.error) { fail(x.error); return; }
        sb.from("results").insert(out).then(function (y) {
          if (y.error) { fail(y.error); return; }
          sb.from("races").update({ double_points: rr.dbl }).eq("id", rr.race.id).then(function (z) {
            if (z.error) { fail(z.error); return; }
            openChamp(state.sel.champ.id, { view: "race", rid: rr.race.id });
            setTimeout(function () { msg($("#rm"), "Saved " + out.length + " results" + (fresh.length ? ". New drivers added: " + fresh.join(", ") : "") + ".", "ok"); }, 600);
          });
        });
      });
    });
  }

  function renderStandings() {
    var S = state.sel, box = $("#stand"); if (!box) return;
    var ids = S.races.map(function (r) { return r.id; });
    if (!ids.length) { box.innerHTML = '<p class="muted">No races yet.</p>'; return; }
    loadDrivers(function () {
      sb.from("results").select("*").in("race_id", ids).then(function (rr) {
        if (rr.error) { box.innerHTML = '<span class="err">' + esc(dbError(rr.error)) + "</span>"; return; }
        var results = rr.data || [], sysIds = [];
        S.races.forEach(function (r) { var id = raceSystemId(r); if (id && sysIds.indexOf(id) < 0) sysIds.push(id); });
        Promise.all(sysIds.map(loadSystem)).then(function (systems) {
          var byId = {}; systems.forEach(function (s) { if (s) byId[s.id] = s; });
          var empty = { table: {}, status: {}, fastestLap: null }, noSys = false;
          var evs = S.events.slice().sort(function (a, b) { return String(a.starts_at || "~").localeCompare(String(b.starts_at || "~")) || (a.round_number || 0) - (b.round_number || 0); });
          var rounds = evs.map(function (e) {
            var races = S.races.filter(function (r) { return r.event_id === e.id && results.some(function (x) { return x.race_id === r.id; }); }).sort(function (a, b) { return a.sort_order - b.sort_order; }).map(function (r) {
              var sys = byId[raceSystemId(r)]; if (!sys) noSys = true;
              return { id: r.id, name: r.name || "Race", double: !!r.double_points, system: sys || empty,
                results: results.filter(function (x) { return x.race_id === r.id; }).map(function (x) { return { driver: driverName(x.driver_id), position: x.position, status: x.status === "finished" ? null : x.status, fastestLap: !!x.fastest_lap }; }) };
            });
            return { id: e.id, name: e.round_number ? "R" + e.round_number : (e.name || "Round"), races: races };
          }).filter(function (r) { return r.races.length; });
          if (!rounds.length) { box.innerHTML = '<p class="muted">No results entered yet. Enter them on the Results tab.</p>'; return; }
          var st = ENG.standings(empty, rounds);
          box.innerHTML = (noSys ? '<p class="err">Some races have no points system, so they score 0.</p>' : "") + '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%"><thead><tr><th>#</th><th style="text-align:left">Driver</th><th>Points</th>' +
            st.raceColumns.map(function (c) { return '<th title="' + esc(c.round + " " + c.race) + '">' + esc(c.round + " " + c.race) + "</th>"; }).join("") + "<th>Wins</th><th>Podiums</th><th>Fastest laps</th></tr></thead><tbody>" +
            st.rows.map(function (r) {
              return '<tr><td style="text-align:center">' + r.rank + "</td><td>" + esc(r.driver) + '</td><td style="text-align:center"><b>' + r.total + "</b></td>" +
                st.raceColumns.map(function (c) { return '<td style="text-align:center">' + (r.perRace[c.key] == null ? "–" : r.perRace[c.key]) + "</td>"; }).join("") +
                '<td style="text-align:center">' + r.wins + '</td><td style="text-align:center">' + r.podiums + '</td><td style="text-align:center">' + r.fastestLaps + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        }, function (e) { box.innerHTML = '<span class="err">' + esc(dbError(e)) + "</span>"; });
      });
    });
  }

  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") showLogin(); });
  boot();
})();
