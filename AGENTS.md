# swiss-rail-routes: agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason. Product spec: [`docs/SPEC.md`](docs/SPEC.md).

Status: spec only. Scaffold from `apps-data/templates/` before writing code.

## Stack
- TypeScript strict, React 19, Vite, vite-plugin-pwa, zustand, MapLibre GL, idb-keyval, fast-xml-parser, Vitest, Playwright. Node: see `.nvmrc`.
- One Cloudflare Worker in `workers/ojp/` holds the opentransportdata.swiss keys.
- Check library APIs against the installed types in `node_modules`, not from memory.

## Architecture
- `src/core/` is pure logic with no DOM, and every module has tests in `tests/`.
- The planner (`src/core/planner/`) gets all I/O injected (`fetchTrips`, `now`, templates, GA rules); tests replay `tests/fixtures/ojp/`.
- `src/core/ojp/request.ts` is shared with the Worker; the Worker builds requests only from typed JSON and never forwards client XML.
- `src/ui/` may import from `core/`, never the other way round.
- Keep each file under 800 lines; split before adding to it.

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
