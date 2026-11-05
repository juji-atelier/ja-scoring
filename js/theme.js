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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
