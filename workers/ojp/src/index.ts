/// <reference types="@cloudflare/workers-types" />
import { handle } from './handler';

interface Env {
  OJP_API_KEY: string;
  OJP_URL: string;
  ALLOWED_ORIGINS: string;
  LIMIT: RateLimit;
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
    });
  },
} satisfies ExportedHandler<Env>;
