// =====================================================================
//  Sport name / date / venue as edited in Admin (Big screen tab →
//  "Sport names, dates & venues"). Saved at settings/sportInfo/<sport>.
//  A blank field means "use what config.js says".
//  Every page calls applySportInfo() when it gets the settings, so the
//  scorer header, the public tabs, Admin and the big screen all agree.
// =====================================================================
import { SPORTS } from "../config.js?v=20261113n";

export const SPORT_BASE = Object.fromEntries(Object.entries(SPORTS).map(([id, s]) => [id, { name: s.name, day: s.day, venue: s.venue || "" }]));

// Bowling and Mobile Legends have their own pages; only their name can be changed in Admin.
// (Short names used on the public pages' tabs when Admin has not set one.)
export const BOARD_TAB = { bowling: "Bowling", mlbb: "Mobile Legends" };
export const boardTabName = (info, id) => String(((info && info[id]) || {}).name || "").trim() || BOARD_TAB[id] || id;

export function applySportInfo(info) {
  let changed = false;
  for (const [id, s] of Object.entries(SPORTS)) {
    const o = (info && info[id]) || {}, b = SPORT_BASE[id];
    const next = { name: String(o.name || "").trim() || b.name, day: String(o.day || "").trim() || b.day, venue: String(o.venue || "").trim() || b.venue };
    for (const k of ["name", "day", "venue"]) if ((s[k] || "") !== next[k]) { s[k] = next[k]; changed = true; }
  }
  return changed;
}
