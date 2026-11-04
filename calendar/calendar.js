(function () {
  "use strict";
  var out = document.getElementById("out"), cfg = window.FCM_CONFIG;
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function note(t) { out.innerHTML = '<p class="msg">' + esc(t) + "</p>"; if (window.FCMChrome) FCMChrome.ready(); }
  // Every date and time is shown in the viewer's own time zone.
  function dateText(d) { return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d); }
  function timeText(d, withZone) { return new Intl.DateTimeFormat(undefined, withZone ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : { hour: "numeric", minute: "2-digit" }).format(d); }
  function lapsText(n) { return n + (n === 1 ? " lap" : " laps"); }
  function raceLen(r) {
    if (r.laps) return lapsText(r.laps);
    if (r.minutes) return r.minutes + " min";
    if (r.distance_km) return r.distance_km + " km";
    return "";
  }
  function roundHtml(r) {
    var d = r.starts_at ? new Date(r.starts_at) : null, off = r.status === "cancelled", races = r.races || [];
    var head = '<div class="rnd">' + (r.round ? "Round " + esc(r.round) : esc(r.name || "Round")) +
      (r.bonus ? ' <span class="pill">Bonus</span>' : "") + (off ? ' <span class="pill bad">Cancelled</span>' : r.status === "completed" ? ' <span class="pill">Completed</span>' : "") + "</div>";
    head += d ? '<div class="big">' + esc(dateText(d)) + " · " + esc(timeText(d, true)) + "</div>" : '<div class="big tbc">Date and time to be confirmed</div>';
    if (r.track) head += '<div class="big">' + esc(r.track.venue) + " · " + esc(r.track.layout) + "</div>";
    var body = "";
    if (d && r.lobby_opens_at) body += '<div class="line"><span class="k">Lobby opens</span> ' + esc(timeText(new Date(r.lobby_opens_at))) + "</div>";
    if (r.track && r.track.length_km) body += '<div class="line"><span class="k">Lap length</span> ' + esc(r.track.length_km) + " km</div>";
    var tl = races.reduce(function (n, x) { return n + (x.laps > 0 ? x.laps : 0); }, 0);
    if (r.track && r.track.length_km && tl > 0) { var km = Number(r.track.length_km) * tl; body += '<div class="line"><span class="k">Total distance</span> <b>' + esc(km.toFixed(1)) + " km</b> (" + esc((km / 1.609344).toFixed(1)) + " mi) over " + esc(lapsText(tl)) + "</div>"; }
    if (races.length === 1 && raceLen(races[0])) body += '<div class="line"><span class="k">Race length</span> ' + esc(raceLen(races[0])) + "</div>";
    if (races.length > 1) body += '<ul class="races">' + races.map(function (x, i) {
      return "<li><span>" + esc(x.name || "Race " + (i + 1)) + (x.type ? ' <span class="pill">' + esc(x.type) + "</span>" : "") + '</span><span class="l">' + esc(raceLen(x)) + "</span></li>";
    }).join("") + "</ul>";
    if (r.notes && String(r.notes).trim()) body += '<div class="notes">' + esc(r.notes) + "</div>";
    if (!body) return '<div class="round' + (off ? " off" : "") + '"><div class="sum">' + head + "</div></div>";
    return '<details class="round' + (off ? " off" : "") + '"><summary class="sum">' + head + '<span class="chev" aria-hidden="true"></span></summary><div class="more">' + body + "</div></details>";
  }
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
    out.innerHTML = rs.length ? rs.map(roundHtml).join("") : '<p class="msg">No rounds have been scheduled yet.</p>';
  });
})();
