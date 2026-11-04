# Spec: Viadukt (Swiss rail day-trip planner)

1 Nov 2026 · @AB · revised the same day to follow the portfolio standard ([`jibes/apps-data/STANDARD.md`](https://github.com/jibes/apps-data/blob/main/STANDARD.md))

## 0. Changes from the first draft

| Area                         | First draft                                     | Now                                                                                                                                                                                                         | Why                                                                                                                                    |
| ---------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| App                          | React Native + Expo, expo-sqlite                | **React 19 + Vite PWA**, later the same build in a **Capacitor** shell; IndexedDB (`idb-keyval`)                                                                                                            | Standard §2 and decision D2: every shipped app wraps the web build; Expo/RN are not used for new apps (Tessel's RN path is frozen, D8) |
| Planner engine               | On the backend                                  | **On the device**, in `src/core/planner/` (pure, I/O injected)                                                                                                                                              | Local-first (§1), works offline on cached legs, unit-testable against recorded fixtures, keeps the backend trivial                     |
| Backend                      | Node 20 + Fastify + Redis on Fly.io / Cloud Run | **One Cloudflare Worker** (`workers/ojp/`): holds the API keys, builds OJP requests from typed JSON, caches answers 10 min (Cache API), rate-limits per IP                                                  | Standard §2 backend row (DropToCal pattern); no server, no Redis, free tier                                                            |
| OJP types                    | Generated from the OJP 2.0 XSD                  | **Hand-written types for the subset used**, parsed with `fast-xml-parser`, pinned by recorded fixtures and a nightly live run                                                                               | The XSD is large; generators emit unusable unions for the ~5 % we read. Drift is caught by the live run (§8)                           |
| Disruptions                  | SIRI-SX / GTFS-RT feed matched to sections      | **Situations from the OJP TripResult** (`TripResponseContext`) first; SIRI-SX only if fixtures show gaps                                                                                                    | One source, already matched to the legs; no feed to download and filter                                                                |
| Stop search                  | OJP LocationInformationRequest per keystroke    | **Bundled stop index** from DIDOK (built by `data.yml`), LIR as fallback                                                                                                                                    | Works offline, no rate-limit pressure while typing                                                                                     |
| Static timetable (GTFS/HRDF) | Runtime fallback for missing stop lists         | **Not used.** OJP lists every intermediate stop and its walks; a station counts as passed when any section reaches it (§4). Templates are checked by T1–T6 on recorded answers and nightly against live OJP | Hundreds of MB for a fallback no recorded answer needed                                                                                |
| Cloud sync, accounts         | Optional cloud sync                             | **Sync between one's own devices by a shared key** (§3b, 0.5.0): no account, ciphertext only in the Worker. Share link = trip encoded in the URL hash                                                       | Standard §1: no accounts; nothing to host but one encrypted blob per key                                                               |
| Languages                    | DE/FR/IT/EN                                     | **en (source) + de, fr, it**                                                                                                                                                                                | Standard i18n: `en.ts` is the source catalogue                                                                                         |
| Native vs. cross-platform    | Open question                                   | **Closed:** web build, Capacitor shell when native features (notifications) arrive                                                                                                                          | Decision D2                                                                                                                            |
| Licence                      | —                                               | **AGPL-3.0-or-later**                                                                                                                                                                                       | Ships a network service (Worker) and may go to a store (D3)                                                                            |

---

## 1. Problem and goal

A mobile-first planner that turns a scenic Swiss rail day trip (several forced routes, stops, round trip) into one validated, ticket-checked timetable. The SBB app can't do this.

Gaps in the SBB app this closes:

- At most 3 via stations per query; scenic loops need 5–10 waypoints.
- No round trip: origin = destination is rejected.
- No planned dwell ("stay 60 min in Mürren"): the user splits queries and stitches them by hand.
- The router optimises for speed, so it silently takes base tunnels (Gotthard, Lötschberg) or detours (St. Gallen → Zürich → Luzern instead of the Voralpen-Express) and skips the scenic line.
- No daylight awareness: a November trip can put the highlight leg after sunset.
- Disruptions (e.g. Albula Thusis–Preda closed 29.10.–13.11.2026) appear only after planning.

**Target user:** Swiss resident with GA, Tageskarte or Spartageskarte; plans one-day scenic loops from their home station; avoids reservation-only panorama trains (Glacier, Bernina, GoldenPass, Gotthard Panorama Express).

**Success criteria**

- A 4-route tour (e.g. Zürich → Voralpen-Express → Brünig → Mürren → Zürich) planned in < 2 min on one screen.
- 100 % of legs use the intended line; 0 silent base-tunnel substitutions.
- Every leg flagged when outside GA validity, reservation-required, after sunset or disrupted.

## 2. Core concepts and data model

A **Tour** is an ordered list of **Waypoints**; consecutive waypoints form **Legs**; each leg resolves to one **Connection** (a list of **Sections**) from the timetable. All types live in `src/core/model.ts`.

| Entity        | Key fields                                                                                                                                                             | Notes                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Tour          | id, name, date, anchor (`{ departAt }` or `{ arriveBy }`), ticket (always `GA` since 0.5.1: no choice in the UI), class (1/2), waypoints[], notes, schema version      | Round trip = last waypoint equals first               |
| Waypoint      | stopRef (SLOID), name, kind (`start` / `via` / `stop` / `turnaround` / `end`), dwellMin (time windows per station went in 0.15.1: never enforced)                      | `via` = ride through; `stop` = get off for dwellMin   |
| Connection    | dep, arr, durationMin, transfers, sections[], realtime status                                                                                                          | Chosen by scoring (§5)                                |
| Section       | line, category, number, operator, from/to stop + platform, dep, arr, intermediate stops, geometry, reservationRequired, supplement, gaValid                            | Parsed from the OJP TripResult                        |
| RouteTemplate | id, name ("Albula", "Bernina", "Voralpen-Express"), ordered stop chain, mustPass[], modes[], seat side (L/R) per direction, highlights[], season notes, timetable year | `src/data/templates.json`, schema-checked             |
| Highlight     | name, coords, side, legRef, sunlightRequired                                                                                                                           | e.g. Landwasserviadukt, right side towards St. Moritz |
| Warning       | type (`disruption`, `after-sunset`, `not-ga`, `reservation`, `tight-transfer`, `seasonal`), severity, legRef, sectionRef?, text key + params, source                   | Shown inline per leg; text through i18n               |

**Storage:** IndexedDB via `idb-keyval`: `srr.trips.v1` (the trips, each with its timetable), `srr.tours.v1` (your past trips, as routes), `srr.plans.v1` and `srr.options.v1` (plans and the options loaded with the arrows), `srr.answers.v1` (every timetable answer, §3a), `srr.sync.v1`; prefs in `localStorage` (`srr.prefs.v1`). The full list is in AGENTS.md. Schema bumps migrate; keys are never renamed.
**Curated data** (`templates.json`, `ga.json`) ships in the build as JSON with a JSON-schema test; a new deploy is the "OTA update" (the service worker prompts to reload). In the Capacitor shell the same files load from the bundled build.

## 3. Functional requirements

Must = MVP; Should = v1.1; Could = later.

**Tour builder**

- [Must] Unlimited waypoints, by search (bundled stop index, fuzzy, umlaut-insensitive) or by tapping a template ("add Albula Chur → St. Moritz" inserts its vias and must-pass stops).
- [Must] Per waypoint: ride-through vs. stop with dwell (presets 0 / 30 / 60 min, stepper).
- [Must] Round-trip toggle: end = start, one tap.
- [Must] Anchor: depart at X or be back by Y; the planner back-calculates.
- [Must] Drag to reorder; replan < 3 s (warm cache).
- [Should] Turnaround waypoint (out-and-back, e.g. Alp Grüm), "same way back" or "different return".
- [Could] Free-text intent ("Bernina + Albula, back via Vereina") parsed into waypoints, confirmed by the user. AI order per standard §1: on-device (Prompt API) first, then the user's own key; no hosted fallback until the rest ships.

**Routing**

- [Must] One OJP TripRequest per leg with all its forced vias; leg n+1 departs ≥ arrival n + max(dwell, minTransfer): a stay includes the change.
- [Must] Line enforcement: drop candidates that miss a must-pass stop (walks count: OJP walks through a station when the bus stops beside it) or do not ride a line its way (Lake Lucerne by boat). Passing the must-pass stations of a mountain line rules out its base tunnel.
- [Must] Up to three options that leave at different times (the best-scored one marked), with total duration and the time at each stop; one option says so. Earlier/Later move the departure by an hour and replan.
- [Should, done 0.17.0] Auto-fix: a station struck through offers "Find one that works": on a tap, up to 3 nearby stations (within 10 km, trains call there or it is the same scenic line's, the line's first, nearest first) are planned one by one until one is reached; the note says it, its arrival against the plan and what is skipped, with Use (the station replaces it, as any edit) and Dismiss. Never in the background, never applied by itself.

**Validation and warnings**

- [Must] GA validity per section against the curated GA area (incl. Domodossola, Tirano); non-GA sections (e.g. Wengen–Kleine Scheidegg) get the hint "50 % with GA".
- [Must] Reservation-required / supplement trains flagged, with the regular train on the same line offered. Settings choose: avoid them (default), treat them like any other, or never use them.
- [Must] Disruptions: situations from the TripResult per section; red chip with text ("Thusis–Preda replacement bus until 13.11.").
- [Must] Daylight: sunset per highlight coords and date; warn when a sunlight-required highlight is passed after sunset − 15 min.
- [Should] Seasonal closures (Oberalp / Furka winter limits, cable-car revision weeks) from template metadata.
- [Should] Transfers < 4 min flagged; platform change shown.
- [Should] Seat-side tip per leg ("sit right").

**Output and export** (all generated on the device)

- [Must] Timeline: every section with dep/arr, platform, line, dwell blocks.
- [Must] Map: tour on real track geometry (OJP leg projection), highlights as stars.
- [Must] Export: `.ics` with one event per section, share link (in the URL hash, no server). (sbb.ch links and GPX were removed in 0.4.0.)
- [Should] Offline: saved tours fully readable without network (tour + last plan stored together; map corridor tiles cached, kOSMos IndexedDB tile-store pattern).
- [Should] Day-of mode: live delays, replan the rest from the current position.
- [Should] One-page printout via print CSS (instead of a PDF library).
- [Could] Notifications before each transfer and before a sunset-critical leg. Needs the Capacitor shell (local notifications); not possible reliably in a PWA.

## 3a. One object, one screen, one line (0.4.0; an idea first in 0.3.0)

There is one kind of thing, the **trip**, and it always has a date. It is one line on one screen: before it leaves you edit it in place and it plans itself; under way it shows where you are; when its day is over it leaves the list and waits in search. Ideas (0.3.0) are gone: an idea was a trip without a date, and a date costs nothing to change.

- **The list**: Now (a trip under way), Coming up (by date). Each card has its day, name, line and times. "New trip" opens the trip with the search open.
- **The trip screen** (`#/trip/<id>`): the date and the time it leaves from (two native fields, 0.11.1), its name (tap to rename), departure → arrival, the connections found as one strip (0.5.7): the arrows (before the first and after the last, scrolling with them) load more, earlier or later, into it, and the nearest one loaded becomes the trip, the line with it (0.8.3; a tap goes back; the timetable service answers leg by leg, so more means planning again from just before the first or after the last); a tap makes one the trip and its time the trip's; when nothing is found the strip says from when, and the arrows move that time by an hour, and the line. No Plan button: every change plans again after 400 ms of quiet (`usePlanner`); the options are kept with the plan (`srr.plans.v1`), those loaded with the arrows until they leave (`srr.options.v1`), and every timetable answer on the device until its day, on the day for 15 min (`srr.answers.v1`, 0.8.4), so looking at other connections or opening the app again asks only what is new. New trips start today, from the next five minutes (0.10.0): the date and the time it leaves from sit together at the top, the first connection after that time is the trip. Today nothing is planned, loaded or offered from a time gone (`fromNow`; Earlier stops at now), and a trip under way but not left yet keeps its options strip, so choosing never ends a trip at once. There is no ticket choice: where the GA or a day pass does not cover a stretch, everyone sees it as a neutral note (blue), since 0.5.1.
- **The line**: the stations you entered and the timetable laid over them (`src/core/rows.ts`): times on the left, a big dot where you get off (a change or a stay), a badge, platform and duration per train, warnings under the train they concern. A station of the route a train passes belongs to that ride: listed among its stops at its own time, in white, shown even with the ride's other stops closed (a tap on "n stops" opens them). Dark is yours, grey is the timetable's (0.5.1): stations you entered are dark and open the panel; a scenic line's stations and the changes the timetable needs on its own are grey, and a tap on one says why it is not editable.
- **What you entered** (`src/core/line.ts`): stations, and scenic lines picked in search. A line is its two end stations (yours) and its must-pass stations between them (rings, part of the line: `Waypoint.ring`). Only what you entered opens **the panel**: the station's name (type to replace it), no stop (a change the timetable needs still happens) / stay, for as long as you set, the line that leads there (× goes without it), Add after, up, down, remove; while it is open, its grip drags it among the stations you entered. A move, a removal or a new station between a line's two ends switches the line off (dragging shows which by fading it).
- **What the plan cannot do** shows on the line (0.5.3): a station of the route no connection passes at that time is struck through, with "Try an hour later"; a disruption opens the operator's message on a tap; walks under a minute merge into one station; only stays are labelled (a change is a big dot with two times).
- **Escape and Android's Back** close what is open on top first (the search, the menu, a station's panel), then leave the screen. Moving a trip to today starts it from the next five minutes when its time has gone.
- **Adding**: the dashed end of the line, or Add after in a panel, opens the one search: your past trips, scenic lines (run from where you are), stations; and "Back to <start>" for a round trip.
- **Planning in the background** (0.5.6): a trip without a timetable (changed on another device, left before its plan came, made offline) is planned while the app is open, one at a time; a failure is tried again after ten minutes or when the device is back online. Sync never carries the timetable as a change: each device plans what it holds.
- **Under way** (30 min before departure to 15 min after the expected arrival): progress, the next step (saying where its times come from), connections at risk, and the trip's own line live (0.9.0: the same line as before it leaves, read-only, with expected times, the travelled part grey and where you are); **Replan from here** (`#/trip/<id>/edit`) changes the rest, the travelled part fixed, with undo.
- **When its day is over** (in Zurich, and the trip over, delays counted) a trip leaves the list (`src/core/retire.ts`): its stations, stays and lines are kept in search under Your trips (`srr.tours.v1`, the former ideas), without times; the same stations once, the most recent first; × forgets one. Repeating a trip: New trip → pick it. Ideas from 0.3.0 are there too.
- **Menu (⋯)**: Add to calendar (.ics, one event per train), Duplicate (a week later, its name kept), Delete (at once, Undo on the list for 10 s; forgetting a past trip in search has Undo too). **Share** sends the trip with its times (`#/j/`); route links (`#/r/`, `#/t/`, a 0.3 route's address) open as a route to plan as a new trip.
- **Position**: on the line, from the timetable plus live delays. On the map (`#/trip/<id>/map`) one marker: while a trip is under way and has left, red, where the time puts you (along the ride's track, else straight between its stops; at a change, at the station of the next train), said in a line ("between A and B"). A button top right turns on the device's location (off until tapped, so the system asks only then; remembered on this device, `srr.prefs.v1`; watched only while the map is open): a blue dot with its accuracy circle, instead of the red one, whenever it is under 2 min old and within 1 km, or at any accuracy when there is no estimate; in a tunnel the estimate comes back. Before and after the trip the marker is the location or nothing. Refused: the button goes off and a note says where to allow it. The location is in memory only: never stored, logged, synced or sent, and the map never moves to it, since tiles for that place would tell the tile host where you are (a note says when it is outside the view).
- **Live delays**: OJP TripInfo every 2 min while the screen is visible and the trip is under way, through the Worker (`/journey`, cached 30 s, shared by everyone on that train). Only the train you are on or about to board; on board also the next one once it leaves within 20 min (`journeysToWatch`).
- **Connections at risk**: an expected arrival leaves under 2 min to the next train (not the same vehicle), or the next train is cancelled.
- **Sharing a trip** (changed 2 Nov 2026, from an exact snapshot): `#/s/…`, the route and each ride's train, boarding and alighting stop and times, deflated; ~600 characters for 10 rides, as messengers cut off the full timetable (`#/j/…`, ~5,600, which still opens). Stored nowhere. Everything else is asked again by train when it opens: never replanned, so both people have the same trains with current stops, platforms, tracks and notices. No answer: the trains and times still show, said so, with Try again. A train gone from the timetable is said on its ride.
- **Reload** (pull down at the top of a trip, or the menu): the same asking again, for any planned trip. It does not make an undo step.
- **Default names**: start, at most two stations in between, end (`Start ↺ A · B` for a round trip): where you get off first, longest stay first; then spread out.

Removed in 0.4.0: ideas as a state, the ticket choice, GPX and the sbb.ch links. Sync (§3b), removed in 0.4.0 by a misread choice, is back in 0.5.0: trips and your past trips sync.

## 3b. Sync between one's own devices (added 1 Nov 2026; back in 0.5.0)

Like Brave Sync: no account, a key links the devices. Settings → Sync: **Start sync** makes a random 256-bit key, shown as 13 groups of four characters and as a QR code (a link `#/sync/<key>` that opens Settings to confirm); **I have a key** joins: **Scan code** reads the QR code with the camera (asked for only then; the browser's BarcodeDetector where it reads QR codes, else jsQR on the device; frames never leave it), or the key is typed (any case, spaces or dashes; O/0 and I/L/1 read alike). The phone's own camera app opens the link in the browser, not the Android app (no verified app links on github.io).

- From the key each device derives (HKDF-SHA-256) an id and an AES-GCM key. The Worker stores one blob per id in a Durable Object: your trips (planned and past), deflated and encrypted. It never sees the key, names, stops or times.
- Writes are compare-and-swap on a version: a device that read an old version gets the current one back (409), merges and tries again.
- Merge per route and trip (`planRound`, pure): the newer change wins (a local edit always gets a time after the one it replaces, so a device whose clock runs behind still wins with its own edit; ties pick the same winner everywhere); deletions travel as tombstones for 90 days, and a device away longer drops items it did not change that the shared copy no longer has. Changes are noticed by hashing each item, so the stores need no timestamps. Joining counts what the device had as older than the shared copy.
- Each round reads the lists only after the server answered (edits made meanwhile are part of it) and remembers the merge before writing, so a failed write never turns received items into local changes. Rounds of several tabs run one at a time; other tabs reload when one applied a sync.
- Sync runs on opening, when the app comes back into view, every minute while it is in view, and 3 s after a change. A device sends the version it has (`?v=`); unchanged, the Worker answers without the data. Requests give up after 20 s (offline), so a dead connection never blocks turning sync off. A write not confirmed makes the next round download the copy in full; after failures those rounds back off, 1, 2, 4 … 30 min (0.10.1), and Sync now skips the wait.
- Trips are stored and synced compactly: tracks simplified to ~30 m once per trip (`compactTrip`), so a few hundred trips fit the 1 MB the Worker takes; a copy larger than that is refused on the device ("too much data").
- **New key** moves everything to a new key and closes the old copy: the Worker keeps a marker and answers 410, so devices still on the old key say "replaced" instead of refilling it; they join again. **Turn off on this device** keeps its data. Boxes no device read or wrote for 180 days are deleted (Durable Object alarm, moved on by reads at most daily); a device finding its copy gone that way writes it again. Turning sync off keeps that key's stamps, so turning it on again with the same key keeps edits made meanwhile.
- Without the key nothing can be recovered; every device keeps its own copy either way.

## 4. Data sources

Timetable and realtime from opentransportdata.swiss; one API key per service, held only as Worker secrets.

| Need                | Source                                                                                      | When                | Use                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trips               | OJP 2.0 TripRequest                                                                         | Runtime, via Worker | One request per leg: `Via` ×n (only the first is enforced: legs are split and stitched, §5), `IncludeIntermediateStops`, `IncludeLegProjection`, `NumberOfResults=6`   |
| Disruptions         | OJP TripResult situations                                                                   | Runtime             | Per section; SIRI-SX only if coverage gaps show (open question)                                                                                                        |
| Live delays         | OJP realtime in TripResult                                                                  | Runtime (day-of)    | Replan                                                                                                                                                                 |
| Stop search         | **DIDOK service points** → compact index (`public/data/stops.v1.json`, ~0.5 MB gz)          | `data.yml`, monthly | Autocomplete, SLOID, coords; OJP LocationInformationRequest as fallback                                                                                                |
| Template validation | The acceptance tours T1–T6 (§8) on recorded answers, and nightly on live OJP (`live.yml`)   | CI, nightly         | A must-pass stop that vanishes from a line fails T1–T6; no GTFS: OJP lists every intermediate stop and walk, so a station counts as passed when any section reaches it |
| Prices              | OJP Fare (beta)                                                                             | Could               | Price when ticket = none                                                                                                                                               |
| Train formation     | Formation Service                                                                           | Could               | Panorama car position, seat-side                                                                                                                                       |
| GA validity         | `src/data/ga.json`, generated from SBB's OSDM fares (`npm run data:ga`)                     | `data.yml`, monthly | Non-GA flags; it covers fares SBB sells, so other operators' summit lines are missing, never guessed                                                                   |
| Sunset              | Computed on the device (port kOSMos's sun-elevation code; sunset = elevation −0.833°)       | —                   | Per highlight                                                                                                                                                          |
| Basemap             | OpenFreeMap vector tiles (as kOSMos); swisstopo WMTS optional; OpenRailwayMap overlay Could | Runtime             | Map                                                                                                                                                                    |

Reference to study: the open-source `swiss-transport-mcp` for OJP 2.0 request shapes and parsing.
Constraints: OJP is XML-only; respect the per-key quota; cache identical leg requests 10 min (live train data 30 s).

## 5. Routing algorithm

The planner never trusts the fastest result: it fetches candidates per leg, filters them against the template's must-pass stops, and scores what survives. It is a pure module: `plan(tour, deps)` with `deps.fetchTrips`, `deps.now`, `deps.templates`, `deps.gaRules` injected, so tests replay recorded fixtures.

1. **Expand** the tour into legs: split at every `stop` / `turnaround`; `via` waypoints and template stop chains become forced vias of their leg.
2. **Must-pass stops** per leg from templates (Albula = Thusis, Filisur, Bergün, Preda; Gotthard-Bergstrecke = Wassen, Göschenen; Voralpen-Express = Wattwil, Biberbrugg). Checked against intermediate stops, not sent as transfer points.
3. **Query** each leg once: all forced vias as `Via`, intermediate stops and projection on, 6 results, departure = the earliest expected arrival among the current beam + max(dwell, minTransfer = 3 min): a stay includes the change (a change tight across two legs is still said, step 5). One request per leg serves all beams, so a 4-leg tour costs 4 sequential requests, not 10. OJP enforces only the first `Via`: when no answer passes them all, the leg is split at its vias and the answers stitched (`stitch.ts`).
4. **Filter:** drop candidates that miss a must-pass stop or a line's mode, or use a reservation-only train when a regular one exists (Settings: avoid, include, never). No ticket filter: non-GA stretches are a note (§3a).
5. **Score** (lower = better):
   `duration_min + 15·transfers + 60·highlights_after_sunset + 30·disrupted_sections + 10·tight_transfers` (a change under 4 min or shorter than its walk, within a connection or between two legs).
   Weights are `DEFAULT_WEIGHTS` in `src/core/planner/plan.ts`, tuned on T1–T4.
6. **Chain** with beam search (width 6): keep the best 6 partial chains after each leg, so an early choice can't make a later leg impossible. A leg whose candidates all start before a beam's ready time is re-queried for that beam only, filtered like the shared pool.
7. **Ladder** when a leg has no survivor: first all vias and the lines' modes; then only the vias that have a connection from the one before (`reachableRules`, one request each: a closed line answers nothing at all); then none, which the result reports as `relaxed` (the one rule that can go is must-pass) and the line shows struck through. No replacement-bus or other-template fallback: OJP itself answers with the replacement bus (`EV`), and another line would be another trip.
8. **Return** up to 3 options with different departures: the best-scored chain plus the earliest and latest other departure, each the best chain for its start time. Stitching keeps two onward rides per partial chain so different starts stay different. A round trip without a stop turns at the middle one of the user's own stations (`splitLoops`); arrive-by walks the start back from the day's start (05:00) until the chain arrives in time.

Edge cases: out-and-back (same track twice only on a turnaround), cog and cable-car sections without platforms, boat legs (mode filter), cross-border sections (Tirano, Domodossola), midnight rollover, the December timetable change, a walk through a station when the train or bus stops beside it (counts as passing).

## 6. UX and screens

Since 0.4.0 one list and one trip screen (§3a), hash routes; mobile portrait first, one-handed, light/dark from the system, en/de/fr/it. The map (`#/trip/<id>/map`) shows the trip on its tracks; Replan from here (`#/trip/<id>/edit`) changes the rest of a trip under way; Settings holds the language.

Interaction rules: replan on every edit, after 400 ms of quiet (`usePlanner`); never block the UI on the network; say in plain language which constraint failed a leg ("No regular train Thusis–Preda on 07.11. — replacement bus").

## 7. Architecture and stack

Follows STANDARD.md v1. Deviations: none planned.

```
src/
  core/                 pure, no DOM (every module covered by tests/)
    model.ts            entities (§2)
    planner/            plan.ts (expand, filter, score, beam, ladder), connection.ts, stitch.ts
    ojp/                request.ts (shared with the Worker), parse.ts, journey.ts (live train data)
    line.ts, rows.ts    what you entered; route + timetable → the line's rows
    trip.ts, live.ts, replan.ts, retire.ts, refresh.ts, notify.ts, position.ts, when.ts
    warnings.ts         disruption notices read for the stretch ridden
    sun.ts              sunset / sun elevation
    sync.ts, answers.ts, log.ts
    export/             ics.ts, tripLink.ts (#/s/), tripShare.ts (#/j/), routeLink.ts (#/r/), share.ts (#/t/)
  io/                   the device's side: ojp.ts, planTrip.ts, autoplan.ts, answers.ts, listStore.ts, trips.ts, tours.ts, sync.ts, notifications.ts, log.ts, back.ts
  ui/                   screens and components (React 19, plain CSS tokens); styles/ one file per concern
  i18n/                 en.ts (source), de.ts, fr.ts, it.ts
  data/                 templates.json, ga.json (schema-checked)
  store.ts, trips.ts, tours.ts   zustand stores
workers/ojp/            Cloudflare Worker: handler.ts (fetch API only), sync.ts, index.ts (bindings)
mcp/                    the planner as an MCP server for the VPS (server.ts, tools.ts, route.ts, worker.ts)
scripts/                build-stops.ts (DIDOK), build-ga.ts (OSDM fares), logo-sets.py, icons.mjs, mcp-bundle.sh, android-smoke.sh
tests/                  Vitest; fixtures/ojp/<tour>/<sha1>.xml.gz (recorded answers)
e2e/                    Playwright; the Worker's own code answers from the recorded fixtures
```

- **App:** TypeScript strict, React 19, Vite, vite-plugin-pwa (prompt update), zustand, MapLibre GL, idb-keyval, fast-xml-parser. Node pinned by `.nvmrc`.
- **Worker `workers/ojp/`:** endpoints `POST /trip`, `POST /stops`, `POST /journey` (live calls of one train), `GET/PUT/DELETE /sync/<id>` (§3b), typed JSON in, OJP XML out (gzip). It builds the XML with `src/core/ojp/request.ts`, so the key can only be spent on the app's own request shapes. Cache API keyed by the normalised request (10 min); per-IP `ratelimit` binding; `ALLOWED_ORIGINS`; secrets `OJP_API_KEY` (+ others when used). Parsing happens on the device, so the Worker stays within the free plan's CPU limit.
- **CSP:** `connect-src` = the Worker, OpenFreeMap; nothing else.
- **Native:** Capacitor shell for Android (`android/`, Obtainium), `android.yml` per standard; local trip notifications.

**Workflows:** `ci.yml`, `deploy.yml` (Pages), `deploy-worker-ojp.yml` (path-filtered), `android.yml` (release on a version bump), `data.yml` (monthly DIDOK stop index + OSDM GA data; a pull request when they changed), `live.yml` (nightly T1–T6 against live OJP through the Worker; never gates deploy; opens or updates one issue on failure).

**Non-functional**

- 4-leg tour planned in < 3 s p95 with a warm cache (4 sequential Worker round-trips + parse).
- Saved tours fully readable offline; no account.
- No personal data leaves the device except leg queries (stops, date, time) to the Worker; no logs kept there beyond Cloudflare defaults.
- WCAG 2.1 AA contrast, screen-reader labels on the timeline, axe check in the e2e smoke.
- No source file over 800 lines.

## 8. Acceptance tests

T1–T6 are the regression suite. CI replays recorded fixtures (fixed date, `tests/fixtures/ojp/<test>/`); `live.yml` runs them nightly against live OJP for the next Saturday (T1's disruption check only while the closure lasts).

| #   | Tour (start = end Zürich HB) | Waypoints                                                                                                                                               | Must pass                                                                                                | Expected warnings                                                                                |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| T1  | Graubünden loop              | Chur → Albula → St. Moritz → Pontresina → Alp Grüm (turnaround, 30 min) → Pontresina → Zernez → Vereina → Klosters → Landquart                          | Filisur, Bergün, Preda outbound; Sagliains, Klosters return; no Albula on return                         | On 07.11.2026: disruption Thusis–Preda + fallback offer; November: after-sunset if start > 07:00 |
| T2  | Oberalp loop                 | Chur → Disentis/Mustér → Oberalppass → Andermatt → Göschenen                                                                                            | Ilanz, Oberalppass, Andermatt; return via Göschenen–Erstfeld Bergstrecke or base tunnel per user setting | Seasonal note Oberalp winter                                                                     |
| T3  | Voralpen + Brünig + Mürren   | St. Gallen → Wattwil → Luzern (stop 60) → Brünig-Hasliberg → Interlaken Ost → Lauterbrunnen → Grütschalp → Mürren BLM (stop 60) → Interlaken Ost → Bern | Wattwil + Biberbrugg (not via Zürich); Brünig (not via Bern)                                             | November: sunset before Mürren return; cable-car revision if published                           |
| T4  | Rigi                         | Arth-Goldau → Rigi Kulm (stop 45) → Vitznau → boat → Luzern                                                                                             | Boat Vitznau–Luzern, not bus                                                                             | Reduced winter boat timetable                                                                    |
| T5  | Negative: non-GA             | Interlaken Ost → Kleine Scheidegg                                                                                                                       | —                                                                                                        | Non-GA Wengen–Kleine Scheidegg, "50 % with GA"                                                   |
| T6  | Negative: base tunnel        | Zürich → Lugano with template Gotthard-Bergstrecke                                                                                                      | Wassen, Göschenen                                                                                        | Every base-tunnel candidate rejected                                                             |

Plus the standard e2e smoke: load at base path, plan T5 from the recorded answers, go offline, reload, the trip and its timetable still readable (`e2e/smoke.spec.ts`).

## 9. Out of scope, risks, open questions

**Out of scope (MVP):** ticket purchase and seat reservation (hand off to the SBB app); multi-day tours; international routing beyond GA border stations; accessibility routing; accounts (sync is by key, §3b).

| Risk                                                                           | Impact                        | Mitigation                                                                                                                           |
| ------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| OJP omits intermediate stops or projection for some operators (cog, cable car) | Must-pass check fails falsely | Not seen in any recorded answer; a stop a walk reaches counts as passed (§4). Would show in `live.yml`                               |
| Templates drift with the December timetable change                             | Wrong must-pass stops         | `live.yml` runs T1–T6 nightly on the next Saturday; a must-pass stop gone from a line fails there before the new timetable is ridden |
| GA area has no API                                                             | Wrong validity flags          | Curated list, reviewed each December; "report an error" link prefilled as a GitHub issue                                             |
| SBB app link format changes                                                    | Export breaks                 | Web URL fallback with from/to/date/time; covered by `live.yml` monthly                                                               |
| OJP quota under many replans                                                   | Throttling                    | Debounce, per-leg cache in the Worker and on the device, one request per leg for all beams                                           |
| OJP terms on proxying/caching                                                  | Key revoked                   | Check the terms before launch. Fallback: the user's own key on the device; OJP allows browser calls (CORS `*`, checked 2026-11-01)   |

**Findings from recorded answers (1 Nov 2026)**

- OJP enforces only the first `Via`: legs with more vias are split and stitched (one request per two vias).
- Albula Thusis–Preda closure: OJP answers with a replacement bus (`EV`) once the leg is split at Filisur; the T1 outbound otherwise routes via Vereina.
- `PE` is not a supplement marker (LIX is `PE`); `A__PR` is.

**Open questions**

- [x] How many `Via` elements does the Swiss OJP 2.0 service enforce? One (the first). Legs are split at stops anyway.
- [ ] Do TripResult situations cover planned closures such as Albula 29.10.–13.11.2026? If not, add SIRI-SX through the Worker.
- [ ] Exact quota per key; whether a commercial tier is needed; terms on caching through a proxy.
- [ ] Source for cable-car revision dates (operator sites only?).
- [ ] Seat-side tips: curated in templates (MVP) or derived from track bearing vs. sun/view direction (later)?
