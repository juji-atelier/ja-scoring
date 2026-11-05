import { SPORTS, EVENT_DEFAULTS } from "../config.js";
import { clockMs, mmss } from "../js/engines.js";
import * as C from "../js/common.js";
const { $, esc, ref } = C;

const P = new URLSearchParams(location.search);
const FORCE_SPORT = SPORTS[P.get("sport")] ? P.get("sport") : null;   // ?sport=badminton → one sport only
const FORCE_MATCH = P.get("match");                                     // ?match=badminton/<id>
if (P.get("bg") === "transparent") document.body.classList.add("transparent");
if (!C.configured) { document.body.innerHTML = `<div class="setup">Paste your Firebase config into config.js</div>`; throw new Error("not configured"); }

let pub = {}, settings = {};
let current = null, rotStart = 0, rotList = [];

C.onValue(ref(C.db, "pub"), s => { pub = s.val() || {}; render(); });
C.onValue(ref(C.db, "settings"), s => { settings = s.val() || {}; rotStart = 0; render(); });
let bowlAnn = null;   // bowling has its own page; its announcement lives at bowling2026/ann
C.onValue(ref(C.db, "bowling2026/ann"), s => { bowlAnn = s.val(); renderAnn(); }, () => {});
const ANN_SRC = { bowling: { name: "Bowling", color: "#8b5cf6" } };

const recs = sp => Object.entries((pub[sp] && pub[sp].m) || {}).map(([id, r]) => ({ id, ...r }));
const byNo = (x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999);
const disp = () => settings.display || {};

function pickSport() {
  if (FORCE_SPORT) return FORCE_SPORT;
  const d = disp();
  if (d.mode === "sport" && SPORTS[d.sport]) return d.sport;
  const enabled = Object.keys(SPORTS).filter(s => !d.sports || d.sports[s] !== false);
  const withData = enabled.filter(s => recs(s).length);
  const withLive = withData.filter(s => recs(s).some(r => r.st === "live"));
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
  const r = pub[sp] && pub[sp].m && pub[sp].m[id];
  return r ? { sp, rec: { id, ...r } } : null;
}

function clockSpan(v) {
  if (!v || !v.clock) return "";
  const c = v.clock;
  return ` · <span class="clk" data-run="${c.run ? 1 : 0}" data-st="${c.st || 0}" data-el="${c.el || 0}" data-len="${c.len || 0}">--:--</span>`;
}

function rowHTML(r, s) {
  const i = s === "a" ? 0 : 1;
  const v = r.v || {};
  const done = r.st === "done", sched = r.st === "scheduled";
  const big = sched ? "" : done ? (r.wo ? (r.w === s ? "W/O" : "") : (r.sc || [])[i]) : (v.big || [])[i];
  const small = !sched && !done && v.small ? v.small[i] : "";
  const tag = r.st === "live" ? (s === "a" ? v.tagA : v.tagB) : "";
  return `<div class="trow ${done && r.w === s ? "win" : ""}">
    <span class="srv ${r.st === "live" && v.srv === s ? "on" : ""}"></span>
    <span class="nm cond">${esc(r[s])}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</span>
    <span class="sm cond">${small !== "" && small != null ? small : ""}</span>
    <span class="bg cond">${big ?? ""}</span></div>`;
}

function cardHTML(r) {
  const v = r.v || {};
  const st = r.st === "live" ? (v.stx || "Live") + clockSpan(v) : r.st === "done" ? "Final" : (r.tm || "Up next");
  return `<div class="card">
    <div class="meta">${r.ct ? `<span>Court ${esc(r.ct)}</span>` : ""}<span>${esc(r.rd || "")}</span>${r.ev ? `<span>${esc(r.ev)}</span>` : ""}<span class="st">${st}</span></div>
    ${rowHTML(r, "a")}${rowHTML(r, "b")}
    ${v.hist ? `<div class="hist">${esc(v.hist)}</div>` : ""}</div>`;
}

function listHTML(arr, kind) {
  if (!arr.length) return `<div class="empty">${kind === "next" ? "No more matches scheduled" : "No results yet"}</div>`;
  return `<div class="list">` + arr.map(r => {
    if (kind === "next") return `<div class="it"><span class="n">${r.tm ? esc(r.tm) : "#" + esc(r.no)}${r.ct ? " · C" + esc(r.ct) : ""}</span>
      <span class="t">${esc(r.a)} <span style="color:var(--muted)">vs</span> ${esc(r.b)}</span><span></span></div>`;
    const s = r.wo ? "W/O" : `${(r.sc || [])[0]}–${(r.sc || [])[1]}`;
    return `<div class="it"><span class="n">${esc(r.rd || "#" + r.no)}</span>
      <span class="t">${r.w === "a" ? `<b>${esc(r.a)}</b>` : esc(r.a)} <span style="color:var(--muted)">vs</span> ${r.w === "b" ? `<b>${esc(r.b)}</b>` : esc(r.b)}</span><span class="s">${s}</span></div>`;
  }).join("") + `</div>`;
}

