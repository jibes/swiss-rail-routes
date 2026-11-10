// Stateless Streamable HTTP: a new server and transport for each request, so nothing about one
// request is left for the next. An API key is the access control (a bearer token, `keys.ts`): its id
// is logged, never the key, nor any path. Logs hold key ids, tool names, outcomes and timings only.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { LANGS } from '../../src/i18n';
import type { KeyCheck } from './keys';
import { MAX_STOPS, ToolError } from './route';
import type { Tools } from './tools';
import { BusyError, UnavailableError } from './worker';

const MAX_BODY = 256 * 1024;
/** While a plan runs: keeps the stream alive, and clients that listen know it is working. */
const HEARTBEAT_MS = 10_000;

/**
 * Names callers have used for a parameter that is called otherwise here (retest, 5 Nov 2026):
 * an unknown key is refused, never dropped, so a constraint asked for is never silently not applied.
 */
const MEANT: Record<string, string> = {
  return: 'returnWay',
  returnMode: 'returnWay',
  openUntil: 'leaveBy',
  until: 'stayUntil',
  stayTill: 'stayUntil',
  closesAt: 'leaveBy',
  openFrom: 'arriveAfter',
  opensAt: 'arriveAfter',
  depart: 'departAt',
  arrive: 'arriveBy',
  count: 'options',
  q: 'query',
  station: 'name',
  dwell: 'stay',
};

/** An object that refuses keys it does not have, saying which and what was meant. */
function strictOf<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: (iss) => {
      if (iss.code !== 'unrecognized_keys') return undefined;
      return iss.keys
        .map((k) => {
          const meant = MEANT[k];
          return meant && meant in shape
            ? `unknown parameter \`${k}\`; use \`${meant}\``
            : `unknown parameter \`${k}\`; known: ${Object.keys(shape).join(', ')}`;
        })
        .join('. ');
    },
  });
}

const lang = z.enum(LANGS).optional().describe('Language of warnings and notes. Default en.');
const ticket = z
  .enum(['GA', 'Tageskarte', 'Halbtax', 'none'])
  .optional()
  .describe('The ticket held. Default GA.');
const reservations = z
  .enum(['avoid', 'include', 'never'])
  .optional()
  .describe(
    'Reservation-only trains: avoid when a regular train runs (default), include, or never.',
  );
const date = z
  .string()
  .optional()
  .describe(
    'YYYY-MM-DD, Zurich. Default today; up to 14 days back (a trip already taken), as far as the timetable answers.',
  );
const stops = z
  .array(
    strictOf({
      ref: z
        .string()
        .max(200)
        .optional()
        .describe('Stop id from find_stops; a station abroad (eu:…) with its name too.'),
      name: z.string().optional().describe('Station name, if no ref.'),
      stay: z
        .number()
        .min(0)
        .max(1440)
        .optional()
        .describe('Minutes to get off for. 0 or left out: ride through, or change as needed.'),
      line: z
        .string()
        .optional()
        .describe(
          'A scenic line id from list_scenic_lines, instead of a station. Runs in the direction that continues the route.',
        ),
      leaveBy: z
        .string()
        .optional()
        .describe(
          'HH:MM, Zurich: leave this stop by then (it closes). Options that cannot are kept only when none can, with a window-missed error.',
        ),
      arriveAfter: z
        .string()
        .optional()
        .describe('HH:MM, Zurich: not there before then (it opens); the stay starts then.'),
      stayUntil: z
        .string()
        .optional()
        .describe(
          'YYYY-MM-DDTHH:MM, Zurich: stay until then, also on a later day (a night or more there); the next train leaves no earlier. Makes the stop a stay (30 min when stay is left out).',
        ),
    }),
  )
  .min(1)
  .max(MAX_STOPS)
  .describe('The route in order: stations and scenic lines.');
const roundTrip = z.boolean().optional().describe('Return to the first station.');

const fail = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

