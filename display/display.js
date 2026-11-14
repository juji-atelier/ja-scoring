import { SPORTS, EVENT_DEFAULTS } from "../config.js?v=20261114v";
import { clockMs, mmss, catColor, standings } from "../js/engines.js?v=20261114v";
import * as C from "../js/common.js?v=20261114v";
import { applySportInfo } from "../js/sportinfo.js?v=20261114v";
import { BOARDS, mlbbMatches, applyBoardInfo } from "../js/boards.js?v=20261114v";
import { bowlingStandings } from "../js/bowling-data.js?v=20261114v";
import { firebaseConfig } from "../config.js?v=20261114v";
import { cfgOf, isDone, mlEffective, sportEffective, KEEP } from "../js/livecfg.js?v=20261114v";
const { $, esc, ref } = C;

const P = new URLSearchParams(location.search);
const FORCE_SPORT = SPORTS[P.get("sport")] || BOARDS[P.get("sport")] ? P.get("sport") : null;   // ?sport=badminton → one sport only
const FORCE_MATCH = P.get("match");                                     // ?match=badminton/<id>
if (P.get("bg") === "transparent") document.body.classList.add("transparent");
if (P.get("fx") !== "off") document.body.classList.add("fx");   // animations; add ?fx=off (or &fx=off) to the link for a still screen
if (!C.configured) { document.body.innerHTML = `<div class="setup">Paste your Firebase config into config.js</div>`; throw new Error("not configured"); }

let pub = {}, settings = {};
let current = null, rotStart = 0, rotList = [];

