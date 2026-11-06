/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import { handle } from './handler';
import { syncHandle, type SyncRecord } from './sync';

interface Env {
  OJP_API_KEY: string;
  OJP_URL: string;
  /** OJP Fare's key (a Worker secret) and address. */
  OJP_FARE_API_KEY?: string;
  OJP_FARE_URL: string;
  TRANSITOUS_URL: string;
  ALLOWED_ORIGINS: string;
  LIMIT: RateLimit;
  WRITES: RateLimit;
  SYNC: DurableObjectNamespace<SyncBox>;
}

/** Boxes nobody wrote to for this long are deleted (a lost key, an abandoned device). */
const KEEP_MS = 180 * 86_400_000;

/**
 * One sync id's blob. Storage calls are serialised by the Durable Object's input gates; the
 * version check and write in syncHandle await nothing else in between, so it holds.
 */
export class SyncBox extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const s = this.ctx.storage;
    return syncHandle(req, {
      get: () => s.get<SyncRecord>('r'),
      put: async (r) => {
        await s.put('r', r);
        // A closed box's marker stays for good (tiny): a device on the old key that comes
        // back later must still be told, not fill it again.
        if (r.revoked) await s.deleteAlarm();
        else await s.setAlarm(Date.now() + KEEP_MS);
      },
      // Read daily by its devices: keep it (moved on at most once a day).
      touch: async () => {
        const due = await s.getAlarm();
        if (!due || due < Date.now() + KEEP_MS - 86_400_000) await s.setAlarm(Date.now() + KEEP_MS);
      },
    });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(req, {
      apiKey: env.OJP_API_KEY ?? '',
      upstream: env.OJP_URL,
      fareKey: env.OJP_FARE_API_KEY,
      fareUpstream: env.OJP_FARE_URL,
      transitous: env.TRANSITOUS_URL,
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
      fetch: (...a) => fetch(...a),
      cache: caches.default,
      limit: async (key) => (await env.LIMIT.limit({ key })).success,
      limitWrite: async (key) => (await env.WRITES.limit({ key })).success,
      now: () => new Date(),
      defer: (p) => ctx.waitUntil(p),
      sync: (id, r) => env.SYNC.get(env.SYNC.idFromName(id)).fetch(r),
    });
  },
} satisfies ExportedHandler<Env>;
