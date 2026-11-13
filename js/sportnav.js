// Sport picker grid used on the public live page, bowling page and Mobile Legends page.
// One tile per sport: drawn icon (in the sport's colour), name, date, and a red "LIVE" count.
// No horizontal scrolling on phones: 4 tiles per row (6 on wide screens).
import { shown, isDone } from "./livecfg.js?v=20261113m";
export const SPORT_ICONS = {
// karom: square board, corner pockets, centre circle, discs
karom: `<rect x="5" y="5" width="22" height="22" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><circle cx="23.5" cy="8.5" r="1.6"/><circle cx="8.5" cy="23.5" r="1.6"/><circle cx="23.5" cy="23.5" r="1.6"/><circle cx="16" cy="16" r="4"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/>`,
// sepak takraw: woven rattan ball (circle with hexagon-ish weave)
sepaktakraw: `<circle cx="16" cy="16" r="11"/><path d="M16 5v6l5 3v5l-5 3-5-3v-5l5-3M21 14l5.5-3M21 19l5 3M16 22v5M11 19l-5 3M11 14l-5.5-3"/>`,
// badminton: shuttlecock
badminton: `<path d="M12 21l-5-12h18l-5 12z"/><path d="M12 21l4-12M20 21l-4-12M9.5 15h13"/><path d="M12 21h8v2a4 4 0 0 1-8 0z" fill="currentColor"/>`,
// bola sepak: football with pentagon
bolasepak: `<circle cx="16" cy="16" r="11"/><path d="M16 11l4.5 3.3-1.7 5.3h-5.6l-1.7-5.3z" fill="currentColor"/><path d="M16 11V5.5M20.5 14.3l5-1.8M18.8 19.6l3.2 4.6M13.2 19.6l-3.2 4.6M11.5 14.3l-5-1.8"/>`,
// futsal: small goal + ball
futsal: `<path d="M4 26V9h24v17"/><path d="M4 9l3 3h18l3-3M7 12v14M25 12v14M7 17h18M7 22h18M13 12v14M19 12v14" stroke-width="1.2"/><circle cx="16" cy="23" r="4" fill="var(--card)"/><circle cx="16" cy="23" r="4"/>`,
// bola jaring (netball): ring on a post, no backboard, ball
bolajaring: `<path d="M9 28V8"/><ellipse cx="15" cy="8" rx="6" ry="2"/><path d="M9.5 9.5l2 6h7l2-6M12 10l1 5.5M18 10l-1 5.5" stroke-width="1.2"/><circle cx="22.5" cy="22" r="4.5"/><path d="M18 22h9M22.5 17.5v9" stroke-width="1.2"/>`,
// dart: dartboard + dart
dart: `<circle cx="14" cy="18" r="10"/><circle cx="14" cy="18" r="6"/><circle cx="14" cy="18" r="2" fill="currentColor"/><path d="M14 18L26 6M22 5l4 1 1 4M26 6l-2.5 2.5"/>`,
// ping pong: paddle + ball
pingpong: `<path d="M12.5 19.5l-6.5 6.5" stroke-width="4.2"/><circle cx="18" cy="13" r="9" fill="currentColor"/><path d="M12 9.5c2-3 6.5-4 9.5-1.5" stroke="var(--card)" stroke-width="1.6" opacity=".7"/><circle cx="7" cy="7" r="2.8" fill="currentColor"/>`,
// bola tampar (volleyball)
bolatampar: `<circle cx="16" cy="16" r="11"/><path d="M16 5c-1 6 1 9 6 12M27 16c-5-1-9 1-11 6M9 25c2-5 1-9-4-12M16 5c4 3 6 7 6 12M5 13c5 0 9 2 11 9"/>`,
// pickleball: solid paddle + holed ball
pickleball: `<rect x="5" y="4" width="13" height="16" rx="5"/><path d="M11.5 20v8" stroke-width="3.2"/><circle cx="23.5" cy="23" r="4.5"/><circle cx="22" cy="21.5" r=".8" fill="currentColor"/><circle cx="25" cy="21.8" r=".8" fill="currentColor"/><circle cx="23.5" cy="24.8" r=".8" fill="currentColor"/>`,
// bowling: pin + ball
bowling: `<path d="M10 4c2 0 3 1.5 3 3.5 0 1.5-1 2.5-1 3.5 0 2 3 4.5 3 9 0 4-2 7-5 7s-5-3-5-7c0-4.5 3-7 3-9 0-1-1-2-1-3.5C7 5.5 8 4 10 4z"/><path d="M8 11.5h4"/><circle cx="23" cy="22" r="6"/><circle cx="21.5" cy="20" r=".9" fill="currentColor"/><circle cx="24.5" cy="20" r=".9" fill="currentColor"/><circle cx="23" cy="23" r=".9" fill="currentColor"/>`,
// mobile legends: phone held sideways with a sword
mlbb: `<path d="M9 10h14c3.3 0 5.5 2.6 6 6.2l.9 5.6c.4 2.6-1.6 4.4-3.8 3.4-1.4-.6-2.4-2.2-3.6-3.7H9.5c-1.2 1.5-2.2 3.1-3.6 3.7-2.2 1-4.2-.8-3.8-3.4L3 16.2C3.5 12.6 5.7 10 9 10z"/><path d="M10 14v5M7.5 16.5h5"/><circle cx="21.5" cy="14.6" r="1.4" fill="currentColor"/><circle cx="24.5" cy="17.6" r="1.4" fill="currentColor"/>`
};

