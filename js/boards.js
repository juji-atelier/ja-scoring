// =====================================================================
//  Score boards that are NOT match-by-match sports: they have their own
//  page and their own data in Firebase (bowling, Mobile Legends, ...).
//
//  Admin reads this list for every tab (Overview, Big screen winners,
//  Links & QR, Tools, Feedback). To add another one later, add an entry
//  here – it then appears in Admin by itself.
//
//  Normal sports (matches between two teams) are added in config.js
//  (SPORTS) and js/engines.js (FORMATS / ENGINE_OF) instead; Admin picks
//  those up the same way.
// =====================================================================
import { BOWL_ROOT } from "./bowling-data.js?v=20261114u";

// Mobile Legends: every match in the data published by the JA ESPORT console (mlbb/live)
export function mlbbMatches(D) {
  const out = [];
  for (const r of (D && D.rounds) || []) (r.matches || []).forEach((m, i) => out.push({ ...m, label: `R${r.no} M${i + 1}` }));
  const p = (D && D.playoffs) || {};
  (p.semis || []).forEach((m, i) => out.push({ ...m, label: "Semi " + (i + 1) }));
  if (p.third_m) out.push({ ...p.third_m, label: "3rd place" });
  if (p.final) out.push({ ...p.final, label: "Final" });
  return out;
}

// Names changed in Admin (settings/sportInfo/<id>/name); blank = the name written below.
let BOARD_BASE = null;
export function applyBoardInfo(info) {
  BOARD_BASE = BOARD_BASE || Object.fromEntries(Object.entries(BOARDS).map(([id, b]) => [id, b.name]));
  let changed = false;
  for (const [id, b] of Object.entries(BOARDS)) {
    const n = String(((info && info[id]) || {}).name || "").trim() || BOARD_BASE[id];
    if (b.name !== n) { b.name = n; changed = true; }
  }
  return changed;
}
export const boardBaseName = id => (BOARD_BASE && BOARD_BASE[id]) || BOARDS[id].name;

export const BOARDS = {
  bowling: {
    name: "Tenpin Bowling", short: "Bowling", color: "#8b5cf6",
    path: BOWL_ROOT,                 // where its data lives in Firebase
    page: "bowling.html",            // public page (relative to the site root)
    scorer: "bowling.html?v=scorer", // scorer link (gets a QR code); leave out if none
    links: [["Scorer (bowling AJK)", "bowling.html?v=scorer"], ["Public page", "bowling.html"],
            ["OBS panel – rotates", "bowling.html?v=overlay"], ["OBS panel – teams only", "bowling.html?v=overlay&show=team"]],
    awards: [["bowl_team", "Bowling · Team"], ["bowl_men", "Bowling · Men"], ["bowl_women", "Bowling · Women"]],
    log: true,                       // has an activity log under logs/<id>
    restore: true                    // Admin may write this data back from a backup file
  },
  mlbb: {
    name: "Mobile Legends", short: "MLBB", color: "#f59e0b",
    path: "mlbb/live",
    page: "mlbb.html",
    links: [["Public page", "mlbb.html"]],
    awards: [["mlbb", "Mobile Legends"]],
    note: "Scores come from the JA ESPORT console."
  }
};
