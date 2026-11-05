/* Drivers. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

function loadDrivers(done) {
  sb.from("drivers").select("id,display_name,aliases").eq("league_id", state.league.id).order("display_name", { ascending: true }).then(function (r) {
    if (r.error) { app.innerHTML = '<div class="card err">' + esc(dbError(r.error)) + " Has migration 010 been run?</div>"; return; }
    state.drivers = r.data || []; done();
  });
}
function driverByName(name) {
  var n = (name || "").trim().toLowerCase(); if (!n) return null;
  return state.drivers.filter(function (d) { return d.display_name.toLowerCase() === n || (d.aliases || []).some(function (a) { return a.toLowerCase() === n; }); })[0] || null;
}
function driverName(id) { var d = state.drivers.filter(function (x) { return x.id === id; })[0]; return d ? d.display_name : "?"; }
function renderDrivers() { loadDrivers(renderDriversBody); }
function renderDriversBody() {
  app.innerHTML = navHtml("l", "d") + '<div class="card"><h2>Drivers</h2><p class="muted" style="margin:0 0 8px">The league\'s drivers. Use the name exactly as the game shows it. Other names are spellings the screenshot scan or you might use for the same person; results entry matches on either.</p>' +
    (state.drivers.length ? state.drivers.map(function (d) {
      return '<div class="row" data-did="' + esc(d.id) + '" style="align-items:flex-end;margin:6px 0"><div class="field grow"><label>Name in the game</label><input data-dn value="' + esc(d.display_name) + '"></div>' +
        '<div class="field grow"><label>Other names (comma separated)</label><input data-da value="' + esc((d.aliases || []).join(", ")) + '"></div>' +
        '<button type="button" data-dsave>Save</button><button type="button" data-cancel="drivers">Cancel</button><button type="button" class="danger" data-ddel>Delete</button></div>';
    }).join("") : '<p class="muted">No drivers yet. They are also added automatically when you type a new name in results entry.</p>') + '<div class="msg" id="dm"></div></div>' +
    '<div class="card"><h3 style="margin-top:0">Add a driver</h3><div class="row"><div class="field grow"><label for="dnew">Name in the game</label><input id="dnew"></div><button class="primary" id="dadd" type="button">Add</button></div><div class="msg" id="dam"></div></div>';
  bindNav();
  function aliasList(v) { return v.split(",").map(function (x) { return x.trim(); }).filter(function (x) { return x; }); }
  app.querySelectorAll("[data-dsave]").forEach(function (b) { b.addEventListener("click", function () {
    var row = b.closest("[data-did]"), name = row.querySelector("[data-dn]").value.trim();
    if (!name) { msg($("#dm"), "A driver needs a name.", "err"); return; }
    sb.from("drivers").update({ display_name: name, aliases: aliasList(row.querySelector("[data-da]").value) }).eq("id", row.dataset.did).then(function (r) { msg($("#dm"), r.error ? dbError(r.error) : "Saved.", r.error ? "err" : "ok"); });
  }); });
  app.querySelectorAll("[data-ddel]").forEach(function (b) { b.addEventListener("click", function () {
    var row = b.closest("[data-did]"), key = "dd" + row.dataset.did;
    if (armed !== key) { armed = key; b.textContent = "Click again to delete"; return; }
    armed = null;
    var did = row.dataset.did;
    if (b.dataset.force) {
      sb.from("results").delete().eq("driver_id", did).then(function (r0) {
        if (r0.error) { msg($("#dm"), dbError(r0.error), "err"); return; }
        sb.from("drivers").delete().eq("id", did).then(function (r) {
          if (r.error) { msg($("#dm"), dbError(r.error), "err"); return; }
          renderDrivers();
        });
      });
      return;
    }
    sb.from("drivers").delete().eq("id", did).then(function (r) {
      if (!r.error) { renderDrivers(); return; }
      if (!/foreign key|violates/i.test(r.error.message || "")) { msg($("#dm"), dbError(r.error), "err"); b.textContent = "Delete"; return; }
      sb.from("results").select("id", { count: "exact", head: true }).eq("driver_id", did).then(function (c) {
        var n = c.count == null ? "their" : c.count;
        b.dataset.force = "1"; armed = key;
        b.textContent = "Delete driver and " + n + (n === 1 ? " result" : " results") + "? Click again";
        msg($("#dm"), "This driver has results. Deleting them removes those results from every race and changes the standings. This cannot be undone.", "err");
      });
    });
  }); });
  $("#dadd").addEventListener("click", function () {
    var n = $("#dnew").value.trim(); if (!n) { msg($("#dam"), "Type a name first.", "err"); return; }
    sb.from("drivers").insert({ league_id: state.league.id, display_name: n, aliases: [] }).then(function (r) {
      if (r.error) { msg($("#dam"), /duplicate|unique/i.test(r.error.message || "") ? "There is already a driver with that name." : dbError(r.error), "err"); return; }
      renderDrivers();
    });
  });
}
