// =====================================================================
//  Sport name / date / venue as edited in Admin (Big screen tab →
//  "Sport names, dates & venues"). Saved at settings/sportInfo/<sport>.
//  A blank field means "use what config.js says".
//  Every page calls applySportInfo() when it gets the settings, so the
//  scorer header, the public tabs, Admin and the big screen all agree.
// =====================================================================
import { SPORTS } from "../config.js?v=20261110h";

export const SPORT_BASE = Object.fromEntries(Object.entries(SPORTS).map(([id, s]) => [id, { name: s.name, day: s.day, venue: s.venue || "" }]));

export function applySportInfo(info) {
  let changed = false;
  for (const [id, s] of Object.entries(SPORTS)) {
    const o = (info && info[id]) || {}, b = SPORT_BASE[id];
    const next = { name: String(o.name || "").trim() || b.name, day: String(o.day || "").trim() || b.day, venue: String(o.venue || "").trim() || b.venue };
    for (const k of ["name", "day", "venue"]) if ((s[k] || "") !== next[k]) { s[k] = next[k]; changed = true; }
  }
  return changed;
}
