/* Shared setup: config, small helpers, the app state and the copy-link helper. */
/* These files share one global scope; they load in the order listed in admin/index.html. */
"use strict";

var TZ = window.FCM_TZ, SCH = window.FCM_SCHEDULE, cfg = window.FCM_CONFIG;
var app = document.getElementById("app");
var PALETTES = [["", "Amber (default)"], ["rwb", "Red, white and blue"], ["rosso", "Rosso red"], ["gulf", "Gulf blue and orange"], ["brg", "British racing green"], ["papaya", "Papaya orange"], ["mono", "Silver and black"]];
function applyPalette(k) { if (k) document.documentElement.setAttribute("data-palette", k); else document.documentElement.removeAttribute("data-palette"); try { localStorage.setItem("fcm.palette", k || ""); } catch (e) {} }
try { applyPalette(localStorage.getItem("fcm.palette") || ""); } catch (e) {}
// Footer: where you are, kept current without touching every screen.
setInterval(function () {
  var el = document.getElementById("ftloc"); if (!el) return;
  var lg = state.league && state.league.name, ch = state.sel && state.sel.champ && state.sel.champ.name;
  if (ch && !document.querySelector("#app [data-tab]")) ch = null;
  var t = lg ? (ch ? lg + " · " + ch : lg) : "";
  if (el.dataset.t !== t) { el.dataset.t = t; el.innerHTML = t ? "<b>" + esc(lg) + "</b>" + (ch ? " · " + esc(ch) : "") : ""; }
}, 400);
// Cancel buttons next to every Save: "reset" redraws the screen from saved data, "back" returns to the previous page.
app.addEventListener("click", function (ev) {
  var b = ev.target.closest && ev.target.closest("[data-cancel]");
  if (!b) return;
  var k = b.dataset.cancel;
  if (k === "reset" && document.getElementById("lsave")) applyPalette((state.league || {}).palette || "");
  if (k === "drivers") { renderDriversBody(); return; }
  if (k === "back") { var lb = document.getElementById("lpback"); if (lb) { renderLeaguePoints(); return; } state.nav = { view: "champ" }; renderCurrent(); return; }
  if (document.getElementById("lsave")) { renderLeague(); return; }
  renderCurrent();
});
var sb = window.supabase.createClient(cfg.url, cfg.key);
var zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).slice();
if (zones.indexOf("UTC") < 0) zones.unshift("UTC");
var viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
var plans = {};
 // preview of generated rounds per season, waiting for the admin to confirm
var armed = null;
 // key of the delete button that has been clicked once

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function $(sel, root) { return (root || document).querySelector(sel); }
function opts(list, cur, blank) {
  return '<option value="">' + esc(blank) + "</option>" + list.map(function (o) {
    var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
    return '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(l) + "</option>";
  }).join("");
}
// Time zone dropdown: popular zones first, then every other zone. Values stay as IANA names
// (needed for daylight saving); the label shows today's offset from GMT.
var COMMON = [
  ["Australia/Sydney", "Sydney, Australia"], ["Australia/Melbourne", "Melbourne, Australia"], ["Australia/Brisbane", "Brisbane, Australia"],
  ["Australia/Adelaide", "Adelaide, Australia"], ["Australia/Perth", "Perth, Australia"], ["Pacific/Auckland", "Auckland, New Zealand"],
  ["America/New_York", "US Eastern (New York)"], ["America/Chicago", "US Central (Chicago)"], ["America/Denver", "US Mountain (Denver)"],
  ["America/Los_Angeles", "US Pacific (Los Angeles)"], ["America/Toronto", "Toronto, Canada"], ["Europe/London", "London, UK"],
  ["Europe/Berlin", "Central Europe (Berlin)"], ["Asia/Tokyo", "Tokyo, Japan"], ["Asia/Singapore", "Singapore"], ["UTC", "UTC"]
];
function gmt(tz) {
  var m = Math.round(TZ.offsetMs(Date.now(), tz) / 60000), a = Math.abs(m), h = Math.floor(a / 60), mm = a % 60;
  return "GMT" + (m < 0 ? "-" : "+") + h + (mm ? ":" + (mm < 10 ? "0" : "") + mm : "");
}
function zoneOpts(cur, blank) {
  function one(v, label) { return '<option value="' + esc(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(label + " · " + gmt(v)) + "</option>"; }
  var common = COMMON.filter(function (c) { return zones.indexOf(c[0]) >= 0; });
  var names = common.map(function (c) { return c[0]; });
  return '<option value="">' + esc(blank) + "</option>" +
    '<optgroup label="Common">' + common.map(function (c) { return one(c[0], c[1]); }).join("") + "</optgroup>" +
    '<optgroup label="All other time zones">' + zones.filter(function (z) { return names.indexOf(z) < 0; }).map(function (z) { return one(z, z.replace(/_/g, " ")); }).join("") + "</optgroup>";
}
function browserZone() {
  try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z && zones.indexOf(z) >= 0 ? z : null; } catch (e) { return null; }
}
function msg(el, text, kind) { if (el) { el.className = "msg " + (kind || ""); el.textContent = text || ""; } }
function nul(v) { v = (v || "").trim(); return v === "" ? null : v; }
function numOrNull(v) { v = (v || "").trim(); return v === "" || !isFinite(Number(v)) ? null : Number(v); }
function dbError(e) { return e && e.message ? e.message : "Something went wrong."; }
var state = { user: null, admin: false, champs: [], sel: null };
// A link from the public calendar: ?l=<league>&c=<championship>&s=<season> opens that season's setup after sign-in.
(function () { try { var q = new URLSearchParams(location.search); if (q.get("v") || (q.get("l") && q.get("c"))) state.deep = { l: q.get("l"), c: q.get("c"), s: q.get("s"), v: q.get("v") }; } catch (e) {} })();
function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function copyBtnHtml(url) { return '<button type="button" data-copy="' + esc(url) + '">Copy link</button><a href="' + esc(url) + '" target="_blank" rel="noopener"><button type="button">Open</button></a>'; }
// Copies text. Calls back true when it worked, false when the person must press Ctrl+C themselves.
function copyText(text, cb) {
  function fallback() { var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} t.remove(); cb(ok); }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { cb(true); }, fallback); else fallback();
}
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-copy]"); if (!b) return;
  copyText(b.dataset.copy, function (ok) { b.textContent = ok ? "Copied" : "Press Ctrl+C"; if (ok) setTimeout(function () { b.textContent = "Copy link"; }, 1800); });
});
