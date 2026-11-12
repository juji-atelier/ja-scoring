import { SPORTS, ADMIN_EMAIL, EVENT_DEFAULTS } from "../config.js?v=20261112a";
import { publicRecord, standings, FORMATS, ENGINE_OF } from "../js/engines.js?v=20261112a";
import { bowlingStandings, BOWL_ROOT } from "../js/bowling-data.js?v=20261112a";
import { BOARDS, mlbbMatches, applyBoardInfo, boardBaseName } from "../js/boards.js?v=20261112a";
import { applySportInfo, SPORT_BASE } from "../js/sportinfo.js?v=20261112a";
import { firebaseConfig } from "../config.js?v=20261112a";
import * as C from "../js/common.js?v=20261112a";
const { $, $$, esc, toast, ref } = C;

if (!C.configured) { C.notConfiguredScreen(); throw new Error("not configured"); }
const db = C.db, auth = C.auth;
const BASE = new URL("../", location.href).href;
const PUBLIC_URL = BASE + "live/";

let pub = {}, settings = {}, started = false, logUnsub = null, raw = {}, bowl = null;
const boardData = {};   // board id → its data (see js/boards.js)
const nameOf = id => (SPORTS[id] || BOARDS[id] || {}).name || id;

// ---------------- auth
$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  $("#loginErr").textContent = "";
  try { await C.signInWithEmailAndPassword(auth, ADMIN_EMAIL, $("#inPw").value); $("#inPw").value = ""; }
  catch (err) { $("#loginErr").textContent = "Wrong password or account not set up."; }
};
$("#btnLogout").onclick = () => C.signOut(auth);
C.onAuthStateChanged(auth, u => {
  const ok = u && u.email === ADMIN_EMAIL;
  if (u && !ok) { alert("This is not the admin account."); C.signOut(auth); return; }
  $("#vLogin").classList.toggle("hide", !!ok);
  $("#vMain").classList.toggle("hide", !ok);
  $("#btnLogout").classList.toggle("hide", !ok);
  if (ok) start();
});
C.onValue(ref(db, ".info/connected"), s => $("#conn").classList.toggle("on", !!s.val()));

// ---------------- tabs
$$("#tabs button").forEach(b => b.onclick = () => {
  $$("#tabs button").forEach(x => x.classList.toggle("on", x === b));
  for (const t of ["ov", "screen", "links", "tools", "fb"]) $("#t-" + t).classList.toggle("hide", t !== b.dataset.t);
});

function start() {
  if (started) return;
  started = true;
  C.onValue(ref(db, "pub"), s => { pub = s.val() || {}; renderOverview(); fillMatchSelect(); });
  // raw scorer data (start/update times) for the health check, and bowling for its card
  C.onValue(ref(db, "sports"), s => { raw = s.val() || {}; renderOverview(); }, () => {});
  for (const [id, b] of Object.entries(BOARDS)) watchBoard(id, b);
  setInterval(renderOverview, 30000);
  C.onValue(ref(db, "settings"), s => {
    settings = s.val() || {};
    // sport names / dates / venues edited below are used everywhere on this page
    const sc = applySportInfo(settings.sportInfo), bc = applyBoardInfo(settings.sportInfo);
    if (sc || bc) { fillSportSelects(); renderLinks(); renderOverview(); fillMatchSelect(); }
    fillScreenForm();
  });
  renderLinks();
  fillSportSelects();
  startFeedback();
  $("#logSport").onchange = startLog;
  startLog();
}

function fillSportSelects() {
  const keep = id => { const el = $("#" + id), v = el.value; return () => { if (v) el.value = v; }; };
  const back = ["sSport", "clrSport", "logSport"].map(keep);
  const opts = Object.entries(SPORTS).map(([id, s]) => `<option value="${id}">${esc(s.name)}</option>`).join("");
  const bopt = f => Object.entries(BOARDS).filter(([, b]) => f(b)).map(([id, b]) => `<option value="${id}">${esc(b.name)}</option>`).join("");
  $("#sSport").innerHTML = opts + bopt(() => true);   // bowling / Mobile Legends can be pinned too
  $("#clrSport").innerHTML = opts;
  $("#logSport").innerHTML = opts + bopt(b => b.log);
  back.forEach(f => f());
}

