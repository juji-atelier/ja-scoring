// Public live-score page. Uses plain HTTPS polling (no live connection),
// so hundreds of spectators stay inside Firebase's free limits.
import { firebaseConfig, SPORTS, EVENT_DEFAULTS } from "../config.js?v=20261112e";
import { applySportInfo, boardTabName } from "../js/sportinfo.js?v=20261112e";
import { standings, clockMs, mmss } from "../js/engines.js?v=20261112e";

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
// find / follow a team (follow is remembered on this phone, per sport)
let q = "";
const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
const followed = () => lsGet("ja_follow_" + sport);
const onlyMine = () => lsGet("ja_only_" + sport) === "1";

function pickDefault() {
  const h = location.hash.slice(1);
  if (SPORTS[h]) return h;
  const today = String(new Date().getDate());
  const s = Object.entries(SPORTS).find(([, v]) => v.day.split(" ").includes(today));
  return s ? s[0] : Object.keys(SPORTS)[0];
}

function renderTabs() {
  $("#tabs").innerHTML = Object.entries(SPORTS).map(([id, s]) =>
    `<a href="#${id}" class="${id === sport ? "on" : ""}" style="--c:${s.color}">${esc(s.name)}<small>${esc(s.day)}</small></a>`).join("") + `<a href="../bowling.html" style="--c:#8b5cf6">${esc(boardTabName(settings.sportInfo, "bowling"))}<small>Sabah Electricity Bowling</small></a><a href="../mlbb.html" style="--c:#f59e0b">${esc(boardTabName(settings.sportInfo, "mlbb"))}<small>E-Sport HQ Championship</small></a>`;
  document.documentElement.style.setProperty("--sport", SPORTS[sport].color);
  const on = $("#tabs .on");
  if (on) on.scrollIntoView({ inline: "center", block: "nearest" });
}

window.addEventListener("hashchange", () => {
  if (SPORTS[location.hash.slice(1)]) { sport = location.hash.slice(1); data = {}; ann = null; q = ""; $("#find").value = ""; renderTabs(); render(); poll(); }
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
      const tabsWere = $("#tabs").textContent; applySportInfo(settings.sportInfo); renderTabs(); if ($("#tabs").textContent !== tabsWere) render();
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

const low = x => String(x || "").toLowerCase();
const isMe = name => !!followed() && low(name) === low(followed());
function mark(txt) {
  const t = esc(txt); if (!q) return t;
  const i = low(txt).indexOf(q); if (i < 0) return t;
  return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + q.length)) + "</mark>" + esc(txt.slice(i + q.length));
}
const teamNames = () => [...new Set(list().flatMap(r => [r.a, r.b]).filter(n => n && n !== "TBC"))].sort((x, y) => x.localeCompare(y));
// short names (e.g. "JKR") from the published matches, so either can be searched
const shortOf = () => { const o = {}; list().forEach(r => { if (r.as) o[r.a] = r.as; if (r.bs) o[r.b] = r.bs; }); return o; };
const teamHit = (name, sh) => !!q && (low(name).includes(q) || low(sh[name]).includes(q));

// 🏆 champion: a confirmed match whose round is "Final" (not semi / quarter); 3rd place from a "3rd place" match
function champions() {
  const all = list().filter(r => r.st === "done" && r.w);
  const isFinal = r => /\bfinal\b/i.test(r.rd || "") && !/semi|quarter|suku|separuh/i.test(r.rd || "");
  const isThird = r => /3rd|third|bronze|tempat ke-?3/i.test(r.rd || "");
  const evs = [...new Set(all.filter(isFinal).map(r => r.ev || ""))];
  return evs.map(ev => {
    const f = all.find(r => isFinal(r) && !isThird(r) && (r.ev || "") === ev);
    if (!f) return null;
    const t = all.find(r => isThird(r) && (r.ev || "") === ev);
    const lose = r => (r.w === "a" ? r.b : r.a);
    return { ev, champ: f.w === "a" ? f.a : f.b, runner: lose(f), third: t ? (t.w === "a" ? t.a : t.b) : "" };
  }).filter(Boolean);
}

