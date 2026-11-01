# Design: "The line"

![Home, builder, timeline (light and dark)](design/screens.png)

A day trip is one rail line. Every screen draws it the same way, so nothing has to be explained.

## Principles

1. **One line, one accent.** The rail is the only colour (`--rail`). Solid dot: you get off (start, stops, end). Ring: the train passes through. Dashed: a stay, a walk, or "add a station".
2. **Hairlines, not boxes.** Surfaces only where something is tapped as a whole (tour cards, route chips, the options control).
3. **Numbers first.** Times are tabular and bold; departure–arrival is the largest type on the timeline.
4. **Thumb zone.** Each screen has one main action in the bottom dock (New tour, Plan, Share). Navigation sits top left, the map top right.
5. **Disclose in place.** A station opens its few options under itself (get off, stay, move, remove). No dialogs, no settings screen.
6. **Smart defaults.** A route template runs in the direction that continues from your last station; next Saturday, 08:00 and GA are preset.
7. **Calm warnings.** A coloured dot and one line of text under the ride it concerns: red for disruptions, amber for things to check, blue for information.

## Tokens

All colours, radii and spacing are CSS custom properties in `src/styles.css` (`:root`, with a dark set under `prefers-color-scheme`). Text tokens `--ink`, `--ink-2` and `--ink-3` meet WCAG AA on `--bg` and `--surface` in both themes; the e2e axe checks enforce it.

## Navigation

Two tabs, **Routes** (where) and **Trips** (when). **Now** is not a tab: it exists only during a trip, as a live bar on the lists and as the screen the app opens to.

## Screens

- **Home:** large title, tour cards with their mini line, dock: From template · New tour.
- **Builder (route):** the name is the title; share and map top right; the round-trip pill; the line with a grip per station (drag or arrow keys); an "add a station" row continuing the line; route chips. Dock: legs and stays, Plan.
- **Planning:** pills for date, depart/back by + time, ticket; options as a segmented control with Earlier/Later chevrons; departure–arrival summary; the rail with times. Dock: Save trip.
- **Trip:** date, departure–arrival, the rail; tickets per leg; dock: calendar, GPX, Share trip. During the trip: Show live.
- **Now:** a progress bar for the whole trip; the next step as a card (what, big time with "+N" late, "in N min", line and platform); connections at risk in red; Replan from here; the rail with the travelled part grey and a pulsing marker where you are.
- **Replan:** the rest of the route as a line (start fixed), add/stay/reorder/remove, Find connections, options, Update trip.
- **Rides:** "N stops" expands the intermediate stops in place, everywhere.
- **Map:** full screen, floating back and "Timetable" controls.

## Reviewing a change

`SCREENSHOTS=/tmp/shots npx playwright test e2e/screens.spec.ts --project=phone` (after a build with `VITE_OJP_URL=https://ojp.invalid`) renders routes, builder, planning, Now and Trips in light and dark from recorded data.
