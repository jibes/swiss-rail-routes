# Logo: R1c · Ring

![Logo on every surface](comparison.png)

A round trip as a loop of rail, in the app's own symbols: the start, which is also the end, the big dot at the bottom; a solid dot where you get off; rings where you ride through. Three stations, spaced unevenly so it reads as a journey, not a compass. Chosen 1 Nov 2026 over 20 earlier concepts (a line, a summit, viaducts, spiral tunnels, a vanishing track that looked too much like Rail Planner).

One source, `scripts/logo-sets.py`:

- `python3 scripts/logo-sets.py` writes this folder (`r1c-ring/`: icon, maskable, adaptive foreground and background, monochrome, favicon).
- `python3 scripts/logo-sets.py --apply` writes what ships: `public/icons/icon.svg` (favicon, rounded tile), `public/icons/maskable.svg`, and the Android vectors (`ic_launcher_foreground`, `ic_launcher_monochrome`, `ic_stat_rail` for notifications) in `android/app/src/main/res/drawable/`. Then `npm run icons` for the PNGs.
- `CHROMIUM_PATH=… node scripts/logo-sheet.mjs` renders the sheet above.
