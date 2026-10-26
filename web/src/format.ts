import type { MetricId } from '@override-studio/shared';
import { formatClock } from './telemetry.js';

export type Units = 'metric' | 'imperial';

export interface FormattedMetric {
  value: string;
  unit: string;
}

/** Display formatting for one metric value (raw SI units in). */
export function formatMetric(metric: MetricId, raw: number, units: Units): FormattedMetric {
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
      return { value: formatClock(raw), unit: '' };
  }
}
