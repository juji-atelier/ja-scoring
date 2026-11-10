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
import { BOWL_ROOT } from "./bowling-data.js";

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
