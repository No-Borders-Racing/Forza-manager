/* A season's card. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

function seasonHtml(s) {
  var evs = state.sel.events.filter(function (e) { return e.season_id === s.id; });
  var h = '<div class="card"><h2>Season: ' + esc(s.name) + "</h2>" +
    '<div class="row"><div class="field grow"><label for="sn-' + s.id + '">Name</label><input id="sn-' + s.id + '" value="' + esc(s.name) + '"></div>' +
    '<div class="field"><label for="ss-' + s.id + '">Starts</label><input id="ss-' + s.id + '" type="date" value="' + esc(s.starts_on || "") + '"></div>' +
    '<button data-sv="' + s.id + '" type="button">Save season</button><button class="danger" data-sd="' + s.id + '" type="button">Delete season</button></div><div class="msg" id="sm-' + s.id + '"></div>' +
    calendarPublishHtml(s) +
    "<h3>Rounds (" + evs.length + ")</h3>";
  evs.forEach(function (e, i) {
    h += '<div style="display:flex;gap:4px;align-items:flex-start"><div style="display:flex;gap:2px;margin-top:8px;flex:0 0 auto"><button type="button" data-rup="' + esc(e.id) + '" title="Swap with the round above"' + (i === 0 ? " disabled" : "") + '>↑</button><button type="button" data-rdn="' + esc(e.id) + '" title="Swap with the round below"' + (i === evs.length - 1 ? " disabled" : "") + '>↓</button></div><div style="flex:1;min-width:0">' + eventHtml(e) + "</div></div>";
  });
  h += genHtml(s.id);
  if (evs.length) {
    var ro = evs.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(roundLabel(e)) + "</option>"; }).join("");
    h += '<div class="card" style="margin:8px 0;border-top-width:1px"><h3 style="margin-top:0">Skip a week</h3>' +
      '<p class="muted" style="margin:0 0 8px">For a holiday or a break. Every round after the one you pick moves later by that many weeks, at the same local time. To change the order of rounds, use the arrows beside them.</p>' +
      '<div class="row" style="align-items:flex-end"><div class="field"><label for="bye-' + s.id + '">Skip after</label><select id="bye-' + s.id + '">' + ro + '</select></div>' +
      '<div class="field"><label for="byn-' + s.id + '">Weeks to skip</label><input id="byn-' + s.id + '" type="number" min="1" max="26" value="1" style="width:70px"></div>' +
      '<button type="button" data-bye="' + s.id + '">Skip weeks</button></div>' +
      '<div class="msg" id="rm2-' + s.id + '"></div></div>';
  }
  h += '<details class="ev" style="margin-top:12px"><summary><span class="muted">Add a single round outside the schedule</span></summary><div style="margin-top:10px">' + eventFields("new-" + s.id, {}) +
    '<h3>Races in this round</h3><div id="rc-new-' + s.id + '">' + raceRow({}, "new-" + s.id) + '</div><div style="margin-top:8px"><button type="button" data-radd="new-' + s.id + '">Add a race</button></div>' +
    '<div class="row" style="margin-top:8px"><button class="primary" data-ea="' + s.id + '" type="button">Add round</button></div><div class="msg" id="em-new-' + s.id + '"></div></div></details></div>';
  return h;
}
/* ---------- points systems ---------- */
function updAvail(x) {
  var src = state.sel.leaguePts.filter(function (l) { return l.id === x.copied_from; })[0];
  return !!(src && x.copied_at && src.updated_at && src.updated_at > x.copied_at);
}
