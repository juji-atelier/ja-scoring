// Public live-score page. Uses plain HTTPS polling (no live connection),
// so hundreds of spectators stay inside Firebase's free limits.
import { firebaseConfig, SPORTS, EVENT_DEFAULTS } from "../config.js?v=20261113z";
import { applySportInfo, boardTabName } from "../js/sportinfo.js?v=20261113z";
import { standings, clockMs, mmss, catColor } from "../js/engines.js?v=20261113z";
import { renderSportGrid, sportItems, fetchLiveCounts } from "../js/sportnav.js?v=20261113z";
import { cfgOf, shown, isDone, KEEP } from "../js/livecfg.js?v=20261113z";
import { bracketHTML, hasBracket } from "../js/bracket.js?v=20261113z";

const FAST_MS = 5000;     // live matches: small live-only list (pub/<sport>/live)
const QUIET_MS = 8000;    // nothing live: the live list is empty, so this costs almost nothing
const FULL_MS = 60000;    // whole sport (results, schedule, announcement)
const BASE = String(firebaseConfig.databaseURL || "").replace(/\/$/, "");
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let sport = Object.keys(SPORTS)[0];   // chosen once the live-score settings are read (see the end of this file)
let sub = "live";
let data = {};          // records for current sport
let settings = {};
let lastOk = 0, timer = null, clockSkew = 0;
let ann = null;   // scorer announcement for the current sport
let cfg = { show: {}, done: {} };   // Admin → Live score: which sports are shown / completed
let kept = false;                   // showing the kept (completed) copy of this sport
// find / follow a team (follow is remembered on this phone, per sport)
let q = "";
const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
const followed = () => lsGet("ja_follow_" + sport);
const onlyMine = () => lsGet("ja_only_" + sport) === "1";

// sports Admin has switched on for the live-score page
const visible = () => Object.keys(SPORTS).filter(id => shown(cfg, id));
function pickDefault() {
  const vis = visible();
  const h = location.hash.slice(1);
  if (SPORTS[h] && vis.includes(h)) return h;
  const today = String(new Date().getDate());
  const s = vis.find(id => SPORTS[id].day.split(" ").includes(today));
  return s || vis[0] || Object.keys(SPORTS)[0];
}
// no normal sport switched on: go to bowling / Mobile Legends if one of those is on
function noSportsLeft() {
  if (visible().length) return false;
  if (shown(cfg, "mlbb")) location.replace("../mlbb.html");
  else if (shown(cfg, "bowling")) location.replace("../bowling.html");
  else { $("#tabs").innerHTML = ""; $("#body").innerHTML = `<div class="empty">No live scores at the moment. Please check again later.</div>`; setTimeout(() => location.reload(), 60000); }
  return true;
}
function switchSport(id) { sport = id; data = {}; ann = null; kept = false; q = ""; $("#find").value = ""; fullAt = 0; seenBig = {}; renderTabs(); renderHeader(); render(); poll(); }

let liveCounts = {};
function renderTabs() {
  const counts = { ...liveCounts, [sport]: list().filter(r => r.st === "live").length };
  renderSportGrid($("#tabs"), sportItems(SPORTS, id => id === "bowling" ? "../bowling.html" : id === "mlbb" ? "../mlbb.html" : "#" + id,
    { bowling: boardTabName(settings.sportInfo, "bowling"), mlbb: boardTabName(settings.sportInfo, "mlbb") }, counts, cfg), sport);
  document.documentElement.style.setProperty("--sport", SPORTS[sport].color);
}

window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (SPORTS[h] && shown(cfg, h)) switchSport(h);
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

