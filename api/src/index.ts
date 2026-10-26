import { TEMPLATE_SCHEMA_VERSION } from '@override-studio/shared';

interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        ok: true,
        phase: 0,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        db: Boolean(env.DB),
      });
    }

    if (url.pathname === '/api/templates' && request.method === 'GET') {
      if (!env.DB) return json({ error: 'database unavailable' }, 503);
      const { results } = await env.DB.prepare(
        'SELECT id, name, schema_version, source, prompt, created_at FROM templates ORDER BY created_at DESC',
      ).all();
      return json({ templates: results ?? [] });
    }

    return json({ error: 'not found' }, 404);
  },
};
