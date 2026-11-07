import { SPORTS, ADMIN_EMAIL, EMAIL_DOMAIN, EVENT_DEFAULTS } from "../config.js";
import { FORMATS, ENGINE_OF, fmtOf, deriveRally, deriveGoals, deriveDarts, view, publicRecord,
         clockMs, mmss, periodName } from "../js/engines.js";
import * as C from "../js/common.js";
const { $, $$, esc, toast, store, ref } = C;

// ---------------------------------------------------------------- boot
const S = (new URLSearchParams(location.search).get("sport") || "").toLowerCase();
const SP = SPORTS[S];
if (!SP) {
  document.body.innerHTML = `<div style="font-family:system-ui;padding:32px;max-width:520px;margin:auto">
    <h2>Invalid scorer link</h2><p>Ask the organiser for your sport's scorer link.</p></div>`;
  throw new Error("unknown sport");
}
if (!C.configured) { C.notConfiguredScreen(); throw new Error("not configured"); }

const db = C.db, auth = C.auth;
const KIND = ENGINE_OF[S];
const UNIT = SP.unit;
const LOCK_STALE = 3 * 60 * 1000;
const SPORT_EMAIL = `${S}@${EMAIL_DOMAIN}`;

document.documentElement.style.setProperty("--sport", SP.color);
document.title = `${SP.name} · Scorer`;
$("#sportName").textContent = SP.name;
$("#sportDay").textContent = `${SP.day} · ${EVENT_DEFAULTS.venue}`;

let DEV = store("ja_dev");
if (!DEV) { DEV = Math.random().toString(36).slice(2, 10); store("ja_dev", DEV); }
let NAME = store("ja_name") || "";
$("#inName").value = NAME;

let adminMode = false, isAdmin = false;
let teams = {}, matches = {};
let tab = "list", curId = null, editingId = null;
let courtFilter = store("ja_court_" + S) || "";
let dataStarted = false, logUnsub = null, heartbeat = null, ticker = null;
let entry = ""; // darts keypad entry
let lastTap = 0;

// ---------------------------------------------------------------- helpers
const tn = id => (teams[id] && teams[id].name) || "TBC";
const sideName = (m, s) => tn(s === "a" ? m.teamA : m.teamB);
const matchRef = id => ref(db, `sports/${S}/matches/${id}`);
const arrMatches = () => Object.entries(matches).map(([id, m]) => ({ id, ...m })).sort(C.byNo);
const lockFresh = m => m.lock && (C.now() - (m.lock.at || 0) < LOCK_STALE);
const lockedByOther = m => lockFresh(m) && m.lock.dev !== DEV;

function show(v) {
  for (const id of ["vLogin", "vList", "vSetup", "vLog", "vScore"]) $("#" + id).classList.add("hide");
  $("#" + v).classList.remove("hide");
  $("#tabs").classList.toggle("hide", v === "vLogin" || v === "vScore");
  $$("#tabs button").forEach(b => b.classList.toggle("on", "v" + cap(b.dataset.tab) === v));
}
const cap = s => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- waiting to send
// Firebase keeps writes on the phone while offline and sends them later.
// `track` counts writes that haven't been confirmed yet so the scorer can see it.
let pending = 0, pendingSince = 0, online = true;
function track(p) {
  pending++; if (!pendingSince) pendingSince = Date.now();
  renderPending();
  const done = () => { pending = Math.max(0, pending - 1); if (!pending) pendingSince = 0; renderPending(); };
  Promise.resolve(p).then(done, done);
  return p;
}
function renderPending() {
  const el = $("#pendBar");
  if (!el) return;
  const slow = pending && Date.now() - pendingSince > 2500;
  const showIt = pending && (!online || slow);
  el.classList.toggle("hide", !showIt);
  if (showIt) el.innerHTML = `⏳ ${pending} action${pending > 1 ? "s" : ""} waiting to send` +
    (online ? "…" : " – no internet") +
    `<small>${online ? "Slow connection. Keep scoring – nothing is lost." : "Keep scoring on this phone – everything is saved here and sends by itself when the connection is back. Don't close this page."}</small>`;
}
setInterval(renderPending, 1000);
addEventListener("beforeunload", e => { if (pending) { e.preventDefault(); e.returnValue = ""; } });

function publish(id, m) {
  if (!m) return track(C.remove(ref(db, `pub/${S}/m/${id}`))).catch(() => {});
  return track(C.set(ref(db, `pub/${S}/m/${id}`), publicRecord(S, m, teams))).catch(e => console.warn(e));
}
async function republishAll() {
  const all = {};
  for (const [id, m] of Object.entries(matches)) all[id] = publicRecord(S, m, teams);
  await C.set(ref(db, `pub/${S}/m`), all);
}
function log(id, m, act) {
  track(C.push(ref(db, `logs/${S}`), {
    m: id, no: (m && m.no) ?? "", act, by: NAME || "?", dev: DEV, at: C.serverTimestamp()
  })).catch(() => {});
}

// ---------------------------------------------------------------- auth
$("#btnAdminMode").onclick = () => {
  adminMode = !adminMode;
  $("#loginTitle").textContent = adminMode ? "Admin login" : "Scorer login";
  $("#loginHint").textContent = adminMode ? "Admin password (can edit every sport)." : "Enter the password the organiser gave you for this sport.";
  $("#btnAdminMode").textContent = adminMode ? "Scorer login" : "Admin login";
};
$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  NAME = $("#inName").value.trim();
  store("ja_name", NAME);
  $("#loginErr").textContent = "";
  try {
    await C.signInWithEmailAndPassword(auth, adminMode ? ADMIN_EMAIL : SPORT_EMAIL, $("#inPw").value);
    $("#inPw").value = "";
  } catch (err) {
    $("#loginErr").textContent = /password|credential|user-not-found/i.test(err.code || err.message)
      ? "Wrong password." : "Login failed: " + (err.code || err.message);
  }
};
$("#btnLogout").onclick = async () => {
  if (!confirm("Log out of scoring?" + (curId ? "\n\nThe match you have open will be released." : ""))) return;
  if (curId) await releaseLock(curId);
  await C.signOut(auth);
};
$("#who").onclick = () => {
  const n = prompt("Your name / court (shown in the activity log):", NAME);
  if (n && n.trim()) { NAME = n.trim(); store("ja_name", NAME); $("#who").textContent = NAME; }
};

C.onAuthStateChanged(auth, user => {
  if (!user) {
    isAdmin = false;
    $("#who").classList.add("hide"); $("#btnLogout").classList.add("hide"); $("#fbWrap").classList.add("hide");
    show("vLogin");
    return;
  }
  if (user.email !== SPORT_EMAIL && user.email !== ADMIN_EMAIL) {
    alert(`This account is not for ${SP.name}. Use this sport's password.`);
    C.signOut(auth);
    return;
  }
  isAdmin = user.email === ADMIN_EMAIL;
  if (!NAME) NAME = isAdmin ? "Admin" : SP.name + " scorer";
  $("#who").textContent = NAME + (isAdmin ? " (admin)" : "");
  $("#who").classList.remove("hide"); $("#btnLogout").classList.remove("hide"); $("#fbWrap").classList.remove("hide");
  startData();
  goTab(curId ? "score" : tab);
});

C.onValue(ref(db, ".info/connected"), s => {
  online = !!s.val(); renderPending();
  $("#conn").classList.toggle("on", !!s.val());
  $("#conn").title = s.val() ? "Online" : "Offline – changes will sync when back online";
});

function startData() {
  if (dataStarted) return;
  dataStarted = true;
  C.onValue(ref(db, `sports/${S}`), snap => {
    const v = snap.val() || {};
    teams = v.teams || {};
    matches = v.matches || {};
    render();
  }, err => toast("No access: " + err.message, 4000));
  C.onValue(annRef(), snap => { ann = snap.val(); renderAnnBar(); }, () => {});
  setInterval(renderAnnBar, 20000);   // drops an expired announcement from view
}

