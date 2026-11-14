(function () {
  "use strict";
  var out = document.getElementById("out"), cfg = window.FCM_CONFIG;
  var esc = FCMPublic.esc, dateText = FCMPublic.dateText, timeText = FCMPublic.timeText, roundHtml = FCMPublic.roundHtml;
  function note(t) { out.innerHTML = '<p class="msg">' + esc(t) + "</p>"; if (window.FCMChrome) FCMChrome.ready(); }
  var qs = new URLSearchParams(location.search), cid = qs.get("c"), lid = qs.get("l");
  if (!cid && !lid) { note("This link is missing its championship."); return; }
  if (!window.supabase || !cfg) { note("This page could not be loaded."); return; }
  var sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  FCMChrome.who(sb, "../admin/");

  function head(parts) {
    document.title = parts.join(" · "); FCMChrome.footer(parts[0]); FCMChrome.ready();
    document.getElementById("title").innerHTML = parts.map(function (x, i) { return (i ? '<span class="sep">·</span> ' : "") + "<span>" + esc(x) + "</span>"; }).join(" ");
  }
  // Signed-in league admins get an Edit link; if the page is set to Admin only they are told visitors cannot see it.
  function adminBar(label, href, isPublic, more) {
    var bar = document.createElement("div"); bar.className = "actrow scrollrow";
    bar.innerHTML = '<span class="pill">Admin</span><a class="btn primary" href="' + esc(href) + '">' + esc(label) + '</a>' + (more || []).map(function (m) { return '<a class="btn" href="' + esc(m[1]) + '">' + esc(m[0]) + "</a>"; }).join("") + (isPublic === false ? '<span class="m">Admin only: visitors cannot see this page.</span>' : "");
    document.querySelector("main").insertBefore(bar, document.getElementById("ph"));
  }
  function ms(n) { if (n == null) return ""; var m = Math.floor(n / 60000), s = (n % 60000) / 1000; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(3); }
  function roundTitle(r) {
    var t = r.track ? r.track.venue + (r.track.layout ? " · " + r.track.layout : "") : (r.name || "");
    return (r.round ? "Round " + r.round : "") + (r.round && t ? " · " : "") + t || "Round";
  }
  function isFin(x) { return x.status === "finished" || (x.status === "dnf" && x.position != null); }

  /* ----- tabs ----- */
  function divisionHtml(d) {
    var parts = d.parts || {}, names = Object.keys(parts), h = '<div class="dv"><h2>' + esc(d.name) + "</h2>";
    var cars = d.cars || [];
    h += '<p class="sub">' + (d.pi_limit ? '<span class="pill">PI limit ' + esc(d.pi_limit) + "</span> " : "") + cars.length + " eligible car" + (cars.length === 1 ? "" : "s") + "</p>";
    var rules = []; if (d.min_weight_lb) rules.push("Minimum weight " + d.min_weight_lb + " lb");
    String(d.other_rules || "").split(/\r?\n/).forEach(function (x) { x = x.trim(); if (x) rules.push(x); });
    var stock = names.filter(function (n) { return parts[n] === "Stock"; });
    var req = names.filter(function (n) { return parts[n] && parts[n] !== "Stock" && parts[n] !== "Open"; });
    if (rules.length) h += "<h3>Restrictions</h3><ul class=\"ck\">" + rules.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if (stock.length) h += "<h3>Not allowed (stock only)</h3><ul class=\"ck\">" + stock.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if (req.length) h += "<h3>Required upgrades</h3><ul class=\"ck\">" + req.map(function (x) { return "<li>" + esc(parts[x] + " " + x) + "</li>"; }).join("") + "</ul>";
    if (cars.length) h += "<h3>Eligible cars</h3><ul class=\"dvc\">" + cars.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    return h + "</div>";
  }
  function buildsHtml(c) {
    var ds = (c.divisions || []).map(divisionHtml).join("");
    var bs = c.builds || []; if (!bs.length) return ds || '<p class="msg">No car builds to show for this championship yet.</p>';
    return ds + '<div class="cards">' + bs.map(function (b) {
      var sub = [b.car, [b.class, b.pi].filter(function (x) { return x != null && x !== ""; }).join(" ")].filter(Boolean).join(" · ");
      return '<a class="card" href="' + esc("../admin/builds/sheet.html?v=20261114e&pub=" + encodeURIComponent(b.id)) + '"><b>' + esc(b.name) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + '<span class="go">View build sheet →</span></a>';
    }).join("") + "</div>";
  }
  function seasonsWrap(c, f) {
    var ss = c.seasons || [], many = ss.length > 1, h = "";
    ss.forEach(function (s) { var body = f(s); if (body) h += (many ? '<h2 class="sn">' + esc(s.name) + "</h2>" : "") + body; });
    return h;
  }
  function calendarHtml(c) {
    var h = seasonsWrap(c, function (s) { return (s.rounds || []).length ? s.rounds.map(roundHtml).join("") : ""; });
    var z = ""; try { z = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    return h ? '<p class="sub" style="margin:0 0 4px">All times are shown in your local time' + (z ? " (" + esc(z.replace(/_/g, " ")) + ")" : "") + ".</p>" + h : '<p class="msg">No rounds have been scheduled yet.</p>';
  }
  // Places gained (green up) or lost (red down) next to a result; blank means not recorded.
  function placesHtml(n) {
    if (n == null) return '<span class="pg0">–</span>';
    n = Number(n);
    return n > 0 ? '<span class="pgu" title="Gained ' + n + '">▲ ' + n + "</span>" : n < 0 ? '<span class="pgd" title="Lost ' + (-n) + '">▼ ' + (-n) + "</span>" : '<span class="pg0">0</span>';
  }
  // The tables for each race of a round: Pos, Driver, Places (when recorded), Best lap, Pts.
  function raceTables(rs) {
    return rs.map(function (x, i) {
      var pl = x.results.some(function (y) { return y.places_gained != null; }); // only when places gained and lost were recorded for this race
      return (rs.length > 1 ? '<div class="rtitle">' + esc(x.name || "Race " + (i + 1)) + "</div>" : "") +
        '<div class="wrapx"><table class="t"><thead><tr><th>Pos</th><th>Driver</th>' + (pl ? '<th title="Places gained or lost from the start">+/−</th>' : "") + '<th>Best lap</th><th>Pts</th></tr></thead><tbody>' +
        x.results.map(function (y) {
          return '<tr class="' + (y.position === 1 ? "top1" : "") + '"><td>' + (y.position != null ? y.position : "–") + "</td><td>" + esc(y.driver) + (y.status && y.status !== "finished" ? ' <span class="st">' + esc(y.status) + "</span>" : "") + (y.fastest_lap ? '<span class="fl" title="Fastest lap">FL</span>' : "") + "</td>" + (pl ? "<td>" + placesHtml(y.places_gained) + "</td>" : "") + "<td>" + esc(ms(y.best_lap_ms)) + "</td><td><b>" + (y.points == null ? "–" : esc(+y.points)) + "</b></td></tr>";
        }).join("") + "</tbody></table></div>";
    }).join("");
  }
  function resultsHtml(c) {
    var h = seasonsWrap(c, function (s) {
      return (s.rounds || []).filter(function (r) { return (r.races || []).some(function (x) { return (x.results || []).length; }); }).map(function (r) {
        var rs = r.races.filter(function (x) { return (x.results || []).length; });
        return '<details class="round"><summary class="sum"><div class="rnd">' + esc(r.round ? "Round " + r.round : "Round") + '</div><div class="big">' + esc(roundTitle(r).replace(/^Round \d+ · /, "")) + '</div><span class="chev" aria-hidden="true"></span></summary><div class="more">' +
          raceTables(rs) + "</div></details>";
      }).join("");
    });
    return h || '<p class="msg">No results yet.</p>';
  }
  function standingsHtml(c) {
    var h = seasonsWrap(c, function (s) {
      var by = {}, any = false, kinds = [];
      (s.rounds || []).forEach(function (r) { (r.races || []).forEach(function (x) { (x.results || []).forEach(function (y) {
        any = true; var d = by[y.driver] || (by[y.driver] = { driver: y.driver, pts: 0, wins: 0, pod: 0, fl: 0, starts: 0, kind: {} });
        var kn = x.name || "Race"; if (kinds.indexOf(kn) < 0) kinds.push(kn); d.kind[kn] = (d.kind[kn] || 0) + (Number(y.points) || 0);
        d.pts += Number(y.points) || 0; d.starts++; if (y.fastest_lap) d.fl++;
        if (isFin(y) && y.position === 1) d.wins++; if (isFin(y) && y.position != null && y.position <= 3) d.pod++;
      }); }); });
      if (!any) return "";
      var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.pts - a.pts || b.wins - a.wins || b.pod - a.pod || (a.driver.toLowerCase() < b.driver.toLowerCase() ? -1 : 1); });
      var rank = 0, prev = null;
      rows.forEach(function (r, i) { var sig = [r.pts, r.wins, r.pod].join("|"); if (sig !== prev) { rank = i + 1; prev = sig; } r.rank = rank; });
      // With more than one kind of race (a Sprint and a Main, say) each kind gets its own points column after the total.
      var split = kinds.length > 1 ? kinds : [];
      return '<div class="wrapx"><table class="t"><thead><tr><th>#</th><th>Driver</th><th>Total</th>' + split.map(function (k) { return "<th>" + esc(k) + "</th>"; }).join("") + '<th>Wins</th><th>Podiums</th><th>FL</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr class="' + (r.rank === 1 ? "top1" : "") + '"><td>' + r.rank + "</td><td>" + esc(r.driver) + "</td><td><b>" + esc(+r.pts.toFixed(2)) + "</b></td>" + split.map(function (k) { return "<td>" + (r.kind[k] == null ? "–" : esc(+r.kind[k].toFixed(2))) + "</td>"; }).join("") + "<td>" + r.wins + "</td><td>" + r.pod + "</td><td>" + r.fl + "</td></tr>"; }).join("") + "</tbody></table></div>";
    });
    return h || '<p class="msg">No standings yet. They appear once results are entered.</p>';
  }
  var TABS = [["builds", "Car builds", buildsHtml], ["calendar", "Calendar", calendarHtml], ["results", "Results", resultsHtml], ["standings", "Standings", standingsHtml]];

  function showChampionship(c) {
    FCMChrome.setLeague(c.league_id);
    if (c.can_edit) adminBar("Edit championship", "../admin/?l=" + encodeURIComponent(c.league_id) + "&c=" + encodeURIComponent(c.championship_id), c.is_public);
    if (c.palette) document.documentElement.setAttribute("data-palette", c.palette);
    head([c.league, c.championship]);
    var sub = document.getElementById("sub");
    if (c.league_published) sub.innerHTML = '<a href="?l=' + encodeURIComponent(c.league_id) + '" style="color:var(--link)">← All ' + esc(c.league) + " championships</a>"; else sub.textContent = "";
    var want = qs.get("t"), cur = TABS.some(function (t) { return t[0] === want; }) ? want : "calendar";
    function draw() {
      out.innerHTML = (c.description ? '<div class="notes" style="margin:0 0 12px"><b>Championship overview</b><br>' + esc(c.description) + "</div>" : "") +
        '<div class="row scrollrow" style="margin:0 0 12px" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === cur) + '"' + (t[0] === cur ? ' class="primary"' : "") + ">" + t[1] + "</button>"; }).join("") + '</div><div id="pane">' +
        TABS.filter(function (t) { return t[0] === cur; })[0][2](c) + "</div>";
      out.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () {
        cur = b.dataset.tab; try { var u = new URL(location.href); u.searchParams.set("t", cur); history.replaceState(null, "", u); } catch (e) {} draw();
      }); });
    }
    draw();
  }
  function safeUrl(u) { u = String(u || "").trim(); return /^https?:\/\/\S+$/i.test(u) ? u : ""; }
  // Plain text with line breaks; web addresses become links.
  function richText(t) { return esc(t).replace(/(https?:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer" style="color:var(--link)">' + u + "</a>"; }); }
  var SOC = [["website", "Website"], ["discord", "Discord"], ["youtube", "YouTube"], ["twitch", "Twitch"], ["x", "X"], ["instagram", "Instagram"]];
  var LTABS = [["overview", "Overview"], ["championships", "Championships"], ["calendar", "Calendar"], ["results", "Results"], ["standings", "Standings"], ["stats", "Stats"]];
  // Ranks come from the database order (points, wins, podiums); equal rows share a rank.
  function rankRows(rows) {
    var rank = 0, prev = null;
    return rows.map(function (r, i) { var sig = [r.points, r.wins, r.podiums].join("|"); if (sig !== prev) { rank = i + 1; prev = sig; } return Object.assign({ rank: rank }, r); });
  }
  function standingTable(rows) {
    // With more than one kind of race (a Sprint and a Main, say) each kind gets its own points column after the total.
    var kinds = []; rows.forEach(function (r) { (r.by_race || []).forEach(function (k) { if (kinds.indexOf(k.name) < 0) kinds.push(k.name); }); });
    if (kinds.length < 2) kinds = [];
    function kp(r, k) { var m = (r.by_race || []).filter(function (x) { return x.name === k; })[0]; return m ? "<td>" + esc(+Number(m.points).toFixed(2)) + "</td>" : "<td>–</td>"; }
    return '<div class="wrapx"><table class="t"><thead><tr><th>#</th><th>Driver</th><th>Total</th>' + kinds.map(function (k) { return "<th>" + esc(k) + "</th>"; }).join("") + '<th>Wins</th><th>Podiums</th><th>FL</th></tr></thead><tbody>' +
      rankRows(rows).map(function (r) { return '<tr class="' + (r.rank === 1 ? "top1" : "") + '"><td>' + r.rank + "</td><td>" + esc(r.driver) + "</td><td><b>" + esc(+Number(r.points).toFixed(2)) + "</b></td>" + kinds.map(function (k) { return kp(r, k); }).join("") + "<td>" + r.wins + "</td><td>" + r.podiums + "</td><td>" + r.fl + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }
  function leagueStandingsHtml(l) {
    var ss = l.standings || [];
    return ss.length ? ss.map(function (x) {
      return '<h2 class="sn">' + esc(x.championship) + (x.season ? " · " + esc(x.season) : "") + "</h2>" + (x.rows && x.rows.length ? standingTable(x.rows) : '<p class="msg">No standings yet.</p>') +
        '<div class="sub" style="margin-top:8px"><a href="?c=' + encodeURIComponent(x.championship_id) + '&t=standings" style="color:var(--link)">Full championship page →</a></div>';
    }).join("") : '<p class="msg">No standings yet. They appear once results are entered.</p>';
  }
  function champCardsHtml(cs, full) {
    return cs.length ? '<div class="cards">' + cs.map(function (c) {
      return '<a class="card" href="?c=' + encodeURIComponent(c.id) + '"><b>' + esc(c.name) + "</b>" + (c.description ? "<span>" + esc(full ? c.description : String(c.description).slice(0, 140)) + "</span>" : "") + '<span class="go">Builds, calendar, results and standings →</span></a>';
    }).join("") + "</div>" : '<p class="msg">No championships to show yet.</p>';
  }
  function leagueCalendarHtml(l) {
    var rs = l.calendar || [], z = ""; try { z = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    return rs.length ? '<p class="sub" style="margin:0 0 4px">Upcoming rounds across all championships. Times are shown in your local time' + (z ? " (" + esc(z.replace(/_/g, " ")) + ")" : "") + ".</p>" + rs.map(roundHtml).join("") : '<p class="msg">No upcoming rounds are scheduled.</p>';
  }
  function leagueResultsHtml(l) {
    var ls = l.latest || [];
    return ls.length ? '<p class="sub" style="margin:0 0 4px">The latest round with results in each championship.</p>' + ls.map(function (r) {
      return '<div class="round"><div class="rnd">' + esc(r.championship) + (r.round ? " · Round " + esc(r.round) : "") + '</div><div class="big">' + esc(roundTitle(r).replace(/^Round \d+ · /, "")) + "</div>" + raceTables(r.races || []) +
        '<div class="sub" style="margin-top:8px"><a href="?c=' + encodeURIComponent(r.championship_id) + '&t=standings" style="color:var(--link)">Full results and standings →</a></div></div>';
    }).join("") : '<p class="msg">No results yet.</p>';
  }
  function overviewHtml(l) {
    var h = "", ban = safeUrl(l.banner_url);
    if (ban) h += '<img src="' + esc(ban) + '" alt="" style="display:block;width:100%;max-height:200px;object-fit:cover;border-radius:6px;margin:0 0 12px" onerror="this.remove()">';
    var L = l.links || {}, soc = SOC.filter(function (o) { return safeUrl(L[o[0]]); });
    if (soc.length) h += '<div class="actrow">' + soc.map(function (o) { return '<a class="btn nav" href="' + esc(safeUrl(L[o[0]])) + '" target="_blank" rel="noopener noreferrer">' + o[1] + "</a>"; }).join("") + "</div>";
    if (l.about) h += '<p class="desc" style="color:var(--ink)">' + richText(l.about) + "</p>";
    if (l.join_text) h += '<div class="notes" style="margin:0 0 12px"><b>How to join</b><br>' + richText(l.join_text) + "</div>";
    // Two columns that start on the same line: the next race and the championships, then a sidebar with the latest results and the standings.
    var n = l.next, main = "", side = "";
    if (n && n.starts_at) {
      var d = new Date(n.starts_at);
      main += '<h2 class="sn">Next race</h2><div class="round"><div class="rnd">' + esc(n.championship) + (n.round ? " · Round " + esc(n.round) : "") + '</div><div class="big">' + esc(dateText(d)) + " · " + esc(timeText(d, true)) + "</div>" +
        (n.track ? '<div class="big">' + esc(n.track.venue + (n.track.layout ? " · " + n.track.layout : "")) + "</div>" : "") + "</div>";
    }
    main += '<h2 class="sn">Championships</h2>' + champCardsHtml(l.championships || [], false);
    var ls = l.latest || [];
    if (ls.length) side += '<h2 class="sn">Latest results</h2>' + ls.map(function (r) {
      var top = ((r.races || [])[0] || { results: [] }).results.filter(function (y) { return y.position != null && y.position <= 3; });
      return '<div class="round"><div class="rnd">' + esc(r.championship) + (r.round ? " · Round " + esc(r.round) : "") + "</div>" + (top.length ? '<ol class="rk">' + top.map(function (y) { return "<li><span><b>" + y.position + "</b>" + esc(y.driver) + "</span></li>"; }).join("") + "</ol>" : "") + "</div>";
    }).join("");
    var sd = (l.standings || []).filter(function (x) { return x.rows && x.rows.length; });
    if (sd.length) side += '<h2 class="sn">Standings</h2>' + sd.map(function (x) {
      return '<div class="round"><div class="rnd">' + esc(x.championship) + (x.season ? " · " + esc(x.season) : "") + '</div><ol class="rk">' + rankRows(x.rows).slice(0, 3).map(function (r) { return "<li><span><b>" + r.rank + "</b>" + esc(r.driver) + "</span><em>" + esc(+Number(r.points).toFixed(2)) + "</em></li>"; }).join("") + "</ol></div>";
    }).join("");
    h += '<div class="cols"><div class="col">' + main + "</div>" + (side ? '<aside class="col">' + side + "</aside>" : "") + "</div>";
    return h;
  }
  function showLeague(l) {
    FCMChrome.setLeague(l.league_id);
    if (l.can_edit) adminBar("Edit league", "../admin/?l=" + encodeURIComponent(l.league_id) + "&v=league", l.is_public);
    if (l.palette) document.documentElement.setAttribute("data-palette", l.palette);
    head([l.league]);
    document.getElementById("sub").textContent = l.tagline || "";
    var want = qs.get("t"), cur = LTABS.some(function (t) { return t[0] === want; }) ? want : "overview";
    var body = { overview: overviewHtml, championships: function (x) { return champCardsHtml(x.championships || [], true); }, calendar: leagueCalendarHtml, results: leagueResultsHtml, standings: leagueStandingsHtml, stats: function () { return '<div id="statsbox"><p class="msg">Loading stats…</p></div>'; } };
    function draw() {
      out.innerHTML = '<div class="row scrollrow" style="margin:0 0 12px" role="tablist">' + LTABS.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === cur) + '"' + (t[0] === cur ? ' class="primary"' : "") + ">" + t[1] + "</button>"; }).join("") + '</div><div id="pane">' + body[cur](l) + "</div>";
      out.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () {
        cur = b.dataset.tab; try { var u = new URL(location.href); u.searchParams.set("t", cur); ["d", "a", "b", "sc"].forEach(function (k) { u.searchParams.delete(k); }); history.replaceState(null, "", u); } catch (e) {} draw();
      }); });
      if (cur === "stats" && window.FCMStats) FCMStats.draw(document.getElementById("statsbox"), l, sb);
    }
    draw();
  }

  if (cid) sb.rpc("public_championship", { cid: cid }).then(function (r) {
    if (r.error) { note("This page could not be loaded."); return; }
    if (!r.data) { note("This page isn't available."); return; }
    showChampionship(r.data);
  });
  else sb.rpc("public_league", { lid: lid }).then(function (r) {
    if (r.error) { note("This page could not be loaded."); return; }
    if (!r.data) { note("This page isn't available."); return; }
    showLeague(r.data);
  });
})();
