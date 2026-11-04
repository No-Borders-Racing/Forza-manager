/* The app's top bar, nav bar and footer on public pages. Signed-in admins see their email, Sign out and the same nav bar
   as the app (each button opens that part of the app); everyone else sees none of it. */
(function () {
  "use strict";
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var st = { base: "", league: "", signedIn: false };
  var NAV = [["home", "Home"], ["champs", "Championships"], ["cars", "Cars"], ["tracks", "Tracks"], ["results", "Results"], ["league", "League settings"]];
  function css() {
    if (document.getElementById("fcmnav-css")) return;
    var s = document.createElement("style"); s.id = "fcmnav-css";
    s.textContent = ".fcmnav{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px}.fcmnav a{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:7px 12px;color:var(--ink);text-decoration:none;font-family:var(--display);text-transform:uppercase;letter-spacing:.07em;font-weight:600;font-size:14px;white-space:nowrap}.fcmnav a:hover{border-color:var(--accent)}.fcmnav a.last{margin-left:auto}";
    document.head.appendChild(s);
  }
  function renderNav() {
    if (!st.signedIn) return;
    css();
    var host = document.querySelector("main") || document.querySelector(".wrap"); if (!host) return;
    var el = document.getElementById("fcmnav");
    if (!el) { el = document.createElement("nav"); el.id = "fcmnav"; el.className = "fcmnav"; host.insertBefore(el, host.firstChild); }
    el.innerHTML = NAV.map(function (n, i) {
      return '<a href="' + esc(st.base + "?v=" + n[0] + (st.league ? "&l=" + encodeURIComponent(st.league) : "")) + '"' + (i === NAV.length - 1 ? ' class="last"' : "") + ">" + n[1] + "</a>";
    }).join("");
  }
  var chrome = {
    // Call once the page's league palette is applied, so nothing flashes in the wrong colours.
    ready: function () { document.documentElement.classList.remove("wait"); },
    footer: function (text) { var f = document.getElementById("ftloc"); if (f) f.textContent = text || ""; },
    // The league this page belongs to, so the nav buttons open that league in the app.
    setLeague: function (id) { st.league = id || ""; renderNav(); },
    who: function (sb, appHref) {
      var box = document.getElementById("who"); if (!box || !sb || !sb.auth) return;
      st.base = appHref;
      sb.auth.getSession().then(function (r) {
        var s = r.data && r.data.session; if (!s || !s.user) return;
        st.signedIn = true;
        box.innerHTML = '<span class="wem" title="' + esc(s.user.email) + '">' + esc(s.user.email) + '</span><button id="out" type="button">Sign out</button>';
        document.getElementById("out").addEventListener("click", function () { sb.auth.signOut().then(function () { location.reload(); }); });
        renderNav();
      });
    }
  };
  setTimeout(chrome.ready, 3000); // never leave the page hidden if the league cannot be loaded
  window.FCMChrome = chrome;
})();
