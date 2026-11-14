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
// Renames a driver; the old name is kept as another name. Resolves { error } or { old }.
function renameDriver(d, name) {
  var old = d.display_name, al = (d.aliases || []).filter(function (a) { return a.toLowerCase() !== name.toLowerCase() && a.toLowerCase() !== old.toLowerCase(); }).concat([old]);
  return sb.from("drivers").update({ display_name: name, aliases: al }).eq("id", d.id).then(function (r) {
    if (r.error) return { error: r.error };
    d.display_name = name; d.aliases = al; return { old: old };
  });
}
function driverName(id) { var d = state.drivers.filter(function (x) { return x.id === id; })[0]; return d ? d.display_name : "?"; }
// Two driver records that look like one person: names within two typos of each other once spaces and symbols are ignored,
// or one driver's other name is the other's name.
function dupKey(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function editDistance(a, b) {
  var prev = [], i, j; for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) { var cur = [i]; for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
function likelyDuplicates() {
  var ds = state.drivers, out = [];
  for (var i = 0; i < ds.length; i++) for (var j = i + 1; j < ds.length; j++) {
    var a = ds[i], b = ds[j], ka = dupKey(a.display_name), kb = dupKey(b.display_name);
    var same = (a.aliases || []).some(function (x) { return dupKey(x) === kb; }) || (b.aliases || []).some(function (x) { return dupKey(x) === ka; });
    if (same || (Math.min(ka.length, kb.length) >= 5 && editDistance(ka, kb) <= 2)) out.push([a, b]);
  }
  return out;
}
// Moves every result of the duplicate onto the driver kept, keeps the duplicate's name as another name and deletes the duplicate.
function mergeDrivers(keep, drop) {
  if (!window.confirm('Merge "' + drop.display_name + '" into "' + keep.display_name + '"?\n\nAll of ' + drop.display_name + '\'s results move to ' + keep.display_name + ', "' + drop.display_name + '" is kept as another name, and the duplicate driver is deleted. This cannot be undone.')) return;
  msg($("#dm"), "Merging…");
  sb.rpc("merge_drivers", { keep_id: keep.id, drop_id: drop.id }).then(function (r) {
    if (r.error) { msg($("#dm"), dbError(r.error) + (/function|schema cache|does not exist/i.test(r.error.message || "") ? " Has migration 039 been run?" : ""), "err"); return; }
    renderDrivers();
    setTimeout(function () { var n = r.data && r.data.moved != null ? r.data.moved : 0; msg($("#dm"), '"' + drop.display_name + '" is merged into "' + keep.display_name + '" (' + n + " result" + (n === 1 ? "" : "s") + " moved).", "ok"); }, 600);
  });
}
function renderDrivers() { loadDrivers(renderDriversBody); }
function dupCard() {
  var d = likelyDuplicates(); if (!d.length) return "";
  return '<div class="card" style="margin:0 0 12px;border-color:var(--accent)"><h3 style="margin-top:0">Possible duplicates</h3><p class="muted" style="margin:0 0 8px">These look like the same person. Merge them so their results count together.</p>' + d.map(function (p) {
    return '<div class="row" style="align-items:center;margin:6px 0"><span class="grow"><b>' + esc(p[0].display_name) + '</b> and <b>' + esc(p[1].display_name) + '</b></span>' +
      '<button type="button" data-mk="' + esc(p[0].id) + '" data-md="' + esc(p[1].id) + '">Keep ' + esc(p[0].display_name) + '</button><button type="button" data-mk="' + esc(p[1].id) + '" data-md="' + esc(p[0].id) + '">Keep ' + esc(p[1].display_name) + '</button></div>';
  }).join("") + "</div>";
}
function renderDriversBody() {
  app.innerHTML = navHtml("l", "d") + '<div class="card"><h2>Drivers</h2><p class="muted" style="margin:0 0 8px">The league\'s drivers. Use the name exactly as the game shows it. Other names are spellings the screenshot scan or you might use for the same person; results entry matches on either.</p>' +
    dupCard() +
    (state.drivers.length ? state.drivers.map(function (d) {
      return '<div class="row" data-did="' + esc(d.id) + '" style="align-items:flex-end;margin:6px 0"><div class="field grow"><label>Name in the game</label><input data-dn value="' + esc(d.display_name) + '"></div>' +
        '<div class="field grow"><label>Other names (comma separated)</label><input data-da value="' + esc((d.aliases || []).join(", ")) + '"></div>' +
        '<button type="button" data-dsave>Save</button><button type="button" data-cancel="drivers">Cancel</button><select data-merge aria-label="Merge this driver into another" title="Same person as another driver? Merge them" style="max-width:150px"><option value="">Merge into…</option>' + state.drivers.filter(function (x) { return x.id !== d.id; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.display_name) + "</option>"; }).join("") + '</select><button type="button" class="danger" data-ddel>Delete</button></div>';
    }).join("") : '<p class="muted">No drivers yet. They are also added automatically when you type a new name in results entry.</p>') + '<div class="msg" id="dm"></div></div>' +
    '<div class="card"><h3 style="margin-top:0">Add a driver</h3><div class="row"><div class="field grow"><label for="dnew">Name in the game</label><input id="dnew"></div><button class="primary" id="dadd" type="button">Add</button></div><div class="msg" id="dam"></div></div>';
  bindNav();
  function aliasList(v) { return v.split(",").map(function (x) { return x.trim(); }).filter(function (x) { return x; }); }
  app.querySelectorAll("[data-dsave]").forEach(function (b) { b.addEventListener("click", function () {
    var row = b.closest("[data-did]"), name = row.querySelector("[data-dn]").value.trim();
    if (!name) { msg($("#dm"), "A driver needs a name.", "err"); return; }
    var d = state.drivers.filter(function (x) { return x.id === row.dataset.did; })[0], al = aliasList(row.querySelector("[data-da]").value);
    var renamed = d && d.display_name !== name;
    if (renamed) { al = al.filter(function (a) { return a.toLowerCase() !== name.toLowerCase(); }); if (!al.some(function (a) { return a.toLowerCase() === d.display_name.toLowerCase(); })) al.push(d.display_name); }
    sb.from("drivers").update({ display_name: name, aliases: al }).eq("id", row.dataset.did).then(function (r) {
      if (r.error) { msg($("#dm"), dbError(r.error), "err"); return; }
      if (d) { d.display_name = name; d.aliases = al; } row.querySelector("[data-da]").value = al.join(", ");
      msg($("#dm"), renamed ? "Saved. The old name is kept as another name, so earlier results stay with them." : "Saved.", "ok");
    });
  }); });
  function drv(id) { return state.drivers.filter(function (x) { return x.id === id; })[0]; }
  app.querySelectorAll("[data-mk]").forEach(function (b) { b.addEventListener("click", function () { var k = drv(b.dataset.mk), x = drv(b.dataset.md); if (k && x) mergeDrivers(k, x); }); });
  app.querySelectorAll("[data-merge]").forEach(function (sel) { sel.addEventListener("change", function () {
    var x = drv(sel.closest("[data-did]").dataset.did), k = drv(sel.value); sel.value = ""; if (k && x) mergeDrivers(k, x);
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
