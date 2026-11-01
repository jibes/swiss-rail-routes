# Logo concepts

![Comparison](comparison.png)

| Set                | Idea                                                        | Strength                                                                | Weakness                                                     |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| **A · Die Linie**  | The app's own line: start, a ring you ride through, the end | Same language as every screen; strong at 16 px; works on light and dark | A line with dots is a common "route" glyph                   |
| **B · Rundreise**  | A loop with the train on it: a round trip                   | Distinctive silhouette; reads as "there and back"                       | Dark on a dark home screen loses its edge; less "Swiss rail" |
| **C · Tageslicht** | Sun over mountains, the rail below: scenic day trips        | Says "scenic" at once; friendly                                         | Sun and mountains read like the generic "photo" icon         |

Each set: `icon.svg` (stores, PWA), `maskable.svg`, `adaptive-foreground.svg` + `adaptive-background.svg` (Android), `monochrome.svg` (Android 13 themed icons), `favicon.svg` (simplified for 16–32 px). All on Android's 108-unit grid, motif inside the 66-unit safe zone.

Regenerate the sheet: `CHROMIUM_PATH=… node scripts/logo-sheet.mjs`.