let settingsAt = 0, fullAt = 0, countsAt = 0;
async function poll() {
  clearTimeout(timer);
  if (document.hidden) return;
  const want = sport;
  try {
    const liveBefore = list().filter(r => r.st === "live").map(r => r.id);
    if (isDone(cfg, want)) {
      // completed in Admin: show the kept final results (nothing live to follow)
      if (Date.now() - fullAt > FULL_MS) {
        const k = await getJSON(`pub/${KEEP}/${want}`);
        const p = k && k.d ? null : ((await getJSON(`pub/${want}`)) || {});   // no kept copy yet → the normal results
        if (want === sport) { data = (k && k.d ? k.d.m : p.m) || {}; ann = null; kept = !!(k && k.d); fullAt = Date.now(); }
      }
    } else if (Date.now() - fullAt > FULL_MS) {
      const p = (await getJSON(`pub/${want}`)) || {};
      if (want === sport) { data = p.m || {}; ann = p.ann || null; kept = false; fullAt = Date.now(); }
    } else {
      // only the matches being played right now (a few hundred bytes each)
      const lv = (await getJSON(`pub/${want}/live`)) || {};
      if (want === sport) {
        for (const [id, rec] of Object.entries(lv)) data[id] = rec;
        // a match left the live list → it just finished (or was reset): fetch everything now
        if (liveBefore.some(id => !lv[id])) { const p = (await getJSON(`pub/${want}`)) || {}; data = p.m || {}; ann = p.ann || null; fullAt = Date.now(); }
      }
    }
    if (want === sport) { lastOk = Date.now(); render(); }
    if (Date.now() - settingsAt > 60000) {
      await loadSettings();
      if (noSportsLeft()) return;
      if (!shown(cfg, sport)) { location.hash = ""; switchSport(pickDefault()); return; }
    }
    if (Date.now() - countsAt > 60000) { countsAt = Date.now(); liveCounts = await fetchLiveCounts(BASE, Object.keys(SPORTS), cfg); }
    renderTabs();
  } catch (e) {
    $("#upd").textContent = "Connection problem – retrying…";
  }
  timer = setTimeout(poll, list().some(r => r.st === "live") ? FAST_MS : QUIET_MS);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

async function loadSettings() {
  settings = (await getJSON("settings")) || {};
  settingsAt = Date.now();
  applySportInfo(settings.sportInfo);
  const was = JSON.stringify(cfg);
  cfg = cfgOf(settings);
  if (JSON.stringify(cfg) !== was) { fullAt = 0; countsAt = 0; }   // completed / shown changed: reload this sport
  renderHeader();
}

function renderHeader() {
  $("#ev").textContent = settings.event || EVENT_DEFAULTS.name;
  document.title = (settings.event || EVENT_DEFAULTS.name) + " · Live Scores";
  // the selected sport's own day and venue (set in Admin → Sport names, dates & venues)
  const sp = SPORTS[sport] || {};
  $("#venue").textContent = `📍 ${sp.venue || settings.venue || EVENT_DEFAULTS.venue}${sp.day ? " · " + sp.day : ""}`;
  const n = $("#note");
  n.hidden = !settings.ticker;
  n.textContent = settings.ticker || "";
}

const list = () => Object.entries(data).map(([id, r]) => ({ id, ...r }));
const byNo = (x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999);
// in the order things will actually be played: start time, then court/table, then number
const tMin = s => { const m = String(s || "").trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
  if (!m) return 1e9; let h = +m[1]; if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; } return h * 60 + +(m[2] || 0); };
const byPlay = (x, y) => tMin(x.tm) - tMin(y.tm) || (Number(x.ct) || 99) - (Number(y.ct) || 99) || byNo(x, y);

const low = x => String(x || "").toLowerCase();
const isMe = name => !!followed() && low(name) === low(followed());
function mark(txt) {
  const t = esc(txt); if (!q) return t;
  const i = low(txt).indexOf(q); if (i < 0) return t;
  return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + q.length)) + "</mark>" + esc(txt.slice(i + q.length));
}
// spelled out for the people in the hall: "Table 1", not "T1"
const courtWord = () => (SPORTS[sport] && SPORTS[sport].court) || "Court";
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

