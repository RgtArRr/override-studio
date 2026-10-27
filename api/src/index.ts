import { TEMPLATE_SCHEMA_VERSION, parseTemplateJson } from '@override-studio/shared';
import {
  SESSION_MAX_AGE,
  buildSessionCookie,
  getSessionUser,
  handleAuth,
  webOrigins,
  type AuthEnv,
} from './auth.js';
import {
  dummyVerify,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from './password.js';
import {
  deleteApiKey,
  getStreams as getIcuStreams,
  listActivities as listIcuActivities,
  readApiKey,
  storeApiKey,
  validateKey,
} from './intervals.js';

interface Env extends AuthEnv {
  DB: D1Database;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * Cross-origin SPA support: the web app fetches with credentials from
 * WEB_ORIGIN. Auth.js navigations ignore these headers harmlessly.
 */
function withCors(res: Response, request: Request, env: Env): Response {
  const origin = request.headers.get('origin') ?? '';
  if (!webOrigins(env).includes(origin)) return res;
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.append('Vary', 'Origin');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body === 'object' && body !== null) return body as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const send = (res: Response): Response => withCors(res, request, env);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return send(
        new Response(null, {
          headers: {
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        }),
      );
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return send(
        json({
          ok: true,
          phase: 0,
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          db: Boolean(env.DB),
        }),
      );
    }

    if (url.pathname === '/api/templates' && request.method === 'GET') {
      if (!env.DB) return send(json({ error: 'database unavailable' }, 503));
      const { results } = await env.DB.prepare(
        'SELECT id, name, schema_version, source, prompt, created_at FROM templates ORDER BY created_at DESC',
      ).all();
      return send(json({ templates: results ?? [] }));
    }

    if (url.pathname.startsWith('/api/auth/')) {
      try {
        return send(await handleAuth(request, env));
      } catch (err) {
        // Missing AUTH_SECRET et al: log it and answer JSON (with CORS) so
        // the browser shows the real error instead of opaque CORS noise.
        console.error('[auth]', err);
        return send(json({ error: 'auth' }, 500));
      }
    }

    if (url.pathname === '/api/me' && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      return send(json({ user }));
    }

    /** Classic credentials: session row + cookie shaped like Auth.js's. */
    const startSession = async (userId: string): Promise<string> => {
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
      await env.DB.prepare(
        'INSERT INTO sessions (id, sessionToken, userId, expires) VALUES (?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), token, userId, expires)
        .run();
      return token;
    };
    const loggedIn = async (
      user: { id: string; name: string | null; email: string | null; image: string | null },
    ): Promise<Response> => {
      const token = await startSession(user.id);
      const res = json({ user });
      res.headers.append('Set-Cookie', buildSessionCookie(env, token));
      return send(res);
    };

    if (url.pathname === '/api/register' && request.method === 'POST') {
      const body = await readJson(request);
      const email = normalizeEmail(body?.['email']);
      if (!email) return send(json({ error: 'email' }, 400));
      if (validatePassword(body?.['password'])) return send(json({ error: 'weak' }, 400));
      const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
        .bind(email)
        .first();
      if (taken) return send(json({ error: 'taken' }, 409));
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(body?.['password'] as string);
      await env.DB.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(id, email.split('@')[0], email, passwordHash)
        .run();
      return loggedIn({ id, name: email.split('@')[0], email, image: null });
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await readJson(request);
      const email = normalizeEmail(body?.['email']);
      const password = typeof body?.['password'] === 'string' ? body['password'] : '';
      const row = email
        ? await env.DB.prepare('SELECT id, name, email, image, password_hash FROM users WHERE email = ?')
            .bind(email)
            .first<Record<string, unknown>>()
        : null;
      const stored = typeof row?.['password_hash'] === 'string' ? row['password_hash'] : null;
      // Same error and same work whether the email exists or not.
      const okUser = stored ? await verifyPassword(password, stored) : await dummyVerify().then(() => false);
      if (!row || !okUser) return send(json({ error: 'invalid' }, 401));
      return loggedIn({
        id: row['id'] as string,
        name: (row['name'] as string | null) ?? null,
        email: (row['email'] as string | null) ?? null,
        image: (row['image'] as string | null) ?? null,
      });
    }

    if (url.pathname === '/api/intervals/status' && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      return send(json({ connected: (await readApiKey(env, user.id)) !== null }));
    }

    if (url.pathname === '/api/intervals/key' && request.method === 'PUT') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      const body = await readJson(request);
      const apiKey = typeof body?.['apiKey'] === 'string' ? body['apiKey'].trim() : '';
      if (!apiKey || apiKey.length > 128) return send(json({ error: 'intervals_key' }, 400));
      if (!(await validateKey(apiKey))) return send(json({ error: 'intervals_key' }, 400));
      await storeApiKey(env, user.id, apiKey);
      return send(json({ ok: true }));
    }

    if (url.pathname === '/api/intervals/key' && request.method === 'DELETE') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      await deleteApiKey(env, user.id);
      return send(json({ ok: true }));
    }

    if (url.pathname === '/api/intervals/activities' && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      const key = await readApiKey(env, user.id);
      if (!key) return send(json({ error: 'intervals_reconnect' }, 401));
      const page = Math.min(12, Math.max(1, Number(url.searchParams.get('page')) || 1));
      const res = await listIcuActivities(key, page);
      if (!res.ok) {
        return res.auth
          ? send(json({ error: 'intervals_reconnect' }, 401))
          : send(json({ error: 'intervals' }, 502));
      }
      return send(json({ activities: res.data }));
    }

    const icuStreamsMatch = /^\/api\/intervals\/activities\/([A-Za-z0-9_-]+)\/streams$/.exec(
      url.pathname,
    );
    if (icuStreamsMatch && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      const key = await readApiKey(env, user.id);
      if (!key) return send(json({ error: 'intervals_reconnect' }, 401));
      const res = await getIcuStreams(key, icuStreamsMatch[1]);
      if (!res.ok) {
        return res.auth
          ? send(json({ error: 'intervals_reconnect' }, 401))
          : send(json({ error: 'intervals' }, 502));
      }
      return send(json({ streams: res.data }));
    }

    if (url.pathname === '/api/my/templates' && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      const { results } = await env.DB.prepare(
        'SELECT id, name, definition, schema_version, updated_at FROM user_templates WHERE user_id = ? ORDER BY updated_at DESC',
      )
        .bind(user.id)
        .all<Record<string, unknown>>();
      const templates = [];
      for (const row of results ?? []) {
        try {
          templates.push({
            id: row['id'],
            name: row['name'],
            definition: JSON.parse(row['definition'] as string),
            updatedAt: row['updated_at'],
          });
        } catch {
          /* skip corrupt rows; writes are validated, so this is belt-and-braces */
        }
      }
      return send(json({ templates }));
    }

    if (url.pathname === '/api/my/templates' && request.method === 'POST') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      const body = await readJson(request);
      const name = typeof body?.['name'] === 'string' ? body['name'].trim().slice(0, 60) : '';
      if (!name) return send(json({ error: 'name required' }, 400));
      let definition: string;
      try {
        const parsed = parseTemplateJson(JSON.stringify(body?.['definition']));
        definition = JSON.stringify(parsed);
      } catch {
        return send(json({ error: 'invalid template' }, 400));
      }
      const rawId = body?.['id'];
      const id =
        typeof rawId === 'string' && ID_RE.test(rawId) ? rawId : crypto.randomUUID();
      const existing = await env.DB.prepare('SELECT user_id FROM user_templates WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      if (existing && existing['user_id'] !== user.id) {
        return send(json({ error: 'id taken' }, 409));
      }
      if (existing) {
        await env.DB.prepare(
          `UPDATE user_templates SET name = ?, definition = ?, updated_at = ${NOW} WHERE id = ?`,
        )
          .bind(name, definition, id)
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO user_templates (id, user_id, name, definition, schema_version) VALUES (?, ?, ?, ?, ${TEMPLATE_SCHEMA_VERSION})`,
        )
          .bind(id, user.id, name, definition)
          .run();
      }
      return send(json({ id }));
    }

    const itemMatch = /^\/api\/my\/templates\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (itemMatch && (request.method === 'PUT' || request.method === 'DELETE')) {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      const id = itemMatch[1];
      const existing = await env.DB.prepare('SELECT user_id FROM user_templates WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      if (!existing || existing['user_id'] !== user.id) {
        return send(json({ error: 'not found' }, 404));
      }
      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM user_templates WHERE id = ?').bind(id).run();
        return send(json({ ok: true }));
      }
      const body = await readJson(request);
      const sets: string[] = [];
      const binds: unknown[] = [];
      if (body?.['name'] !== undefined) {
        const name =
          typeof body['name'] === 'string' ? body['name'].trim().slice(0, 60) : '';
        if (!name) return send(json({ error: 'name required' }, 400));
        sets.push('name = ?');
        binds.push(name);
      }
      if (body?.['definition'] !== undefined) {
        try {
          const parsed = parseTemplateJson(JSON.stringify(body['definition']));
          sets.push('definition = ?');
          binds.push(JSON.stringify(parsed));
        } catch {
          return send(json({ error: 'invalid template' }, 400));
        }
      }
      if (sets.length === 0) return send(json({ error: 'nothing to update' }, 400));
      sets.push(`updated_at = ${NOW}`);
      binds.push(id);
      await env.DB.prepare(`UPDATE user_templates SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...binds)
        .run();
      return send(json({ ok: true }));
    }

    return send(json({ error: 'not found' }, 404));
  },
};
