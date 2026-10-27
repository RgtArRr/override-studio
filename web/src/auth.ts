import type { Template } from '@override-studio/shared';

/**
 * Optional account, backed by the API (Auth.js, cookie session). Everything
 * degrades to null/false offline or logged-out: the app stays fully local.
 */
const API_URL =
  import.meta.env.VITE_API_URL ?? 'https://override-studio-api.koga262.workers.dev';

export interface AccountUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export type CredsError = 'email' | 'weak' | 'taken' | 'invalid' | 'net';

const KNOWN_CREDS_ERRORS: readonly string[] = ['email', 'weak', 'taken', 'invalid'];

async function creds(
  path: '/api/login' | '/api/register',
  email: string,
  password: string,
): Promise<{ user: AccountUser } | { error: CredsError }> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    // Error bodies matter here (email|weak|taken|invalid): parse any status.
    let data: unknown = null;
    try {
      data = (await res.json()) as unknown;
    } catch {
      /* non-JSON: treated as net failure below */
    }
    if (res.ok && typeof data === 'object' && data !== null && 'user' in data) {
      return { user: (data as { user: AccountUser }).user };
    }
    const err = (data as { error?: unknown } | null)?.error;
    if (typeof err === 'string' && KNOWN_CREDS_ERRORS.includes(err)) {
      return { error: err as CredsError };
    }
    return { error: 'net' };
  } catch {
    return { error: 'net' };
  }
}

/** Classic login with email + password. */
export const login = (email: string, password: string): Promise<{ user: AccountUser } | { error: CredsError }> =>
  creds('/api/login', email, password);

/** Classic registration (also logs in on success). */
export const register = (email: string, password: string): Promise<{ user: AccountUser } | { error: CredsError }> =>
  creds('/api/register', email, password);

/** Current session user, or null when logged out or unreachable. */
export async function fetchSession(): Promise<AccountUser | null> {
  try {
    const res = await fetch(`${API_URL}/api/auth/session`, { credentials: 'include' });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (typeof data !== 'object' || data === null) return null;
    const user = (data as { user?: unknown }).user;
    if (typeof user !== 'object' || user === null) return null;
    return user as AccountUser;
  } catch {
    return null;
  }
}

/** Ends the API session (no CSRF token: the API skips the origin check). */
export async function logout(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/signout`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface CloudTemplate {
  id: string;
  name: string;
  definition: Template;
  updatedAt: string;
}

const okJson = async (res: Response): Promise<unknown | null> => {
  if (!res.ok) return null;
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
};

/** Account templates, newest first; null when logged out or unreachable. */
export async function listCloudTemplates(): Promise<CloudTemplate[] | null> {
  try {
    const res = await fetch(`${API_URL}/api/my/templates`, { credentials: 'include' });
    const data = await okJson(res);
    const list = (data as { templates?: unknown } | null)?.templates;
    return Array.isArray(list) ? (list as CloudTemplate[]) : null;
  } catch {
    return null;
  }
}

export interface IntervalsActivity {
  id: string;
  name: string;
  type: string;
  start_date_local: string;
  timezone: string | null;
  elapsed_time: number;
  distance: number;
}

export type IntervalsFailure = 'reconnect' | 'intervals';

/** Whether the account has an intervals.icu key (null when logged out). */
export async function intervalsStatus(): Promise<boolean | null> {
  try {
    const res = await fetch(`${API_URL}/api/intervals/status`, { credentials: 'include' });
    if (res.status === 401) return null;
    const data = await okJson(res);
    const connected = (data as { connected?: unknown } | null)?.connected;
    return typeof connected === 'boolean' ? connected : null;
  } catch {
    return null;
  }
}

/** Stores the intervals.icu API key (server validates it first). */
export async function saveIntervalsKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/intervals/key`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteIntervalsKey(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/intervals/key`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Newest-first activities page (30-day windows), or why it failed. */
export async function listIntervalsActivities(
  page: number,
): Promise<{ activities: IntervalsActivity[] } | { error: IntervalsFailure }> {
  try {
    const res = await fetch(`${API_URL}/api/intervals/activities?page=${page}`, {
      credentials: 'include',
    });
    if (res.status === 401) return { error: 'reconnect' };
    const data = await okJson(res);
    const list = (data as { activities?: unknown } | null)?.activities;
    if (!Array.isArray(list)) return { error: 'intervals' };
    return { activities: list as IntervalsActivity[] };
  } catch {
    return { error: 'intervals' };
  }
}

/** Per-second streams (type -> data) for one activity, or why it failed. */
export async function getIntervalsStreams(
  id: string,
): Promise<{ streams: Record<string, unknown> } | { error: IntervalsFailure }> {
  try {
    const res = await fetch(
      `${API_URL}/api/intervals/activities/${encodeURIComponent(id)}/streams`,
      { credentials: 'include' },
    );
    if (res.status === 401) return { error: 'reconnect' };
    const data = await okJson(res);
    const streams = (data as { streams?: unknown } | null)?.streams;
    if (typeof streams !== 'object' || streams === null) return { error: 'intervals' };
    return { streams: streams as Record<string, unknown> };
  } catch {
    return { error: 'intervals' };
  }
}

/** Creates or replaces the account template with this id (server upserts). */
export async function saveCloudTemplate(
  id: string,
  name: string,
  definition: Template,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/my/templates`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, definition }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
