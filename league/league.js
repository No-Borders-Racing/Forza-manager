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
  function buildsHtml(c) {
    var bs = c.builds || []; if (!bs.length) return '<p class="msg">No car builds to show for this championship yet.</p>';
    return '<div class="cards">' + bs.map(function (b) {
      var sub = [b.car, [b.class, b.pi].filter(function (x) { return x != null && x !== ""; }).join(" ")].filter(Boolean).join(" · ");
      return '<a class="card" href="' + esc("../admin/builds/sheet.html?pub=" + encodeURIComponent(b.id)) + '"><b>' + esc(b.name) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + '<span class="go">View build sheet →</span></a>';
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
  // The tables for each race of a round: Pos, Driver, Best lap, Pts.
  function raceTables(rs) {
    return rs.map(function (x, i) {
      return (rs.length > 1 ? '<div class="rtitle">' + esc(x.name || "Race " + (i + 1)) + "</div>" : "") +
        '<div class="wrapx"><table class="t"><thead><tr><th>Pos</th><th>Driver</th><th>Best lap</th><th>Pts</th></tr></thead><tbody>' +
        x.results.map(function (y) {
          return '<tr class="' + (y.position === 1 ? "top1" : "") + '"><td>' + (y.position != null ? y.position : "–") + "</td><td>" + esc(y.driver) + (y.status && y.status !== "finished" ? ' <span class="st">' + esc(y.status) + "</span>" : "") + (y.fastest_lap ? '<span class="fl" title="Fastest lap">FL</span>' : "") + "</td><td>" + esc(ms(y.best_lap_ms)) + "</td><td><b>" + (y.points == null ? "–" : esc(+y.points)) + "</b></td></tr>";
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
      var by = {}, any = false;
      (s.rounds || []).forEach(function (r) { (r.races || []).forEach(function (x) { (x.results || []).forEach(function (y) {
        any = true; var d = by[y.driver] || (by[y.driver] = { driver: y.driver, pts: 0, wins: 0, pod: 0, fl: 0, starts: 0 });
        d.pts += Number(y.points) || 0; d.starts++; if (y.fastest_lap) d.fl++;
        if (isFin(y) && y.position === 1) d.wins++; if (isFin(y) && y.position != null && y.position <= 3) d.pod++;
      }); }); });
      if (!any) return "";
      var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.pts - a.pts || b.wins - a.wins || b.pod - a.pod || (a.driver.toLowerCase() < b.driver.toLowerCase() ? -1 : 1); });
      var rank = 0, prev = null;
      rows.forEach(function (r, i) { var sig = [r.pts, r.wins, r.pod].join("|"); if (sig !== prev) { rank = i + 1; prev = sig; } r.rank = rank; });
      return '<div class="wrapx"><table class="t"><thead><tr><th>#</th><th>Driver</th><th>Pts</th><th>Wins</th><th>Podiums</th><th>FL</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr class="' + (r.rank === 1 ? "top1" : "") + '"><td>' + r.rank + "</td><td>" + esc(r.driver) + "</td><td><b>" + esc(+r.pts.toFixed(2)) + "</b></td><td>" + r.wins + "</td><td>" + r.pod + "</td><td>" + r.fl + "</td></tr>"; }).join("") + "</tbody></table></div>";
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
      out.innerHTML = (c.description ? '<p class="desc">' + esc(c.description) + "</p>" : "") +
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
  var LTABS = [["overview", "Overview"], ["championships", "Championships"], ["calendar", "Calendar"], ["results", "Results"], ["standings", "Standings"]];
  // Ranks come from the database order (points, wins, podiums); equal rows share a rank.
  function rankRows(rows) {
    var rank = 0, prev = null;
    return rows.map(function (r, i) { var sig = [r.points, r.wins, r.podiums].join("|"); if (sig !== prev) { rank = i + 1; prev = sig; } return Object.assign({ rank: rank }, r); });
  }
  function standingTable(rows) {
    return '<div class="wrapx"><table class="t"><thead><tr><th>#</th><th>Driver</th><th>Pts</th><th>Wins</th><th>Podiums</th><th>FL</th></tr></thead><tbody>' +
      rankRows(rows).map(function (r) { return '<tr class="' + (r.rank === 1 ? "top1" : "") + '"><td>' + r.rank + "</td><td>" + esc(r.driver) + "</td><td><b>" + esc(+Number(r.points).toFixed(2)) + "</b></td><td>" + r.wins + "</td><td>" + r.podiums + "</td><td>" + r.fl + "</td></tr>"; }).join("") + "</tbody></table></div>";
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
    var n = l.next;
    if (n && n.starts_at) {
      var d = new Date(n.starts_at);
      h += '<h2 class="sn">Next race</h2><div class="round"><div class="rnd">' + esc(n.championship) + (n.round ? " · Round " + esc(n.round) : "") + '</div><div class="big">' + esc(dateText(d)) + " · " + esc(timeText(d, true)) + "</div>" +
        (n.track ? '<div class="big">' + esc(n.track.venue + (n.track.layout ? " · " + n.track.layout : "")) + "</div>" : "") + "</div>";
    }
    var ls = l.latest || [];
    if (ls.length) h += '<h2 class="sn">Latest results</h2>' + ls.map(function (r) {
      var top = ((r.races || [])[0] || { results: [] }).results.filter(function (y) { return y.position != null && y.position <= 3; });
      return '<div class="round"><div class="rnd">' + esc(r.championship) + (r.round ? " · Round " + esc(r.round) : "") + "</div>" + (top.length ? '<div class="line">' + top.map(function (y) { return "<b>" + y.position + ".</b> " + esc(y.driver); }).join(" &nbsp; ") + "</div>" : "") + "</div>";
    }).join("");
    var sd = (l.standings || []).filter(function (x) { return x.rows && x.rows.length; });
    if (sd.length) h += '<h2 class="sn">Standings</h2>' + sd.map(function (x) {
      return '<div class="round"><div class="rnd">' + esc(x.championship) + (x.season ? " · " + esc(x.season) : "") + '</div><div class="line">' + rankRows(x.rows).slice(0, 3).map(function (r) { return "<b>" + r.rank + ".</b> " + esc(r.driver) + " (" + esc(+Number(r.points).toFixed(2)) + ")"; }).join(" &nbsp; ") + "</div></div>";
    }).join("");
    h += '<h2 class="sn">Championships</h2>' + champCardsHtml(l.championships || [], false);
    return h;
  }
  function showLeague(l) {
    FCMChrome.setLeague(l.league_id);
    if (l.can_edit) adminBar("Edit league", "../admin/?l=" + encodeURIComponent(l.league_id) + "&v=league", l.is_public);
    if (l.palette) document.documentElement.setAttribute("data-palette", l.palette);
    head([l.league]);
    document.getElementById("sub").textContent = l.tagline || "";
    var want = qs.get("t"), cur = LTABS.some(function (t) { return t[0] === want; }) ? want : "overview";
    var body = { overview: overviewHtml, championships: function (x) { return champCardsHtml(x.championships || [], true); }, calendar: leagueCalendarHtml, results: leagueResultsHtml, standings: leagueStandingsHtml };
    function draw() {
      out.innerHTML = '<div class="row scrollrow" style="margin:0 0 12px" role="tablist">' + LTABS.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === cur) + '"' + (t[0] === cur ? ' class="primary"' : "") + ">" + t[1] + "</button>"; }).join("") + '</div><div id="pane">' + body[cur](l) + "</div>";
      out.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () {
        cur = b.dataset.tab; try { var u = new URL(location.href); u.searchParams.set("t", cur); history.replaceState(null, "", u); } catch (e) {} draw();
      }); });
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
