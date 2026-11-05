/* Home: the admin landing page with the quick actions and the next race. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

function whenText(iso) {
  try { return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso)); } catch (e) { return String(iso); }
}
function renderHome() {
  var lg = state.league; state.sel = null; state.nav = { view: "champ" };
  app.innerHTML = navHtml("h") + '<div class="card"><h2 style="margin:0">' + esc(lg && lg.name ? lg.name : "League") + '</h2><div id="hm" class="muted" style="margin-top:8px">Loading…</div></div>';
  bindNav();
  var lid = lg.id, now = Date.now();
  sb.from("championships").select("*").eq("league_id", lid).order("created_at", { ascending: false }).then(function (cr) {
    if (cr.error) { $("#hm").innerHTML = '<span class="err">' + esc(dbError(cr.error)) + "</span>"; return; }
    var champs = cr.data || [], cids = champs.map(function (c) { return c.id; });
    var sP = cids.length ? sb.from("seasons").select("*").in("championship_id", cids) : Promise.resolve({ data: [] });
    sP.then(function (sr) {
      var seasons = sr.data || [], sids = seasons.map(function (x) { return x.id; });
      var eP = sids.length ? sb.from("events").select("id,season_id,name,round_number,starts_at,lobby_opens_at,status,track_layout_id").in("season_id", sids) : Promise.resolve({ data: [] });
      eP.then(function (er) {
        var evs = (er.data || []).filter(function (e) { return e.status !== "cancelled" && e.starts_at; });
        var seasonOf = {}; seasons.forEach(function (x) { seasonOf[x.id] = x; });
        var champOf = {}; champs.forEach(function (c) { champOf[c.id] = c; });
        var up = evs.filter(function (e) { return new Date(e.starts_at).getTime() >= now; }).sort(function (a, b) { return a.starts_at < b.starts_at ? -1 : 1; });
        var past = evs.filter(function (e) { return new Date(e.starts_at).getTime() < now; }).sort(function (a, b) { return a.starts_at < b.starts_at ? 1 : -1; }).slice(0, 12);
        var next = up[0] || null;
        var rP = past.length ? sb.from("races").select("id,event_id,name,sort_order").in("event_id", past.map(function (e) { return e.id; })) : Promise.resolve({ data: [] });
        rP.then(function (rr) {
          var races = (rr.data || []).sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
          var xP = races.length ? sb.from("results").select("race_id").in("race_id", races.map(function (r) { return r.id; })) : Promise.resolve({ data: [] });
          xP.then(function (xr) {
            var scored = {}; (xr.data || []).forEach(function (x) { scored[x.race_id] = true; });
            // The oldest recent round that still has a race without results is the next one to enter.
            var todo = null;
            past.slice().reverse().some(function (e) { var r = races.filter(function (q) { return q.event_id === e.id && !scored[q.id]; })[0]; if (r) { todo = { ev: e, race: r }; return true; } return false; });
            var ids = []; [next, todo && todo.ev].forEach(function (e) { if (e && e.track_layout_id && ids.indexOf(e.track_layout_id) < 0) ids.push(e.track_layout_id); });
            var tP = ids.length ? sb.from("track_layouts").select("id,name,track_venues(name)").in("id", ids) : Promise.resolve({ data: [] });
            tP.then(function (tr) {
              var tn = {}; (tr.data || []).forEach(function (t) { tn[t.id] = (t.track_venues && t.track_venues.name ? t.track_venues.name + " · " : "") + t.name; });
              drawHome({ champs: champs, seasons: seasons, seasonOf: seasonOf, champOf: champOf, next: next, todo: todo, tn: tn });
            });
          });
        });
      });
    });
  });
}
function drawHome(d) {
  var lg = state.league, box = $("#hm"); if (!box) return;
  function label(e) { var s = d.seasonOf[e.season_id], c = s && d.champOf[s.championship_id]; return [e.round_number ? "Round " + e.round_number : (e.name || "Round"), d.tn[e.track_layout_id]].filter(Boolean).join(" · ") + (c ? " — " + c.name + (s ? " · " + s.name : "") : ""); }
  var h = '<div class="row" style="margin:0 0 4px;align-items:stretch">';
  h += d.todo ? '<button class="primary" type="button" id="hres">Enter results: ' + esc(label(d.todo.ev).split(" — ")[0]) + "</button>" : '<button class="primary" type="button" id="hres">Enter results</button>';
  h += '<button type="button" id="hround"' + (d.champs.length ? "" : " disabled") + '>Add a round</button><button type="button" id="hchamp">New championship</button><a href="' + esc(pageLink("l", lg.id)) + '" target="_blank" rel="noopener"><button type="button">View league page</button></a></div>';
  if (!d.todo && d.champs.length) h += '<p class="muted" style="margin:6px 0 0">Every recent round has its results.</p>';
  h += '<h3 style="margin:16px 0 6px">Next race</h3>';
  if (d.next) {
    var s = d.seasonOf[d.next.season_id];
    h += '<div class="card" style="margin:0"><div style="font-size:18px;font-weight:700">' + esc(whenText(d.next.starts_at)) + '</div><div>' + esc(label(d.next)) + "</div>" +
      (d.next.lobby_opens_at ? '<div class="muted">Lobby opens ' + esc(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(d.next.lobby_opens_at))) + "</div>" : "") +
      '<div class="row" style="margin-top:8px"><button type="button" id="hopen">Open this round</button></div></div>';
  } else h += '<p class="muted" style="margin:0">' + (d.champs.length ? "No upcoming rounds are scheduled." : "No championships yet.") + "</p>";
  box.className = ""; box.innerHTML = h;
  var newest = d.champs[0] && d.champs[0].id;
  $("#hres").addEventListener("click", function () {
    if (d.todo) { var sn = d.seasonOf[d.todo.ev.season_id]; if (sn) { openChamp(sn.championship_id, { view: "race", rid: d.todo.race.id }); return; } }
    goResults();
  });
  $("#hround").addEventListener("click", function () { if (newest) { state.wantTab = "seasons"; openChamp(newest); } });
  $("#hchamp").addEventListener("click", function () { state.focusNew = true; loadChamps(); });
  var ho = $("#hopen"); if (ho) ho.addEventListener("click", function () { var sn = d.seasonOf[d.next.season_id]; if (sn) openChamp(sn.championship_id, { view: "season", sid: sn.id }); });
}
