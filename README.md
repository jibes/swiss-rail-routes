# Viadukt

Swiss rail day-trip planner (repository `swiss-rail-routes`).

Plans a scenic Swiss rail day trip (forced routes, stops with dwell time, round trip) as one validated timetable, with GA validity, reservation, disruption and after-sunset warnings.

**Status:** one list of dated trips and one screen per trip: the trip is one line, edited in place (stations, scenic lines, stays; a panel per station, drag to move) and planned while you edit (three options, Earlier/Later); a station no connection passes says so (try an hour later); a station the plan chose (a change, a stop on the way) is kept as one of yours with a tap; a leg whose next connection leaves over two hours later says so; a scenic line ridden after dark is said; a stay is a length or an until time, also into a later day (time windows by link or MCP); every trip edited whenever it is, past ones folded under the list; under way the trip followed: live delays, connections at risk and the position on the line, and Change trip for its time, connection and what lies ahead as at any time (the way behind you kept as ridden), undo; a finished trip waits in search to go again. Share (one sheet: the link, the calendar, a printout, and each leg on sbb.ch with its tickets and prices), calendar (.ics), a printout (one page for a usual day, two for the longest), which side to sit on along the scenic lines where sources agree, scenic lines across the border (Mont-Blanc Express to Chamonix, Centovalli to Domodossola) with the stretch abroad said, stations abroad (München, Milano, Lyon…) planned through Transitous, the GA said to end at the border, exact share links, sync between your own devices, map (dark on a dark device; on a wide screen, from 860 px, the list beside the trip or its map), Android app with notifications, OJP Worker, monthly stop and GA data. See [`docs/SPEC.md`](docs/SPEC.md) and [`docs/DESIGN.md`](docs/DESIGN.md).

## Run

```sh
npm ci
npm run dev
```

Planning needs `VITE_OJP_URL` (the Worker). For the e2e tests build with `VITE_OJP_URL=https://ojp.invalid`; the tests answer it from recorded fixtures.

| Script                      | Does                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| `dev` / `build` / `preview` | Vite                                                                            |
| `check`                     | `typecheck`, `lint`, `format:check`, `test` (Vitest) in one                     |
| `format`                    | Prettier, writing                                                               |
| `e2e`                       | Playwright against `vite preview` (build first)                                 |
| `icons`                     | Renders `public/icons/{icon,maskable}.svg` to PNGs                              |
| `worker:dev`                | The OJP Worker locally (wrangler), with the dev servers' origins allowed        |
| `record:ojp`                | Re-records all acceptance fixtures (`OJP_API_KEY`)                              |
| `record:ojp:missing`        | Records only the answers missing, through the Worker (`OJP_RECORD_URL`, no key) |
| `data:stops` / `data:ga`    | Rebuilds the stop index / GA data                                               |
| `mcp:bundle`                | The MCP server's bundle for the VPS (`mcp/README.md`)                           |
| `android:sync`              | Builds the web app and copies it into `android/`                                |

Set `CHROMIUM_PATH` to use a preinstalled Chromium instead of Playwright's own.

## Deploy

`main` deploys to GitHub Pages after all checks pass (`.github/workflows/deploy.yml`). Repo setting: Pages source "GitHub Actions". No branch protection; direct pushes to `main` are fine because deploy is gated on CI.

## Android

`android/` is a Capacitor shell (app ID `ch.brunodev.swissrailroutes`, permanent) around the same web build. It adds trip notifications: 10 min before each departure, 5 min before each stop to get off, and 10 min before a highlight (with sunset time when it is near). They are scheduled on the phone from the saved timetable (`src/io/notifications.ts`), with a delay the timetable service already knew when the trip was planned or reloaded; they need no network and do not follow delays after that. The back button goes up one screen; on the main list it puts the app in the background.