function render() {
  const ev = settings.event || EVENT_DEFAULTS.name;
  $("#evName").textContent = ev;
  $("#evVenue").textContent = settings.venue || EVENT_DEFAULTS.venue;
  const main = $("#main");

  if (!FORCE_SPORT && !FORCE_MATCH && disp().mode === "awards") {
    renderAwards(main);
    renderTicker();
    return;
  }

  const f = featured();
  if (f) {
    const SP = SPORTS[f.sp];
    document.documentElement.style.setProperty("--sport", SP.color);
    $("#sportChip").textContent = SP.name;
    $("#dots").innerHTML = "";
    const r = f.rec, v = r.v || {};
    main.className = "solo";
    main.innerHTML = `<div class="feat">
      <div class="meta">${[r.ct ? "Court " + esc(r.ct) : "", esc(r.rd), esc(r.ev)].filter(Boolean).join(" · ")}</div>
      ${rowHTML(r, "a")}${rowHTML(r, "b")}
      <div class="st">${r.st === "live" ? esc(v.stx || "Live") + clockSpan(v) : r.st === "done" ? "Final" : "Up next" + (r.tm ? " · " + esc(r.tm) : "")}</div>
      ${v.hist ? `<div class="hist">${esc(v.hist)}</div>` : ""}</div>`;
  } else {
    const sp = pickSport();
    const SP = SPORTS[sp];
    document.documentElement.style.setProperty("--sport", SP.color);
    $("#sportChip").textContent = SP.name;
    $("#dots").innerHTML = !FORCE_SPORT && rotList.length > 1 ? rotList.map(s => `<i class="${s === sp ? "on" : ""}"></i>`).join("") : "";
    const all = recs(sp);
    const live = all.filter(r => r.st === "live").sort((x, y) => String(x.ct).localeCompare(String(y.ct), undefined, { numeric: true }) || byNo(x, y)).slice(0, 6);
    const next = all.filter(r => r.st === "scheduled").sort(byNo);
    const done = all.filter(r => r.st === "done").sort((x, y) => (y.t || 0) - (x.t || 0));
    main.className = "";
    let left;
    if (live.length) {
      const n = live.length, cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
      const sz = cols === 1 ? "--nm:3.6vw;--big:7vw" : cols === 2 ? "--nm:2.2vw;--big:3.8vw" : "--nm:1.6vw;--big:2.7vw";
      left = `<h2><span class="live">LIVE</span> ${esc(SP.name)}</h2><div class="grid" style="--cols:${cols};${sz}">${live.map(cardHTML).join("")}</div>`;
    } else if (next.length) {
      left = `<h2>Up next · ${esc(SP.name)}</h2><div class="grid" style="--cols:2;--nm:1.9vw;--big:3vw">${next.slice(0, 6).map(cardHTML).join("")}</div>`;
    } else if (done.length) {
      left = `<h2>Results · ${esc(SP.name)}</h2><div class="grid" style="--cols:2;--nm:1.9vw;--big:3.2vw">${done.slice(0, 6).map(cardHTML).join("")}</div>`;
    } else {
      left = `<h2>${esc(SP.name)}</h2><div class="empty">Matches will appear here soon.</div>`;
    }
    const right = `<h2>Up next</h2>${listHTML(next.slice(live.length ? 0 : 6, (live.length ? 0 : 6) + 6), "next")}
      <h2>Latest results</h2>${listHTML(done.slice(0, 6), "done")}`;
    main.innerHTML = `<div class="col">${left}</div><div class="col">${right}</div>`;
  }
  renderTicker();
  renderAnn();
  tick();
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
  for (const el of document.querySelectorAll(".clk")) {
    const ms = clockMs({ run: el.dataset.run === "1", st: Number(el.dataset.st), el: Number(el.dataset.el) }, C.now());
    const left = Number(el.dataset.len) - ms;
    el.textContent = left >= 0 ? mmss(left) : "+" + mmss(-left);
  }
}
setInterval(() => {
  tick();
  renderAnn();
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
  const cols = list.length <= 2 ? list.length : list.length <= 4 ? 2 : 3;
  main.innerHTML = `<div class="aw-wrap"><h2 class="aw-title cond">Champions · ${esc(settings.event || EVENT_DEFAULTS.name)}</h2>
    <div class="aw-grid" style="--cols:${cols}">` + list.map((a, n) => `
    <div class="aw-card" style="--c:${esc(a.color || "#B3162D")};animation-delay:${n * 90}ms">
      <div class="aw-cat cond">${esc(a.label)}</div>
      ${a.p.map((name, i) => name ? `<div class="aw-row p${i + 1}"><span class="aw-m">${i + 1}</span><span class="aw-n">${esc(name)}</span></div>` : "").join("")}
    </div>`).join("") + `</div></div>`;
}
