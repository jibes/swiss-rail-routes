# swiss-rail-routes: agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason. Product spec: [`docs/SPEC.md`](docs/SPEC.md).

Status: complete MVP path (builder, planner on real OJP answers, timeline, map, exports, Worker, stop index, curated data). Next: see docs/SPEC.md §3 Should/Could items.

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
- `src/ui/` may import from `core/`, never the other way round.
- Keep each file under 800 lines; split before adding to it.

- Curated data: `src/data/templates.json`, `segments.json` (types in `src/core/data.ts`). `ga.json` is generated (`npm run data:ga`) from SBB's OSDM fares; it covers fares SBB sells, so other operators' summit lines (Niesen, Harder…) are missing, never guessed. Must-pass stops must be stops trains call at (OJP lists only those): Wassen, for one, is not.
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
2. `VITE_OJP_URL=https://ojp.invalid npm run build && npm run e2e` (the URL is answered from fixtures)
3. If you fixed a bug, a test now covers it.
4. README is updated if you changed behaviour, scripts or services.