// ---------------------------------------------------------------- tabs
$$("#tabs button").forEach(b => b.onclick = () => goTab(b.dataset.tab));
function goTab(t) {
  tab = t === "score" ? tab : t;
  if (logUnsub && t !== "log") { logUnsub(); logUnsub = null; }
  if (t === "score" && curId) { show("vScore"); renderScore(); return; }
  if (t === "list") { show("vList"); renderList(); }
  if (t === "setup") { show("vSetup"); renderSetup(); }
  if (t === "log") { show("vLog"); startLog(); }
}
function render() {
  if (curId) return renderScore();
  if (tab === "list") renderList();
  if (tab === "setup") renderSetup();
}

// ---------------------------------------------------------------- list
function scoreCells(m) {
  if ((m.status || "scheduled") === "scheduled") return ["", ""];
  const v = view(S, m, C.now());
  if (m.status === "done") {
    if (m.wo) return [m.winner === "a" ? "W/O" : "", m.winner === "b" ? "W/O" : ""];
    return v.sc;
  }
  if (v.small && KIND !== "goals") return [`${v.big[0]} <span class="muted">(${v.small[0]})</span>`, `${v.big[1]} <span class="muted">(${v.small[1]})</span>`];
  return v.big;
}

function renderList() {
  const all = arrMatches();
  const courts = [...new Set(all.map(m => String(m.court ?? "")).filter(Boolean))]
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  if (courtFilter && !courts.includes(courtFilter)) courtFilter = "";
  $("#courtChips").innerHTML = (courts.length > 1 ? [["", "All courts"], ...courts.map(c => [c, "Court " + c])] : [])
    .map(([c, l]) => `<button data-court="${esc(c)}" class="${c === courtFilter ? "on" : ""}">${esc(l)}</button>`).join("");
  $$("#courtChips button").forEach(b => b.onclick = () => {
    courtFilter = b.dataset.court; store("ja_court_" + S, courtFilter || null); renderList();
  });

  const list = all.filter(m => !courtFilter || String(m.court) === courtFilter);
  if (!list.length) {
    $("#matchList").innerHTML = `<div class="card muted">No matches yet. ${Object.keys(teams).length ? "Add them in the Setup tab." : "Start by adding teams in the Setup tab."}</div>`;
    return;
  }
  const groups = [["live", "Live now"], ["scheduled", "Up next"], ["done", "Finished"]];
  $("#matchList").innerHTML = groups.map(([st, title]) => {
    const g = list.filter(m => (m.status || "scheduled") === st);
    if (!g.length) return "";
    return `<div class="group-title">${title} (${g.length})</div>` + g.map(m => {
      const [sa, sb] = scoreCells(m);
      const lk = lockedByOther(m) ? `<span class="badge lock">🔒 ${esc(m.lock.name)}</span>` : "";
      const live = st === "live" ? `<span class="badge live">LIVE</span>` : "";
      const v = st !== "scheduled" ? view(S, m, C.now()) : null;
      return `<button class="mcard ${st}" data-open="${m.id}">
        <div class="mtop"><span>#${esc(m.no)}</span>${m.time ? `<span>${esc(m.time)}</span>` : ""}
          ${m.court ? `<span>Court ${esc(m.court)}</span>` : ""}${m.round ? `<span>${esc(m.round)}</span>` : ""}
          ${m.event ? `<span>${esc(m.event)}</span>` : ""}<span style="flex:1"></span>${live}${lk}</div>
        <div class="mteams"><span class="${m.winner === "a" && st === "done" ? "win" : ""}">${esc(tn(m.teamA))}</span><b>${sa}</b>
          <span class="${m.winner === "b" && st === "done" ? "win" : ""}">${esc(tn(m.teamB))}</span><b>${sb}</b></div>
        ${v && v.hist ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(v.hist)}</div>` : ""}
      </button>`;
    }).join("");
  }).join("");
  $$("#matchList [data-open]").forEach(b => b.onclick = () => openMatch(b.dataset.open));
}

// ---------------------------------------------------------------- locks
async function takeLock(id, force) {
  let blocked = null;
  const r = await C.runTransaction(matchRef(id), m => {
    if (!m) return m;
    if (!force && lockedByOther(m)) { blocked = m.lock; return; }
    m.lock = { dev: DEV, name: NAME || "?", at: C.now() };
    return m;
  });
  if (r.committed && r.snapshot.val() && r.snapshot.val().lock && r.snapshot.val().lock.dev === DEV) return true;
  return blocked || false;
}
async function releaseLock(id) {
  try {
    await C.runTransaction(matchRef(id), m => {
      if (!m || !m.lock || m.lock.dev !== DEV) return;
      delete m.lock;
      return m;
    });
  } catch (e) { /* ignore */ }
}

async function openMatch(id, force = false) {
  const m = matches[id];
  if (!m) return;
  if (!force && lockedByOther(m)) {
    if (!confirm(`${m.lock.name} is scoring this match on another device.\n\nTake control? (Only do this if they've stopped.)`)) return;
    force = true;
  }
  const res = await takeLock(id, force);
  if (res !== true) {
    if (res && confirm(`${res.name} took this match just now. Take control anyway?`)) return openMatch(id, true);
    if (!res) toast("Could not open match – check connection");
    return;
  }
  if (force) log(id, m, "took control");
  curId = id; entry = "";
  show("vScore");
  renderScore();
  clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    if (!curId) return;
    C.runTransaction(matchRef(curId), mm => {
      if (!mm || !mm.lock || mm.lock.dev !== DEV) return;
      mm.lock.at = C.now();
      return mm;
    }).catch(() => {});
  }, 45000);
  clearInterval(ticker);
  ticker = setInterval(tickClock, 250);
  window.scrollTo(0, 0);
}

// next scheduled match on the same court (lowest match number); any court if this one has none
function nextOnCourt(m) {
  const sched = arrMatches().filter(x => x.id !== curId && (x.status || "scheduled") === "scheduled");
  const same = sched.filter(x => String(x.court || "") === String(m.court || ""));
  return (m.court ? same : sched)[0] || null;
}

async function backToList() {
  const id = curId;
  curId = null; entry = "";
  clearInterval(heartbeat); clearInterval(ticker);
  goTab("list");
  if (id) await releaseLock(id);
}

window.addEventListener("pagehide", () => { if (curId) releaseLock(curId); });

// ---------------------------------------------------------------- actions
async function act(mutate, label) {
  const id = curId;
  if (!id) return false;
  let reason = "";
  try {
    const r = await track(C.runTransaction(matchRef(id), m => {
      reason = "";
      if (!m) return m;
      if (!m.lock || m.lock.dev !== DEV) { reason = "lock"; return; }
      if (mutate(m) === false) { reason = "noop"; return; }
      m.lock.at = C.now();
      m.updatedAt = C.now();
      return m;
    }));
    if (!r.committed) {
      if (reason === "lock") toast("Another device has control of this match.", 3500);
      return false;
    }
    const m = r.snapshot.val();
    if (!m) return false;
    publish(id, m);
    if (label) log(id, m, label);
    return true;
  } catch (e) {
    toast("Error: " + e.message, 4000);
    return false;
  }
}
const tapOK = () => { const t = Date.now(); if (t - lastTap < 300) return false; lastTap = t; return true; };
const buzz = () => { try { navigator.vibrate && navigator.vibrate(25); } catch (e) {} };

const A = {
  start(side) {
    return act(m => {
      if ((m.status || "scheduled") !== "scheduled") return false;
      m.status = "live"; m.startedAt = C.now();
      if (side) m.firstServer = side;
      if (KIND === "goals") { m.clock = { run: false, el: 0 }; m.events = m.events || ""; }
      if (KIND === "rally") m.rallies = m.rallies || "";
      if (KIND === "darts") m.turns = m.turns || "";
    }, "match started" + (side ? ` (${side.toUpperCase()} first)` : ""));
  },
  unstart() {
    return act(m => {
      if (m.status !== "live" || m.rallies || m.events || m.turns) return false;
      m.status = "scheduled"; delete m.startedAt; delete m.clock;
    }, "reset to not started");
  },
  finish() {
    const m = matches[curId];
    const v = view(S, m, C.now());
    const msg = v.winner ? `${sideName(m, v.winner)} wins` : "Draw";
    if (!confirm(`Confirm final result?\n\n${tn(m.teamA)} ${v.sc[0]} – ${v.sc[1]} ${tn(m.teamB)}\n${msg}`)) return;
    return act(mm => {
      const vv = view(S, mm, C.now());
      mm.status = "done"; mm.winner = vv.winner || ""; mm.endedAt = C.now();
      if (mm.clock && mm.clock.run) mm.clock = { run: false, el: (mm.clock.el || 0) + Math.max(0, C.now() - mm.clock.st) };
    }, "result confirmed: " + msg);
  },
  reopen() {
    if (!confirm("Reopen this match? The result will be removed until you confirm it again.")) return;
    return act(m => { m.status = "live"; m.winner = null; m.wo = null; }, "match reopened");
  },
  walkover(side) {
    const m = matches[curId];
    if (!confirm(`Walkover: ${sideName(m, side)} wins?`)) return;
    return act(mm => { mm.status = "done"; mm.winner = side; mm.wo = true; }, `walkover – ${side.toUpperCase()} wins`);
  },
  // rally
  point(side) {
    if (!tapOK()) return;
    buzz();
    const m = matches[curId];
    return act(mm => {
      if (mm.status !== "live") return false;
      if (deriveRally(mm, fmtOf(S, mm)).winner) return false;
      mm.rallies = (mm.rallies || "") + side;
    }, `+1 ${sideName(m, side)}`);
  },
  undoRally() {
    return act(m => { if (!m.rallies || m.status !== "live") return false; m.rallies = m.rallies.slice(0, -1); }, "undo point");
  },
  // goals
  goal(side) {
    if (!tapOK()) return;
    buzz();
    const m = matches[curId];
    return act(mm => { if (mm.status !== "live") return false; mm.events = (mm.events || "") + side; }, `goal ${sideName(m, side)}`);
  },
  foul(side) {
    if (!tapOK()) return;
    const m = matches[curId];
    return act(mm => { if (mm.status !== "live") return false; mm.events = (mm.events || "") + side.toUpperCase(); }, `foul ${sideName(m, side)}`);
  },
  undoGoals() {
    const m = matches[curId];
    const last = (m.events || "").slice(-1);
    if (!last) return;
    const what = last === "|" ? "the end of the last period" : /[ab]/.test(last) ? `the last goal (${sideName(m, last)})` : `the last foul (${sideName(m, last.toLowerCase())})`;
    if (!confirm(`Undo ${what}?`)) return;
    return act(mm => { if (!mm.events || mm.status !== "live") return false; mm.events = mm.events.slice(0, -1); }, "undo " + what);
  },
  clockToggle() {
    return act(m => {
      if (m.status !== "live") return false;
      const c = m.clock || { run: false, el: 0 };
      if (c.run) m.clock = { run: false, el: (c.el || 0) + Math.max(0, C.now() - (c.st || C.now())) };
      else m.clock = { run: true, st: C.now(), el: c.el || 0 };
    }, null);
  },
  setClock() {
    const m = matches[curId];
    const cur = mmss(clockMs(m.clock, C.now()));
    const s = prompt("Time already played in this period (mm:ss):", cur);
    if (s == null) return;
    const mt = s.trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/);
    if (!mt) return toast("Use mm:ss, e.g. 12:30");
    const ms = (Number(mt[1]) * 60 + Number(mt[2] || 0)) * 1000;
    return act(mm => { mm.clock = { run: false, el: ms }; }, "clock set to " + s.trim());
  },
  endPeriod() {
    const m = matches[curId];
    const d = deriveGoals(m, fmtOf(S, m));
    const name = periodName(S, d.period + 1, d.periods);
    if (!confirm(`End ${name}? The clock will reset for the next period.`)) return;
    return act(mm => {
      const dd = deriveGoals(mm, fmtOf(S, mm));
      if (mm.status !== "live" || dd.ended) return false;
      mm.events = (mm.events || "") + "|";
      mm.clock = { run: false, el: 0 };
    }, "end of " + name);
  },
  penalties() {
    const m = matches[curId];
    const cur = m.pen ? `${m.pen.a}-${m.pen.b}` : "";
    const s = prompt(`Penalty shoot-out score (${tn(m.teamA)} - ${tn(m.teamB)}), e.g. 4-3.\nLeave empty to remove.`, cur);
    if (s == null) return;
    if (!s.trim()) return act(mm => { mm.pen = null; }, "penalties removed");
    const mt = s.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!mt) return toast("Use the format 4-3");
    return act(mm => { mm.pen = { a: Number(mt[1]), b: Number(mt[2]) }; }, "penalties " + s.trim());
  },
  // darts
  turn(v) {
    const m = matches[curId];
    const d = deriveDarts(m, fmtOf(S, m));
    if (v > 180) return toast("Maximum is 180");
    if (d.thrower && v === d.rem[d.thrower === "a" ? 0 : 1] && !confirm(`Checkout ${v} for ${sideName(m, d.thrower)}? (Finished on a double)`)) return;
    entry = "";
    buzz();
    return act(mm => {
      if (mm.status !== "live") return false;
      if (deriveDarts(mm, fmtOf(S, mm)).winner) return false;
      mm.turns = (mm.turns ? mm.turns + "," : "") + v;
    }, `${sideName(m, d.thrower)} scored ${v}`);
  },
  undoDarts() {
    return act(m => {
      if (!m.turns || m.status !== "live") return false;
      const t = m.turns.split(","); t.pop(); m.turns = t.join(",");
    }, "undo turn");
  }
};