// point flash: remember the last big score of each live match; a change lights the card up for a moment
let seenBig = {}; const flashAt = {};
function noteScores() {
  const now = Date.now();
  for (const r of list()) {
    if (r.st !== "live") continue;
    const b = ((r.v || {}).big || []).map(Number), was = seenBig[r.id];
    if (was) for (const [k, i] of [["a", 0], ["b", 1]]) if (b[i] > was[i]) flashAt[r.id] = { at: now, side: k };
    seenBig[r.id] = b;
  }
}
const cats = () => list().map(r => r.ev || "");
function row(r, s, lead, tagOn = true) {
  const i = s === "a" ? 0 : 1, v = r.v || {};
  const done = r.st === "done", sched = r.st === "scheduled";
  const big = sched ? "" : done ? (r.wo ? (r.w === s ? "W/O" : "") : (r.sc || [])[i]) : (v.big || [])[i];
  const small = !sched && !done && v.small ? v.small[i] : "";
  const tag = tagOn && r.st === "live" ? (s === "a" ? v.tagA : v.tagB) : "";
  const fl = flashAt[r.id] && flashAt[r.id].side === s && Date.now() - flashAt[r.id].at < 3000;
  return `<div class="r ${done && r.w === s ? "win" : ""} ${lead === s ? "lead" : ""}"><span class="dot ${r.st === "live" && v.srv === s ? "on" : ""}"></span>
    <span class="n ${isMe(r[s]) ? "me" : ""}">${mark(r[s])}${tag ? `<span class="tag">${esc(tag)}</span>` : ""}${r["p" + s] ? `<span class="pl">${esc(r["p" + s])}</span>` : ""}</span>
    <span class="s">${small ?? ""}</span><span class="b cond">${fl ? `<i class="plus1">+1</i>` : ""}${big ?? ""}</span></div>`;
}
// Up next, compact: one heading per start time, the matches of that time side by side (one per
// court/table), each just the two names. Big cards with a 0-0 line said little and took a screen
// each; this fits a whole day without a "+ more".
function nextHTML(list) {
  // the category only when this sport really has more than one (cats() lists one entry per match)
  const many = new Set(cats().filter(Boolean)).size > 1;
  let out = "", last = null, open = false;
  for (const r of [...list].sort(byPlay)) {
    const k = r.tm || "";
    if (k !== last) {
      if (open) out += "</div></div>";
      out += `<div class="nxg"><div class="nxh">${esc(k || "Time to be confirmed")}</div><div class="nxl">`;
      last = k; open = true;
    }
    const rd = r.rd && !/^group stage$/i.test(r.rd) ? r.rd : "";
    const tag = [many ? r.ev : "", rd].filter(Boolean).join(" \u00b7 ");
    const cc = r.ev ? `--cc:${catColor(r.ev, cats())}` : "";
    // court and pool on a top line, so the two names get the whole width of the box
    out += `<div class="nx ${isMe(r.a) || isMe(r.b) ? "me" : ""}" style="${cc}">
      <div class="nh">${r.ct ? `<span class="ctb">${esc(courtWord())} ${esc(r.ct)}</span>` : ""}${tag ? `<span class="nr">${esc(tag)}</span>` : ""}</div>
      <div class="nt"><span>${isMe(r.a) ? "\u2605 " : ""}${mark(r.a)}</span><i>vs</i><span>${isMe(r.b) ? "\u2605 " : ""}${mark(r.b)}</span></div></div>`;
  }
  return out + (open ? "</div></div>" : "");
}

