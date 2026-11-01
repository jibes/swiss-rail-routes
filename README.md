# Swiss Rail Day-Trip Planner

Plans a scenic Swiss rail day trip (forced routes, stops with dwell time, round trip) as one validated timetable, with GA validity, reservation, disruption and after-sunset warnings.

**Status:** scaffold (app shell, i18n, tour model). Planner, Worker and screens follow [`docs/SPEC.md`](docs/SPEC.md).

## Run

```sh
npm ci
npm run dev
```

| Script                      | Does                                                  |
| --------------------------- | ----------------------------------------------------- |
| `dev` / `build` / `preview` | Vite                                                  |
| `check`                     | typecheck, lint, format:check, unit tests             |
| `e2e`                       | Playwright smoke against `vite preview` (build first) |
| `icons`                     | Renders `public/icons/icon.svg` to the manifest PNGs  |

Set `CHROMIUM_PATH` to use a preinstalled Chromium instead of Playwright's own.

## Deploy

`main` deploys to GitHub Pages after all checks pass (`.github/workflows/deploy.yml`). Repo settings: Pages source "GitHub Actions"; `main` protected with `CI / check` required.

## Privacy

Tours stay on the device. Leg queries (stops, date, time) will go to this app's Cloudflare Worker, which forwards them to opentransportdata.swiss (OJP). Map tiles will come from OpenFreeMap. No accounts, analytics or tracking.

## Licence

AGPL-3.0-or-later, see [`LICENSE`](LICENSE).
