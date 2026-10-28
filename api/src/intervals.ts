import type { AuthEnv } from './auth.js';
import { openSecret, sealSecret } from './crypto.js';

/**
 * intervals.icu client (per-user API key, Basic API_KEY:<key>).
 * Docs: https://intervals.icu/api/v1/docs — athlete id 0 means "self",
 * stream GET needs the `.json` form (plain /streams is PUT-only).
 */
const ICU = 'https://intervals.icu/api/v1';
const PROVIDER = 'intervals';

const authHeader = (key: string): string => `Basic ${btoa(`API_KEY:${key}`)}`;

async function icuGet(
  key: string,
  path: string,
): Promise<{ status: number; data: unknown; retryAfter: string | null }> {
  try {
    const res = await fetch(`${ICU}${path}`, {
      headers: { Authorization: authHeader(key) },
      signal: AbortSignal.timeout(10_000),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON upstream error */
    }
    const ra = res.headers.get('retry-after');
    return { status: res.status, data, retryAfter: ra && /^\d+$/.test(ra) ? ra : null };
  } catch {
    return { status: 0, data: null, retryAfter: null };
  }
}

export async function readApiKey(env: AuthEnv, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT api_key FROM provider_keys WHERE user_id = ? AND provider = ?',
  )
    .bind(userId, PROVIDER)
    .first<Record<string, unknown>>();
  if (typeof row?.['api_key'] !== 'string') return null;
  return openSecret(env.AUTH_SECRET, row['api_key']);
}

export async function storeApiKey(
  env: AuthEnv,
  userId: string,
  apiKey: string,
): Promise<void> {
  const sealed = await sealSecret(env.AUTH_SECRET, apiKey);
  await env.DB.prepare(
    `INSERT INTO provider_keys (user_id, provider, api_key) VALUES (?, ?, ?)
     ON CONFLICT (user_id, provider) DO UPDATE SET api_key = excluded.api_key, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(userId, PROVIDER, sealed)
    .run();
}

export async function deleteApiKey(env: AuthEnv, userId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM provider_keys WHERE user_id = ? AND provider = ?')
    .bind(userId, PROVIDER)
    .run();
}

/** Key works when the self-athlete endpoint answers 200. */
export async function validateKey(key: string): Promise<boolean> {
  const { status } = await icuGet(key, '/athlete/0');
  return status === 200;
}

export interface IntervalsActivityMeta {
  id: string;
  name: string;
  type: string;
  start_date_local: string;
  timezone: string | null;
  elapsed_time: number;
  distance: number;
}

export type IcuResult<T> =
  | { ok: true; data: T }
  | { ok: false; auth: boolean; status: number; retryAfter: string | null };

const dayFmt = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Newest-first page: 30-day windows back from today (page 1 = last 30 days).
 * Upstream 401/403 means the stored key died -> caller reports reconnect.
 */
export async function listActivities(
  key: string,
  page: number,
): Promise<IcuResult<IntervalsActivityMeta[]>> {
  const newest = new Date(Date.now() - (page - 1) * 30 * 86400_000);
  const oldest = new Date(newest.getTime() - 30 * 86400_000);
  const fields = 'id,name,type,start_date_local,timezone,elapsed_time,distance';
  const { status, data, retryAfter } = await icuGet(
    key,
    `/athlete/0/activities?oldest=${dayFmt(oldest)}&newest=${dayFmt(newest)}&limit=50&fields=${fields}`,
  );
  if (status === 401 || status === 403) return { ok: false, auth: true, status, retryAfter };
  if (status !== 200 || !Array.isArray(data))
    return { ok: false, auth: false, status, retryAfter };
  const out: IntervalsActivityMeta[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    if (typeof a['id'] !== 'string' || typeof a['start_date_local'] !== 'string') continue;
    out.push({
      id: a['id'],
      name: typeof a['name'] === 'string' ? a['name'] : '',
      type: typeof a['type'] === 'string' ? a['type'] : '',
      start_date_local: a['start_date_local'],
      timezone: typeof a['timezone'] === 'string' ? a['timezone'] : null,
      elapsed_time: typeof a['elapsed_time'] === 'number' ? a['elapsed_time'] : 0,
      distance: typeof a['distance'] === 'number' ? a['distance'] : 0,
    });
  }
  return { ok: true, data: out };
}

/** Per-second streams mapped as type -> data (compact wire format). */
export async function getStreams(
  key: string,
  activityId: string,
): Promise<IcuResult<Record<string, unknown>>> {
  const types = [
    'time',
    'watts',
    'distance',
    'heartrate',
    'altitude',
    'velocity_smooth',
    'cadence',
    'latlng',
    'temp',
  ].join(',');
  const { status, data, retryAfter } = await icuGet(
    key,
    `/activity/${encodeURIComponent(activityId)}/streams.json?types=${types}`,
  );
  if (status === 401 || status === 403) return { ok: false, auth: true, status, retryAfter };
  if (status !== 200 || !Array.isArray(data))
    return { ok: false, auth: false, status, retryAfter };
  const out: Record<string, unknown> = {};
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    if (typeof s['type'] === 'string' && Array.isArray(s['data'])) {
      out[s['type']] = s['data'];
    }
  }
  return { ok: true, data: out };
}
