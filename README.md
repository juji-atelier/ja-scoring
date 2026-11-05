# JA Scoring System — HQ Games 2026

Live scoring for HQ Games 2026 (Kompleks Sukan Tun Adnan, 14–15 Nov).
Hosted on GitHub Pages, live data in Firebase Realtime Database.

| Page | Link (after `/ja-scoring/`) | Who uses it |
|---|---|---|
| Public live scores (QR) | `/` or `live/` | Spectators |
| Scorer | `scorer/?sport=<id>` | Each sport's committee (password per sport) |
| Admin | `admin/` | Organiser – overview, big screen, links & QR, prize giving, results download |
| Big screen (OBS 1920×1080) | `display/` | OBS Browser Source |
| Tenpin bowling | `bowling.html` · `?v=scorer` · `?v=overlay` | Public · bowling committee · OBS |

Sport ids: `sepaktakraw`, `badminton`, `futsal`, `bolajaring`, `dart`, `pingpong`.

- Setup steps (Firebase, logins, rules): see **SETUP.md**.
- Colours and light/dark mode: `css/theme.css`. Sports and event name: `config.js`.
- Passwords are **not** stored in this repo. The Firebase web config in `config.js` is public by design;
  the database rules (`database.rules.json`) and the passwords are what protect the scores.

Built by JUJI-ATELIER.
