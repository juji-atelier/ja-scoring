// =====================================================================
//  Scoring engines. Each engine turns a stored match into display data.
//  Stored match fields used here:
//    rally : fmt, firstServer ('a'|'b'), rallies  (string like "aabab")
//    goals : fmt, events (string: a/b = goal, A/B = foul, | = period end),
//            clock {run, st, el}, pen {a,b}
//    darts : fmt, firstServer, turns (string "60,45,100")
// =====================================================================

export const FORMATS = {
  badminton:   { bestOf: 3, points: 21, cap: 30, serve: "winner" },
  pingpong:    { bestOf: 3, points: 11, cap: 0,  serve: "tt" },
  sepaktakraw: { bestOf: 3, points: 21, cap: 25, decPoints: 15, decCap: 17, serve: "takraw" },
  futsal:      { periods: 2, minutes: 20, fouls: true },
  bolajaring:  { periods: 4, minutes: 10, fouls: false },
  dart:        { bestOf: 3, start: 501 }
};

export const ENGINE_OF = {
  badminton: "rally", pingpong: "rally", sepaktakraw: "rally",
  futsal: "goals", bolajaring: "goals", dart: "darts"
};

const other = s => (s === "a" ? "b" : "a");
const idx = s => (s === "a" ? 0 : 1);
const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)] || "th");

export function fmtOf(sport, m) {
  return { ...(FORMATS[sport] || {}), ...((m && m.fmt) || {}) };
}

// ------------------------------------------------------------------ RALLY
function gameRules(f, gameIndex) {
  const deciding = gameIndex === f.bestOf - 1 && f.bestOf > 1;
  return {
    points: Number(deciding && f.decPoints ? f.decPoints : f.points) || 21,
    cap: Number(deciding && f.decPoints ? (f.decCap || 0) : f.cap) || 0,
    deciding
  };
}

function gameOver(s, r) {
  const hi = Math.max(s[0], s[1]), lo = Math.min(s[0], s[1]);
  if (r.cap && hi >= r.cap) return true;
  return hi >= r.points && hi - lo >= 2;
}

export function deriveRally(m, f) {
  const need = Math.floor((Number(f.bestOf) || 3) / 2) + 1;
  const rallies = m.rallies || "";
  const games = [];
  const won = [0, 0];
  let cur = [0, 0];
  let first = m.firstServer || "a";      // first server of current game
  let srv = m.firstServer || null;       // current server
  let cnt = 0;                           // serves in current turn
  let winner = null, used = 0;
  let r = gameRules(f, 0);
  const perTurn = f.serve === "tt" ? 2 : f.serve === "takraw" ? 3 : 0;

  for (const ch of rallies) {
    if (winner) break;
    if (ch !== "a" && ch !== "b") continue;
    used++;
    cur[idx(ch)]++;
    if (perTurn) {
      const deuce = cur[0] >= r.points - 1 && cur[1] >= r.points - 1;
      cnt++;
      if (cnt >= (deuce ? 1 : perTurn)) { srv = other(srv || "a"); cnt = 0; }
    } else {
      srv = ch;
    }
    if (gameOver(cur, r)) {
      games.push(cur);
      won[idx(ch)]++;
      cur = [0, 0];
      cnt = 0;
      if (won[idx(ch)] >= need) { winner = ch; break; }
      r = gameRules(f, games.length);
      if (f.serve === "tt") { first = other(first); srv = first; }
      else srv = ch; // winner of the game serves first
    }
  }

  const point = { a: null, b: null };
  let interval = false;
  if (!winner) {
    for (const s of ["a", "b"]) {
      const t = [cur[0], cur[1]];
      t[idx(s)]++;
      if (gameOver(t, r)) point[s] = won[idx(s)] + 1 >= need ? "MATCH POINT" : (f.bestOf > 1 ? "GAME POINT" : "MATCH POINT");
    }
    const half = Math.ceil(r.points / 2);
    const last = rallies[used - 1];
    if (last && (cur[0] + cur[1]) > 0 && cur[idx(last)] === half && cur[idx(other(last))] < half) interval = true;
  }
  return { games, cur, won, srv: winner ? null : srv, winner, need, point, interval,
           gameNo: games.length + (winner ? 0 : 1), deciding: r.deciding, rules: r };
}

