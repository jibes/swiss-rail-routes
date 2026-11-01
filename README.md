# Swiss Rail Day-Trip Planner

Plans a scenic Swiss rail day trip (forced routes, stops with dwell time, round trip) as one validated timetable, with GA validity, reservation, disruption and after-sunset warnings.

**Status:** Routes (builder with drag and drop, route templates), planning with options and Earlier/Later, Trips (saved timetables, tickets, calendar, GPX, exact share links), Now (live delays, connections at risk, position on the line, replan from here with undo), map, OJP Worker, monthly stop and GA data. See [`docs/SPEC.md`](docs/SPEC.md) and [`docs/DESIGN.md`](docs/DESIGN.md).

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
| `icons`                     | Renders `public/icons/icon.svg` to the manifest PNGs  |
| `android:sync`              | Builds the web app and copies it into `android/`      |

Set `CHROMIUM_PATH` to use a preinstalled Chromium instead of Playwright's own.

## Deploy

`main` deploys to GitHub Pages after all checks pass (`.github/workflows/deploy.yml`). Repo setting: Pages source "GitHub Actions". No branch protection; direct pushes to `main` are fine because deploy is gated on CI.

## Android

`android/` is a Capacitor shell (app ID `ch.brunodev.swissrailroutes`, permanent) around the same web build. It adds trip notifications: 10 min before each departure, 5 min before each stop to get off, and 10 min before a highlight (with sunset time when it is near). They are scheduled on the phone from the saved timetable (`src/io/notifications.ts`), so they need no network and do not follow live delays.

Install and update with [Obtainium](https://github.com/ImranR98/Obtainium): add `https://github.com/jibes/swiss-rail-routes`.

`android.yml` builds an unsigned APK, smoke-tests it on an Android 16 emulator, waits for the web checks, then signs it and publishes GitHub release `v<version>` when `package.json` `version` has no tag yet. versionCode = major·10⁷ + minor·10⁵ + patch·10³.

Signing (one-time): environment `release` (Settings → Environments, deployment branches: `main`) with secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is built and tested but not published. The release job refuses a signer other than:

SHA-256 (release certificate): not set yet

## OJP Worker

`workers/ojp/` holds the opentransportdata.swiss key, so the app never sees it. It takes typed JSON (`POST /trip`, `POST /stops`), builds the OJP 2.0 XML itself (`src/core/ojp/request.ts`), caches answers 10 min and allows 120 uncached requests a minute per IP. `deploy-worker-ojp.yml` deploys it after CI when its files change.

One-time setup:

1. Cloudflare: create an API token from the template "Edit Cloudflare Workers". Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Run "Deploy OJP Worker" (Actions → Run workflow). It deploys `srr-ojp` to `https://srr-ojp.<your-subdomain>.workers.dev`.
3. Add the OJP 2.0 key as a Worker secret: Cloudflare dashboard → Workers → `srr-ojp` → Settings → Variables and Secrets → `OJP_API_KEY` (type Secret). Or `npx wrangler secret put OJP_API_KEY -c workers/ojp/wrangler.toml`.
4. Add repo variable `OJP_WORKER_URL` with the Worker's URL and rerun "Deploy to GitHub Pages". The build adds its origin to the CSP, and `live.yml` runs T1–T6 against it nightly for the next Saturday (one open issue labelled `live-check` while it fails).

Allowed origins are in `workers/ojp/wrangler.toml` (`ALLOWED_ORIGINS`); add a custom domain there.

## Privacy

Tours stay on the device. Leg queries, stop searches and, during a trip, the ids of the current and next train (stop names and ids, date, time, journey ids) go to this app's Cloudflare Worker, which forwards them to opentransportdata.swiss (OJP). The Worker keeps no logs (observability off) and caches answers 10 min, keyed by the query only. Map tiles come from OpenFreeMap (only on the map screen). No accounts, analytics or tracking. The Android app schedules its notifications on the phone.

## Third-party data and code

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Licence

AGPL-3.0-or-later, see [`LICENSE`](LICENSE).
