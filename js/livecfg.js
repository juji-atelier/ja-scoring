// =====================================================================
//  Live score settings (Admin → Live score tab).
//
//  settings/live/show/<id> = false  → that sport is hidden from the public
//                                     live-score pages (live/, bowling.html, mlbb.html)
//  settings/live/done/<id> = true   → "Completed": the public pages show the
//                                     kept copy below, whatever happens to the live data
//
//  Kept copies: pub/_keep/<id> = { d: <data>, at: <time>, src: "auto" | "done" }
//    sports:          d = { m: <published matches> }   (copy of pub/<sport>/m)
//    Mobile Legends:  d = <the JA ESPORT console's data> (copy of mlbb/live)
//  Mobile Legends is also kept automatically while Admin is open, so clearing the
//  ML console does not empty the public page. Only "Reset live score system" in
//  Admin deletes the kept copies.
//  (pub/_keep sits under pub/ so it needs no change to the database rules:
//   anyone can read pub, only Admin can write pub/_keep.)
// =====================================================================
export const KEEP = "_keep";

export const cfgOf = settings => {
  const l = (settings && settings.live) || {};
  return { show: l.show || {}, done: l.done || {} };
};
export const shown = (cfg, id) => !(cfg && cfg.show && cfg.show[id] === false);
export const isDone = (cfg, id) => !!(cfg && cfg.done && cfg.done[id]);

const vals = x => (x && typeof x === "object" ? Object.values(x) : []);
// does the Mobile Legends console data hold anything worth showing?
export function mlHas(D) {
  if (!D || typeof D !== "object") return false;
  const p = D.playoffs || {};
  return vals(D.groups).some(g => vals(g).length > 0)
    || vals(D.rounds).some(r => r && vals(r.matches).length > 0)
    || !!(p.champion || p.final || vals(p.semis).length);
}
// what the public should see for Mobile Legends: completed → kept copy; otherwise the
// console's live data, or the kept copy when the console has been cleared
export function mlEffective(live, keep, cfg) {
  const k = keep && keep.d;
  if (isDone(cfg, "mlbb") && mlHas(k)) return { D: k, kept: true };
  if (mlHas(live)) return { D: live, kept: false };
  if (mlHas(k)) return { D: k, kept: true };
  return { D: live || null, kept: false };
}
// a sport's public data (pub/<sport>): the kept copy once it is marked Completed
export function sportEffective(pubSport, keep, cfg, id) {
  if (isDone(cfg, id) && keep && keep.d) return { P: keep.d, kept: true };
  return { P: pubSport || {}, kept: false };
}
