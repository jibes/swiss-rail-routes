// Stateless Streamable HTTP: a new server and transport for each request, so nothing about one
// request is left for the next. The secret is the access control (a bearer token): compared in constant time,
// and never logged, nor is any path. Logs hold tool names, outcomes and timings only.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { LANGS } from '../../src/i18n';
import { MAX_STOPS, ToolError } from './route';
import type { Tools } from './tools';
import { BusyError, UnavailableError } from './worker';

const MAX_BODY = 256 * 1024;
/** While a plan runs: keeps the stream alive, and clients that listen know it is working. */
const HEARTBEAT_MS = 10_000;

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
const date = z.string().optional().describe('YYYY-MM-DD, Zurich. Default today.');
const stops = z
  .array(
    z.object({
      ref: z.string().optional().describe('Stop id from find_stops.'),
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
      description: 'Finds Swiss stations and stops by name.',
      inputSchema: {
        query: z.string().min(1).max(80).describe('Text, e.g. "Bern", "Kleine Sch".'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 8.'),
      },
      annotations: { ...readOnly, openWorldHint: false },
    },
    (a) => answer('find_stops', () => tools.findStops(a)),
  );
  server.registerTool(
    'list_scenic_lines',
    {
      description:
        'The curated scenic lines (Bernina, Albula, Lake Lucerne…): their ids, ends, the stations they must pass, modes and seasons.',
      inputSchema: {
        query: z.string().max(80).optional().describe('Filters by line or station name.'),
        lang,
      },
      annotations: { ...readOnly, openWorldHint: false },
    },
    (a) => answer('list_scenic_lines', () => tools.listScenicLines(a)),
  );
  server.registerTool(
    'plan_trip',
    {
      description:
        'Plans a Swiss rail day trip as one checked timetable: stays, scenic lines, GA and day-pass cover, reservation-only trains, disruptions and tight changes. Returns up to 3 options, the recommended one marked, and links that open them in the Viadukt app. If it answers status "still_planning", call it again with exactly the same arguments.',
      inputSchema: {
        date,
        departAt: z
          .string()
          .optional()
          .describe(
            'HH:MM, Zurich. Default: the next 5 minutes today, else 08:00. Not with arriveBy.',
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
        reservations,
        lang,
      },
      annotations: readOnly,
    },
    (a, extra) => withBeat(extra as never, () => answer('plan_trip', () => tools.planTrip(a))),
  );
  server.registerTool(
    'more_options',
    {
      description:
        'Earlier or later connections for a plan from plan_trip, without starting over. Same route arguments; never one that has already left. If it answers status "still_planning", call it again with exactly the same arguments.',
      inputSchema: {
        date,
        stops,
        roundTrip,
        ticket,
        direction: z.enum(['earlier', 'later']),
        from: z
          .string()
          .describe('HH:MM, Zurich: the time to search from, usually an option’s departure.'),
        reservations,
        lang,
      },
      annotations: readOnly,
    },
    (a, extra) =>
      withBeat(extra as never, () => answer('more_options', () => tools.moreOptions(a))),
  );
  server.registerTool(
    'train_status',
    {
      description:
        'Live status of one train: every stop with planned and expected times, delay, platform and platform changes, cancelled or not-served stops, and operator notices.',
      inputSchema: {
        journey: z.string().max(120).describe('The `journey` of a ride in a plan.'),
        date: date.describe('YYYY-MM-DD. Not needed for a journey from a plan.'),
      },
      annotations: readOnly,
    },
    (a) => answer('train_status', () => tools.trainStatus(a)),
  );
  return server;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

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
  secret: string;
  tools: Tools;
  log?: (line: object) => void;
}): Server {
  const log = o.log ?? ((line: object) => console.log(JSON.stringify(line)));
  const want = digest(o.secret);
  const isSecret = (given: string) => timingSafeEqual(digest(given), want);

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
      // The secret as a bearer token on /mcp. In the path (/mcp/<secret>) still works, but
      // proxies and clients log paths: deprecated.
      if (path === '/mcp' || path === '/mcp/') {
        const auth = req.headers.authorization ?? '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (!token || !isSecret(token)) return end(401, { 'WWW-Authenticate': 'Bearer' });
      } else {
        const given = path.startsWith('/mcp/') ? decodeSafe(path.slice(5)) : null;
        if (given === null || !isSecret(given)) return end(404);
      }
      // Stateless: no session to resume or end. MCP clients expect this answer to a GET.
      if (req.method !== 'POST') return end(405, { Allow: 'POST' });
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
