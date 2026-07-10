# 🚀 LAUNCHSPEED

A rocket-launch themed internet speed test. Ping is ignition, download is
ascent, upload is the return burn — and your rocket's altitude on a
log-scaled trajectory track *is* the speedometer.

Real measurements, no backend required: it uses Cloudflare's public,
CORS-enabled edge test endpoints (the same infrastructure behind
speed.cloudflare.com) directly from the browser, so this runs perfectly
as a static site.

## Features

- **Rocket trajectory speedometer** — altitude maps to Mbps on a log scale,
  with labeled atmosphere layers from "dial-up" to "escape velocity"
- **Ping, jitter, download & upload** measured with real parallel,
  time-boxed network requests
- **Live comparisons** — 4K movie download time, game download time,
  simultaneous streams, video call quality ceiling, computed from your result
- **Pilot rank** (Cadet → Lightspeed) based on your download speed
- **Mission Log** — your last 10 tests saved locally (localStorage), with a
  trend sparkline
- **Mission Patch** — a shareable, downloadable PNG badge generated on
  a `<canvas>` from your results
- **Ground Station** panel — shows your network/ISP and the Cloudflare
  relay you're testing against

## Hosting on GitHub Pages

1. Create a new GitHub repository (e.g. `launchspeed`).
2. Add these three files to the repo root: `index.html`, `style.css`, `script.js`
   (and this `README.md` if you like).
3. Commit and push to the `main` branch.
4. In the repo, go to **Settings → Pages**.
5. Under **Build and deployment**, set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`. Save.
6. Wait a minute, then visit `https://<your-username>.github.io/<repo-name>/`.

No build step, no dependencies, no API keys — it's plain HTML/CSS/JS.

## Notes

- All test traffic goes directly from the visitor's browser to Cloudflare's
  edge network; this site itself stores nothing except the optional local
  mission log, which never leaves the visitor's device.
- Works best in a modern evergreen browser (uses `fetch` streaming,
  `AbortController`, and the Canvas API).
