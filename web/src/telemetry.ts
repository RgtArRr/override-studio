import { Decoder, Stream } from '@garmin/fitsdk';
import { t } from './i18n.js';
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

/**
 * Interprets a wall reading ('YYYY-MM-DDTHH:mm:ss') in an IANA zone as a UTC
 * instant, via one format round-trip (DST-safe: the offset is read at that
 * instant). Null on bad input or unknown zone.
 */
export function zonedTimeToUtc(wall: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wall);
  if (!m) return null;
  const asUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0'),
  );
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(asUtc))) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    const back = Date.UTC(
      Number(parts['year']),
      Number(parts['month']) - 1,
      Number(parts['day']),
      Number(parts['hour'] === '24' ? '0' : parts['hour']),
      Number(parts['minute']),
      Number(parts['second']),
    );
    return new Date(asUtc - (back - asUtc));
  } catch {
    return null;
  }
}

/**
 * One generic track point from any XML source (GPX trkpt, TCX Trackpoint).
 * Times are ms epoch; every metric optional, like TelemetrySample.
 */
export interface TrackPoint {
  time: number;
  lat?: number;
  lon?: number;
  ele?: number;
  dist?: number;
  hr?: number;
  cad?: number;
  watts?: number;
  speed?: number;
}

const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const r = (d: number): number => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
};

/**
 * Shared XML -> Activity converter: GPX and TCX differ only in tag names, so
 * both extract to TrackPoint[] and meet here. Native distance wins when every
 * point carries it (TCX); otherwise it accumulates by haversine (GPX). Speed
 * derives from distance/time when absent. Non-monotonic times are dropped:
 * sampleAt binary-searches on ascending t.
 */
export function activityFromTrackPoints(points: TrackPoint[]): Activity {
  if (points.length === 0) throw new Error(t('err.trackInvalid'));
  const ordered = points.filter((p, i) => i === 0 || p.time >= points[i - 1].time);
  if (ordered.length === 0) throw new Error(t('err.trackInvalid'));
  const t0 = ordered[0].time;
  const nativeDist = ordered.every((p) => typeof p.dist === 'number');
  let odo = 0;
  let prevT = 0;
  let prevD = 0;
  const derived: boolean[] = [];
  const samples: TelemetrySample[] = ordered.map((p, i) => {
    const time = (p.time - t0) / 1000;
    let dist: number | undefined;
    if (nativeDist) {
      dist = p.dist;
    } else if (i === 0) {
      dist = 0;
    } else {
      const q = ordered[i - 1];
      if (
        p.lat !== undefined &&
        p.lon !== undefined &&
        q.lat !== undefined &&
        q.lon !== undefined
      ) {
        odo += haversineM(q.lat, q.lon, p.lat, p.lon);
      }
      dist = p.lat === undefined ? undefined : odo;
    }
    let speed = p.speed;
    if (speed === undefined && i > 0 && dist !== undefined) {
      const dt = time - prevT;
      speed = dt > 0 ? Math.max(0, (dist - prevD) / dt) : undefined;
    }
    derived.push(p.speed === undefined && speed !== undefined);
    prevT = time;
    if (dist !== undefined) prevD = dist;
    const s: TelemetrySample = { t: time };
    if (dist !== undefined) s.distance = dist;
    if (speed !== undefined) s.speed = speed;
    if (p.hr !== undefined) s.heartRate = p.hr;
    if (p.cad !== undefined) s.cadence = p.cad;
    if (p.watts !== undefined) s.power = p.watts;
    if (p.ele !== undefined) s.elevation = p.ele;
    if (p.lat !== undefined) s.lat = p.lat;
    if (p.lon !== undefined) s.lon = p.lon;
    return s;
  });
  // Derived speeds inherit GPS jitter: light 3-point smoothing, natives untouched.
  for (let i = 0; i < samples.length; i++) {
    if (!derived[i]) continue;
    const vals = [samples[i - 1]?.speed, samples[i].speed, samples[i + 1]?.speed].filter(
      (v): v is number => typeof v === 'number',
    );
    if (vals.length > 0) samples[i].speed = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  if (samples.length > 1 && samples[0].speed === undefined && samples[1].speed !== undefined) {
    samples[0].speed = samples[1].speed;
  }
  return buildActivity(new Date(t0), samples);
}

/** Direct child text by local tag name (namespace-agnostic). */
const childText = (parent: Element, name: string): string | null => {
  const lower = name.toLowerCase();
  for (const child of Array.from(parent.children)) {
    if (child.localName.toLowerCase() === lower) return child.textContent?.trim() ?? null;
  }
  return null;
};

/** First descendant text by local tag name, any namespace (extensions). */
const descText = (parent: Element, name: string): string | null => {
  const found = parent.getElementsByTagNameNS('*', name)[0];
  return found?.textContent?.trim() ?? null;
};

const num = (value: string | null): number | undefined => {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const set = <K extends 'lat' | 'lon' | 'ele' | 'dist' | 'hr' | 'cad' | 'watts' | 'speed'>(
  p: TrackPoint,
  key: K,
  value: number | undefined,
): void => {
  if (value !== undefined) p[key] = value;
};

function extractGpx(doc: Document): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const el of Array.from(doc.getElementsByTagName('trkpt'))) {
    const time = Date.parse(childText(el, 'time') ?? '');
    if (!Number.isFinite(time)) continue;
    const p: TrackPoint = { time };
    set(p, 'lat', num(el.getAttribute('lat')));
    set(p, 'lon', num(el.getAttribute('lon')));
    set(p, 'ele', num(childText(el, 'ele')));
    set(p, 'hr', num(descText(el, 'hr')));
    set(p, 'cad', num(descText(el, 'cad')));
    set(p, 'watts', num(descText(el, 'power')));
    set(p, 'speed', num(descText(el, 'speed')));
    points.push(p);
  }
  return points;
}