function build(tools: Tools, log: (line: object) => void) {
  const server = new McpServer({ name: 'viadukt', version: '1' });
  const answer = async <T>(tool: string, run: () => T | Promise<T>) => {
    const t0 = performance.now();
    let outcome = 'ok';
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await run()) }] };
    } catch (e) {
      // Said as they are only when they are ours: anything else may hold what it should not.
      if (e instanceof ToolError) outcome = 'refused';
      else if (e instanceof BusyError) outcome = 'busy';
      else if (e instanceof UnavailableError) outcome = 'unavailable';
      else {
        log({ tool, outcome: 'error', kind: e instanceof Error ? e.name : 'unknown' });
        return fail('internal error');
      }
      return fail((e as Error).message);
    } finally {
      log({ tool, outcome, ms: Math.round(performance.now() - t0) });
    }
  };
  /** Runs `run`, telling a client that asked for progress that it is still going. */
  const withBeat = async <T>(
    extra: {
      _meta?: { progressToken?: string | number };
      sendNotification: (n: never) => Promise<void>;
    },
    run: () => Promise<T>,
  ) => {
    const token = extra._meta?.progressToken;
    let n = 0;
    const beat =
      token === undefined
        ? undefined
        : setInterval(() => {
            void extra
              .sendNotification({
                method: 'notifications/progress',
                params: { progressToken: token, progress: ++n, message: 'planning' },
              } as never)
              .catch(() => undefined);
          }, HEARTBEAT_MS);
    try {
      return await run();
    } finally {
      clearInterval(beat);
    }
  };
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

  server.registerTool(
    'find_stops',
    {
      description:
        "Finds Swiss stations and stops by name (also by a city's name in another language: Genf, Ginevra; one typo per word is forgiven), and well-known places people go to by train (Swissminiatur, Rhine Falls, Chillon Castle…) as `places`: each with its nearest stops and an estimated walk in minutes (straight-line distance, not a route). Stations abroad (München Hbf, Milano Centrale, Lyon Part-Dieu…) with `abroad: true`, as `abroad`: from Transitous, a community-run European timetable; give one to plan_trip by its ref and name. A leg to or from one is planned by Transitous: no live data, no GA beyond the border (said as not-ga).",
      inputSchema: strictOf({
        query: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Text, e.g. "Bern", "Kleine Sch", "Rheinfall". Or give near instead.'),
        near: strictOf({
          lat: z.number().min(45).max(48.5),
          lon: z.number().min(5.5).max(11),
          km: z
            .number()
            .min(1)
            .max(200)
            .optional()
            .describe(
              'The width of the area looked at, default 20: stations within a tenth of it, bus stops within a third of that.',
            ),
          buses: z
            .boolean()
            .optional()
            .describe('Bus and tram stops too, close by. Default false.'),
        })
          .optional()
          .describe(
            'Stops around a point instead of by name, nearest first: stations, then bus stops.',
          ),
        limit: z.number().int().min(1).max(50).optional().describe('Default 8 (5 with near).'),
        lang: z.enum(['en', 'de', 'fr', 'it']).optional().describe('Language of place names.'),
        abroad: z
          .boolean()
          .optional()
          .describe(
            'Also stations abroad by this name (one request to Transitous). Default false.',
          ),
      }),
      annotations: { ...readOnly, openWorldHint: false },
    },
    (a) => answer('find_stops', () => tools.findStops(a)),
  );
  server.registerTool(
    'list_scenic_lines',
    {
      description:
        'The curated scenic lines (Bernina, Albula, Lake Lucerne…): their ids, ends, the stations they must pass, allowedModes (modes a plan may use on the line, replacement buses included), seasons, and the named trains that run on them (products). A query also finds a line by a named train ("Glacier Express"), with `products` saying which of the lines are on its route.',
      inputSchema: strictOf({
        query: z
          .string()
          .max(80)
          .optional()
          .describe('Filters by line, named train (Glacier Express) or station name.'),
        lang,
      }),
      annotations: { ...readOnly, openWorldHint: false },
    },
    (a) => answer('list_scenic_lines', () => tools.listScenicLines(a)),
  );
  server.registerTool(
    'plan_trip',
    {
      description:
        'Plans a Swiss rail day trip as one checked timetable (each ride\'s from/to has a source: yours, listed; line, a scenic line\'s station; plan, where the plan changes or stops; list a plan station as a stop to keep it fixed): stays, scenic lines, GA and day-pass cover, reservation-only trains, disruptions and tight changes. Returns up to 3 options in departure order, the recommended one marked (with options: 1, the recommended one unless pick is "earliest"), and links that open them in the Viadukt app; the top-level link and notReached are the recommended option\'s. A scenic line that cannot be ridden at that time is said as a line-missed error warning (or, with strict, status "line_not_ridden", no options and the reason). Out and back: list the stations, e.g. St. Moritz → Alp Grüm (stay) → Pontresina; a line can be ridden part way by naming its stations instead of the line. If it answers status "still_planning", call it again with exactly the same arguments.',
      inputSchema: strictOf({
        date,
        departAt: z
          .string()
          .optional()
          .describe(
            'HH:MM, Zurich. Default: the next 5 minutes today, else 08:00; a time gone today is a trip already under way. Not with arriveBy.',
          ),
        arriveBy: z.string().optional().describe('HH:MM, Zurich: back or there by then.'),
        stops,
        roundTrip,
        ticket,
        options: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe('How many alternatives. Default 3.'),
        pick: z
          .enum(['recommended', 'earliest'])
          .optional()
          .describe(
            'With fewer options than found: the recommended one (default) or the first to leave.',
          ),
        strict: z
          .boolean()
          .optional()
          .describe(
            'A scenic line asked for that cannot be ridden (closed, no service): answer no options and the reason instead of another way.',
          ),
        daylight: z
          .enum(['preferred', 'required'])
          .optional()
          .describe(
            'Scenic lines by daylight: preferred (default; an option riding a line after sunset is said, line-after-dark, and ranked behind) or required (such options left out; status "after_dark" with the reason when none is left).',
          ),
        returnWay: z
          .enum(['as_listed', 'fastest', 'same_way'])
          .optional()
          .describe(
            'With roundTrip: as_listed (default) rides back only by the stations and lines you list, and with nothing listed for the way back the fastest; fastest goes straight home after the last stay (scenic out, fast back); same_way rides the way out reversed, its lines included, without its stays.',
          ),
        reservations,
        lang,
      }),
      annotations: readOnly,
    },
    (a, extra) => withBeat(extra as never, () => answer('plan_trip', () => tools.planTrip(a))),
  );
  server.registerTool(
    'more_options',
    {
      description:
        'Earlier or later connections for a plan from plan_trip, without starting over. Same route arguments; never one that has already left. If it answers status "still_planning", call it again with exactly the same arguments.',
      inputSchema: strictOf({
        date,
        stops,
        roundTrip,
        returnWay: z
          .enum(['as_listed', 'fastest', 'same_way'])
          .optional()
          .describe('As in plan_trip.'),
        ticket,
        direction: z.enum(['earlier', 'later']),
        from: z
          .string()
          .describe('HH:MM, Zurich: the time to search from, usually an option’s departure.'),
        reservations,
        lang,
      }),
      annotations: readOnly,
    },
    (a, extra) =>
      withBeat(extra as never, () => answer('more_options', () => tools.moreOptions(a))),
  );
  server.registerTool(
    'reachable_from',
    {
      description:
        'Where the trains from one stop go without a change: every place reached within 3 hours of the time asked, each with its earliest arrival and the train (line, departure, towards). For "where can I get to directly from Interlaken at 10:00?". Places named in estimateFor that no direct train reaches get an estimate in minutes and where to change (about, not a timetable; plan_trip gives the exact connection).',
      inputSchema: strictOf({
        stop: strictOf({ name: z.string().max(80).optional(), ref: z.string().max(80).optional() }),
        date,
        time: z
          .string()
          .optional()
          .describe('HH:MM, Zurich. Default: the next 5 minutes today, else 08:00.'),
        estimateFor: z
          .array(z.string().max(80))
          .max(10)
          .optional()
          .describe('Places to estimate, e.g. ["Zermatt", "Lugano"].'),
      }),
      annotations: readOnly,
    },
    (a) => answer('reachable_from', () => tools.reachableFrom(a)),
  );
  server.registerTool(
    'train_status',
    {
      description:
        'Live status of one train: every stop with planned and expected times, delay, platform and platform changes, cancelled or not-served stops, and operator notices.',
      inputSchema: strictOf({
        journey: z.string().max(120).describe('The `journey` of a ride in a plan.'),
        date: date.describe('YYYY-MM-DD. Not needed for a journey from a plan.'),
      }),
      annotations: readOnly,
    },
    (a) => answer('train_status', () => tools.trainStatus(a)),
  );
  return server;
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createHttpServer(o: {
  keys: KeyCheck;
  tools: Tools;
  log?: (line: object) => void;
}): Server {
  const log = o.log ?? ((line: object) => console.log(JSON.stringify(line)));

  return createServer((req, res) => {
    const end = (status: number, headers: Record<string, string> = {}) => {
      res.writeHead(status, headers);
      res.end();
    };
    void (async () => {
      const path = (req.url ?? '').split('?')[0]!;
      if (path === '/healthz') {
        if (req.method !== 'GET') return end(405);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return void res.end('ok');
      }
      // The key as a bearer token on /mcp. In the path (/mcp/<key>) still works, but proxies
      // and clients log paths: deprecated. Which form each key uses is logged, so the path form
      // can go once no key uses it.
      let key: string | null;
      let via: 'header' | 'path';
      if (path === '/mcp' || path === '/mcp/') {
        const auth = req.headers.authorization ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        key = token ? o.keys(token) : null;
        via = 'header';
        if (!key) return end(401, { 'WWW-Authenticate': 'Bearer' });
      } else {
        const given = path.startsWith('/mcp/') ? decodeSafe(path.slice(5)) : null;
        key = given === null ? null : o.keys(given);
        via = 'path';
        if (!key) return end(404);
      }
      // Stateless: no session to resume or end. MCP clients expect this answer to a GET.
      if (req.method !== 'POST') return end(405, { Allow: 'POST' });
      log({ key, via });
      const body = await readBody(req);
      if (!body) return end(413);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        return end(400);
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = build(o.tools, log);
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    })().catch((e: unknown) => {
      log({ outcome: 'http-error', kind: e instanceof Error ? e.name : 'unknown' });
      if (!res.headersSent) end(500);
      else res.end();
    });
  });
}

function decodeSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
