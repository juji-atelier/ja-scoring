/* JA Scoring System — light/dark mode.
   Load in <head> (plain script, not module) so the page never flashes the wrong colours.
   Any element with the attribute data-theme-toggle becomes a ☀/☾ switch.
   The choice is remembered on this device; first visit follows the phone/PC setting. */
(function () {
  var KEY = "ja-theme", root = document.documentElement;
  var forced = root.getAttribute("data-theme-lock");          // e.g. big screen always dark
  var t = forced;
  if (!t) { try { t = localStorage.getItem(KEY); } catch (e) {} }
  if (t !== "light" && t !== "dark") {
    t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  root.setAttribute("data-theme", t);

  function sync() {
    var cur = root.getAttribute("data-theme");
    var els = document.querySelectorAll(".themetog button");
    for (var i = 0; i < els.length; i++) els[i].classList.toggle("on", els[i].getAttribute("data-t") === cur);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", cur === "dark" ? "#1C1E24" : "#F6F4F2");
  }
  window.jaSetTheme = function (v) {
    root.setAttribute("data-theme", v);
    try { localStorage.setItem(KEY, v); } catch (e) {}
    sync();
  };
  function mount() {
    var slots = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      if (el.classList.contains("themetog")) continue;
      el.classList.add("themetog");
      el.innerHTML = '<button type="button" data-t="light" title="Light mode" aria-label="Light mode">☀</button>' +
                     '<button type="button" data-t="dark" title="Dark mode" aria-label="Dark mode">☾</button>';
      el.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (b) window.jaSetTheme(b.getAttribute("data-t"));
      });
    }
    sync();
  }
  // Keep the screen on (scorer phones, big-screen PC). Re-requests after the
  // phone comes back from another app; silently does nothing on old browsers.
  window.jaKeepAwake = function () {
    if (window.__jaAwake || !("wakeLock" in navigator)) return;
    window.__jaAwake = true;
    var lock = null, busy = false;
    function req() {
      if (lock || busy || document.visibilityState !== "visible") return;
      busy = true;
      navigator.wakeLock.request("screen").then(function (l) {
        lock = l; busy = false;
        l.addEventListener("release", function () { lock = null; });
      }).catch(function () { busy = false; });
    }
    document.addEventListener("visibilitychange", req);
    document.addEventListener("pointerdown", req, true);   // some phones need a tap first
    req();
  };
  if (document.documentElement.hasAttribute("data-keep-awake")) window.jaKeepAwake();

  // Header clock: any element with data-clock shows the time (and the date on wider screens).
  // Works for headers drawn later by JS too, since it looks them up on every tick.
  (function () {
    var css = "[data-clock]{display:flex;flex-direction:column;align-items:flex-end;line-height:1;flex:none;white-space:nowrap}" +
      "[data-clock] .ck-t{font-family:Rajdhani,Inter,sans-serif;font-weight:700;font-size:21px;letter-spacing:.02em;font-variant-numeric:tabular-nums}" +
      "[data-clock] .ck-t small{font-size:.6em;margin-left:2px;opacity:.7;letter-spacing:.04em}" +
      "[data-clock] .ck-d{font-size:11px;opacity:.6;margin-top:3px;font-weight:600}" +
      "@media (max-width:640px){[data-clock] .ck-t{font-size:17px}[data-clock] .ck-d{display:none}}" +
      "@media (max-width:420px){[data-clock] .ck-t small{display:none}header.top{gap:7px!important}}";
    var st = document.createElement("style"); st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
    var D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function tick() {
      var els = document.querySelectorAll("[data-clock]");
      if (!els.length) return;
      var d = new Date(), h = d.getHours(), m = d.getMinutes(), ap = h < 12 ? "AM" : "PM";
      h = h % 12 || 12;
      var html = '<span class="ck-t">' + h + ":" + (m < 10 ? "0" : "") + m + "<small>" + ap + "</small></span>" +
                 '<span class="ck-d">' + D[d.getDay()] + " " + d.getDate() + " " + M[d.getMonth()] + "</span>";
      for (var i = 0; i < els.length; i++) if (els[i].innerHTML !== html) els[i].innerHTML = html;
    }
    window.jaClockTick = tick;
    setInterval(tick, 1000);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
  })();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
