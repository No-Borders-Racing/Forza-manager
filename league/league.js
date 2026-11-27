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
      return '<a class="card" href="' + esc("../admin/builds/sheet.html?v=20261128a&pub=" + encodeURIComponent(b.id)) + '"><b>' + esc(b.name) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + '<span class="go">View build sheet →</span></a>';
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
  // The champion(s) of a championship page: first place in the latest season that has results.
  function championsOf(c) {
    var ss = (c.seasons || []).slice().reverse();
    for (var i = 0; i < ss.length; i++) {
      var by = {}, any = false;
      (ss[i].rounds || []).forEach(function (r) { (r.races || []).forEach(function (x) { (x.results || []).forEach(function (y) {
        any = true; var d = by[y.driver] || (by[y.driver] = { driver: y.driver, pts: 0, wins: 0, pod: 0 });
        d.pts += Number(y.points) || 0; if (isFin(y) && y.position === 1) d.wins++; if (isFin(y) && y.position != null && y.position <= 3) d.pod++;
      }); }); });
      if (!any) continue;
      var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.pts - a.pts || b.wins - a.wins || b.pod - a.pod; });
      var top = rows[0]; return rows.filter(function (r) { return r.pts === top.pts && r.wins === top.wins && r.pod === top.pod; }).map(function (r) { return r.driver; });
    }
    return [];
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
        rows.map(function (r) { return '<tr class="' + (r.rank === 1 ? "top1" : "") + (r.rank <= 3 ? " r" + r.rank : "") + '"><td><span class="chip">' + r.rank + "</span></td><td>" + FCMFlair.av(r.driver) + '<span class="dn">' + esc(r.driver) + "</span>" + (c.completed && r.rank === 1 ? ' <span class="pill">Champion</span>' : "") + '<span class="bar"><i style="width:' + Math.max(2, Math.round(100 * (r.pts || 0) / (rows[0].pts || 1))) + '%"></i></span></td><td><b>' + esc(+r.pts.toFixed(2)) + "</b></td>" + split.map(function (k) { return "<td>" + (r.kind[k] == null ? "–" : esc(+r.kind[k].toFixed(2))) + "</td>"; }).join("") + "<td>" + r.wins + "</td><td>" + r.pod + "</td><td>" + r.fl + "</td></tr>"; }).join("") + "</tbody></table></div>";
    });
    return h || '<p class="msg">No standings yet. They appear once results are entered.</p>';
  }
  // The championship rules the admin wrote (plain text, line breaks kept, web addresses become links).
  function rulesHtml(c) { return '<div class="notes" style="white-space:pre-wrap">' + richText(String(c.rules)) + "</div>"; }
  var TABS = [["builds", "Car builds", buildsHtml], ["calendar", "Calendar", calendarHtml], ["results", "Results", resultsHtml], ["standings", "Standings", standingsHtml]];

  function showChampionship(c) {
    FCMChrome.setLeague(c.league_id);
    if (c.can_edit) adminBar("Edit championship", "../admin/?l=" + encodeURIComponent(c.league_id) + "&c=" + encodeURIComponent(c.championship_id), c.is_public);
    if (c.palette) document.documentElement.setAttribute("data-palette", c.palette);
    head([c.league, c.championship]);
    var sub = document.getElementById("sub");
    if (c.league_published) sub.innerHTML = '<a href="?l=' + encodeURIComponent(c.league_id) + '" style="color:var(--link)">← All ' + esc(c.league) + " championships</a>"; else sub.textContent = "";
    var tabs = (String(c.rules || "").trim() ? [["rules", "Rules", rulesHtml]] : []).concat(TABS);
    var want = qs.get("t"), cur = tabs.some(function (t) { return t[0] === want; }) ? want : (c.completed ? "standings" : "calendar");
    var champs = c.completed ? championsOf(c) : [];
    function draw() {
      out.innerHTML = (c.completed ? (champs.length ? '<div class="champion"><span class="trophy">' + TROPHY.replace(/width="\d+"/, 'width="34"').replace(/height="\d+"/, 'height="34"') + '</span><div><div class="kick">Champion' + (champs.length > 1 ? "s" : "") + '</div><div class="cname">' + champs.map(esc).join(" · ") + '</div><div class="muted">This championship has finished. The standings are final.</div></div></div>' : '<div class="notes" style="margin:0 0 12px"><span class="pill">Completed</span> This championship has finished. The standings are final.</div>') : "") + (c.description ? '<div class="notes" style="margin:0 0 12px"><b>Championship overview</b><br>' + esc(c.description) + "</div>" : "") +
        '<div class="row scrollrow" style="margin:0 0 12px" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === cur) + '"' + (t[0] === cur ? ' class="primary"' : "") + ">" + FCMFlair.ico(t[0]) + t[1] + "</button>"; }).join("") + '</div><div id="pane">' +
        tabs.filter(function (t) { return t[0] === cur; })[0][2](c) + "</div>";
      out.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () {
        cur = b.dataset.tab; try { var u = new URL(location.href); u.searchParams.set("t", cur); history.replaceState(null, "", u); } catch (e) {} draw();
      }); });
    }
    draw();
    FCMFlair.tick();
  }
  function safeUrl(u) { u = String(u || "").trim(); return /^https?:\/\/\S+$/i.test(u) ? u : ""; }
  // Plain text with line breaks; web addresses become links.
  function richText(t) { return esc(t).replace(/(https?:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer" style="color:var(--link)">' + u + "</a>"; }); }
  var SOCICO = {
    discord: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="margin-right:7px;vertical-align:-3px"><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .079.009c.12.1.246.198.373.293a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"/></svg>',
    youtube: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="margin-right:7px;vertical-align:-3px"><path fill="currentColor" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    twitch: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="margin-right:7px;vertical-align:-3px"><path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>',
    x: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="margin-right:7px;vertical-align:-3px"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
    instagram: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="margin-right:7px;vertical-align:-3px"><path fill="currentColor" d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 1 0 0-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 0 1-2.88 0 1.44 1.44 0 0 1 2.88 0z"/></svg>',
    website: '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="margin-right:7px;vertical-align:-3px"><g fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><ellipse cx="12" cy="12" rx="4" ry="9.5"/><path d="M2.5 12h19"/></g></svg>'
  };
  var SOC = [["website", "Website"], ["discord", "Discord"], ["youtube", "YouTube"], ["twitch", "Twitch"], ["x", "X"], ["instagram", "Instagram"]];
  var LTABS = [["overview", "Overview"], ["championships", "Championships"], ["calendar", "Calendar"], ["results", "Results"], ["standings", "Standings"], ["stats", "Stats"]];
  // Top three as a podium: second, first, third, with the tallest block in the middle.
  function podium(rows) {
    if (rows.length < 3) return '<ol class="rk">' + rows.map(function (r) { return "<li><span><b>" + r.rank + "</b>" + esc(r.driver) + "</span><em>" + esc(+Number(r.points).toFixed(2)) + "</em></li>"; }).join("") + "</ol>";
    return '<div class="podium">' + [1, 0, 2].map(function (i) {
      var r = rows[i];
      return '<div class="pcol p' + (i + 1) + '">' + FCMFlair.av(r.driver) + '<div class="pn">' + esc(r.driver) + '</div><div class="pp">' + esc(+Number(r.points).toFixed(2)) + '</div><div class="blk"><b>' + r.rank + "</b></div></div>";
    }).join("") + "</div>";
  }
  // Ranks come from the database order (points, wins, podiums); equal rows share a rank.
  function rankRows(rows) {
    var rank = 0, prev = null;
    return rows.map(function (r, i) { var sig = [r.points, r.wins, r.podiums].join("|"); if (sig !== prev) { rank = i + 1; prev = sig; } return Object.assign({ rank: rank }, r); });
  }
  function standingTable(rows) {
    // With more than one kind of race (a Sprint and a Main, say) each kind gets its own points column after the total.
    var kinds = []; rows.forEach(function (r) { (r.by_race || []).forEach(function (k) { if (kinds.indexOf(k.name) < 0) kinds.push(k.name); }); });
    if (kinds.length < 2) kinds = [];
    var top = rows.reduce(function (m, r) { return Math.max(m, Number(r.points) || 0); }, 0) || 1;
    function kp(r, k) { var m = (r.by_race || []).filter(function (x) { return x.name === k; })[0]; return m ? "<td>" + esc(+Number(m.points).toFixed(2)) + "</td>" : "<td>–</td>"; }
    return '<div class="wrapx"><table class="t"><thead><tr><th>#</th><th>Driver</th><th>Total</th>' + kinds.map(function (k) { return "<th>" + esc(k) + "</th>"; }).join("") + '<th>Wins</th><th>Podiums</th><th>FL</th></tr></thead><tbody>' +
      rankRows(rows).map(function (r) { return '<tr class="' + (r.rank === 1 ? "top1" : "") + (r.rank <= 3 ? " r" + r.rank : "") + '"><td><span class="chip">' + r.rank + "</span></td><td>" + FCMFlair.av(r.driver) + '<span class="dn">' + esc(r.driver) + '</span><span class="bar"><i style="width:' + Math.max(2, Math.round(100 * (Number(r.points) || 0) / top)) + '%"></i></span></td><td><b>' + esc(+Number(r.points).toFixed(2)) + "</b></td>" + kinds.map(function (k) { return kp(r, k); }).join("") + "<td>" + r.wins + "</td><td>" + r.podiums + "</td><td>" + r.fl + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }
  function leagueStandingsHtml(l) {
    var ss = l.standings || [];
    return ss.length ? ss.map(function (x) {
      return '<h2 class="sn">' + esc(x.championship) + (x.season ? " · " + esc(x.season) : "") + "</h2>" + (x.rows && x.rows.length ? standingTable(x.rows) : '<p class="msg">No standings yet.</p>') +
        '<div class="sub" style="margin-top:8px"><a href="?c=' + encodeURIComponent(x.championship_id) + '&t=standings" style="color:var(--link)">Full championship page →</a></div>';
    }).join("") : '<p class="msg">No standings yet. They appear once results are entered.</p>';
  }
  // "Champion: name" for a completed championship, from the first row of its standings on the league page.
  var TROPHY = '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 3h10v3h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 13H8a4 4 0 0 1-4-4V6h3V3Zm-1 5v1a2 2 0 0 0 1 1.7V8H6Zm12 0h-1v2.7A2 2 0 0 0 18 9V8Z"/></svg>';
  var FLAG = '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M5 3h2v18H5V3Zm3 1h11l-2 4 2 4H8V4Z"/></svg>';
  function championLine(id, ss) {
    var x = (ss || []).filter(function (y) { return y.championship_id === id; })[0], r = x && x.rows;
    if (!r || !r.length) return "";
    var top = r[0], names = r.filter(function (y) { return y.points === top.points && y.wins === top.wins && y.podiums === top.podiums; }).map(function (y) { return y.driver; });
    return "<span><strong>Champion" + (names.length > 1 ? "s" : "") + ":</strong> " + names.map(esc).join(", ") + "</span>";
  }
  function champCardsHtml(cs, full, ss) {
    return cs.length ? '<div class="cards">' + cs.map(function (c) {
      return '<a class="card" href="?c=' + encodeURIComponent(c.id) + '"><b>' + (c.completed ? TROPHY : FLAG) + esc(c.name) + (c.completed ? ' <span class="pill">Completed</span>' : "") + "</b>" + (c.completed ? championLine(c.id, ss) : "") + (c.description ? "<span>" + esc(full ? c.description : String(c.description).slice(0, 140)) + "</span>" : "") + '<span class="go">Builds, calendar, results and standings →</span></a>';
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
    if (soc.length) h += '<div class="actrow">' + soc.map(function (o) { return '<a class="btn nav" href="' + esc(safeUrl(L[o[0]])) + '" target="_blank" rel="noopener noreferrer">' + (SOCICO[o[0]] || "") + o[1] + "</a>"; }).join("") + "</div>";
    if (l.about) h += '<p class="desc" style="color:var(--ink)">' + richText(l.about) + "</p>";
    if (l.join_text) h += '<div class="notes" style="margin:0 0 12px"><b>How to join</b><br>' + richText(l.join_text) + "</div>";
    // Two columns that start on the same line: the next race and the championships, then a sidebar with the latest results and the standings.
    var n = l.next, main = "", side = "";
    // A round that started earlier today is still shown, as today's race.
    var isToday = n && n.starts_at && new Date(n.starts_at).toDateString() === new Date().toDateString();
    if (n && n.starts_at && (isToday || new Date(n.starts_at).getTime() >= Date.now())) {
      var d = new Date(n.starts_at);
      main += '<h2 class="sn">' + FCMFlair.ico(isToday ? "clock" : "calendar", 18) + (isToday ? "Today's race" : "Next race") + "</h2>" + FCMFlair.nextTile({ iso: n.starts_at, kicker: n.championship + (n.round ? " · Round " + n.round : ""),
        title: n.track ? n.track.venue + (n.track.layout ? " · " + n.track.layout : "") : dateText(d), sub: dateText(d) + " · " + timeText(d, true) });
    }
    main += '<h2 class="sn">' + FCMFlair.ico("championships", 18) + 'Championships</h2>' + champCardsHtml(l.championships || [], false, l.standings);
    var ls = l.latest || [];
    if (ls.length) side += '<h2 class="sn">' + FCMFlair.ico("results", 18) + 'Latest results <a class="more" href="?l=' + encodeURIComponent(lid) + '&t=results">All results →</a></h2>' + ls.map(function (r) {
      var top = ((r.races || [])[0] || { results: [] }).results.filter(function (y) { return y.position != null && y.position <= 3; });
      return '<a class="round go" href="?c=' + encodeURIComponent(r.championship_id) + '&t=results"><div class="rnd">' + esc(r.championship) + (r.round ? " · Round " + esc(r.round) : "") + "</div>" + (top.length ? '<ol class="rk">' + top.map(function (y) { return "<li><span><b>" + y.position + "</b>" + esc(y.driver) + "</span></li>"; }).join("") + "</ol>" : "") + '<span class="goto">Full results →</span></a>';
    }).join("");
    var sd = (l.standings || []).filter(function (x) { return x.rows && x.rows.length; });
    if (sd.length) side += '<h2 class="sn">' + FCMFlair.ico("standings", 18) + 'Standings <a class="more" href="?l=' + encodeURIComponent(lid) + '&t=standings">All standings →</a></h2>' + sd.map(function (x) {
      return '<a class="round go" href="?c=' + encodeURIComponent(x.championship_id) + '&t=standings"><div class="rnd">' + esc(x.championship) + (x.season ? " · " + esc(x.season) : "") + '</div>' + podium(rankRows(x.rows).slice(0, 3)) + '<span class="goto">Full standings →</span></a>';
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
    var body = { overview: overviewHtml, championships: function (x) { return champCardsHtml(x.championships || [], true, x.standings); }, calendar: leagueCalendarHtml, results: leagueResultsHtml, standings: leagueStandingsHtml, stats: function () { return '<div id="statsbox"><p class="msg">Loading stats…</p></div>'; } };
    function draw() {
      out.innerHTML = '<div class="row scrollrow" style="margin:0 0 12px" role="tablist">' + LTABS.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === cur) + '"' + (t[0] === cur ? ' class="primary"' : "") + ">" + FCMFlair.ico(t[0]) + t[1] + "</button>"; }).join("") + '</div><div id="pane">' + body[cur](l) + "</div>";
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
