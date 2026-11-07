import { SPORTS, ADMIN_EMAIL, EVENT_DEFAULTS } from "../config.js";
import { publicRecord, standings } from "../js/engines.js";
import { bowlingStandings, BOWL_ROOT } from "../js/bowling-data.js";
import * as C from "../js/common.js";
const { $, $$, esc, toast, ref } = C;

if (!C.configured) { C.notConfiguredScreen(); throw new Error("not configured"); }
const db = C.db, auth = C.auth;
const BASE = new URL("../", location.href).href;
const PUBLIC_URL = BASE + "live/";

let pub = {}, settings = {}, started = false, logUnsub = null;

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
  C.onValue(ref(db, "settings"), s => { settings = s.val() || {}; fillScreenForm(); });
  renderLinks();
  const opts = Object.entries(SPORTS).map(([id, s]) => `<option value="${id}">${esc(s.name)}</option>`).join("");
  $("#sSport").innerHTML = opts; $("#logSport").innerHTML = opts + `<option value="bowling">Tenpin Bowling</option>`; $("#clrSport").innerHTML = opts;
  startFeedback();
  $("#logSport").onchange = startLog;
  startLog();
}

// ---------------- overview
const recs = sp => Object.entries((pub[sp] && pub[sp].m) || {}).map(([id, r]) => ({ id, ...r }));
function renderOverview() {
  $("#overview").innerHTML = Object.entries(SPORTS).map(([id, s]) => {
    const all = recs(id);
    const live = all.filter(r => r.st === "live");
    const cnt = st => all.filter(r => r.st === st).length;
    return `<div class="scard" style="--c:${s.color}">
      <div class="row"><h4 style="flex:1">${esc(s.name)}</h4><span class="muted" style="font-size:12px">${esc(s.day)}</span></div>
      <div class="cnt"><span><b>${live.length}</b> live</span><span><b>${cnt("scheduled")}</b> upcoming</span><span><b>${cnt("done")}</b> finished</span></div>
      ${live.map(r => {
        const v = r.v || {};
        return `<div class="mini"><span>${r.ct ? "C" + esc(r.ct) + " · " : ""}${esc(r.a)} vs ${esc(r.b)}</span>
          <b>${(v.big || [])[0] ?? ""}–${(v.big || [])[1] ?? ""}</b>
          <button class="small ghost" data-feat="${id}/${r.id}" title="Show this match full screen">📺</button></div>`;
      }).join("")}
      <div class="row" style="margin-top:8px"><a href="${BASE}scorer/?sport=${id}" target="_blank"><button class="small">Open scorer ↗</button></a>
      <button class="small ghost" data-pin="${id}">Pin on big screen</button></div></div>`;
  }).join("");
  $$("[data-feat]").forEach(b => b.onclick = () => saveDisplay({ mode: "match", match: b.dataset.feat }, "Featured on big screen"));
  $$("[data-pin]").forEach(b => b.onclick = () => saveDisplay({ mode: "sport", sport: b.dataset.pin }, `${SPORTS[b.dataset.pin].name} pinned`));
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
    `<label><input type="checkbox" value="${id}" ${!d.sports || d.sports[id] !== false ? "checked" : ""}> ${esc(s.name)}</label>`).join("");
  fillMatchSelect();
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
    Object.entries(SPORTS).map(([id, s]) => row(s.name + " only", `${BASE}display/?sport=${id}`)).join("") +
    row("Transparent overlay", BASE + "display/?bg=transparent");
  const BW = BASE + "bowling.html";
  $("#bowlLinks").innerHTML = row("Scorer (bowling AJK)", BW + "?v=scorer") + row("Public page", BW) +
    row("OBS panel – rotates", BW + "?v=overlay") + row("OBS panel – teams only", BW + "?v=overlay&show=team");
  $$("[data-copy]").forEach(b => b.onclick = () => copy(b.dataset.copy));
  renderScorerQR(BW);
}

// one QR per scorer link (6 sports + bowling)
function renderScorerQR(BW) {
  const items = [...Object.entries(SPORTS).map(([id, s]) => ({ id, name: s.name, color: s.color, url: `${BASE}scorer/?sport=${id}` })),
    { id: "bowling", name: "Bowling", color: "#8b5cf6", url: BW + "?v=scorer" }];
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
const AW_CATS = [
  ...Object.entries(SPORTS).map(([id, s]) => ({ id, label: s.name, color: s.color })),
  { id: "bowl_team", label: "Bowling · Team", color: "#8b5cf6" },
  { id: "bowl_men", label: "Bowling · Men", color: "#8b5cf6" },
  { id: "bowl_women", label: "Bowling · Women", color: "#8b5cf6" }
];
const PLACES = ["1st", "2nd", "3rd"];
function awardsFromForm() {
  return AW_CATS.map(c => ({ id: c.id, label: c.label, color: c.color,
    p: PLACES.map((_, i) => (($(`#awardsForm input[data-c="${c.id}"][data-i="${i}"]`) || {}).value || "").trim()) }));
}
function fillAwards(saved) {
  const cur = {};
  (Array.isArray(saved) ? saved : Object.values(saved || {})).forEach(a => { if (a && a.id) cur[a.id] = a.p || []; });
  if (!$("#awardsForm table")) {
    $("#awardsForm").innerHTML = `<table class="aw"><tr><th>Category</th>${PLACES.map(p => `<th>${p}</th>`).join("")}</tr>` +
      AW_CATS.map(c => `<tr><td style="--c:${c.color}"><i></i>${esc(c.label)}</td>${PLACES.map((_, i) =>
        `<td><input data-c="${c.id}" data-i="${i}" placeholder="—"></td>`).join("")}</tr>`).join("") + `</table>`;
  }
  AW_CATS.forEach(c => PLACES.forEach((_, i) => {
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
  let filled = 0;
  for (const c of AW_CATS) (auto[c.id] || []).forEach((v, i) => {
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
