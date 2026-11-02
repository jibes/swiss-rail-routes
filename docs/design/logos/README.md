# Logo: V13

![Logo on every surface](comparison.png)

A train front seen head-on: its windscreen is the window seat with the Alps in it, two headlights below, two rails leading towards you. Chosen 2 Nov 2026 (V13), replacing C1 (a ring with two dots).

- **Geometry** (100-unit box): body 52 × 68 with 15 corners; windscreen 38 × 31 with 6 corners; three peaks standing on the windscreen's bottom edge; headlights radius 5; rails 6 wide with round ends.
- **Colour:** flat red tile (`#D40000`), white mark (`#FFFFFF`). Windscreen and headlights are holes in the body (even-odd), so the tile shows through.
- **One colour** (status bar, notifications, Android 13 themed icon): the same shapes in one colour, the holes left open, the mountains solid inside the windscreen.
- **Placement:** the rounded icon and favicon draw the design as is (the favicon with 7.5-wide rails, so they hold at 16 px); maskable and adaptive icons keep the whole mark inside the 66 dp safe circle around its optical centre (50, 52); the 24 dp notification icon fills its height with a 1 dp margin.

One source, `scripts/logo-sets.py`: without arguments it writes `v13/` here; `--apply` writes `public/icons/{icon,maskable}.svg` and the Android launcher (red background, foreground), themed and notification vectors; then `npm run icons` for the PNGs. Sheet: `CHROMIUM_PATH=… node scripts/logo-sheet.mjs`.
