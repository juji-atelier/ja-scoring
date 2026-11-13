import { SPORTS, ADMIN_EMAIL, EMAIL_DOMAIN, EVENT_DEFAULTS } from "../config.js?v=20261113w";
import { FORMATS, ENGINE_OF, fmtOf, deriveRally, deriveGoals, deriveDarts, view, publicRecord,
         clockMs, mmss, periodName, timeline, parsePlayers, DETAILS, catColor, standings } from "../js/engines.js?v=20261113w";
import * as C from "../js/common.js?v=20261113w";
import { applySportInfo } from "../js/sportinfo.js?v=20261113w";
import { bracketHTML, hasBracket } from "../js/bracket.js?v=20261113w";
const { $, $$, esc, toast, store, ref } = C;

// ---------------------------------------------------------------- boot
const S = (new URLSearchParams(location.search).get("sport") || "").toLowerCase();
const SP = SPORTS[S];
const CW = (SP && SP.court) || "Court";      // Table / Court / Lane / Pitch / Board
const cw = CW.toLowerCase();
// the markup is written with "Court" – put this sport's word in its place
function applyCourtWord() {
  if (CW === "Court") return;
  const set = (sel, f) => { const e = document.querySelector(sel); if (e) f(e); };
  // this one's label has no "for", so it is found through the field's own row
  const fc = document.querySelector("#fCourt"), fcl = fc && fc.parentElement.querySelector("label");
  if (fcl) fcl.textContent = CW;
  set('label[for="fxTables"]', e => e.textContent = CW + "s in the room");
  set('label[for="koCourt"]', e => e.textContent = CW);
  set('label[for="inName"]', e => e.textContent = "Your name / " + cw);
  set("#inName", e => e.placeholder = "e.g. Ali \u2013 " + CW + " 1");
  set("#fCourt", e => e.placeholder = "e.g. 1");
  set("#annText", e => e.placeholder = `e.g. Calling JKR and JPN to ${CW} 2`);
  set("#fxTurnWrap", e => { const t = e.lastChild; if (t && t.nodeType === 3) t.textContent = ` Pools take turns (A, B, A, B\u2026) \u2013 best when they share one ${cw}`; });
}
applyCourtWord();
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
let mainVenue = EVENT_DEFAULTS.venue, eventName = EVENT_DEFAULTS.name;
function showSportHead() {
  document.title = `${SP.name} · Scorer`;
  $("#sportName").textContent = SP.name;
  $("#sportDay").textContent = `${SP.day} · ${SP.venue || mainVenue}`;
}
showSportHead();
// name / date / venue can be changed in Admin
C.onValue(ref(C.db, "settings"), s => { const v = s.val() || {}; applySportInfo(v.sportInfo); mainVenue = v.venue || EVENT_DEFAULTS.venue; eventName = v.event || EVENT_DEFAULTS.name; showSportHead(); }, () => {});
// wording of the (i) hints depends on the sport ("points per game" vs "per set")
if (window.JAHints) { window.JAHints.ctx = { sport: S, name: SP.name, unit: UNIT, kind: KIND }; window.JAHints.apply(); }

let DEV = store("ja_dev");
if (!DEV) { DEV = Math.random().toString(36).slice(2, 10); store("ja_dev", DEV); }
let NAME = store("ja_name") || "";
$("#inName").value = NAME;

let adminMode = false, isAdmin = false;
let teams = {}, matches = {};
let tab = "list", curId = null, editingId = null;
let courtFilter = store("ja_court_" + S) || "";
let catFilter = store("ja_cat_" + S) || "";
let dataStarted = false, logUnsub = null, heartbeat = null, ticker = null;
let entry = ""; // darts keypad entry
let lastTap = 0;

// ---------------------------------------------------------------- helpers
const tn = id => (teams[id] && teams[id].name) || "TBC";
// a side of a match: the team, or for knockouts not decided yet the slot label ("1st Pool A", "Winner Semi-final 1")
const tnm = (m, s) => { const id = s === "a" ? m.teamA : m.teamB; return (teams[id] && teams[id].name) || (s === "a" ? m.labA : m.labB) || "TBC"; };
// pair / player names shown under the team (sports without a numbered roster, e.g. badminton "Ali / Abu")
const tp = id => (KIND === "goals" && DETAILS[S]) ? "" : String((teams[id] && teams[id].players) || "").split(/\r?\n/).filter(Boolean).join(" / ");
// Category = e.g. "MIX DOUBLE". Older teams had the category typed into "group".
const isOld = t => !!t && t.category == null && !!t.group && t.group.length > 2;
const catOf = t => (t ? (t.category != null ? t.category : (isOld(t) ? t.group : "")) : "") || "";
const poolOf = t => (t ? (t.category != null ? (t.group || "") : (isOld(t) ? "" : (t.group || ""))) : "");
const keyOf = t => { const c = catOf(t), p = poolOf(t); return (c ? c + (p ? " – POOL " + p : "") : p).toUpperCase(); };
// A pool is the letter only ("A"); the number after it is the team's place inside that pool
// (its seed). People copying a paper draw often type the whole code ("A1") into the Pool box,
// which would leave every team alone in a pool of its own, so split it: "A1" -> A + 1.
const POOLCODE = /^([A-Z]+)\s*[-.\u00b7]?\s*(\d{1,2})$/;
const splitPool = raw => {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
  const m = s.match(POOLCODE);
  return m ? { group: m[1], seed: +m[2] } : { group: s, seed: null };
};
// A match's "Group" box holds the pool only, never the place inside it.
const poolLetters = raw => splitPool(raw).group;
// Teams still holding a whole draw code in the Pool box.
const miscodedPools = () => Object.entries(teams).filter(([, t]) => t.seed == null && POOLCODE.test(poolOf(t)));
const cats = () => [...new Set([...Object.values(teams).map(catOf), ...Object.values(matches).map(m => m.event || "")]
  .filter(Boolean))].sort((a, b) => a.localeCompare(b));
const normCat = c => { c = (c || "").trim(); return cats().find(x => x.toLowerCase() === c.toLowerCase()) || c; };
const sameCat = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
const sideName = (m, s) => tnm(m, s);
const matchRef = id => ref(db, `sports/${S}/matches/${id}`);
const arrMatches = () => Object.entries(matches).map(([id, m]) => ({ id, ...m })).sort(C.byNo);
const lockFresh = m => m.lock && (C.now() - (m.lock.at || 0) < LOCK_STALE);
const lockedByOther = m => lockFresh(m) && m.lock.dev !== DEV;

function show(v) {
  for (const id of ["vLogin", "vList", "vTeams", "vSetup", "vLog", "vGuide", "vScore"]) $("#" + id).classList.add("hide");
  $("#" + v).classList.remove("hide");
  $("#tabs").classList.toggle("hide", v === "vLogin" || v === "vScore" || (v === "vGuide" && !auth.currentUser));
  if (v === "vGuide") { renderGuide(); $("#btnGuideBack").classList.toggle("hide", !!auth.currentUser); }
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
    `<small>${online ? "Slow connection. Keep scoring – nothing is lost." : "Keep scoring on this phone – everything is saved here and sends by itself when the connection is back. Try to keep this page open. If it closes, open it again and you will be asked to send the saved scores."}</small>`;
}
setInterval(renderPending, 1000);
addEventListener("beforeunload", e => { if (pending) { e.preventDefault(); e.returnValue = ""; } });

// Public copy for the big screen and the live page. Live matches are also copied to
// pub/<sport>/live – a tiny list the public page checks every few seconds (saves download data).
function publish(id, m) {
  if (!m) {
    track(C.remove(ref(db, `pub/${S}/live/${id}`))).catch(() => {});
    return track(C.remove(ref(db, `pub/${S}/m/${id}`))).catch(() => {});
  }
  const rec = publicRecord(S, m, teams);
  const upd = { [`m/${id}`]: rec, [`live/${id}`]: rec.st === "live" ? rec : null };
  return track(C.update(ref(db, `pub/${S}`), upd)).catch(e => console.warn(e));
}
async function republishAll() {
  const all = {}, live = {};
  for (const [id, m] of Object.entries(matches)) { all[id] = publicRecord(S, m, teams); if (all[id].st === "live") live[id] = all[id]; }
  await C.update(ref(db, `pub/${S}`), { m: all, live: Object.keys(live).length ? live : null });
}
function log(id, m, act) {
  track(C.push(ref(db, `logs/${S}`), {
    m: id, no: (m && m.no) ?? "", act, by: NAME || "?", dev: DEV, at: C.serverTimestamp()
  })).catch(() => {});
}

// ---------------------------------------------------------------- unsent scores (safety net)
// While an action hasn't reached the server, the match's score is also kept in this
// phone's storage. If the page is refreshed or closed while offline, the next visit
// finds it here and offers to send it.
const UNSENT_KEY = "ja_unsent_" + S;
const SCORE_FIELDS = ["status", "rallies", "events", "turns", "pen", "winner", "wo", "firstServer", "startedAt", "endedAt", "clock", "tl"];
const unsentOpen = {};   // match id → actions still on their way (this page load)
const unsentAll = () => { try { return JSON.parse(store(UNSENT_KEY) || "{}") || {}; } catch (e) { return {}; } };
const unsentPut = all => store(UNSENT_KEY, Object.keys(all).length ? JSON.stringify(all) : null);
const scoreOf = m => { const o = {}; for (const f of SCORE_FIELDS) if (m && m[f] != null) o[f] = m[f]; return o; };
const sameScore = (x, y) => { const k = o => { const c = { ...o }; delete c.clock; delete c.startedAt; delete c.endedAt; return JSON.stringify(c, Object.keys(c).sort()); }; return k(scoreOf(x)) === k(scoreOf(y)); };
function unsentNote(id, base, m) {
  try {
    const all = unsentAll(), old = all[id];
    all[id] = { base: old && unsentOpen[id] > 1 ? old.base : base, at: Date.now(), m: scoreOf(m) };
    unsentPut(all);
  } catch (e) { /* storage full or blocked – scoring still works */ }
}
function unsentSettle(id) {
  unsentOpen[id] = Math.max(0, (unsentOpen[id] || 1) - 1);
  if (unsentOpen[id]) return;
  try { const all = unsentAll(); if (all[id]) { delete all[id]; unsentPut(all); } } catch (e) {}
}
function renderUnsent() {
  const el = $("#unsentBar"); if (!el) return;
  let all; try { all = unsentAll(); } catch (e) { return; }
  let changed = false; const rows = [];
  for (const [id, u] of Object.entries(all)) {
    if (unsentOpen[id]) continue;                       // still sending in this page
    const m = matches[id];
    if (!m || !u || !u.m || sameScore(m, u.m)) { delete all[id]; changed = true; continue; }
    const sc = x => { const v = view(S, { ...m, ...x }, C.now()); return `${v.big[0]}–${v.big[1]}${v.small ? ` (${UNIT.toLowerCase()}s ${v.small[0]}–${v.small[1]})` : ""}`; };
    const gone = {}; for (const f of SCORE_FIELDS) gone[f] = null;
    rows.push(`<div class="urow"><div><b>#${esc(m.no)} ${esc(tnm(m, "a"))} vs ${esc(tnm(m, "b"))}</b>
      <small>On this phone: <b>${sc({ ...gone, ...u.m })}</b> · Saved online: <b>${sc({})}</b>${(m.updatedAt || 0) !== (u.base || 0) ? " · ⚠ changed on another device since" : ""}</small></div>
      <button class="small primary" data-usend="${id}">Send now</button><button class="small" data-udrop="${id}">Discard</button></div>`);
  }
  if (changed) unsentPut(all);
  el.classList.toggle("hide", !rows.length);
  el.innerHTML = rows.length ? `⚠ Scores entered on this phone were not sent (the page closed while offline)${rows.join("")}` : "";
}
async function unsentSend(id) {
  const u = unsentAll()[id], m0 = matches[id];
  if (!u || !m0) return renderUnsent();
  if (lockedByOther(m0) && !confirm(`${m0.lock.name} is scoring this match on another device now.\n\nReplace the score with the one saved on this phone?`)) return;
  try {
    const r = await track(C.runTransaction(matchRef(id), m => {
      if (!m) return m;
      for (const f of SCORE_FIELDS) { if (u.m[f] == null) delete m[f]; else m[f] = u.m[f]; }
      m.updatedAt = C.now();
      return m;
    }));
    if (!r.committed || !r.snapshot.val()) return toast("Could not send – check the connection", 3500);
    publish(id, r.snapshot.val());
    log(id, r.snapshot.val(), "sent scores saved on this phone");
    const all = unsentAll(); delete all[id]; unsentPut(all);
    toast("Saved scores sent ✓");
  } catch (e) { toast("Error: " + e.message, 4000); }
  renderUnsent();
}
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest("[data-usend]"), d = e.target.closest && e.target.closest("[data-udrop]");
  if (a) unsentSend(a.dataset.usend);
  if (d && confirm("Discard the score saved on this phone? The online score stays as it is.")) {
    const all = unsentAll(); delete all[d.dataset.udrop]; unsentPut(all); renderUnsent();
  }
});

