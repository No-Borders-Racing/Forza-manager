/* Results scoring engine. Pure functions: no page, no database, no names baked in.
 * Input shapes:
 *   system: { table: {1: 25, 2: 24, ...}, fastestLap: 1 | null, status: { dnf: 0, ... } }
 *   rounds: [{ id, name, races: [{ id, name, double: false, results: [
 *             { driver, position, fastestLap: bool, status: null | "dnf" | "dns" | "dsq" }] }] }]
 * A position missing from the table scores 0 (the library tables stop at 24, the lobby maximum).
 */
(function (root) {
  "use strict";

  function resultPoints(system, res, doubled) {
    var base = 0, st = res.status;
    if (st) {
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
          var d = driver(res.driver), pts = resultPoints(system, res, race.double);
          d.perRace[race.id] = pts;
          d.byKind[race.name] = (d.byKind[race.name] || 0) + pts;
          d.total += pts;
          d.starts += 1;
          if (res.fastestLap) d.fastestLaps += 1;
          if (!res.status && res.position === 1) d.wins += 1;
          if (!res.status && res.position != null && res.position <= 3) d.podiums += 1;
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

  var api = { resultPoints: resultPoints, standings: standings };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FCMResults = api;
})(typeof window !== "undefined" ? window : this);