// ---------------------------------------------------------------- scoring screen
function swapped() { return store("ja_swap_" + curId) === "1"; }

function headerHTML(m) {
  const items = [];
  const st = m.status || "scheduled";
  if (st !== "done") {
    items.push(`<button data-a="wo" data-s="a">Walkover – ${esc(tn(m.teamA))} wins</button>`);
    items.push(`<button data-a="wo" data-s="b">Walkover – ${esc(tn(m.teamB))} wins</button>`);
  }
  if (KIND === "goals" && st === "live") {
    items.push(`<button data-a="setClock">Set clock time…</button>`);
    items.push(`<button data-a="pens">Penalty shoot-out result…</button>`);
  }
  if (st === "live" && !(m.rallies || m.events || m.turns)) items.push(`<button data-a="unstart">Back to "not started"</button>`);
  if (st === "done") items.push(`<button data-a="reopen">Reopen match</button>`);
  items.push(`<button data-a="announce">📢 Make an announcement…</button>`);
  items.push(`<button data-a="swap">Swap sides on this screen</button>`);
  items.push(`<button data-a="release">Release match (let another device score)</button>`);
  return `<div class="shead">
    <button class="ghost" data-a="back">← Matches</button>
    <div class="info"><b>${esc(tn(m.teamA))} vs ${esc(tn(m.teamB))}</b>
      <div class="muted">#${esc(m.no)}${m.court ? " · Court " + esc(m.court) : ""}${m.round ? " · " + esc(m.round) : ""}${m.event ? " · " + esc(m.event) : ""}</div></div>
    <details class="menu" id="menu"><summary>More ▾</summary><div class="items">${items.join("")}</div></details>
  </div>`;
}

