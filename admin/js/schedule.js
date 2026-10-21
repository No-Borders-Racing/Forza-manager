// Turns "N rounds, this often, starting on this date" into local calendar dates.
// Pure date arithmetic on YYYY-MM-DD strings; the time and zone are applied later by tz.js.
(function (root) {
  function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function text(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function dayMs(p) { return Date.UTC(p.y, p.m - 1, p.d); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  // opts: { start, count, pattern: weekly|fortnightly|monthly|custom,
  //         monthlyMode: day_of_month|nth_weekday, intervalCount, intervalUnit: day|week|month }
  // Returns { dates: [...] } or { error: "message" }.
  function generate(o) {
    var s = parse(o.start);
    if (!s) return { error: "Choose a starting date." };
    if (!(o.count >= 1 && o.count <= 200 && Math.floor(o.count) === o.count)) return { error: "Number of rounds must be a whole number from 1 to 200." };
    var unit, n;
    if (o.pattern === "weekly") { unit = "week"; n = 1; }
    else if (o.pattern === "fortnightly") { unit = "week"; n = 2; }
    else if (o.pattern === "monthly") { unit = "month"; n = 1; }
    else if (o.pattern === "custom") {
      unit = o.intervalUnit; n = o.intervalCount;
      if (["day", "week", "month"].indexOf(unit) < 0 || !(n >= 1) || Math.floor(n) !== n) return { error: "For a custom frequency, enter a whole number and choose days, weeks or months." };
    } else return { error: "Choose a frequency." };
    var dates = [], i;
    if (unit !== "month") {
      var step = n * (unit === "week" ? 7 : 1) * 86400000, base = dayMs(s);
      for (i = 0; i < o.count; i++) dates.push(text(base + i * step));
      return { dates: dates };
    }
    var mode = o.monthlyMode;
    if (mode !== "day_of_month" && mode !== "nth_weekday") return { error: "Choose whether monthly rounds fall on the same day of the month or the same weekday." };
    var startMs = dayMs(s), wd = new Date(startMs).getUTCDay(), nth = Math.floor((s.d - 1) / 7) + 1;
    if (mode === "day_of_month" && s.d > 28) return { error: "The same day of the month is not available for the 29th to the 31st, because some months are shorter. Pick a start date on or before the 28th, or use the same weekday instead." };
    if (mode === "nth_weekday" && nth > 4) return { error: "That start date is the 5th of its weekday in the month, which does not exist in every month. Pick another start date or use the same day of the month." };
    for (i = 0; i < o.count; i++) {
      var tm = s.m - 1 + i * n, y = s.y + Math.floor(tm / 12), mo = ((tm % 12) + 12) % 12 + 1;
      if (mode === "day_of_month") dates.push(y + "-" + pad(mo) + "-" + pad(s.d));
      else {
        var first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
        var day = 1 + ((wd - first + 7) % 7) + (nth - 1) * 7;
        dates.push(y + "-" + pad(mo) + "-" + pad(day));
      }
    }
    return { dates: dates };
  }
  var api = { generate: generate };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FCM_SCHEDULE = api;
})(typeof window !== "undefined" ? window : globalThis);
