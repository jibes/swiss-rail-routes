# Swiss Rail Day-Trip Planner

Plans a scenic Swiss rail day trip (forced routes, stops with dwell time, round trip) as one validated timetable, with GA validity, reservation, disruption and after-sunset warnings.

**Status:** 0.4.0: one list of dated trips and one screen per trip: the trip is one line, edited in place (stations, scenic lines, stays; a panel per station, drag to move) and planned while you edit (three options, Earlier/Later); under way live delays, connections at risk, position on the line, replan from here, undo; a finished trip waits in search to go again. Calendar (.ics), exact share links, sync between your own devices, map, Android app with notifications, OJP Worker, monthly stop and GA data. See [`docs/SPEC.md`](docs/SPEC.md) and [`docs/DESIGN.md`](docs/DESIGN.md).

## Run

```sh
npm ci
npm run dev
```

Planning needs `VITE_OJP_URL` (the Worker). For the e2e tests build with `VITE_OJP_URL=https://ojp.invalid`; the tests answer it from recorded fixtures.

| Script                      | Does                                                  |
| --------------------------- | ----------------------------------------------------- |
| `dev` / `build` / `preview` | Vite                                                  |
| `check`                     | typecheck, lint, format:check, unit tests             |
| `e2e`                       | Playwright smoke against `vite preview` (build first) |
| `icons`                     | Renders `public/icons/{icon,maskable}.svg` to PNGs    |
| `worker:dev`                | The OJP Worker locally (wrangler)                     |
| `record:ojp`                | Re-records the acceptance fixtures (`OJP_API_KEY`)    |
| `data:stops` / `data:ga`    | Rebuilds the stop index / GA exceptions               |
| `android:sync`              | Builds the web app and copies it into `android/`      |

Set `CHROMIUM_PATH` to use a preinstalled Chromium instead of Playwright's own.

## Deploy

`main` deploys to GitHub Pages after all checks pass (`.github/workflows/deploy.yml`). Repo setting: Pages source "GitHub Actions". No branch protection; direct pushes to `main` are fine because deploy is gated on CI.

## Android

`android/` is a Capacitor shell (app ID `ch.brunodev.swissrailroutes`, permanent) around the same web build. It adds trip notifications: 10 min before each departure, 5 min before each stop to get off, and 10 min before a highlight (with sunset time when it is near). They are scheduled on the phone from the saved timetable (`src/io/notifications.ts`), so they need no network and do not follow live delays. The back button goes up one screen; on the main list it puts the app in the background.

Install and update with [Obtainium](https://github.com/ImranR98/Obtainium): add `https://github.com/jibes/swiss-rail-routes`.

`android.yml` builds an unsigned APK, smoke-tests it on an Android 16 emulator, waits for the web checks, then signs it and publishes GitHub release `v<version>` when `package.json` `version` has no tag yet. versionCode = major·10⁷ + minor·10⁵ + patch·10³.

Signing (one-time): environment `release` (Settings → Environments, deployment branches: `main`) with secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is built and tested but not published. The release job refuses a signer other than:

SHA-256 (release certificate): FA:B7:AC:4C:B6:4F:D1:BE:7A:AC:EC:7B:F6:46:E5:CE:4B:01:9F:B6:5D:10:56:02:CD:24:83:74:50:68:4C:FB

## OJP Worker

`workers/ojp/` holds the opentransportdata.swiss key, so the app never sees it. It takes typed JSON (`POST /trip`, `/stops`, `/journey`) and stores sync blobs (`GET/PUT/DELETE /sync/<id>`, one Durable Object per id, created by the deploy), builds the OJP 2.0 XML itself (`src/core/ojp/request.ts`), caches answers (trips and stop searches 10 min, live train data 30 s) and allows 120 uncached requests a minute per IP. `deploy-worker-ojp.yml` deploys it after CI when its files change.

One-time setup:

1. Cloudflare: create an API token from the template "Edit Cloudflare Workers". Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Run "Deploy OJP Worker" (Actions → Run workflow). It deploys `srr-ojp` to `https://srr-ojp.<your-subdomain>.workers.dev`.
3. Add the OJP 2.0 key as a Worker secret: Cloudflare dashboard → Workers → `srr-ojp` → Settings → Variables and Secrets → `OJP_API_KEY` (type Secret). Or `npx wrangler secret put OJP_API_KEY -c workers/ojp/wrangler.toml`.
4. Add repo variable `OJP_WORKER_URL` with the Worker's URL and rerun "Deploy to GitHub Pages". The build adds its origin to the CSP, and `live.yml` runs T1–T6 against it nightly for the next Saturday (one open issue labelled `live-check` while it fails).

Allowed origins are in `workers/ojp/wrangler.toml` (`ALLOWED_ORIGINS`); add a custom domain there.

## Links

A route's address is its share link: `#/r/zurich-hb.3000~chur.9000.60~@bernina?d=2026-11-21&dep=08:00` (stops as name and SLOID number, `.60` = get off for 60 min, `@bernina` a route template; settings optional). `#/r/@bernina` alone opens that template. Everything after `#` stays in the browser; the server never sees it. Trips share as an exact snapshot (`#/j/…`).

## Privacy

Trips stay on the device. Leg queries, stop searches and, during a trip, the ids of the train you are on (and of the next one shortly before it leaves) (stop names and ids, date, time, journey ids) go to this app's Cloudflare Worker, which forwards them to opentransportdata.swiss (OJP). The Worker keeps no logs (observability off) and caches answers (trips and stop searches 10 min, live train data 30 s), keyed by the query only. Map tiles come from OpenFreeMap (only on the map screen). Timetable answers are also kept on the device (until the day travelled, on the day 15 min), so looking at other connections asks again only what is new. No accounts, analytics or tracking. With sync on (Settings), trips are encrypted on the device with a key only your devices hold and stored as ciphertext by the Worker (one blob per key, in a Cloudflare Durable Object); see [`docs/SPEC.md`](docs/SPEC.md) §3b. The Android app schedules its notifications on the phone. The camera is used only while scanning a sync code; frames are read on the device and never sent.

The debug log (Settings → Debug log, off by default) records what the app does: screens, planning and its timetable requests (stop names, times, what was kept or rejected), sync rounds (never the key), notifications, errors. It stays on the device in IndexedDB, at most about 512 KB in two parts (when the current part fills, the older one is dropped). You hand it on yourself with Save file (share sheet in the app, a download in the browser) or Copy; turning it off deletes it.

## Third-party data and code

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Licence

AGPL-3.0-or-later, see [`LICENSE`](LICENSE).