function sideBox(m, s, opts) {
  const cls = s === "a" ? "A" : "B";
  const tag = opts.tag ? `<span class="stag">${esc(opts.tag)}</span>` : "";
  const srv = opts.serving ? `<span class="sserve">● ${KIND === "darts" ? "THROWING" : "SERVING"}</span>` : "";
  const inner = `${srv}${tag}<div class="sname">${esc(sideName(m, s))}</div>
    <div class="sscore">${opts.big}</div><div class="ssmall">${opts.small || ""}</div>${opts.hint ? `<div class="hint">${opts.hint}</div>` : ""}`;
  return opts.button
    ? `<button class="side ${cls} ${opts.serving ? "serving" : ""}" data-pt="${s}" ${opts.disabled ? "disabled" : ""}>${inner}</button>`
    : `<div class="side ${cls} ${opts.serving ? "serving" : ""}" style="min-height:22vh">${inner}</div>`;
}

function renderScore() {
  const m = matches[curId];
  if (!m) { toast("This match was deleted."); backToList(); return; }
  const wasOpen = $("#menu") && $("#menu").open;
  const mine = m.lock && m.lock.dev === DEV;
  const st = m.status || "scheduled";
  const f = fmtOf(S, m);
  const order = swapped() ? ["b", "a"] : ["a", "b"];
  let html = headerHTML(m);

  if (!mine) html += `<div class="banner warn">${m.lock ? esc(m.lock.name) + " has control of this match." : "You don't have control of this match."}
    <button class="small" data-a="take" style="margin-left:8px">Take control</button></div>`;
  if (st === "done") {
    const v = view(S, m, C.now());
    const w = m.winner ? `${esc(sideName(m, m.winner))} wins` : "Draw";
    html += `<div class="banner ok">FINAL${m.wo ? " (walkover)" : ""}: ${w}${m.wo ? "" : ` · ${v.sc[0]} – ${v.sc[1]}`}${v.hist ? `<div class="muted" style="font-weight:400">${esc(v.hist)}</div>` : ""}</div>`;
    const nx = nextOnCourt(m);
    html += nx
      ? `<button class="primary nextbtn" data-a="next" data-id="${nx.id}"><span>Next${m.court ? " on Court " + esc(m.court) : ""}: #${esc(nx.no)}${nx.time ? " · " + esc(nx.time) : ""}<small style="color:inherit;opacity:.85">${esc(tn(nx.teamA))} vs ${esc(tn(nx.teamB))}${lockedByOther(nx) ? " · 🔒 " + esc(nx.lock.name) : ""}</small></span><span class="ar">→</span></button>`
      : `<button class="nextbtn" data-a="back"><span>No more matches${m.court ? " on Court " + esc(m.court) : ""}<small>Back to the match list</small></span><span class="ar">←</span></button>`;
  }

  if (st === "scheduled") {
    if (KIND === "goals") {
      html += `<div class="card" style="text-align:center"><h3>Ready?</h3><p class="muted">${f.periods} × ${f.minutes} min</p>
        <button class="primary" data-a="start" ${mine ? "" : "disabled"} style="padding:18px 30px;font-size:18px">Start match</button></div>`;
    } else {
      html += `<div class="card" style="text-align:center"><h3>${KIND === "darts" ? "Who throws first?" : "Who serves first?"}</h3>
        <div class="gbtns"><button class="ga" data-a="start" data-s="a" ${mine ? "" : "disabled"}>${esc(tn(m.teamA))}</button>
        <button class="gb" data-a="start" data-s="b" ${mine ? "" : "disabled"}>${esc(tn(m.teamB))}</button></div>
        <p class="muted">Format: ${KIND === "darts" ? `best of ${f.bestOf} legs, ${f.start}` : `best of ${f.bestOf}, ${f.points} points${f.cap ? " (max " + f.cap + ")" : ""}`}</p></div>`;
    }
  }

  if (st !== "scheduled" && KIND === "rally") html += rallyBody(m, f, mine, order);
  if (st !== "scheduled" && KIND === "goals") html += goalsBody(m, f, mine, order);
  if (st !== "scheduled" && KIND === "darts") html += dartsBody(m, f, mine, order);

  const el = $("#vScore");
  el.innerHTML = html;
  if (wasOpen && $("#menu")) $("#menu").open = true;
  el.onclick = onScoreClick;
  tickClock();
}

function rallyBody(m, f, mine, order) {
  const d = deriveRally(m, f);
  const live = m.status === "live";
  let h = "";
  if (live && d.winner) h += `<div class="banner ok">${esc(sideName(m, d.winner))} has won ${d.won[0]}–${d.won[1]}.
      <button class="small primary" data-a="finish" style="margin-left:8px">Confirm result</button>
      <span class="muted" style="font-weight:400"> or Undo if the last point was wrong.</span></div>`;
  else if (live && d.interval) h += `<div class="banner warn">Interval — ${d.rules.points === 21 || d.rules.points === 15 ? Math.ceil(d.rules.points / 2) : "half"} points reached${d.deciding ? ". Change ends." : "."}</div>`;
  else if (live) h += `<div class="ptitle">${UNIT} ${d.gameNo}${d.deciding ? " · decider" : ""} · to ${d.rules.points}${d.rules.cap ? " (max " + d.rules.cap + ")" : ""}</div>`;
  h += `<div class="court">` + order.map(s => sideBox(m, s, {
    button: true, disabled: !mine || !live || !!d.winner,
    big: d.winner ? d.won[s === "a" ? 0 : 1] : d.cur[s === "a" ? 0 : 1],
    small: `${UNIT}s won: ${d.won[s === "a" ? 0 : 1]}`,
    serving: live && !d.winner && d.srv === s, tag: live ? d.point[s] : null,
    hint: live && !d.winner ? "Tap to add a point" : ""
  })).join("") + `</div>`;
  if (live) h += `<div class="controls"><button data-a="undoRally" ${mine && m.rallies ? "" : "disabled"}>↶ Undo last point</button></div>`;
  if (d.games.length) h += `<div class="hist">${UNIT}s: ${d.games.map(g => g.join("–")).join(" · ")}</div>`;
  return h;
}

function goalsBody(m, f, mine, order) {
  const d = deriveGoals(m, f);
  const live = m.status === "live";
  const per = Math.min(d.period + 1, d.periods);
  let h = "";
  if (live && d.ended) h += `<div class="banner ok">Regular time finished · ${d.score[0]}–${d.score[1]}${d.pen ? ` (pens ${d.pen[0]}–${d.pen[1]})` : ""}.
     ${d.draw ? "It's a draw – for knockouts add penalties under More. " : ""}
     <button class="small primary" data-a="finish" style="margin-left:8px">Confirm result</button></div>`;
  else if (live) h += `<div class="ptitle">${periodName(S, per, d.periods)} · ${f.minutes} min</div>
     <div class="clock" id="clockText">--:--</div>`;
  h += `<div class="court">` + order.map(s => sideBox(m, s, {
    button: false, big: d.score[s === "a" ? 0 : 1],
    small: f.fouls && !d.ended ? `Fouls this half: <b>${d.fouls[s === "a" ? 0 : 1]}</b>${d.fouls[s === "a" ? 0 : 1] >= 5 ? " ⚠" : ""}` : ""
  })).join("") + `</div>`;
  if (live) {
    const run = m.clock && m.clock.run;
    if (!d.ended) h += `<div class="controls"><button class="primary" data-a="clock" ${mine ? "" : "disabled"} style="font-size:18px">${run ? "⏸ Pause clock" : "▶ Start clock"}</button></div>`;
    h += `<div class="gbtns">` + order.map(s => `<button class="g${s}" data-a="goal" data-s="${s}" ${mine && !d.ended ? "" : "disabled"}>+ Goal<br><small>${esc(sideName(m, s))}</small></button>`).join("") + `</div>`;
    if (f.fouls && !d.ended) h += `<div class="gbtns">` + order.map(s => `<button data-a="foul" data-s="${s}" ${mine ? "" : "disabled"}>+ Foul ${esc(sideName(m, s))}</button>`).join("") + `</div>`;
    h += `<div class="controls">
      <button data-a="undoGoals" ${mine && m.events ? "" : "disabled"}>↶ Undo last</button>
      ${!d.ended ? `<button data-a="endPeriod" ${mine ? "" : "disabled"}>End ${periodName(S, per, d.periods)}</button>` : ""}
      ${!d.ended ? `<button class="ghost" data-a="finish" ${mine ? "" : "disabled"}>End match early</button>` : ""}</div>`;
  }
  const hist = d.perPeriod.slice(0, d.periods).filter((p, i) => i <= d.period).map((p, i) => `${periodName(S, i + 1, d.periods)} ${p.join("–")}`);
  if (hist.length) h += `<div class="hist">${hist.join(" · ")}${d.pen ? ` · Pens ${d.pen[0]}–${d.pen[1]}` : ""}</div>`;
  return h;
}

