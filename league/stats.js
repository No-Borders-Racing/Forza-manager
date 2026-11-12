/* Public driver stats for a league: a table of every driver, a card for each driver and a head to head.
   Everything is worked out in the browser from the same public championship data the results pages use, so it only ever shows what a visitor may already see. */
(function () {
  "use strict";
  var esc = FCMPublic.esc, MI = 0.621371;

  function fin(x) { return x.status === "finished" && x.position != null; }
  function num(v, d) { return v == null || !isFinite(v) ? "–" : String(+Number(v).toFixed(d == null ? 0 : d)); }
  function ord(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function dist(km) { return km > 0 ? Math.round(km).toLocaleString() + " km" : "–"; }

  // One flat list of entries (a driver in a race) plus the season titles.
  function build(champs) {
    var entries = [], titles = [], champList = [];
    champs.forEach(function (c) {
      champList.push({ id: c.championship_id, name: c.championship });
      (c.seasons || []).forEach(function (s) {
        var totals = {}, rounds = s.rounds || [];
        rounds.forEach(function (r) {
          var venue = r.track ? r.track.venue + (r.track.layout ? " · " + r.track.layout : "") : null, len = r.track && r.track.length_km ? Number(r.track.length_km) : 0;
          (r.races || []).forEach(function (race) {
            (race.results || []).forEach(function (x) {
              if (x.status === "dns") return;
              var km = 0;
              if (fin(x)) km = race.laps && len ? race.laps * len : (race.distance_km ? Number(race.distance_km) : 0);
              entries.push({ cid: c.championship_id, champ: c.championship, season: s.name, round: r.round, track: venue, raceId: race.id, race: race.name, driver: x.driver, key: String(x.driver).toLowerCase(),
                pos: x.position, position: x.position, status: x.status, pts: Number(x.points) || 0, fl: !!x.fastest_lap, pg: x.places_gained == null ? null : Number(x.places_gained), km: km });
              totals[x.driver] = (totals[x.driver] || 0) + (Number(x.points) || 0);
            });
          });
        });
        var done = rounds.length && rounds.every(function (r) { return r.status === "completed" || r.status === "cancelled"; }) && rounds.some(function (r) { return r.status === "completed"; });
        var names = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
        if (done && names.length) {
          var top = totals[names[0]], second = names.filter(function (n) { return totals[n] < top; })[0];
          names.filter(function (n) { return totals[n] === top; }).forEach(function (n) { titles.push({ cid: c.championship_id, champ: c.championship, season: s.name, driver: n, key: n.toLowerCase(), pts: top, margin: second != null ? top - totals[second] : null }); });
        }
      });
    });
    return { entries: entries, titles: titles, champs: champList };
  }

  function statsFor(M, key, cid) {
    var es = M.entries.filter(function (e) { return e.key === key && (!cid || e.cid === cid); }), name = es.length ? es[0].driver : key;
    var o = { name: name, key: key, races: es.length, wins: 0, p1: 0, p2: 0, p3: 0, pts: 0, dnf: 0, km: 0, fl: 0, flTracks: {}, best: null, finSum: 0, finN: 0, gained: 0, lost: 0, tracked: 0, tracks: {}, entries: es };
    es.forEach(function (e) {
      o.pts += e.pts; o.km += e.km;
      if (fin(e)) { o.finSum += e.pos; o.finN++; if (e.pos === 1) { o.wins++; o.p1++; } else if (e.pos === 2) o.p2++; else if (e.pos === 3) o.p3++; if (o.best == null || e.pos < o.best) o.best = e.pos; }
      if (e.status === "dnf") o.dnf++;
      if (e.fl) { o.fl++; var t = e.track || "Unknown track"; o.flTracks[t] = (o.flTracks[t] || 0) + 1; }
      if (e.pg != null) { o.tracked++; if (e.pg > 0) o.gained += e.pg; else o.lost += -e.pg; }
      var tk = e.track || "Unknown track", T = o.tracks[tk] || (o.tracks[tk] = { races: 0, best: null, sum: 0, n: 0, km: 0 });
      T.races++; T.km += e.km; if (fin(e)) { T.sum += e.pos; T.n++; if (T.best == null || e.pos < T.best) T.best = e.pos; }
    });
    o.podiums = o.p1 + o.p2 + o.p3; o.avg = o.finN ? o.finSum / o.finN : null;
    o.titles = M.titles.filter(function (t) { return t.key === key && (!cid || t.cid === cid); });
    return o;
  }

  function drivers(M, cid) {
    var seen = {}, out = [];
    M.entries.forEach(function (e) { if ((!cid || e.cid === cid) && !seen[e.key]) { seen[e.key] = true; out.push(statsFor(M, e.key, cid)); } });
    return out;
  }

  var BTN = 'class="btn"', card = function (h, t) { return '<div class="card" style="margin:12px 0">' + (t ? "<h2>" + esc(t) + "</h2>" : "") + h + "</div>"; };

  function draw(box, l, sb) {
    var st = { view: "table", scope: "", sort: "pts", dir: -1, driver: "", a: "", b: "", all: false }, M = null;
    var q = new URLSearchParams(location.search);
    function url() { try { var u = new URL(location.href); ["d", "a", "b", "sc"].forEach(function (k) { u.searchParams.delete(k); }); if (st.view === "driver" && st.driver) u.searchParams.set("d", st.driver); if (st.view === "h2h" && st.a && st.b) { u.searchParams.set("a", st.a); u.searchParams.set("b", st.b); } if (st.scope) u.searchParams.set("sc", st.scope); history.replaceState(null, "", u); } catch (e) {} }
    function scopeSel() {
      if (M.champs.length < 2) return "";
      return '<label class="sub" style="display:flex;gap:6px;align-items:center">Show <select data-sc>' + '<option value="">All championships</option>' + M.champs.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === st.scope ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + "</select></label>";
    }
    function nav() {
      return '<div class="row" style="margin:0 0 10px;align-items:center;gap:8px"><button type="button" data-v="table"' + (st.view === "table" ? ' class="primary"' : "") + '>All drivers</button><button type="button" data-v="h2h"' + (st.view === "h2h" ? ' class="primary"' : "") + ">Head to head</button>" + scopeSel() + "</div>";
    }
    function tableView() {
      var ds = drivers(M, st.scope);
      if (!ds.length) return '<p class="msg">No results yet, so there are no stats to show.</p>';
      var key = { name: function (d) { return d.name.toLowerCase(); }, titles: function (d) { return d.titles.length; }, races: function (d) { return d.races; }, wins: function (d) { return d.wins; }, podiums: function (d) { return d.podiums; }, pts: function (d) { return d.pts; }, avg: function (d) { return d.avg == null ? 99 : d.avg; }, fl: function (d) { return d.fl; }, km: function (d) { return d.km; } }[st.sort];
      ds.sort(function (a, b) { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * st.dir || a.name.localeCompare(b.name); });
      var cols = [["name", "Driver"], ["titles", "Titles"], ["races", "Races"], ["wins", "Wins"], ["podiums", "Podiums"], ["pts", "Points"], ["avg", "Avg finish"], ["fl", "Fastest laps"], ["km", "Distance"]];
      var head = cols.map(function (c) { return '<th scope="col" aria-sort="' + (st.sort === c[0] ? (st.dir < 0 ? "descending" : "ascending") : "none") + '"><button type="button" data-sort="' + c[0] + '" style="all:unset;cursor:pointer;font:inherit;color:inherit">' + esc(c[1]) + (st.sort === c[0] ? (st.dir < 0 ? " ▼" : " ▲") : "") + "</button></th>"; }).join("");
      var rows = ds.map(function (d) { return "<tr><td><button type=\"button\" data-d=\"" + esc(d.key) + '" style="all:unset;cursor:pointer;font-weight:700;color:var(--link)">' + esc(d.name) + "</button></td><td>" + d.titles.length + "</td><td>" + d.races + "</td><td>" + d.wins + "</td><td>" + d.podiums + "</td><td><b>" + num(d.pts, 2) + "</b></td><td>" + num(d.avg, 1) + "</td><td>" + d.fl + "</td><td>" + dist(d.km) + "</td></tr>"; }).join("");
      var ts = M.titles.filter(function (t) { return !st.scope || t.cid === st.scope; });
      var tl = ts.length ? ts.map(function (t) { return '<div class="line" style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line)"><span><b>' + esc(t.champ) + '</b><br><span class="sub">' + esc(t.season) + '</span></span><b><button type="button" data-d="' + esc(t.key) + '" style="all:unset;cursor:pointer;color:var(--link)">' + esc(t.driver) + "</button></b></div>"; }).join("") : '<p class="msg" style="margin:0">No championship has been completed yet.</p>';
      var most = function (f, label, fmt) { var b = ds.slice().sort(function (x, y) { return f(y) - f(x); })[0]; return b && f(b) > 0 ? '<div class="line" style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line)"><span>' + label + "</span><b>" + esc(b.name) + " (" + fmt(f(b)) + ")</b></div>" : ""; };
      var rec = most(function (d) { return d.wins; }, "Most wins", String) + most(function (d) { return d.podiums; }, "Most podiums", String) + most(function (d) { return d.fl; }, "Most fastest laps", String) + most(function (d) { return d.km; }, "Most distance driven", dist);
      return card('<div class="wrapx"><table class="t"><thead><tr>' + head + "</tr></thead><tbody>" + rows + '</tbody></table></div><p class="sub" style="margin:8px 0 0">Select a column to sort, or a driver for their card. Distance counts laps in races a driver finished.</p>', "Drivers (" + ds.length + ")") +
        '<div class="cols"><div class="col">' + card(tl, "Championship titles") + '</div><div class="col">' + card(rec || '<p class="msg" style="margin:0">Records appear once races are completed.</p>', "League records") + "</div></div>";
    }
    function stat(v, label) { return '<div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px"><div style="font:700 24px/1.1 var(--display)">' + esc(v) + '</div><div class="sub">' + esc(label) + "</div></div>"; }
    function grid(items) { return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">' + items.join("") + "</div>"; }
    function driverView() {
      var d = statsFor(M, st.driver, st.scope), back = '<button type="button" data-v="table">← All drivers</button>';
      if (!d.races && !d.titles.length) return back + '<p class="msg">No results for that driver.</p>';
      var titles = d.titles.length ? d.titles.map(function (t) { return '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)"><span><b>🏆 ' + esc(t.champ) + '</b><br><span class="sub">' + esc(t.season) + '</span></span><span style="text-align:right"><b>' + num(t.pts, 2) + ' pts</b>' + (t.margin != null ? '<br><span class="sub">' + (t.margin === 0 ? "Tied on points" : "Won by " + num(t.margin, 2)) + "</span>" : "") + "</span></div>"; }).join("") : '<p class="msg" style="margin:0">No championship titles yet.</p>';
      var h = '<div class="row" style="align-items:center;justify-content:space-between;margin:0 0 8px"><h2 style="margin:0">' + esc(d.name) + "</h2>" + back + "</div>";
      h += card(titles, "Championship titles (" + d.titles.length + ")");
      h += '<div class="cols"><div class="col">' + card('<div style="display:flex;gap:8px">' + [["1st", d.p1], ["2nd", d.p2], ["3rd", d.p3]].map(function (x) { return '<div style="flex:1;text-align:center;border:1px solid var(--line);border-radius:8px;padding:10px 4px"><div style="font:700 34px/1 var(--display);color:var(--accent)">' + x[1] + '</div><div class="sub">' + x[0] + "</div></div>"; }).join("") + '</div><p class="sub" style="margin:8px 0 0">' + (d.races ? "Win rate " + Math.round(d.wins / d.races * 100) + "% · podium rate " + Math.round(d.podiums / d.races * 100) + "%" : "") + "</p>", "Podiums (" + d.podiums + ")") + "</div>" +
        '<div class="col">' + card(grid([stat(d.races, "Races"), stat(num(d.pts, 2), "Points"), stat(num(d.avg, 1), "Average finish"), stat(d.best ? ord(d.best) : "–", "Best finish"), stat(dist(d.km) + (d.km > 0 ? " (" + Math.round(d.km * MI).toLocaleString() + " mi)" : ""), "Distance driven"), stat(d.dnf, "DNFs")]), "Career numbers") + "</div></div>";
      var flk = Object.keys(d.flTracks).sort(function (a, b) { return d.flTracks[b] - d.flTracks[a]; });
      var left = d.tracked ? card(grid([stat("+" + d.gained, "Gained"), stat("-" + d.lost, "Lost"), stat((d.gained - d.lost >= 0 ? "+" : "") + (d.gained - d.lost), "Net")]) + '<p class="sub" style="margin:8px 0 0">Counted from ' + d.tracked + " of " + d.races + " races where places gained and lost were recorded.</p>", "Places gained and lost") : "";
      h += '<div class="cols"><div class="col">' + left + "</div><div class=\"col\">" + card(flk.length ? flk.map(function (t) { return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line)"><span>' + esc(t) + "</span><b>" + d.flTracks[t] + "</b></div>"; }).join("") : '<p class="msg" style="margin:0">No fastest laps yet.</p>', "Fastest laps (" + d.fl + ")") + "</div></div>";
      var tr = Object.keys(d.tracks).sort(function (a, b) { return d.tracks[b].races - d.tracks[a].races || a.localeCompare(b); });
      h += card('<div class="wrapx"><table class="t"><thead><tr><th>Track</th><th>Races</th><th>Best finish</th><th>Avg finish</th><th>Distance</th></tr></thead><tbody>' + tr.map(function (k) { var T = d.tracks[k]; return "<tr><td>" + esc(k) + "</td><td>" + T.races + "</td><td>" + (T.best ? ord(T.best) : "–") + "</td><td>" + num(T.n ? T.sum / T.n : null, 1) + "</td><td>" + dist(T.km) + "</td></tr>"; }).join("") + "</tbody></table></div>", "Track by track");
      h += '<div class="row" style="margin:6px 0"><button type="button" data-h2h="' + esc(d.key) + '">Compare with another driver</button></div>';
      return h;
    }
    function h2hView() {
      var ds = drivers(M, st.scope).sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (ds.length < 2) return '<p class="msg">At least two drivers with results are needed to compare.</p>';
      if (!st.a || !ds.some(function (d) { return d.key === st.a; })) st.a = ds[0].key;
      if (!st.b || !ds.some(function (d) { return d.key === st.b; }) || st.b === st.a) st.b = (ds.filter(function (d) { return d.key !== st.a; })[0] || ds[1]).key;
      var opt = function (sel) { return ds.map(function (d) { return '<option value="' + esc(d.key) + '"' + (d.key === sel ? " selected" : "") + ">" + esc(d.name) + "</option>"; }).join(""); };
      var A = statsFor(M, st.a, st.scope), B = statsFor(M, st.b, st.scope);
      var bm = {}; B.entries.forEach(function (e) { bm[e.raceId] = e; });
      var shared = A.entries.filter(function (e) { return bm[e.raceId]; }).map(function (e) { return { a: e, b: bm[e.raceId] }; });
      var both = shared.filter(function (s) { return fin(s.a) && fin(s.b); }), aw = both.filter(function (s) { return s.a.pos < s.b.pos; }).length, bw = both.filter(function (s) { return s.b.pos < s.a.pos; }).length;
      var sum = function (side, f) { return shared.reduce(function (n, s) { return n + f(s[side]); }, 0); };
      var avg = function (side) { var f = shared.filter(function (s) { return fin(s[side]); }); return f.length ? f.reduce(function (n, s) { return n + s[side].pos; }, 0) / f.length : null; };
      var rows = [
        ["Shared races", shared.length, shared.length, 0],
        ["Finished ahead", aw, bw, 1],
        ["Average finish", avg("a"), avg("b"), -1, 1],
        ["Wins", sum("a", function (e) { return fin(e) && e.pos === 1 ? 1 : 0; }), sum("b", function (e) { return fin(e) && e.pos === 1 ? 1 : 0; }), 1],
        ["Podiums", sum("a", function (e) { return fin(e) && e.pos <= 3 ? 1 : 0; }), sum("b", function (e) { return fin(e) && e.pos <= 3 ? 1 : 0; }), 1],
        ["Fastest laps", sum("a", function (e) { return e.fl ? 1 : 0; }), sum("b", function (e) { return e.fl ? 1 : 0; }), 1],
        ["Points", sum("a", function (e) { return e.pts; }), sum("b", function (e) { return e.pts; }), 1, 2],
        ["Championship titles", A.titles.length, B.titles.length, 1]
      ];
      var cell = function (v, other, dir, dp, ownSide) { var lead = dir && v != null && other != null && (dir > 0 ? v > other : v < other); return '<td style="text-align:' + ownSide + ';padding:9px 6px;' + (lead ? "font-weight:700;color:var(--accent)" : "") + '">' + (lead ? (ownSide === "right" ? "◂ " : "") : "") + num(v, dp || 0) + (lead && ownSide === "left" ? " ▸" : "") + (lead ? '<span class="sr" style="position:absolute;left:-9999px"> (ahead)</span>' : "") + "</td>"; };
      var tbl = '<div class="wrapx"><table class="t"><thead><tr><th style="text-align:right">' + esc(A.name) + '</th><th style="text-align:center">Stat</th><th style="text-align:left">' + esc(B.name) + "</th></tr></thead><tbody>" +
        rows.map(function (r) { return "<tr>" + cell(r[1], r[2], r[3], r[4], "right") + '<td style="text-align:center;padding:9px 6px" class="sub">' + esc(r[0]) + "</td>" + cell(r[2], r[1], r[3], r[4], "left") + "</tr>"; }).join("") + "</tbody></table></div>";
      var tot = aw + bw, bar = tot ? '<div style="display:flex;height:42px;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin:10px 0 6px"><div style="flex:' + aw + ' 1 0;background:var(--accent);color:var(--accent-ink);display:flex;align-items:center;padding:0 10px;font-weight:700">' + (aw ? esc(A.name) + " · " + aw : "") + '</div><div style="flex:' + bw + ' 1 0;display:flex;align-items:center;justify-content:flex-end;padding:0 10px;font-weight:700;border-left:2px solid var(--card)">' + (bw ? bw + " · " + esc(B.name) : "") + '</div></div><div class="sub">' + (aw === bw ? "Level" : esc(aw > bw ? A.name : B.name) + " finished ahead in " + Math.round(Math.max(aw, bw) / tot * 100) + "%") + " of the " + tot + " races they both finished.</div>" : '<p class="msg" style="margin:8px 0 0">They have not both finished a race together yet.</p>';
      var list = shared.slice().reverse(), shown = st.all ? list : list.slice(0, 5);
      var rc = list.length ? '<div class="wrapx"><table class="t"><thead><tr><th>Race</th><th>' + esc(A.name) + "</th><th>" + esc(B.name) + "</th><th>Ahead</th></tr></thead><tbody>" + shown.map(function (s) { var p = function (e) { return fin(e) ? ord(e.pos) : e.status.toUpperCase(); }; var ah = fin(s.a) && fin(s.b) ? (s.a.pos < s.b.pos ? A.name : B.name) : fin(s.a) ? A.name : fin(s.b) ? B.name : "–"; return "<tr><td>" + esc((s.a.round ? "Round " + s.a.round + " " : "") + (s.a.track || "") + (s.a.race ? ", " + s.a.race : "")) + "</td><td>" + p(s.a) + "</td><td>" + p(s.b) + "</td><td><b>" + esc(ah) + "</b></td></tr>"; }).join("") + "</tbody></table></div>" + (list.length > 5 ? '<div class="row" style="margin-top:8px"><button type="button" data-all>' + (st.all ? "Show the latest 5" : "Show all " + list.length) + "</button></div>" : "") : '<p class="msg" style="margin:0">They have not raced each other yet.</p>';
      return card('<div class="row" style="gap:10px;align-items:flex-end"><div class="field"><label for="h2a">Driver A</label><select id="h2a">' + opt(st.a) + '</select></div><b style="padding-bottom:8px">VS</b><div class="field"><label for="h2b">Driver B</label><select id="h2b">' + opt(st.b) + "</select></div></div>") +
        card(bar, "Who finished ahead?") + card(tbl + '<p class="sub" style="margin:8px 0 0">Only races both drivers entered are counted. The leader in each row is highlighted and marked with an arrow.</p>', "Side by side") + card(rc, "Race by race");
    }
    function render() {
      if (!M) return;
      box.innerHTML = nav() + (st.view === "driver" ? driverView() : st.view === "h2h" ? h2hView() : tableView());
      box.querySelectorAll("[data-v]").forEach(function (b) { b.addEventListener("click", function () { st.view = b.dataset.v; url(); render(); }); });
      box.querySelectorAll("[data-d]").forEach(function (b) { b.addEventListener("click", function () { st.driver = b.dataset.d; st.view = "driver"; url(); render(); window.scrollTo(0, 0); }); });
      box.querySelectorAll("[data-sort]").forEach(function (b) { b.addEventListener("click", function () { var k = b.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === "name" || k === "avg" ? 1 : -1; } render(); }); });
      var sc = box.querySelector("[data-sc]"); if (sc) sc.addEventListener("change", function () { st.scope = sc.value; url(); render(); });
      var h2 = box.querySelector("[data-h2h]"); if (h2) h2.addEventListener("click", function () { st.a = h2.dataset.h2h; st.b = ""; st.view = "h2h"; url(); render(); });
      var a = box.querySelector("#h2a"), b = box.querySelector("#h2b");
      if (a) a.addEventListener("change", function () { st.a = a.value; url(); render(); });
      if (b) b.addEventListener("change", function () { st.b = b.value; url(); render(); });
      var al = box.querySelector("[data-all]"); if (al) al.addEventListener("click", function () { st.all = !st.all; render(); });
    }
    box.innerHTML = '<p class="msg">Loading stats…</p>';
    var cs = (l.championships || []).filter(function (c) { return c && c.id; });
    if (!cs.length) { box.innerHTML = '<p class="msg">No championships to show stats for yet.</p>'; return; }
    Promise.all(cs.map(function (c) { return sb.rpc("public_championship", { cid: c.id }).then(function (r) { return r.error ? null : r.data; }, function () { return null; }); })).then(function (all) {
      M = build(all.filter(Boolean));
      st.scope = q.get("sc") || ""; if (st.scope && !M.champs.some(function (c) { return c.id === st.scope; })) st.scope = "";
      if (q.get("d")) { st.driver = q.get("d"); st.view = "driver"; } else if (q.get("a") && q.get("b")) { st.a = q.get("a"); st.b = q.get("b"); st.view = "h2h"; }
      render();
    });
  }
  window.FCMStats = { draw: draw, build: build, statsFor: statsFor };
})();
