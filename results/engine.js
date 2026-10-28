/* Results scoring engine. Pure functions: no page, no database, no names baked in.
 * Input shapes:
 *   system: { table: {1: 25, 2: 24, ...}, fastestLap: 1 | null, status: { dnf: 0, ... } }
 *   (a race may carry its own `system`, which is used instead of the one passed to standings)
 *   rounds: [{ id, name, races: [{ id, name, double: false, results: [
 *             { driver, position, fastestLap: bool, status: null | "dnf" | "dns" | "dsq" }] }] }]
 * A position missing from the table scores 0 (the library tables stop at 24, the lobby maximum).
 */
(function (root) {
  "use strict";

  function resultPoints(system, res, doubled) {
    var base = 0, st = res.status;
    // A DNF that was ranked after the finishers (see arrangeRace) scores for the position it holds.
    var ranked = st === "dnf" && res.position != null;
    if (st && !ranked) {
      var sp = system.status && system.status[st];
      base = typeof sp === "number" ? sp : 0;
    } else if (res.position != null) {
      var tp = system.table[res.position];
      base = typeof tp === "number" ? tp : 0;
    }
    var fl = res.fastestLap && typeof system.fastestLap === "number" ? system.fastestLap : 0;
    var pts = base + fl;
    return doubled ? pts * 2 : pts;
  }

  /* Turns what the game's results screen shows into the final grid.
   * entries: [{ driver, position, status: "finished" | "dnf" | "dns" | "dsq", bestLapMs }]
   *   position is the game's order for finishers (it already includes time penalties).
   * opts.dnfRank (default false): DNFs with a recorded best lap are placed after the last finisher,
   *   fastest best lap first, and score for the position they land in. A DNF with no lap time is a DNS.
   * Without dnfRank a DNF stays a DNF with no position (scored by the points system's DNF rule).
   * Returns new entries in grid order, each with position (or null), status and fastestLap (true for the
   * single quickest best lap in the race; a tie goes to the driver higher in the grid). */
  function arrangeRace(entries, opts) {
    var dnfRank = !!(opts && opts.dnfRank), fin = [], dnf = [], rest = [];
    entries.forEach(function (e, i) {
      var c = { driver: e.driver, status: e.status || "finished", bestLapMs: e.bestLapMs == null ? null : e.bestLapMs, position: e.position == null ? null : e.position, _i: i };
      if (c.status === "finished") fin.push(c); else if (c.status === "dnf") dnf.push(c); else rest.push(c);
    });
    fin.sort(function (a, b) { return (a.position == null ? 1e9 : a.position) - (b.position == null ? 1e9 : b.position) || a._i - b._i; });
    fin.forEach(function (c, i) { c.position = i + 1; });
    var n = fin.length, out = fin.slice();
    if (dnfRank) {
      var withLap = dnf.filter(function (c) { return c.bestLapMs != null; }).sort(function (a, b) { return a.bestLapMs - b.bestLapMs || a._i - b._i; });
      dnf.filter(function (c) { return c.bestLapMs == null; }).forEach(function (c) { c.status = "dns"; c.position = null; rest.push(c); });
      withLap.forEach(function (c) { c.position = ++n; out.push(c); });
    } else dnf.forEach(function (c) { c.position = null; rest.push(c); });
    rest.sort(function (a, b) { return a._i - b._i; });
    rest.forEach(function (c) { c.position = null; out.push(c); });
    var best = null;
    out.forEach(function (c) { if (c.bestLapMs != null && (best == null || c.bestLapMs < best.bestLapMs)) best = c; });
    return out.map(function (c) { return { driver: c.driver, position: c.position, status: c.status === "finished" ? null : c.status, bestLapMs: c.bestLapMs, fastestLap: c === best }; });
  }

  /* Returns { rows: [...], raceColumns: [...], kinds: [...] }. Rows are ranked. */
  function standings(system, rounds, opts) {
    opts = opts || {};
    var tiebreak = opts.tiebreak || ["wins", "podiums"];
    var byDriver = {}, cols = [], kinds = [];
    function driver(name) {
      if (!byDriver[name]) byDriver[name] = { driver: name, perRace: {}, byKind: {}, total: 0, fastestLaps: 0, wins: 0, podiums: 0, starts: 0 };
      return byDriver[name];
    }
    rounds.forEach(function (rd) {
      rd.races.forEach(function (race) {
        cols.push({ key: race.id, round: rd.name, race: race.name, roundId: rd.id });
        if (kinds.indexOf(race.name) < 0) kinds.push(race.name);
        race.results.forEach(function (res) {
          var d = driver(res.driver), pts = resultPoints(race.system || system, res, race.double);
          d.perRace[race.id] = pts;
          d.byKind[race.name] = (d.byKind[race.name] || 0) + pts;
          d.total += pts;
          d.starts += 1;
          if (res.fastestLap) d.fastestLaps += 1;
          var fin = !res.status || (res.status === "dnf" && res.position != null);
          if (fin && res.position === 1) d.wins += 1;
          if (fin && res.position != null && res.position <= 3) d.podiums += 1;
        });
      });
    });
    var rows = Object.keys(byDriver).map(function (k) { return byDriver[k]; });
    rows.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      for (var i = 0; i < tiebreak.length; i++) {
        var k = tiebreak[i]; if (b[k] !== a[k]) return b[k] - a[k];
      }
      return a.driver.toLowerCase() < b.driver.toLowerCase() ? -1 : 1;
    });
    var rank = 0, prev = null;
    rows.forEach(function (r, i) {
      var sig = [r.total].concat(tiebreak.map(function (k) { return r[k]; })).join("|");
      if (sig !== prev) { rank = i + 1; prev = sig; }
      r.rank = rank;
    });
    return { rows: rows, raceColumns: cols, kinds: kinds };
  }

  var api = { resultPoints: resultPoints, standings: standings, arrangeRace: arrangeRace };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FCMResults = api;
})(typeof window !== "undefined" ? window : this);
