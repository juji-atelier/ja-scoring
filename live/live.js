// Public live-score page. Uses plain HTTPS polling (no live connection),
// so hundreds of spectators stay inside Firebase's free limits.
import { firebaseConfig, SPORTS, EVENT_DEFAULTS } from "../config.js";
import { standings, clockMs, mmss } from "../js/engines.js";

const POLL_MS = 12000;
const BASE = String(firebaseConfig.databaseURL || "").replace(/\/$/, "");
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let sport = pickDefault();
let sub = "live";
let data = {};          // records for current sport
let settings = {};
let lastOk = 0, timer = null, clockSkew = 0;
let ann = null;   // scorer announcement for the current sport

function pickDefault() {
  const h = location.hash.slice(1);
  if (SPORTS[h]) return h;
  const today = String(new Date().getDate());
  const s = Object.entries(SPORTS).find(([, v]) => v.day.split(" ").includes(today));
  return s ? s[0] : Object.keys(SPORTS)[0];
}

function renderTabs() {
  $("#tabs").innerHTML = Object.entries(SPORTS).map(([id, s]) =>
    `<a href="#${id}" class="${id === sport ? "on" : ""}" style="--c:${s.color}">${esc(s.name)}<small>${esc(s.day)}</small></a>`).join("") + `<a href="../bowling.html" style="--c:#8b5cf6">Bowling<small>SESB Bowling</small></a>`;
  document.documentElement.style.setProperty("--sport", SPORTS[sport].color);
  const on = $("#tabs .on");
  if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
}

window.addEventListener("hashchange", () => {
  if (SPORTS[location.hash.slice(1)]) { sport = location.hash.slice(1); data = {}; ann = null; renderTabs(); render(); poll(); }
});
document.querySelectorAll("#sub button").forEach(b => b.onclick = () => {
  sub = b.dataset.v;
  document.querySelectorAll("#sub button").forEach(x => x.classList.toggle("on", x === b));
  render();
});