C.onValue(ref(C.db, "pub"), s => { pub = s.val() || {}; render(); checkGoals(); });
C.onValue(ref(C.db, "settings"), s => { settings = s.val() || {}; applySportInfo(settings.sportInfo); applyBoardInfo(settings.sportInfo); rotStart = 0; render(); });
// Boards with their own page (bowling, Mobile Legends) can be shown here too – see js/boards.js.
// Their data is only loaded while Admin has them pinned or ticked for the rotation.
const boardData = {}, boardOn = {};
function watchBoard(id) {
  if (boardOn[id]) return; boardOn[id] = true;
  const b = BOARDS[id], got = v => { boardData[id] = v || {}; render(); };
  C.onValue(ref(C.db, b.path), s => got(s.val()), () => {
    const url = String(firebaseConfig.databaseURL || "").replace(/\/$/, "") + "/" + b.path + ".json";
    const poll = () => fetch(url, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(got).catch(() => {});
    poll(); setInterval(poll, 15000);
  });
}
const boardWanted = id => FORCE_SPORT ? FORCE_SPORT === id : ((disp().mode === "sport" && disp().sport === id) || !!(disp().sports && disp().sports[id] === true));
// matches of a board in the same shape as a sport's matches, so the same cards can draw them
// Mobile Legends: the console's data, or the copy kept in Admin → Live score (completed / console cleared)
// Bowling marked Completed: its kept final standings
const bdata = id => {
  if (id === "mlbb") return mlEffective(boardData.mlbb, (pub[KEEP] || {}).mlbb, cfgOf(settings)).D || {};
  const k = (pub[KEEP] || {})[id];
  return isDone(cfgOf(settings), id) && k && k.d ? k.d : (boardData[id] || {});
};
function boardRecs(id) {
  if (id !== "mlbb") return [];
  const val = x => x.score ?? (x.kills != null ? x.kills + " K" : "");
  return mlbbMatches(bdata(id)).map((m, i) => {
    const a = m.a || {}, b = m.b || {}, st = m.st === "live" || m.st === "done" ? m.st : "scheduled";
    return { id: "m" + i, no: i + 1, a: a.name || "TBC", b: b.name || "TBC", st, w: m.w, rd: m.label, lb: m.label, t: i,
      sc: [val(a), val(b)], v: { big: [val(a), val(b)] } };
  });
}
function boardState(id) {   // has anything to show? is it going on right now?
  const D = bdata(id);
  if (id === "bowling") { const any = !!(D.scores && Object.keys(D.scores).length); return { data: any, live: any && Date.now() - (D.updated || 0) < 15 * 60000 }; }
  const r = boardRecs(id); return { data: r.length > 0, live: r.some(x => x.st === "live") };
}
// Warn on the screen itself when this computer loses the internet (scores would silently go stale).
let offSince = 0;
C.onValue(ref(C.db, ".info/connected"), s => { offSince = s.val() ? 0 : (offSince || Date.now()); renderOffline(); });
function renderOffline() {
  const el = $("#offline"); if (!el) return;
  const show = offSince && Date.now() - offSince > 6000;   // ignore the first seconds while connecting
  el.hidden = !show;
  if (show) { const m = Math.floor((Date.now() - offSince) / 60000);
    el.innerHTML = `<b>⚠ No internet on this screen</b> – scores may be out of date${m ? ` (offline ${m} min)` : ""}. Reconnecting…`; }
}
setInterval(renderOffline, 2000);
let bowlAnn = null;   // bowling has its own page; its announcement lives at bowling2026/ann
C.onValue(ref(C.db, "bowling2026/ann"), s => { bowlAnn = s.val(); renderAnn(); }, () => {});
const ANN_SRC = { bowling: BOARDS.bowling };   // name follows Admin

// a sport marked Completed in Admin → Live score shows its kept final results
const pubOf = sp => sportEffective(pub[sp], (pub[KEEP] || {})[sp], cfgOf(settings), sp).P;
const recs = sp => Object.entries(pubOf(sp).m || {}).map(([id, r]) => ({ id, ...r }));
const byNo = (x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999);
// "9:30 AM" -> minutes; untimed matches sort after timed ones
const tMin = s => {
  const m = String(s || "").trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
  if (!m) return 1e9;
  let h = +m[1]; const mi = +(m[2] || 0);
  if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return h * 60 + mi;
};
// what plays next, in the order it will actually be played: by start time, then table, then
// number. By number alone, two categories in one room (men #1-20, women #21-26, both from 9:00)
// would show only the men until the men were done.
const byPlay = (x, y) => tMin(x.tm) - tMin(y.tm) || (Number(x.ct) || 99) - (Number(y.ct) || 99) || byNo(x, y);
const disp = () => settings.display || {};

function pickSport() {
  if (FORCE_SPORT) return FORCE_SPORT;
  const d = disp();
  if (d.mode === "sport" && (SPORTS[d.sport] || BOARDS[d.sport])) return d.sport;
  // sports are in the rotation unless unticked; boards (bowling, Mobile Legends) only when ticked
  const enabled = [...Object.keys(SPORTS).filter(s => !d.sports || d.sports[s] !== false), ...Object.keys(BOARDS).filter(s => d.sports && d.sports[s] === true)];
  const withData = enabled.filter(s => BOARDS[s] ? boardState(s).data : recs(s).length);
  const withLive = withData.filter(s => BOARDS[s] ? boardState(s).live : recs(s).some(r => r.st === "live"));
  const list = withLive.length ? withLive : withData.length ? withData : enabled;
  const changed = list.join() !== rotList.join();
  rotList = list;
  const secs = Math.max(5, Number(d.rotate) || 15);
  const t = Date.now();
  if (changed || !current || !list.includes(current)) { current = list[0]; rotStart = t; }
  else if (t - rotStart > secs * 1000 && list.length > 1) { current = list[(list.indexOf(current) + 1) % list.length]; rotStart = t; }
  return current;
}

function featured() {
  const key = FORCE_MATCH || (disp().mode === "match" ? disp().match : null);
  if (!key) return null;
  const [sp, id] = key.split("/");
  const r = pubOf(sp).m && pubOf(sp).m[id];
  return r ? { sp, rec: { id, ...r } } : null;
}

// what the playing area is called in that sport: Table for karom, Lane for bowling…
const courtWord = sp => (SPORTS[sp] && SPORTS[sp].court) || "Court";
function clockSpan(v) {
  if (!v || !v.clock) return "";
  const c = v.clock;
  return ` · <span class="clk" data-run="${c.run ? 1 : 0}" data-st="${c.st || 0}" data-el="${c.el || 0}" data-len="${c.len || 0}">--:--</span>`;
}

function rowHTML(r, s, tagOn = true) {
  const i = s === "a" ? 0 : 1;
  const v = r.v || {};
  const done = r.st === "done", sched = r.st === "scheduled";
  const big = sched ? "" : done ? (r.wo ? (r.w === s ? "W/O" : "") : (r.sc || [])[i]) : (v.big || [])[i];
  const small = !sched && !done && v.small ? v.small[i] : "";
  const tag = tagOn && r.st === "live" ? (s === "a" ? v.tagA : v.tagB) : "";
  return `<div class="trow ${done && r.w === s ? "win" : ""}">
    <span class="srv ${r.st === "live" && v.srv === s ? "on" : ""}"></span>
    <span class="nm cond">${esc(r[s])}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}${r["p" + s] ? `<span class="pl">${esc(r["p" + s])}</span>` : ""}</span>
    <span class="sm cond">${small !== "" && small != null ? small : ""}</span>
    <span class="bg cond" data-k="${esc(r.id)}:${s}">${big ?? ""}</span></div>`;
}

let catList = [];   // categories of the sport on screen (for their colours)
let cwNow = "Court";   // what that sport calls its playing area: Table, Lane, Pitch…
function cardHTML(r) {
  const v = r.v || {};
  const st = r.st === "live" ? (v.stx || "Live") + clockSpan(v) : r.st === "done" ? "Final" : (r.tm || "Up next");
  const pt = r.st === "live" ? (v.tagA || v.tagB || "") : "";
  const rd = r.rd && !/^group stage$/i.test(r.rd) ? r.rd : "";
  return `<div class="card ${r.st === "live" ? "lv" : ""}" ${r.ev ? `style="--cc:${catColor(r.ev, catList, true)}"` : ""}>
    <div class="meta">${r.ct ? `<span class="ctb">${esc(cwNow)} ${esc(r.ct)}</span>` : ""}${r.ev ? `<span class="evc">${esc(r.ev)}</span>` : ""}${rd ? `<span>${esc(rd)}</span>` : ""}${pt ? `<span class="ptb">${esc(pt)}</span>` : ""}<span class="st">${st}</span></div>
    ${rowHTML(r, "a", false)}${rowHTML(r, "b", false)}
    ${v.hist ? `<div class="hist">${esc(v.hist)}</div>` : ""}</div>`;
}

// goal scorers and cards (when the scorer records them)
const EV_ICON = { g: "⚽", og: "⚽", y: "🟨", r: "🟥" };
const evList = r => (Array.isArray(r.tl) ? r.tl : Object.values(r.tl || {})).filter(e => e && e.k);
const evText = e => (e.k === "og" ? "Own goal" + (e.n ? " (" + e.n + ")" : "") : e.n || (e.k === "r" ? "Red card" : e.k === "y" ? "Yellow card" : "")) ;
function evHTML(r) {
  const tl = evList(r).filter(e => e.n || e.k !== "g");
  if (!tl.length) return "";
  const col = s => tl.filter(e => e.s === s).slice(-4).map(e => `<span>${EV_ICON[e.k] || ""} ${esc(evText(e))}${e.m ? ` <i>${e.m}'</i>` : ""}</span>`).join("");
  return `<div class="evs"><div>${col("a")}</div><div>${col("b")}</div></div>`;
}
// GOAL! banner: pops up for a few seconds when a live match gets a new goal
const goalSeen = {}; let goalFlash = null, goalReady = false;
function checkGoals() {
  const d = disp();
  for (const sp of Object.keys(SPORTS)) {
    if (FORCE_SPORT ? sp !== FORCE_SPORT : (d.sports && d.sports[sp] === false)) continue;
    for (const r of recs(sp)) {
      const key = sp + "/" + r.id, n = (r.sc || [0, 0])[0] + (r.sc || [0, 0])[1];
      if (goalReady && r.st === "live" && SPORTS[sp].engine === "goals" && goalSeen[key] != null && n > goalSeen[key]) goalFlash = { key, sp, until: Date.now() + 7000 };
      goalSeen[key] = n;
      if (goalReady && stSeen[key] === "live" && r.st === "done") finQueue.push({ key, sp });
      stSeen[key] = r.st;
    }
  }
  goalReady = true;
  renderGoal();
}
// "FINAL" card: slides in at the top right for a few seconds when a live match finishes
const stSeen = {}, finQueue = []; let finNow = null;
function renderFin() {
  const el = $("#fin"); if (!el) return;
  if (finNow && Date.now() > finNow.until) { finNow = null; el.hidden = true; }
  if (finNow || !finQueue.length || !document.body.classList.contains("fx")) return;
  const q = finQueue.shift(), [sp, id] = q.key.split("/"), r = recs(sp).find(x => x.id === id);
  if (!r) return;
  const w = r.w === "a" ? r.a : r.w === "b" ? r.b : "";
  el.style.setProperty("--fc", SPORTS[sp].color);
  el.innerHTML = `<div class="fk cond">🏁 Final · ${esc(SPORTS[sp].name)}${r.rd ? " · " + esc(r.rd) : ""}</div>
    <div class="fs cond">${esc(r.a)} <b>${r.wo ? "W/O" : `${(r.sc || [])[0]} – ${(r.sc || [])[1]}`}</b> ${esc(r.b)}</div>${w ? `<div class="fw">🏆 ${esc(w)}</div>` : ""}`;
  el.hidden = false;
  finNow = { until: Date.now() + 7000 };
}
setInterval(renderFin, 500);

function renderGoal() {
  const el = $("#goal"); if (!el) return;
  if (!goalFlash || Date.now() > goalFlash.until) { el.hidden = true; goalFlash = null; return; }
  const [sp, id] = goalFlash.key.split("/"), r = recs(sp).find(x => x.id === id);
  if (!r) { el.hidden = true; return; }
  const last = evList(r).filter(e => e.k === "g" || e.k === "og").slice(-1)[0];
  const side = last ? last.s : null;
  el.style.setProperty("--gc", SPORTS[sp].color);
  el.innerHTML = `<div class="gk cond">⚽ GOAL!</div><div class="gs cond">${esc(r.a)} <b>${(r.sc || [])[0]} – ${(r.sc || [])[1]}</b> ${esc(r.b)}</div>` +
    (last && (last.n || last.k === "og") ? `<div class="gn">${esc(evText(last))}${side ? " · " + esc(side === "a" ? r.a : r.b) : ""}${last.m ? ` · ${last.m}'` : ""}</div>` : "") +
    `<div class="gp cond">${esc(SPORTS[sp].name)}</div>`;
  el.hidden = false;
}
setInterval(renderGoal, 1000);

function listHTML(arr, kind) {
  if (!arr.length) return `<div class="empty">${kind === "next" ? "No more matches scheduled" : "No results yet"}</div>`;
  return `<div class="list">` + arr.map(r => {
    if (kind === "next") return `<div class="it"><span class="n">${r.tm ? esc(r.tm) : r.lb ? esc(r.lb) : "#" + esc(r.no)}${r.ct ? " · " + esc(cwNow) + " " + esc(r.ct) : ""}</span>
      <span class="t">${esc(r.a)} <span style="color:var(--muted)">vs</span> ${esc(r.b)}</span><span></span></div>`;
    const s = r.wo ? "W/O" : `${(r.sc || [])[0]}–${(r.sc || [])[1]}`;
    return `<div class="it"><span class="n">${esc(r.rd || "#" + r.no)}</span>
      <span class="t">${r.w === "a" ? `<b>${esc(r.a)}</b>` : esc(r.a)} <span style="color:var(--muted)">vs</span> ${r.w === "b" ? `<b>${esc(r.b)}</b>` : esc(r.b)}</span><span class="s">${s}</span></div>`;
  }).join("") + `</div>`;
}

function render() { renderView(); fx(); fitText(); }

// Admin asked every device to reload: a big screen holds no state, so just do it.
C.watchReload(v => C.reloadFresh(v && v.at));

// ---------------- QR to the live page, bottom of the right-hand column
// One persistent card, moved into each new render; the code is drawn once per sport and opens the
// live page straight on the sport being shown. If the QR library can't load, there is simply no card.
const qrCard = document.createElement("div");
qrCard.className = "qrc";
qrCard.innerHTML = `<div class="qrf"><div class="qri"></div><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i></div>
  <div class="qrt"><div class="qk cond"><i class="dot"></i>LIVE SCORES</div><b class="cond">Don't miss a moment</b></div>`;
let qrFor = "";
function placeQR(sp) {
  const col = $("#main .rcol");
  if (!col || typeof QRCode === "undefined") return;
  const url = location.origin + location.pathname.replace(/display\/.*$/, "live/") + "?sport=" + encodeURIComponent(sp);
  if (url !== qrFor) {
    const box = qrCard.querySelector(".qri");
    box.innerHTML = "";
    try { new QRCode(box, { text: url, width: 320, height: 320, colorDark: "#111317", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M }); qrFor = url; }
    catch (e) { return; }
  }
  col.appendChild(qrCard);
  // Room for the card comes out of "Up next" first (the big cards already show what is coming),
  // and only then, if it really must, out of "Latest results" - whole items, never cut in half.
  requestAnimationFrame(() => {
    const rl = col.querySelector(".rl"); if (!rl) return;
    const fits = () => rl.scrollHeight <= rl.clientHeight + 1;
    for (const L of rl.querySelectorAll(".list")) {
      const its = [...L.querySelectorAll(".it")];
      while (!fits() && its.length > 1) its.pop().style.display = "none";
    }
  });
}

// ---------------- long names on a big screen
// Team names come from the scorer ("FLICK & STRIKE DX") and the optional Short name is usually
// left blank, so rather than cut a name off with an ellipsis, step its size down until it fits
// its own box. Only ever shrinks, never past 60%, and below that the old ellipsis still applies,
// so the worst case is what the screen did before.
const FIT_SEL = ".trow .nm, .bw-n, .list .it .t, .aw-n, .qrc .qrt b";   // the boxes that hold a name on one line
function fitText(root) {
  for (const el of (root || document).querySelectorAll(FIT_SEL)) {
    el.style.fontSize = "";                                   // back to the size the CSS asks for
    const base = parseFloat(getComputedStyle(el).fontSize);
    if (!base || !el.clientWidth) continue;
    for (let k = 0.95; k >= 0.6 && el.scrollWidth > el.clientWidth + 1; k -= 0.05)
      el.style.fontSize = (base * k).toFixed(2) + "px";
  }
}
// the box changes with the window (--u is vw/vh based) and text measures differently once the
// web font is in, so fit again after both
let fitTimer = null;
addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitText, 150); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitText()).catch(() => {});

// ---------------- lively bits: content slides in when the view changes, a score "bumps" when it changes
let fxKey = "", fxPrev = {}, fxEnterAt = 0;
const fxBumpAt = {};
function fx() {
  const main = $("#main"), chip = $("#sportChip"), f = featured(), t = Date.now();
  const key = main.className.replace("enter", "").trim() + "|" + chip.textContent + "|" + (f ? f.rec.id : "");
  const changed = key !== fxKey; fxKey = key;
  if (changed) { fxEnterAt = t; chip.classList.remove("pop"); void chip.offsetWidth; chip.classList.add("pop"); }
  // the screen is redrawn whenever data arrives, so keep the slide-in going for its full length
  main.classList.toggle("enter", t - fxEnterAt < 1100);
  const seen = {};
  for (const el of main.querySelectorAll("[data-k]")) {
    const k = el.dataset.k, v = el.textContent; seen[k] = v;
    if (!changed && fxPrev[k] !== undefined && fxPrev[k] !== v && v !== "") fxBumpAt[k] = t;
    const age = t - (fxBumpAt[k] || 0);
    if (age < 800) { el.classList.add("bump"); el.style.animationDelay = -age + "ms"; }   // carry on where it was
  }
  fxPrev = seen;
}
// thin line under the top bar: time left before the screen moves to the next sport
function renderRot() {
  const el = $("#rot"); if (!el) return;
  const on = !FORCE_SPORT && !featured() && (disp().mode || "auto") === "auto" && rotList.length > 1;
  const pct = on ? Math.min(100, (Date.now() - rotStart) / (Math.max(5, Number(disp().rotate) || 15) * 1000) * 100) : 0;
  el.style.transition = pct < (el._p || 0) ? "none" : "";
  el.style.width = pct + "%"; el._p = pct;
}

// ---------------- group tables as a second slide
// Badminton runs four categories of pure round robin, so once a few results are in the tables
// are the interesting thing on screen - the match lists alone say very little. The panel
// alternates between the matches and the tables; other sports are unaffected.
const TABLE_SLIDE = new Set(["badminton"]);
let slideOn = false, slideIx = 0, slideAt = 0;

function tablesHTML(all, SP) {
  const t = standings(all);
  const groups = Object.entries(t).filter(([, rows]) => rows.length).sort((a, b) => a[0].localeCompare(b[0]));
  if (!groups.length) return "";
  const block = ([g, rows]) => `<div class="tbl" style="--cc:${catColor(g, catList, true)}">
    <div class="tname">${esc(g)}</div>
    <div class="thead"><span></span><span class="l">Team</span><span>P</span><span>W</span><span>L</span><span>Pts</span></div>
    ${rows.map((r, i) => `<div class="trw${i < 2 ? " top" : ""}"><span class="tp">${i + 1}</span><span class="l">${esc(r.team)}</span>
      <span>${r.p}</span><span>${r.w}</span><span>${r.l}</span><span class="tpt">${r.pts}</span></div>`).join("")}</div>`;
  return `<h2>Standings · ${esc(SP.name)}</h2>
    <div class="tables" style="--tc:${groups.length > 2 ? 2 : 1}">${groups.map(block).join("")}</div>`;
}

function renderView() {
  const ev = settings.event || EVENT_DEFAULTS.name;
  $("#evName").textContent = ev;
  $("#evVenue").textContent = settings.venue || EVENT_DEFAULTS.venue;
  const main = $("#main");
  for (const id of Object.keys(BOARDS)) if (boardWanted(id)) watchBoard(id);

  if (!FORCE_SPORT && !FORCE_MATCH && disp().mode === "awards") {
    renderAwards(main);
    renderTicker();
    return;
  }

  const f = featured();
  if (f) {
    const SP = SPORTS[f.sp];
    $("#evVenue").textContent = SP.venue || settings.venue || EVENT_DEFAULTS.venue;
    document.documentElement.style.setProperty("--sport", SP.color);
    $("#sportChip").textContent = SP.name;
    $("#dots").innerHTML = "";
    const r = f.rec, v = r.v || {};
    cwNow = courtWord(f.sp);
    main.className = "solo";
    const hasEv = !!evHTML(r);
    main.innerHTML = `<div class="feat ${hasEv ? "hasev" : ""}">
      <div class="meta">${[r.ct ? esc(courtWord(f.sp)) + " " + esc(r.ct) : "", esc(r.rd), esc(r.ev)].filter(Boolean).join(" · ")}</div>
      ${rowHTML(r, "a")}${rowHTML(r, "b")}
      <div class="st">${r.st === "live" ? esc(v.stx || "Live") + clockSpan(v) : r.st === "done" ? "Final" : "Up next" + (r.tm ? " · " + esc(r.tm) : "")}</div>
      ${v.hist ? `<div class="hist">${esc(v.hist)}</div>` : ""}${evHTML(r)}</div>`;
  } else {
    const sp = pickSport();
    const SP = SPORTS[sp] || BOARDS[sp];
    $("#evVenue").textContent = SP.venue || settings.venue || EVENT_DEFAULTS.venue;
    document.documentElement.style.setProperty("--sport", SP.color);
    $("#sportChip").textContent = SP.name;
    $("#dots").innerHTML = !FORCE_SPORT && rotList.length > 1 ? rotList.map(s => `<i class="${s === sp ? "on" : ""}"></i>`).join("") : "";
    if (sp === "bowling") { main.className = ""; main.innerHTML = bowlingHTML(); renderTicker(); renderAnn(); tick(); return; }
    const all = BOARDS[sp] ? boardRecs(sp) : recs(sp);
    const live = all.filter(r => r.st === "live").sort((x, y) => String(x.ct).localeCompare(String(y.ct), undefined, { numeric: true }) || byNo(x, y)).slice(0, 6);
    const next = all.filter(r => r.st === "scheduled").sort(byPlay);
    const done = all.filter(r => r.st === "done").sort((x, y) => (y.t || 0) - (x.t || 0));
    main.className = "";
    let left;
    catList = all.map(r => r.ev || "");
    cwNow = courtWord(sp);
    // Only courts that are actually in play get a tile: a court that appears on finished
    // matches alone is not in use, and would show as "free" while hiding the live matches.
    const courtsOf = rs => [...new Set(rs.map(r => String(r.ct || "").trim()).filter(Boolean))];
    const liveCourts = courtsOf(live);
    const courts = [...new Set([...liveCourts, ...courtsOf(next)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    // a live match whose court has not been set yet still needs a card of its own
    const noCourt = live.filter(r => !String(r.ct || "").trim());
    const tiles = courts.length + noCourt.length;
    if (live.length && liveCourts.length && tiles >= 2 && tiles <= 6) {
      // every court keeps its own spot: live match, or what is next on that court
      const cols = tiles <= 4 ? 2 : 3;
      const sz = cols === 2 ? "--nm:calc(2.2*var(--u));--big:calc(3.8*var(--u))" : "--nm:calc(1.6*var(--u));--big:calc(2.7*var(--u))";
      const tile = c => {
        const lv = live.find(r => String(r.ct) === c);
        if (lv) return cardHTML(lv);
        const nx = next.find(r => String(r.ct) === c);
        return `<div class="card idle" ${nx && nx.ev ? `style="--cc:${catColor(nx.ev, catList, true)}"` : ""}><div class="meta"><span class="ctb">${esc(cwNow)} ${esc(c)}</span></div>
          <div class="idlebox">${nx ? `<span>Next${nx.tm ? " at " + esc(nx.tm) : ""}</span><b class="cond">${esc(nx.a)} vs ${esc(nx.b)}</b>${nx.ev ? `<i>${esc(nx.ev)}</i>` : ""}` : `<span>${esc(cwNow)} free</span>`}</div></div>`;
      };
      left = `<h2><span class="live">LIVE</span> ${esc(SP.name)}</h2><div class="grid courts" style="--cols:${cols};${sz}">${courts.map(tile).join("") + noCourt.map(cardHTML).join("")}</div>`;
    } else if (live.length) {
      const n = live.length, cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
      const sz = cols === 1 ? "--nm:calc(3.6*var(--u));--big:calc(7*var(--u))" : cols === 2 ? "--nm:calc(2.2*var(--u));--big:calc(3.8*var(--u))" : "--nm:calc(1.6*var(--u));--big:calc(2.7*var(--u))";
      left = `<h2><span class="live">LIVE</span> ${esc(SP.name)}</h2><div class="grid" style="--cols:${cols};${sz}">${live.map(cardHTML).join("")}</div>`;
    } else if (next.length) {
      left = `<h2>Up next · ${esc(SP.name)}</h2><div class="grid" style="--cols:2;--nm:calc(1.9*var(--u));--big:calc(3*var(--u))">${next.slice(0, 6).map(cardHTML).join("")}</div>`;
    } else if (done.length) {
      left = `<h2>Results · ${esc(SP.name)}</h2><div class="grid" style="--cols:2;--nm:calc(1.9*var(--u));--big:calc(3.2*var(--u))">${done.slice(0, 6).map(cardHTML).join("")}</div>`;
    } else {
      left = `<h2>${esc(SP.name)}</h2><div class="empty">Matches will appear here soon.</div>`;
    }
    // second slide: the group tables, once there is a result to build them from
    slideOn = TABLE_SLIDE.has(sp) && done.length > 0 && all.some(r => r.gr);
    if (!slideOn) { slideIx = 0; slideAt = Date.now(); }
    if (slideOn && slideIx === 1) {
      const tb = tablesHTML(all, SP);
      if (tb) left = tb; else slideOn = false;
    }
    const right = `<h2>Up next</h2>${listHTML(next.slice(live.length ? 0 : 6, (live.length ? 0 : 6) + 6), "next")}
      <h2>Latest results</h2>${listHTML(done.slice(0, 6), "done")}`;
    // the lists live in their own box above the QR card, so they can never run underneath it
    main.innerHTML = `<div class="col">${left}</div><div class="col rcol"><div class="rl">${right}</div></div>`;
    placeQR(sp);
  }
  renderTicker();
  renderAnn();
  tick();
}

// ---------------- bowling standings (teams on the left, top bowlers on the right)
function bowlingHTML() {
  const D = bdata("bowling");
  if (!D) return `<div class="col"><h2>${esc(BOARDS.bowling.name)}</h2><div class="empty">Loading…</div></div><div class="col"></div>`;
  const bw = bowlingStandings(D), N = bw.N;
  if (!bw.anyScore) return `<div class="col"><h2>${esc(BOARDS.bowling.name)}</h2><div class="empty">Scores will appear here soon.</div></div><div class="col"></div>`;
  const teams = bw.teams, two = teams.length > 11;
  const trow = (t, i) => `<div class="bw-r ${t.done >= t.slots ? "fin" : ""}"><span class="bw-p cond">${bw.rankOf(teams, i)}</span><span class="bw-n cond">${esc(t.t)}</span>
    <span class="bw-g">${t.done >= t.slots ? "Final" : t.done ? "Game " + Math.min(N, Math.ceil(t.done / Math.max(1, t.mem.length))) + "/" + N : ""}</span><span class="bw-t cond" data-k="bw:${esc(t.t)}">${t.done ? t.total : "–"}</span></div>`;
  const plist = arr => arr.length ? `<div class="list">` + arr.slice(0, 5).map((p, i) => `<div class="it"><span class="n">${bw.rankOf(arr, i)}</span>
    <span class="t">${i === 0 ? `<b>${esc(p.n)}</b>` : esc(p.n)} <span style="color:var(--muted);font-weight:500">· ${esc(p.t)}</span></span><span class="s">${p.total}</span></div>`).join("") + `</div>` : `<div class="empty">No scores yet</div>`;
  return `<div class="col"><h2>Team standings · ${esc(BOARDS.bowling.name)}</h2><div class="bw ${two ? "two" : ""}" style="--rows:${two ? Math.ceil(teams.length / 2) : teams.length}">${teams.map(trow).join("")}</div></div>
    <div class="col"><h2>Top men</h2>${plist(bw.men)}<h2>Top women</h2>${plist(bw.women)}</div>`;
}

// ---------------- scorer announcements (pub/<sport>/ann)
let annKey = "", annIdx = 0, annAt = 0;
function activeAnns() {
  const t = C.now(), out = [];
  for (const sp of Object.keys(SPORTS)) {
    const a = pub[sp] && pub[sp].ann;
    if (a && a.t && (!a.exp || a.exp > t)) out.push({ sp, ...a });
  }
  if (bowlAnn && bowlAnn.t && (!bowlAnn.exp || bowlAnn.exp > t)) out.push({ sp: "bowling", ...bowlAnn });
  return out.sort((x, y) => (y.at || 0) - (x.at || 0));   // newest first
}
function renderAnn(force) {
  const el = $("#ann");
  const list = activeAnns();
  if (!list.length) { el.hidden = true; annKey = ""; return; }
  const key = list.map(a => a.sp + a.at + a.t).join("|");
  if (key !== annKey) { annKey = key; annIdx = 0; annAt = Date.now(); force = true; }
  else if (list.length > 1 && Date.now() - annAt > 9000) { annIdx = (annIdx + 1) % list.length; annAt = Date.now(); force = true; }
  if (!force && !el.hidden) return;
  const a = list[annIdx % list.length], SPx = SPORTS[a.sp] || ANN_SRC[a.sp];
  el.style.setProperty("--ac", SPx.color);
  el.innerHTML = `<div class="al cond">📢 ${esc(SPx.name)}</div><div class="at">${esc(a.t)}</div>` +
    (list.length > 1 ? `<div class="an cond">${annIdx % list.length + 1} / ${list.length}</div>` : "");
  el.hidden = false;
}

let lastTicker = "";
function renderTicker() {
  const items = [];
  if (settings.ticker) items.push(settings.ticker);
  const results = [];
  for (const sp of Object.keys(SPORTS)) for (const r of recs(sp)) if (r.st === "done") results.push({ sp, r });
  results.sort((x, y) => (y.r.t || 0) - (x.r.t || 0));
  for (const { sp, r } of results.slice(0, 12)) {
    const s = r.wo ? "W/O" : `${(r.sc || [])[0]}–${(r.sc || [])[1]}`;
    items.push(`${SPORTS[sp].name.toUpperCase()}: ${r.a} ${s} ${r.b}`);
  }
  const text = items.join("     ◆     ") || `${settings.event || EVENT_DEFAULTS.name} · Scan the QR code for live scores`;
  if (text === lastTicker) return;
  lastTicker = text;
  const el = $("#ticker");
  el.textContent = text;
  el.style.setProperty("--dur", Math.max(20, text.length * 0.18) + "s");
}

function tick() {
  const d = new Date();
  $("#now").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#today").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" }).replace(/^(\w+),?\s/, "$1 · ");
  for (const el of document.querySelectorAll(".clk")) {
    const ms = clockMs({ run: el.dataset.run === "1", st: Number(el.dataset.st), el: Number(el.dataset.el) }, C.now());
    const left = Number(el.dataset.len) - ms;
    el.textContent = left >= 0 ? mmss(left) : "+" + mmss(-left);
  }
}
setInterval(() => {
  tick();
  renderRot();
  renderAnn();
  if (slideOn) {
    const secs = Math.max(8, Number(disp().slide) || 15);
    if (Date.now() - slideAt > secs * 1000) { slideAt = Date.now(); slideIx = slideIx ? 0 : 1; render(); }
  }
  if (!FORCE_SPORT && !featured() && (disp().mode || "auto") === "auto") {
    const before = current;
    pickSport();
    if (current !== before) render();
  }
}, 500);

// ---------------- prize giving
function renderAwards(main) {
  document.documentElement.style.setProperty("--sport", "#B3162D");
  $("#sportChip").textContent = "Prize giving";
  $("#dots").innerHTML = "";
  const list = (Array.isArray(settings.awards) ? settings.awards : Object.values(settings.awards || {}))
    .filter(a => a && a.p && a.p[0]);
  main.className = "solo";
  if (!list.length) { main.innerHTML = `<div class="aw-empty">Winners will be announced soon</div>`; return; }
  // never more than two rows, so nothing drops off the bottom of the screen (7–8 categories: 4 across, 9–10: 5, 11–12: 6)
  const cols = list.length <= 2 ? list.length : list.length <= 4 ? 2 : list.length <= 6 ? 3 : Math.min(6, Math.ceil(list.length / 2));
  // confetti (same pattern every time, so it does not jump when the winners are edited)
  const CF = ["#D2AC70", "#B3162D", "#F2F3F5", "#E0364F", "#A7AEB8"];
  const confetti = `<div class="confetti">` + Array.from({ length: 44 }, (_, i) =>
    `<i style="left:${(i * 37) % 100}%;background:${CF[i % CF.length]};animation-delay:${((i * 53) % 90) / 10}s;animation-duration:${6 + (i * 7) % 5}s;width:${0.5 + (i % 3) * 0.2}vw"></i>`).join("") + `</div>`;
  main.innerHTML = confetti + `<div class="aw-wrap"><h2 class="aw-title cond">Champions · ${esc(settings.event || EVENT_DEFAULTS.name)}</h2>
    <div class="aw-grid ${cols > 3 ? "many" : ""}" style="--cols:${cols}">` + list.map((a, n) => `
    <div class="aw-card" style="--c:${esc(a.color || "#B3162D")};animation-delay:${n * 90}ms">
      <div class="aw-cat cond">${esc(a.label)}</div>
      ${a.p.map((name, i) => name ? `<div class="aw-row p${i + 1}"><span class="aw-m">${i + 1}</span><span class="aw-n">${esc(name)}</span></div>` : "").join("")}
    </div>`).join("") + `</div></div>`;
}

// Full screen: button appears on mouse move / tap, then hides; F key or double-click also toggles
(() => {
  const btn = $("#fsBtn"); if (!btn) return;
  const can = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  if (!can) { btn.remove(); return; }
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const toggle = () => {
    if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else { const el = document.documentElement; const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (p && p.catch) p.catch(() => {}); }
  };
  const label = () => { btn.querySelector("span").textContent = isFs() ? "Exit full screen" : "Full screen"; };
  let t;
  const wake = () => { btn.classList.add("on"); document.body.classList.remove("idle"); clearTimeout(t);
    t = setTimeout(() => { btn.classList.remove("on"); document.body.classList.add("idle"); }, 3000); };
  btn.onclick = e => { e.stopPropagation(); toggle(); };
  document.addEventListener("mousemove", wake); document.addEventListener("touchstart", wake, { passive: true });
  document.addEventListener("dblclick", toggle);
  document.addEventListener("keydown", e => { if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) toggle(); });
  document.addEventListener("fullscreenchange", label); document.addEventListener("webkitfullscreenchange", label);
  label(); wake();
})();
