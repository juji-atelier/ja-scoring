/* =====================================================================
   JA Scoring — "WhatsApp me" card for scorer pages
   Lets AJK send the game format / feedback straight to JUJI-ATELIER.
   >>> Put your WhatsApp number here (country code, digits only) <<<
   ===================================================================== */
(function () {
  var WA_NUMBER = "60122457116";   // e.g. 60123456789 (no +, no dashes)

  var q = new URLSearchParams(location.search);
  var isBowling = /bowling\.html$/i.test(location.pathname);
  if (isBowling && (q.get("v") || location.hash.replace("#", "") || "").toLowerCase() !== "scorer") return;   // only on score-entry views

  var sportId = isBowling ? "bowling" : (q.get("sport") || "").toLowerCase();
  var SPORTS = {
    karom: ["Karom", "rally"], sepaktakraw: ["Sepak Takraw", "rally"], badminton: ["Badminton", "rally"],
    pingpong: ["Ping Pong", "rally"], bolatampar: ["Bola Tampar", "rally"], pickleball: ["Pickleball", "rally"],
    bolasepak: ["Bola Sepak", "goals"], futsal: ["Futsal", "goals"], bolajaring: ["Bola Jaring", "goals"],
    dart: ["Dart", "darts"], bowling: ["Bowling", "bowling"]
  };
  var sp = SPORTS[sportId] || [sportId ? sportId : "(sport)", ""];
  var name = sp[0], eng = sp[1];

  var specific = {
    rally:   "Points per set/game: \nBest of (sets/games): \nDeuce / point cap: \n",
    goals:   "Minutes per half/quarter: \nNo. of halves/quarters: \nBreak time: \nIf draw (extra time / penalties): \n",
    darts:   "Game (501 / 301): \nBest of (legs): \nDouble-out? (Y/N): \n",
    bowling: "Games per bowler: \nBowlers per team: \nHandicap (women / others): \n"
  }[eng] || "Scoring rules: \n";

  var msg =
    "Hi JA, game format for *HQ Games 2026 – " + name + "*\n\n" +
    "Tournament format (group / knockout / league): \n" +
    "No. of teams & groups: \n" +
    specific +
    "Tie-break rule: \n" +
    "Other notes / improvement for the system: \n\n" +
    "From (name / AJK): ";
  var href = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(msg);

  var css = document.createElement("style");
  css.textContent =
    ".ja-wa{max-width:560px;margin:18px auto 0;padding:14px 16px;display:flex;gap:12px;align-items:center;" +
    "background:var(--card,#fff);border:1px solid var(--line,#e4dfda);border-radius:14px;box-shadow:var(--shadow,none);" +
    "font:14px/1.35 Inter,system-ui,sans-serif;color:var(--ink,#1e2024)}" +
    ".ja-wa .ic{flex:none;width:40px;height:40px;border-radius:50%;background:#25D366;display:grid;place-items:center}" +
    ".ja-wa .ic svg{width:22px;height:22px;fill:#fff}" +
    ".ja-wa .tx{flex:1;min-width:0}.ja-wa b{display:block;font-size:14px}.ja-wa small{color:var(--mute,#6e7178);font-size:12px}" +
    ".ja-wa a{flex:none;background:#25D366;color:#fff!important;text-decoration:none;font-weight:700;font-size:13px;" +
    "padding:9px 14px;border-radius:999px;white-space:nowrap}.ja-wa a:active{transform:scale(.97)}" +
    "@media(max-width:420px){.ja-wa{margin:16px 12px 0}}";
  document.head.appendChild(css);

  var card = document.createElement("div");
  card.className = "ja-wa";
  card.innerHTML =
    '<span class="ic"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.2.1.7-.2 1.4z"/></svg></span>' +
    '<span class="tx"><b>Tell JA the game format</b><small>Rules, format changes or ideas to improve this page. You can attach photos (rule sheet, draw, bracket).</small>' +
    '<span class="ja-wa-imgs"></span>' +
    '<span class="ja-wa-row"><label class="ja-wa-add">+ Add photo<input type="file" accept="image/*" multiple hidden></label>' +
    '<span class="ja-wa-note"></span></span></span>' +
    '<a href="' + href + '" target="_blank" rel="noopener">WhatsApp</a>';

  var css2 = document.createElement("style");
  css2.textContent =
    ".ja-wa{align-items:flex-start}.ja-wa a{align-self:center}" +
    ".ja-wa-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}" +
    ".ja-wa-add{cursor:pointer;font-weight:700;font-size:12px;color:#128C4A;border:1px dashed #25D366;border-radius:999px;padding:5px 10px}" +
    ".ja-wa-note{font-size:11px;color:var(--mute,#6e7178)}" +
    ".ja-wa-imgs{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.ja-wa-imgs:empty{display:none}" +
    ".ja-wa-imgs span{position:relative}.ja-wa-imgs img{width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid var(--line,#e4dfda);display:block}" +
    ".ja-wa-imgs button{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:0;background:#C53030;color:#fff;font:700 12px/20px system-ui;padding:0;cursor:pointer}";
  document.head.appendChild(css2);

  var files = [];
  var input = card.querySelector("input[type=file]");
  var imgs = card.querySelector(".ja-wa-imgs");
  var note = card.querySelector(".ja-wa-note");
  var btn = card.querySelector("a");
  var canShareFiles = function (f) {
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: f })); } catch (e) { return false; }
  };
  function drawImgs() {
    imgs.innerHTML = "";
    files.forEach(function (f, i) {
      var w = document.createElement("span"), im = document.createElement("img"), x = document.createElement("button");
      im.src = URL.createObjectURL(f); im.alt = f.name; x.type = "button"; x.textContent = "×"; x.title = "Remove";
      x.onclick = function () { files.splice(i, 1); drawImgs(); };
      w.appendChild(im); w.appendChild(x); imgs.appendChild(w);
    });
    note.textContent = !files.length ? "" :
      canShareFiles(files) ? files.length + " photo(s) — choose JA's chat in WhatsApp after tapping the button."
                           : "This browser can't attach photos directly — WhatsApp will open, then attach the photo there.";
  }
  input.onchange = function () {
    for (var i = 0; i < input.files.length && files.length < 5; i++) files.push(input.files[i]);
    input.value = ""; drawImgs();
  };
  btn.onclick = function (e) {
    if (!files.length || !canShareFiles(files)) return;           // no photos → normal wa.me link to JA
    e.preventDefault();
    // Copy the template too, in case WhatsApp drops the text when photos are shared
    try { navigator.clipboard && navigator.clipboard.writeText(msg); } catch (er) {}
    navigator.share({ files: files, text: msg, title: "HQ Games 2026 – " + name })
      .then(function () { files = []; drawImgs(); })
      .catch(function (er) { if (er && er.name !== "AbortError") window.open(href, "_blank"); });
  };

  function place() {
    if (card.isConnected) return true;
    var foot = document.querySelector(".jafoot");
    if (!foot) return false;
    foot.parentNode.insertBefore(card, foot);
    return true;
  }
  function start() {
    place();
    // bowling.html re-renders its view, so keep the card in place
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
