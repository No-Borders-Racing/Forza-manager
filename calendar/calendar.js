(function () {
  "use strict";
  var out = document.getElementById("out"), cfg = window.FCM_CONFIG;
  var esc = FCMPublic.esc, roundHtml = FCMPublic.roundHtml;
  function note(t) { out.innerHTML = '<p class="msg">' + esc(t) + "</p>"; if (window.FCMChrome) FCMChrome.ready(); }
  var sid = new URLSearchParams(location.search).get("s");
  if (!sid) { note("This link is missing its calendar."); return; }
  if (!window.supabase || !cfg) { note("The calendar could not be loaded."); return; }
  var sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  FCMChrome.who(sb, "../admin/");
  // Admins who are signed in to the admin app (same site) get Edit, Who can view and Delete here. Everyone else sees only the calendar.
  function adminBar(c) {
    var bar = document.createElement("div"); bar.className = "actrow";
    var edit = "../admin/?l=" + encodeURIComponent(c.league_id) + "&c=" + encodeURIComponent(c.championship_id) + "&s=" + encodeURIComponent(c.season_id);
    bar.innerHTML = '<span class="pill">Admin</span><a class="btn primary" href="' + esc(edit) + '">Edit season</a><label class="m" for="cv" style="display:inline-flex;align-items:center;gap:6px">Who can view? <select id="cv" style="width:auto"><option value="public">Public</option><option value="admin">Admin only</option></select></label><button type="button" class="danger" id="cd">Delete season</button><span id="cm" class="m"></span>';
    bar.querySelector("#cv").value = c.is_public === false ? "admin" : "public";
    document.querySelector("main").insertBefore(bar, document.getElementById("ph"));
    var m = bar.querySelector("#cm"), armed = false;
    bar.querySelector("#cv").addEventListener("change", function () {
      m.textContent = "Saving…";
      sb.from("seasons").update({ calendar_published: this.value === "public" }).eq("id", c.season_id).then(function (x) { if (x.error) { m.textContent = x.error.message; return; } location.reload(); });
    });
    var del = bar.querySelector("#cd");
    del.addEventListener("click", function () {
      if (!armed) { armed = true; del.textContent = "Click again to delete the season and all its rounds"; setTimeout(function () { armed = false; del.textContent = "Delete season"; }, 6000); return; }
      m.textContent = "Deleting…";
      sb.from("seasons").delete().eq("id", c.season_id).then(function (x) {
        if (x.error) { m.textContent = x.error.message; armed = false; del.textContent = "Delete season"; return; }
        document.querySelector("main").innerHTML = '<p class="msg">The season was deleted. <a href="../admin/">Back to the admin app</a></p>';
      });
    });
  }
  sb.rpc("public_calendar", { sid: sid }).then(function (r) {
    if (r.error) { note("The calendar could not be loaded."); return; }
    var c = r.data;
    if (!c) { note("This page isn't available."); return; }
    if (c.can_edit) adminBar(c);
    if (c.palette) document.documentElement.setAttribute("data-palette", c.palette);
    document.title = [c.league, c.championship, c.season].join(" · "); FCMChrome.footer(c.league); FCMChrome.ready(); FCMChrome.setLeague(c.league_id);
    document.getElementById("title").innerHTML = [c.league, c.championship, c.season].map(function (x, i) { return (i ? '<span class="sep">·</span> ' : "") + "<span>" + esc(x) + "</span>"; }).join(" ");
    var z = ""; try { z = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    document.getElementById("sub").textContent = "All times are shown in your local time" + (z ? " (" + z.replace(/_/g, " ") + ")" : "") + ".";
    var rs = c.rounds || [];
    var ov = c.description ? '<div class="notes" style="margin:0 0 14px"><b>Championship overview</b><br>' + esc(c.description) + "</div>" : "";
    out.innerHTML = ov + (rs.length ? rs.map(roundHtml).join("") : '<p class="msg">No rounds have been scheduled yet.</p>');
  });
})();
