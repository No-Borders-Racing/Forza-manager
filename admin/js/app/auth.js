/* Sign in, forced password change and start-up. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

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
// A login created with "must change password" sits here until the person picks their own.
function showChangePassword() {
  app.innerHTML = '<div class="card" style="max-width:380px;margin:40px auto"><h2>Choose your own password</h2>' +
    '<p class="muted" style="margin:0 0 8px">This login was set up for you with a temporary password. Pick a new one to carry on.</p>' +
    '<div class="field"><label for="np1">New password</label><input id="np1" type="password" autocomplete="new-password"></div>' +
    '<div class="field" style="margin-top:8px"><label for="np2">Type it again</label><input id="np2" type="password" autocomplete="new-password"></div>' +
    '<div class="msg" id="npm"></div><button class="primary" id="npgo" type="button">Save password</button></div>';
  var go = function () {
    var a = $("#np1").value, b = $("#np2").value;
    if (a.length < 8) { msg($("#npm"), "Use at least 8 characters.", "err"); return; }
    if (a !== b) { msg($("#npm"), "The two passwords do not match.", "err"); return; }
    var btn = $("#npgo"); btn.disabled = true; msg($("#npm"), "Saving…");
    sb.auth.updateUser({ password: a, data: { must_change_password: false } }).then(function (r) {
      btn.disabled = false;
      if (r.error) { msg($("#npm"), /same|different/i.test(r.error.message || "") ? "Pick a password different from the temporary one." : r.error.message, "err"); return; }
      boot();
    });
  };
  $("#npgo").addEventListener("click", go);
  $("#np2").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
}
function boot() {
  sb.auth.getSession().then(function (r) {
    var s = r.data && r.data.session;
    if (!s) { showLogin(); return; }
    state.user = s.user;
    $("#who").innerHTML = '<span class="wem" title="' + esc(s.user.email) + '">' + esc(s.user.email) + '</span><button id="out" type="button">Sign out</button>';
    $("#out").addEventListener("click", function () { sb.auth.signOut().then(function () { state.admin = false; showLogin(); }); });
    if (s.user.user_metadata && s.user.user_metadata.must_change_password) { showChangePassword(); return; }
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
