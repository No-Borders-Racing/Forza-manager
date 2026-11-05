/* Phone menu: below 600px the nav, sub-nav, page tabs and admin shortcuts collapse into one hamburger menu in the top bar.
   Nothing is moved or rebuilt: the rows stay in the page (hidden by CSS on phones) and each menu item presses the matching button. */
(function () {
  "use strict";
  var mq = window.matchMedia ? window.matchMedia("(max-width:600px)") : null;
  var header = document.querySelector("header.top"); if (!header) return;
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var btn = document.createElement("button");
  btn.type = "button"; btn.id = "hbtn"; btn.className = "hbtn"; btn.setAttribute("aria-label", "Menu"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "hbp");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  header.appendChild(btn);
  var panel = document.createElement("div"); panel.id = "hbp"; panel.className = "hbp"; panel.hidden = true; header.appendChild(panel);
  document.documentElement.classList.add("hb");
  var items = [];
  function label(row) {
    if (row.id === "fcmnav" || row.querySelector('[id^="nav-"]')) return "Menu";
    if (row.querySelector('[id^="sub-"]')) return "League settings";
    if (row.classList.contains("actrow")) return "Quick actions";
    return "On this page";
  }
  function build() {
    var h = "", n = 0; items = [];
    document.querySelectorAll(".scrollrow").forEach(function (row) {
      var els = Array.prototype.filter.call(row.children, function (c) { return c.tagName === "BUTTON" || c.tagName === "A"; });
      if (!els.length) return;
      h += '<div class="hbg">' + esc(label(row)) + "</div>";
      els.forEach(function (e) { items.push(e); h += '<button type="button" class="hbi' + (e.classList.contains("primary") ? " on" : "") + '" data-i="' + (n++) + '">' + esc(e.textContent.trim()) + "</button>"; });
    });
    var out = document.querySelector("#who button"), em = document.querySelector("#who .wem");
    if (out) { items.push(out); h += '<div class="hbg">' + esc(em ? em.textContent : "Account") + '</div><button type="button" class="hbi" data-i="' + (n++) + '">Sign out</button>'; }
    panel.innerHTML = h || '<div class="hbg">Nothing to show</div>';
  }
  function setOpen(on) { panel.hidden = !on; btn.setAttribute("aria-expanded", on ? "true" : "false"); if (on) build(); }
  btn.addEventListener("click", function (e) { e.stopPropagation(); setOpen(panel.hidden); });
  panel.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".hbi"); if (!b) return;
    var target = items[+b.dataset.i]; setOpen(false); if (target) target.click();
  });
  document.addEventListener("click", function (e) { if (!panel.hidden && !header.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); } });
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { setOpen(false); });
})();
