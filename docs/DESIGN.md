# Design: "The line"

![Home, builder, timeline (light and dark)](design/screens.png)

A day trip is one rail line. Every screen draws it the same way, so nothing has to be explained.

## Principles

1. **One line, one accent.** The rail is the only colour (`--rail`). Solid dot: you get off (start, stops, end). Ring: the train passes through. Dashed: a stay, a walk, or "add a station".
2. **Hairlines, not boxes.** Surfaces only where something is tapped as a whole (tour cards, route chips, the options control).
3. **Numbers first.** Times are tabular and bold; departure–arrival is the largest type on the timeline.
4. **Thumb zone.** Each screen has one main action in the bottom dock (New tour, Plan, Share). Navigation sits top left, the map top right.
5. **Edit in place.** Tap a station's name and it becomes its own search field: type another, × and leave to remove it, the stay as a chip beside it. The grip moves it. Selects are the app's own (a chip and a list), never the system's. No dialogs, no settings screen.
6. **Smart defaults.** A route template runs in the direction that continues from your last station; next Saturday, 08:00 and GA are preset.
7. **Calm warnings.** A coloured dot and one line of text under the ride it concerns: red for disruptions, amber for things to check, blue for information.

## Tokens

All colours, radii and spacing are CSS custom properties in `src/styles.css` (`:root`, with a dark set under `prefers-color-scheme`). Text tokens `--ink`, `--ink-2` and `--ink-3` meet WCAG AA on `--bg` and `--surface` in both themes; the e2e axe checks enforce it.

## Navigation

Two tabs, **Routes** (where) and **Trips** (when). Under way a trip shows itself live: a live bar on the lists, and the app opens to it.

## Screens

- **Home:** large title, tour cards with their mini line, dock: From template · New tour.
- **Builder (route):** the name is the title; share and map top right; the round-trip pill; the line with a grip per station (drag or arrow keys); an "add a station" row continuing the line; route chips. Dock: legs and stays, Plan.
- **Planning:** pills for date, depart/back by + time, ticket; options as a segmented control with Earlier/Later chevrons; departure–arrival summary; the rail with times. Dock: Save trip.
- **Trip** (one screen, following the time): before, date, departure–arrival and the rail, dock "Edit trip"; under way, a progress bar, the next step as a card (what, big time with "+N" late, "in N min", line and platform), connections at risk in red, the rail with the travelled part grey and a pulsing marker where you are, dock "Replan from here" (red when at risk); after, the record, dock "Save as route" ("Open route" when its route still exists unchanged; before and under way the same as a text button). Tickets, calendar, GPX and share below.
- **Edit trip:** the builder's line. Before departure all of it plus date, time and ticket; under way the travelled part grey, the start fixed ("From here · hh:mm"). Find connections, options, Update trip.
- **Rides:** "N stops" expands the intermediate stops in place, everywhere.
- **Map:** full screen, floating back and "Timetable" controls.

## Reviewing a change

`SCREENSHOTS=/tmp/shots npx playwright test e2e/screens.spec.ts --project=phone` (after a build with `VITE_OJP_URL=https://ojp.invalid`) renders routes, builder, planning, Now and Trips in light and dark from recorded data.
