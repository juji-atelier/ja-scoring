// =====================================================================
//  JA Scoring System — tenpin bowling RULES + STANDINGS (one copy only)
//  Used by bowling.html (scorer, public board, OBS overlay) and by the
//  admin page (results download, prize-giving auto-fill), so every
//  screen ranks bowlers the same way.
//
//  The rules are edited on the bowling scorer page → "Tournament rules"
//  tab and saved at /bowling2026/settings. Anything not saved yet uses
//  DEFAULTS below.
//
//  Plain script (no import/export) so it works both as
//  <script src="js/bowling-rules.js"> and as `import "./bowling-rules.js"`.
//  It sets window.BowlRules.
// =====================================================================
(function () {
  const DEFAULTS = {
    games: 5,          // games per bowler (1–10)
    hdcW: 0,           // women's handicap, pins per game (0 = none)
    hdcInd: true,      // handicap counts in individual totals (Men / Women / Overall)
    hdcTeam: true,     // handicap counts in team totals
    hdcHigh: false,    // handicap counts in High Game & High Series
    tie: "high",       // tie-break: "high" = higher single game, "last" = count back from last game, "none" = share position
    seriesN: 3,        // High Series = best total of this many games in a row
    cats: { team: true, men: true, women: true, overall: false, high: true, series: false }
  };
  // id, long title (PC / big screen), short title (phone tab)
  const CATS = [
    ["team", "Team Standings", "Teams"],
    ["men", "Men's Individual", "Men"],
    ["women", "Women's Individual", "Women"],
    ["overall", "Overall Individual", "Overall"],
    ["high", "High Game", "High Game"],
    ["series", "High Series", "High Series"]
  ];
  const TIES = {
    high: "Higher single game",
    last: "Higher last game (count back)",
    none: "Leave tied (share the position)"
  };
  const int = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const bool = (v, d) => (v === undefined || v === null ? d : !!v);

  // settings object from the database → complete, safe rules
  function rules(s) {
    s = s || {};
    const r = {
      games: int(s.games, 1, 10, DEFAULTS.games),
      hdcW: int(s.hdcW, 0, 50, DEFAULTS.hdcW),
      hdcInd: bool(s.hdcInd, DEFAULTS.hdcInd),
      hdcTeam: bool(s.hdcTeam, DEFAULTS.hdcTeam),
      hdcHigh: bool(s.hdcHigh, DEFAULTS.hdcHigh),
      tie: TIES[s.tie] ? s.tie : DEFAULTS.tie,
      cats: {}
    };
    r.seriesN = int(s.seriesN, 1, r.games, Math.min(DEFAULTS.seriesN, r.games));
    const c = s.cats || {};
    CATS.forEach(([k]) => { r.cats[k] = bool(c[k], DEFAULTS.cats[k]); });
    if (!CATS.some(([k]) => r.cats[k])) r.cats.team = true;   // always show at least one table
    return r;
  }

  // roster = [{id,n,t,g}], scores = {id:{g1:180,...}}, settings = saved settings
  function standings(roster, scores, settings) {
    const R = rules(settings), hdc = R.hdcW, N = R.games;
    const G = Array.from({ length: N }, (_, i) => i + 1);
    scores = scores || {};
    const players = roster.map(p => {
      const sc = scores[p.id] || {};
      const games = G.map(g => (typeof sc["g" + g] === "number" ? sc["g" + g] : null));
      const played = games.filter(x => x !== null);
      const scratch = played.reduce((a, b) => a + b, 0);
      const w = p.g === "P" ? hdc : 0;                       // this bowler's handicap per game
      const h = R.hdcInd ? w * played.length : 0;
      const high = played.length ? Math.max(...played) : 0;
      // best run of seriesN games in a row (all of them bowled)
      let ser = 0;
      for (let i = 0; i + R.seriesN <= N; i++) {
        const win = games.slice(i, i + R.seriesN);
        if (win.every(x => x !== null)) ser = Math.max(ser, win.reduce((a, b) => a + b, 0) + (R.hdcHigh ? w * R.seriesN : 0));
      }
      return { ...p, games, played: played.length, scratch, hdc: h, total: scratch + h,
        teamPins: scratch + (R.hdcTeam ? w * played.length : 0),
        avg: played.length ? scratch / played.length : 0,
        high, highT: high ? high + (R.hdcHigh ? w : 0) : 0, ser };
    });
    const teamNames = [...new Set(roster.map(p => p.t))];
    const teams = teamNames.map(t => {
      const mem = players.filter(p => p.t === t);
      const games = G.map((g, i) => mem.every(m => m.games[i] === null) ? null
        : mem.reduce((a, m) => a + (m.games[i] || 0) + (R.hdcTeam && m.g === "P" && m.games[i] !== null ? hdc : 0), 0));
      return { t, n: t, mem, games, total: mem.reduce((a, m) => a + m.teamPins, 0), done: mem.reduce((a, m) => a + m.played, 0),
        slots: mem.length * N, high: Math.max(0, ...games.filter(x => x !== null)) };
    });
    // tie-break between equal totals
    const lastCmp = (a, b) => { for (let i = N - 1; i >= 0; i--) { const x = a.games[i] ?? -1, y = b.games[i] ?? -1; if (x !== y) return y - x; } return 0; };
    const tieCmp = R.tie === "high" ? (a, b) => b.high - a.high : R.tie === "last" ? lastCmp : () => 0;
    const name = x => x.n || x.t || "";
    const byTot = (a, b) => b.total - a.total || tieCmp(a, b) || name(a).localeCompare(name(b));
    teams.sort(byTot);
    const ind = players.filter(p => p.played);
    const men = ind.filter(p => p.g === "L").sort(byTot);
    const women = ind.filter(p => p.g === "P").sort(byTot);
    const overall = [...ind].sort(byTot);
    const highs = ind.slice().sort((a, b) => b.highT - a.highT || b.total - a.total || name(a).localeCompare(name(b)));
    const series = ind.filter(p => p.ser).sort((a, b) => b.ser - a.ser || b.total - a.total || name(a).localeCompare(name(b)));
    // position number; exact ties (same value, and same tie-break) share a position
    function rankOf(list, i, key = "total") {
      let r = i;
      while (r > 0 && list[r - 1][key] === list[i][key] && (key !== "total" || tieCmp(list[r - 1], list[i]) === 0)) r--;
      return r + 1;
    }
    return { R, G, N, hdc, players, teams, men, women, overall, highs, series, rankOf, anyScore: ind.length > 0 };
  }

  // one-line description of the current rules (shown under the tables)
  function describe(R) {
    const bits = [`${R.games} game${R.games > 1 ? "s" : ""} per bowler`];
    if (R.hdcW) {
      const where = [R.hdcInd && "individual totals", R.hdcTeam && "team totals", R.hdcHigh && "high game/series"].filter(Boolean);
      bits.push(`women's handicap +${R.hdcW} pins per game` + (where.length ? ` (in ${where.join(", ")})` : " (not counted anywhere)"));
    }
    bits.push(R.tie === "none" ? "ties share the position" : "ties broken by " + (R.tie === "high" ? "the higher single game" : "the higher last game"));
    if (R.cats.series) bits.push(`High Series = best ${R.seriesN} games in a row`);
    return bits.join(" · ") + ".";
  }

  const api = { DEFAULTS, CATS, TIES, rules, standings, describe };
  if (typeof window !== "undefined") window.BowlRules = api;
  if (typeof globalThis !== "undefined") globalThis.BowlRules = api;
})();