function card(r) {
  const v = r.v || {};
  let st = r.st === "live" ? esc(v.stx || "Live") : r.st === "done" ? "Final" : esc(r.tm || "");
  if (r.st === "live" && v.clock) st += ` · <span class="clk" data-c='${esc(JSON.stringify(v.clock))}'>--:--</span>`;
  const pt = r.st === "live" ? (v.tagA || v.tagB || "") : "";
  const rd = r.rd && !/^group stage$/i.test(r.rd) ? r.rd : "";
  let lead = "";
  if (r.st === "live" && v.big) { const [x, y] = v.big.map(Number); lead = x > y ? "a" : y > x ? "b" : ""; }
  const fl = flashAt[r.id] && Date.now() - flashAt[r.id].at < 3000;
  const cc = r.ev ? `--cc:${catColor(r.ev, cats())};--ccd:${catColor(r.ev, cats(), true)}` : "";
  return `<div class="m ${r.st === "live" ? "live" : ""} ${fl ? "flash" : ""} ${r.ev ? "hascat" : ""}" style="${cc}"><div class="meta">${r.ct ? `<span class="ctb">${esc(courtWord())} ${esc(r.ct)}</span>` : ""}${r.ev ? `<span class="evc">${esc(r.ev)}</span>` : ""}${rd ? `<span>${esc(rd)}</span>` : ""}${pt ? `<span class="ptb">${esc(pt)}</span>` : ""}<span class="st">${st}</span></div>
    ${row(r, "a", lead, false)}${row(r, "b", lead, false)}${v.hist ? `<div class="h">${esc(v.hist)}</div>` : ""}${events(r)}</div>`;
}
// 🏆 a result from the last 10 minutes
function finCard(r) {
  const sc = r.wo ? "by walkover" : `${(r.sc || [])[0]}–${(r.sc || [])[1]}`;
  const head = r.w ? `🏆 ${esc(r.w === "a" ? r.a : r.b)} wins ${r.wo ? "(walkover)" : r.w === "a" ? sc : `${(r.sc || [])[1]}–${(r.sc || [])[0]}`}` : `Draw ${sc}`;
  const v = r.v || {};
  return `<div class="fin"><div class="bn">${head}</div><div class="bd"><b>${esc(r.a)}</b> vs <b>${esc(r.b)}</b>${v.hist ? " · " + esc(v.hist) : ""}${r.ev ? " · " + esc(r.ev) : ""}${r.ct ? " · " + esc(courtWord()) + " " + esc(r.ct) : ""}</div></div>`;
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
  noteScores();
  renderFind();
  // which matches to show: search first, then "only my team"
  const keep = r => q ? (low(r.a).includes(q) || low(r.b).includes(q) || low(r.as).includes(q) || low(r.bs).includes(q) || low(r.pa).includes(q) || low(r.pb).includes(q)) : onlyMine() && followed() ? (isMe(r.a) || isMe(r.b)) : true;
  const all = list().filter(keep);
  // the Bracket tab is there only for a sport that has knockout matches
  const hasKO = hasBracket(list());
  $("#subBracket").hidden = !hasKO;
  if (sub === "bracket" && !hasKO) { sub = "live"; document.querySelectorAll("#sub button").forEach(x => x.classList.toggle("on", x.dataset.v === "live")); }
  const live = all.filter(r => r.st === "live").sort((x, y) => String(x.ct).localeCompare(String(y.ct), undefined, { numeric: true }));
  const next = all.filter(r => r.st === "scheduled").sort(byNo);
  const done = all.filter(r => r.st === "done").sort((x, y) => (y.t || 0) - (x.t || 0));
  let h = "";
  if (!all.length) h = q || (onlyMine() && followed()) ? `<div class="empty">No matches for ${q ? "“" + esc(q) + "”" : esc(followed())}.</div>`
    : `<div class="empty">No matches published yet for ${esc(SPORTS[sport].name)}.</div>`;
  else if (sub === "bracket") {
    // always the whole bracket, whatever is typed in the search box: the followed team is starred in it
    h += bracketHTML(list(), { esc, courtWord: courtWord(), isMe });
  } else if (sub === "live" && isDone(cfg, sport)) {
    h += `<h2>Final results</h2>` + (done.length ? done.map(card).join("") : `<div class="empty">No results.</div>`);
  } else if (sub === "live") {
    h += `<h2>${live.length ? '<span class="lv">LIVE</span>' : ""} Now playing</h2>` + (live.length ? live.map(card).join("") : `<div class="empty">No match in progress.</div>`);
    const nowS = Date.now() + clockSkew;
    const fresh = done.filter(r => r.t && nowS - r.t < 10 * 60000).slice(0, 3);
    if (fresh.length) h += `<h2>Just finished</h2>` + fresh.map(finCard).join("");
    h += `<h2>Up next</h2>` + (next.length ? nextHTML(next) : `<div class="empty">No more scheduled matches.</div>`);
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
  if (isDone(cfg, sport)) h = `<div class="donebar">✅ <b>${esc(SPORTS[sport].name)} completed</b> · final results</div>` + h;
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
    const lv = list().some(r => r.st === "live");
    $("#upd").innerHTML = (lv ? `<i class="ldot"></i>Live · updates every ${FAST_MS / 1000} s · ` : at ? `Last score ${at} · ` : "") + "checked " + (s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`);
  }
}
setInterval(tick, 1000);

if (!BASE || BASE.includes("PASTE")) {
  $("#body").innerHTML = `<div class="empty">Setup needed: paste the Firebase config into config.js.</div>`;
} else {
  // read Admin's live-score settings first, so hidden sports never flash up
  (async () => {
    try { await loadSettings(); } catch (e) { /* page still works with everything shown */ }
    if (noSportsLeft()) return;
    sport = pickDefault();
    renderTabs(); renderHeader(); poll();
  })();
}
