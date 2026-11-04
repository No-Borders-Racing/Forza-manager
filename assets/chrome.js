/* The app's top bar and footer on public pages: signed-in admins see their email, a way back to the app and Sign out. */
(function () {
  "use strict";
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var chrome = {
    // Call once the page's league palette is applied, so nothing flashes in the wrong colours.
    ready: function () { document.documentElement.classList.remove("wait"); },
    footer: function (text) { var f = document.getElementById("ftloc"); if (f) f.textContent = text || ""; },
    who: function (sb, appHref) {
      var box = document.getElementById("who"); if (!box || !sb || !sb.auth) return;
      sb.auth.getSession().then(function (r) {
        var s = r.data && r.data.session; if (!s || !s.user) return;
        box.innerHTML = '<span class="wem" title="' + esc(s.user.email) + '">' + esc(s.user.email) + '</span><a class="btn" href="' + esc(appHref) + '">Open app</a><button id="out" type="button">Sign out</button>';
        document.getElementById("out").addEventListener("click", function () { sb.auth.signOut().then(function () { location.reload(); }); });
      });
    }
  };
  setTimeout(chrome.ready, 3000); // never leave the page hidden if the league cannot be loaded
  window.FCMChrome = chrome;
})();
