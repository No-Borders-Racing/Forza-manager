(function () {
  "use strict";
  var out = document.getElementById("out"), cfg = window.FCM_CONFIG;
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function note(t) { out.innerHTML = '<p class="msg">' + esc(t) + "</p>"; }
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
    var d = r.starts_at ? new Date(r.starts_at) : null, off = r.status === "cancelled";
    var h = '<div class="round' + (off ? " off" : "") + '"><div class="rnd">' + (r.round ? "Round " + esc(r.round) : esc(r.name || "Round")) +
      (r.bonus ? ' <span class="pill">Bonus</span>' : "") + (off ? ' <span class="pill bad">Cancelled</span>' : r.status === "completed" ? ' <span class="pill">Completed</span>' : "") + "</div>";
    if (d) {
      h += '<div class="when">' + esc(dateText(d)) + " · " + esc(timeText(d, true));
      if (r.lobby_opens_at) h += "<small>Lobby opens " + esc(timeText(new Date(r.lobby_opens_at))) + "</small>";
      h += "</div>";
    } else h += '<div class="when tbc">Date and time to be confirmed</div>';
    var races = r.races || [], one = races.length === 1 ? raceLen(races[0]) : "";
    if (r.track) h += '<div class="track">' + esc(r.track.venue) + " · " + esc(r.track.layout) + (one ? ' <small>· ' + esc(one) + "</small>" : "") + "</div>";
    else if (one) h += '<div class="track"><small>' + esc(one) + "</small></div>";
    if (races.length > 1) h += '<ul class="races">' + races.map(function (x, i) {
      return "<li><span>" + esc(x.name || "Race " + (i + 1)) + (x.type ? ' <span class="pill">' + esc(x.type) + "</span>" : "") + '</span><span class="l">' + esc(raceLen(x)) + "</span></li>";
    }).join("") + "</ul>";
    if (r.notes && String(r.notes).trim()) h += '<div class="notes">' + esc(r.notes) + "</div>";
    return h + "</div>";
  }
  var sid = new URLSearchParams(location.search).get("s");
  if (!sid) { note("This link is missing its calendar."); return; }
  if (!window.supabase || !cfg) { note("The calendar could not be loaded."); return; }
  var sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  sb.rpc("public_calendar", { sid: sid }).then(function (r) {
    if (r.error) { note("The calendar could not be loaded."); return; }
    var c = r.data;
    if (!c) { note("This calendar is not published."); return; }
    if (c.palette) document.documentElement.setAttribute("data-palette", c.palette);
    document.title = [c.league, c.championship, c.season].join(" · ");
    document.getElementById("title").innerHTML = [c.league, c.championship, c.season].map(function (x, i) { return (i ? '<span class="sep">·</span> ' : "") + "<span>" + esc(x) + "</span>"; }).join(" ");
    var z = ""; try { z = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    document.getElementById("sub").textContent = "All times are shown in your local time" + (z ? " (" + z.replace(/_/g, " ") + ")" : "") + ".";
    var rs = c.rounds || [];
    out.innerHTML = rs.length ? rs.map(roundHtml).join("") : '<p class="msg">No rounds have been scheduled yet.</p>';
  });
})();
