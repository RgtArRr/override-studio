import { TEMPLATE_SCHEMA_VERSION, parseTemplateJson } from '@velohud/shared';
import {
  SESSION_MAX_AGE,
  buildSessionCookie,
  deleteSession,
  expireSessionCookie,
  getSessionUser,
  handleAuth,
  webOrigins,
  type AuthEnv,
} from './auth.js';
import {
  dummyVerify,
  hashPassword,
  needsRehash,
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

/**
 * Mutations arrive as credentialed cross-origin JSON (preflighted), so an
 * explicit allow-list check closes CSRF beyond the preflight. Requests
 * without Origin (same-origin, curl) pass through.
 */
const assertOrigin = (request: Request, env: Env): boolean => {
  const origin = request.headers.get('origin');
  return !origin || webOrigins(env).includes(origin);
};

/** 20 auth attempts per IP per 10 minutes. Absent IP (local dev) skips. */
const AUTH_WINDOW_SEC = 600;
const AUTH_MAX_ATTEMPTS = 20;

async function authThrottled(
  env: Env,
  request: Request,
): Promise<{ throttled: boolean; retryAfter: number }> {
  const ip = request.headers.get('cf-connecting-ip')?.trim();
  if (!ip) return { throttled: false, retryAfter: 0 };
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM auth_attempts WHERE reset_at < ?').bind(now).run();
  const row = await env.DB.prepare('SELECT count, reset_at FROM auth_attempts WHERE ip = ?')
    .bind(ip)
    .first<Record<string, unknown>>();
  const count = typeof row?.['count'] === 'number' ? row['count'] : 0;
  const reset = typeof row?.['reset_at'] === 'number' ? row['reset_at'] : 0;
  if (row && now < reset && count >= AUTH_MAX_ATTEMPTS) {
    return { throttled: true, retryAfter: reset - now };
  }
  const fresh = !row || now >= reset;
  await env.DB.prepare(
    'INSERT INTO auth_attempts (ip, count, reset_at) VALUES (?, ?, ?) ON CONFLICT (ip) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at',
  )
    .bind(ip, fresh ? 1 : count + 1, fresh ? now + AUTH_WINDOW_SEC : reset)
    .run();
  return { throttled: false, retryAfter: 0 };
}

const throttleResponse = (retryAfter: number): Response => {
  const res = json({ error: 'rate' }, 429);
  res.headers.set('Retry-After', String(retryAfter));
  return res;
};

const icuFailure = (res: { auth: boolean; status: number; retryAfter: string | null }): Response => {
  if (res.auth) return json({ error: 'intervals_reconnect' }, 401);
  if (res.status === 429) {
    const out = json({ error: 'intervals' }, 429);
    if (res.retryAfter) out.headers.set('Retry-After', res.retryAfter);
    return out;
  }
  return json({ error: 'intervals' }, 502);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const send = (res: Response): Response => withCors(res, request, env);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return send(
        new Response(null, {
          headers: {
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    // Every route below touches D1 (directly or via Auth.js): fail fast when unbound.
    if (!env.DB) return send(json({ error: 'database unavailable' }, 503));

    // Reserved: public template catalog for future API consumers. The web app
    // ships built-ins plus /api/my/templates and never calls this.
    if (url.pathname === '/api/templates' && request.method === 'GET') {
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

    // Session probe for the web app (cookie or bearer) and future API consumers.
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
      const res = json({ user, token });
      res.headers.append('Set-Cookie', buildSessionCookie(env, token));
      return send(res);
    };

    if (url.pathname === '/api/register' && request.method === 'POST') {
      if (!assertOrigin(request, env)) return send(json({ error: 'origin' }, 403));
      const limited = await authThrottled(env, request);
      if (limited.throttled) return send(throttleResponse(limited.retryAfter));
      const body = await readJson(request);
      const email = normalizeEmail(body?.['email']);
      if (!email) return send(json({ error: 'email' }, 400));
      const password = typeof body?.['password'] === 'string' ? body['password'] : '';
      if (validatePassword(password)) return send(json({ error: 'weak' }, 400));
      const existing = await env.DB.prepare(
        'SELECT id, name, email, image, password_hash FROM users WHERE email = ?',
      )
        .bind(email)
        .first<Record<string, unknown>>();
      if (existing) {
        // No 'taken' oracle: the rightful password just logs in, anything else
        // fails exactly like a bad login.
        const stored = typeof existing['password_hash'] === 'string' ? existing['password_hash'] : null;
        const okUser = stored ? await verifyPassword(password, stored) : false;
        if (!okUser) return send(json({ error: 'invalid' }, 401));
        return loggedIn({
          id: existing['id'] as string,
          name: (existing['name'] as string | null) ?? null,
          email: (existing['email'] as string | null) ?? null,
          image: (existing['image'] as string | null) ?? null,
        });
      }
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      await env.DB.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
        .bind(id, email.split('@')[0], email, passwordHash)
        .run();
      return loggedIn({ id, name: email.split('@')[0], email, image: null });
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      if (!assertOrigin(request, env)) return send(json({ error: 'origin' }, 403));
      const limited = await authThrottled(env, request);
      if (limited.throttled) return send(throttleResponse(limited.retryAfter));
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
      if (stored && needsRehash(stored)) {
        await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(await hashPassword(password), row['id'] as string)
          .run();
      }
      return loggedIn({
        id: row['id'] as string,
        name: (row['name'] as string | null) ?? null,
        email: (row['email'] as string | null) ?? null,
        image: (row['image'] as string | null) ?? null,
      });
    }

    /** Bearer-aware logout: deletes the session row, expires the cookie. */
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      if (!assertOrigin(request, env)) return send(json({ error: 'origin' }, 403));
      await deleteSession(request, env);
      const res = json({ ok: true });
      res.headers.append('Set-Cookie', expireSessionCookie(env));
      return send(res);
    }

    if (url.pathname === '/api/intervals/status' && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return send(json({ error: 'unauthorized' }, 401));
      return send(json({ connected: (await readApiKey(env, user.id)) !== null }));
    }

    if (url.pathname === '/api/intervals/key' && request.method === 'PUT') {
      if (!assertOrigin(request, env)) return send(json({ error: 'origin' }, 403));
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
      if (!assertOrigin(request, env)) return send(json({ error: 'origin' }, 403));
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
      if (!res.ok) return send(icuFailure(res));
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
      if (!res.ok) return send(icuFailure(res));
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
        // Pre-v3 rows are ignored, never migrated: the new layout replaces the old.
        if (row['schema_version'] !== TEMPLATE_SCHEMA_VERSION) continue;
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
      if (!assertOrigin(request, env)) return send(json({ error: 'origin' }, 403));
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
      const updateRow = (): Promise<unknown> =>
        env.DB.prepare(
          `UPDATE user_templates SET name = ?, definition = ?, schema_version = ${TEMPLATE_SCHEMA_VERSION}, updated_at = ${NOW} WHERE id = ?`,
        )
          .bind(name, definition, id)
          .run();
      if (existing) {
        await updateRow();
      } else {
        try {
          await env.DB.prepare(
            `INSERT INTO user_templates (id, user_id, name, definition, schema_version) VALUES (?, ?, ?, ?, ${TEMPLATE_SCHEMA_VERSION})`,
          )
            .bind(id, user.id, name, definition)
            .run();
        } catch {
          // Lost a same-id race (two tabs): adopt the winner's lane instead of 500ing.
          const raced = await env.DB.prepare('SELECT user_id FROM user_templates WHERE id = ?')
            .bind(id)
            .first<Record<string, unknown>>();
          if (!raced) throw new Error('insert failed');
          if (raced['user_id'] !== user.id) return send(json({ error: 'id taken' }, 409));
          await updateRow();
        }
      }
      return send(json({ id }));
    }

    const itemMatch = /^\/api\/my\/templates\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (itemMatch && (request.method === 'PUT' || request.method === 'DELETE')) {
      if (!assertOrigin(request, env)) return send(json({ error: 'origin' }, 403));
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
          sets.push(`schema_version = ${TEMPLATE_SCHEMA_VERSION}`);
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
