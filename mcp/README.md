# Viadukt MCP server

Lets an AI assistant plan and follow Swiss rail day trips with the app's own planner, scenic-line data and GA rules. Read-only: it never touches trips or sync, and stores nothing beyond an in-memory cache and its API keys' hashes. Five tools: `find_stops`, `list_scenic_lines`, `plan_trip`, `more_options`, `train_status`.

It runs on a VPS, not as a Cloudflare Worker: a plan needs real CPU time and many subrequests. Timetables come through the OJP Worker (`workers/ojp/`), which holds the only API key, so no secret of that kind is here.

## Run

| Env              | What                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| `MCP_KEYS`       | Default `/app/keys/keys.json`: the API keys (below), on the one volume.    |
| `MCP_SECRET`     | Deprecated, at least 32 characters: still works as the key named `legacy`. |
| `OJP_WORKER_URL` | Required. The Worker's address.                                            |
| `MCP_PORT`       | Default 8049. Listens on `0.0.0.0`.                                        |
| `VIADUKT_URL`    | Default `https://jibes.github.io/swiss-rail-routes/`, for links.           |

- `POST /mcp` with `Authorization: Bearer <key>`: MCP, stateless Streamable HTTP. A wrong or missing key gets 401, compared in constant time. With a right key, other methods get 405 (what MCP clients expect of a server without sessions).
- `POST /mcp/<key>` still works for clients that cannot send a header, and is deprecated: a path ends up in the reverse proxy's access log and in clients' own logs. The proxy must not log request paths for this location (nginx: `access_log off;` in its `location`; Caddy: no `log` for the site, or a format without the URI) while any client uses it. Each request logs `{"key":"<id>","via":"header"|"path"}`: once no key comes by path, the path form can go.
- `GET /healthz`: 200, without calling the Worker.

Older clients: every protocol version the SDK supports works over Streamable HTTP. The old HTTP+SSE transport (a GET stream, 2024-11-05) does not, as it needs state between requests.

## API keys

One key per client (Claude, a tester, a script), so each is revoked on its own and a key that leaked costs only that client. A key is `vk_<id>_<secret>`; `keys.json` holds its id, label, creation day and the SHA-256 of the key, never the key. The server reads the file again when it changes: a key created or revoked counts at the next request, without a restart. In the container:

```bash
docker compose exec viadukt-mcp node server.mjs key create claude   # prints the key, once
docker compose exec viadukt-mcp node server.mjs key list            # id, day, label
docker compose exec viadukt-mcp node server.mjs key revoke claude   # by label or id
```

From `MCP_SECRET`: create a key for each client, put it in the client's settings (`Authorization: Bearer <key>`), then remove `MCP_SECRET` from the environment and restart. The log line `{"key":"legacy",…}` says whether anything still uses it. OAuth is left out: it needs a login and an authorization server for one user's clients, and a key per client already gives revoking per client.

## Limits, and why

- **Worker calls, not plans:** the Worker allows 120 uncached calls a minute per IP, and all traffic here shares one IP. `CallBudget` (`src/worker.ts`) spends 100 a minute, in order, and refuses past a 20 s wait. A 429 or 503 is retried when the wait is short, else a clear "busy, try again in N s".
- **Plans at once:** 4; more are asked to wait.
- **Time:** a call waits at most 45 s for a plan, then answers `still_planning` while it finishes in the background. The same arguments then get that plan. The MCP SDK's client gives up after 60 s by default. Measured for a cold Bernina plan: 17–29 s.
- **Memory:** tracks are 90 % of OJP's answers and are dropped while they download. Under `--max-old-space-size=96`, four plans at once peaked at 204 MB of the container's 256 MB. Measured on macOS, not yet in the container.
- **Cache:** answers in memory, 15 minutes on the travel day, until the day starts for a later one, at most 300. Never written to disk.
- **Logs:** tool names, outcomes and timings only. Never a path, the secret or a route.

## Build the bundle

```bash
npm run mcp:bundle
```

From a clean tree, it writes `mcp/dist/viadukt-mcp-<commit>.tar.gz` and its SHA-256. It holds `viadukt-mcp-docker/src/`: `Dockerfile`, `server.mjs` (the app's core and data bundled in), `stops.v1.json`, `package.json`, the pinned `package-lock.json` and `REVISION`. Its dependencies must stay in step with the root `package.json`.

The container must work with a read-only root, `/tmp` as a 16 MB tmpfs, all capabilities dropped, no-new-privileges, 256 MB, 128 pids and one volume: a directory for `keys.json` at `/app/keys`, writable by the image's `node` user (uid 1000), which it runs as.

## What to check after deploying

1. `/healthz` answers 200 from inside the container, and `/mcp/wrong` answers 404. The start's log line says how many keys it found (`{"keys":1,"legacy":true}`).
2. Under the real limits it starts and stays up: the memory peak in the table above has only been measured outside a container.
3. A real plan works from the VPS (it depends on the Worker from that IP): from Claude, "Bernina line from Zürich next Saturday, 2 h in Tirano, back by 21:00" returns a checked plan with GA cover and a Viadukt link, and `train_status` answers for a train in it.
4. The log holds only key ids, counts and timings, never a key.

## Open

- `check_trip` from the spec is left for later.
- The OJP key's quota is still open in `docs/SPEC.md`.
- Claude's own tool-call timeout is not documented. Whether it calls again on `still_planning` needs trying on a real device.
