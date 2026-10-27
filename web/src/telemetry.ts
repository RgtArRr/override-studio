import { Decoder, Stream } from '@garmin/fitsdk';
import type { RecordMesg } from '@garmin/fitsdk';
import type { MetricId } from '@override-studio/shared';

/** One normalized telemetry point. `t` is seconds since activity start. */
export interface TelemetrySample {
  t: number;
  speed?: number;
  heartRate?: number;
  power?: number;
  cadence?: number;
  elevation?: number;
  distance?: number;
  grade?: number;
  lat?: number;
  lon?: number;
  /** Gear teeth, forward-filled from shift events. Never interpolated. */
  frontGear?: number;
  rearGear?: number;
}

export interface Activity {
  startTime: Date;
  durationSec: number;
  samples: TelemetrySample[];
}

export interface ActivitySummary {
  samples: number;
  durationSec: number;
  distanceM: number;
  avgSpeed: number | null;
  maxSpeed: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgPower: number | null;
  elevationGain: number | null;
}

const SEMI_TO_DEG = 180 / 2 ** 31;

function pickRecords(messages: Record<string, unknown>): RecordMesg[] {
  for (const key of ['recordMesgs', 'record']) {
    const value = messages[key];
    if (Array.isArray(value)) return value as RecordMesg[];
  }
  return [];
}

export function parseFit(buffer: ArrayBuffer): Activity {
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
  if (!decoder.isFIT()) throw new Error('El archivo no es un FIT válido.');
  const { messages, errors } = decoder.read();
  if (errors.length > 0) {
    throw new Error(`El FIT tiene errores de decodificación (${errors.length}).`);
  }
  const records = pickRecords(messages as Record<string, unknown>).filter(
    (r) => r.timestamp instanceof Date,
  );
  if (records.length === 0) throw new Error('El FIT no contiene registros con timestamp.');

  const t0 = (records[0].timestamp as Date).getTime();
  // Shift events are sparse: carry the last known combo forward like the bike does.
  let lastFront: number | undefined;
  let lastRear: number | undefined;
  const samples: TelemetrySample[] = records.map((r) => {
    const s: TelemetrySample = { t: ((r.timestamp as Date).getTime() - t0) / 1000 };
    if (typeof r.speed === 'number') s.speed = r.speed;
    if (typeof r.heartRate === 'number') s.heartRate = r.heartRate;
    if (typeof r.power === 'number') s.power = r.power;
    if (typeof r.cadence === 'number') s.cadence = r.cadence;
    if (typeof r.altitude === 'number') s.elevation = r.altitude;
    if (typeof r.distance === 'number') s.distance = r.distance;
    if (typeof r.grade === 'number') s.grade = r.grade;
    if (typeof r.positionLat === 'number') s.lat = r.positionLat * SEMI_TO_DEG;
    if (typeof r.positionLong === 'number') s.lon = r.positionLong * SEMI_TO_DEG;
    const gears = r as unknown as { frontGear?: unknown; rearGear?: unknown };
    if (typeof gears.frontGear === 'number') lastFront = gears.frontGear;
    if (typeof gears.rearGear === 'number') lastRear = gears.rearGear;
    if (lastFront !== undefined) s.frontGear = lastFront;
    if (lastRear !== undefined) s.rearGear = lastRear;
    return s;
  });

  return {
    startTime: records[0].timestamp as Date,
    durationSec: samples[samples.length - 1].t,
    samples,
  };
}

const NUMERIC_KEYS = [
  'speed',
  'heartRate',
  'power',
  'cadence',
  'elevation',
  'distance',
  'grade',
  'lat',
  'lon',
] as const;

/** Discrete fields: step-held from the left sample, never interpolated. */
const STEP_KEYS = ['frontGear', 'rearGear'] as const;

/** Interpolated sample at time t (clamped to the activity range). */
export function sampleAt(activity: Activity, t: number): TelemetrySample {
  const { samples } = activity;
  const clamped = Math.min(Math.max(t, 0), activity.durationSec);
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].t <= clamped) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo];
  const b = samples[Math.min(lo + 1, samples.length - 1)];
  const span = b.t - a.t;
  const f = span > 0 ? (clamped - a.t) / span : 0;
  const out: TelemetrySample = { t: clamped };
  for (const key of NUMERIC_KEYS) {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'number' && typeof vb === 'number') out[key] = va + (vb - va) * f;
    else if (typeof va === 'number') out[key] = va;
    else if (typeof vb === 'number') out[key] = vb;
  }
  for (const key of STEP_KEYS) {
    const va = a[key];
    if (typeof va === 'number') out[key] = va;
    else if (typeof b[key] === 'number') out[key] = b[key];
  }
  return out;
}

export function summarize(activity: Activity): ActivitySummary {
  const { samples } = activity;
  const nums = (pick: (s: TelemetrySample) => number | undefined): number[] =>
    samples.map(pick).filter((v): v is number => typeof v === 'number');
  const avg = (xs: number[]): number | null =>
    xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const max = (xs: number[]): number | null => (xs.length > 0 ? Math.max(...xs) : null);

  const elev = nums((s) => s.elevation);
  let gain: number | null = null;
  if (elev.length > 1) {
    gain = 0;
    for (let i = 1; i < elev.length; i++) gain += Math.max(0, elev[i] - elev[i - 1]);
  }
  const dist = nums((s) => s.distance);
  return {
    samples: samples.length,
    durationSec: activity.durationSec,
    distanceM: dist.length > 0 ? dist[dist.length - 1] - dist[0] : 0,
    avgSpeed: avg(nums((s) => s.speed)),
    maxSpeed: max(nums((s) => s.speed)),
    avgHeartRate: avg(nums((s) => s.heartRate)),
    maxHeartRate: max(nums((s) => s.heartRate)),
    avgPower: avg(nums((s) => s.power)),
    elevationGain: gain,
  };
}

/** Raw value for an overlay widget from the FIT sample at the rendered moment.
 * elapsedTime is the activity clock (FIT elapsed), not the video position. */
export function widgetValue(
  metric: MetricId,
  sample: TelemetrySample,
): number | undefined {
  if (metric === 'elapsedTime') return sample.t;
  // Computed (vam), composite (gears) or absent (none): custom kinds read history directly.
  if (metric === 'vam' || metric === 'gears' || metric === 'none') return undefined;
  return sample[metric];
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** h:mm:ss past the hour, mm:ss below it. For activity-scale spans. */
export function formatSpan(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
