/* =====================================================================
   Field hints — a small (i) next to a label. Hover on a laptop, tap on
   a phone, and a short note explains what to type in that box.

   To add or change a hint: find the field's id below and edit the text.
   Nothing else needs changing — the (i) appears by itself, also on
   boxes that are drawn later (team editor, match format, pop-ups).

   A hint's text can be a function when the wording depends on the sport
   (e.g. "Points per game" vs "Points per set"). It is called with
   JAHints.ctx, which each page sets: { sport, name, unit, kind }.
   ===================================================================== */
(function () {
  "use strict";

  // [ box, where the (i) goes (optional), text ]
  const H = [
    // ---------------- scorer: login
    ["#inName", "Your name and court, for example “Ali – Court 1”. It is shown in the activity log so the admin can see who entered each score."],
    ["#vLogin #inPw", "The password the organiser gave you for this sport. It is not your staff or e-mail password."],

    // ---------------- scorer: teams
    ["#teamBulk", "#teamsTitle", "One team per line: Name | Players | Short name | Pool. Example: Flick & Strike | Ali & Abu | FNS | A. Everything after the name may be left out — type just the name and press Add teams. A draw code like A1 becomes Pool A, no. 1."],
    ["#teName", "Full team name, exactly as it should appear on the big screen."],
    ["#teShort", "A few letters used where there is no room for the full name, such as JKR. Optional."],
    ["#teGroup", "Group letter for the standings table, such as A. Leave it empty if this team only plays knockout matches."],
    ["#tePlayers", "One player per line: number then name, such as “10 Ali bin Abu”. Once a team has a list, you can tap who scored instead of typing the name. Optional."],

    // ---------------- scorer: match builder
    ["#fxTables", "#fxTitle", "How many tables, courts or lanes the room has altogether – not how many this category needs. “Spread across them” fills the Court box of every match, so that matches which can be played at the same moment land on different tables. Tables another category is already using are left alone, so you can pick the same number for every category."],

    // ---------------- scorer: add match
    ["#fNo", "Match number from the schedule. It sets the order matches appear in, and is shown as #1, #2 and so on."],
    ["#fTime", "Start time from the schedule, such as 9:00 AM. Leave it empty if the match has no fixed time."],
    ["#fCourt", "Which court, table, lane or pitch the match is played on, such as 1. Scorers can then show only their own court."],
    ["#fRound", "Stage of the tournament: Group A, Quarter Final, Semi Final, Final, 3rd Place. Writing “Final” lets the system show the champion by itself."],
    ["#fGroup", "Group letter for the standings table, such as A. Type the letter only — from A1 just the A is kept. Leave it empty for knockout matches — they do not belong in a group table."],
    ["#fEvent", "Category, such as Men's Doubles or Women's Team. Leave it empty if this sport has only one category."],
    ["#fA", "Pick the first team. If the list is empty, add the teams above first."],
    ["#fB", "Pick the team they play against. It must be a different team."],

    // ---------------- scorer: match format
    ["#xBestOf", c => c.kind === "darts"
      ? "How many legs are needed to win the match. Best of 3 means the first to win 2 legs."
      : `How many ${c.unitLow}s are needed to win the match. Best of 3 means the first to win 2 ${c.unitLow}s.`],
    ["#xPoints", c => `Points needed to win one ${c.unitLow}, such as 21. A ${c.unitLow} is only won with a 2-point lead.`],
    ["#xCap", c => `Highest score allowed in a ${c.unitLow}. At deuce, whoever reaches this number wins even without a 2-point lead. Leave it empty for no limit.`],
    ["#xDecPoints", c => `Points for the last, deciding ${c.unitLow}, if it is shorter than the others. Leave it empty to use the same number as above.`],
    ["#xDecCap", c => `Highest score in the deciding ${c.unitLow}. Leave it empty to use the same as above.`],
    ["#xPeriods", "How many parts the match is split into: 2 halves for futsal and bola sepak, 4 quarters for bola jaring."],
    ["#xMinutes", "Minutes in each half or quarter. The clock on the scoring screen counts down from this."],
    ["#xFouls", "Yes shows a foul counter for each team on the scoring screen, so the scorer can watch for the 5-foul limit."],
    ["#xStart", "The score each player starts from and counts down to exactly zero. 501 is the usual one."],

    // ---------------- scorer: paste the schedule
    ["#pasteText", "#pasteTitle", "Paste rows copied from Excel. Order of columns: No, Time, Court, Team A, Team B, then Round, Group and Event if you have them. Press Preview first — nothing is saved until you press Add matches."],
    ["#pasteNewTeams", "Tick this if some teams in your paste are not in the team list yet, and the system will create them for you."],

    // ---------------- scorer: round-robin
    ["#rrGroup", "Which group to build matches for. Every team in that group plays every other team once. Give the teams a group letter first."],
    ["#rrCourt", "Court or table written on every match created here. You can change it match by match afterwards."],
    ["#rrEvent", "Category written on every match created here, such as Men's Doubles. May be left empty."],

    // ---------------- scorer: pop-ups
    ["#annText", "#annTitle", "Short message shown on the big screen and the public page, such as “Calling JKR and JPN to Court 2”."],
    ["#annDur", "How long the message stays on the screens before it disappears by itself."],
    ["#fbText", "#fbTitle", "Tell the admin what went wrong or what would help. It goes only to the admin page, not to the other committees."],

    // ---------------- admin
    ["#vLogin #inPw, #loginForm #inPw", "The admin password. A sport's scorer password will not open this page."],
    ["#sEvent", "Event name shown on the big screen, the public page and in the downloaded results."],
    ["#sVenue", "Venue shown under the event name, such as Kompleks Sukan Tun Adnan."],
    ["#sTicker", "Message that scrolls along the bottom of the big screen, such as “Lunch break 12:30 – 2:00 PM”. Leave it empty to show results instead."],
    ["#sSport", "Which sport fills the big screen while “Pin one sport” is chosen."],
    ["#sMatch", "Which single match fills the whole big screen while “Feature one match” is chosen. Good for a final."],
    ["#sRotate", "Seconds each sport stays on the big screen before it changes to the next one. 15 is a good start."],
    ["#logSport", "Which sport's activity log to show: who changed what, and when."],
    ["#clrSport", "Which sport to delete the data for. Download a backup first — this cannot be undone."],
    ["#inRestore", "Choose a backup file you downloaded earlier. You then tick what to put back, and the current data is saved to a second file first."],

    // ---------------- bowling
    ["#nm", "Your name, shown in the activity log so the admin can see who entered each score."],
    ["#rTitle", "Tournament name shown at the top of the public board and the OBS panel."],
    ["#rDate", "The day the tournament is played. Shown on the public board."],
    ["#rStart", "Start time shown on the public board."],
    ["#rVenue", "Where it is played, such as KK Galaxy Bowl. Shown on the public board."],
    ["#rGames", "How many games each bowler plays, usually 5. Changing this adds or removes score boxes for everybody."],
    ["#rHdc", "Extra pins added to each woman's game before ranking. Put 0 if the committee does not use a handicap."],
    ["#rSer", "How many games in a row count as a series for the High Series prize, such as 3."],
    ["#eTeam", "Team name as it should appear on the board. Changing it keeps all scores already entered."],
    ["#wipeTxt", "Type DELETE ALL in capitals to confirm. Every score of this team is removed and cannot be brought back."]
  ];

  // --------------------------------------------------------------- engine
  const API = { ctx: {} };
  let bub = null, openBtn = null, applying = false, heldOpen = false;

  function text(h) {
    const c = API.ctx || {};
    const unit = c.unit || "game";
    return typeof h === "function" ? h({ ...c, unit, unitLow: String(unit).toLowerCase() }) : h;
  }

  function bubble() {
    if (!bub) {
      bub = document.createElement("div");
      bub.className = "jahint-bub";
      bub.hidden = true;
      document.body.appendChild(bub);
    }
    return bub;
  }

  function show(btn) {
    const b = bubble();
    b.textContent = btn.dataset.h || "";
    b.hidden = false;
    b.style.visibility = "hidden";
    b.style.left = b.style.top = "0px";
    const r = btn.getBoundingClientRect(), bb = b.getBoundingClientRect();
    const pad = 8;
    let left = Math.min(Math.max(pad, r.left + r.width / 2 - bb.width / 2), innerWidth - bb.width - pad);
    let top = r.bottom + 8;
    if (top + bb.height > innerHeight - pad) top = Math.max(pad, r.top - bb.height - 8);
    b.style.left = left + "px";
    b.style.top = top + "px";
    b.style.visibility = "";
    openBtn = btn;
  }

  function hide() {
    if (bub) bub.hidden = true;
    openBtn = null;
    heldOpen = false;
  }

  // the label a box belongs to, so the (i) sits next to its name
  function labelOf(el) {
    if (el.tagName === "LABEL") return el;
    const own = el.closest("label");      // a tick box sitting inside its own label
    if (own) return own;
    if (el.id) {
      const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l) return l;
    }
    for (let p = el.previousElementSibling; p; p = p.previousElementSibling) if (p.tagName === "LABEL") return p;
    const box = el.closest(".field, div, td");
    const l = box && box.querySelector("label");
    // only a label that sits before the box and has no box of its own inside it
    if (l && !l.querySelector("input,select,textarea") &&
        (l.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return l;
    return null;
  }

  function attach(host, t) {
    if (!host || !t || host.querySelector(":scope > .jahint")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "jahint";
    b.tabIndex = 0;
    b.dataset.h = t;
    b.setAttribute("aria-label", "What goes here: " + t);
    b.textContent = "i";
    host.appendChild(b);
  }

  API.apply = function () {
    if (applying) return;
    applying = true;
    try {
      for (const row of H) {
        const sel = row[0], at = row.length > 2 ? row[1] : null, h = row[row.length - 1];
        let els;
        try { els = document.querySelectorAll(sel); } catch (e) { continue; }
        for (const el of els) {
          const host = at ? document.querySelector(at) : labelOf(el);
          if (host) attach(host, text(h));
        }
      }
    } finally {
      setTimeout(() => { applying = false; }, 0);
    }
  };

  // boxes drawn later (team editor, match format, pop-ups) get one too
  API.watch = function () {
    API.apply();
    let t = null;
    new MutationObserver(() => {
      if (applying) return;
      clearTimeout(t);
      t = setTimeout(API.apply, 120);
    }).observe(document.body, { childList: true, subtree: true });
  };

  // hover on a laptop, tap on a phone
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".jahint");
    if (b) {
      e.preventDefault(); e.stopPropagation();
      if (b === openBtn && heldOpen) return hide();
      show(b); heldOpen = true; return;
    }
    hide();
  }, true);
  document.addEventListener("mouseover", e => {
    const b = e.target.closest && e.target.closest(".jahint");
    if (b && !heldOpen) show(b);
  });
  document.addEventListener("mouseout", e => {
    const b = e.target.closest && e.target.closest(".jahint");
    if (b && b === openBtn && !heldOpen && !matchMedia("(hover: none)").matches) hide();
  });
  document.addEventListener("focusin", e => {
    if (e.target.classList && e.target.classList.contains("jahint")) show(e.target);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });
  // keep the note stuck to its (i) while the page moves; drop it once that scrolls away
  function follow() {
    if (!openBtn) return;
    const r = openBtn.isConnected && openBtn.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > innerHeight) return hide();
    show(openBtn);
  }
  addEventListener("scroll", follow, true);
  addEventListener("resize", follow);

  window.JAHints = API;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", API.watch);
  else API.watch();
})();
