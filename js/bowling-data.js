import "./bowling-rules.js?v=20261110f";   // sets globalThis.BowlRules
// Bowling roster + standings, used by the admin page (results download and prize giving).
// The bowling page (bowling.html) has its own copy of the same list (the built-in default).
export const BOWL_ROOT = "bowling2026";
export const BOWL_GAMES = 5;
export const BOWL_ROSTER = [{"id":"b01","n":"Nas Norniza","t":"NGEKET","g":"P"},{"id":"b02","n":"Presley Kimsang","t":"NGEKET","g":"L"},{"id":"b03","n":"Sili Landah @ Roslee","t":"NGEKET","g":"L"},{"id":"b04","n":"Ismail Mijan","t":"NGEKET","g":"L"},{"id":"b05","n":"Masmujahidah binti Masrin","t":"DRAGGIES HQ","g":"P"},{"id":"b06","n":"Wan Nazirah binti Wan Shah Jaman","t":"DRAGGIES HQ","g":"P"},{"id":"b07","n":"Elfiraroza binti Basri","t":"DRAGGIES HQ","g":"P"},{"id":"b08","n":"Frederick Assin","t":"DRAGGIES HQ","g":"L"},{"id":"b09","n":"Nur Fatihah Azhan binti Borhan","t":"LEGACY","g":"P"},{"id":"b10","n":"Siti Nurfaizah binti Muhammad Azrie","t":"LEGACY","g":"P"},{"id":"b11","n":"Roziana binti Lambang","t":"LEGACY","g":"P"},{"id":"b12","n":"Muhd Saharudin Sainuddin","t":"LEGACY","g":"L"},{"id":"b13","n":"Muhammad Syahrizan bin Iskandar","t":"JR TEAM","g":"L"},{"id":"b14","n":"S. Yasser bin S. Abdul Wahid","t":"JR TEAM","g":"L"},{"id":"b15","n":"Tahar bin Talib","t":"JR TEAM","g":"L"},{"id":"b16","n":"Cherry Carol Robert Meisin","t":"JR TEAM","g":"P"},{"id":"b17","n":"Mohd Nazrin bin Ramdin","t":"LEPA LEPA","g":"L"},{"id":"b18","n":"Ben Lee","t":"LEPA LEPA","g":"L"},{"id":"b19","n":"Merryana binti Kinti","t":"LEPA LEPA","g":"P"},{"id":"b20","n":"Masri bin Lamsun","t":"LEPA LEPA","g":"L"},{"id":"b21","n":"Rafia binti Pelin @ Pilin","t":"PANGAYAU","g":"P"},{"id":"b22","n":"Syed Suffian bin Syed Hassan","t":"PANGAYAU","g":"L"},{"id":"b23","n":"Masri bin Mayasin","t":"PANGAYAU","g":"L"},{"id":"b24","n":"Mohammad Ikhwan bin Kuslan","t":"PANGAYAU","g":"L"},{"id":"b25","n":"Mohd Zulhilmi","t":"NBR","g":"L"},{"id":"b26","n":"Asidah Hussin","t":"NBR","g":"P"},{"id":"b27","n":"Nurazleen Mohamad","t":"NBR","g":"P"},{"id":"b28","n":"Amanda Azmira","t":"NBR","g":"P"},{"id":"b29","n":"Smith Robert","t":"KAYH ESHH ARGHHH","g":"L"},{"id":"b30","n":"Desiree Dessy Maidi","t":"KAYH ESHH ARGHHH","g":"P"},{"id":"b31","n":"Roslee bin Ismail","t":"KAYH ESHH ARGHHH","g":"L"},{"id":"b32","n":"Mohd Badrul Kamal bin Yassin","t":"KAYH ESHH ARGHHH","g":"L"},{"id":"b33","n":"Mohammad Norhazman bin Osman","t":"ELITE LADIES TEAM","g":"L"},{"id":"b34","n":"Surianih Awang Daud","t":"ELITE LADIES TEAM","g":"P"},{"id":"b35","n":"Sazleena binti Resnin","t":"ELITE LADIES TEAM","g":"P"},{"id":"b36","n":"Dayangku Noor Jehan Awang Othman","t":"ELITE LADIES TEAM","g":"P"},{"id":"b37","n":"Khairul Anwar bin Azalan","t":"KILAR","g":"L"},{"id":"b38","n":"Jasri bin Jamateh","t":"KILAR","g":"L"},{"id":"b39","n":"Tahir bin Md Japar","t":"KILAR","g":"L"},{"id":"b40","n":"Norasidah binti Musaat","t":"KILAR","g":"P"},{"id":"b41","n":"Zamri bin Assah","t":"SIMPLE BOWLER TEAM","g":"L"},{"id":"b42","n":"Mohd Faisal bin Jufri","t":"SIMPLE BOWLER TEAM","g":"L"},{"id":"b43","n":"Ridzuan bin Shukri","t":"SIMPLE BOWLER TEAM","g":"L"},{"id":"b44","n":"Debbie Kong","t":"SIMPLE BOWLER TEAM","g":"P"}];

// Names edited on the bowling scorer page are saved at /bowling2026/roster; use them when present.
export function bowlingRoster(obj) {
  if (!obj || typeof obj !== "object") return BOWL_ROSTER;
  const a = Object.entries(obj).map(([id, p]) => ({ id, n: String(p.n || "").trim(), t: String(p.t || "").trim(), g: p.g === "P" ? "P" : "L", o: +p.o || 0 }))
    .filter(p => p.n && p.t).sort((x, y) => x.o - y.o || x.id.localeCompare(y.id));
  return a.length ? a : BOWL_ROSTER;
}

// data = contents of /bowling2026 → standings ranked exactly like the bowling page
// (rules: games, handicap, tie-break, categories — all in js/bowling-rules.js)
export function bowlingStandings(data) {
  data = data || {};
  return globalThis.BowlRules.standings(bowlingRoster(data.roster), data.scores, data.settings);
}
