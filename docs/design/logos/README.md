# Logo: V15

![Logo on every surface](comparison.png)

A viaduct seen from the side: a deck across the whole tile, three round arches and a half arch at each side, so the bridge runs on out of the icon; its piers stand in a valley, longest in the middle. Chosen 6 Nov 2026 (V14, draft G1), replacing V13 (a train front with the Alps in its window); V15 (10 Nov 2026) deepens the valley into a V with a rounded tip, and the ground below it is white, one shape with the piers.

- **Geometry** (108-unit tile): deck y 30–39; arches every 27 units centred on x 0, 27, 54, 81, 108, each 17.8 wide with a round top on y 39; piers down to a V with a rounded tip: y = 62 + 32 · (1 − (√(d² + t²) − t) / (√(1 + t²) − t)), d = |x − 54| / 54, t = 0.25 (62 at the sides, 94 at the tip; V14 was a soft U, 72 + 18 · sin(π x / 108)).
- **Colour:** red sky (`#D40000`), white mark and ground (`#FFFFFF`). The arches are the red showing through. No hairlines: the ground reaches 1 unit up into the piers (no seam), the red stops at the valley's line (never under white, so no red fringe at the tile's foot), and the rounded icons are cut by one mask over the finished image.
- **One colour** (status bar, notifications, Android 13 themed icon): the same shape in one colour.
- **Placement:** every surface draws the same 108-unit design; the rounded icon and favicon clip it to their corners; maskable, adaptive and themed icons draw it at 2/3 in the middle 72 a launcher shows, deck and arches running on to the 108 edges (0.22.1: drawn over the whole 108, the launcher cut off valley and sky and showed an "m"); the 24 dp notification icon is its full width in 22 dp, ground included.

One source, `scripts/logo-sets.py`: without arguments it writes `v15/` here; `--apply` writes `public/icons/{icon,maskable}.svg` and the Android launcher (background: red above the ground only; foreground: mark and ground), themed and notification vectors; then `npm run icons` for the PNGs. `src/ui/Logo.tsx` is the same path inline, as a symbol in `--red` without its tile, its ground cut 6 units below the valley's tip. Sheet: `CHROMIUM_PATH=… node scripts/logo-sheet.mjs`.
