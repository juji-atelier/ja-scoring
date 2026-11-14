// Shared helpers for pages that use the Firebase SDK (scorer, admin, display).
import { firebaseConfig } from "../config.js?v=20261114y";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, onValue, push, set, update, remove, runTransaction, serverTimestamp, get,
         query, limitToLast, orderByChild }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
// Each page type gets its own named Firebase app, so its login is kept separately.
// (Admin and every sport's scorer can stay logged in side by side in one browser.)
const _seg = location.pathname.split("/").filter(Boolean);
const _page = _seg.includes("admin") ? "admin" : _seg.includes("scorer") ? "scorer-" + (new URLSearchParams(location.search).get("sport") || "x")
            : _seg.includes("display") ? "display" : "public";
export const app = configured ? initializeApp(firebaseConfig, "ja-" + _page) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getDatabase(app) : null;
export { signInWithEmailAndPassword, onAuthStateChanged, signOut,
         ref, onValue, push, set, update, remove, runTransaction, serverTimestamp, get,
         query, limitToLast, orderByChild };

// Server clock offset so every screen shows the same match timer.
export let serverOffset = 0;
if (db) onValue(ref(db, ".info/serverTimeOffset"), s => { serverOffset = Number(s.val()) || 0; });
export const now = () => Date.now() + serverOffset;

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
  } catch (e) { return null; }
}

export function toast(msg, ms = 2200) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), ms);
}

export function notConfiguredScreen() {
  document.body.innerHTML = `<div style="font-family:system-ui;padding:32px;max-width:560px;margin:auto">
    <h2>Setup needed</h2><p>Paste your Firebase web config into <b>config.js</b> first. See SETUP.md.</p></div>`;
}

// ---------------------------------------------------------------- "reload your page" from Admin
// Admin writes settings/reload. Every page watches it and reacts only to a CHANGE, never to
// the value that is already there when the page opens - so opening a page never reloads it.
// No clocks are compared, so a phone with the wrong time still behaves.
// GitHub Pages serves index.html with max-age=600, so for ten minutes after a deploy a plain
// reload can hand back the OLD page - and with it the old script tags. Changing the URL makes
// the browser fetch the document fresh, so a reload always lands on the published version.
export function reloadFresh(key) {
  try {
    const u = new URL(location.href);
    u.searchParams.set("r", String(key || Date.now()));
    location.replace(u.toString());
  } catch (e) { location.reload(); }
}

export function watchReload(onSignal) {
  if (!db) return;
  let seen, first = true;
  onValue(ref(db, "settings/reload"), s => {
    const v = s.val() || null, key = v ? String(v.at || "") : "";
    if (first) { first = false; seen = key; return; }
    if (key && key !== seen) { seen = key; onSignal(v); }
  });
}

export const byNo = (x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999) || String(x.no).localeCompare(String(y.no));
