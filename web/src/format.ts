import type { MetricId, TimeFormat } from '@override-studio/shared';
import { formatSpan } from './telemetry.js';

export type Units = 'metric' | 'imperial';

export interface FormattedMetric {
  value: string;
  unit: string;
}

/** Elapsed seconds rendered under a TimeFormat. */
export function formatElapsed(totalSec: number, format: TimeFormat = 'auto'): string {
  if (format === 'auto') return formatSpan(totalSec);
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  switch (format) {
    case 'hmm':
      return `${h}:${mm}`;
    case 'hmmss':
      return `${h}:${mm}:${ss}`;
    case 'h':
      return `${h}h`;
    case 'hm':
      return `${h}h ${mm}m`;
  }
}

/** Display formatting for one metric value (raw SI units in). */
export function formatMetric(
  metric: MetricId,
  raw: number,
  units: Units,
  timeFormat: TimeFormat = 'auto',
): FormattedMetric {
  switch (metric) {
    case 'speed':
      return units === 'metric'
        ? { value: (raw * 3.6).toFixed(1), unit: 'km/h' }
        : { value: (raw * 2.23694).toFixed(1), unit: 'mph' };
    case 'heartRate':
      return { value: String(Math.round(raw)), unit: 'bpm' };
    case 'power':
      return { value: String(Math.round(raw)), unit: 'W' };
    case 'cadence':
      return { value: String(Math.round(raw)), unit: 'rpm' };
    case 'elevation':
      return units === 'metric'
        ? { value: String(Math.round(raw)), unit: 'm' }
        : { value: String(Math.round(raw * 3.28084)), unit: 'ft' };
    case 'distance':
      return units === 'metric'
        ? { value: (raw / 1000).toFixed(2), unit: 'km' }
        : { value: (raw / 1609.34).toFixed(2), unit: 'mi' };
    case 'grade':
      return { value: raw.toFixed(1), unit: '%' };
    case 'elapsedTime':
      return { value: formatElapsed(raw, timeFormat), unit: '' };
    case 'vam':
      return units === 'metric'
        ? { value: String(Math.round(raw)), unit: 'm/h' }
        : { value: String(Math.round(raw * 3.28084)), unit: 'ft/h' };
    case 'gears':
    case 'none':
      return { value: '', unit: '' };
  }
}
