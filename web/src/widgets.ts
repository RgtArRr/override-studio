import type {
  AspectClass,
  MetricId,
  WidgetDef,
  WidgetKind,
  WidgetLayout,
} from '@override-studio/shared';
import { t } from './i18n.js';

/** Pure, DOM-free widget catalog + factory for the right panel. No side effects. */

export const WIDGET_KINDS: WidgetKind[] = [
  'stat',
  'number',
  'gauge',
  'speedo',
  'ring',
  'slope',
  'gears',
  'spark',
  'profile',
  'vam',
  'map',
  'navmap',
  'compass',
];

export const METRIC_IDS: MetricId[] = [
  'speed',
  'heartRate',
  'power',
  'cadence',
  'elevation',
  'distance',
  'elapsedTime',
  'grade',
  'vam',
  'gears',
  'none',
];

export const kindLabel = (kind: WidgetKind): string => t(`kind.${kind}`);

export const metricLabel = (metric: MetricId): string => t(`metric.${metric}`);

/** Canonical metric per kind, mirroring the built-in fixtures. */
const DEFAULT_METRIC: Record<WidgetKind, MetricId> = {
  stat: 'speed',
  number: 'power',
  gauge: 'speed',
  speedo: 'speed',
  ring: 'cadence',
  slope: 'grade',
  gears: 'gears',
  spark: 'power',
  profile: 'elevation',
  vam: 'vam',
  map: 'none',
  navmap: 'none',
  compass: 'none',
};

export function defaultMetricFor(kind: WidgetKind): MetricId {
  return DEFAULT_METRIC[kind];
}

/** Base (horizontal) size per kind, sized from the built-in fixtures. */
const BASE_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  stat: { w: 0.18, h: 0.13 },
  number: { w: 0.16, h: 0.18 },
  gauge: { w: 0.22, h: 0.3 },
  speedo: { w: 0.26, h: 0.26 },
  ring: { w: 0.2, h: 0.3 },
  slope: { w: 0.26, h: 0.16 },
  gears: { w: 0.2, h: 0.18 },
  spark: { w: 0.32, h: 0.18 },
  profile: { w: 0.34, h: 0.2 },
  vam: { w: 0.2, h: 0.2 },
  map: { w: 0.26, h: 0.34 },
  navmap: { w: 0.26, h: 0.34 },
  compass: { w: 0.16, h: 0.26 },
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/**
 * Default box: centered, then stepped down-right per slot so consecutive adds
 * don't stack exactly. Always clamped inside the frame.
 */
export function defaultLayout(
  kind: WidgetKind,
  aspect: AspectClass,
  slot = 0,
): WidgetLayout {
  const base = BASE_SIZE[kind];
  const scale =
    aspect === 'square'
      ? { w: 1.35, h: 1 }
      : aspect === 'vertical'
        ? { w: 1.9, h: 0.8 }
        : { w: 1, h: 1 };
  const w = Math.min(base.w * scale.w, 0.9);
  const h = Math.min(base.h * scale.h, 0.9);
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    x: r3(clamp((1 - w) / 2 + 0.05 * slot, 0, 1 - w)),
    y: r3(clamp((1 - h) / 2 + 0.04 * slot, 0, 1 - h)),
    w: r3(w),
    h: r3(h),
  };
}

/** First free id: `kind`, `kind-2`, `kind-3`, … */
export function nextWidgetId(taken: Iterable<string>, kind: WidgetKind): string {
  const set = new Set(taken);
  if (!set.has(kind)) return kind;
  let n = 2;
  while (set.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

/** Map stroke widths in px: explicit `strokeWidth` wins (full trail at 70 %), else auto from the box. */
export function mapStrokeWidths(
  strokeWidth: number | undefined,
  w: number,
  h: number,
): { track: number; ridden: number } {
  const unit = Math.min(w, h);
  if (strokeWidth === undefined || !Number.isFinite(strokeWidth)) {
    return { track: Math.max(2.5, unit * 0.009), ridden: Math.max(3.5, unit * 0.013) };
  }
  const ridden = Math.max(1, strokeWidth);
  return { track: Math.max(1, ridden * 0.7), ridden };
}

/** GPS point for navigation-window math. */
export interface NavPoint {
  lon: number;
  lat: number;
  t: number;
}

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

function segMeters(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const kx = Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  return Math.hypot((bLon - aLon) * kx * M_PER_DEG_LON, (bLat - aLat) * M_PER_DEG_LAT);
}

/**
 * Index window holding `behindM` before and `aheadM` after time `t` along the
 * track. Points must be time-ordered. Edges clamp to the available points.
 */
export function navWindow(
  points: NavPoint[],
  t: number,
  behindM = 50,
  aheadM = 400,
): { start: number; end: number } {
  let i0 = 0;
  while (i0 + 1 < points.length && points[i0 + 1].t <= t) i0 += 1;
  let start = i0;
  let acc = 0;
  while (start > 0 && acc < behindM) {
    acc += segMeters(points[start].lon, points[start].lat, points[start - 1].lon, points[start - 1].lat);
    start -= 1;
  }
  let end = i0;
  acc = 0;
  while (end + 1 < points.length && acc < aheadM) {
    acc += segMeters(points[end].lon, points[end].lat, points[end + 1].lon, points[end + 1].lat);
    end += 1;
  }
  return { start, end };
}

/** Meters forward/right of `origin`, rotated so `courseDeg` points up. */
export function navProject(
  lon: number,
  lat: number,
  origin: { lon: number; lat: number },
  courseDeg: number,
): { fwd: number; right: number } {
  const kx = Math.cos((origin.lat * Math.PI) / 180);
  const dx = (lon - origin.lon) * kx * M_PER_DEG_LON;
  const dy = (lat - origin.lat) * M_PER_DEG_LAT;
  const c = (courseDeg * Math.PI) / 180;
  return { fwd: dx * Math.sin(c) + dy * Math.cos(c), right: dx * Math.cos(c) - dy * Math.sin(c) };
}

/** A visible widget with a default box per aspect. Range falls back to the renderer default. */
export function makeWidgetDef(
  kind: WidgetKind,
  metric: MetricId,
  id: string,
  slot = 0,
): WidgetDef {
  return {
    id,
    metric,
    kind,
    visible: true,
    layout: {
      horizontal: defaultLayout(kind, 'horizontal', slot),
      square: defaultLayout(kind, 'square', slot),
      vertical: defaultLayout(kind, 'vertical', slot),
    },
  };
}