Install and update with [Obtainium](https://github.com/ImranR98/Obtainium): add `https://github.com/jibes/swiss-rail-routes`.

`android.yml` builds an unsigned APK, smoke-tests it on an Android 16 emulator, waits for the web checks, then signs it and publishes GitHub release `v<version>` when `package.json` `version` has no tag yet. versionCode = major·10⁷ + minor·10⁵ + patch·10³.

Signing (one-time): environment `release` (Settings → Environments, deployment branches: `main`) with secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is built and tested but not published. The release job refuses a signer other than:

SHA-256 (release certificate): FA:B7:AC:4C:B6:4F:D1:BE:7A:AC:EC:7B:F6:46:E5:CE:4B:01:9F:B6:5D:10:56:02:CD:24:83:74:50:68:4C:FB

## MCP server

`mcp/` is a read-only MCP server with the app's planner, for an AI assistant on the phone: see [`mcp/README.md`](mcp/README.md). It runs on a VPS and takes timetables through the Worker below.

## OJP Worker

`workers/ojp/` holds the opentransportdata.swiss key, so the app never sees it. It takes typed JSON (`POST /trip`, `/stops`, `/journey`, `/departures` (for the MCP), and `/eu/stops`, `/eu/plan`, answered by Transitous for trains abroad, and `/weather`, answered by Open-Meteo (MET Norway when Open-Meteo refuses), for the weather on the trip line) and stores sync blobs (`GET/PUT/DELETE /sync/<id>`, one Durable Object per id, created by the deploy), builds the OJP 2.0 XML itself (`src/core/ojp/request.ts`), caches answers (trips and stop searches 10 min, trips for the same day 1 min, live train data 30 s, weather 1 h) and allows 120 uncached requests a minute per IP. `deploy-worker-ojp.yml` deploys it after CI when its files change.

One-time setup:

1. Cloudflare: create an API token from the template "Edit Cloudflare Workers". Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Run "Deploy OJP Worker" (Actions → Run workflow). It deploys `srr-ojp` to `https://srr-ojp.<your-subdomain>.workers.dev`.
3. Add the OJP 2.0 key as a Worker secret: Cloudflare dashboard → Workers → `srr-ojp` → Settings → Variables and Secrets → `OJP_API_KEY` (type Secret). Or `npx wrangler secret put OJP_API_KEY -c workers/ojp/wrangler.toml`.
4. Add repo variable `OJP_WORKER_URL` with the Worker's URL and rerun "Deploy to GitHub Pages". The build adds its origin to the CSP, and `live.yml` runs T1–T6 against it nightly for the next Saturday (one open issue labelled `live-check` while it fails).

Allowed origins are in `workers/ojp/wrangler.toml` (`ALLOWED_ORIGINS`: the site and `https://localhost` for the Android app); add a custom domain there. Local dev servers are not in it, so no page on anyone's localhost can spend the key: `npm run worker:dev` passes them with `--var`.

`data.yml` rebuilds the stop index and GA data monthly and opens a pull request (branch `data`) when they changed; merge it with a version bump, so the app releases with the new data.

## Links

A route's address is its share link: `#/r/zurich-hb.3000~chur.9000.60~@bernina?d=2026-11-21&dep=08:00` (stops as name and SLOID number, `.60` = get off for 60 min, `@bernina` a route template; settings optional; without `d` the day is today, or the day the earliest stay until a date ends when that is later). `#/r/@bernina` alone opens that template. Everything after `#` stays in the browser; the server never sees it. A planned trip shares as its trains (`#/s/…`, packed as numbers: about 340 characters for 14 rides; it ends in `z`, a letter messengers' link detection keeps). Older links (`#/s/` JSON, `#/j/…` snapshots) still open.

## Privacy

Trips stay on the device. Leg queries, stop searches and, during a trip, the ids of the train you are on (and of the next one shortly before it leaves) (stop names and ids, date, time, journey ids) go to this app's Cloudflare Worker, which forwards them to opentransportdata.swiss (OJP). A station name you search abroad (on the tap) and a leg abroad (its two stations' positions and time) go through the same Worker to Transitous (transitous.org, community-run), which the Worker asks with the app's name and nothing of yours. The Worker keeps no logs (observability off) and caches answers (trips and stop searches 10 min, trips for the same day 1 min, live train data 30 s, weather 1 h), keyed by the query only. Map tiles come from OpenFreeMap (only on the map screen); in the web app the tiles you have seen are kept on the device (about 30 MB, up to 60 days), so a trip's map opens offline, and nothing is fetched ahead; the Android app keeps them the same way, in the app itself. Searching for a place (Swissminiatur, the Rhine Falls) uses a list bundled with the app; nothing typed is sent for it. Timetable answers are also kept on the device (until the day travelled, on the day 15 min), so looking at other connections asks again only what is new. No accounts, analytics or tracking. With sync on (Settings), trips and the stations you entered lately are encrypted on the device with a key only your devices hold and stored as ciphertext by the Worker (one blob per key, in a Cloudflare Durable Object); see [`docs/SPEC.md`](docs/SPEC.md) §3b. The Android app schedules its notifications on the phone. The camera is used only while scanning a sync code; frames are read on the device and never sent. Your location is used only if you turn it on on the map, and only while the map is open; it is kept in memory, never stored or sent, and the map never moves to it, so map tiles do not reveal it. For the weather on the line, the trip's stations rounded to about 5 km and its day go through the Worker to Open-Meteo (MET Norway when Open-Meteo refuses); never the device's location.

The debug log (Settings → Debug log, off by default) records what the app does: screens, planning and its timetable requests (stop names, times, what was kept or rejected), sync rounds (never the key), notifications, errors. It stays on the device in IndexedDB, at most about 512 KB in two parts (when the current part fills, the older one is dropped). You hand it on yourself with Save file (share sheet in the app, a download in the browser) or Copy; turning it off deletes it.

## Third-party data and code

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Licence

AGPL-3.0-or-later, see [`LICENSE`](LICENSE).
