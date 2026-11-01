# Logo: C1 · Warm

![Logo on every surface](comparison.png)

A round trip as a loop of rail: the start, which is also the end, the big dot at the bottom; the smaller dot where you get off. Chosen 1 Nov 2026 (C1; its sibling C2 had a yellow sun for the stop, which faded at small sizes).

- **Geometry:** ring : start : stop = φ² : φ : 1 (21 : 13 : 8). The stop sits at the golden angle from the start (137.5°, i.e. 42.5° from the top). The group is lifted so its optical centre is just above the middle, and the white dots are 2 % smaller against irradiation.
- **Colour:** warm vermilion gradient (`#E8330F` → `#C80303`), cream mark (`#FFF6EC`) for ring and both dots.
- **One colour** (status bar, notifications, Android 13 themed icon): the same three shapes in white, so the silhouette never changes.
- **Small sizes:** the favicon draws the mark larger with a heavier line (holds at 16 px); the 24 dp notification icon fills its box with a 3.3 dp line.

One source, `scripts/logo-sets.py`: without arguments it writes `c1-warm/` here; `--apply` writes `public/icons/{icon,maskable}.svg` and the Android launcher (gradient background, foreground), themed and notification vectors; then `npm run icons` for the PNGs. Sheet: `CHROMIUM_PATH=… node scripts/logo-sheet.mjs`.
