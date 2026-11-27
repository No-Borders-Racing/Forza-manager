/* Small shared pieces for the page flair: initials avatars and the next-race tile with a live countdown. */
var FCMFlair = (function () {
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // "TiteCrevette994" -> TC, "Shy Guy Shot" -> SG, "xxxbennyboyxxx" -> XX
  function initials(n) {
    var s = String(n || "").trim(), w = s.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
    if (w.length > 1) return (w[0][0] + w[1][0]).toUpperCase();
    var hump = (w[0] || "").match(/[A-Z][a-z]+|[A-Z]+(?![a-z])/g);
    if (hump && hump.length > 1) return (hump[0][0] + hump[1][0]).toUpperCase();
    return (w[0] || "?").slice(0, 2).toUpperCase();
  }
  function av(n) { return '<span class="av" aria-hidden="true">' + esc(initials(n)) + "</span>"; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function cdHtml(iso) {
    return '<div class="cd" data-cd="' + esc(iso) + '" aria-live="off"></div>';
  }
  var P = {
    overview: "M3 11 12 3l9 8v10h-6v-6H9v6H3V11Z",
    championships: "M7 3h10v3h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 13H8a4 4 0 0 1-4-4V6h3V3Zm-1 5v1a2 2 0 0 0 1 1.7V8H6Zm12 0h-1v2.7A2 2 0 0 0 18 9V8Z",
    calendar: "M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm-1 8v10h12V10H6Zm2 2h3v3H8v-3Z",
    results: "M5 3h2v18H5V3Zm3 1h3v3H8V4Zm3 0h3v3h-3V4Zm3 0h3v3h-3V4ZM8 7h3v3H8V7Zm3 0h3v3h-3V7Zm3 0h3v3h-3V7Zm-6 3h3v3H8v-3Zm3 0h3v3h-3v-3Zm3 0h3v3h-3v-3Z",
    standings: "M9 8h6v13H9V8ZM2 13h6v8H2v-8Zm14 3h6v5h-6v-5ZM12 2l1.8 3.6 4 .6-2.9 2.8.7 4L12 11l-3.6 2 .7-4L6.2 6.2l4-.6L12 2Z",
    stats: "M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z",
    builds: "M20.7 5.3a5 5 0 0 1-6.6 6.2L7 18.6 5.4 17l7.1-7.1A5 5 0 0 1 18.7 3.3L15.5 6.5l2 2 3.2-3.2ZM4 19.5 5.5 21 3 21l1-1.5Z",
    rules: "M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Zm0 4v2h5v-2H8Z",
    flag: "M5 3h2v18H5V3Zm3 1h11l-2 4 2 4H8V4Z",
    clock: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1 5v6l5 3 1-1.7-4-2.3V7h-2Z",
    car: "M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11h1a1 1 0 0 1 1 1v5h-2.2a2.3 2.3 0 0 1-4.6 0H9a2.3 2.3 0 0 1-4.6 0H3v-5a1 1 0 0 1 1-1h1Zm2.5 0h9L15.3 7.5H8.7L7.5 11Z",
    cog: "M10.5 2h3l.5 2.6 1.8.8 2.2-1.5 2.1 2.1-1.5 2.2.8 1.8 2.6.5v3l-2.6.5-.8 1.8 1.5 2.2-2.1 2.1-2.2-1.5-1.8.8-.5 2.6h-3l-.5-2.6-1.8-.8-2.2 1.5-2.1-2.1 1.5-2.2-.8-1.8L2 13.5v-3l2.6-.5.8-1.8-1.5-2.2 2.1-2.1 2.2 1.5 1.8-.8L10.5 2ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    shield: "M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3Z",
    plus: "M10.5 4h3v6.5H20v3h-6.5V20h-3v-6.5H4v-3h6.5V4Z",
    eye: "M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    pin: "M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
  };
  function ico(n, sz) { return P[n] ? '<svg class="ico" viewBox="0 0 24 24" width="' + (sz || 16) + '" height="' + (sz || 16) + '" aria-hidden="true"><path fill="currentColor" d="' + P[n] + '"/></svg>' : ""; }
  // rows: [{rank, driver, points}] best first. Three or more become a podium (second, first, third).
  function podium(rows) {
    function pt(r) { return esc(+Number(r.points).toFixed(2)); }
    if (rows.length < 3) return '<ol class="rk">' + rows.map(function (r) { return "<li><span><b>" + r.rank + "</b>" + esc(r.driver) + "</span><em>" + pt(r) + "</em></li>"; }).join("") + "</ol>";
    return '<div class="podium">' + [1, 0, 2].map(function (i) {
      var r = rows[i];
      return '<div class="pcol p' + (i + 1) + '">' + av(r.driver) + '<div class="pn">' + esc(r.driver) + '</div><div class="pp">' + pt(r) + '</div><div class="blk"><b>' + r.rank + "</b></div></div>";
    }).join("") + "</div>";
  }
  // o: { iso, kicker, title, sub, today }
  function nextTile(o) {
    var d = new Date(o.iso), day = "", mon = "";
    try { day = d.getDate(); mon = d.toLocaleDateString(undefined, { month: "short" }); } catch (e) {}
    return '<div class="nextrace"><div class="dateblk" aria-hidden="true"><b>' + esc(day) + "</b><span>" + esc(mon) + '</span></div><div class="nrmain"><div class="rnd">' + esc(o.kicker) + '</div><div class="nrtitle">' + esc(o.title) + "</div>" +
      (o.sub ? '<div class="nrsub">' + esc(o.sub) + "</div>" : "") + "</div>" + cdHtml(o.iso) + "</div>";
  }
  function tick() {
    var now = Date.now();
    document.querySelectorAll("[data-cd]").forEach(function (el) {
      var t = new Date(el.getAttribute("data-cd")).getTime(), ms = t - now;
      if (isNaN(t)) { el.textContent = ""; return; }
      if (ms <= 0) { el.innerHTML = ms > -12 * 3600e3 ? '<span class="live">Racing now</span>' : ""; return; }
      var m = Math.floor(ms / 60000), dd = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
      el.innerHTML = '<span><b>' + pad(dd) + "</b>days</span><span><b>" + pad(hh) + "</b>hrs</span><span><b>" + pad(mm) + "</b>min</span>";
    });
  }
  setInterval(tick, 20000);
  return { podium: podium, ico: ico, esc: esc, initials: initials, av: av, nextTile: nextTile, tick: tick };
})();
