# swiss-rail-routes: agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason. Product spec: [`docs/SPEC.md`](docs/SPEC.md). Design: [`docs/DESIGN.md`](docs/DESIGN.md) (principles, tokens, screenshot review).

Status: Routes and Trips (one time-aware trip screen, one edit screen; SPEC §3a) complete; Android shell with trip notifications. Next: SPEC §3 Should/Could items.

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
- Acceptance tests (`tests/acceptance.test.ts`) replay the planner's own OJP requests from `tests/fixtures/ojp/<tour>/<sha1>.xml.gz` (tracks thinned to every 20th point). A planner change that alters its requests needs a re-record: `NODE_USE_ENV_PROXY=1 npm run record:ojp` with `OJP_API_KEY` set.
- e2e (`e2e/fixtures.ts`): every test fails on an uncaught page error or `console.error`; the Worker URL is answered from the recorded acceptance answers. `e2e/acceptance.spec.ts` plans T1–T6 through the UI (every option, export, map), so planner changes that break a screen fail before release.
- Routes and Trips (SPEC §3a): `src/ui/TripView.tsx` (before / under way / after), `src/ui/EditTrip.tsx` (whole trip before departure, from here under way), `src/core/trip.ts` (versions, status), `src/core/live.ts` (pure live state), `src/core/replan.ts`, `src/core/export/tripShare.ts`; stores `src/tours.ts` (`srr.tours.v1`) and `src/trips.ts` (`srr.trips.v1`). Adds and removes save at once, edits after 300 ms, everything when the page hides.
- Links (`src/core/export/routeLink.ts`): `#/r/<stops>?<settings>` is a route anywhere (`slug.<SLOID number>` plus modifiers, `@<template>` inserts one); a route's own address `#/tour/<id>[/plan]?s=<stops>&…` follows edits (`useAddress`, replaceState) and opens as that route on a device that lacks the id. `#/t/<base64>` stays readable (older links). Trips share as `#/j/` snapshots; their address stays local.
- Sync (SPEC §3b): `src/core/sync.ts` (pure: key, HKDF, AES-GCM, stamps, merge), `src/io/sync.ts` (engine; `srr.sync.v1`), `src/ui/Settings.tsx`, `src/ui/QrScanner.tsx` (BarcodeDetector, else lazy jsQR; e2e feeds a fake camera from an MJPEG, `e2e/scan.spec.ts`); Worker `workers/ojp/src/sync.ts` + Durable Object `SyncBox`. e2e answers `/sync/` from a shared in-memory mailbox (`answerWorker` in `e2e/fixtures.ts`).
- Render code never reads `Date.now()` (React purity): use `useNow()` (`src/ui/useNow.ts`), a shared 15 s clock. Tests drive it with `page.clock`.
- `src/ui/` may import from `core/`, never the other way round.
- Keep each file under 800 lines; split before adding to it.

- Curated data: `src/data/templates.json`, `segments.json` (types in `src/core/data.ts`). `ga.json` is generated (`npm run data:ga`) from SBB's OSDM fares; it covers fares SBB sells, so other operators' summit lines (Niesen, Harder…) are missing, never guessed. Must-pass stops must be stops trains call at (OJP lists only those): Wassen, for one, is not.
- `src/core/export/sbb.ts` uses the old sbb.ch timetable URL; unverified, check when touching exports.

## Android

- Capacitor shell in `android/` (app ID `ch.brunodev.swissrailroutes` and the release key are permanent). `npm run android:sync` builds and copies `dist/` in (gitignored). `src/native.ts` owns `isNative`; the service worker and update banner are web-only.
- Notifications: `src/core/notify.ts` (pure: 10 min before a departure, 5 before an exit, 10 before a highlight) and `src/io/notifications.ts` (cancels and reschedules all on every trips change; no-op on the web). Texts in i18n (`n*`).
- Logo C1 (`docs/design/logos/`): every icon, web and Android, comes from `scripts/logo-sets.py --apply`, then `npm run icons`; never edit the generated SVG/XML by hand.
- Release: bump `package.json` version on `main` → `android.yml` builds, smoke-tests (`scripts/android-smoke.sh`), signs in environment `release`, publishes `v<version>`. The Worker's `ALLOWED_ORIGINS` includes `https://localhost` for the app.

## Invariants

- Storage keys follow `srr.<name>.v<N>` (IndexedDB: `srr.tours.v1`, `srr.trips.v1`, `srr.plans.v1`, `srr.sync.v1`; localStorage: `srr.prefs.v1`). Never rename an existing key: bump the version and migrate.
- Leg queries (stops, date, time) go to the Worker; nothing else leaves the device, except with sync on: routes and trips, encrypted on the device with a key only the devices hold (`src/core/sync.ts`; the Worker stores ciphertext under an id derived from the key). Never send the key, or anything decrypted, anywhere. CSP `connect-src` lists only the Worker and the tile host.
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
