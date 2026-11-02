# swiss-rail-routes: agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason. Product spec: [`docs/SPEC.md`](docs/SPEC.md). Design: [`docs/DESIGN.md`](docs/DESIGN.md) (principles, tokens, screenshot review).

Status: 0.4.0, one object, one screen, one line (SPEC §3a): every trip dated, planned while edited; finished trips wait in search. Android shell with trip notifications. Next: SPEC §3 Should/Could items.

## Stack

- TypeScript strict, React 19, Vite, vite-plugin-pwa, zustand, MapLibre GL, idb-keyval, fast-xml-parser, Vitest, Playwright. Node: see `.nvmrc`.
- One Cloudflare Worker in `workers/ojp/` holds the opentransportdata.swiss keys.
- Check library APIs against the installed types in `node_modules`, not from memory.
- Cloud sessions: Playwright uses `CHROMIUM_PATH` (set by the SessionStart hook); never run `playwright install` there.

## Architecture

- `src/core/` is pure logic with no DOM, and every module has tests in `tests/`.
- The planner (`src/core/planner/`) gets all I/O injected (`fetchTrips`, `now`, templates, GA rules); tests replay `tests/fixtures/ojp/`.
- `src/core/ojp/request.ts` is shared with the Worker; the Worker builds requests only from typed JSON and never forwards client XML.
- `workers/ojp/src/handler.ts` uses only the standard Fetch API with injected deps (tested in Node); `index.ts` wires Cloudflare bindings.
- OJP facts found in recorded answers (Nov 2026), relied on by `src/core/ojp/parse.ts` and the planner:
  - Only the **first** `<Via>` of a TripRequest is enforced. The planner asks once with all vias and, when no answer passes them all, splits the leg at the vias and stitches the answers (`src/core/planner/stitch.ts`).
  - A leg cannot end where it starts; round trips without a stop turn at their middle via (`splitLoops`).
  - Category `PE` is also used for regular trains (Luzern-Interlaken Express). Reservation-only panorama trains carry attribute `A__PR`; product names (`BERNINA EXPRESS`) are matched against `ga.json`.
  - Cog railways come as PtMode `telecabin`/`funicular` with category `CC`; replacement buses as `EV`.
  - OJP passes the first via by its exact stop, walking through the station when the train or bus stops beside it (EV at "Bergün/Bravuogn, posta" → walk to Bergün/Bravuogn → back; boat to "Luzern Bahnhofquai" → walk to Luzern). So a via counts as passed when any section, walks included, reaches it (`visited` in `connection.ts`); the line folds walks under a minute into one row with both stops (`rows.ts`). Walks carry their minutes (`walkMin`, from `<Duration>`), and a connection's dep/arr include walks at its ends.
  - Cancelled trains and stops not served (`Cancelled`, `NotServicedStop`) are dropped from trip answers.