function row(r, s) {
  const i = s === "a" ? 0 : 1, v = r.v || {};
  const done = r.st === "done", sched = r.st === "scheduled";
  const big = sched ? "" : done ? (r.wo ? (r.w === s ? "W/O" : "") : (r.sc || [])[i]) : (v.big || [])[i];
  const small = !sched && !done && v.small ? v.small[i] : "";
  const tag = r.st === "live" ? (s === "a" ? v.tagA : v.tagB) : "";
  return `<div class="r ${done && r.w === s ? "win" : ""}"><span class="dot ${r.st === "live" && v.srv === s ? "on" : ""}"></span>
    <span class="n ${isMe(r[s]) ? "me" : ""}">${mark(r[s])}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}${r["p" + s] ? `<span class="pl">${esc(r["p" + s])}</span>` : ""}</span>
    <span class="s">${small ?? ""}</span><span class="b cond">${big ?? ""}</span></div>`;
}
function card(r) {
  const v = r.v || {};
  let st = r.st === "live" ? esc(v.stx || "Live") : r.st === "done" ? "Final" : esc(r.tm || "");
  if (r.st === "live" && v.clock) st += ` · <span class="clk" data-c='${esc(JSON.stringify(v.clock))}'>--:--</span>`;
  return `<div class="m ${r.st === "live" ? "live" : ""}"><div class="meta">${r.ct ? `<span>Court ${esc(r.ct)}</span>` : ""}${r.rd ? `<span>${esc(r.rd)}</span>` : ""}${r.ev ? `<span>${esc(r.ev)}</span>` : ""}<span class="st">${st}</span></div>
    ${row(r, "a")}${row(r, "b")}${v.hist ? `<div class="h">${esc(v.hist)}</div>` : ""}${events(r)}</div>`;
}
// goal scorers and cards under a match (only when the scorer recorded them)
const ICON = { g: "⚽", og: "⚽", y: "🟨", r: "🟥" };
function events(r) {
  const tl = (Array.isArray(r.tl) ? r.tl : Object.values(r.tl || {})).filter(e => e && (e.n || e.k !== "g"));
  if (!tl.length) return "";
  const col = s => tl.filter(e => e.s === s).map(e =>
    `<span>${ICON[e.k] || ""} ${e.k === "og" ? "Own goal" + (e.n ? " (" + esc(e.n) + ")" : "") : esc(e.n) || (e.k === "r" ? "Red card" : "Yellow card")}${e.m ? ` <i>${e.m}'</i>` : ""}</span>`).join("");
  return `<div class="evs"><div>${col("a")}</div><div>${col("b")}</div></div>`;
}
function topScorers() {
  const t = {};
  for (const r of list()) for (const e of (Array.isArray(r.tl) ? r.tl : Object.values(r.tl || {}))) {
    if (!e || e.k !== "g" || !e.n) continue;
    const team = e.s === "a" ? r.a : r.b, k = low(e.n) + "|" + low(team);
    (t[k] = t[k] || { n: e.n, team, g: 0 }).g++;
  }
  return Object.values(t).sort((x, y) => y.g - x.g || x.n.localeCompare(y.n)).slice(0, 10);
}

function renderFind() {
  const names = teamNames();
  const sh = shortOf();
  const hits = q ? names.filter(n => teamHit(n, sh)) : [];
  $("#findHits").innerHTML = hits.slice(0, 10).map(n => `<button data-follow="${esc(n)}" class="${isMe(n) ? "on" : ""}">${isMe(n) ? "★ Following" : "☆ Follow"} ${esc(n)}${sh[n] ? ` (${esc(sh[n])})` : ""}</button>`).join("");
  $("#findN").textContent = q ? (hits.length ? `${hits.length} team${hits.length > 1 ? "s" : ""}` : "no team found") : "";
  const f = followed();
  $("#followBar").innerHTML = f ? `<div class="fbar">⭐ <b>Following ${esc(f)}</b>
    <button data-only class="${onlyMine() ? "on" : ""}">${onlyMine() ? "✓ " : ""}Only their matches</button><button data-unfollow>Unfollow</button></div>` : "";
}
document.addEventListener("click", e => {
  const f = e.target.closest("[data-follow]"), o = e.target.closest("[data-only]"), u = e.target.closest("[data-unfollow]");
  if (f) { const n = f.dataset.follow; lsSet("ja_follow_" + sport, isMe(n) ? "" : n); if (!isMe(n)) lsSet("ja_only_" + sport, ""); else lsSet("ja_only_" + sport, "1"); q = ""; $("#find").value = ""; render(); }
  if (o) { lsSet("ja_only_" + sport, onlyMine() ? "" : "1"); render(); }
  if (u) { lsSet("ja_follow_" + sport, ""); lsSet("ja_only_" + sport, ""); render(); }
});
$("#find").addEventListener("input", e => { q = low(e.target.value.trim()); render(); });

function render() {
  renderFind();
  // which matches to show: search first, then "only my team"
  const keep = r => q ? (low(r.a).includes(q) || low(r.b).includes(q) || low(r.as).includes(q) || low(r.bs).includes(q) || low(r.pa).includes(q) || low(r.pb).includes(q)) : onlyMine() && followed() ? (isMe(r.a) || isMe(r.b)) : true;
  const all = list().filter(keep);
  const live = all.filter(r => r.st === "live").sort((x, y) => String(x.ct).localeCompare(String(y.ct), undefined, { numeric: true }));
  const next = all.filter(r => r.st === "scheduled").sort(byNo);
  const done = all.filter(r => r.st === "done").sort((x, y) => (y.t || 0) - (x.t || 0));
  let h = "";
  if (!all.length) h = q || (onlyMine() && followed()) ? `<div class="empty">No matches for ${q ? "“" + esc(q) + "”" : esc(followed())}.</div>`
    : `<div class="empty">No matches published yet for ${esc(SPORTS[sport].name)}.</div>`;
  else if (sub === "live") {
    h += `<h2>${live.length ? '<span class="lv">LIVE</span>' : ""} Now playing</h2>` + (live.length ? live.map(card).join("") : `<div class="empty">No match in progress.</div>`);
    h += `<h2>Up next</h2>` + (next.length ? next.slice(0, 12).map(card).join("") : `<div class="empty">No more scheduled matches.</div>`);
    if (next.length > 12) h += `<div class="empty">+ ${next.length - 12} more</div>`;
  } else if (sub === "results") {
    h += `<h2>Results</h2>` + (done.length ? done.map(card).join("") : `<div class="empty">No results yet.</div>`);
  } else {
    const tbl = standings(data);
    const gs = Object.keys(tbl).sort();
    const ts = topScorers();
    if (!gs.length && !ts.length) h += `<div class="empty">No group stage for this sport.</div>`;
    for (const g of gs) {
      h += `<h2>Group ${esc(g)}</h2><table><tr><th class="t">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>+/−</th><th>Pts</th></tr>` +
        tbl[g].map(t => `<tr class="${isMe(t.team) ? "me" : ""}"><td class="t">${isMe(t.team) ? "★ " : ""}${mark(t.team)}</td><td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.f - t.a > 0 ? "+" : ""}${t.f - t.a}</td><td><b>${t.pts}</b></td></tr>`).join("") + `</table>`;
    }
    if (gs.length) h += `<p class="empty">Win 3 · Draw 1 · Loss 0. Ties: head-to-head result first, then score difference.</p>`;
    if (ts.length) h += `<h2>⚽ Top scorers</h2><table><tr><th class="t">Player</th><th class="t">Team</th><th>Goals</th></tr>` +
      ts.map(x => `<tr class="${isMe(x.team) ? "me" : ""}"><td class="t"><b>${esc(x.n)}</b></td><td class="t">${esc(x.team)}</td><td><b>${x.g}</b></td></tr>`).join("") + `</table>`;
  }
  const champs = champions();
  if (champs.length) h = champs.map(c => `<div class="champ"><div class="k">🏆 ${esc(SPORTS[sport].name)}${c.ev ? " · " + esc(c.ev) : ""} · Champion</div>
    <div class="w">${esc(c.champ)}</div><div class="o"><span>🥈 Runner-up: ${esc(c.runner)}</span>${c.third ? `<span>🥉 3rd: ${esc(c.third)}</span>` : ""}</div></div>`).join("") + h;
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
    const lastT = Math.max(0, ...list().map(r => Number(r.t) || 0));
    const at = lastT ? new Date(lastT).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" }) : "";
    $("#upd").textContent = (at ? `Last score ${at} · ` : "") + "checked " + (s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`);
  }
}
setInterval(tick, 1000);

if (!BASE || BASE.includes("PASTE")) {
  $("#body").innerHTML = `<div class="empty">Setup needed: paste the Firebase config into config.js.</div>`;
} else {
  renderTabs(); renderHeader(); poll();
}