function dartsBody(m, f, mine, order) {
  const d = deriveDarts(m, f);
  const live = m.status === "live";
  let h = "";
  if (live && d.winner) h += `<div class="banner ok">${esc(sideName(m, d.winner))} has won ${d.won[0]}–${d.won[1]} legs.
     <button class="small primary" data-a="finish" style="margin-left:8px">Confirm result</button></div>`;
  else if (live) h += `<div class="ptitle">Leg ${d.legNo} · ${d.start} · best of ${f.bestOf}</div>`;
  h += `<div class="court">` + order.map(s => sideBox(m, s, {
    button: false, big: d.winner ? d.won[s === "a" ? 0 : 1] : d.rem[s === "a" ? 0 : 1],
    small: `Legs: ${d.won[s === "a" ? 0 : 1]}${d.lastTurn[s] != null ? ` · Last: ${d.lastTurn[s]}` : ""}`,
    serving: live && !d.winner && d.thrower === s
  })).join("") + `</div>`;
  if (live && !d.winner) {
    const dis = mine ? "" : "disabled";
    h += `<div class="ptitle" style="margin-top:12px">Score for <b>${esc(sideName(m, d.thrower))}</b> (3 darts)</div>
      <div class="entry" id="entry">${entry || "&nbsp;"}</div>
      <div class="quick">${[0, 26, 41, 45, 60, 81, 85, 100, 140, 180].map(v => `<button data-a="quick" data-v="${v}" ${dis}>${v}</button>`).join("")}</div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-a="key" data-v="${n}" ${dis}>${n}</button>`).join("")}
        <button data-a="key" data-v="C" ${dis}>Clear</button><button data-a="key" data-v="0" ${dis}>0</button>
        <button class="primary" data-a="enter" ${dis}>Enter</button></div>
      <p class="muted" style="font-size:13px">Bust (over the score, or leaving 1) is counted as 0 automatically.</p>`;
  }
  if (live) h += `<div class="controls"><button data-a="undoDarts" ${mine && m.turns ? "" : "disabled"}>↶ Undo last turn</button></div>`;
  return h;
}

function tickClock() {
  const el = $("#clockText");
  if (!el || !curId) return;
  const m = matches[curId];
  if (!m) return;
  const f = fmtOf(S, m);
  const len = (Number(f.minutes) || 20) * 60000;
  const ms = clockMs(m.clock, C.now());
  const left = len - ms;
  el.textContent = left >= 0 ? mmss(left) : "+" + mmss(-left);
  el.classList.toggle("over", left < 0);
}

function onScoreClick(e) {
  const b = e.target.closest("[data-a],[data-pt]");
  if (!b || b.disabled) return;
  if (b.dataset.pt) return A.point(b.dataset.pt);
  const a = b.dataset.a, s = b.dataset.s;
  if (b.closest("#menu")) $("#menu").open = false;
  switch (a) {
    case "back": return backToList();
    case "take": return openMatch(curId, true);
    case "next": {
      const id = curId, to = b.dataset.id;
      curId = null; clearInterval(heartbeat); clearInterval(ticker);
      return releaseLock(id).then(() => openMatch(to));
    }
    case "start": return A.start(s);
    case "unstart": return A.unstart();
    case "finish": return A.finish();
    case "reopen": return A.reopen();
    case "wo": return A.walkover(s);
    case "announce": return openAnn();
    case "swap": store("ja_swap_" + curId, swapped() ? null : "1"); return renderScore();
    case "release": { const id = curId; curId = null; clearInterval(heartbeat); clearInterval(ticker); goTab("list"); return releaseLock(id); }
    case "undoRally": return A.undoRally();
    case "clock": return A.clockToggle();
    case "goal": return A.goal(s);
    case "foul": return A.foul(s);
    case "undoGoals": return A.undoGoals();
    case "endPeriod": return A.endPeriod();
    case "setClock": return A.setClock();
    case "pens": return A.penalties();
    case "undoDarts": return A.undoDarts();
    case "quick": return A.turn(Number(b.dataset.v));
    case "key": {
      const v = b.dataset.v;
      if (v === "C") entry = "";
      else if (entry.length < 3) entry = (entry + v).replace(/^0+(?=\d)/, "");
      $("#entry").innerHTML = entry || "&nbsp;";
      return;
    }
    case "enter": if (entry === "") return toast("Type the score first"); return A.turn(Number(entry));
  }
}

// ---------------------------------------------------------------- setup
function teamOptions(sel) {
  const arr = Object.entries(teams).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return `<option value="">— choose —</option>` + arr.map(([id, t]) =>
    `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(t.name)}${t.group ? " (" + esc(t.group) + ")" : ""}</option>`).join("");
}

function fmtFields(f) {
  const n = (id, label, val, ph = "") => `<div><label>${label}</label><input id="${id}" inputmode="numeric" value="${val ?? ""}" placeholder="${ph}"></div>`;
  if (KIND === "rally") return `
    <div><label>Best of</label><select id="xBestOf">${[1, 3, 5].map(v => `<option ${v == f.bestOf ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    ${n("xPoints", "Points per " + UNIT.toLowerCase(), f.points)}${n("xCap", "Max points (cap)", f.cap || "", "none")}
    ${n("xDecPoints", "Decider points", f.decPoints || "", "same")}${n("xDecCap", "Decider max", f.decCap || "", "same")}`;
  if (KIND === "goals") return `${n("xPeriods", "Periods", f.periods)}${n("xMinutes", "Minutes per period", f.minutes)}
    <div><label>Count fouls</label><select id="xFouls"><option value="1" ${f.fouls ? "selected" : ""}>Yes</option><option value="0" ${!f.fouls ? "selected" : ""}>No</option></select></div>`;
  return `<div><label>Best of (legs)</label><select id="xBestOf">${[1, 3, 5, 7].map(v => `<option ${v == f.bestOf ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div><label>Start score</label><select id="xStart">${[301, 501, 701].map(v => `<option ${v == f.start ? "selected" : ""}>${v}</option>`).join("")}</select></div>`;
}
function readFmt() {
  const num = id => { const v = $("#" + id) && $("#" + id).value.trim(); return v === "" || v == null ? 0 : Number(v) || 0; };
  const base = FORMATS[S];
  if (KIND === "rally") return { ...base, bestOf: num("xBestOf") || 3, points: num("xPoints") || base.points, cap: num("xCap"),
    decPoints: num("xDecPoints") || null, decCap: num("xDecCap") || null };
  if (KIND === "goals") return { periods: num("xPeriods") || base.periods, minutes: num("xMinutes") || base.minutes, fouls: $("#xFouls").value === "1" };
  return { bestOf: num("xBestOf") || 3, start: num("xStart") || 501 };
}

function nextNo() {
  return Math.max(0, ...Object.values(matches).map(m => Number(m.no) || 0)) + 1;
}

let editingTeam = null;   // team being edited in Setup
function renderSetup() {
  // teams
  const tarr = Object.entries(teams).sort((a, b) => (a[1].group || "").localeCompare(b[1].group || "") || a[1].name.localeCompare(b[1].name));
  // keep whatever is being typed if the list refreshes while editing
  const draft = editingTeam && $("#teName") ? { name: $("#teName").value, short: $("#teShort").value, group: $("#teGroup").value } : null;
  if (editingTeam && !teams[editingTeam]) editingTeam = null;
  $("#teamList").innerHTML = tarr.length ? `<table class="teams"><tr><th>Team</th><th></th></tr>` +
    tarr.map(([id, t]) => {
      if (id === editingTeam) {
        const d = draft || t;
        return `<tr class="tedit"><td colspan="2">
          <div class="tegrid">
            <div><label>Team name</label><input id="teName" value="${esc(d.name)}"></div>
            <div><label>Short name</label><input id="teShort" value="${esc(d.short || "")}" placeholder="optional"></div>
            <div><label>Group</label><input id="teGroup" value="${esc(d.group || "")}" placeholder="e.g. A"></div>
          </div>
          <div class="row" style="margin-top:10px"><button class="small primary" data-tsave="${id}">Save</button><button class="small ghost" data-tcancel>Cancel</button></div>
        </td></tr>`;
      }
      const sub = [t.short, t.group ? "Group " + t.group : ""].filter(Boolean).join(" · ");
      return `<tr><td><b>${esc(t.name)}</b>${sub ? `<br><span class="muted" style="font-size:12px">${esc(sub)}</span>` : ""}</td>
        <td style="text-align:right;white-space:nowrap"><button class="small" data-te="${id}">Edit</button> <button class="small danger" data-td="${id}">Delete</button></td></tr>`;
    }).join("") + `</table>`
    : `<p class="muted">No teams yet.</p>`;
  $$("[data-te]").forEach(b => b.onclick = () => { editingTeam = b.dataset.te; renderSetup(); const i = $("#teName"); if (i) { i.focus(); i.select(); } });
  $$("[data-td]").forEach(b => b.onclick = () => deleteTeam(b.dataset.td));
  $$("[data-tsave]").forEach(b => b.onclick = () => saveTeam(b.dataset.tsave));
  $$("[data-tcancel]").forEach(b => b.onclick = () => { editingTeam = null; renderSetup(); });
  $$("#teamList .tedit input").forEach(i => i.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); saveTeam(editingTeam); }
    if (e.key === "Escape") { editingTeam = null; renderSetup(); }
  });

  // form selects (keep current choices)
  const ca = $("#fA").value, cb = $("#fB").value;
  $("#fA").innerHTML = teamOptions(ca);
  $("#fB").innerHTML = teamOptions(cb);
  if (!$("#fFmt").dataset.ready) { $("#fFmt").innerHTML = fmtFields(FORMATS[S]); $("#fFmt").dataset.ready = "1"; }
  if (!$("#fNo").value && !editingId) $("#fNo").value = nextNo();

  const groups = [...new Set(Object.values(teams).map(t => t.group).filter(Boolean))].sort();
  const cg = $("#rrGroup").value;
  $("#rrGroup").innerHTML = groups.length ? groups.map(g => `<option ${g === cg ? "selected" : ""}>${esc(g)}</option>`).join("") : `<option value="">(give teams a group first)</option>`;

  // matches table
  const arr = arrMatches();
  $("#setupMatches").innerHTML = arr.length ? `<table><tr><th>#</th><th>Time</th><th>Court</th><th>Round</th><th>Match</th><th>Status</th><th></th></tr>` +
    arr.map(m => `<tr><td>${esc(m.no)}</td><td>${esc(m.time)}</td><td>${esc(m.court)}</td><td>${esc(m.round)}${m.event ? "<br><span class=muted>" + esc(m.event) + "</span>" : ""}</td>
      <td>${esc(tn(m.teamA))} <span class="muted">vs</span> ${esc(tn(m.teamB))}</td><td>${esc(m.status || "scheduled")}</td>
      <td style="text-align:right;white-space:nowrap"><button class="small" data-me="${m.id}">Edit</button> <button class="small danger" data-md="${m.id}">Delete</button></td></tr>`).join("") + `</table>`
    : `<p class="muted">No matches yet.</p>`;
  $$("[data-me]").forEach(b => b.onclick = () => editMatch(b.dataset.me));
  $$("[data-md]").forEach(b => b.onclick = () => deleteMatch(b.dataset.md));
}

$("#btnAddTeams").onclick = async () => {
  const lines = $("#teamBulk").value.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return toast("Type at least one team");
  const existing = new Set(Object.values(teams).map(t => t.name.toLowerCase()));
  let added = 0;
  const upd = {};
  for (const l of lines) {
    const [name, short, group] = l.split("|").map(x => (x || "").trim());
    if (!name || existing.has(name.toLowerCase())) continue;
    existing.add(name.toLowerCase());
    const id = C.push(ref(db, `sports/${S}/teams`)).key;
    upd[id] = { name, short: short || "", group: (group || "").toUpperCase() };
    added++;
  }
  if (!added) return toast("Those teams already exist");
  await C.update(ref(db, `sports/${S}/teams`), upd);
  $("#teamBulk").value = "";
  toast(`${added} team(s) added`);
};

async function saveTeam(id) {
  if (!id || !teams[id]) return;
  const name = $("#teName").value.trim(), short = $("#teShort").value.trim(), group = $("#teGroup").value.trim().toUpperCase();
  if (!name) { toast("Team name can't be empty"); $("#teName").focus(); return; }
  const clash = Object.entries(teams).some(([k, t]) => k !== id && t.name.toLowerCase() === name.toLowerCase());
  if (clash) { toast("Another team already has that name"); $("#teName").focus(); return; }
  const val = { name, short, group };
  try {
    await C.update(ref(db, `sports/${S}/teams/${id}`), val);
  } catch (e) { toast("Couldn't save – check the connection"); return; }
  teams[id] = val;
  editingTeam = null;
  renderSetup();
  await republishAll();   // update names on the public page and big screen
  toast("Team updated");
}
async function deleteTeam(id) {
  const used = Object.values(matches).some(m => m.teamA === id || m.teamB === id);
  if (used) return toast("This team is in a match. Delete or change those matches first.", 3500);
  if (!confirm(`Delete ${teams[id].name}?`)) return;
  await C.remove(ref(db, `sports/${S}/teams/${id}`));
}

function clearForm(keep = true) {
  editingId = null;
  $("#mfTitle").textContent = "Add match";
  $("#btnSaveMatch").textContent = "Add match";
  $("#btnCancelEdit").classList.add("hide");
  $("#fA").value = ""; $("#fB").value = "";
  $("#fNo").value = nextNo(); $("#fTime").value = "";
  if (!keep) {
    $("#fCourt").value = ""; $("#fRound").value = ""; $("#fGroup").value = ""; $("#fEvent").value = "";
    $("#fFmt").innerHTML = fmtFields(FORMATS[S]);
  }
}
$("#btnCancelEdit").onclick = () => clearForm(false);

function editMatch(id) {
  const m = matches[id];
  editingId = id;
  $("#mfTitle").textContent = `Edit match #${m.no}`;
  $("#btnSaveMatch").textContent = "Save changes";
  $("#btnCancelEdit").classList.remove("hide");
  $("#fNo").value = m.no ?? ""; $("#fTime").value = m.time || ""; $("#fCourt").value = m.court || "";
  $("#fRound").value = m.round || ""; $("#fGroup").value = m.group || ""; $("#fEvent").value = m.event || "";
  $("#fA").value = m.teamA || ""; $("#fB").value = m.teamB || "";
  $("#fFmt").innerHTML = fmtFields(fmtOf(S, m));
  $("#matchFormCard").scrollIntoView({ behavior: "smooth" });
}

$("#btnSaveMatch").onclick = async () => {
  const fields = {
    no: $("#fNo").value.trim(), time: $("#fTime").value.trim(), court: $("#fCourt").value.trim(),
    round: $("#fRound").value.trim(), group: $("#fGroup").value.trim().toUpperCase(), event: $("#fEvent").value.trim(),
    teamA: $("#fA").value, teamB: $("#fB").value, fmt: readFmt()
  };
  if (!fields.teamA || !fields.teamB) return toast("Choose both teams");
  if (fields.teamA === fields.teamB) return toast("Team A and B must be different");
  if (editingId) {
    const old = matches[editingId];
    if (old.status === "live" && (old.teamA !== fields.teamA || old.teamB !== fields.teamB) && !confirm("This match is live. Change the teams anyway?")) return;
    await C.update(matchRef(editingId), { ...fields, updatedAt: C.now() });
    publish(editingId, { ...old, ...fields });
    log(editingId, fields, "match edited");
    toast("Match saved");
    clearForm(true);
  } else {
    const r = C.push(ref(db, `sports/${S}/matches`));
    const m = { ...fields, status: "scheduled", createdAt: C.now(), updatedAt: C.now() };
    await C.set(r, m);
    publish(r.key, m);
    toast(`Match #${fields.no} added`);
    clearForm(true);
  }
};

async function deleteMatch(id) {
  const m = matches[id];
  if (!confirm(`Delete match #${m.no}: ${tn(m.teamA)} vs ${tn(m.teamB)}?${m.status !== "scheduled" ? "\n\nIt already has scores!" : ""}`)) return;
  await C.remove(matchRef(id));
  publish(id, null);
  log(id, m, "match deleted");
  if (editingId === id) clearForm(false);
}

$("#btnRR").onclick = async () => {
  const g = $("#rrGroup").value;
  if (!g) return toast("Give teams a group first");
  const ids = Object.entries(teams).filter(([, t]) => t.group === g).map(([id]) => id);
  if (ids.length < 2) return toast("Need at least 2 teams in the group");
  // circle method so teams rest between matches
  const list = ids.length % 2 ? [...ids, null] : [...ids];
  const pairs = [];
  for (let r = 0; r < list.length - 1; r++) {
    for (let i = 0; i < list.length / 2; i++) {
      const x = list[i], y = list[list.length - 1 - i];
      if (x && y) pairs.push([x, y]);
    }
    list.splice(1, 0, list.pop());
  }
  if (!confirm(`Create ${pairs.length} matches for Group ${g}?`)) return;
  let no = nextNo();
  const upd = {}, pubs = {};
  for (const [x, y] of pairs) {
    const id = C.push(ref(db, `sports/${S}/matches`)).key;
    const m = { no: String(no++), time: "", court: $("#rrCourt").value.trim(), round: "Group " + g, group: g,
      event: $("#rrEvent").value.trim(), teamA: x, teamB: y, fmt: FORMATS[S], status: "scheduled", createdAt: C.now(), updatedAt: C.now() };
    upd[id] = m;
    pubs[id] = publicRecord(S, m, teams);
  }
  await C.update(ref(db, `sports/${S}/matches`), upd);
  await C.update(ref(db, `pub/${S}/m`), pubs);
  toast(`${pairs.length} matches created`);
};

$("#btnRepublish").onclick = async () => {
  try { await republishAll(); toast("Public data refreshed"); } catch (e) { toast("Error: " + e.message); }
};

// ---------------------------------------------------------------- log
function startLog() {
  if (logUnsub) return;
  logUnsub = C.onValue(C.query(ref(db, `logs/${S}`), C.limitToLast(150)), snap => {
    const rows = [];
    snap.forEach(c => { rows.push(c.val()); });
    rows.reverse();
    $("#logList").innerHTML = rows.length ? `<table><tr><th>Time</th><th>By</th><th>Match</th><th>Action</th></tr>` +
      rows.map(r => `<tr><td style="white-space:nowrap">${r.at ? new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</td>
        <td>${esc(r.by)}</td><td>${r.no !== "" && r.no != null ? "#" + esc(r.no) : "—"}</td><td>${esc(r.act)}</td></tr>`).join("") + `</table>` : `<p class="muted">Nothing yet.</p>`;
  }, err => { $("#logList").innerHTML = `<p class="muted">Cannot read log: ${esc(err.message)}</p>`; });
}


// ---------------------------------------------------------------- announcements
// Scorers post a short message for their own sport. Stored at pub/<sport>/ann, so the
// big screen and the public live page pick it up without any admin step.
let ann = null, annMins = 30;
const annRef = () => ref(db, `pub/${S}/ann`);
const annActive = a => !!(a && a.t && (!a.exp || a.exp > C.now()));
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ANN_QUICK = [
  "Next match starts in 5 minutes",
  "Short break – play resumes in 10 minutes",
  "Calling teams to Court ",
  "Matches are running late – thank you for waiting",
  "Final match of the day is now on",
  "Results and prize giving coming soon",
];

function renderAnnBar() {
  const el = $("#annBar");
  if (!el) return;
  if (annActive(ann)) {
    const until = ann.exp ? "until " + hhmm(ann.exp) : "until removed";
    el.innerHTML = `<div class="annbar"><div class="ic">📢</div>
      <div class="tx"><b>${esc(ann.t)}</b><small>On the big screen &amp; live page · ${until}${ann.by ? " · by " + esc(ann.by) : ""}</small></div>
      <div class="act"><button class="small" data-ann="edit">Change</button><button class="small danger" data-ann="clear">Remove</button></div></div>`;
  } else {
    el.innerHTML = `<button class="annbtn" data-ann="new">📢 Make an announcement</button>`;
  }
}
$("#annBar").addEventListener("click", e => {
  const b = e.target.closest("[data-ann]");
  if (!b) return;
  if (b.dataset.ann === "clear") return clearAnn();
  openAnn();
});

function openAnn() {
  $("#annSport").textContent = SP.name;
  const cur = annActive(ann) ? ann.t : "";
  $("#annText").value = cur;
  $("#annPost").textContent = cur ? "Update announcement" : "Post announcement";
  $("#annQuick").innerHTML = ANN_QUICK.map(q => `<button type="button">${esc(q)}</button>`).join("");
  setDur(annActive(ann) && !ann.exp ? 0 : annMins);
  annCount();
  $("#annModal").classList.remove("hide");
  setTimeout(() => $("#annText").focus(), 50);
}
function closeAnn() { $("#annModal").classList.add("hide"); }
function setDur(m) {
  annMins = m;
  $$("#annDur button").forEach(b => b.classList.toggle("on", Number(b.dataset.m) === m));
}
function annCount() {
  const n = $("#annText").value.length;
  $("#annCount").textContent = `${n} / 140`;
  $("#annPost").disabled = !$("#annText").value.trim();
}
$("#annText").addEventListener("input", annCount);
$("#annQuick").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const t = $("#annText");
  t.value = b.textContent;
  annCount();
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);   // "Calling teams to Court " → just type the number
});
$("#annDur").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setDur(Number(b.dataset.m)); });
$("#annCancel").onclick = closeAnn;
$("#annModal").addEventListener("click", e => { if (e.target.id === "annModal") closeAnn(); });

