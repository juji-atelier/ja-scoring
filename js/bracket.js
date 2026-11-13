// Knockout bracket for the public page (Bracket tab).
// Knockout bracket, built from the public match records (the same data the QR page already has).
// Stages are read from each match's round name; a side that is not decided yet still carries its
// label ("1st Pool A", "Winner Semi-final 1"), which is shown as a placeholder.
const isThird = r => /3rd|third|bronze|tempat ke-?3/i.test(r.rd || "");
const STAGES = [
  ["Quarter-finals", r => /quarter|suku/i.test(r.rd || "")],
  ["Semi-finals",    r => /semi|separuh/i.test(r.rd || "")],
  ["Final",          r => /\bfinal\b/i.test(r.rd || "") && !/semi|quarter|suku|separuh/i.test(r.rd || "")],
];
const PLACEHOLDER = /^(1st|2nd|3rd|4th|winner|loser|tbc)\b/i;
const short = t => String(t || "").replace(/semi-?\s?final\s*/i, "SF").replace(/quarter-?\s?final\s*/i, "QF");
const byNo = (x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999);
export const hasBracket = recs => recs.some(r => isThird(r) || STAGES.some(([, f]) => f(r)));

export function bracketHTML(recs, { esc, courtWord = "Court", isMe = () => false }) {
  const ko = recs.filter(r => isThird(r) || STAGES.some(([, f]) => f(r)));
  const cats = [...new Set(ko.map(r => r.ev || ""))].sort();
  const side = (r, s) => {
    const name = r[s], i = s === "a" ? 0 : 1, ph = PLACEHOLDER.test(name || "");
    const shown = r.st !== "scheduled" && !ph;
    const score = r.wo ? (r.w === s ? "W/O" : "") : shown ? (r.sc || [])[i] : "";
    const cls = (ph ? "ph" : r.st === "done" ? (r.w === s ? "win" : "lose") : "") + (!ph && isMe(name) ? " me" : "");
    return `<div class="br ${cls}"><span class="bn">${!ph && isMe(name) ? "★ " : ""}${esc(ph ? short(name) : (name || "TBC"))}</span><b>${score ?? ""}</b></div>`;
  };
  const box = (r, title) => `<div class="bm ${r.st}">
      <div class="bh"><span>${esc(title || r.rd)}</span><span>${r.st === "live" ? '<i class="ld"></i>LIVE' : r.st === "done" ? "Done" : [r.tm, r.ct ? courtWord + " " + r.ct : ""].filter(Boolean).map(esc).join(" · ")}</span></div>
      ${side(r, "a")}${side(r, "b")}</div>`;
  return cats.map(ev => {
    const mine = ko.filter(r => (r.ev || "") === ev);
    const cols = STAGES.map(([name, f]) => [name, mine.filter(r => f(r) && !isThird(r)).sort(byNo)]).filter(([, l]) => l.length);
    const third = mine.filter(isThird).sort(byNo)[0];
    const fin = mine.find(r => STAGES[2][1](r) && !isThird(r));
    const champ = fin && fin.st === "done" && fin.w ? fin[fin.w] : "";
    const colHTML = cols.map(([name, list], ci) => {
      const last = ci === cols.length - 1;
      const groups = last ? list.map(r => [r]) : list.reduce((g, r, i) => (i % 2 ? g[g.length - 1].push(r) : g.push([r]), g), []);
      return `<div class="bcol"><div class="bt">${esc(name)}</div><div class="bbody">${groups.map(g =>
        `<div class="pair ${g.length > 1 ? "two" : ""}">${g.map(r => box(r, list.length > 1 ? short(r.rd) : name)).join("")}</div>`).join("")}
        ${last && champ ? `<div class="bchamp">🏆 <span>${esc(champ)}</span></div>` : ""}</div></div>`;
    }).join("");
    return `<section class="bk"><h3>${esc(ev || "Knockout")}</h3>
      <div class="bscroll"><div class="brow">${colHTML}</div></div>
      ${third ? `<div class="b3">${box(third, "3rd place")}</div>` : ""}</section>`;
  }).join("");
}