async function getJSON(path) {
  const r = await fetch(`${BASE}/${path}.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  const d = r.headers.get("date");
  if (d) clockSkew = new Date(d).getTime() - Date.now();
  return r.json();
}

let settingsAt = 0;
async function poll() {
  clearTimeout(timer);
  if (document.hidden) return;
  try {
    const want = sport;
    const p = (await getJSON(`pub/${want}`)) || {};
    if (want === sport) { data = p.m || {}; ann = p.ann || null; lastOk = Date.now(); render(); }
    if (Date.now() - settingsAt > 60000) {
      settings = (await getJSON("settings")) || {};
      settingsAt = Date.now();
      renderHeader();
    }
  } catch (e) {
    $("#upd").textContent = "Connection problem – retrying…";
  }
  timer = setTimeout(poll, POLL_MS);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

function renderHeader() {
  $("#ev").textContent = settings.event || EVENT_DEFAULTS.name;
  document.title = (settings.event || EVENT_DEFAULTS.name) + " · Live Scores";
  $("#venue").textContent = settings.venue || EVENT_DEFAULTS.venue;
  const n = $("#note");
  n.hidden = !settings.ticker;
  n.textContent = settings.ticker || "";
}

const list = () => Object.entries(data).map(([id, r]) => ({ id, ...r }));
const byNo = (x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999);

function row(r, s) {
  const i = s === "a" ? 0 : 1, v = r.v || {};
  const done = r.st === "done", sched = r.st === "scheduled";
  const big = sched ? "" : done ? (r.wo ? (r.w === s ? "W/O" : "") : (r.sc || [])[i]) : (v.big || [])[i];
  const small = !sched && !done && v.small ? v.small[i] : "";
  const tag = r.st === "live" ? (s === "a" ? v.tagA : v.tagB) : "";
  return `<div class="r ${done && r.w === s ? "win" : ""}"><span class="dot ${r.st === "live" && v.srv === s ? "on" : ""}"></span>
    <span class="n">${esc(r[s])}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</span>
    <span class="s">${small ?? ""}</span><span class="b cond">${big ?? ""}</span></div>`;
}
function card(r) {
  const v = r.v || {};
  let st = r.st === "live" ? esc(v.stx || "Live") : r.st === "done" ? "Final" : esc(r.tm || "");
  if (r.st === "live" && v.clock) st += ` · <span class="clk" data-c='${esc(JSON.stringify(v.clock))}'>--:--</span>`;
  return `<div class="m ${r.st === "live" ? "live" : ""}"><div class="meta">${r.ct ? `<span>Court ${esc(r.ct)}</span>` : ""}${r.rd ? `<span>${esc(r.rd)}</span>` : ""}${r.ev ? `<span>${esc(r.ev)}</span>` : ""}<span class="st">${st}</span></div>
    ${row(r, "a")}${row(r, "b")}${v.hist ? `<div class="h">${esc(v.hist)}</div>` : ""}</div>`;
}

function render() {
  const all = list();
  const live = all.filter(r => r.st === "live").sort((x, y) => String(x.ct).localeCompare(String(y.ct), undefined, { numeric: true }));
  const next = all.filter(r => r.st === "scheduled").sort(byNo);
  const done = all.filter(r => r.st === "done").sort((x, y) => (y.t || 0) - (x.t || 0));
  let h = "";
  if (!all.length) h = `<div class="empty">No matches published yet for ${esc(SPORTS[sport].name)}.</div>`;
  else if (sub === "live") {
    h += `<h2>${live.length ? '<span class="lv">LIVE</span>' : ""} Now playing</h2>` + (live.length ? live.map(card).join("") : `<div class="empty">No match in progress.</div>`);
    h += `<h2>Up next</h2>` + (next.length ? next.slice(0, 12).map(card).join("") : `<div class="empty">No more scheduled matches.</div>`);
    if (next.length > 12) h += `<div class="empty">+ ${next.length - 12} more</div>`;
  } else if (sub === "results") {
    h += `<h2>Results</h2>` + (done.length ? done.map(card).join("") : `<div class="empty">No results yet.</div>`);
  } else {
    const tbl = standings(data);
    const gs = Object.keys(tbl).sort();
    if (!gs.length) h += `<div class="empty">No group stage for this sport.</div>`;
    for (const g of gs) {
      h += `<h2>Group ${esc(g)}</h2><table><tr><th class="t">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>+/−</th><th>Pts</th></tr>` +
        tbl[g].map(t => `<tr><td class="t">${esc(t.team)}</td><td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.f - t.a > 0 ? "+" : ""}${t.f - t.a}</td><td><b>${t.pts}</b></td></tr>`).join("") + `</table>`;
    }
    if (gs.length) h += `<p class="empty">Win 3 · Draw 1 · Loss 0. Ties split by score difference.</p>`;
  }
  const nowS = Date.now() + clockSkew;
  if (ann && ann.t && (!ann.exp || ann.exp > nowS)) {
    const at = ann.at ? new Date(ann.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    h = `<div class="ann"><span class="ai">📢</span><div><b>${esc(ann.t)}</b><small>${esc(SPORTS[sport].name)} announcement${at ? " · " + at : ""}</small></div></div>` + h;
  }
  $("#body").innerHTML = h;
  tick();
}

function tick() {
  const now = Date.now() + clockSkew;
  for (const el of document.querySelectorAll(".clk")) {
    try {
      const c = JSON.parse(el.dataset.c);
      const left = c.len - clockMs(c, now);
      el.textContent = left >= 0 ? mmss(left) : "+" + mmss(-left);
    } catch (e) { /* ignore */ }
  }
  if (lastOk) {
    const s = Math.round((Date.now() - lastOk) / 1000);
    $("#upd").textContent = s < 3 ? "Updated just now" : `Updated ${s}s ago`;
  }
}
setInterval(tick, 1000);

if (!BASE || BASE.includes("PASTE")) {
  $("#body").innerHTML = `<div class="empty">Setup needed: paste the Firebase config into config.js.</div>`;
} else {
  renderTabs(); renderHeader(); poll();
}
