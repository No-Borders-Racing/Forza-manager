(function () {
  "use strict";
  var out = document.getElementById("out"), cfg = window.FCM_CONFIG;
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
    var head = '<div class="rnd">' + (r.round ? "Round " + esc(r.round) : esc(r.name || "Round")) +
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
  function note(t) { out.innerHTML = '<p class="msg">' + esc(t) + "</p>"; }
  var qs = new URLSearchParams(location.search), cid = qs.get("c"), lid = qs.get("l");
  if (!cid && !lid) { note("This link is missing its championship."); return; }
  if (!window.supabase || !cfg) { note("This page could not be loaded."); return; }
  var sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  function head(parts) {
    document.title = parts.join(" · ");
    document.getElementById("title").innerHTML = parts.map(function (x, i) { return (i ? '<span class="sep">·</span> ' : "") + "<span>" + esc(x) + "</span>"; }).join(" ");
  }
  function adminBar(label, href, table, id, flag) {
    var bar = document.createElement("div"); bar.className = "bar";
    bar.innerHTML = '<span class="pill">Admin</span><a class="btn primary" href="' + esc(href) + '">' + esc(label) + '</a><button type="button" id="up">Unpublish</button><span class="m" id="bm"></span>';
    document.querySelector("main").insertBefore(bar, document.querySelector("header"));
    bar.querySelector("#up").addEventListener("click", function () {
      var m = bar.querySelector("#bm"), patch = {}; patch[flag] = false; m.textContent = "Unpublishing…";
      sb.from(table).update(patch).eq("id", id).then(function (x) { if (x.error) { m.textContent = x.error.message; return; } location.reload(); });
    });
  }
  function ms(n) { if (n == null) return ""; var m = Math.floor(n / 60000), s = (n % 60000) / 1000; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(3); }
  function roundTitle(r) {
    var t = r.track ? r.track.venue + (r.track.layout ? " · " + r.track.layout : "") : (r.name || "");
    return (r.round ? "Round " + r.round : "") + (r.round && t ? " · " : "") + t || "Round";
  }
  function isFin(x) { return x.status === "finished" || (x.status === "dnf" && x.position != null); }

  /* ----- tabs ----- */
  function buildsHtml(c) {
    var bs = c.builds || []; if (!bs.length) return '<p class="msg">No car builds have been published for this championship yet.</p>';
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
  function resultsHtml(c) {
    var h = seasonsWrap(c, function (s) {
      return (s.rounds || []).filter(function (r) { return (r.races || []).some(function (x) { return (x.results || []).length; }); }).map(function (r) {
        var rs = r.races.filter(function (x) { return (x.results || []).length; });
        return '<details class="round"><summary class="sum"><div class="rnd">' + esc(r.round ? "Round " + r.round : "Round") + '</div><div class="big">' + esc(roundTitle(r).replace(/^Round \d+ · /, "")) + '</div><span class="chev" aria-hidden="true"></span></summary><div class="more">' +
          rs.map(function (x, i) {
            return (rs.length > 1 ? '<div class="rtitle">' + esc(x.name || "Race " + (i + 1)) + "</div>" : "") +
              '<div class="wrapx"><table class="t"><thead><tr><th>Pos</th><th>Driver</th><th>Best lap</th><th>Pts</th></tr></thead><tbody>' +
              x.results.map(function (y) {
                return '<tr class="' + (y.position === 1 ? "top1" : "") + '"><td>' + (y.position != null ? y.position : "–") + "</td><td>" + esc(y.driver) + (y.status && y.status !== "finished" ? ' <span class="st">' + esc(y.status) + "</span>" : "") + (y.fastest_lap ? '<span class="fl" title="Fastest lap">FL</span>' : "") + "</td><td>" + esc(ms(y.best_lap_ms)) + "</td><td><b>" + (y.points == null ? "–" : esc(+y.points)) + "</b></td></tr>";
              }).join("") + "</tbody></table></div>";
          }).join("") + "</div></details>";
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
    if (c.can_edit) adminBar("Edit championship", "../admin/?l=" + encodeURIComponent(c.league_id) + "&c=" + encodeURIComponent(c.championship_id), "championships", c.championship_id, "page_published");
    if (c.palette) document.documentElement.setAttribute("data-palette", c.palette);
    head([c.league, c.championship]);
    var sub = document.getElementById("sub");
    if (c.league_published) sub.innerHTML = '<a href="?l=' + encodeURIComponent(c.league_id) + '" style="color:var(--link)">← All ' + esc(c.league) + " championships</a>"; else sub.textContent = "";
    var want = qs.get("t"), cur = TABS.some(function (t) { return t[0] === want; }) ? want : "calendar";
    function draw() {
      out.innerHTML = (c.description ? '<p class="desc">' + esc(c.description) + "</p>" : "") +
        '<div class="tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-t="' + t[0] + '" aria-selected="' + (t[0] === cur) + '">' + t[1] + "</button>"; }).join("") + '</div><div id="pane">' +
        TABS.filter(function (t) { return t[0] === cur; })[0][2](c) + "</div>";
      out.querySelectorAll("[data-t]").forEach(function (b) { b.addEventListener("click", function () {
        cur = b.dataset.t; try { var u = new URL(location.href); u.searchParams.set("t", cur); history.replaceState(null, "", u); } catch (e) {} draw();
      }); });
    }
    draw();
  }
  function showLeague(l) {
    if (l.can_edit) adminBar("Edit league", "../admin/?l=" + encodeURIComponent(l.league_id), "leagues", l.league_id, "page_published");
    if (l.palette) document.documentElement.setAttribute("data-palette", l.palette);
    head([l.league]);
    var cs = l.championships || [];
    out.innerHTML = cs.length ? '<div class="cards">' + cs.map(function (c) {
      return '<a class="card" href="?c=' + encodeURIComponent(c.id) + '"><b>' + esc(c.name) + "</b>" + (c.description ? "<span>" + esc(String(c.description).slice(0, 140)) + "</span>" : "") + '<span class="go">Builds, calendar, results and standings →</span></a>';
    }).join("") + "</div>" : '<p class="msg">No championships have been published yet.</p>';
  }

  if (cid) sb.rpc("public_championship", { cid: cid }).then(function (r) {
    if (r.error) { note("This page could not be loaded."); return; }
    if (!r.data) { note("This championship is not published."); return; }
    showChampionship(r.data);
  });
  else sb.rpc("public_league", { lid: lid }).then(function (r) {
    if (r.error) { note("This page could not be loaded."); return; }
    if (!r.data) { note("This league page is not published."); return; }
    showLeague(r.data);
  });
})();
