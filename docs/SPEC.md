# Spec: Swiss Rail Day-Trip Planner

1 Nov 2026 · @AB · revised the same day to follow the portfolio standard ([`jibes/apps-data/STANDARD.md`](https://github.com/jibes/apps-data/blob/main/STANDARD.md))

## 0. Changes from the first draft

| Area                         | First draft                                     | Now                                                                                                                                                        | Why                                                                                                                                    |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| App                          | React Native + Expo, expo-sqlite                | **React 19 + Vite PWA**, later the same build in a **Capacitor** shell; IndexedDB (`idb-keyval`)                                                           | Standard §2 and decision D2: every shipped app wraps the web build; Expo/RN are not used for new apps (Tessel's RN path is frozen, D8) |
| Planner engine               | On the backend                                  | **On the device**, in `src/core/planner/` (pure, I/O injected)                                                                                             | Local-first (§1), works offline on cached legs, unit-testable against recorded fixtures, keeps the backend trivial                     |
| Backend                      | Node 20 + Fastify + Redis on Fly.io / Cloud Run | **One Cloudflare Worker** (`workers/ojp/`): holds the API keys, builds OJP requests from typed JSON, caches answers 10 min (Cache API), rate-limits per IP | Standard §2 backend row (DropToCal pattern); no server, no Redis, free tier                                                            |
| OJP types                    | Generated from the OJP 2.0 XSD                  | **Hand-written types for the subset used**, parsed with `fast-xml-parser`, pinned by recorded fixtures and a nightly live run                              | The XSD is large; generators emit unusable unions for the ~5 % we read. Drift is caught by the live run (§8)                           |
| Disruptions                  | SIRI-SX / GTFS-RT feed matched to sections      | **Situations from the OJP TripResult** (`TripResponseContext`) first; SIRI-SX only if fixtures show gaps                                                   | One source, already matched to the legs; no feed to download and filter                                                                |
| Stop search                  | OJP LocationInformationRequest per keystroke    | **Bundled stop index** from DIDOK (built by `data.yml`), LIR as fallback                                                                                   | Works offline, no rate-limit pressure while typing                                                                                     |
| Static timetable (GTFS/HRDF) | Runtime fallback for missing stop lists         | **Build time only**: validates templates, extracts the stop sequences of template lines into a small JSON                                                  | Hundreds of MB; nothing at runtime should need it                                                                                      |
| Cloud sync, accounts         | Optional cloud sync                             | **None.** Share link = tour encoded in the URL hash                                                                                                        | Standard §1: no accounts; nothing to host                                                                                              |
| Languages                    | DE/FR/IT/EN                                     | **en (source) + de, fr, it**                                                                                                                               | Standard i18n: `en.ts` is the source catalogue                                                                                         |
| Native vs. cross-platform    | Open question                                   | **Closed:** web build, Capacitor shell when native features (notifications) arrive                                                                         | Decision D2                                                                                                                            |
| Licence                      | —                                               | **AGPL-3.0-or-later**                                                                                                                                      | Ships a network service (Worker) and may go to a store (D3)                                                                            |

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

| Entity        | Key fields                                                                                                                                                                                 | Notes                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Tour          | id, name, date, anchor (`{ departAt }` or `{ arriveBy }`), ticket (`GA` / `Tageskarte` / `Halbtax` / `none`), class (1/2), waypoints[], notes, schema version                              | Round trip = last waypoint equals first               |
| Waypoint      | stopRef (SLOID), name, kind (`start` / `via` / `stop` / `turnaround` / `end`), dwellMin, earliestArr?, latestDep?                                                                          | `via` = ride through; `stop` = get off for dwellMin   |
| LegConstraint | forcedVias[] (unlimited), forcedLines[] (e.g. RE "Lötschberger", IR46), avoid[] (segment ids, e.g. `gotthard-base`), modes (rail, cog, cable car, boat, bus), maxTransfers, minTransferMin | Defaults from the RouteTemplate                       |
| Connection    | dep, arr, durationMin, transfers, sections[], realtime status                                                                                                                              | Chosen by scoring (§5)                                |
| Section       | line, category, number, operator, from/to stop + platform, dep, arr, intermediate stops, geometry, reservationRequired, supplement, gaValid                                                | Parsed from the OJP TripResult                        |
| RouteTemplate | id, name ("Albula", "Bernina", "Voralpen-Express"), ordered stop chain, mustPass[], avoid[], seat side (L/R) per direction, highlights[], season notes, timetable year                     | `src/data/templates/*.json`, schema-checked           |
| Highlight     | name, coords, side, legRef, sunlightRequired                                                                                                                                               | e.g. Landwasserviadukt, right side towards St. Moritz |
| Warning       | type (`disruption`, `after-sunset`, `not-ga`, `reservation`, `tight-transfer`, `seasonal`), severity, legRef, sectionRef?, text key + params, source                                       | Shown inline per leg; text through i18n               |

**Storage:** IndexedDB via `idb-keyval`, key `srr.tours.v1` (one record per tour). Prefs in `localStorage` (`srr.prefs.v1`). Schema bumps migrate; keys are never renamed.
**Curated data** (templates, GA exceptions, segment ids) ships in the build as JSON with a JSON-schema test; a new deploy is the "OTA update" (the service worker prompts to reload). In the Capacitor shell the same files load from the bundled build.

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

- [Must] One OJP TripRequest per leg with all its forced vias; leg n+1 departs ≥ arrival n + dwell + minTransfer.
- [Must] Line enforcement: drop candidates that miss a must-pass stop or forced line, or use an avoided segment (Gotthard / Lötschberg / Ceneri base tunnels, Vereina when Albula is intended…).
- [Must] Up to three options that leave at different times (the best-scored one marked), with total duration and the time at each stop; one option says so. Earlier/Later move the departure by an hour and replan.
- [Should] Auto-fix: when a leg is impossible, propose the nearest valid substitute and say what is lost.

**Validation and warnings**

- [Must] GA validity per section against the curated GA area (incl. Domodossola, Tirano); non-GA sections (e.g. Wengen–Kleine Scheidegg) get the hint "50 % with GA".
- [Must] Reservation-required / supplement trains flagged, with the regular train on the same line offered.
- [Must] Disruptions: situations from the TripResult per section; red chip with text ("Thusis–Preda replacement bus until 13.11.").
- [Must] Daylight: sunset per highlight coords and date; warn when a sunlight-required highlight is passed after sunset − 15 min.
- [Should] Seasonal closures (Oberalp / Furka winter limits, cable-car revision weeks) from template metadata.
- [Should] Transfers < 4 min flagged; platform change shown.
- [Should] Seat-side tip per leg ("sit right").

**Output and export** (all generated on the device)

- [Must] Timeline: every section with dep/arr, platform, line, dwell blocks.
- [Must] Map: tour on real track geometry (OJP leg projection), highlights as stars.
- [Must] Export: "open leg in SBB app" per leg (https link that the app claims; web fallback), `.ics` with one event per section, GPX/KML, share link (tour in the URL hash, no server).
- [Should] Offline: saved tours fully readable without network (tour + last plan stored together; map corridor tiles cached, kOSMos IndexedDB tile-store pattern).
- [Should] Day-of mode: live delays, replan the rest from the current position.
- [Should] One-page printout via print CSS (instead of a PDF library).
- [Could] Notifications before each transfer and before a sunset-critical leg. Needs the Capacitor shell (local notifications); not possible reliably in a PWA.

## 3a. Routes, Trips, Now (added 1 Nov 2026)

Three questions, one kind of thing each (MECE):

| Question  | Thing     | Holds                                                                                          | Screens                                                               |
| --------- | --------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Where?    | **Route** | Stations, stays, templates, round trip; date, time and ticket only as the values last used     | Routes tab, builder, planning (date/time/ticket, options)             |
| When?     | **Trip**  | A route frozen with its date, ticket and the chosen connections; one previous version for undo | Trips tab, trip screen (timetable, tickets, calendar, GPX, share)     |
| What now? | **Now**   | Not stored: a trip whose window (30 min before departure to 15 min after arrival) includes now | Now screen; a live bar on the lists; launching during a trip opens it |

- **Position** comes from the timetable plus live delays, never GPS (owner's decision).
- **Live delays**: OJP TripInfo for the current and next train, every 60 s while the screen is visible, through the Worker (`/journey`, cached 30 s).
- **Connections at risk**: an expected arrival leaves under 2 min to the next train (not the same vehicle), or the next train is cancelled.
- **Replan from here**: from the next stop the train calls at (or the station you are at), the rest of the route editable (spontaneous stop, longer stay, reorder, remove); the travelled part is kept; the result is a new version of the trip, undo restores the previous one.
- **Sharing**: a route as `#/t/…` (the recipient plans); a trip as `#/j/…`, the exact timetable (deflated, no tracks; the recipient never replans). Trips are mostly for the owner alone, so there is no live link for followers: a changed trip is shared again.
- **Intermediate stops** expand on every ride (plan, trip, Now); on Now the ride being travelled shows them, with a marker between the last stop passed and the next.

## 4. Data sources

Timetable and realtime from opentransportdata.swiss; one API key per service, held only as Worker secrets.

| Need                                                | Source                                                                                      | When                   | Use                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trips                                               | OJP 2.0 TripRequest                                                                         | Runtime, via Worker    | One request per leg: `Via` ×n, `NotVia`, `NoChangeAt`, `IncludeIntermediateStops`, `IncludeLegProjection`, `NumberOfResults=6`                             |
| Disruptions                                         | OJP TripResult situations                                                                   | Runtime                | Per section; SIRI-SX only if coverage gaps show (open question)                                                                                            |
| Live delays                                         | OJP realtime in TripResult                                                                  | Runtime (day-of)       | Replan                                                                                                                                                     |
| Stop search                                         | **DIDOK service points** → compact index (`public/data/stops.v1.json`, ~0.5 MB gz)          | `data.yml`, monthly    | Autocomplete, SLOID, coords; OJP LocationInformationRequest as fallback                                                                                    |
| Template validation, line catalogue, stop sequences | GTFS (annual + changes)                                                                     | `data.yml`             | Fails the data run when a must-pass stop vanishes from a template line; emits `public/data/sequences.v1.json` (fallback when OJP omits intermediate stops) |
| Prices                                              | OJP Fare (beta)                                                                             | Could                  | Price when ticket = none                                                                                                                                   |
| Train formation                                     | Formation Service                                                                           | Could                  | Panorama car position, seat-side                                                                                                                           |
| GA validity                                         | Curated `src/data/ga-exceptions.json`                                                       | Reviewed each December | Non-GA flags                                                                                                                                               |
| Sunset                                              | Computed on the device (port kOSMos's sun-elevation code; sunset = elevation −0.833°)       | —                      | Per highlight                                                                                                                                              |
| Basemap                                             | OpenFreeMap vector tiles (as kOSMos); swisstopo WMTS optional; OpenRailwayMap overlay Could | Runtime                | Map                                                                                                                                                        |

Reference to study: the open-source `swiss-transport-mcp` for OJP 2.0 request shapes and parsing.
Constraints: OJP is XML-only; respect the per-key quota; cache identical leg requests 10 min.

## 5. Routing algorithm

The planner never trusts the fastest result: it fetches candidates per leg, filters them against the template's must-pass stops, and scores what survives. It is a pure module: `plan(tour, deps)` with `deps.fetchTrips`, `deps.now`, `deps.templates`, `deps.gaRules` injected, so tests replay recorded fixtures.

1. **Expand** the tour into legs: split at every `stop` / `turnaround`; `via` waypoints and template stop chains become forced vias of their leg.
2. **Must-pass stops** per leg from templates (Albula = Thusis, Filisur, Bergün, Preda; Gotthard-Bergstrecke = Wassen, Göschenen; Voralpen-Express = Wattwil, Biberbrugg). Checked against intermediate stops, not sent as transfer points.
3. **Query** each leg once: all forced vias as `Via`, `NotVia` for avoided nodes, intermediate stops and projection on, 6 results, departure = the earliest arrival among the current beam + dwell + minTransfer. One request per leg serves all beams, so a 4-leg tour costs 4 sequential requests, not 10.
4. **Filter:** drop candidates that miss a must-pass stop, contain an avoided segment, use a reservation-only train when a regular one exists, or leave the GA area when ticket = GA (unless the user allows paid sections).
5. **Score** (lower = better):
   `duration_min + 15·transfers + 60·highlights_after_sunset + 30·disrupted_sections + 10·transfers_under_4_min`.
   Weights in `src/core/planner/weights.ts`, tuned on T1–T4.
6. **Chain** with beam search (width 3): keep the best 3 partial chains after each leg, so an early choice can't make a later leg impossible. A leg whose candidates all start before a beam's ready time is re-queried for that beam only.
7. **Fallback** when a leg has no survivor, in order: (a) +1 transfer, (b) replacement bus on the disrupted segment, (c) alternative template (Albula closed → Vereina). Always tell the user what was relaxed.
8. **Return** up to 3 options with different departures: the best-scored chain plus the earliest and latest other departure, each the best chain for its start time. Stitching keeps two onward rides per partial chain so different starts stay different.

Edge cases: out-and-back (same track twice only on a turnaround), cog and cable-car sections without platforms, boat legs (mode filter), cross-border sections (Tirano, Domodossola), midnight rollover, the December timetable change, OJP omitting intermediate stops (→ `sequences.v1.json`).

## 6. UX and screens

Five screens, hash routes; mobile portrait first, one-handed, light/dark from the system, en/de/fr/it.

1. **Home:** saved tours as cards (name, date, total h, warning chips); "New tour" and "From template"; template gallery (Albula, Bernina, Oberalp, Voralpen-Express, Brünig, Rigi…) with photo, duration from Zürich and a season note. Photos self-hosted, licences in `THIRD_PARTY_NOTICES.md`.
2. **Tour builder:** vertical waypoint list with drag handles; each row: station, ride/stop toggle, dwell stepper; "+ add route" inserts a template; round-trip switch; date and depart / back-by picker; live total-duration footer.
3. **Result timeline:** tabs for the options (one: a note instead), Earlier/Later buttons; per section: time, platform, line badge, operator; dwell blocks shaded; chips inline (red disruption, amber after-sunset, grey non-GA); seat-side tip; a sunset line across the timeline.
4. **Map:** tour coloured per template, highlights as stars, sunset-critical ones marked; tapping a section jumps to the timeline.
5. **Export sheet:** SBB link per leg, calendar (.ics), GPX/KML, share link, print.

Interaction rules: replan on every edit, debounced 500 ms; never block the UI on the network; say in plain language which constraint failed a leg ("No regular train Thusis–Preda on 07.11. — replacement bus").

## 7. Architecture and stack

Follows STANDARD.md v1. Deviations: none planned.

```
src/
  core/
    model.ts            entities (§2)
    planner/            expand, filter, score, beam, fallback; pure
    ojp/                request builder (shared with the Worker) + XML parser + types
    warnings/           GA, reservation, sunset, transfer, seasonal
    sun.ts              sunset / sun elevation
    export/             ics, gpx, kml, share-hash, sbb links
  data/                 templates/*.json, ga-exceptions.json, segments.json (+ schemas)
  ui/                   screens, components (React 19, plain CSS tokens)
  i18n/                 en.ts (source), de.ts, fr.ts, it.ts
  store.ts              zustand
workers/ojp/            Cloudflare Worker
scripts/                build-stops.ts, build-sequences.ts (DIDOK, GTFS)
tests/                  unit + fixtures/ojp/*.xml
e2e/                    Playwright, canned Worker answers
```

- **App:** TypeScript strict, React 19, Vite, vite-plugin-pwa (prompt update), zustand, MapLibre GL, idb-keyval, fast-xml-parser. Node pinned by `.nvmrc`.
- **Worker `workers/ojp/`:** endpoints `POST /trip`, `POST /stops`, typed JSON in, OJP XML out (gzip). It builds the XML with `src/core/ojp/request.ts`, so the key can only be spent on the app's own request shapes. Cache API keyed by the normalised request (10 min); per-IP `ratelimit` binding; `ALLOWED_ORIGINS`; secrets `OJP_API_KEY` (+ others when used). Parsing happens on the device, so the Worker stays within the free plan's CPU limit.
- **CSP:** `connect-src` = the Worker, OpenFreeMap; nothing else.
- **Native (later):** Capacitor shell for Android (Obtainium), `android.yml` per standard, when notifications are built.

**Workflows:** `ci.yml`, `deploy.yml` (Pages), `deploy-worker-ojp.yml` (path-filtered), `data.yml` (monthly DIDOK + GTFS; deploy only when the hash changes), `live.yml` (nightly T1–T6 against live OJP through the Worker; never gates deploy; opens or updates one issue on failure).

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

Plus the standard e2e smoke: load at base path, plan T3 from canned answers, go offline, reload, saved tour still readable.

## 9. Out of scope, risks, open questions

**Out of scope (MVP):** ticket purchase and seat reservation (hand off to the SBB app); multi-day tours; international routing beyond GA border stations; accessibility routing; cloud sync.

| Risk                                                                           | Impact                        | Mitigation                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OJP omits intermediate stops or projection for some operators (cog, cable car) | Must-pass check fails falsely | Fall back to `sequences.v1.json` from GTFS                                                                                         |
| Templates drift with the December timetable change                             | Wrong must-pass stops         | `data.yml` checks templates against the new GTFS; T1–T6 on the new timetable before release                                        |
| GA area has no API                                                             | Wrong validity flags          | Curated list, reviewed each December; "report an error" link prefilled as a GitHub issue                                           |
| SBB app link format changes                                                    | Export breaks                 | Web URL fallback with from/to/date/time; covered by `live.yml` monthly                                                             |
| OJP quota under many replans                                                   | Throttling                    | Debounce, per-leg cache in the Worker and on the device, one request per leg for all beams                                         |
| OJP terms on proxying/caching                                                  | Key revoked                   | Check the terms before launch. Fallback: the user's own key on the device; OJP allows browser calls (CORS `*`, checked 2026-11-01) |

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