// ---------------------------------------------------------------- keyboard (laptop scorers)
// A = left side, L = right side, Z = undo. Futsal/netball: Space = clock. Darts: type the score, Enter.
document.addEventListener("keydown", e => {
  if (!curId || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const box = $("#vScore");
  if (!box || box.classList.contains("hide") || document.querySelector("dialog[open]")) return;
  const t = e.target;
  if (t && t.closest && t.closest("input,textarea,select,[contenteditable]")) return;
  const press = sel => { const b = box.querySelector(sel); if (!b || b.disabled) return false; e.preventDefault(); b.click(); return true; };
  const side = i => (swapped() ? ["b", "a"] : ["a", "b"])[i];
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (KIND === "rally") {
    if (k === "a") press(`[data-pt="${side(0)}"]`);
    else if (k === "l") press(`[data-pt="${side(1)}"]`);
    else if (k === "z") press(`[data-a="undoRally"]`);
  } else if (KIND === "goals") {
    if (k === "a") press(`[data-a="goal"][data-s="${side(0)}"]`);
    else if (k === "l") press(`[data-a="goal"][data-s="${side(1)}"]`);
    else if (k === "z") press(`[data-a="undoGoals"]`);
    else if (k === " ") press(`[data-a="clock"]`);
  } else if (KIND === "darts") {
    if (/^[0-9]$/.test(k)) press(`[data-a="key"][data-v="${k}"]`);
    else if (k === "Backspace" || k === "Delete") press(`[data-a="key"][data-v="C"]`);
    else if (k === "Enter") press(`[data-a="enter"]`);
    else if (k === "z") press(`[data-a="undoDarts"]`);
  }
});
const KB_HINT = { rally: "<kbd>A</kbd> left side +1 · <kbd>L</kbd> right side +1 · <kbd>Z</kbd> undo",
  goals: "<kbd>A</kbd> goal left · <kbd>L</kbd> goal right · <kbd>Space</kbd> clock · <kbd>Z</kbd> undo",
  darts: "Type the score · <kbd>Enter</kbd> · <kbd>Backspace</kbd> clear · <kbd>Z</kbd> undo" };

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
    renderUnsent();
    autoFillKO();
    autoTidyPools();
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
  if (t === "teams") { show("vTeams"); renderTeams(); }
  if (t === "setup") { show("vSetup"); renderSetup(); }
  if (t === "guide") { show("vGuide"); }
  if (t === "log") { show("vLog"); startLog(); }
}
function render() {
  if (curId) return renderScore();
  if (tab === "list") renderList();
  if (tab === "setup") renderSetup();
  if (tab === "teams") renderTeams();
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

function matchCard(m, st) {
  const [sa, sb] = scoreCells(m);
  const lk = lockedByOther(m) ? `<span class="badge lock">🔒 ${esc(m.lock.name)}</span>` : "";
  const v = st !== "scheduled" ? view(S, m, C.now()) : null;
  const col = catColor(m.event || "", Object.values(matches).map(x => x.event || ""));
  const round = m.round && !/^group stage$/i.test(m.round) ? m.round : "";
  const lead = side => {
    if (st === "done") return m.winner === side ? "win" : "";
    if (st !== "live" || !v || !v.big) return "";
    const [x, y] = v.big.map(Number); return (side === "a" ? x > y : y > x) ? "lead" : "";
  };
  const row = (side, id, sc) => `<div class="mrow ${lead(side)}"><div><div class="mnm">${esc(tn(id))}</div>${tp(id) ? `<div class="mpl">${esc(tp(id))}</div>` : ""}</div><b>${sc}</b></div>`;
  return `<button class="mcard m2 ${st}" data-open="${m.id}" style="--c:${col}">
    <div class="mtop">${st === "live" ? `<span class="badge live">LIVE</span>` : ""}${m.event ? `<span class="mcat">${esc(m.event)}</span>` : ""}
      <span>#${esc(m.no)}${m.time ? " · " + esc(m.time) : ""}</span>${round ? `<span>${esc(round)}</span>` : ""}
      <span style="flex:1"></span>${lk}${m.court ? `<span class="mct">${esc(CW)} ${esc(m.court)}</span>` : ""}</div>
    ${row("a", m.teamA, sa)}${row("b", m.teamB, sb)}
    ${v && v.hist ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(v.hist)}</div>` : ""}
  </button>`;
}
// ---------------------------------------------------------------- compact list
// One line per match, grouped by start time, so a day of 26 matches reads as rounds of play on
// about one screen. Live matches keep their full card – those are the ones being watched.
let listView = store("ja_view_" + S) || "full";
function matchRow(m, st) {
  const [sa, sb] = scoreCells(m);
  const col = catColor(m.event || "", Object.values(matches).map(x => x.event || ""));
  const round = m.round && !/^group stage$/i.test(m.round) ? m.round : "";
  const w = s => (st === "done" && m.winner === s ? "win" : "");
  return `<button class="crow ${st}" data-open="${m.id}" style="--c:${col}">
    <span class="cct">${m.court ? esc(CW) + " " + esc(m.court) : "#" + esc(m.no)}</span>
    <span class="cnm"><span class="${w("a")}">${esc(tnm(m, "a"))}</span><i>vs</i><span class="${w("b")}">${esc(tnm(m, "b"))}</span></span>
    ${st === "done" ? `<b class="csc">${esc(String(sa))}–${esc(String(sb))}</b>` : "<span></span>"}
    <span class="crd">${esc(round)}</span></button>`;
}
// by time, then table, then match number; a time heading wherever the time changes
function compactBody(g, st) {
  const t = m => { const x = parseT(m.time || ""); return x == null ? 1e9 : x; };
  const sorted = [...g].sort((a, b) => t(a) - t(b) || (Number(a.court) || 99) - (Number(b.court) || 99) || C.byNo(a, b));
  let last = null, out = "";
  for (const m of sorted) {
    const k = m.time || "";
    if (k !== last) {
      const n = sorted.filter(x => (x.time || "") === k).length;
      out += `<div class="ctime">${k ? esc(k) : "No time yet"} <span>· ${n} match${n > 1 ? "es" : ""}</span></div>`;
      last = k;
    }
    out += matchRow(m, st);
  }
  return out;
}

// Landscape: the day as a timetable – one column per table, one row per start time – so all
// six tables of a round sit side by side. Every status in one grid: live cells are outlined,
// finished ones show the score.
function gridHTML(list) {
  const t = s => { const x = parseT(s || ""); return x == null ? 1e9 : x; };
  const courts = [...new Set(list.map(m => String(m.court || "").trim()))]
    .sort((a, b) => (a === "") - (b === "") || (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  const times = [...new Set(list.map(m => m.time || ""))].sort((a, b) => t(a) - t(b));
  const cats = Object.values(matches).map(x => x.event || "");
  const cell = m => {
    const st = m.status || "scheduled", [sa, sb] = scoreCells(m);
    const round = m.round && !/^group stage$/i.test(m.round) ? m.round : "";
    const w = s => (st === "done" && m.winner === s ? "win" : "");
    return `<button class="gcell ${st}" data-open="${m.id}" style="--c:${catColor(m.event || "", cats)}">
      <span class="gn ${w("a")}">${esc(tnm(m, "a"))}</span>
      <span class="gs">${st === "scheduled" ? "vs" : esc(String(sa)) + " – " + esc(String(sb))}</span>
      <span class="gn ${w("b")}">${esc(tnm(m, "b"))}</span>
      <span class="gr">${st === "live" ? "● LIVE" + (round ? " · " : "") : ""}${esc(round)}</span></button>`;
  };
  const head = `<tr><th></th>${courts.map(c => `<th>${c ? esc(CW) + " " + esc(c) : "No " + esc(cw)}</th>`).join("")}</tr>`;
  const rows = times.map(tm => `<tr><th class="gt">${tm ? esc(tm) : "No time"}</th>${courts.map(c =>
    `<td>${list.filter(m => (m.time || "") === tm && String(m.court || "").trim() === c).sort(C.byNo).map(cell).join("")}</td>`).join("")}</tr>`).join("");
  return `<div class="gwrap"><table class="ggrid" style="--gc:${courts.length}">${head}${rows}</table></div>`;
}

// ---------------------------------------------------------------- export the schedule
// For the PIC to hand out: a clean printable page (Print / Save as PDF) and a WhatsApp-ready text.
// Exports exactly what the filters on screen show: a category and/or a court, or everything.
const tSort = (a, b) => { const t = s => { const x = parseT(s || ""); return x == null ? 1e9 : x; };
  return t(a.time) - t(b.time) || (Number(a.court) || 99) - (Number(b.court) || 99) || C.byNo(a, b); };
function exportScope(list) {
  const cats = [...new Set(list.map(m => m.event || "").filter(Boolean))];
  const parts = [catFilter, courtFilter ? CW + " " + courtFilter : ""].filter(Boolean);
  return { cats, many: cats.length > 1, sub: parts.join(" \u00b7 ") };
}
const roundOf = m => (m.round && !/^group stage$/i.test(m.round) ? m.round : "");
function exportText(list) {
  const sc = exportScope(list), rows = [...list].sort(tSort);
  let out = `*${eventName} \u00b7 ${SP.name}*\n${SP.day} \u00b7 ${SP.venue || mainVenue}` + (sc.sub ? `\n_${sc.sub}_` : "") + "\n";
  let last = null;
  for (const m of rows) {
    const k = m.time || "";
    if (k !== last) { out += `\n*${k || "Time to be confirmed"}*\n`; last = k; }
    const tag = [sc.many ? m.event : "", roundOf(m)].filter(Boolean).join(" \u00b7 ");
    const res = m.status === "done" ? ` *${scoreCells(m).join("\u2013")}*` : "";
    out += `${m.court ? CW + " " + m.court + " \u00b7 " : ""}${tnm(m, "a")} vs ${tnm(m, "b")}${res}${tag ? ` _(${tag})_` : ""}\n`;
  }
  return out.trim() + `\n\nLive scores: ${location.origin}${location.pathname.replace(/scorer\/.*$/, "live/")}?sport=${S}`;
}
function exportPrint(list) {
  const sc = exportScope(list), rows = [...list].sort(tSort);
  // pools first, so everyone can find which group they are in
  const inCats = new Set(list.map(m => m.event || ""));
  const byCat = {};
  Object.entries(teams).filter(([, t]) => poolOf(t) && (!catFilter || sameCat(catOf(t), catFilter)) && inCats.has(catOf(t) || ""))
    .forEach(([id, t]) => { const c = catOf(t) || ""; ((byCat[c] = byCat[c] || {})[poolOf(t)] = byCat[c][poolOf(t)] || []).push([id, t]); });
  const pools = Object.keys(byCat).sort().map(c => `<div class="pc">${c ? `<h3>${esc(c)}</h3>` : ""}<div class="pg">${Object.keys(byCat[c]).sort().map(p =>
    `<div class="pool"><b>Pool ${esc(p)}</b><ol>${byCat[c][p].sort((a, b) => (+a[1].seed || 99) - (+b[1].seed || 99)).map(([id, t]) =>
      `<li>${esc(t.name)}${tp(id) ? `<small>${esc(tp(id))}</small>` : ""}</li>`).join("")}</ol></div>`).join("")}</div></div>`).join("");
  let body = "", last = null;
  for (const m of rows) {
    const k = m.time || "";
    if (k !== last) { body += `${last !== null ? "</tbody></table>" : ""}<h2>${esc(k || "Time to be confirmed")}</h2><table><tbody>`; last = k; }
    const tag = [sc.many ? m.event : "", roundOf(m)].filter(Boolean).join(" \u00b7 ");
    const res = m.status === "done" ? scoreCells(m).join(" \u2013 ") : "";
    body += `<tr><td class="c">${m.court ? esc(CW) + " " + esc(m.court) : ""}</td><td class="m">${esc(tnm(m, "a"))} <i>vs</i> ${esc(tnm(m, "b"))}${res ? ` <b class="r">${esc(res)}</b>` : ""}</td><td class="t">${esc(tag)}</td><td class="n">#${esc(m.no)}</td></tr>`;
  }
  if (last !== null) body += "</tbody></table>";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(SP.name)} schedule \u2013 ${esc(eventName)}</title><style>