$("#annPost").onclick = async () => {
  const t = $("#annText").value.replace(/\s+/g, " ").trim().slice(0, 140);
  if (!t) return;
  const at = C.now();
  try {
    await C.set(annRef(), { t, by: NAME || "", at, exp: annMins ? at + annMins * 60000 : 0 });
    log(null, null, "announce: " + t);
    closeAnn();
    toast("📢 Announcement posted");
  } catch (err) { toast("Could not post: " + err.message, 4000); }
};

async function clearAnn() {
  if (!confirm("Remove this announcement from the big screen and live page?")) return;
  try {
    await C.remove(annRef());
    log(null, null, "announcement removed");
    toast("Announcement removed");
  } catch (err) { toast("Could not remove: " + err.message, 4000); }
}

// ---------------------------------------------------------------- feedback (→ Admin → Feedback)
let fbType = "Suggestion";
$("#fbOpen").onclick = () => {
  $("#fbText").value = "";
  $("#fbInfo").textContent = `Sent with your name (${NAME || "—"}), ${SP.name}, the time and your device.`;
  $("#fbModal").classList.remove("hide");
  setTimeout(() => $("#fbText").focus(), 50);
};
$("#fbCancel").onclick = () => $("#fbModal").classList.add("hide");
$("#fbModal").onclick = e => { if (e.target.id === "fbModal") $("#fbModal").classList.add("hide"); };
$$("#fbType button").forEach(b => b.onclick = () => { fbType = b.dataset.ty; $$("#fbType button").forEach(x => x.classList.toggle("on", x === b)); });
$("#fbSend").onclick = async () => {
  const msg = $("#fbText").value.trim();
  if (!msg) return toast("Type a message first");
  const u = navigator.userAgent;
  const dev = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows PC" : /Mac/.test(u) ? "Mac" : "Other";
  const m = curId && matches[curId];
  $("#fbSend").disabled = true;
  try {
    await track(C.push(ref(db, "feedback"), {
      type: fbType, msg: msg.slice(0, 500), sport: S, page: SP.name + " scorer", by: NAME || "?",
      acct: (auth.currentUser && auth.currentUser.email) || "", dev,
      team: m ? `#${m.no} ${tn(m.teamA)} vs ${tn(m.teamB)}` : "", at: C.serverTimestamp()
    }));
    $("#fbModal").classList.add("hide");
    toast("Thanks! Feedback sent ✓");
  } catch (e) { toast("Couldn't send: " + (e.code || e.message), 4000); }
  $("#fbSend").disabled = false;
};