function extractTcx(doc: Document, halveCadence: boolean): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const el of Array.from(doc.getElementsByTagName('Trackpoint'))) {
    const time = Date.parse(childText(el, 'Time') ?? '');
    if (!Number.isFinite(time)) continue;
    const p: TrackPoint = { time };
    set(p, 'lat', num(descText(el, 'LatitudeDegrees')));
    set(p, 'lon', num(descText(el, 'LongitudeDegrees')));
    set(p, 'ele', num(childText(el, 'AltitudeMeters')));
    set(p, 'dist', num(childText(el, 'DistanceMeters')));
    const hrEl = Array.from(el.children).find((c) => c.localName === 'HeartRateBpm');
    set(p, 'hr', num(hrEl ? childText(hrEl, 'Value') : null));
    const cad = num(childText(el, 'Cadence'));
    set(p, 'cad', cad === undefined ? undefined : halveCadence ? cad / 2 : cad);
    set(p, 'watts', num(descText(el, 'Watts')));
    points.push(p);
  }
  return points;
}

/**
 * GPX/TCX entry: detects the root, extracts to TrackPoint[] (the only
 * format-specific code), and shares activityFromTrackPoints + buildActivity
 * with every other source. Throws err.trackInvalid on anything else.
 */
export function parseActivityXml(text: string): Activity {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(t('err.trackInvalid'));
  }
  const root = doc.documentElement?.localName;
  let points: TrackPoint[] | null = null;
  if (root === 'gpx') {
    points = extractGpx(doc);
  } else if (root === 'TrainingCenterDatabase') {
    // TCX running cadence counts both feet; cycling-style rpm halves it.
    const sport = doc.getElementsByTagName('Activity')[0]?.getAttribute('Sport');
    points = extractTcx(doc, sport === 'Running');
  }
  if (!points || points.length === 0) throw new Error(t('err.trackInvalid'));
  return activityFromTrackPoints(points);
}

/** Provider streams as our API serves them: stream type -> data. */
export type StreamSet = Record<string, unknown>;

/**
 * Builds an Activity from intervals.icu streams. No native grade stream:
 * elevation+distance derive it like the FIT path. velocity_smooth is m/s
 * (metric API; verify against a real ride if speed reads off).
 */
/**
 * Activity start instant: IANA zone first, then native parse for offset/UTC
 * forms, else the naive wall as UTC (deterministic across devices: a
 * browser-tz guess would shift the same activity per device). Null when
 * nothing parses.
 */
export function parseActivityStart(wall: string, timeZone: string | null): Date | null {
  if (timeZone) {
    const zoned = zonedTimeToUtc(wall, timeZone);
    if (zoned) return zoned;
  }
  const native = new Date(/([zZ]|[+-]\d{2}:?\d{2})$/.test(wall) ? wall : `${wall}Z`);
  return Number.isNaN(native.getTime()) ? null : native;
}