// ---------------- overview
const recs = sp => Object.entries((pub[sp] && pub[sp].m) || {}).map(([id, r]) => ({ id, ...r }));
// ---- health check helpers
const ago = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m"; };
const EXPECT = { rally: 60, goals: null, darts: 60 };   // minutes a match normally takes (goals: from the format)
function expectedMin(sp, m) {
  const f = { ...(FORMATS[sp] || {}), ...(m.fmt || {}) };
  return ENGINE_OF[sp] === "goals" ? (Number(f.periods) || 2) * (Number(f.minutes) || 20) + 30 : EXPECT[ENGINE_OF[sp]] || 60;
}
// "9:00 AM", "9.00am", "14:30" → today's Date, only on the sport's own day (e.g. "Sat 14 Nov")
function schedTime(sp, t) {
  const day = (String(SPORTS[sp].day).match(/\b(\d{1,2})\b/) || [])[1];
  const now = new Date();
  if (!day || Number(day) !== now.getDate()) return null;
  const x = String(t || "").trim().match(/^(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?/i);
  if (!x) return null;
  let h = +x[1]; const mi = +x[2], ap = (x[3] || "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12; if (ap.startsWith("a") && h === 12) h = 0;
  const d = new Date(now); d.setHours(h, mi, 0, 0); return d;
}
function healthOf(sp) {
  const now = C.now(), warn = [];
  const ms = Object.entries((raw[sp] && raw[sp].matches) || {}).map(([id, m]) => ({ id, ...m }));
  const t = id => (((raw[sp] || {}).teams || {})[id] || {}).name || "TBC";
  const label = m => `#${esc(m.no)} ${esc(t(m.teamA))} vs ${esc(t(m.teamB))}${m.court ? " · C" + esc(m.court) : ""}`;
  for (const m of ms) {
    const st = m.status || "scheduled";
    if (st === "live") {
      const idle = now - (m.updatedAt || m.startedAt || now), long = now - (m.startedAt || now);
      if (idle > 15 * 60000) warn.push(`⏸ ${label(m)}: live but no score for ${ago(idle)} – result not confirmed?`);
      else if (long > expectedMin(sp, m) * 60000) warn.push(`⏱ ${label(m)}: live for ${ago(long)}`);
    }
    if (st === "scheduled") {
      const d = schedTime(sp, m.time);
      if (d && now - d.getTime() > 20 * 60000) warn.push(`⌛ ${label(m)}: due ${esc(m.time)}, not started (${ago(now - d.getTime())} late)`);
    }
  }
  return { total: ms.length, done: ms.filter(m => m.status === "done").length, warn };
}
const fbOpen = sp => Object.values(fbData || {}).filter(f => !f.done && (f.sport || "") === sp).length;

// Live data for one board. If this login can't open a live connection to it, fall back to
// reading the public copy every 15 s (the same way the public pages do).
function watchBoard(id, b) {
  const got = v => { boardData[id] = v || {}; if (id === "bowling") bowl = boardData[id]; renderOverview(); };
  C.onValue(ref(db, b.path), s => got(s.val()), () => {
    const url = String(firebaseConfig.databaseURL || "").replace(/\/$/, "") + "/" + b.path + ".json";
    const poll = () => fetch(url, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(got).catch(() => {});
    poll(); setInterval(poll, 15000);
  });
}
const clock = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const boardButtons = (id, b) => `<div class="row" style="margin-top:8px">${(b.links || []).slice(0, 3).map(([l, u], i) =>
  `<a href="${BASE + u}" target="_blank"><button class="small ${i ? "ghost" : ""}">${esc(l.replace(/\s*\(.*\)/, ""))} ↗</button></a>`).join("")}<button class="small ghost" data-pin="${id}">Pin on big screen</button></div>`;

function mlbbCard(id, b) {
  const D = boardData[id];
  if (!D) return "";
  const has = D.groups || D.rounds || D.playoffs;
  const all = has ? mlbbMatches(D) : [], cnt = st => all.filter(m => (m.st || "scheduled") === st).length;
  const rd = D.round || {}, p = D.playoffs || {}, g = D.groups || {}, rv = D.review || {};
  const val = x => x.score ?? (x.kills != null ? x.kills + " K" : "");
  const warn = [];
  for (const G of Object.keys(rv)) if (rv[G]) warn.push(`⚖ Group ${esc(G)}: result pending – organiser decision`);
  const quiet = D.at ? Date.now() - D.at : 0;
  if (cnt("live") && quiet > 30 * 60000) warn.push(`⏸ A match is live but nothing was published for ${ago(quiet)}`);
  const fb = fbOpen(id); if (fb) warn.push(`💬 ${fb} unread feedback`);
  const mini = (l, x, v) => `<div class="mini"><span>${l}</span><b>${v}</b></div>`;
  return `<div class="scard" style="--c:${b.color}">
    <div class="row"><h4 style="flex:1">${esc(b.name)}</h4><span class="muted" style="font-size:12px">${D.at ? "last update " + clock(D.at) : "not published yet"}</span></div>
    ${has ? `<div class="cnt"><span><b>${cnt("live")}</b> live</span><span><b>${cnt("scheduled")}</b> upcoming</span><span><b>${cnt("done")}</b> finished</span>${rd.total ? `<span>Round ${Math.min(rd.done || 0, rd.total)}/${rd.total}</span>` : ""}</div>` : `<p class="muted" style="margin:6px 0">${esc(b.note || "")} Nothing published yet.</p>`}
    ${rd.total ? `<div class="pbar"><i style="width:${Math.round(Math.min(rd.done || 0, rd.total) / rd.total * 100)}%"></i></div>` : ""}
    ${all.filter(m => m.st === "live").map(m => mini(`${esc(m.label)} · ${esc((m.a || {}).name || "TBC")} vs ${esc((m.b || {}).name || "TBC")}`, 0, `${val(m.a || {})}–${val(m.b || {})}`)).join("")}
    ${p.champion ? mini(`🏆 Champion: <b>${esc(p.champion)}</b>`, 0, "") + (p.runner ? mini(`🥈 ${esc(p.runner)}`, 0, "") : "")
      : Object.keys(g).sort().map(G => (g[G] || [])[0] ? mini(`Group ${esc(G)} leader: <b>${esc(g[G][0].name)}</b>`, 0, (g[G][0].pts | 0) + " pts") : "").join("")}
    ${warn.map(w => `<div class="hwarn">${w}</div>`).join("")}
    ${boardButtons(id, b)}</div>`;
}
// Any board without its own card still shows up, with its links and last update time.
function plainCard(id, b) {
  const D = boardData[id] || {}, at = D.at || D.updated;
  const fb = fbOpen(id);
  return `<div class="scard" style="--c:${b.color}">
    <div class="row"><h4 style="flex:1">${esc(b.name)}</h4><span class="muted" style="font-size:12px">${at ? "last update " + clock(at) : "no data yet"}</span></div>
    ${b.note ? `<p class="muted" style="margin:6px 0">${esc(b.note)}</p>` : ""}${fb ? `<div class="hwarn">💬 ${fb} unread feedback</div>` : ""}${boardButtons(id, b)}</div>`;
}
const BOARD_CARD = { bowling: () => bowlingCard(), mlbb: mlbbCard };
const boardCards = () => Object.entries(BOARDS).map(([id, b]) => (BOARD_CARD[id] || plainCard)(id, b)).join("");

function bowlingCard() {
  if (!bowl) return "";
  const bw = bowlingStandings(bowl), R = bw.R;
  const slots = bw.teams.reduce((a, t) => a + t.slots, 0), entered = bw.teams.reduce((a, t) => a + t.done, 0);
  const locks = bowl.locks || {}, key = n => String(n).replace(/[.#$\[\]\/]/g, "_");
  const verified = bw.teams.filter(t => locks[key(t.t)]).length;
  const waiting = bw.teams.filter(t => t.done >= t.slots && !locks[key(t.t)]);
  const warn = [];
  if (waiting.length) warn.push(`✓ ${waiting.length} team${waiting.length > 1 ? "s have" : " has"} all scores but not Verified: ${waiting.map(t => esc(t.t)).join(", ")}`);
  const quiet = Date.now() - (bowl.updated || 0);
  if (entered && entered < slots && quiet > 20 * 60000) warn.push(`⏸ No new score for ${ago(quiet)} – still bowling?`);
  const fb = fbOpen("bowling");
  if (fb) warn.push(`💬 ${fb} unread feedback`);
  const top = (lbl, x, v) => x ? `<div class="mini"><span>${lbl}: <b>${esc(x.n || x.t)}</b>${x.t && x.n ? ` <span class="muted">${esc(x.t)}</span>` : ""}</span><b>${v}</b></div>` : "";
  const BW = BASE + "bowling.html";
  return `<div class="scard" style="--c:#8b5cf6">
    <div class="row"><h4 style="flex:1">${esc(BOARDS.bowling.name)}</h4><span class="muted" style="font-size:12px">${bowl.updated ? "last update " + new Date(bowl.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "no scores yet"}</span></div>
    <div class="cnt"><span><b>${entered}</b>/${slots} scores</span><span><b>${verified}</b>/${bw.teams.length} verified</span><span>${R.games} games</span></div>
    <div class="pbar"><i style="width:${slots ? Math.round(entered / slots * 100) : 0}%"></i></div>
    ${bw.anyScore ? top("Top team", bw.teams[0], bw.teams[0].total) + top("Top man", bw.men[0], bw.men[0] ? bw.men[0].total : "") + top("Top woman", bw.women[0], bw.women[0] ? bw.women[0].total : "") : ""}
    ${warn.map(w => `<div class="hwarn">${w}</div>`).join("")}
    <div class="row" style="margin-top:8px"><a href="${BW}?v=scorer" target="_blank"><button class="small">Open scorer ↗</button></a>
      <a href="${BW}" target="_blank"><button class="small ghost">Public board ↗</button></a>
      <a href="${BW}?v=overlay" target="_blank"><button class="small ghost">OBS overlay ↗</button></a>
      <button class="small ghost" data-pin="bowling">Pin on big screen</button></div></div>`;
}

function renderOverview() {
  if (!started) return;
  $("#overview").innerHTML = Object.entries(SPORTS).map(([id, s]) => {
    const all = recs(id);
    const live = all.filter(r => r.st === "live");
    const cnt = st => all.filter(r => r.st === st).length;
    const h = healthOf(id), fb = fbOpen(id);
    const warn = [...h.warn.slice(0, 5), ...(h.warn.length > 5 ? [`+ ${h.warn.length - 5} more`] : []), ...(fb ? [`💬 ${fb} unread feedback`] : [])];
    return `<div class="scard" style="--c:${s.color}">
      <div class="row"><h4 style="flex:1">${esc(s.name)}</h4><span class="muted" style="font-size:12px">${esc(s.day)}</span></div>
      <div class="cnt"><span><b>${live.length}</b> live</span><span><b>${cnt("scheduled")}</b> upcoming</span><span><b>${cnt("done")}</b> finished</span>${h.total ? `<span>${h.done}/${h.total} done</span>` : ""}</div>
      ${h.total ? `<div class="pbar"><i style="width:${Math.round(h.done / h.total * 100)}%"></i></div>` : ""}
      ${live.map(r => {
        const v = r.v || {};
        return `<div class="mini"><span>${r.ct ? "C" + esc(r.ct) + " · " : ""}${esc(r.a)} vs ${esc(r.b)}</span>
          <b>${(v.big || [])[0] ?? ""}–${(v.big || [])[1] ?? ""}</b>
          <button class="small ghost" data-feat="${id}/${r.id}" title="Show this match full screen">📺</button></div>`;
      }).join("")}
      ${warn.map(w => `<div class="hwarn">${w}</div>`).join("")}
      <div class="row" style="margin-top:8px"><a href="${BASE}scorer/?sport=${id}" target="_blank"><button class="small">Open scorer ↗</button></a>
      <button class="small ghost" data-pin="${id}">Pin on big screen</button></div></div>`;
  }).join("") + boardCards();
  $$("[data-feat]").forEach(b => b.onclick = () => saveDisplay({ mode: "match", match: b.dataset.feat }, "Featured on big screen"));
  $$("[data-pin]").forEach(b => b.onclick = () => saveDisplay({ mode: "sport", sport: b.dataset.pin }, `${nameOf(b.dataset.pin)} pinned`));
}

async function saveDisplay(patch, msg) {
  await C.update(ref(db, "settings/display"), patch);
  toast(msg);
}

// ---------------- big screen
function fillScreenForm() {
  const d = settings.display || {};
  $("#evLine").textContent = settings.event || EVENT_DEFAULTS.name;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#t-screen")) return;
  $("#sEvent").value = settings.event || EVENT_DEFAULTS.name;
  $("#sVenue").value = settings.venue || EVENT_DEFAULTS.venue;
  $("#sTicker").value = settings.ticker || "";
  const mode = d.mode || "auto";
  $$("input[name=mode]").forEach(r => r.checked = r.value === mode);
  $("#sSport").value = d.sport || Object.keys(SPORTS)[0];
  $("#sRotate").value = d.rotate || 15;
  fillAwards(settings.awards);
  $("#sSports").innerHTML = Object.entries(SPORTS).map(([id, s]) =>
    `<label><input type="checkbox" value="${id}" ${!d.sports || d.sports[id] !== false ? "checked" : ""}> ${esc(s.name)}</label>`).join("") +
    // boards with their own page: off unless ticked
    Object.entries(BOARDS).map(([id, b]) => `<label><input type="checkbox" value="${id}" ${d.sports && d.sports[id] === true ? "checked" : ""}> ${esc(b.name)}</label>`).join("");
  fillMatchSelect();
  fillSportInfo();
}
function fillMatchSelect() {
  const cur = (settings.display || {}).match || $("#sMatch").value;
  const opts = [];
  for (const [sp, s] of Object.entries(SPORTS)) {
    for (const r of recs(sp).filter(r => r.st !== "done").sort((x, y) => (x.st === "live" ? -1 : 1) - (y.st === "live" ? -1 : 1) || (Number(x.no) || 0) - (Number(y.no) || 0))) {
      opts.push(`<option value="${sp}/${r.id}" ${cur === sp + "/" + r.id ? "selected" : ""}>${esc(s.short)} #${esc(r.no)} ${r.st === "live" ? "● " : ""}${esc(r.a)} vs ${esc(r.b)}</option>`);
    }
  }
  $("#sMatch").innerHTML = opts.length ? opts.join("") : `<option value="">(no open matches)</option>`;
}
$("#btnSaveScreen").onclick = async () => {
  const sports = {};
  $$("#sSports input").forEach(c => sports[c.value] = c.checked);
  const mode = ($$("input[name=mode]").find(r => r.checked) || {}).value || "auto";
  if (mode === "match" && !$("#sMatch").value) return toast("Choose a match first");
  await C.update(ref(db, "settings"), {
    event: $("#sEvent").value.trim() || EVENT_DEFAULTS.name,
    venue: $("#sVenue").value.trim(),
    ticker: $("#sTicker").value.trim(),
    display: { mode, sport: $("#sSport").value, match: $("#sMatch").value || "", rotate: Math.max(5, Number($("#sRotate").value) || 15), sports }
  });
  document.activeElement && document.activeElement.blur();
  toast("Big screen updated");
};

// ---------------- sport names, dates & venues (settings/sportInfo)
function fillSportInfo() {
  const info = settings.sportInfo || {}, main = settings.venue || EVENT_DEFAULTS.venue;
  const cell = (id, k, ph, max) => `<td><input data-si="${id}" data-k="${k}" maxlength="${max}" value="${esc((info[id] || {})[k] || "")}" placeholder="${esc(ph)}"></td>`;
  $("#sportInfo").innerHTML = `<table class="sitab"><tr><th>Sport</th><th>Name shown</th><th>Date</th><th>Venue</th></tr>` +
    Object.keys(SPORTS).map(id => { const b = SPORT_BASE[id];
      return `<tr><td><b style="color:${SPORTS[id].color}">●</b> ${esc(b.name)}</td>${cell(id, "name", b.name, 30)}${cell(id, "day", b.day, 24)}${cell(id, "venue", b.venue || main + " (main venue)", 90)}</tr>`; }).join("") +
    // bowling / Mobile Legends: name only – their date and venue are set on their own pages
    Object.entries(BOARDS).map(([id, b]) => `<tr><td><b style="color:${b.color}">●</b> ${esc(boardBaseName(id))}</td>${cell(id, "name", boardBaseName(id), 30)}<td colspan="2" class="muted" style="font-size:12px">date and venue are set on its own page</td></tr>`).join("") + `</table>`;
}
$("#btnSaveSportInfo").onclick = async () => {
  const out = {};
  $$("#sportInfo input").forEach(i => { const v = i.value.trim(); if (v) (out[i.dataset.si] = out[i.dataset.si] || {})[i.dataset.k] = v; });
  await C.set(ref(db, "settings/sportInfo"), Object.keys(out).length ? out : null);
  document.activeElement && document.activeElement.blur();
  toast("Sport details saved");
};

// ---------------- links & QR
function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast("Copied")).catch(() => prompt("Copy this link:", text));
}
function renderLinks() {
  $("#pubLink").href = PUBLIC_URL; $("#pubLink").textContent = PUBLIC_URL;
  $("#btnCopyPub").onclick = () => copy(PUBLIC_URL);
  $("#previewLink").href = BASE + "display/";
  if (window.QRCode) new QRCode($("#qr"), { text: PUBLIC_URL, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  $("#btnDlQR").onclick = () => {
    const c = $("#qr canvas"), img = $("#qr img");
    const url = c ? c.toDataURL("image/png") : img && img.src;
    if (!url) return toast("QR not ready");
    const a = document.createElement("a"); a.href = url; a.download = "live-scores-qr.png"; a.click();
  };
  const row = (label, url) => `<div class="linkrow"><b>${esc(label)}</b><code>${esc(url)}</code>
    <button class="small" data-copy="${esc(url)}">Copy</button><a href="${esc(url)}" target="_blank"><button class="small ghost">Open</button></a></div>`;
  $("#scorerLinks").innerHTML = Object.entries(SPORTS).map(([id, s]) => row(s.name, `${BASE}scorer/?sport=${id}`)).join("");
  $("#displayLinks").innerHTML = row("Main (follows admin)", BASE + "display/") +
    Object.entries({ ...SPORTS, ...BOARDS }).map(([id, s]) => row(s.name + " only", `${BASE}display/?sport=${id}`)).join("") +
    row("Transparent overlay", BASE + "display/?bg=transparent");
  $("#boardLinks").innerHTML = Object.values(BOARDS).map(b => `<div class="card"><h3>${esc(b.name)} (separate page)</h3>
    <p class="muted">${esc(b.note || `${b.name} has its own pages.`)} Its public page is also linked from the main live-scores page.</p>
    ${(b.links || []).map(([l, u]) => row(l, BASE + u)).join("")}</div>`).join("");
  $$("[data-copy]").forEach(b => b.onclick = () => copy(b.dataset.copy));
  renderScorerQR();
}

// one QR per scorer link (every sport + every board that has a scorer page)
function renderScorerQR() {
  const items = [...Object.entries(SPORTS).map(([id, s]) => ({ id, name: s.name, color: s.color, url: `${BASE}scorer/?sport=${id}` })),
    ...Object.entries(BOARDS).filter(([, b]) => b.scorer).map(([id, b]) => ({ id, name: b.short || b.name, color: b.color, url: BASE + b.scorer }))];
  $("#scorerQR").innerHTML = items.map(it => `<div class="qrc" style="--c:${it.color}"><b>${esc(it.name)}</b>
    <div class="qrbox" id="qr-${it.id}"></div>
    <div class="row"><button class="small" data-qrdl="${it.id}">Download</button><button class="small ghost" data-copy="${esc(it.url)}">Copy link</button></div></div>`).join("");
  if (!window.QRCode) { $("#scorerQR").insertAdjacentHTML("beforeend", `<p class="muted">QR library didn't load – check the internet and reload.</p>`); return; }
  for (const it of items) new QRCode($("#qr-" + it.id), { text: it.url, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
  $$("#scorerQR [data-copy]").forEach(b => b.onclick = () => copy(b.dataset.copy));
  $$("[data-qrdl]").forEach(b => b.onclick = () => {
    const it = items.find(x => x.id === b.dataset.qrdl);
    const box = $("#qr-" + it.id), src = box.querySelector("canvas") || box.querySelector("img");
    if (!src) return toast("QR not ready");
    // labelled picture: sport name on top, QR, "Scorer" note below
    const W = 520, cv = document.createElement("canvas"); cv.width = W; cv.height = 640;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, 640);
    g.fillStyle = it.color; g.fillRect(0, 0, W, 14);
    g.fillStyle = "#111"; g.textAlign = "center";
    g.font = "800 40px Inter, Arial, sans-serif"; g.fillText(it.name.toUpperCase(), W / 2, 76);
    g.font = "600 20px Inter, Arial, sans-serif"; g.fillStyle = "#666"; g.fillText("SCORER · " + (settings.event || EVENT_DEFAULTS.name), W / 2, 108);
    g.imageSmoothingEnabled = false; g.drawImage(src, 60, 140, 400, 400);
    g.font = "500 17px Inter, Arial, sans-serif"; g.fillStyle = "#888"; g.fillText("Scan to open · password from the organiser", W / 2, 590);
    const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = `Scorer_QR_${it.name.replace(/\W+/g, "_")}.png`; a.click();
  });
}
$("#btnPrintQR").onclick = () => window.print();

// ---------------- tools
$("#btnRepubAll").onclick = async () => {
  try {
    const snap = await C.get(ref(db, "sports"));
    const all = snap.val() || {};
    const upd = {};
    for (const sp of Object.keys(SPORTS)) {
      const s = all[sp] || {};
      const m = {};
      for (const [id, match] of Object.entries(s.matches || {})) m[id] = publicRecord(sp, match, s.teams || {});
      upd[`pub/${sp}/m`] = m;
    }
    await C.update(ref(db), upd);
    toast("All public data refreshed");
  } catch (e) { toast("Error: " + e.message, 4000); }
};

function startLog() {
  if (logUnsub) logUnsub();
  const sp = $("#logSport").value;
  logUnsub = C.onValue(C.query(ref(db, `logs/${sp}`), C.limitToLast(100)), snap => {
    const rows = [];
    snap.forEach(c => { rows.push(c.val()); });
    rows.reverse();
    $("#logList").innerHTML = rows.length ? `<table><tr><th>Time</th><th>By</th><th>Match</th><th>Action</th></tr>` +
      rows.map(r => `<tr><td style="white-space:nowrap">${r.at ? new Date(r.at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</td>
      <td>${esc(r.by)}</td><td>${r.no !== "" && r.no != null ? "#" + esc(r.no) : "—"}</td><td>${esc(r.act)}</td></tr>`).join("") + `</table>` : `<p class="muted">Nothing yet.</p>`;
  });
}

async function clearSport(matchesOnly) {
  const sp = $("#clrSport").value, name = SPORTS[sp].name;
  const what = matchesOnly ? "all matches" : "all teams and matches";
  if (!confirm(`Delete ${what} for ${name}?`)) return;
  if (prompt(`Type ${name.toUpperCase()} to confirm`) !== name.toUpperCase()) return toast("Cancelled");
  const upd = { [`sports/${sp}/matches`]: null, [`pub/${sp}`]: null };
  if (!matchesOnly) upd[`sports/${sp}/teams`] = null;
  await C.update(ref(db), upd);
  await C.remove(ref(db, `logs/${sp}`));
  toast(`${name} cleared`);
}
$("#btnClear").onclick = () => clearSport(false);
$("#btnClearMatches").onclick = () => clearSport(true);

// ---------------- prize giving
// built fresh each time, so a sport renamed in Admin shows its new name here and on the big screen
const awCats = () => [
  ...Object.entries(SPORTS).map(([id, s]) => ({ id, label: s.name, color: s.color })),
  ...Object.values(BOARDS).flatMap(b => (b.awards || []).map(([id, label]) => ({ id, label, color: b.color })))
];
const PLACES = ["1st", "2nd", "3rd"];
function awardsFromForm() {
  return awCats().map(c => ({ id: c.id, label: c.label, color: c.color,
    p: PLACES.map((_, i) => (($(`#awardsForm input[data-c="${c.id}"][data-i="${i}"]`) || {}).value || "").trim()) }));
}
function fillAwards(saved) {
  const cur = {};
  (Array.isArray(saved) ? saved : Object.values(saved || {})).forEach(a => { if (a && a.id) cur[a.id] = a.p || []; });
  for (const c of awCats()) { const el = $(`#awardsForm [data-awl="${c.id}"]`); if (el) el.textContent = c.label; }
  if (!$("#awardsForm table")) {
    $("#awardsForm").innerHTML = `<table class="aw"><tr><th>Category</th>${PLACES.map(p => `<th>${p}</th>`).join("")}</tr>` +
      awCats().map(c => `<tr><td style="--c:${c.color}"><i></i><span data-awl="${c.id}">${esc(c.label)}</span></td>${PLACES.map((_, i) =>
        `<td><input data-c="${c.id}" data-i="${i}" placeholder="—"></td>`).join("")}</tr>`).join("") + `</table>`;
  }
  awCats().forEach(c => PLACES.forEach((_, i) => {
    const el = $(`#awardsForm input[data-c="${c.id}"][data-i="${i}"]`);
    if (el && document.activeElement !== el) el.value = (cur[c.id] || [])[i] || "";
  }));
}
async function saveAwards(show) {
  const aw = awardsFromForm();
  const upd = { awards: aw };
  if (show) upd["display/mode"] = "awards";
  await C.update(ref(db, "settings"), upd);
  toast(show ? "Prize giving is on the big screen" : "Winners saved");
}
$("#btnSaveAwards").onclick = () => saveAwards(false);
$("#btnShowAwards").onclick = () => saveAwards(true);

const isFinal = s => /\b(final|akhir)\b/i.test(s || "") && !/(semi|quarter|separuh|suku)/i.test(s || "");
const isThird = s => /(3rd|third|bronze|ketiga)/i.test(s || "");
function podiumFor(sp) {
  const all = recs(sp).filter(r => r.st === "done");
  const name = (r, side) => side === "a" ? r.a : r.b;
  const fin = all.filter(r => isFinal(r.rd) && r.w).sort((x, y) => (y.t || 0) - (x.t || 0))[0];
  const third = all.filter(r => isThird(r.rd) && r.w).sort((x, y) => (y.t || 0) - (x.t || 0))[0];
  if (fin) return [name(fin, fin.w), name(fin, fin.w === "a" ? "b" : "a"), third ? name(third, third.w) : ""];
  const tbl = standings((pub[sp] && pub[sp].m) || {});
  const groups = Object.keys(tbl);
  if (groups.length === 1) return tbl[groups[0]].slice(0, 3).map(x => x.p ? x.team : "");
  return ["", "", ""];
}
$("#btnAutoAwards").onclick = async () => {
  let bw = null;
  try { bw = bowlingStandings((await C.get(ref(db, BOWL_ROOT))).val()); } catch (e) { /* bowling optional */ }
  const auto = {};
  for (const sp of Object.keys(SPORTS)) auto[sp] = podiumFor(sp);
  if (bw) {
    auto.bowl_team = bw.teams.filter(t => t.done).slice(0, 3).map(t => t.t);
    auto.bowl_men = bw.men.slice(0, 3).map(p => p.n);
    auto.bowl_women = bw.women.slice(0, 3).map(p => p.n);
  }
  const ml = ((boardData.mlbb || {}).playoffs) || {};
  if (ml.champion) auto.mlbb = [ml.champion, ml.runner || "", ml.third || ""];
  let filled = 0;
  for (const c of awCats()) (auto[c.id] || []).forEach((v, i) => {
    const el = $(`#awardsForm input[data-c="${c.id}"][data-i="${i}"]`);
    if (el && v) { el.value = v; filled++; }
  });
  toast(filled ? `Filled ${filled} place(s) – check, then Save` : "No finished finals or tables yet");
};

// ---------------- results download
$("#btnExport").onclick = async () => {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [[settings.event || EVENT_DEFAULTS.name, "Results", new Date().toLocaleString()], []];
  const stName = r => r.st === "done" ? "Finished" : r.st === "live" ? "Live" : "Scheduled";
  for (const [sp, s] of Object.entries(SPORTS)) {
    const all = recs(sp).sort((x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999));
    rows.push([s.name.toUpperCase()]);
    if (!all.length) { rows.push(["No matches"]); rows.push([]); continue; }
    rows.push(["No", "Time", "Court", "Round", "Event", "Group", "Team A", "Team B", "Status", "Score A", "Score B", "Winner", "Details"]);
    for (const r of all) {
      const done = r.st === "done";
      const sa = done ? (r.wo ? (r.w === "a" ? "W/O" : "") : (r.sc || [])[0]) : r.st === "live" ? ((r.v || {}).big || [])[0] : "";
      const sb = done ? (r.wo ? (r.w === "b" ? "W/O" : "") : (r.sc || [])[1]) : r.st === "live" ? ((r.v || {}).big || [])[1] : "";
      rows.push([r.no, r.tm, r.ct, r.rd, r.ev, r.gr, r.a, r.b, stName(r), sa, sb, done ? (r.w === "a" ? r.a : r.w === "b" ? r.b : "Draw") : "", (r.v || {}).hist || ""]);
    }
    const tbl = standings((pub[sp] && pub[sp].m) || {});
    for (const g of Object.keys(tbl).sort()) {
      rows.push([]); rows.push([`${s.name} – Group ${g}`]);
      rows.push(["Pos", "Team", "Played", "Won", "Drawn", "Lost", "For", "Against", "Diff", "Points"]);
      tbl[g].forEach((x, i) => rows.push([i + 1, x.team, x.p, x.w, x.d, x.l, x.f, x.a, x.f - x.a, x.pts]));
    }
    rows.push([]);
  }
  try {
    const bw = bowlingStandings((await C.get(ref(db, BOWL_ROOT))).val());
    const GH = bw.G.map(g => "G" + g);
    rows.push(["TENPIN BOWLING"]); rows.push(["Rules: " + globalThis.BowlRules.describe(bw.R)]);
    rows.push(["Pos", "Team", ...GH, "TPF"]);
    bw.teams.forEach((t, i) => rows.push([bw.rankOf(bw.teams, i), t.t, ...t.games.map(x => x ?? ""), t.total]));
    for (const [lbl, list] of [["Men", bw.men], ["Women", bw.women], ["Overall", bw.overall]]) {
      if (lbl === "Overall" && !bw.R.cats.overall) continue;
      rows.push([]); rows.push([`Bowling – ${lbl}`]);
      rows.push(["Pos", "Name", "Team", ...GH, "TPF", "Average"]);
      list.forEach((p, i) => rows.push([bw.rankOf(list, i), p.n, p.t, ...p.games.map(x => x ?? ""), p.total, p.avg.toFixed(1)]));
    }
    rows.push([]); rows.push(["Bowling – High Game"]); rows.push(["Pos", "Name", "Team", "High game"]);
    bw.highs.slice(0, 10).forEach((p, i) => rows.push([bw.rankOf(bw.highs, i, "highT"), p.n, p.t, p.highT]));
    if (bw.R.cats.series) {
      rows.push([]); rows.push([`Bowling – High Series (${bw.R.seriesN} games)`]); rows.push(["Pos", "Name", "Team", "Series"]);
      bw.series.slice(0, 10).forEach((p, i) => rows.push([bw.rankOf(bw.series, i, "ser"), p.n, p.t, p.ser]));
    }
  } catch (e) { rows.push(["Bowling data could not be loaded"]); }
  const ML = boardData.mlbb;
  if (ML && (ML.groups || ML.playoffs)) {
    rows.push([]); rows.push(["MOBILE LEGENDS"]);
    for (const G of Object.keys(ML.groups || {}).sort()) {
      rows.push([`Mobile Legends – Group ${G}`]); rows.push(["Pos", "Slot", "Team", "Played", "Won", "Lost", "Kill diff", "Kills", "Points"]);
      (ML.groups[G] || []).forEach((t, i) => rows.push([i + 1, t.slot, t.name, t.p | 0, t.w | 0, t.l | 0, t.kd | 0, t.kills | 0, t.pts | 0]));
      rows.push([]);
    }
    const ms = mlbbMatches(ML);
    if (ms.length) {
      rows.push(["Mobile Legends – Matches"]); rows.push(["Match", "Team A", "Team B", "Status", "A", "B", "Winner"]);
      const val = x => x.score ?? x.kills ?? "";
      ms.forEach(m => { const a = m.a || {}, b = m.b || {};
        rows.push([m.label, a.name, b.name, m.st === "done" ? (m.wo ? "Walkover" : "Finished") : m.st === "live" ? "Live" : "Scheduled", val(a), val(b), m.w === "a" ? a.name : m.w === "b" ? b.name : ""]); });
      rows.push([]);
    }
    const pl = ML.playoffs || {};
    if (pl.champion) rows.push(["Champion", pl.champion], ["Runner-up", pl.runner || ""], ["3rd", pl.third || ""]);
  }
  const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `${(settings.event || "HQ Games 2026").replace(/[^\w]+/g, "_")}_Results.csv`; a.click();
  toast("Results downloaded");
};

// ---------------- feedback (from the 💬 button on scorer pages → /feedback)
let fbData = {};
function startFeedback() {
  C.onValue(C.query(ref(db, "feedback"), C.limitToLast(300)), snap => { fbData = snap.val() || {}; renderFeedback(); },
    err => { $("#fbList").innerHTML = `<p class="muted">Can't read feedback yet – publish the new database rules (see SETUP.md). (${esc(err.code || err.message)})</p>`; });
}
function renderFeedback() {
  const all = Object.entries(fbData).map(([id, f]) => ({ id, ...f })).sort((a, b) => (b.at || 0) - (a.at || 0));
  const open = all.filter(f => !f.done).length;
  $("#fbCount").textContent = open ? open : "";
  renderOverview();
  const list = $("#fbShowDone").checked ? all : all.filter(f => !f.done);
  const ic = { Bug: "🐞", Suggestion: "💡" };
  $("#fbList").innerHTML = list.length ? list.map(f => `<div class="fbi ${f.done ? "done" : ""}">
      <div class="msg"><span class="ty">${ic[f.type] || "💬"} ${esc(f.type || "Other")}</span>${esc(f.msg)}</div>
      <div class="meta">${esc(f.by || "?")} · ${esc(f.page || f.sport || "")}${f.team ? " · " + esc(f.team) : ""} · ${esc(f.dev || "")} · ${f.at ? new Date(f.at).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</div>
      <div class="act"><button class="small" data-fbdone="${f.id}">${f.done ? "Reopen" : "✓ Done"}</button><button class="small" data-fbdel="${f.id}" title="Delete">✕</button></div>
    </div>`).join("") : `<p class="muted">${all.length ? "All done 🎉" : "No feedback yet."}</p>`;
}
$("#fbShowDone").onchange = renderFeedback;
$("#fbList").onclick = async e => {
  const d = e.target.closest("[data-fbdone]"), x = e.target.closest("[data-fbdel]");
  try {
    if (d) await C.set(ref(db, `feedback/${d.dataset.fbdone}/done`), fbData[d.dataset.fbdone].done ? null : Date.now());
    if (x && confirm("Delete this feedback?")) await C.remove(ref(db, `feedback/${x.dataset.fbdel}`));
  } catch (err) { toast("Error: " + err.message, 4000); }
};


// ---------------- backup & restore (one file with everything; can put it back)
async function collectBackup() {
  const get = async path => { try { return (await C.get(ref(db, path))).val(); } catch (e) { return undefined; } };
  const out = { app: "ja-scoring", version: 1, at: Date.now(), event: settings.event || EVENT_DEFAULTS.name,
    sports: (await get("sports")) || {}, pub: (await get("pub")) || {}, settings: (await get("settings")) || {}, boards: {} };
  for (const [id, b] of Object.entries(BOARDS)) { const v = await get(b.path); out.boards[id] = v === undefined ? (boardData[id] || null) : v; }
  return out;
}
function saveFile(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`; };
async function downloadBackup(tag) {
  const b = await collectBackup();
  saveFile(`${(b.event || "event").replace(/[^\w]+/g, "_")}_${tag || "Backup"}_${stamp()}.json`, JSON.stringify(b), "application/json");
  return b;
}
$("#btnBackup").onclick = async () => {
  try { await downloadBackup(); toast("Backup downloaded – keep the file safe"); } catch (e) { toast("Error: " + e.message, 4000); }
};
let restoreFile = null;
$("#inRestore").onchange = async e => {
  const f = e.target.files[0]; restoreFile = null; $("#restoreBox").innerHTML = "";
  if (!f) return;
  let b; try { b = JSON.parse(await f.text()); } catch (err) { b = null; }
  if (!b || b.app !== "ja-scoring" || !b.sports) { $("#restoreBox").innerHTML = `<p style="color:var(--bad)">This is not a JA Scoring backup file.</p>`; return; }
  restoreFile = b;
  const n = o => Object.keys(o || {}).length;
  const line = (val, label, info, ok = true) => `<label><input type="checkbox" value="${val}" ${ok ? "" : "disabled"}> <span><b>${esc(label)}</b> <span class="muted">${info}</span></span></label>`;
  const known = Object.keys(b.sports).filter(sp => SPORTS[sp]);
  $("#restoreBox").innerHTML = `<p>Backup of <b>${esc(b.event || "")}</b>, made <b>${new Date(b.at).toLocaleString()}</b>. Tick what to put back:</p>
    <div class="checks" style="flex-direction:column;gap:8px">
    ${known.map(sp => line("sport:" + sp, SPORTS[sp].name, `${n((b.sports[sp] || {}).matches)} matches, ${n((b.sports[sp] || {}).teams)} teams`)).join("")}
    ${Object.entries(BOARDS).map(([id, bd]) => b.boards && b.boards[id] ? line("board:" + id, bd.name, bd.restore ? "all scores and settings" : "kept in the file for your records – " + esc(bd.note || "restored from its own tool"), !!bd.restore) : "").join("")}
    ${line("settings", "Event & big screen settings", "event name, announcement, what the screen shows, prize winners")}
    </div>
    <p class="muted">Everything you tick is <b>replaced</b> by what is in the file. A safety copy of the current data is downloaded first.</p>
    <div class="row"><button class="primary" id="btnRestore">Restore ticked items</button></div>`;
  $("#btnRestore").onclick = doRestore;
};
async function doRestore() {
  const b = restoreFile, picks = $$("#restoreBox input:checked").map(c => c.value);
  if (!b) return;
  if (!picks.length) return toast("Tick at least one item");
  const names = picks.map(v => v === "settings" ? "Settings" : nameOf(v.split(":")[1]));
  if (prompt(`This replaces the current data for:\n\n${names.join(", ")}\n\nType RESTORE to confirm`) !== "RESTORE") return toast("Cancelled");
  try {
    await downloadBackup("Before_restore");
    const upd = {};
    for (const v of picks) {
      const [kind, id] = v.split(":");
      if (v === "settings") upd.settings = b.settings || null;
      else if (kind === "sport" && SPORTS[id]) {
        const sp = JSON.parse(JSON.stringify(b.sports[id] || {}));
        for (const m of Object.values(sp.matches || {})) delete m.lock;      // nobody is scoring a restored match yet
        const pm = {};
        for (const [mid, m] of Object.entries(sp.matches || {})) pm[mid] = publicRecord(id, m, sp.teams || {});
        upd[`sports/${id}`] = sp;
        upd[`pub/${id}`] = { ...((b.pub || {})[id] || {}), m: pm };
      } else if (kind === "board" && BOARDS[id] && BOARDS[id].restore) upd[BOARDS[id].path] = b.boards[id];
    }
    await C.update(ref(db), upd);
    toast("Restored: " + names.join(", "), 4000);
    $("#inRestore").value = ""; $("#restoreBox").innerHTML = ""; restoreFile = null;
  } catch (e) { toast("Restore failed: " + e.message, 5000); }
}