SPORT_ICONS.default = `<circle cx="16" cy="16" r="10"/>`;

const CSS = `
.sgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:4px 0 8px}
@media (min-width:700px){.sgrid{grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}}
.sgrid a{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 3px 7px;border-radius:14px;
  background:var(--card);border:1px solid var(--line);text-decoration:none;color:var(--ink);font:700 11.5px/1.15 Inter,system-ui,sans-serif;
  text-align:center;min-width:0;transition:transform .12s,border-color .12s}
.sgrid a:active{transform:scale(.97)}
.sgrid a svg{width:30px;height:30px;flex:none;color:var(--c)}
.sgrid a .nm{overflow-wrap:anywhere}
.sgrid a small{font:600 10px/1.1 Inter,system-ui,sans-serif;color:var(--mute)}
.sgrid a.on{background:color-mix(in srgb,var(--c) 18%,var(--card))!important;border-color:var(--c)!important;box-shadow:0 0 0 1px var(--c);color:var(--ink)!important}
.sgrid a:before{content:none!important}
.sgrid a small{display:block!important}
.sgrid a .dnc{position:absolute;top:4px;right:4px;background:#16a34a;color:#fff;border-radius:999px;font:900 9px/1 Inter,sans-serif;padding:3px 5px;letter-spacing:.02em}
.sgrid a .lvc{position:absolute;top:4px;right:4px;background:#e11d48;color:#fff;border-radius:999px;font:900 9px/1 Inter,sans-serif;padding:3px 5px;letter-spacing:.02em}
`;
let cssDone = false;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svg = id => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SPORT_ICONS[id] || SPORT_ICONS.default}</svg>`;
const shortDay = d => String(d || "").replace(/\s+(Nov|Dec|Oct|Jan)\w*$/i, "");

// items: [{ id, name, sub, color, href, live }]
export function renderSportGrid(el, items, current) {
  if (!el) return;
  if (!cssDone) { const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); cssDone = true; }
  el.classList.add("sgrid");
  el.innerHTML = items.map(it => `<a href="${esc(it.href)}" class="${it.id === current ? "on" : ""}" style="--c:${esc(it.color)}" aria-label="${esc(it.name)}">
    ${it.live ? `<span class="lvc">${it.live} LIVE</span>` : it.done ? `<span class="dnc">✓ DONE</span>` : ""}${svg(it.id)}<span class="nm">${esc(it.name)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</a>`).join("");
}
// the standard list: every sport + bowling + Mobile Legends. hrefOf(id) gives each link.
// cfg (settings/live, see js/livecfg.js): sports hidden in Admin are left out, completed ones get a ✓.
export function sportItems(SPORTS, hrefOf, names = {}, liveCounts = {}, cfg = null) {
  return [
    ...Object.entries(SPORTS).map(([id, s]) => ({ id, name: s.name, sub: shortDay(s.day), color: s.color, href: hrefOf(id), live: liveCounts[id] || 0 })),
    { id: "bowling", name: names.bowling || "Bowling", sub: "Tenpin", color: "#8b5cf6", href: hrefOf("bowling") },
    { id: "mlbb", name: names.mlbb || "Mobile Legends", sub: "E-Sport", color: "#f59e0b", href: hrefOf("mlbb") }
  ].filter(it => shown(cfg, it.id)).map(it => ({ ...it, done: isDone(cfg, it.id), live: isDone(cfg, it.id) ? 0 : it.live }));
}
// how many matches are live in each sport: reads only the keys of pub/<sport>/live (a few bytes each)
export async function fetchLiveCounts(base, ids, cfg = null) {
  const out = {};
  await Promise.all(ids.filter(id => shown(cfg, id) && !isDone(cfg, id)).map(async id => {
    try { const r = await fetch(`${base}/pub/${id}/live.json?shallow=true`, { cache: "no-store" }); const j = r.ok ? await r.json() : null; out[id] = j ? Object.keys(j).length : 0; }
    catch (e) { out[id] = 0; }
  }));
  return out;
}