// ------------------------------------------------------------------ GOALS
export function deriveGoals(m, f) {
  const ev = m.events || "";
  const score = [0, 0];
  const periods = Number(f.periods) || 2;
  let period = 0;
  const fouls = [[0, 0]];
  const perPeriod = [[0, 0]];
  for (const ch of ev) {
    if (ch === "a" || ch === "b") { score[idx(ch)]++; perPeriod[period][idx(ch)]++; }
    else if (ch === "A" || ch === "B") fouls[period][idx(ch.toLowerCase())]++;
    else if (ch === "|") { period++; fouls.push([0, 0]); perPeriod.push([0, 0]); }
  }
  const ended = period >= periods; // all regular periods finished
  const pen = m.pen && (m.pen.a != null) ? [Number(m.pen.a) || 0, Number(m.pen.b) || 0] : null;
  let winner = null;
  if (score[0] !== score[1]) winner = score[0] > score[1] ? "a" : "b";
  else if (pen && pen[0] !== pen[1]) winner = pen[0] > pen[1] ? "a" : "b";
  return { score, period, periods, ended, fouls: fouls[Math.min(period, fouls.length - 1)], perPeriod,
           pen, winner, draw: !winner, lenMs: (Number(f.minutes) || 20) * 60000 };
}

export function clockMs(clock, now) {
  if (!clock) return 0;
  return (Number(clock.el) || 0) + (clock.run && clock.st ? Math.max(0, now - clock.st) : 0);
}

export function mmss(ms) {
  ms = Math.max(0, Math.round(ms / 1000));
  return String(Math.floor(ms / 60)).padStart(2, "0") + ":" + String(ms % 60).padStart(2, "0");
}

export function periodName(sport, n, periods) {
  if (sport === "futsal" || periods === 2) return n === 1 ? "1st Half" : n === 2 ? "2nd Half" : ordinal(n) + " Period";
  return (periods === 4 ? "Q" : "P") + n;
}

// ------------------------------------------------------------------ DARTS
export function parseTurns(str) {
  return (str || "").split(",").filter(x => x !== "").map(x => Number(x) || 0);
}

export function deriveDarts(m, f) {
  const start = Number(f.start) || 501;
  const need = Math.floor((Number(f.bestOf) || 3) / 2) + 1;
  const turns = parseTurns(m.turns);
  const won = [0, 0];
  const legs = [];
  let legStarter = m.firstServer || "a";
  let thrower = legStarter;
  let rem = [start, start];
  let lastTurn = { a: null, b: null };
  let darts = [0, 0]; // turns taken this leg
  let winner = null;
  for (const v of turns) {
    if (winner) break;
    const i = idx(thrower);
    const after = rem[i] - v;
    let shown = v;
    if (v > 180 || after < 0 || after === 1) shown = "BUST";
    else rem[i] = after;
    lastTurn[thrower] = shown;
    darts[i]++;
    if (rem[i] === 0) {
      won[i]++;
      legs.push({ w: thrower, turns: darts[i] });
      if (won[i] >= need) { winner = thrower; break; }
      legStarter = other(legStarter);
      thrower = legStarter;
      rem = [start, start];
      darts = [0, 0];
      lastTurn = { a: null, b: null };
      continue;
    }
    thrower = other(thrower);
  }
  return { rem, won, legs, need, thrower: winner ? null : thrower, lastTurn, winner,
           legNo: legs.length + (winner ? 0 : 1), start };
}

