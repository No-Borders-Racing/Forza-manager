// Time zone helpers. An event is stored as an exact instant plus the IANA zone it was meant in.
(function (root) {
  var fmtCache = {};
  function fmt(tz) {
    if (!fmtCache[tz]) fmtCache[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    return fmtCache[tz];
  }
  function localFields(ms, tz) {
    var p = {};
    fmt(tz).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  }
  function offsetMs(ms, tz) {
    var f = localFields(ms, tz);
    return Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localText(ms, tz) {
    var f = localFields(ms, tz);
    return { date: f.y + "-" + pad(f.mo) + "-" + pad(f.d), time: pad(f.h) + ":" + pad(f.mi) };
  }
  // Local wall-clock date and time in a zone -> exact instant.
  // Returns { instant: ISO string } or { error: "nonexistent" | "ambiguous" | "invalid" }.
  function zonedToInstant(dateStr, timeStr, tz) {
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || ""), tm = /^(\d{2}):(\d{2})$/.exec(timeStr || "");
    if (!dm || !tm || !tz) return { error: "invalid" };
    var wall = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
    try { fmt(tz); } catch (e) { return { error: "invalid" }; }
    // Every instant within a day either side that shows this wall-clock time in the zone.
    var hits = [];
    var offsets = {};
    [-86400000, 0, 86400000].forEach(function (d) { offsets[offsetMs(wall + d, tz)] = true; });
    Object.keys(offsets).forEach(function (o) {
      var cand = wall - Number(o);
      if (offsetMs(cand, tz) === Number(o) && hits.indexOf(cand) < 0) hits.push(cand);
    });
    if (hits.length === 0) return { error: "nonexistent" };
    if (hits.length > 1) return { error: "ambiguous" };
    return { instant: new Date(hits[0]).toISOString() };
  }
  var api = { zonedToInstant: zonedToInstant, localText: localText, offsetMs: offsetMs };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FCM_TZ = api;
})(typeof window !== "undefined" ? window : globalThis);