// ---------------------------------------------------------------- paste schedule (Setup)
let pasteRows = [];
const normName = x => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
function findTeam(name) {
  const n = normName(name);
  if (!n) return null;
  const hit = Object.entries(teams).find(([, t]) => normName(t.name) === n) || Object.entries(teams).find(([, t]) => t.short && normName(t.short) === n);
  return hit ? hit[0] : null;
}
function parsePaste(txt) {
  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const split = l => (l.includes("\t") ? l.split("\t") : l.includes("|") ? l.split("|") : l.split(",")).map(x => x.trim());
  const rows = lines.map(split);
  if (rows.length && /^(no|#|match|bil)/i.test(rows[0][0] || "") && !/\d/.test(rows[0][0])) rows.shift();   // header row
  const usedNos = new Set(Object.values(matches).map(m => String(m.no)));
  const seen = new Set();
  return rows.map(c => {
    const [no = "", time = "", court = "", a = "", b = "", round = "", group = "", event = ""] = c;
    const r = { no, time, court, a, b, round, group: group.toUpperCase(), event, ta: findTeam(a), tb: findTeam(b), problems: [], skip: false };
    if (!a || !b) r.problems.push("needs Team A and Team B");
    else if (normName(a) === normName(b)) r.problems.push("same team twice");
    if (no && (usedNos.has(String(no)) || seen.has(String(no)))) { r.skip = true; r.problems.push(`match #${no} already exists – skipped`); }
    if (no) seen.add(String(no));
    return r;
  });
}
function renderPaste() {
  const create = $("#pasteNewTeams").checked;
  const missing = [...new Set(pasteRows.flatMap(r => [[r.a, r.ta], [r.b, r.tb]]).filter(([n, id]) => n && !id).map(([n]) => n.trim()))];
  const bad = r => r.problems.length && !r.skip || (!create && ((r.a && !r.ta) || (r.b && !r.tb)));
  const ok = pasteRows.filter(r => !r.skip && !bad(r));
  const cell = (n, id) => `${esc(n)}${n && !id ? ` <span class="muted">(${create ? "new" : "unknown"})</span>` : ""}`;
  $("#pastePreview").innerHTML = pasteRows.length ? `
    <p style="margin:0 0 8px;font-weight:600">${ok.length} match${ok.length === 1 ? "" : "es"} ready to add${pasteRows.length - ok.length ? ` · ${pasteRows.length - ok.length} with a problem (shown in red, won't be added)` : ""}.</p>
    ${missing.length && !create ? `<div class="banner warn" style="margin:0 0 8px">Unknown team${missing.length > 1 ? "s" : ""}: ${missing.map(esc).join(", ")}. Fix the spelling, add ${missing.length > 1 ? "them" : "it"} under Teams above, or tick “Create teams that don't exist yet”.</div>` : ""}
    <table class="paste"><tr><th>#</th><th>Time</th><th>Court</th><th>Team A</th><th>Team B</th><th>Round</th><th>Group</th><th>Event</th><th></th></tr>
    ${pasteRows.map(r => `<tr class="${r.skip ? "skip" : bad(r) ? "bad" : ""}"><td>${esc(r.no) || "auto"}</td><td>${esc(r.time)}</td><td>${esc(r.court)}</td><td>${cell(r.a, r.ta)}</td><td>${cell(r.b, r.tb)}</td>
      <td>${esc(r.round)}</td><td>${esc(r.group)}</td><td>${esc(r.event)}</td><td>${r.problems.map(esc).join("; ") || (bad(r) ? "unknown team" : "✓")}</td></tr>`).join("")}</table>` : "";
  $("#btnPasteAdd").classList.toggle("hide", !ok.length);
  $("#btnPasteAdd").textContent = `Add ${ok.length} match${ok.length === 1 ? "" : "es"}`;
  $("#btnPasteClear").classList.toggle("hide", !pasteRows.length);
  return ok;
}
$("#btnPastePreview").onclick = () => {
  if (!$("#pasteText").value.trim()) return toast("Paste the schedule first");
  pasteRows = parsePaste($("#pasteText").value);
  renderPaste();
};
$("#pasteNewTeams").onchange = () => { if (pasteRows.length) renderPaste(); };
$("#btnPasteClear").onclick = () => { pasteRows = []; $("#pasteText").value = ""; renderPaste(); };
$("#btnPasteAdd").onclick = async () => {
  pasteRows = parsePaste($("#pasteText").value);          // re-check against the latest data
  const ok = renderPaste();
  if (!ok.length) return;
  if (!confirm(`Add ${ok.length} match${ok.length === 1 ? "" : "es"} to ${SP.name}?`)) return;
  const tUpd = {}, made = {};
  const teamId = name => {
    const ex = findTeam(name); if (ex) return ex;
    const k = normName(name); if (made[k]) return made[k];
    const id = C.push(ref(db, `sports/${S}/teams`)).key;
    tUpd[id] = { name: name.trim().replace(/\s+/g, " "), short: "", group: "" };
    teams[id] = tUpd[id]; made[k] = id;
    return id;
  };
  let no = Math.max(nextNo(), ...ok.map(r => (Number(r.no) || 0) + 1));   // numbers for rows without one
  const upd = {}, pubs = {};
  for (const r of ok) {
    const a = teamId(r.a), b = teamId(r.b);
    // group: from the Group column; otherwise "Group X" in Round; otherwise both teams' shared group (group stage only)
    let g = r.group || ((r.round.match(/^group\s+(\w+)/i) || [])[1] || "").toUpperCase();
    if (!g && !/final|semi|quarter|3rd|third|place/i.test(r.round) && teams[a].group && teams[a].group === teams[b].group) g = teams[a].group;
    const id = C.push(ref(db, `sports/${S}/matches`)).key;
    const m = { no: r.no || String(no++), time: r.time, court: r.court, round: r.round || (g ? "Group " + g : ""), group: g, event: r.event,
      teamA: a, teamB: b, fmt: FORMATS[S], status: "scheduled", createdAt: C.now(), updatedAt: C.now() };
    upd[id] = m;
    pubs[id] = publicRecord(S, m, teams);
  }
  try {
    if (Object.keys(tUpd).length) await track(C.update(ref(db, `sports/${S}/teams`), tUpd));
    await track(C.update(ref(db, `sports/${S}/matches`), upd));
    await track(C.update(ref(db, `pub/${S}/m`), pubs));
    log(null, null, `pasted schedule: ${ok.length} matches` + (Object.keys(tUpd).length ? `, ${Object.keys(tUpd).length} new teams` : ""));
    toast(`${ok.length} matches added ✓`);
    pasteRows = []; $("#pasteText").value = ""; renderPaste();
  } catch (e) { toast("Error: " + (e.code || e.message), 4000); }
};