*{box-sizing:border-box}body{font:14px/1.35 -apple-system,Inter,Segoe UI,Roboto,sans-serif;color:#16181d;margin:0;padding:22px 26px;background:#fff}
header{border-bottom:3px solid ${SP.color || "#B3162D"};padding-bottom:10px;margin-bottom:14px}
h1{margin:0;font-size:22px}header p{margin:3px 0 0;color:#555}header .f{color:${SP.color || "#B3162D"};font-weight:700}
h2{font-size:15px;margin:16px 0 4px;padding:4px 8px;background:#f2f2f4;border-radius:6px;break-after:avoid}
h3{font-size:13px;margin:12px 0 6px;text-transform:uppercase;letter-spacing:.05em;color:#555}
table{width:100%;border-collapse:collapse;break-inside:avoid}td{padding:5px 8px;border-bottom:1px solid #e5e5e8;vertical-align:top}
td.c{width:78px;font-weight:700;white-space:nowrap}td.m{font-weight:700}td.m i{font-style:normal;font-weight:400;color:#888;margin:0 4px}
td.t{color:#666;font-size:12px;white-space:nowrap;text-align:right}td.n{color:#aaa;font-size:11px;width:36px;text-align:right}
.r{color:${SP.color || "#B3162D"};margin-left:6px}
.pg{display:flex;flex-wrap:wrap;gap:10px}.pool{border:1px solid #e5e5e8;border-radius:8px;padding:8px 12px;min-width:200px;flex:1;break-inside:avoid}
.pool ol{margin:4px 0 0;padding-left:20px}.pool li{margin:2px 0;font-weight:600}.pool small{display:block;font-weight:400;color:#777;font-size:11px}
.sec{margin-top:18px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
.bar{position:sticky;top:0;background:#fff;padding:0 0 12px;display:flex;gap:8px}
.bar button{font:inherit;font-weight:700;padding:9px 14px;border-radius:9px;border:1px solid #ccc;background:#16181d;color:#fff;cursor:pointer}
.bar button+button{background:#fff;color:#16181d}
footer{margin-top:20px;color:#999;font-size:11px}@media print{.bar{display:none}body{padding:0}}
</style></head><body>
<div class="bar"><button onclick="print()">Print / Save as PDF</button><button onclick="close()">Close</button></div>
<header><h1>${esc(SP.name)} \u2013 Schedule</h1><p><span class="f">${esc(eventName)}</span> \u00b7 ${esc(SP.day)} \u00b7 ${esc(SP.venue || mainVenue)}</p>${sc.sub ? `<p>${esc(sc.sub)}</p>` : ""}</header>
${pools ? `<div class="sec">Pools</div>${pools}<div class="sec">Matches</div>` : ""}${body || "<p>No matches.</p>"}
<footer>Live scores: ${esc(location.origin + location.pathname.replace(/scorer\/.*$/, "live/"))}?sport=${esc(S)} \u00b7 printed ${esc(new Date().toLocaleString())}</footer>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups for this page to print the schedule");
  w.document.write(html); w.document.close(); w.focus();
}
async function exportCopy(list) {
  const text = exportText(list);
  try { await navigator.clipboard.writeText(text); toast("Schedule copied \u2013 paste it into WhatsApp", 3500); }
  catch (e) { prompt("Copy the schedule:", text); }
}
async function exportShare(list) {
  try { await navigator.share({ title: `${SP.name} schedule`, text: exportText(list) }); } catch (e) { /* closed */ }
}

function renderList() {
  renderProgress($("#progress"), true);
  renderNextStep($("#nextStep"));
  const all = arrMatches();
  const mc = m => m.event || "";
  const catList = [...new Set(all.map(mc).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (catFilter && !catList.includes(catFilter)) catFilter = "";
  const left = c => all.filter(m => (!c || mc(m) === c) && m.status !== "done").length;
  $("#catChips").innerHTML = catList.length > 1
    ? [["", "All categories"], ...catList.map(c => [c, c])].map(([c, l]) =>
        `<button data-cat="${esc(c)}" class="${c === catFilter ? "on" : ""}">${esc(l)}${left(c) ? ` <span class="cnt">${left(c)}</span>` : ""}</button>`).join("")
    : "";
  $$("#catChips button").forEach(b => b.onclick = () => {
    catFilter = b.dataset.cat; store("ja_cat_" + S, catFilter || null); renderList();
  });
  const inCat = all.filter(m => !catFilter || mc(m) === catFilter);
  const courts = [...new Set(inCat.map(m => String(m.court ?? "")).filter(Boolean))]
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  if (courtFilter && !courts.includes(courtFilter)) courtFilter = "";
  $("#courtChips").innerHTML = (courts.length > 1 ? [["", "All " + cw + "s"], ...courts.map(c => [c, CW + " " + c])] : [])
    .map(([c, l]) => `<button data-court="${esc(c)}" class="${c === courtFilter ? "on" : ""}">${esc(l)}</button>`).join("");
  $$("#courtChips button").forEach(b => b.onclick = () => {
    courtFilter = b.dataset.court; store("ja_court_" + S, courtFilter || null); renderList();
  });
  const list = inCat.filter(m => !courtFilter || String(m.court) === courtFilter);
  if (!list.length) {
    $("#matchList").innerHTML = `<div class="card muted">No matches yet. ${Object.keys(teams).length ? "Add them in the Setup tab." : "Start by adding teams in the Teams tab."}</div>`;
    return;
  }
  const compact = listView === "compact", grid = listView === "grid", brk = listView === "bracket";
  const split = !catFilter && catList.length > 1 && !compact;
  const groups = [["live", "Live now"], ["scheduled", "Up next"], ["done", "Finished"]];
  const bar = `<div class="viewbar">
    <details class="menu exp"><summary>📤 Export schedule</summary><div class="items">
      <button data-exp="print">🖨️ Print / Save as PDF</button>
      <button data-exp="copy">💬 Copy for WhatsApp</button>
      ${navigator.share ? `<button data-exp="share">📤 Share…</button>` : ""}
      <small>${list.length} match${list.length > 1 ? "es" : ""}${catFilter || courtFilter ? " · as filtered above" : ""}</small></div></details>
    <span>View</span>
    <button data-view="grid" class="${grid ? "on" : ""}">⇆ Landscape</button>
    <button data-view="compact" class="${compact ? "on" : ""}">☰ Compact</button>
    <button data-view="full" class="${compact || grid || brk ? "" : "on"}">▦ Full</button>
    <button data-view="bracket" class="${brk ? "on" : ""}">🏆 Bracket</button></div>`;
  // the bracket: the whole knockout of the category (or all of them), whatever court is picked
  const brkHTML = () => {
    const recs = inCat.map(m => ({ ...publicRecord(S, m, teams), id: m.id }));
    return hasBracket(recs) ? `<div class="bwrap">${bracketHTML(recs, { esc, courtWord: CW })}</div>`
      : `<div class="card muted" style="margin-top:14px">No knockout matches yet. Create them in the <b>Teams</b> tab with <b>🏆 Knockout</b> on a category – the bracket then fills itself in as results are confirmed.</div>`;
  };
  $("#matchList").innerHTML = bar + (brk ? brkHTML() : grid ? gridHTML(list) : groups.map(([st, title]) => {
    const g = list.filter(m => (m.status || "scheduled") === st);
    if (!g.length) return "";
    let body;
    if (compact && st !== "live") body = compactBody(g, st);
    else if (split && st !== "live") {
      const byCat = {};
      g.forEach(m => (byCat[mc(m) || "Other"] = byCat[mc(m) || "Other"] || []).push(m));
      body = Object.keys(byCat).sort((a, b) => a.localeCompare(b)).map(c =>
        `<div class="cat-title">${esc(c)} <span class="muted">(${byCat[c].length})</span></div>` + byCat[c].map(m => matchCard(m, st)).join("")).join("");
    } else body = g.map(m => matchCard(m, st)).join("");
    return `<div class="group-title">${title} (${g.length})</div>` + body;
  }).join(""));
  $$("#matchList [data-open]").forEach(b => b.onclick = () => openMatch(b.dataset.open));
  $$("#matchList [data-view]").forEach(b => b.onclick = () => {
    listView = b.dataset.view; store("ja_view_" + S, listView); renderList();
  });
  $$("#matchList [data-exp]").forEach(b => b.onclick = () => {
    b.closest("details").open = false;
    ({ print: exportPrint, copy: exportCopy, share: exportShare })[b.dataset.exp](list);
  });
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
  unsentOpen[id] = (unsentOpen[id] || 0) + 1;
  try {
    const tx = C.runTransaction(matchRef(id), m => {
      reason = "";
      if (!m) return m;
      if (!m.lock || m.lock.dev !== DEV) { reason = "lock"; return; }
      const base = m.updatedAt || 0;
      if (mutate(m) === false) { reason = "noop"; return; }
      m.lock.at = C.now();
      m.updatedAt = C.now();
      unsentNote(id, base, m);   // kept on this phone until the server confirms
      return m;
    });
    const settle = () => unsentSettle(id);
    tx.then(settle, settle);
    const r = await track(tx);
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
// ---- optional match details (goal sports): scorers, cards, minute
const DET = KIND === "goals" ? (DETAILS[S] || {}) : null;
let who = null;   // the open "who scored / who got the card?" strip: { mid, side, kind: g|y|r, tid }
const tlId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const roster = (m, side) => parsePlayers((teams[side === "a" ? m.teamA : m.teamB] || {}).players);
function minuteOf(mm) {
  const f = fmtOf(S, mm), ms = clockMs(mm.clock, C.now());
  if (!ms) return 0;                                      // clock not used → no minute shown
  const d = deriveGoals(mm, f);
  return Math.floor(ms / 60000) + 1 + Math.min(d.period, d.periods - 1) * (Number(f.minutes) || 0);
}
const TL_ICON = { g: "⚽", og: "⚽", y: "🟨", r: "🟥" };
function whoHTML(m) {
  if (!who || who.mid !== curId) return "";
  const goal = who.kind === "g", list = roster(m, who.side);
  const title = goal ? `⚽ Who scored for <b>${esc(sideName(m, who.side))}</b>?` : `${TL_ICON[who.kind]} ${who.kind === "r" ? "Red" : "Yellow"} card – which <b>${esc(sideName(m, who.side))}</b> player?`;
  return `<div class="whobox"><div class="wt">${title} <span class="muted">(optional)</span></div>
    <div class="wl">${list.map(p => `<button data-a="pick" data-n="${esc(p.label)}">${p.no ? `<b>${esc(p.no)}</b> ` : ""}${esc(p.name)}</button>`).join("")}
      <button class="ghost" data-a="pickType">Type a name…</button>
      ${goal ? `<button class="ghost" data-a="pickOwn">Own goal</button>` : `<button class="ghost" data-a="pick" data-n="">No name</button>`}
      <button class="ghost" data-a="pickSkip">${goal ? "Skip" : "Cancel"}</button></div></div>`;
}
function tlHTML(m, mine) {
  const list = timeline(m).filter(e => e.k !== "g" || e.n || roster(m, e.s).length);
  if (!list.length) return "";
  return `<div class="tlist">` + list.map(e => {
    const named = e.n || e.k === "og";
    const txt = e.k === "og" ? `Own goal${e.n ? " – " + esc(e.n) : ""}` : e.n ? esc(e.n) : `<span class="muted">Goal – no name</span>`;
    const btn = !mine ? "" : (e.k === "g" && !e.n) ? `<button class="small" data-a="tlWho" data-id="${e.id}" data-s="${e.s}">Who?</button>` : `<button class="small ghost" data-a="tlDel" data-id="${e.id}" title="Remove">✕</button>`;
    return `<div class="tl ${e.s}"><span class="tm">${e.min ? e.min + "'" : ""}</span><span>${TL_ICON[e.k]}</span><span class="tn">${txt} <span class="muted">· ${esc(sideName(m, e.s))}</span></span>${btn}</div>`;
  }).join("") + `</div>`;
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
    if (!confirm(`Confirm final result?\n\n${tnm(m, "a")} ${v.sc[0]} – ${v.sc[1]} ${tnm(m, "b")}\n${msg}`)) return;
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
  async goal(side) {
    if (!tapOK()) return;
    buzz();
    const m = matches[curId], mid = curId, tid = tlId();
    const ok = await act(mm => {
      if (mm.status !== "live") return false;
      const i = (mm.events || "").length;
      mm.events = (mm.events || "") + side;
      if (DET) { mm.tl = mm.tl || {}; mm.tl[tid] = { k: "g", s: side, n: "", min: minuteOf(mm), i, at: C.now() }; }   // time of the goal; name comes after
    }, `goal ${sideName(m, side)}`);
    // optional: ask who scored (only when this team has a player list)
    if (ok && DET && curId === mid && roster(m, side).length) { who = { mid, tid, side, kind: "g" }; renderScore(); }
  },
  card(side, kind) {
    who = { mid: curId, side, kind };
    renderScore();
  },
  // a player (or typed name) chosen in the "who?" strip
  pick(name, own) {
    const w = who, m = matches[curId];
    if (!w || w.mid !== curId) return;
    who = null;
    if (w.kind === "g") return act(mm => {
      if (!mm.tl || !mm.tl[w.tid]) return false;
      mm.tl[w.tid].n = name; mm.tl[w.tid].k = own ? "og" : "g";
    }, own ? `own goal${name ? " – " + name : ""} (for ${sideName(m, w.side)})` : `scorer: ${name} (${sideName(m, w.side)})`).then(renderScore);
    const tid = tlId();
    return act(mm => {
      if (mm.status !== "live") return false;
      mm.tl = mm.tl || {}; mm.tl[tid] = { k: w.kind, s: w.side, n: name, min: minuteOf(mm), at: C.now() };
    }, `${w.kind === "r" ? "red" : "yellow"} card ${sideName(m, w.side)}${name ? " – " + name : ""}`).then(renderScore);
  },
  tlRemove(tid) {
    const m = matches[curId], e = m && m.tl && m.tl[tid];
    if (!e) return;
    const isGoal = e.k === "g" || e.k === "og";
    if (!confirm(isGoal ? `Remove the name "${e.n}" from this goal? (The goal itself stays – use Undo to remove a goal.)` : `Remove this ${e.k === "r" ? "red" : "yellow"} card${e.n ? " for " + e.n : ""}?`)) return;
    return act(mm => {
      if (!mm.tl || !mm.tl[tid]) return false;
      if (isGoal) { mm.tl[tid].n = ""; mm.tl[tid].k = "g"; } else delete mm.tl[tid];
    }, isGoal ? "goal name removed" : "card removed");
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
    who = null;
    const what = last === "|" ? "the end of the last period" : /[ab]/.test(last) ? `the last goal (${sideName(m, last)})` : `the last foul (${sideName(m, last.toLowerCase())})`;
    if (!confirm(`Undo ${what}?`)) return;
    return act(mm => {
      if (!mm.events || mm.status !== "live") return false;
      mm.events = mm.events.slice(0, -1);
      const gone = mm.events.length;   // a removed goal takes its scorer/time with it
      for (const [tid, e] of Object.entries(mm.tl || {})) if (e && e.i === gone && (e.k === "g" || e.k === "og")) delete mm.tl[tid];
    }, "undo " + what);
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
    const s = prompt(`Penalty shoot-out score (${tnm(m, "a")} - ${tnm(m, "b")}), e.g. 4-3.\nLeave empty to remove.`, cur);
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
    items.push(`<button data-a="wo" data-s="a">Walkover – ${esc(tnm(m, "a"))} wins</button>`);
    items.push(`<button data-a="wo" data-s="b">Walkover – ${esc(tnm(m, "b"))} wins</button>`);
  }
  if (KIND === "goals" && st === "live") {
    items.push(`<button data-a="setClock">Set clock time…</button>`);
    items.push(`<button data-a="pens">Penalty shoot-out result…</button>`);
  }
  if (st === "live" && !(m.rallies || m.events || m.turns)) items.push(`<button data-a="unstart">Back to "not started"</button>`);
  if (st === "done") items.push(`<button data-a="reopen">Reopen match</button>`);
  items.push(`<button data-a="bigscreen">📺 Open the big screen</button>`);
  items.push(`<button data-a="announce">📢 Make an announcement…</button>`);
  items.push(`<button data-a="swap">Swap sides on this screen</button>`);
  items.push(`<button data-a="release">Release match (let another device score)</button>`);
  return `<div class="shead">
    <button class="ghost" data-a="back">← Matches</button>
    <div class="info"><b>${esc(tnm(m, "a"))} vs ${esc(tnm(m, "b"))}</b>
      <div class="muted">#${esc(m.no)}${m.court ? " · Court " + esc(m.court) : ""}${m.round ? " · " + esc(m.round) : ""}${m.event ? " · " + esc(m.event) : ""}</div></div>
    <details class="menu" id="menu"><summary>More ▾</summary><div class="items">${items.join("")}</div></details>
  </div>`;
}

function sideBox(m, s, opts) {
  const cls = s === "a" ? "A" : "B";
  if (opts.tag) opts.tag = String(opts.tag).replace("GAME POINT", UNIT.toUpperCase() + " POINT");
  const tag = opts.tag ? `<span class="stag">${esc(opts.tag)}</span>` : "";
  const srv = opts.serving ? `<span class="sserve">● ${KIND === "darts" ? "THROWING" : "SERVING"}</span>` : "";
  const inner = `${srv}${tag}<div class="sname">${esc(sideName(m, s))}</div>${tp(s === "a" ? m.teamA : m.teamB) ? `<div class="splayers">${esc(tp(s === "a" ? m.teamA : m.teamB))}</div>` : ""}
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
      ? `<button class="primary nextbtn" data-a="next" data-id="${nx.id}"><span>Next${m.court ? " on Court " + esc(m.court) : ""}: #${esc(nx.no)}${nx.time ? " · " + esc(nx.time) : ""}<small style="color:inherit;opacity:.85">${esc(tnm(nx, "a"))} vs ${esc(tnm(nx, "b"))}${lockedByOther(nx) ? " · 🔒 " + esc(nx.lock.name) : ""}</small></span><span class="ar">→</span></button>`
      : `<button class="nextbtn" data-a="back"><span>No more matches${m.court ? " on Court " + esc(m.court) : ""}<small>Back to the match list</small></span><span class="ar">←</span></button>`;
  }

  if (st === "scheduled") {
    if (KIND === "goals" || f.serve === "none") {
      html += `<div class="card" style="text-align:center"><h3>Ready?</h3><p class="muted">${KIND === "goals" ? `${f.periods} × ${f.minutes} min` : `best of ${f.bestOf}, first to ${f.points}`}</p>
        <button class="primary" data-a="start" ${mine ? "" : "disabled"} style="padding:18px 30px;font-size:18px">Start match</button></div>`;
    } else {
      html += `<div class="card" style="text-align:center"><h3>${KIND === "darts" ? "Who throws first?" : "Who serves first?"}</h3>
        <div class="gbtns"><button class="ga" data-a="start" data-s="a" ${mine ? "" : "disabled"}>${esc(tnm(m, "a"))}</button>
        <button class="gb" data-a="start" data-s="b" ${mine ? "" : "disabled"}>${esc(tnm(m, "b"))}</button></div>
        <p class="muted">Format: ${KIND === "darts" ? `best of ${f.bestOf} legs, ${f.start}` : `best of ${f.bestOf}, ${f.points} points${f.cap ? " (max " + f.cap + ")" : ""}`}</p></div>`;
    }
  }

  if (st !== "scheduled" && KIND === "rally") html += rallyBody(m, f, mine, order);
  if (st !== "scheduled" && KIND === "goals") html += goalsBody(m, f, mine, order);
  if (st !== "scheduled" && KIND === "darts") html += dartsBody(m, f, mine, order);

  if (st === "live" && mine) html += `<p class="kbhint">Keyboard: ${KB_HINT[KIND] || ""}</p>`;
  const el = $("#vScore");
  el.innerHTML = html;
  if (wasOpen && $("#menu")) $("#menu").open = true;
  if (who && $(".whobox")) $(".whobox").scrollIntoView({ block: "nearest" });
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
  if (live && !d.winner) {
    const ps = ["a", "b"].filter(x => d.point[x]);
    if (ps.length) h += `<div class="gpban ${d.point[ps[0]] === "MATCH POINT" ? "mp" : ""}">${esc(d.point[ps[0]].replace("GAME", UNIT.toUpperCase()))}<small>${esc(sideName(m, ps[0]))} · one more point wins the ${d.point[ps[0]] === "MATCH POINT" ? "match" : UNIT.toLowerCase()}</small></div>`;
  }
  h += `<div class="court">` + order.map(s => sideBox(m, s, {
    button: true, disabled: !mine || !live || !!d.winner,
    big: d.winner ? d.won[s === "a" ? 0 : 1] : d.cur[s === "a" ? 0 : 1],
    small: `${UNIT}s won: ${d.won[s === "a" ? 0 : 1]}`,
    serving: live && !d.winner && f.serve !== "none" && d.srv === s, tag: live ? d.point[s] : null,
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
    h += whoHTML(m);
    if (f.fouls && !d.ended) h += `<div class="gbtns">` + order.map(s => `<button data-a="foul" data-s="${s}" ${mine ? "" : "disabled"}>+ Foul ${esc(sideName(m, s))}</button>`).join("") + `</div>`;
    if (DET && DET.cards) h += `<div class="gbtns cards">` + order.map(s => `<div><button data-a="card" data-s="${s}" data-k="y" ${mine ? "" : "disabled"}>🟨 Yellow</button><button data-a="card" data-s="${s}" data-k="r" ${mine ? "" : "disabled"}>🟥 Red</button></div>`).join("") + `</div>`;
    h += `<div class="controls">
      <button data-a="undoGoals" ${mine && m.events ? "" : "disabled"}>↶ Undo last</button>
      ${!d.ended ? `<button data-a="endPeriod" ${mine ? "" : "disabled"}>End ${periodName(S, per, d.periods)}</button>` : ""}
      ${!d.ended ? `<button class="ghost" data-a="finish" ${mine ? "" : "disabled"}>End match early</button>` : ""}</div>`;
  }
  const hist = d.perPeriod.slice(0, d.periods).filter((p, i) => i <= d.period).map((p, i) => `${periodName(S, i + 1, d.periods)} ${p.join("–")}`);
  if (hist.length) h += `<div class="hist">${hist.join(" · ")}${d.pen ? ` · Pens ${d.pen[0]}–${d.pen[1]}` : ""}</div>`;
  if (DET) h += tlHTML(m, mine && live);
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
    case "start": { const m = matches[curId] || {}; if (!m.teamA || !m.teamB) return toast("Teams not decided yet – they are filled in when the earlier matches finish (or choose them in Setup → Edit).", 4500); return A.start(s); }
    case "unstart": return A.unstart();
    case "finish": return A.finish();
    case "reopen": return A.reopen();
    case "wo": return A.walkover(s);
    case "bigscreen": return window.open(BIG_URL, "_blank", "noopener");
    case "announce": return openAnn();
    case "swap": store("ja_swap_" + curId, swapped() ? null : "1"); return renderScore();
    case "release": { const id = curId; curId = null; clearInterval(heartbeat); clearInterval(ticker); goTab("list"); return releaseLock(id); }
    case "undoRally": return A.undoRally();
    case "clock": return A.clockToggle();
    case "goal": return A.goal(s);
    case "card": return A.card(s, b.dataset.k);
    case "pick": return A.pick(b.dataset.n || "", false);
    case "pickOwn": return A.pick("", true);
    case "pickType": { const n = prompt("Player name (and number):"); return n && n.trim() ? A.pick(n.trim().slice(0, 40), false) : undefined; }
    case "pickSkip": who = null; return renderScore();
    case "tlWho": who = { mid: curId, tid: b.dataset.id, side: s, kind: "g" }; return renderScore();
    case "tlDel": return A.tlRemove(b.dataset.id);
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
function teamOptions(sel, cat) {
  let arr = Object.entries(teams);
  if (cat) { const f = arr.filter(([, t]) => sameCat(catOf(t), cat)); if (f.length) arr = f; }
  if (sel && teams[sel] && !arr.some(([id]) => id === sel)) arr.push([sel, teams[sel]]);
  arr.sort((a, b) => a[1].name.localeCompare(b[1].name));
  return `<option value="">— choose —</option>` + arr.map(([id, t]) =>
    `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(t.name)}${t.players ? " – " + esc(t.players) : ""}${!cat && catOf(t) ? " (" + esc(catOf(t)) + ")" : ""}</option>`).join("");
}
function refreshTeamSelects() {
  const cat = $("#fEvent").value.trim();
  const ca = $("#fA").value, cb = $("#fB").value;
  $("#fA").innerHTML = teamOptions(ca, cat);
  $("#fB").innerHTML = teamOptions(cb, cat);
}
function fillCatList() {
  $("#catList").innerHTML = cats().map(c => `<option value="${esc(c)}">`).join("");
}
$("#fEvent").addEventListener("input", () => {
  refreshTeamSelects();
  const g = $("#fGroup"), c = normCat($("#fEvent").value).toUpperCase();
  if (!g.value || g.value === g.dataset.auto) { g.value = c; g.dataset.auto = c; }
});

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
  renderProgress($("#progressSetup"), false);
  renderTC();
  // form selects (keep current choices)
  refreshTeamSelects();
  fillCatList();
  if (!$("#fFmt").dataset.ready) { $("#fFmt").innerHTML = fmtFields(FORMATS[S]); $("#fFmt").dataset.ready = "1"; }
  if (!$("#fNo").value && !editingId) $("#fNo").value = nextNo();

  const groups = [...new Set(Object.values(teams).map(keyOf).filter(Boolean))].sort();
  const cg = $("#rrGroup").value;
  $("#rrGroup").innerHTML = groups.length ? groups.map(g => `<option ${g === cg ? "selected" : ""}>${esc(g)}</option>`).join("") : `<option value="">(add teams with a category first)</option>`;

  // matches table
  const arr = arrMatches();
  $("#setupMatches").innerHTML = arr.length ? `<table><tr><th>#</th><th>Time</th><th>${esc(CW)}</th><th>Round</th><th>Match</th><th>Status</th><th></th></tr>` +
    arr.map(m => `<tr><td>${esc(m.no)}</td><td>${esc(m.time)}</td><td>${esc(m.court)}</td><td>${esc(m.round)}${m.event ? "<br><span class=muted>" + esc(m.event) + "</span>" : ""}</td>
      <td>${esc(tnm(m, "a"))} <span class="muted">vs</span> ${esc(tnm(m, "b"))}</td><td>${esc(m.status || "scheduled")}</td>
      <td style="text-align:right;white-space:nowrap"><button class="small" data-me="${m.id}">Edit</button> <button class="small danger" data-md="${m.id}">Delete</button></td></tr>`).join("") + `</table>`
    : `<p class="muted">No matches yet.</p>`;
  $$("[data-me]").forEach(b => b.onclick = () => editMatch(b.dataset.me));
  $$("[data-md]").forEach(b => b.onclick = () => deleteMatch(b.dataset.md));
}

// ---------------------------------------------------------------- teams tab
const ROSTER = KIND === "goals" && !!DETAILS[S];   // futsal etc.: numbered player list per team
const readPlayers = v => ROSTER ? parsePlayers(v).map(p => p.label).join("\n") : String(v || "").trim();
function playersField(id, val) {
  return ROSTER
    ? `<label for="${id}">Players <span class="muted" style="text-transform:none;letter-spacing:0">– optional. One per line: number then name.</span></label>
       <textarea id="${id}" rows="5" placeholder="1 Ali bin Abu&#10;7 Siti Aminah">${esc(val || "")}</textarea>`
    : `<label for="${id}">Players</label><input id="${id}" value="${esc(val || "")}" placeholder="e.g. Irfan / Ali">`;
}
function renderTeams() {
  fillCatList();
  renderNextStep($("#teamNext"));
  if (!$("#tPlayersWrap").dataset.ready) {
    $("#tPlayersWrap").innerHTML = playersField("tPlayers", "");
    $("#tPlayersWrap").dataset.ready = "1";
    if (ROSTER) { $("#bulkHint").innerHTML = "They go into the category above. One team per line: <b>Team name | | Short name</b>. Add each team's players afterwards with Edit."; $("#tIntro").textContent = "Category is optional. Add the players list now or later with Edit."; }
    else if (KIND === "rally") $("#tIntro").textContent = "Choose or type the category first, then the team. For doubles, each pair is one team.";
  }
  if (!$("#tCat").value) $("#tCat").value = store("ja_tcat_" + S) || "";
  const old = Object.entries(teams).filter(([, t]) => isOld(t));
  const mis = old.length ? [] : miscodedPools();
  const misEg = mis.length ? splitPool(poolOf(mis[0][1])) : null;
  $("#teamFix").innerHTML = old.length ? `<div class="banner warn">${old.length} team(s) were added with the category in the old “Group” box.
    <div style="font-weight:400;margin-top:4px">“Fix now” moves it into Category, and copies the Short name into Players (if Players is empty). Nothing else changes.</div>
    <button class="small primary" id="btnFixTeams" style="margin-top:8px">Fix now</button></div>`
    : mis.length ? `<div class="banner warn">${mis.length} team(s) have the whole draw code in the Pool box, such as ${esc(poolOf(mis[0][1]))}.
    <div style="font-weight:400;margin-top:4px">The Pool box takes the letter only — the number is the team's place inside that pool. “Fix now” turns ${esc(poolOf(mis[0][1]))} into Pool ${esc(misEg.group)}, no. ${misEg.seed}, so the teams sharing a letter become one pool and Round-robin can pair them. Nothing else changes.</div>
    <button class="small primary" id="btnFixPools" style="margin-top:8px">Fix now</button></div>` : "";
  if (old.length) $("#btnFixTeams").onclick = fixOldTeams;
  else if (mis.length) $("#btnFixPools").onclick = () => tidyPools(mis);

  const draft = editingTeam && $("#teName") ? { name: $("#teName").value, category: $("#teCat").value, players: $("#tePlayers").value,
    short: $("#teShort").value, group: $("#tePool").value } : null;
  if (editingTeam && !teams[editingTeam]) editingTeam = null;
  const by = {};
  Object.entries(teams).forEach(([id, t]) => (by[catOf(t) || "No category"] = by[catOf(t) || "No category"] || []).push([id, t]));
  const keys = Object.keys(by).sort((a, b) => (a === "No category") - (b === "No category") || a.localeCompare(b));
  $("#teamCats").innerHTML = keys.length ? keys.map(c => {
    const sorted = by[c].sort((a, b) => poolOf(a[1]).localeCompare(poolOf(b[1])) || ((+a[1].seed || 99) - (+b[1].seed || 99)) || a[1].name.localeCompare(b[1].name));
    // a heading row where the pool changes, so Pool A and Pool B read as two blocks and not one
    // long list. Only when the category uses pools at all.
    const usesPools = sorted.some(([, t]) => poolOf(t));
    const nPool = {};
    sorted.forEach(([, t]) => { const p = poolOf(t) || ""; nPool[p] = (nPool[p] || 0) + 1; });
    const rows = sorted.map(([id, t], i) => {
      const p = poolOf(t) || "";
      const head = usesPools && (i === 0 || (poolOf(sorted[i - 1][1]) || "") !== p)
        ? `<tr class="tgrp"><td colspan="2">${p ? "Pool " + esc(p) : "Not in a pool"} <span>${nPool[p]} team${nPool[p] > 1 ? "s" : ""}</span></td></tr>` : "";
      if (id === editingTeam) {
        const d = draft || { ...t, category: catOf(t), group: poolOf(t) };
        const body = `<tr class="tedit"><td colspan="2"><div class="tegrid">
            <div><label>Category</label><input id="teCat" list="catList" value="${esc(d.category || "")}"></div>
            <div><label>Team name</label><input id="teName" value="${esc(d.name)}"></div>
            <div><label>Short name</label><input id="teShort" value="${esc(d.short || "")}" placeholder="optional"></div>
            <div><label>Pool</label><input id="tePool" value="${esc(d.group || "")}" placeholder="optional, A / B"></div>
          </div>
          <div style="margin-top:8px">${playersField("tePlayers", d.players)}</div>
          <div class="row" style="margin-top:10px"><button class="small primary" data-tsave="${id}">Save</button><button class="small ghost" data-tcancel>Cancel</button></div>
        </td></tr>`;
        return head + body;
      }
      const pool = poolOf(t) ? ` <span class="badge">${t.seed ? esc(poolOf(t) + t.seed) : "Pool " + esc(poolOf(t))}</span>` : "";
      const np = ROSTER ? parsePlayers(t.players).length : 0;
      const pl = ROSTER ? (np ? np + " players" : "") : (tp(id) || (isOld(t) ? t.short : ""));
      return head + `<tr><td><b>${esc(t.name)}</b>${pool}${pl ? `<br><span class="muted" style="font-size:13px">${esc(pl)}</span>` : ""}</td>
        <td style="text-align:right;white-space:nowrap"><button class="small" data-te="${id}">Edit</button> <button class="small danger" data-td="${id}">Delete</button></td></tr>`;
    }).join("");
    return `<div class="card"><div class="row" style="align-items:center"><h3 style="flex:1;margin:0">${esc(c)}</h3>
      <span class="muted" style="font-size:13px">${by[c].length} team${by[c].length > 1 ? "s" : ""}</span>
      ${by[c].length >= 3 ? `<button class="small ghost" data-draw="${esc(c)}">🎲 Draw pools</button>` : ""}
      ${by[c].length >= 2 ? `<button class="small ghost" data-fx="${esc(c)}">📋 Matches</button>` : ""}
      ${by[c].length >= 2 ? `<button class="small ghost" data-ko="${esc(c)}">🏆 Knockout</button>` : ""}
      ${c !== "No category" ? `<button class="small ghost" data-addcat="${esc(c)}">+ Add here</button>` : ""}</div>
      <table class="teams" style="margin-top:8px">${rows}</table></div>`;
  }).join("") : `<div class="card muted">No teams yet. Add the first one above.</div>`;

  $$("[data-te]").forEach(b => b.onclick = () => { editingTeam = b.dataset.te; renderTeams(); const i = $("#teName"); if (i) { i.focus(); i.select(); } });
  $$("[data-td]").forEach(b => b.onclick = () => deleteTeam(b.dataset.td));
  $$("[data-tsave]").forEach(b => b.onclick = () => saveTeam(b.dataset.tsave));
  $$("[data-tcancel]").forEach(b => b.onclick = () => { editingTeam = null; renderTeams(); });
  $$("[data-draw]").forEach(b => b.onclick = () => openDraw(b.dataset.draw));
  $$("[data-fx]").forEach(b => b.onclick = () => openFixtures(b.dataset.fx));
  $$("[data-ko]").forEach(b => b.onclick = () => openKO(b.dataset.ko));
  $$("[data-addcat]").forEach(b => b.onclick = () => {
    $("#tCat").value = b.dataset.addcat; $("#teamFormCard").scrollIntoView({ behavior: "smooth" }); $("#tName").focus();
  });
  $$("#teamCats .tedit input").forEach(i => i.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); saveTeam(editingTeam); }
    if (e.key === "Escape") { editingTeam = null; renderTeams(); }
  });
}
const nameTaken = (name, cat, exceptId) => Object.entries(teams).some(([k, t]) =>
  k !== exceptId && t.name.toLowerCase() === name.toLowerCase() && sameCat(catOf(t), cat));

async function addTeam() {
  const category = normCat($("#tCat").value), name = $("#tName").value.trim();
  if (!name) { toast("Type the team name"); $("#tName").focus(); return; }
  if (nameTaken(name, category)) { toast("That team is already in this category"); return; }
  const p = splitPool($("#tPool").value);
  const val = { name, category, players: readPlayers($("#tPlayers").value), short: $("#tShort").value.trim(), group: p.group, seed: p.seed };
  try { await C.set(C.push(ref(db, `sports/${S}/teams`)), val); } catch (e) { toast("Couldn't save – check the connection"); return; }
  store("ja_tcat_" + S, category || null);
  $("#tName").value = ""; $("#tPlayers").value = ""; $("#tShort").value = "";
  $("#tName").focus();
  toast(`${name} added${category ? " to " + category : ""}`);
}
$("#btnAddTeam").onclick = addTeam;
["#tName", "#tShort", "#tPool"].forEach(sel => $(sel).onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addTeam(); } });

$("#btnAddTeams").onclick = async () => {
  const category = normCat($("#tCat").value);
  const lines = $("#teamBulk").value.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return toast("Paste at least one team");
  if (!category && !confirm("No category chosen above. Add these teams without a category?")) return;
  const upd = {}, seen = new Set();
  let added = 0;
  for (const l of lines) {
    const [name, players, short, pool] = l.split("|").map(x => (x || "").trim());
    if (!name || seen.has(name.toLowerCase()) || nameTaken(name, category)) continue;
    seen.add(name.toLowerCase());
    const p = splitPool(pool || $("#tPool").value);
    upd[C.push(ref(db, `sports/${S}/teams`)).key] = { name, category, players: ROSTER ? "" : (players || ""), short: short || "", group: p.group, seed: p.seed };
    added++;
  }
  if (!added) return toast("Those teams already exist");
  await C.update(ref(db, `sports/${S}/teams`), upd);
  store("ja_tcat_" + S, category || null);
  $("#teamBulk").value = "";
  toast(`${added} team(s) added${category ? " to " + category : ""}`);
};

async function fixOldTeams() {
  const upd = {};
  for (const [id, t] of Object.entries(teams)) {
    if (!isOld(t)) continue;
    upd[`${id}/category`] = t.group;
    upd[`${id}/group`] = "";
    if (!ROSTER && !t.players && t.short) upd[`${id}/players`] = t.short;
  }
  try { await C.update(ref(db, `sports/${S}/teams`), upd); } catch (e) { toast("Couldn't save – check the connection"); return; }
  toast("Teams fixed");
  republishAll().catch(() => {});
}

// Move a whole draw code out of the Pool box: "A1" -> group A, seed 1, for the given teams.
// Matches already built with the long code are pointed back at the pool letter too, so the
// standings table and the matches agree.
async function tidyPools(list) {
  if (!list || !list.length) return;
  const upd = {};
  for (const [id, t] of list) {
    const p = splitPool(poolOf(t));
    upd[`teams/${id}/group`] = p.group;
    upd[`teams/${id}/seed`] = p.seed;
  }
  for (const [id, m] of Object.entries(matches)) {
    const g = poolLetters(m.group || "");
    if (m.group && g !== m.group) upd[`matches/${id}/group`] = g;
  }
  try { await C.update(ref(db, `sports/${S}`), upd); } catch (e) { toast("Couldn't save – check the connection"); return; }
  const pools = [...new Set(list.map(([, t]) => splitPool(poolOf(t)).group))].sort();
  toast(`${list.length} team(s) sorted into Pool ${pools.join(" / ")}`, 4000);
  republishAll().catch(() => {});
}

// Runs once per session, and only when every miscoded team sits alone in its pool: a pool with
// one team in it is never a real pool, so there is nothing a scorer could have meant by it.
// Anything less clear-cut is left to the banner in the Teams tab.
let poolsTidied = false;
function autoTidyPools() {
  if (poolsTidied) return;
  const bad = miscodedPools();
  if (!bad.length) return;
  const n = {};
  Object.values(teams).forEach(t => { const k = keyOf(t); if (k) n[k] = (n[k] || 0) + 1; });
  if (!bad.every(([, t]) => n[keyOf(t)] === 1)) return;
  poolsTidied = true;
  tidyPools(bad).catch(() => {});
}

async function saveTeam(id) {
  if (!id || !teams[id]) return;
  const name = $("#teName").value.trim(), category = normCat($("#teCat").value);
  if (!name) { toast("Team name can't be empty"); $("#teName").focus(); return; }
  if (nameTaken(name, category, id)) { toast("Another team in this category has that name"); $("#teName").focus(); return; }
  const p = splitPool($("#tePool").value);
  const val = { name, category, players: readPlayers($("#tePlayers").value), short: $("#teShort").value.trim(), group: p.group };
  val.seed = p.seed != null ? p.seed
    : ((val.group && val.group === poolOf(teams[id]) && sameCat(category, catOf(teams[id]))) ? (teams[id].seed || null) : null);
  try {
    await C.update(ref(db, `sports/${S}/teams/${id}`), val);
  } catch (e) { toast("Couldn't save – check the connection"); return; }
  teams[id] = val;
  editingTeam = null;
  renderTeams();
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
    $("#fGroup").dataset.auto = "";
  }
  refreshTeamSelects();
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
  $("#fGroup").dataset.auto = "";
  $("#fA").innerHTML = teamOptions(m.teamA, m.event || ""); $("#fB").innerHTML = teamOptions(m.teamB, m.event || "");
  $("#fA").value = m.teamA || ""; $("#fB").value = m.teamB || "";
  $("#fFmt").innerHTML = fmtFields(fmtOf(S, m));
  $("#matchFormCard").scrollIntoView({ behavior: "smooth" });
}

$("#btnSaveMatch").onclick = async () => {
  const fields = {
    no: $("#fNo").value.trim(), time: $("#fTime").value.trim(), court: $("#fCourt").value.trim(),
    round: $("#fRound").value.trim(), group: poolLetters($("#fGroup").value), event: normCat($("#fEvent").value),
    teamA: $("#fA").value, teamB: $("#fB").value, fmt: readFmt()
  };
  const slotted = editingId && matches[editingId] && (matches[editingId].slotA || matches[editingId].slotB);
  if ((!fields.teamA || !fields.teamB) && !slotted) return toast("Choose both teams");
  if (fields.teamA && fields.teamA === fields.teamB) return toast("Team A and B must be different");
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
  if (!confirm(`Delete match #${m.no}: ${tnm(m, "a")} vs ${tnm(m, "b")}?${m.status !== "scheduled" ? "\n\nIt already has scores!" : ""}`)) return;
  await C.remove(matchRef(id));
  publish(id, null);
  log(id, m, "match deleted");
  if (editingId === id) clearForm(false);
}

// Make every pairing for one category (or pool). Used by Setup and by the "next step" card.
async function genRR(g, court, ask = true) {
  if (!g) { toast("Add teams with a category first"); return false; }
  const ids = Object.entries(teams).filter(([, t]) => keyOf(t) === g)
    .sort((a, b) => ((+a[1].seed || 99) - (+b[1].seed || 99)) || a[1].name.localeCompare(b[1].name)).map(([id]) => id);
  const t0 = teams[ids[0]] || {};
  if (ids.length < 2) { toast("Need at least 2 teams"); return false; }
  const pairs = rrPairs(ids);   // A1 v A2, A3 v A4 first; teams rest between matches
  if (ask && !confirm(`Create ${pairs.length} matches for ${g}?`)) return false;
  let no = nextNo();
  const upd = {}, pubs = {};
  for (const [x, y] of pairs) {
    const id = C.push(ref(db, `sports/${S}/matches`)).key;
    const m = { no: String(no++), time: "", court: (court || "").trim(), round: poolOf(t0) ? "Pool " + poolOf(t0) : (catOf(t0) ? "Group stage" : "Group " + g), group: g,
      event: catOf(t0), teamA: x, teamB: y, fmt: FORMATS[S], status: "scheduled", createdAt: C.now(), updatedAt: C.now() };
    upd[id] = m;
    pubs[id] = publicRecord(S, m, teams);
  }
  try {
    await C.update(ref(db, `sports/${S}/matches`), upd);
    await C.update(ref(db, `pub/${S}/m`), pubs);
  } catch (e) { toast("Couldn't save – check the connection"); return false; }
  if (!editingId) $("#fNo").value = no;
  log("", { no: "" }, `${pairs.length} matches created for ${g}`);
  return pairs.length;
}
$("#btnRR").onclick = async () => {
  const n = await genRR($("#rrGroup").value, $("#rrCourt").value);
  if (n) toast(`${n} match${n > 1 ? "es" : ""} created`);
};

// ---------------------------------------------------------------- setup progress (Teams → Matches → Times & courts → Ready)
function setupState() {
  const tl = Object.values(teams), ml = Object.values(matches);
  const by = {}; tl.forEach(t => { const k = keyOf(t); if (k) by[k] = (by[k] || 0) + 1; });
  const used = new Set(ml.map(m => String(m.group || "").toUpperCase()));
  const noMatch = Object.entries(by).filter(([k, n]) => n >= 2 && !used.has(k)).length;
  const missing = ml.filter(m => (m.status || "scheduled") === "scheduled" && (!String(m.time || "").trim() || !String(m.court || "").trim())).length;
  const started = ml.some(m => m.status === "live" || m.status === "done");
  const t1 = tl.length >= 2, t2 = t1 && ml.length > 0 && !noMatch, t3 = ml.length > 0 && !missing;
  return { teams: tl.length, matches: ml.length, noMatch, missing, started, t1, t2, t3, ready: t1 && t2 && t3 };
}
function renderProgress(el, withTodo) {
  if (!el) return;
  const st = setupState();
  if (st.started) { el.innerHTML = ""; return; }          // match day: get out of the way
  const now = !st.t1 ? 1 : !st.t2 ? 2 : !st.t3 ? 3 : 4;
  const step = (n, label, sub, done) => `<div class="step ${done ? "done" : n === now ? "now" : ""}"><i>${done ? "✓" : n}</i>${label}<small>${sub}</small></div>`;
  let h = `<div class="steps">${step(1, "Teams", st.teams ? st.teams + " added" : "none yet", st.t1)}${step(2, "Matches", st.matches ? st.matches + " made" : "none yet", st.t2)}${step(3, "Times & courts", st.matches ? (st.missing ? st.missing + " left" : "all set") : "–", st.t3)}${step(4, "Ready", st.ready ? "let's go!" : "", st.ready)}</div>`;
  if (withTodo && now === 1) h += `<div class="todo"><h4>Next: add your teams</h4><p>Add each team (or pair) under its category.</p><button class="primary small" data-go="teams">Go to Teams →</button></div>`;
  else if (withTodo && now === 2 && !st.noMatch) h += `<div class="todo"><h4>Next: add matches</h4><p>Use Setup → Generate round-robin, Paste the schedule, or Add match.</p><button class="primary small" data-go="setup">Go to Setup →</button></div>`;
  else if (withTodo && now === 3) h += `<div class="todo"><h4>Next: set time &amp; ${esc(cw)} for ${st.missing} match${st.missing > 1 ? "es" : ""}</h4><p>Fill them all on one screen – or let Quick fill do it.</p><button class="primary small" data-go="tc">Set times &amp; ${esc(cw)}s →</button></div>`;
  el.innerHTML = h;
  $$("[data-go]", el).forEach(b => b.onclick = () => {
    const g = b.dataset.go;
    goTab(g === "tc" ? "setup" : g);
    if (g === "tc") setTimeout(() => $("#tcCard").scrollIntoView({ behavior: "smooth" }), 60);
  });
}

// ---------------------------------------------------------------- times & courts (all matches on one screen)
let tcCat = null;
const parseT = t => {   // "10:30 AM", "10.30am", "14:30", "1030" → minutes after midnight
  const x = String(t || "").trim().match(/^(\d{1,2})[:.]?(\d{2})?\s*([ap])?\.?m?\.?$/i);
  if (!x) return null;
  let h = +x[1]; const mi = +(x[2] || 0), ap = (x[3] || "").toLowerCase();
  if (h > 23 || mi > 59) return null;
  if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0;
  return h * 60 + mi;
};
const fmtT = min => { min = ((min % 1440) + 1440) % 1440; const h = Math.floor(min / 60), m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
// which court box a match belongs to in Quick fill: its pool, "Knockout", or "Matches"
const bucketOf = m => {
  if (m.slotA || m.slotB || /final|semi|quarter|3rd|third/i.test(m.round || "")) return "Knockout";
  const p = (String(m.group || "").match(/POOL\s+(\w+)$/i) || [])[1];
  return p ? "Pool " + p.toUpperCase() : "Matches";
};
// Quick fill timetable. Each court is its own queue. On every court the next match is the one that
// can start soonest: its teams must have had `rest` minutes since their last match, knockouts wait
// for all pool matches (+ rest), a final waits for its semis. Ties keep the match-number order.
function planTimes(sched, start, every, rest, courtOfB, bucketOf) {
  const at = {}, laneOf = {}, teamFree = {}, free = {};
  sched.forEach(m => { const b = bucketOf(m); laneOf[m.id] = (m.court || "").trim() || (courtOfB[b] || "") || "·" + b; });
  const left = [...sched];
  const isKO = m => bucketOf(m) === "Knockout";
  const earliest = m => {
    let e = start;
    for (const t of [m.teamA, m.teamB]) if (t && teamFree[t] != null) e = Math.max(e, teamFree[t]);
    if (isKO(m)) {
      if (left.some(x => !isKO(x))) return Infinity;
      const pe = Math.max(start, ...sched.filter(x => !isKO(x)).map(x => at[x.id] + every));
      e = Math.max(e, pe + (sched.some(x => !isKO(x)) ? rest : 0));
      for (const sl of [m.slotA, m.slotB]) { const [k, r] = String(sl || "").split("|");
        if (k === "W" || k === "L") { if (at[r] == null) return Infinity; e = Math.max(e, at[r] + every + rest); } }
    }
    return e;
  };
  while (left.length) {
    let best = null;
    for (const m of left) {
      const t = Math.max(free[laneOf[m.id]] ?? start, earliest(m));
      if (!best || t < best.t) best = { m, t };   // ties keep list order
    }
    if (!best || best.t === Infinity) break;
    const { m, t } = best;
    at[m.id] = t; free[laneOf[m.id]] = t + every;
    for (const x of [m.teamA, m.teamB]) if (x) teamFree[x] = t + every + rest;
    left.splice(left.indexOf(m), 1);
  }
  return { at, laneOf };
}
function renderTC() {
  const el = $("#tcCard");
  if (!el) return;
  if (el.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;   // don't wipe what is being typed
  const all = arrMatches();
  if (!all.length) { el.classList.add("hide"); return; }
  el.classList.remove("hide");
  const catsM = [...new Set(all.map(m => m.event || "Other"))].sort((a, b) => a.localeCompare(b));
  const miss = c => all.filter(m => (m.event || "Other") === c && (m.status || "scheduled") === "scheduled" && (!m.time || !m.court)).length;
  if (!tcCat || !catsM.includes(tcCat)) tcCat = catsM.find(c => miss(c)) || catsM[0];
  const list = all.filter(m => (m.event || "Other") === tcCat);
  const sched = list.filter(m => (m.status || "scheduled") === "scheduled");
  const firstT = sched.map(m => parseT(m.time)).find(x => x != null);
  const buckets = [...new Set(sched.map(bucketOf))].sort((a, b) => (a === "Knockout") - (b === "Knockout") || a.localeCompare(b));
  // a court box only where some match of that pool still has none
  const need = buckets.filter(b => sched.some(m => bucketOf(m) === b && !(m.court || "").trim()));
  el.innerHTML = `<h3 style="margin:0 0 4px">Times &amp; courts</h3>
    <p class="muted" style="margin:0;font-size:13px">Type straight into the boxes – each one saves when you leave it.</p>
    ${catsM.length > 1 ? `<div class="chips" style="margin:10px 0 4px">${catsM.map(c => `<button data-tcc="${esc(c)}" class="${c === tcCat ? "on" : ""}">${esc(c)} ${miss(c) ? `· ${miss(c)} left` : "✓"}</button>`).join("")}</div>` : ""}
    ${sched.length ? `<div class="qfill"><span class="full">⚡ Quick fill all ${sched.length} at once</span>
      <label>Start</label><input id="qfStart" value="${firstT != null ? fmtT(firstT) : "9:00 AM"}">
      <label>Every</label><input id="qfEvery" inputmode="numeric" value="${store("ja_qfevery_" + S) || 25}" placeholder="min">
      <label>Rest<small style="display:block;text-transform:none;letter-spacing:0">min per team</small></label><input id="qfRest" inputmode="numeric" value="${store("ja_qfrest_" + S) ?? 5}" placeholder="0">
      <span class="full muted" style="font-size:12px">Every = minutes from one match start to the next on a court. Rest = extra minutes a team gets before its next match – matches are re-ordered (and re-numbered) to give it.</span>
      ${need.map(b => `<label>${esc(CW)}${buckets.length > 1 ? `<small style="display:block;text-transform:none;letter-spacing:0">${esc(b)}</small>` : ""}</label>
        <input data-qfc="${esc(b)}" value="" placeholder="e.g. 1">`).join("")}
      ${need.length < buckets.length ? `<span class="full muted" style="font-size:12px">${need.length ? "The other matches keep" : "Every match keeps"} the court already set on it – only the times are filled.</span>` : ""}
      ${need.length && buckets.length > 1 ? `<span class="full muted" style="font-size:12px">Different courts play at the same time. Knockout matches start after the pool matches.</span>` : ""}
      <span></span><button class="small primary" id="btnQF">Fill</button></div>` : ""}
    <div class="qhead"><span>#</span><span>Match</span><span>Time</span><span>${esc(CW)}</span></div>
    ${list.map(m => { const lock = (m.status || "scheduled") !== "scheduled";
      return `<div class="qrow"><span class="n">${esc(m.no)}</span><span class="t">${esc(tnm(m, "a"))}<small>vs ${esc(tnm(m, "b"))}${lock ? " · " + esc(m.status) : ""}</small></span>
        <input data-tid="${m.id}" data-f="time" class="${m.time ? "f" : ""}" value="${esc(m.time || "")}" placeholder="time" ${lock ? "disabled" : ""}>
        <input data-tid="${m.id}" data-f="court" class="${m.court ? "f" : ""}" value="${esc(m.court || "")}" placeholder="–" ${lock ? "disabled" : ""}></div>`; }).join("")}`;
  $$("[data-tcc]", el).forEach(b => b.onclick = () => { tcCat = b.dataset.tcc; renderTC(); });
  $$("input[data-tid]", el).forEach(inp => {
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } };
    inp.onchange = async () => {
      const id = inp.dataset.tid, f = inp.dataset.f, m = matches[id];
      if (!m) return;
      let val = inp.value.trim();
      if (f === "time" && val) { const t = parseT(val); if (t == null) { toast("Time like 9:30 AM"); return; } val = fmtT(t); inp.value = val; }
      try { await C.update(matchRef(id), { [f]: val, updatedAt: C.now() }); } catch (e) { toast("Couldn't save – check the connection"); return; }
      inp.classList.toggle("f", !!val);
      publish(id, { ...m, [f]: val });
    };
  });
  const qf = $("#btnQF", el);
  if (qf) qf.onclick = async () => {
    const start = parseT($("#qfStart").value), every = Number($("#qfEvery").value);
    const courtOfB = {}; $$("[data-qfc]", el).forEach(i => courtOfB[i.dataset.qfc] = i.value.trim());
    if (start == null) return toast("Start time like 9:00 AM");
    if (!(every > 0)) return toast("Minutes between matches, e.g. 25");
    if (sched.some(m => m.time) && !confirm(`Fill the times for all ${sched.length} ${tcCat} matches?\nTimes already typed will be replaced, and the matches may be re-ordered and re-numbered. Courts already set are kept.`)) return;
    store("ja_qfevery_" + S, String(every));
    const rest = Math.max(0, Number($("#qfRest").value) || 0);
    store("ja_qfrest_" + S, String(rest));
    const { at, laneOf } = planTimes(sched, start, every, rest, courtOfB, bucketOf);
    if (sched.some(m => at[m.id] == null)) return toast("Couldn't fit every match – check the knockout matches");
    // # follows the playing order: hand the same numbers out again in time order
    const byTime = [...sched].sort((x, y) => at[x.id] - at[y.id] || laneOf[x.id].localeCompare(laneOf[y.id]) || C.byNo(x, y));
    const nums = sched.map(m => m.no).filter(n => /^\d+$/.test(String(n))).map(Number).sort((x, y) => x - y);
    const renum = nums.length === sched.length && new Set(nums).size === nums.length;
    const out = {};
    byTime.forEach((m, i) => {
      const court = (m.court || "").trim() || courtOfB[bucketOf(m)] || "";
      out[m.id] = { time: fmtT(at[m.id]), ...(court ? { court } : {}), ...(renum ? { no: String(nums[i]) } : {}) };
    });
    const upd = {};
    sched.forEach(m => { Object.entries(out[m.id]).forEach(([k, v]) => upd[`${m.id}/${k}`] = v); upd[`${m.id}/updatedAt`] = C.now(); });
    try { await C.update(ref(db, `sports/${S}/matches`), upd); } catch (e) { toast("Couldn't save – check the connection"); return; }
    sched.forEach(m => publish(m.id, { ...m, ...out[m.id] }));
    log("", { no: "" }, `times filled for ${tcCat}`);
    toast(`${sched.length} matches filled`);
  };
}

// ---------------------------------------------------------------- team draw (split a category into pools)
// Random draw done on screen so everyone can watch it. Team i of the shuffled list goes to
// pool i % n, so pools differ by at most one team. Saved as group = "A", seed = 1,2,3… (A1, A2…).
const POOLS = "ABCD";
let drawCat = null, drawRes = null, drawTimer = null;
const rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const catTeams = c => Object.entries(teams).filter(([, t]) => (catOf(t) || "No category") === c);
function drawMatches(c) {
  const ids = new Set(catTeams(c).map(([id]) => id));
  return Object.entries(matches).filter(([, m]) => ids.has(m.teamA) || ids.has(m.teamB) || ((m.slotA || m.slotB) && sameCat(m.event, c)));
}
function openDraw(c) {
  drawCat = c; drawRes = null; clearInterval(drawTimer);
  const list = catTeams(c), n = list.length;
  $("#drTitle").textContent = `🎲 Team draw – ${c}`;
  $("#drSub").textContent = `${n} teams. They are shuffled at random and dealt one by one into the pools.`;
  const pools = [...new Set(list.map(([, t]) => poolOf(t)).filter(Boolean))].length;
  $("#drN").value = String(Math.min(4, Math.max(2, pools || 2)));
  $("#drOpts").classList.remove("hide"); $("#drGo").textContent = "🎲 Start draw";
  $("#drPot").innerHTML = list.map(([, t]) => `<span>${esc(t.name)}</span>`).join("");
  $("#drPools").innerHTML = ""; $("#drNote").textContent = "";
  ["#drSave", "#drSkip"].forEach(x => $(x).classList.add("hide"));
  $("#drClear").classList.toggle("hide", !list.some(([, t]) => poolOf(t)));
  if (list.some(([, t]) => poolOf(t))) showPools(groupNow(list), false, "Current pools are shown below. Start a new draw to replace them.");
  $("#drawModal").classList.remove("hide");
}
function groupNow(list) {
  const out = {};
  list.filter(([, t]) => poolOf(t)).sort((a, b) => ((+a[1].seed || 99) - (+b[1].seed || 99)) || a[1].name.localeCompare(b[1].name))
    .forEach(([id, t]) => (out[poolOf(t)] = out[poolOf(t)] || []).push(id));
  return out;
}
function showPools(by, lastId, note) {
  const keys = Object.keys(by).sort();
  $("#drPools").innerHTML = keys.map(p => `<div class="drawpool"><h4>POOL ${esc(p)}</h4><ol>${by[p].map((id, i) =>
    `<li class="${id === lastId ? "new" : ""}"><b>${esc(p)}${i + 1}</b>${esc(tn(id))}</li>`).join("") || `<li class="muted">–</li>`}</ol></div>`).join("");
  if (note != null) $("#drNote").textContent = note;
}
function runDraw(animate = true) {
  clearInterval(drawTimer);
  const list = catTeams(drawCat).map(([id]) => id);
  for (let i = list.length - 1; i > 0; i--) { const j = rnd(i + 1); [list[i], list[j]] = [list[j], list[i]]; }
  const n = +$("#drN").value;
  if (list.length < n * 2) return toast(`Need at least ${n * 2} teams for ${n} pools`);
  const by = {}; for (let p = 0; p < n; p++) by[POOLS[p]] = [];
  drawRes = by;
  $("#drOpts").classList.add("hide"); $("#drClear").classList.add("hide");
  $("#drSave").classList.add("hide");
  let i = 0;
  const finish = () => {
    clearInterval(drawTimer);
    list.slice(i).forEach((id, k) => by[POOLS[(i + k) % n]].push(id)); i = list.length;
    $("#drPot").innerHTML = ""; showPools(by, null);
    const sizes = Object.keys(by).map(p => `Pool ${p}: ${by[p].length} teams (${by[p].length * (by[p].length - 1) / 2} matches)`).join(" · ");
    $("#drNote").textContent = sizes + ". Not saved yet – tap Save draw to keep it.";
    $("#drSkip").classList.add("hide");
    $("#drSave").classList.remove("hide");
    $("#drOpts").classList.remove("hide"); $("#drGo").textContent = "🎲 Draw again";
  };
  if (!animate) return finish();
  $("#drSkip").classList.remove("hide");
  showPools(by, null, "Drawing…");
  const step = () => {
    if (i >= list.length) return finish();
    const id = list[i], pot = list.slice(i);
    // short "spin" on the pot, then the picked team lands in its pool
    let spins = 0;
    clearInterval(drawTimer);
    drawTimer = setInterval(() => {
      const show = spins < 6 ? pot[rnd(pot.length)] : id;
      $("#drPot").innerHTML = pot.map(x => `<span class="${x === show ? "pick" : ""}">${esc(tn(x))}</span>`).join("");
      if (spins++ >= 7) {
        clearInterval(drawTimer);
        by[POOLS[i % n]].push(id); i++;
        $("#drPot").innerHTML = list.slice(i).map(x => `<span>${esc(tn(x))}</span>`).join("");
        showPools(by, id);
        drawTimer = setTimeout(step, 450);
      }
    }, 110);
  };
  $("#drSkip").onclick = finish;
  step();
}
async function saveDraw(by) {
  const ms = drawMatches(drawCat);
  if (ms.some(([, m]) => m.status && m.status !== "scheduled"))
    return toast("This category already has matches that started. The pools can't be changed now.", 4500);
  if (ms.length && !confirm(`${drawCat} already has ${ms.length} match${ms.length > 1 ? "es" : ""} (not started). Delete them and use the new pools?`)) return;
  if (!ms.length && !by && !confirm(`Remove the pools from ${drawCat}? Teams go back to one group.`)) return;
  const upd = {};
  const inDraw = new Set();
  if (by) for (const p of Object.keys(by)) by[p].forEach((id, k) => { upd[`teams/${id}/group`] = p; upd[`teams/${id}/seed`] = k + 1; inDraw.add(id); });
  for (const [id] of catTeams(drawCat)) if (!inDraw.has(id)) { upd[`teams/${id}/group`] = ""; upd[`teams/${id}/seed`] = null; }
  for (const [id] of ms) upd[`matches/${id}`] = null;
  try {
    await C.update(ref(db, `sports/${S}`), upd);
    if (ms.length) await C.update(ref(db, `pub/${S}`), Object.fromEntries(ms.flatMap(([id]) => [[`m/${id}`, null], [`live/${id}`, null]])));
  } catch (e) { toast("Couldn't save – check the connection"); return; }
  // let the "create matches" card offer the new pools again
  store(skipKey, JSON.stringify(skipped().filter(k => !k.startsWith(String(drawCat).toUpperCase()))));
  log("", { no: "" }, by ? `pools drawn for ${drawCat}: ` + Object.keys(by).map(p => `${p}(${by[p].map(tn).join(", ")})`).join(" ") : `pools removed for ${drawCat}`);
  $("#drawModal").classList.add("hide");
  toast(by ? "Draw saved. Now choose courts and matches." : "Pools removed", 4500);
  republishAll().catch(() => {});
  if (by) { const c = drawCat; setTimeout(() => openFixtures(c), 300); }
}
$("#drGo").onclick = () => runDraw(true);
$("#drSave").onclick = () => drawRes && saveDraw(drawRes);
$("#drClear").onclick = () => saveDraw(null);
$("#drClose").onclick = () => {
  if (drawRes && !$("#drSave").classList.contains("hide") && !confirm("Close without saving this draw?")) return;
  clearInterval(drawTimer); clearTimeout(drawTimer); drawRes = null; $("#drawModal").classList.add("hide");
};

// ---------------------------------------------------------------- match builder (after the draw, or any time)
// Court per pool, pools taking turns, auto-filled list that can be edited, or a fully manual list.
let fx = null;   // { cat, rows: [{a, b, court}] }
const rrPairs = ids => {   // circle method: rounds where nobody plays twice; round 1 = 1v2, 3v4, 5v6…
  const n = ids.length % 2 ? ids.length + 1 : ids.length, seeds = [...ids, null].slice(0, n), list = new Array(n), out = [];
  for (let i = 0; i < n / 2; i++) { list[i] = seeds[2 * i]; list[n - 1 - i] = seeds[2 * i + 1]; }
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) { const x = list[i], y = list[n - 1 - i]; if (x && y) out.push(r % 2 ? [y, x] : [x, y]); }
    list.splice(1, 0, list.pop());
  }
  return out;
};
const fxPools = () => { const g = groupNow(catTeams(fx.cat)); const rest = catTeams(fx.cat).filter(([, t]) => !poolOf(t)).map(([id]) => id);
  if (rest.length) g[""] = rest; return g; };
const tLabel = id => { const t = teams[id] || {}; return (poolOf(t) && t.seed ? poolOf(t) + t.seed + " · " : "") + (t.name || "?"); };
function openFixtures(c) {
  fx = { cat: c, rows: [] };
  const pools = fxPools(), keys = Object.keys(pools).sort();
  const ms = drawMatches(c);
  $("#fxTitle").textContent = `📋 Matches – ${c}`;
  $("#fxSub").textContent = (keys.length > 1 || keys[0] ? keys.map(p => `Pool ${p || "–"}: ${pools[p].length} teams`).join(" · ") : `${catTeams(c).length} teams`) +
    (ms.length ? ` · ${ms.length} match${ms.length > 1 ? "es" : ""} already made – new ones are added after them.` : "");
  const saved = (() => { try { return JSON.parse(store("ja_fxct_" + S) || "{}"); } catch (e) { return {}; } })();
  $("#fxCourts").innerHTML = keys.map(p => `<div><label>${esc(CW)} for ${p ? "Pool " + esc(p) : "these matches"}</label>
    <input data-fxct="${esc(p)}" value="${esc(saved[c + "|" + p] || "")}" placeholder="e.g. 1 or Court A"></div>`).join("");

  $$("[data-fxct]").forEach(i => i.oninput = () => {
    const p = i.dataset.fxct;
    fx.rows.forEach(r => { if (poolOf(teams[r.a]) === p) r.court = i.value.trim(); });
    renderFx();
  });
  $("#fxTables").value = store("ja_fxtb_" + S) || "";
  const savedMode = store("ja_fxmode_" + S) || "pool";
  $$('#fxMode input').forEach(i => i.checked = i.value === savedMode);
  applyFxMode();
  if (!ms.length) fillFx(); else renderFx();
  $("#fxModal").classList.remove("hide");
}
// Two ways to use the room, and only one of them on screen at a time: a pool keeps one table
// all day (a court per pool), or the pools share the room's tables and play side by side.
const fxMode = () => ($$('#fxMode input').find(i => i.checked) || {}).value || "pool";
function applyFxMode() {
  const m = fxMode();
  $$("#fxMode label").forEach(l => l.classList.toggle("on", l.dataset.m === m));
  $("#fxCourts").classList.toggle("hide", m !== "pool");
  $("#fxTablesWrap").classList.toggle("hide", m !== "spread");
  // taking turns is what makes side-by-side play possible, so it is not optional there
  $("#fxTurnWrap").classList.toggle("hide", m === "spread" || !fx || Object.keys(fxPools()).length < 2);
  if (m === "spread" && !$("#fxTurns").checked) { $("#fxTurns").checked = true; fillFx(); }
  if (fx && fx.rows.length) {
    // empty in spread mode until the button is pressed; back on the pool's own court otherwise
    fx.rows.forEach(r => r.court = m === "spread" ? "" : courtOf(poolOf(teams[r.a]) || ""));
    renderFx();
  }
}
$$('#fxMode input').forEach(i => i.onchange = () => { store("ja_fxmode_" + S, fxMode()); applyFxMode(); });
const courtOf = p => { const i = $$("[data-fxct]").find(x => x.dataset.fxct === p); return i ? i.value.trim() : ""; };
function fillFx() {
  const pools = fxPools(), keys = Object.keys(pools).sort();
  const spread = fxMode() === "spread";
  const per = keys.map(p => rrPairs(pools[p]).map(([a, b]) => ({ a, b, court: spread ? "" : courtOf(p) })));
  let rows = [];
  if ($("#fxTurns").checked && keys.length > 1) {
    for (let i = 0; per.some(l => i < l.length); i++) per.forEach(l => { if (l[i]) rows.push(l[i]); });
  } else rows = per.flat();
  fx.rows = rows; renderFx();
}
function renderFx() {
  const ids = catTeams(fx.cat).sort((a, b) => poolOf(a[1]).localeCompare(poolOf(b[1])) || ((+a[1].seed || 99) - (+b[1].seed || 99)) || a[1].name.localeCompare(b[1].name)).map(([id]) => id);
  const opts = sel => `<option value="">– team –</option>` + ids.map(id => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(tLabel(id))}</option>`).join("");
  const start = nextNo(), seen = new Set();
  let bad = 0;
  $("#fxList").innerHTML = fx.rows.map((r, i) => {
    const key = [r.a, r.b].sort().join("|");
    let warn = "";
    if (!r.a || !r.b) warn = "Choose both teams";
    else if (r.a === r.b) warn = "Same team twice";
    else if (seen.has(key)) warn = "This pair is already in the list";
    else if (poolOf(teams[r.a]) !== poolOf(teams[r.b])) warn = "Different pools – this match won't count in the pool table";
    seen.add(key);
    if (warn && !/Different pools/.test(warn)) bad++;
    return `<div class="fxrow ${warn ? "bad" : ""}"><span class="no">#${start + i}</span>
      <select data-fxa="${i}">${opts(r.a)}</select><span class="vs">vs</span><select data-fxb="${i}">${opts(r.b)}</select>
      <input class="ct" data-fxc="${i}" value="${esc(r.court || "")}" placeholder="${esc(CW)}">
      <button type="button" class="small ghost danger x" data-fxx="${i}" title="Remove">✕</button>
      ${warn ? `<small>${esc(warn)}</small>` : ""}</div>`;
  }).join("") || `<p class="muted">No matches in the list. Tap “Fill all” or “+ Add a match”.</p>`;
  $$("[data-fxa]").forEach(e => e.onchange = () => { fx.rows[+e.dataset.fxa].a = e.value; renderFx(); });
  $$("[data-fxb]").forEach(e => e.onchange = () => { fx.rows[+e.dataset.fxb].b = e.value; renderFx(); });
  $$("[data-fxc]").forEach(e => e.oninput = () => { fx.rows[+e.dataset.fxc].court = e.value.trim(); });
  $$("[data-fxx]").forEach(e => e.onclick = () => { fx.rows.splice(+e.dataset.fxx, 1); renderFx(); });
  $("#fxNote").textContent = fx.rows.length ? `${fx.rows.length} match${fx.rows.length > 1 ? "es" : ""}, numbered #${start}–#${start + fx.rows.length - 1}. Times can be set later in Setup.` : "";
  $("#fxSave").textContent = fx.rows.length ? `Create ${fx.rows.length} match${fx.rows.length > 1 ? "es" : ""}` : "Create matches";
  $("#fxSave").disabled = !fx.rows.length || bad > 0;
}
// The room has n tables, numbered 1..n. Tables another category is already using are left to
// it, so the men's pools can take 1-4 and the women's 5-6 without anyone being told to.
function roomTables(n) {
  const mine = fx.cat === "No category" ? "" : fx.cat;
  const used = new Set(Object.values(matches).filter(m => !sameCat(m.event || "", mine))
    .map(m => String(m.court || "").trim()).filter(Boolean));
  const all = Array.from({ length: n }, (_, i) => String(i + 1));
  const free = all.filter(t => !used.has(t));
  return free.length ? free : all;
}
// Deal the tables out down the list. A round ends when the tables run out, or when the next
// match needs a team that is already playing in this round — so nobody is sent to two tables
// at once, and matches that can run side by side never share one.
function spreadTables(list) {
  let playing = new Set(), i = 0, rounds = 1;
  for (const r of fx.rows) {
    if (i >= list.length || (r.a && playing.has(r.a)) || (r.b && playing.has(r.b))) { playing = new Set(); i = 0; rounds++; }
    r.court = list[i++];
    if (r.a) playing.add(r.a);
    if (r.b) playing.add(r.b);
  }
  return rounds;
}
$("#fxSpread").onclick = () => {
  if (!fx || !fx.rows.length) return toast("Fill the match list first");
  const n = +$("#fxTables").value;
  if (!n) return toast("Choose how many tables the room has");
  store("ja_fxtb_" + S, String(n));
  const rounds = spreadTables(roomTables(n));
  renderFx();
  const got = [...new Set(fx.rows.map(r => r.court).filter(Boolean))];
  toast(`Table ${got.join(", ")} · ${rounds} round${rounds > 1 ? "s" : ""} of play`, 4000);
};
$("#fxFill").onclick = () => { if (fx.rows.length && !confirm("Replace the list with all pool matches?")) return; fillFx(); };
$("#fxTurns").onchange = () => { if (fx) fillFx(); };
$("#fxEmpty").onclick = () => { fx.rows = []; renderFx(); };
$("#fxAdd").onclick = () => { const last = fx.rows[fx.rows.length - 1]; fx.rows.push({ a: "", b: "", court: last ? last.court : "" }); renderFx(); };
$("#fxClose").onclick = () => { if (fx && fx.rows.length && !confirm("Close without creating these matches?")) return; fx = null; $("#fxModal").classList.add("hide"); };
$("#fxSave").onclick = async () => {
  if (!fx || !fx.rows.length) return;
  let no = nextNo();
  const upd = {}, pubs = {};
  for (const r of fx.rows) {
    const ta = teams[r.a], tb = teams[r.b], same = poolOf(ta) === poolOf(tb);
    const id = C.push(ref(db, `sports/${S}/matches`)).key;
    const m = { no: String(no++), time: "", court: r.court || "", round: same ? (poolOf(ta) ? "Pool " + poolOf(ta) : "Group stage") : "",
      group: same ? keyOf(ta) : "", event: catOf(ta), teamA: r.a, teamB: r.b, fmt: FORMATS[S], status: "scheduled", createdAt: C.now(), updatedAt: C.now() };
    upd[id] = m; pubs[id] = publicRecord(S, m, teams);
  }
  $("#fxSave").disabled = true;
  try {
    await C.update(ref(db, `sports/${S}/matches`), upd);
    await C.update(ref(db, `pub/${S}/m`), pubs);
  } catch (e) { toast("Couldn't save – check the connection"); $("#fxSave").disabled = false; return; }
  const saved = (() => { try { return JSON.parse(store("ja_fxct_" + S) || "{}"); } catch (e) { return {}; } })();
  $$("[data-fxct]").forEach(i => saved[fx.cat + "|" + i.dataset.fxct] = i.value.trim());
  store("ja_fxct_" + S, JSON.stringify(saved));
  log("", { no: "" }, `${fx.rows.length} matches created for ${fx.cat}`);
  toast(`${fx.rows.length} matches created. Set the times in Setup.`, 4500);
  fx = null; $("#fxModal").classList.add("hide");
};

// ---------------------------------------------------------------- knockout (semi-finals / final) filled in automatically
// A knockout match keeps where each side comes from: slotA / slotB =
//   "P|<group key>|<place>"  e.g. "P|FUTSAL LELAKI – POOL A|1"  (1st of that pool, once all its matches are confirmed)
//   "W|<match id>" / "L|<match id>"  (winner / loser of that match)
// labA / labB is the text shown until the team is known. Any scorer phone that is open fills the team in.
const ord = n => n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
function poolTable(key) {
  const ms = Object.values(matches).filter(m => String(m.group || "").toUpperCase() === key);
  if (!ms.length || ms.some(m => m.status !== "done")) return null;
  const recs = {}; ms.forEach((m, i) => recs[i] = publicRecord(S, m, teams));
  const tbl = standings(recs)[key] || standings(recs)[ms[0].group] || [];
  const ids = Object.entries(teams).filter(([, t]) => keyOf(t) === key);
  return tbl.map(r => (ids.find(([, t]) => t.name === r.team) || [])[0]).filter(Boolean);
}
function resolveSlot(slot) {
  const [k, a, b] = String(slot || "").split("|");
  if (k === "P") { const t = poolTable(a); return t ? t[(+b || 1) - 1] || null : null; }
  if (k === "W" || k === "L") {
    const x = matches[a];
    if (!x || x.status !== "done" || !x.winner || !x.teamA || !x.teamB) return null;
    const win = x.winner === "a" ? x.teamA : x.teamB, lose = x.winner === "a" ? x.teamB : x.teamA;
    return k === "W" ? win : lose;
  }
  return null;
}
let koBusy = false;
async function autoFillKO() {
  if (koBusy || !auth.currentUser) return;
  const upd = {}, pubs = [];
  for (const [id, m] of Object.entries(matches)) {
    if (m.status && m.status !== "scheduled") continue;
    const nm = { ...m };
    for (const s of ["A", "B"]) {
      if (!m["slot" + s] || m["team" + s]) continue;
      const t = resolveSlot(m["slot" + s]);
      if (t) { upd[`${id}/team${s}`] = t; nm["team" + s] = t; }
    }
    if (nm.teamA !== m.teamA || nm.teamB !== m.teamB) { upd[`${id}/updatedAt`] = C.now(); pubs.push([id, nm]); }
  }
  if (!pubs.length) return;
  koBusy = true;
  try {
    await C.update(ref(db, `sports/${S}/matches`), upd);
    pubs.forEach(([id, m]) => publish(id, m));
    pubs.forEach(([id, m]) => { if (m.teamA && m.teamB) log(id, m, `${m.round}: ${tn(m.teamA)} vs ${tn(m.teamB)} (filled in automatically)`); });
    toast(pubs.map(([, m]) => `${m.round}: ${tnm(m, "a")} vs ${tnm(m, "b")}`).join(" · "), 5000);
  } catch (e) { console.warn(e); }
  koBusy = false;
}

let ko = null;
function koPlans(c) {
  const pools = Object.keys(groupNow(catTeams(c))).sort();
  const cnt = p => catTeams(c).filter(([, t]) => poolOf(t) === p).length;
  const K = p => (c === "No category" ? "" : c.toUpperCase() + (p ? " – POOL " + p : "")) || p;
  const P = (p, n) => ({ slot: `P|${K(p)}|${n}`, lab: `${ord(n)} ${p ? "Pool " + p : c}` });
  const plans = [];
  if (pools.length === 2) {
    const [x, y] = pools;
    if (cnt(x) >= 2 && cnt(y) >= 2) plans.push({ id: "sf", name: `Semi-finals (1${x} v 2${y}, 1${y} v 2${x}) + Final`, sf: [[P(x, 1), P(y, 2)], [P(y, 1), P(x, 2)]] });
    plans.push({ id: "f", name: `Final only (1${x} v 1${y})`, f: [P(x, 1), P(y, 1)], third: [P(x, 2), P(y, 2)] });
  } else if (pools.length === 4) {
    const [a, b, d, e] = pools;
    plans.push({ id: "sf", name: `Semi-finals (1${a} v 1${b}, 1${d} v 1${e}) + Final`, sf: [[P(a, 1), P(b, 1)], [P(d, 1), P(e, 1)]] });
  } else if (pools.length <= 1) {
    const p = pools[0] || "", n = pools.length ? cnt(p) : catTeams(c).length;
    if (n >= 4) plans.push({ id: "sf", name: "Semi-finals (1st v 4th, 2nd v 3rd) + Final", sf: [[P(p, 1), P(p, 4)], [P(p, 2), P(p, 3)]] });
    if (n >= 2) plans.push({ id: "f", name: "Final only (1st v 2nd)", f: [P(p, 1), P(p, 2)], third: n >= 4 ? [P(p, 3), P(p, 4)] : null });
  }
  return plans;
}
function openKO(c) {
  const plans = koPlans(c);
  ko = { cat: c, plans };
  $("#koTitle").textContent = `🏆 Knockout – ${c}`;
  const existing = Object.values(matches).filter(m => (m.slotA || m.slotB) && sameCat(m.event, c === "No category" ? "" : c));
  $("#koSub").textContent = existing.length ? `This category already has ${existing.length} knockout match${existing.length > 1 ? "es" : ""}. New ones are added after them.` :
    "Teams are filled in automatically when the pool matches are all confirmed, and the final when both semis are done.";
  $("#koPlan").innerHTML = plans.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("");
  $("#koBody").classList.toggle("hide", !plans.length);
  $("#koNone").classList.toggle("hide", !!plans.length);
  $("#koNone").textContent = "Automatic knockouts work with 1, 2 or 4 pools. With other setups, add the semi-finals and final yourself in Setup → Add match.";
  $("#koSave").classList.toggle("hide", !plans.length);
  renderKO();
  $("#koModal").classList.remove("hide");
}
function koList() {
  const p = ko.plans[+$("#koPlan").value || 0]; if (!p) return [];
  const third = $("#koThird").checked, rows = [];
  if (p.sf) {
    rows.push({ round: "Semi-final 1", a: p.sf[0][0], b: p.sf[0][1] }, { round: "Semi-final 2", a: p.sf[1][0], b: p.sf[1][1] });
    if (third) rows.push({ round: "3rd place", a: { ref: 0, k: "L", lab: "Loser Semi-final 1" }, b: { ref: 1, k: "L", lab: "Loser Semi-final 2" } });
    rows.push({ round: "Final", a: { ref: 0, k: "W", lab: "Winner Semi-final 1" }, b: { ref: 1, k: "W", lab: "Winner Semi-final 2" } });
  } else {
    if (third && p.third) rows.push({ round: "3rd place", a: p.third[0], b: p.third[1] });
    rows.push({ round: "Final", a: p.f[0], b: p.f[1] });
  }
  return rows;
}
function renderKO() {
  const p = ko.plans[+$("#koPlan").value || 0];
  $("#koThirdWrap").classList.toggle("hide", !p || (!p.sf && !p.third));
  const start = nextNo();
  $("#koList").innerHTML = koList().map((r, i) => `<div class="korow"><span class="no">#${start + i}</span><b>${esc(r.round)}</b>
    <span>${esc(r.a.lab)} <span class="muted">vs</span> ${esc(r.b.lab)}</span></div>`).join("");
}
$("#koPlan").onchange = renderKO;
$("#koThird").onchange = renderKO;
$("#koClose").onclick = () => { ko = null; $("#koModal").classList.add("hide"); };
$("#koSave").onclick = async () => {
  const rows = koList(); if (!rows.length) return;
  const cat = ko.cat === "No category" ? "" : ko.cat, court = $("#koCourt").value.trim();
  let no = nextNo();
  const ids = rows.map(() => C.push(ref(db, `sports/${S}/matches`)).key);
  const side = x => x.ref != null ? { slot: `${x.k}|${ids[x.ref]}`, lab: x.lab } : x;
  const upd = {}, pubs = {};
  rows.forEach((r, i) => {
    const a = side(r.a), b = side(r.b);
    const m = { no: String(no++), time: "", court, round: r.round, group: "", event: cat, teamA: "", teamB: "",
      slotA: a.slot, slotB: b.slot, labA: a.lab, labB: b.lab, fmt: FORMATS[S], status: "scheduled", createdAt: C.now(), updatedAt: C.now() };
    upd[ids[i]] = m; pubs[ids[i]] = publicRecord(S, m, teams);
  });
  $("#koSave").disabled = true;
  try {
    await C.update(ref(db, `sports/${S}/matches`), upd);
    await C.update(ref(db, `pub/${S}/m`), pubs);
  } catch (e) { toast("Couldn't save – check the connection"); $("#koSave").disabled = false; return; }
  $("#koSave").disabled = false;
  log("", { no: "" }, `${rows.length} knockout matches created for ${ko.cat}`);
  toast(`${rows.map(r => r.round).join(", ")} created. Teams fill in by themselves.`, 5000);
  ko = null; $("#koModal").classList.add("hide");
  autoFillKO();
};

// ---------------------------------------------------------------- next step card
// A category (or pool) with teams but no matches yet → offer to create them in one tap.
const skipKey = "ja_skiprr_" + S;
const skipped = () => { try { return JSON.parse(store(skipKey) || "[]"); } catch (e) { return []; } };
function pendingGroups() {
  const by = {};
  for (const t of Object.values(teams)) { const k = keyOf(t); if (k) by[k] = (by[k] || 0) + 1; }
  const used = new Set(Object.values(matches).map(m => String(m.group || "").toUpperCase()));
  const skip = skipped();
  return Object.entries(by).filter(([k, n]) => n >= 2 && !used.has(k) && !skip.includes(k))
    .sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => ({ k, n, games: n * (n - 1) / 2 }));
}
function renderNextStep(el) {
  if (!el) return;
  const list = pendingGroups();
  el.innerHTML = list.map(p => `<div class="nextstep">
      <div class="ns-text"><b>Next step: ${esc(p.k)} has ${p.n} teams but no matches yet.</b>
        <span>${p.games > 1 ? `Create all ${p.games} matches now? Everyone plays everyone once.` : "Create their match now?"}</span></div>
      <div class="ns-btns"><button class="small primary" data-nsgo="${esc(p.k)}">Create ${p.games} match${p.games > 1 ? "es" : ""}</button>
        <button class="small" data-nsfx="${esc(p.k)}">Choose courts / edit…</button>
        <button class="small ghost" data-nsskip="${esc(p.k)}">I'll add them myself</button></div>
    </div>`).join("");
  $$("[data-nsgo]", el).forEach(b => b.onclick = async () => {
    b.disabled = true;
    const n = await genRR(b.dataset.nsgo, "", false);
    if (n) toast(`${n} match${n > 1 ? "es" : ""} created. Next: set times & courts in Setup.`, 5000);
    else b.disabled = false;
  });
  $$("[data-nsfx]", el).forEach(b => b.onclick = () => {
    const t = Object.values(teams).find(t => keyOf(t) === b.dataset.nsfx);
    if (t) openFixtures(catOf(t) || "No category");
  });
  $$("[data-nsskip]", el).forEach(b => b.onclick = () => {
    store(skipKey, JSON.stringify([...skipped(), b.dataset.nsskip]));
    renderNextStep($("#nextStep")); renderNextStep($("#teamNext"));
  });
}

$("#btnRepublish").onclick = async () => {
  try { await republishAll(); toast("Public data refreshed"); } catch (e) { toast("Error: " + e.message); }
};

// ---------------------------------------------------------------- guide
function renderGuide() {
  if ($("#guideBody").dataset.ready) return;
  const sec = (title, body, open) => `<details class="card guide" ${open ? "open" : ""}><summary><h3>${title}</h3></summary>${body}</details>`;
  const u = UNIT.toLowerCase();
  const scoring = {
    rally: `<ol>
      <li>Open your match. Tap the pair/team that <b>serves first</b>.</li>
      <li>After every rally, tap the <b>big box of the side that won the rally</b>. That's it – one tap per point.</li>
      <li>The <b>● SERVING</b> marker, the interval at mid-game, deuce, the max points and the next ${u} are all handled automatically.</li>
      <li>When someone wins, a green banner appears. Check the score, then tap <b>Confirm result</b>.</li>
    </ol>
    <p class="muted">Format for this match is shown before you start (e.g. best of 3, 21 points, max 30). If it's wrong, ask your lead to fix it in Setup → Edit before starting.</p>`,
    goals: `<ol>
      <li>Open your match and tap <b>Start match</b>. Tap <b>▶ Start clock</b> when play starts and <b>⏸ Pause clock</b> when the referee stops time.</li>
      <li>Tap <b>+ Goal</b> for the team that scored (then tap who scored, if a player list was added)${FORMATS[S].fouls ? ", and <b>Foul</b> when a foul is given" : ""}.</li>
      <li>At the end of each ${u}, tap <b>End ${u}</b>. The clock resets for the next one.</li>
      <li>When the match is over, tap <b>Confirm result</b>.</li>
    </ol>`,
    darts: `<ol>
      <li>Open your match and tap who <b>throws first</b>.</li>
      <li>After each turn of 3 darts, type the score on the keypad and tap <b>Enter</b>. The remaining score and whose turn it is update automatically.</li>
      <li>A checkout must finish on a double – the page will ask you to confirm.</li>
      <li>When the match is won, tap <b>Confirm result</b>.</li>
    </ol>`
  }[KIND];
  $("#guideBody").innerHTML = `
    <div class="card"><h3>Scorer guide · ${esc(SP.name)}</h3>
      <p>Every tap you make goes <b>straight to the big screen and the public QR page</b>. Take your time – mistakes can always be undone.</p></div>
    ${sec("1 · Log in", `<ol>
      <li>Open the ${esc(SP.name)} scorer link from the organiser.</li>
      <li>Type <b>your name and ${esc(cw)}</b>, e.g. <i>Ali – ${esc(CW)} 1</i>. This shows who is scoring which match.</li>
      <li>Enter the ${esc(SP.name)} password and tap <b>Log in</b>. Each court uses its own phone; everyone can use the same password.</li>
      <li>The small dot at the top is <b>green</b> when online. If it turns <b>red</b>, keep scoring – it will sync when the signal is back.</li>
      <li>Need another scorer? On the Matches tab tap <b>📲 Share this scorer page</b> – they can scan the QR or get the link on WhatsApp. Tell them the password yourself.</li></ol>`, true)}
    ${sec("2 · Find your match", `<ol>
      <li>Go to the <b>Matches</b> tab. Tap your <b>category</b> (e.g. MIX DOUBLE) and your <b>${esc(cw)}</b> at the top to see only your matches. The phone remembers this.</li>
      <li>Matches are listed as <b>Live now</b>, <b>Up next</b> and <b>Finished</b>.</li>
      <li>Tap the match to open it. It is now <b>locked to your phone</b> 🔒 so nobody else can change it by accident.</li></ol>`)}
    ${sec("3 · Score the match", scoring, true)}
    ${sec("4 · Fixing mistakes", `<ul>
      <li><b>Wrong point/goal?</b> Tap <b>↶ Undo</b>. You can undo many times.</li>
      <li><b>Wrong result after confirming?</b> More ▾ → <b>Reopen match</b>, fix it, then confirm again.</li>
      <li><b>Tapped Start by mistake?</b> More ▾ → <b>Back to "not started"</b> (only before the first point).</li>
      <li><b>Phone died / changing scorer?</b> On the other phone open the match and tap <b>Take control</b>. The score is kept.</li></ul>`)}
    ${sec("5 · Special situations", `<ul>
      <li><b>A team doesn't show up:</b> More ▾ → <b>Walkover</b> → pick the winner.</li>
      <li><b>Players change ends:</b> More ▾ → <b>Swap sides on this screen</b>, so the boxes match where they stand.</li>
      <li><b>Finished with the match:</b> tap <b>← Matches</b> to go back. This releases the lock automatically.</li></ul>`)}
    ${sec("6 · For the AJK lead (before the event)", `<ol>
      <li><b>Teams tab:</b> pick the category, then add each team with its players (e.g. <i>VOLTRA – Irfan / Ali</i>). Use “Paste many teams” to add a whole category at once.</li>
      <li>When a category has its teams, a <b>“Create matches”</b> card appears on the Matches tab – one tap makes every match for that category.</li>
      <li>Or use <b>Setup tab → Generate round-robin:</b> pick a category to create all its matches in one go. Or paste the whole schedule from Excel with <b>Paste the schedule</b>, or add matches one by one with <b>Add match</b>.</li>
      <li>Then open <b>Setup → Times &amp; courts</b>: type each match's time and court, or use <b>⚡ Quick fill</b> (start time, minutes between matches, court) to fill a whole category at once. The progress bar on the Matches tab shows what's left.</li>
      <li>Standings are worked out automatically for each category from confirmed results.</li></ol>`)}
    ${sec("Tips", `<ul>
      <li>Charge the phone fully and keep the screen on. Turn the brightness up.</li>
      <li><b>Add the scorer page to your Home Screen</b> so it opens like an app – full screen and no accidental refresh. <a href="#" id="guideA2">Show me how</a></li>
      <li>Don't share the password outside your sport's AJK.</li>
      <li>Not sure? Don't guess – ask your AJK lead, then use Undo if needed.</li></ul>`)}`;
  $("#guideBody").dataset.ready = "1";
  const ga = $("#guideA2"); if (ga) ga.onclick = e => { e.preventDefault(); openA2hs(); };
}
$("#btnGuideLogin").onclick = () => show("vGuide");
$("#btnGuideBack").onclick = () => { if (auth.currentUser) goTab("list"); else show("vLogin"); };

// ---------------------------------------------------------------- log
function startLog() {
  if (logUnsub) return;
  logUnsub = C.onValue(C.query(ref(db, `logs/${S}`), C.limitToLast(150)), snap => {
    const rows = [];
    snap.forEach(c => { rows.push(c.val()); });
    rows.reverse();
    $("#logList").innerHTML = rows.length ? `<table><tr><th>Time</th><th>By</th><th>Match</th><th>Action</th></tr>` +
      rows.map(r => `<tr><td style="white-space:nowrap">${r.at ? new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</td>
        <td>${esc(r.by)}</td><td>${r.no !== "" && r.no != null ? "#" + esc(r.no) : "—"}</td><td>${esc(r.act)}</td></tr>`).join("") + `</table>` : `<p class="muted">Nothing yet. Every match start, point, result and change made by your scorers will appear here, newest first.</p>`;
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
  "Calling teams to " + CW + " ",
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
// this sport's own big screen (the same page OBS shows, filtered to this sport)
const BIG_URL = new URL(`../display/?sport=${S}`, location.href).href;
$("#bigBar").innerHTML = `<a class="bigbtn" href="${BIG_URL}" target="_blank" rel="noopener">
  <span>📺 Open the ${esc(SP.name)} big screen</span><small>Live scores of this sport, full screen · opens in a new tab</small></a>
  <button class="bigbtn sharebtn" id="btnShare" type="button"><span>📲 Share this scorer page</span><small>QR code or WhatsApp link for another AJK / scorer</small></button>`;

// "More ▾" menu: open towards whichever side has room, so it never runs off the screen
document.addEventListener("toggle", e => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("menu") || !d.open) return;
  const it = d.querySelector(".items"); if (!it) return;
  it.style.left = "0"; it.style.right = "auto";
  const r = it.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) { it.style.left = "auto"; it.style.right = "0"; }
}, true);

// ---------------------------------------------------------------- add to home screen (invite card + steps)
const A2_KEY = "ja_a2hs_hide";
const isStandalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const UA = navigator.userAgent || "";
const isIOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(UA);
const isPhone = isIOS || isAndroid || (window.matchMedia && matchMedia("(pointer:coarse)").matches);
// Bottom tab bar on phones. In iPhone browsers (Safari, Chrome…) the page's "bottom" sits above
// the real bottom of the screen, so there the bar is placed by measuring what is actually visible.
document.documentElement.classList.add("btabs");
if (isIOS && !isStandalone()) {
  document.documentElement.classList.add("iosvv");
  const vv = window.visualViewport;
  const placeTabs = () => {
    const t = document.getElementById("tabs");
    if (!t || t.classList.contains("hide")) return;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    t.style.top = Math.round(bottom - t.offsetHeight) + "px";
  };
  ["resize", "scroll", "orientationchange"].forEach(ev => window.addEventListener(ev, placeTabs, { passive: true }));
  if (vv) { vv.addEventListener("resize", placeTabs); vv.addEventListener("scroll", placeTabs); }
  new MutationObserver(placeTabs).observe(document.getElementById("tabs"), { attributes: true, attributeFilter: ["class"] });
  setInterval(placeTabs, 700);   // browser bars slide in/out without always telling the page
  placeTabs();
}
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderA2hs(); });
window.addEventListener("appinstalled", () => { store(A2_KEY, "1"); renderA2hs(); toast("Added to your Home Screen 🎉"); });
{ const t = document.getElementById("appTitle"); if (t) t.content = `${SP.name} Scorer`; }
function renderA2hs() {
  const el = $("#a2hsBar");
  if (!el) return;
  if (isStandalone() || !isPhone || store(A2_KEY)) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="a2bar"><div class="a2ic"><img src="../img/icon-192.png" alt=""></div>
    <div class="a2tx"><b>Use this like an app</b><small>Add it to your Home Screen: opens full screen, no accidental refresh.</small></div>
    <div class="a2btns"><button class="small primary" id="a2Go">${installEvt ? "Install" : "Show me how"}</button><button class="small ghost" id="a2No" title="Hide">✕</button></div></div>`;
  $("#a2Go").onclick = async () => {
    if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; renderA2hs(); return; }
    openA2hs();
  };
  $("#a2No").onclick = () => { store(A2_KEY, "1"); renderA2hs(); toast("Hidden. The steps are in the Guide tab."); };
}
function a2hsSteps() {
  const ios = `<div class="a2os"><b>iPhone / iPad (Safari)</b><ol>
      <li>Tap the <b>Share</b> button <span class="a2k">⬆︎</span> at the bottom of Safari.</li>
      <li>Scroll down and tap <b>Add to Home Screen</b> <span class="a2k">＋</span>.</li>
      <li>Tap <b>Add</b>. Open <b>${esc(SP.name)} Scorer</b> from your Home Screen.</li>
      <li>Log in once more inside the app (iPhone keeps it separate from Safari).</li></ol>
      <p class="muted" style="font-size:12.5px;margin:0">Using Chrome on iPhone? Tap <b>⬆︎ Share</b> at the top right → <b>Add to Home Screen</b>.</p></div>`;
  const and = `<div class="a2os"><b>Android (Chrome / Samsung Internet)</b><ol>
      <li>Tap the <b>⋮ menu</b> (top right in Chrome, ☰ at the bottom in Samsung Internet).</li>
      <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
      <li>Tap <b>Install</b> / <b>Add</b>. Open it from your Home Screen – you stay logged in.</li></ol></div>`;
  return isIOS ? ios + `<details style="margin-top:8px"><summary class="muted">Android steps</summary>${and}</details>`
       : isAndroid ? and + `<details style="margin-top:8px"><summary class="muted">iPhone steps</summary>${ios}</details>` : ios + and;
}
function openA2hs() { $("#a2Steps").innerHTML = a2hsSteps(); $("#a2hsModal").classList.remove("hide"); }
$("#a2Close").onclick = () => $("#a2hsModal").classList.add("hide");
$("#a2hsModal").onclick = e => { if (e.target.id === "a2hsModal") $("#a2hsModal").classList.add("hide"); };
renderA2hs();

// ---------------------------------------------------------------- share this scorer page
const SCORER_URL = new URL(`./?sport=${S}`, location.href).href;
function openShare() {
  $("#shTitle").textContent = `📲 Share the ${SP.name} scorer page`;
  $("#shUrl").textContent = SCORER_URL;
  const box = $("#shQR");
  if (!box.dataset.ready) {
    if (window.QRCode) { new QRCode(box, { text: SCORER_URL, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }); box.dataset.ready = "1"; }
    else box.innerHTML = `<p class="muted">QR code needs internet – use the link below.</p>`;
  }
  $("#shNative").classList.toggle("hide", !navigator.share);
  $("#shareModal").classList.remove("hide");
}
const shareText = () => `${SP.name} scorer page – HQ Games 2026\n${SCORER_URL}\n(Ask the AJK lead for the password)`;
$("#btnShare").onclick = openShare;
$("#shClose").onclick = () => $("#shareModal").classList.add("hide");
$("#shareModal").onclick = e => { if (e.target.id === "shareModal") $("#shareModal").classList.add("hide"); };
$("#shWa").onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent(shareText()), "_blank");
$("#shCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(SCORER_URL); toast("Link copied"); }
  catch (e) { prompt("Copy this link:", SCORER_URL); }
};
$("#shNative").onclick = () => navigator.share({ title: `${SP.name} scorer`, text: shareText() }).catch(() => {});

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
      team: m ? `#${m.no} ${tnm(m, "a")} vs ${tnm(m, "b")}` : "", at: C.serverTimestamp()
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
    const r = { no, time, court, a, b, round, group: poolLetters(group), event, ta: findTeam(a), tb: findTeam(b), problems: [], skip: false };
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
    let g = r.group || poolLetters((r.round.match(/^group\s+(\w+)/i) || [])[1] || "");
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