// ------------------------------------------------------------------ VIEW
// One common shape used by the big screen and public page.
export function view(sport, m, now = Date.now()) {
  const kind = ENGINE_OF[sport];
  const f = fmtOf(sport, m);
  if (kind === "rally") {
    const d = deriveRally(m, f);
    const unit = sport === "sepaktakraw" ? "Set" : "Game";
    return {
      kind, big: d.winner ? [d.won[0], d.won[1]] : d.cur, small: d.won, smallLabel: unit + "s",
      serve: m.status === "live" ? d.srv : null,
      status: d.winner ? "Final" : (m.status === "live" ? `${unit} ${d.gameNo}` + (d.deciding ? " (decider)" : "") : ""),
      tag: d.point, hist: d.games.map(g => g.join("-")).join("  ·  "),
      winner: d.winner, sc: d.won, bigIsFinal: !!d.winner
    };
  }
  if (kind === "goals") {
    const d = deriveGoals(m, f);
    const per = Math.min(d.period + 1, d.periods);
    const ms = clockMs(m.clock, now);
    const st = m.status === "done" ? "Full time"
      : d.ended ? "Full time"
      : m.status === "live" ? `${periodName(sport, per, d.periods)}` + (m.clock && !m.clock.run && ms === 0 && d.period > 0 ? " (break)" : "") : "";
    return {
      kind, big: d.score, small: null, smallLabel: "",
      serve: null, status: st, tag: { a: null, b: null },
      hist: d.perPeriod.slice(0, d.periods).filter((p, i) => i <= d.period).map(p => p.join("-")).join("  ·  ")
        + (d.pen ? `  ·  Pens ${d.pen[0]}-${d.pen[1]}` : ""),
      clock: m.status === "live" && !d.ended ? { run: !!(m.clock && m.clock.run), st: (m.clock && m.clock.st) || 0, el: (m.clock && m.clock.el) || 0, len: d.lenMs } : null,
      winner: m.status === "done" ? d.winner : null, draw: m.status === "done" && d.draw, sc: d.score
    };
  }
  if (kind === "darts") {
    const d = deriveDarts(m, f);
    return {
      kind, big: d.winner ? d.won : d.rem, small: d.won, smallLabel: "Legs",
      serve: m.status === "live" ? d.thrower : null,
      status: d.winner ? "Final" : (m.status === "live" ? `Leg ${d.legNo} · ${d.start}` : ""),
      tag: { a: d.lastTurn.a != null ? "Last: " + d.lastTurn.a : null, b: d.lastTurn.b != null ? "Last: " + d.lastTurn.b : null },
      hist: d.legs.map((l, i) => `L${i + 1}: ${l.w.toUpperCase()}`).join("  ·  "),
      winner: d.winner, sc: d.won, bigIsFinal: !!d.winner
    };
  }
  return { kind: "none", big: [0, 0], small: null, status: "", tag: {}, hist: "", winner: null, sc: [0, 0] };
}

// Group standings from /pub records. Win 3, draw 1, loss 0.
// Tie-break: points, score difference, score for, name.
export function standings(records) {
  const groups = {};
  for (const r of Object.values(records || {})) {
    if (!r || !r.gr) continue;
    const g = (groups[r.gr] = groups[r.gr] || {});
    for (const n of [r.a, r.b]) g[n] = g[n] || { team: n, p: 0, w: 0, d: 0, l: 0, f: 0, a: 0, pts: 0 };
    if (r.st !== "done") continue;
    const A = g[r.a], B = g[r.b], sc = r.sc || [0, 0];
    A.p++; B.p++;
    A.f += Number(sc[0]) || 0; A.a += Number(sc[1]) || 0;
    B.f += Number(sc[1]) || 0; B.a += Number(sc[0]) || 0;
    if (r.w === "a") { A.w++; B.l++; A.pts += 3; }
    else if (r.w === "b") { B.w++; A.l++; B.pts += 3; }
    else { A.d++; B.d++; A.pts++; B.pts++; }
  }
  const out = {};
  for (const [g, t] of Object.entries(groups)) {
    out[g] = Object.values(t).sort((x, y) => y.pts - x.pts || (y.f - y.a) - (x.f - x.a) || y.f - x.f || x.team.localeCompare(y.team));
  }
  return out;
}

// Compact record copied to /pub for the big screen and public page.
export function publicRecord(sport, m, teams) {
  const t = id => (teams && teams[id]) || {};
  const v = view(sport, m);
  const rec = {
    no: m.no ?? "", ct: m.court ?? "", rd: m.round ?? "", ev: m.event ?? "", gr: m.group ?? "",
    tm: m.time ?? "",
    a: t(m.teamA).name || "TBC", b: t(m.teamB).name || "TBC",
    as: t(m.teamA).short || "", bs: t(m.teamB).short || "",
    st: m.status || "scheduled",
    w: m.status === "done" ? (m.winner || v.winner || "") : "",
    wo: !!m.wo,
    v: {
      big: v.big, small: v.small, sl: v.smallLabel, srv: v.serve || "", stx: v.status, hist: v.hist || "",
      tagA: (v.tag && v.tag.a) || "", tagB: (v.tag && v.tag.b) || "", fin: !!v.bigIsFinal,
      clock: v.clock || null
    },
    sc: v.sc || [0, 0],
    t: m.updatedAt || Date.now()
  };
  return JSON.parse(JSON.stringify(rec));
}
