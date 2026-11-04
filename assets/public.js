/* Shared by the public pages (calendar, league, championship): escaping, local date and time text, and the collapsible round card. */
(function () {
  "use strict";
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
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
    var head = '<div class="rnd">' + (r.championship ? esc(r.championship) + " · " : "") + (r.round ? "Round " + esc(r.round) : esc(r.name || "Round")) +
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
  window.FCMPublic = { esc: esc, dateText: dateText, timeText: timeText, raceLen: raceLen, roundHtml: roundHtml };
})();
