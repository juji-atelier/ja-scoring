// JA logo splash for the public pages that live in the site's top folder (bowling, Mobile Legends).
// Same rule as the Live Scores page: plays when the page is opened and on refresh; skipped on
// Back/Forward and when hopping here from another page of this site. Load it in <head>.
(function () {
  try {
    if (new URLSearchParams(location.search).has("v") || /^#(scorer|overlay)/.test(location.hash)) return;   // scorer / OBS views: never
    var n = performance.getEntriesByType("navigation")[0], t = n ? n.type : "navigate",
        seen = sessionStorage.getItem("ja-splash"), own = document.referrer.indexOf(location.origin + "/") === 0;
    sessionStorage.setItem("ja-splash", "1");
    if (t === "back_forward" || (t === "navigate" && own && seen)) return;
  } catch (e) {}
  var st = document.createElement("style");
  st.textContent = ".jasplash{position:fixed;inset:0;z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(circle at 50% 42%,#2a2d35,#0e0f12 70%);animation:jasplashOut .6s ease 1.7s forwards}\n.jasplash i{display:block;width:min(52vw,230px);aspect-ratio:140/79;background:linear-gradient(160deg,#fff,#c9ced6 45%,#8a9099);-webkit-mask:url(img/ja.svg) center/contain no-repeat;mask:url(img/ja.svg) center/contain no-repeat;opacity:0;animation:jasplashIn .7s cubic-bezier(.2,.7,.2,1) .1s forwards}\n.jasplash u{display:block;height:2px;width:0;background:linear-gradient(90deg,transparent,#D2AC70,transparent);animation:jasplashLine .7s ease .5s forwards}\n.jasplash b{font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:6px;padding-left:6px;color:#b8bec7;opacity:0;animation:jasplashIn .6s ease .7s forwards}\n@keyframes jasplashIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}\n@keyframes jasplashLine{to{width:min(40vw,170px)}}\n@keyframes jasplashOut{to{opacity:0;visibility:hidden}}\n@media(prefers-reduced-motion:reduce){.jasplash,.jasplash *{animation-duration:.01s!important;animation-delay:0s!important}.jasplash{animation-delay:1.2s!important}}\n";
  var d = document.createElement("div");
  d.className = "jasplash"; d.setAttribute("aria-hidden", "true");
  d.innerHTML = "<i></i><u></u><b>JUJI-ATELIER</b>";
  d.addEventListener("animationend", function (e) { if (e.animationName === "jasplashOut") { d.remove(); st.remove(); } });
  document.documentElement.appendChild(st);
  document.documentElement.appendChild(d);
})();