- Acceptance tests (`tests/acceptance.test.ts`) replay the planner's own OJP requests from `tests/fixtures/ojp/<tour>/<sha1>.xml.gz` (tracks thinned to every 20th point). A planner change that alters its requests needs new answers: `NODE_USE_ENV_PROXY=1 OJP_RECORD_URL=<Worker URL> npm run record:ojp:missing` records only the missing ones through the app's Worker (no key); a full re-record is `npm run record:ojp` with `OJP_API_KEY`.
- e2e (`e2e/fixtures.ts`): every test fails on an uncaught page error or `console.error`; the Worker URL is answered from the recorded acceptance answers. `e2e/acceptance.spec.ts` plans T1–T6 through the UI (every option, export, map), so planner changes that break a screen fail before release.
- Trips (SPEC §3a, 0.4.0): `src/ui/Home.tsx` (the list), `src/ui/TripScreen.tsx` (the one screen), `src/ui/TripLine.tsx` (the line and its panel, drag by the open station's grip), `src/ui/AddSheet.tsx` (stations, scenic lines, your past trips), `src/ui/usePlanner.ts` (plans while you edit; the trip's `chain`/`legs` are absent until planned: `isPlanned`), `src/io/planTrip.ts` (one request per route, shared) and `src/io/autoplan.ts` (trips without a timetable planned in the background), `src/ui/TripLive.tsx` (under way), `src/ui/EditTrip.tsx` (replan from here, under way only; edits entries like the trip screen). Core: `src/core/line.ts` (entries: what you entered; a scenic line's must-pass stations are `ring`s and go when its ends change), `src/core/rows.ts` (route + timetable → rows), `src/core/retire.ts` (a past trip → your trips), `src/core/trip.ts`, `src/core/live.ts`, `src/core/replan.ts`, `src/core/export/tripShare.ts`. Stores: `src/trips.ts` (`srr.trips.v1`; route edits save at once and drop the timetable) and `src/tours.ts` (your trips, `srr.tours.v1`; code still says tour), both on `src/io/listStore.ts`: saved item by item into what is stored (one IndexedDB transaction, so a stale tab never drops another tab's items), other tabs told on every save; a list that could not be read is never written or synced (`failed`).
- Links: `#/j/<data>` a trip with its times; route links (`#/r/<stops>?…`, `src/core/export/routeLink.ts`; older `#/t/<base64>`; a 0.3 route address `#/tour/<id>?s=…`) open as a route to plan as a new trip (`SharedTour`).
- Sync (SPEC §3b): `src/core/sync.ts` (pure: key, HKDF, AES-GCM, stamps, merge; a trip's hash leaves out its timetable, so planning is no change and never outdates a route edited elsewhere), `src/io/sync.ts` (engine; `srr.sync.v1`), `src/ui/Settings.tsx`, `src/ui/QrScanner.tsx` (BarcodeDetector, else lazy jsQR; e2e feeds a fake camera from an MJPEG, `e2e/scan.spec.ts`); Worker `workers/ojp/src/sync.ts` + Durable Object `SyncBox`. e2e answers `/sync/` from a shared in-memory mailbox (`answerWorker` in `e2e/fixtures.ts`).
- Debug log (opt in, Settings): `log(event, data)` from `src/io/log.ts`, a no-op while off; `src/core/log.ts` (pure: line format, `scrub` drops keys/secrets, size rotation in two parts of 256 KB, `screenOf` never logs a link's data or a sync key). The planner logs through its injected `trace`. Log every new I/O, decision and failure; never a sync key or anything decrypted. e2e: `e2e/log.spec.ts`.
- Render code never reads `Date.now()` (React purity): use `useNow()` (`src/ui/useNow.ts`), a shared 15 s clock. Tests drive it with `page.clock`.
- `src/ui/` may import from `core/`, never the other way round.
- Keep each file under 800 lines; split before adding to it.

- Curated data: `src/data/templates.json` (types in `src/core/data.ts`; a line is enforced by its must-pass stations and its modes, nothing else: the avoided-segment rule was redundant and went in 0.6.3). `ga.json` is generated (`npm run data:ga`) from SBB's OSDM fares; it covers fares SBB sells, so other operators' summit lines (Niesen, Harder…) are missing, never guessed. Must-pass stops must be stops trains call at (OJP lists only those): Wassen, for one, is not.

## Android

- Capacitor shell in `android/` (app ID `ch.brunodev.swissrailroutes` and the release key are permanent). `npm run android:sync` builds and copies `dist/` in (gitignored). `src/native.ts` owns `isNative`; the service worker and update banner are web-only.
- Back button: `src/io/back.ts` (`@capacitor/app`) goes up one screen (`parentOf`, `src/core/parent.ts`), replacing the address; on the main list the app goes to the background.
- Notifications: `src/core/notify.ts` (pure: 10 min before a departure, 5 before an exit, 10 before a highlight) and `src/io/notifications.ts` (cancels and reschedules all on every trips change; no-op on the web). Texts in i18n (`n*`).
- Logo V13 (`docs/design/logos/v13/`): every icon, web and Android, comes from `scripts/logo-sets.py --apply`, then `npm run icons`; never edit the generated SVG/XML by hand.
- Release: bump `package.json` version on `main` → `android.yml` builds, smoke-tests (`scripts/android-smoke.sh`), signs in environment `release`, publishes `v<version>`. The Worker's `ALLOWED_ORIGINS` includes `https://localhost` for the app.
- Owner's rule: every push to `main` releases. Bump `package.json` `version` in the same push (`npm version X.Y.Z --no-git-tag-version`): patch for fixes, minor for features. A push without a bump does not release.

## Invariants

- Storage keys follow `srr.<name>.v<N>` (IndexedDB: `srr.tours.v1`, `srr.trips.v1`, `srr.plans.v1`, `srr.sync.v1`, `srr.syncLast.v1`, `srr.log.v1`; localStorage: `srr.prefs.v1`, `srr.logging.v1`; retired: `srr.oneList.v1`; sessionStorage: `srr.opened.v1`, set when the app opened in this tab, so a reload never jumps to the trip under way). Never rename an existing key: bump the version and migrate.
- Leg queries (stops, date, time) go to the Worker; nothing else leaves the device, except with sync on: trips and your past trips, encrypted on the device with a key only the devices hold (`src/core/sync.ts`; the Worker stores ciphertext under an id derived from the key). Never send the key, or anything decrypted, anywhere. CSP `connect-src` lists only the Worker and the tile host.
- API keys exist only as Worker secrets.
- Curated data in `src/data/` is schema-checked by a test; a template change needs a fixture run of T1–T6.
- Tests never hit the network: OJP answers are recorded fixtures. Live checks run only in `live.yml`.
- No user-facing string is hard-coded. Add it to `src/i18n/en.ts` and to de, fr, it.

## Deviations

None.

## Done checklist (before every push)

1. `npm run check` (typecheck, lint, format:check, unit)
2. `VITE_OJP_URL=https://ojp.invalid npm run build && npm run e2e` (the URL is answered from fixtures)
3. If you fixed a bug, a test now covers it.
4. README is updated if you changed behaviour, scripts or services.
