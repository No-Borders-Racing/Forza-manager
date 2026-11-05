/* Top bar menu. On wide screens the everyday links sit in the bar and the hamburger holds the rest plus Sign out; on phones (under 600px)
   the hamburger holds everything, including the page tabs and shortcuts.
   Nothing is moved or rebuilt: the app's own rows stay in the page (hidden by CSS) and each bar link or menu item presses the matching button. */
(function () {
  "use strict";
  var mq = window.matchMedia ? window.matchMedia("(max-width:600px)") : null;
  var header = document.querySelector("header.top"); if (!header) return;
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var bar = document.createElement("nav"); bar.className = "hnav"; bar.setAttribute("aria-label", "Main"); header.appendChild(bar);
  var btn = document.createElement("button");
  btn.type = "button"; btn.id = "hbtn"; btn.className = "hbtn"; btn.setAttribute("aria-label", "Menu"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "hbp");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  header.appendChild(btn);
  var panel = document.createElement("div"); panel.id = "hbp"; panel.className = "hbp"; panel.hidden = true; header.appendChild(panel);
  document.documentElement.classList.add("hb");
  var BAR = ["Home", "Championships", "Results", "Cars"]; // the everyday links, in this order, on wide screens
  var items = [], barEls = [];
  function label(row) {
    if (row.id === "fcmnav" || row.querySelector('[id^="nav-"]')) return "Menu";
    if (row.querySelector('[id^="sub-"]')) return "League settings";
    if (row.classList.contains("actrow")) return "Quick actions";
    return "On this page";
  }
  // The app's own pages and a public page's sections share some names, so on phones the app pages say what they do.
  var APP = { "Championships": "Manage championships", "Results": "Enter results" };
  function build() {
    var phone = !mq || mq.matches, h = "", bh = "", n = 0, seen = {}, onMore = false, bars = []; items = []; barEls = [];
    document.querySelectorAll(".scrollrow").forEach(function (row) {
      var g = label(row); if (!phone && g !== "Menu") return;
      var els = Array.prototype.filter.call(row.children, function (c) {
        return (c.tagName === "BUTTON" || c.tagName === "A") && !(g === "Quick actions" && c.textContent.trim() === "Enter results" && seen["Enter results"]);
      });
      var mine = [];
      els.forEach(function (e) {
        var t = e.textContent.trim();
        if (g === "Menu" && !phone && BAR.indexOf(t) >= 0) { bars.push([BAR.indexOf(t), e, t]); return; }
        mine.push([e, t]);
      });
      if (!mine.length) return;
      h += '<div class="hbg">' + esc(g === "Menu" ? (phone ? "Manage" : "More") : g) + "</div>";
      mine.forEach(function (m) {
        var t = m[1]; if (g === "Menu" && phone) { t = APP[t] || t; seen[t] = 1; }
        var on = m[0].classList.contains("primary"); if (on) onMore = true;
        items.push(m[0]); h += '<button type="button" class="hbi' + (on ? " on" : "") + '" data-i="' + (n++) + '">' + esc(t) + "</button>";
      });
    });
    bars.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (b, i) {
      barEls.push(b[1]); bh += '<a href="#" data-b="' + i + '"' + (b[1].classList.contains("primary") ? ' class="on" aria-current="page"' : "") + ">" + esc(b[2]) + "</a>";
    });
    var out = document.querySelector("#who button"), em = document.querySelector("#who .wem");
    if (out) { items.push(out); h += '<div class="hbg">' + esc(em ? em.textContent : "Account") + '</div><button type="button" class="hbi" data-i="' + (n++) + '">Sign out</button>'; }
    h = h || '<div class="hbg">Nothing to show</div>';
    // Only touch the page when something changed, so watching the page for changes never feeds on itself.
    if (bar.innerHTML !== bh) bar.innerHTML = bh;
    if (panel.innerHTML !== h) panel.innerHTML = h;
    btn.classList.toggle("on", onMore);
  }
  // The button only shows when there is something in the menu (a visitor on a wide screen has nothing).
  var timer = 0;
  function sync() { timer = 0; if (!panel.hidden) return; build(); btn.hidden = !items.length; }
  function later() { if (!timer) timer = setTimeout(sync, 120); }
  function setOpen(on) { panel.hidden = !on; btn.setAttribute("aria-expanded", on ? "true" : "false"); if (on) build(); else later(); }
  btn.addEventListener("click", function (e) { e.stopPropagation(); setOpen(panel.hidden); });
  bar.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-b]"); if (!a) return;
    e.preventDefault(); var t = barEls[+a.dataset.b]; if (t) t.click();
  });
  panel.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".hbi"); if (!b) return;
    var target = items[+b.dataset.i]; setOpen(false); if (target) target.click();
  });
  document.addEventListener("click", function (e) { if (!panel.hidden && !header.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); } });
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { setOpen(false); sync(); });
  btn.hidden = true; sync();
  if (window.MutationObserver) new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
})();
