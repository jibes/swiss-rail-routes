/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import { handle } from './handler';
import { syncHandle, type SyncRecord } from './sync';

interface Env {
  OJP_API_KEY: string;
  OJP_URL: string;
  ALLOWED_ORIGINS: string;
  LIMIT: RateLimit;
  SYNC: DurableObjectNamespace<SyncBox>;
}

/** One sync id's blob. A Durable Object runs one request at a time, so the version check holds. */
export class SyncBox extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const s = this.ctx.storage;
    return syncHandle(req, {
      get: () => s.get<SyncRecord>('r'),
      put: (r) => s.put('r', r),
      delete: () => s.deleteAll(),
    });
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(req, {
      apiKey: env.OJP_API_KEY ?? '',
      upstream: env.OJP_URL,
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
      fetch: (...a) => fetch(...a),
      cache: caches.default,
      limit: async (key) => (await env.LIMIT.limit({ key })).success,
      now: () => new Date(),
      defer: (p) => ctx.waitUntil(p),
      sync: (id, r) => env.SYNC.get(env.SYNC.idFromName(id)).fetch(r),
    });
  },
} satisfies ExportedHandler<Env>;
