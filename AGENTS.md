# swiss-rail-routes: agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason. Product spec: [`docs/SPEC.md`](docs/SPEC.md).

Status: builder, planner, warnings, timeline, exports, Worker, stop index, curated data. Next: OJP parser from recorded fixtures (`npm run record:ojp`, needs `OJP_API_KEY` in the session), then the map, `live.yml`, gallery photos.

## Stack

- TypeScript strict, React 19, Vite, vite-plugin-pwa, zustand, MapLibre GL, idb-keyval, fast-xml-parser, Vitest, Playwright. Node: see `.nvmrc`.
- One Cloudflare Worker in `workers/ojp/` holds the opentransportdata.swiss keys.
- Check library APIs against the installed types in `node_modules`, not from memory.
- Cloud sessions: Playwright uses `CHROMIUM_PATH` (set by the SessionStart hook); never run `playwright install` there.

## Architecture

- `src/core/` is pure logic with no DOM, and every module has tests in `tests/`.
- The planner (`src/core/planner/`) gets all I/O injected (`fetchTrips`, `now`, templates, GA rules); tests replay `tests/fixtures/ojp/`.
- `src/core/ojp/request.ts` is shared with the Worker; the Worker builds requests only from typed JSON and never forwards client XML.
- `workers/ojp/src/handler.ts` uses only the standard Fetch API with injected deps (tested in Node); `index.ts` wires Cloudflare bindings. Its OJP element names are unverified until fixtures are recorded.
- `src/ui/` may import from `core/`, never the other way round.
- Keep each file under 800 lines; split before adding to it.

- Curated data: `src/data/templates.json`, `segments.json`, `ga.json` (types in `src/core/data.ts`). Must-pass stops must be stops trains call at (OJP lists only those): Wassen, for one, is not.
- `src/core/export/sbb.ts` uses the old sbb.ch timetable URL; unverified, check when touching exports.

## Invariants

- Storage keys follow `srr.<name>.v<N>`. Never rename an existing key: bump the version and migrate.
- Leg queries (stops, date, time) go to the Worker; nothing else leaves the device. CSP `connect-src` lists only the Worker and the tile host.
- API keys exist only as Worker secrets.
- Curated data in `src/data/` is schema-checked by a test; a template change needs a fixture run of T1–T6.
- Tests never hit the network: OJP answers are recorded fixtures. Live checks run only in `live.yml`.
- No user-facing string is hard-coded. Add it to `src/i18n/en.ts` and to de, fr, it.

## Deviations

None.

## Done checklist (before every push)

1. `npm run check` (typecheck, lint, format:check, unit)
2. `npm run build && npm run e2e`
3. If you fixed a bug, a test now covers it.
4. README is updated if you changed behaviour, scripts or services.