/**
 * Shared tail of every source (FIT, intervals, GPX/TCX): derived grade plus
 * duration from the last sample. Callers guarantee at least one sample.
 */
export function buildActivity(startTime: Date, samples: TelemetrySample[]): Activity {
  fillDerivedGrade(samples);
  return {
    startTime,
    durationSec: samples.length > 0 ? samples[samples.length - 1].t : 0,
    samples,
  };
}

export function activityFromIntervalsStreams(
  streams: StreamSet,
  startDateLocal: string,
  timezone: string | null,
): Activity {
  const numArr = (v: unknown): number[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === 'number')
      ? (v as number[])
      : undefined;
  const time = numArr(streams['time']) ?? [];
  if (time.length === 0) throw new Error(t('err.intervalsEmpty'));
  const start = parseActivityStart(startDateLocal, timezone);
  if (!start) throw new Error(t('err.intervalsDate'));
  const distance = numArr(streams['distance']);
  const altitude = numArr(streams['altitude']);
  const speed = numArr(streams['velocity_smooth']);
  const heartRate = numArr(streams['heartrate']);
  const cadence = numArr(streams['cadence']);
  const power = numArr(streams['watts']);
  const rawPairs = streams['latlng'];
  const pairs: [number, number][] | undefined =
    Array.isArray(rawPairs) &&
    rawPairs.every(
      (p): p is [number, number] =>
        Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number',
    )
      ? (rawPairs as [number, number][])
      : undefined;
  const at = (arr: number[] | undefined, i: number): number | undefined =>
    arr && i < arr.length ? arr[i] : undefined;
  const samples: TelemetrySample[] = time.map((tt, i) => {
    const s: TelemetrySample = { t: tt };
    const vSpeed = at(speed, i);
    if (vSpeed !== undefined) s.speed = vSpeed;
    const vHr = at(heartRate, i);
    if (vHr !== undefined) s.heartRate = vHr;
    const vPower = at(power, i);
    if (vPower !== undefined) s.power = vPower;
    const vCad = at(cadence, i);
    if (vCad !== undefined) s.cadence = vCad;
    const vEle = at(altitude, i);
    if (vEle !== undefined) s.elevation = vEle;
    const vDist = at(distance, i);
    if (vDist !== undefined) s.distance = vDist;
    const pair = pairs && i < pairs.length ? pairs[i] : undefined;
    if (pair) {
      s.lat = pair[0];
      s.lon = pair[1];
    }
    return s;
  });
  return buildActivity(start, samples);
}

function pickRecords(messages: Record<string, unknown>): RecordMesg[] {
  for (const key of ['recordMesgs', 'record']) {
    const value = messages[key];
    if (Array.isArray(value)) return value as RecordMesg[];
  }
  return [];
}

export function parseFit(buffer: ArrayBuffer): Activity {
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
  if (!decoder.isFIT()) throw new Error(t('err.fitInvalid'));
  const { messages, errors } = decoder.read();
  if (errors.length > 0) {
    throw new Error(t('err.fitDecode', { n: errors.length }));
  }
  const records = pickRecords(messages as Record<string, unknown>).filter(
    (r) => r.timestamp instanceof Date,
  );
  if (records.length === 0) throw new Error(t('err.fitNoRecords'));

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

  return buildActivity(records[0].timestamp as Date, samples);
}

/**
 * Grade fallback: many files record elevation + distance but no slope. When NO
 * sample carries native grade, derive it as Δelevation/Δdistance over a
 * ±10-sample window (0 when stopped). Native grade always wins; mixing both
 * sources would read inconsistently.
 */
export function fillDerivedGrade(samples: TelemetrySample[]): void {
  if (samples.some((s) => typeof s.grade === 'number')) return;
  const K = 10;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - K)];
    const b = samples[Math.min(samples.length - 1, i + K)];
    if (
      a.elevation === undefined ||
      a.distance === undefined ||
      b.elevation === undefined ||
      b.distance === undefined
    ) {
      continue;
    }
    const run = b.distance - a.distance;
    samples[i].grade = run >= 10 ? ((b.elevation - a.elevation) / run) * 100 : 0;
  }
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
  const max = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    let m = xs[0];
    for (let i = 1; i < xs.length; i++) if (xs[i] > m) m = xs[i];
    return m;
  };

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
