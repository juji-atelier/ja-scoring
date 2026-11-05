// =====================================================================
//  JA Scoring System — configuration
//  1. Paste your Firebase web config below (Firebase console >
//     Project settings > General > Your apps > SDK setup > Config).
//  2. Make sure databaseURL is included (copy it from the
//     Realtime Database page if it is missing).
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyAGIMpCdDe9WQJEc4aLaJQTvfcEYKyFXXI",
  authDomain: "ja-scoring-system.firebaseapp.com",
  databaseURL: "https://ja-scoring-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ja-scoring-system",
  storageBucket: "ja-scoring-system.firebasestorage.app",
  messagingSenderId: "674691787189",
  appId: "1:674691787189:web:7d01dbba44e95c578751fc"
};

// Login accounts are <sport>@EMAIL_DOMAIN (e.g. badminton@ja-scoring.app)
// and admin@EMAIL_DOMAIN. If you change this, change it in
// database.rules.json too.
export const EMAIL_DOMAIN = "ja-scoring.app";
export const ADMIN_EMAIL = "admin@" + EMAIL_DOMAIN;

export const EVENT_DEFAULTS = {
  name: "HQ Games 2026",
  venue: "Kompleks Sukan Tun Adnan (Yayasan Sabah)"
};

// Sport id (used in links and logins) → settings.
// engine: rally = points/sets, goals = timed goals, darts = 501 legs
export const SPORTS = {
  sepaktakraw: { name: "Sepak Takraw", short: "Takraw",    color: "#e11d48", day: "Sat 14 Nov", engine: "rally", unit: "Set" },
  badminton:   { name: "Badminton",    short: "Badminton", color: "#2563eb", day: "Sat 14 Nov", engine: "rally", unit: "Game" },
  futsal:      { name: "Futsal",       short: "Futsal",    color: "#16a34a", day: "Sun 15 Nov", engine: "goals", unit: "Half" },
  bolajaring:  { name: "Bola Jaring",  short: "Netball",   color: "#c026d3", day: "Sun 15 Nov", engine: "goals", unit: "Quarter" },
  dart:        { name: "Dart",         short: "Dart",      color: "#ea580c", day: "Sun 15 Nov", engine: "darts", unit: "Leg" },
  pingpong:    { name: "Ping Pong",    short: "Ping Pong", color: "#0891b2", day: "Sun 15 Nov", engine: "rally", unit: "Game" }
};
