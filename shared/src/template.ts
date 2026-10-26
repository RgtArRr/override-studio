/** Template schema v1: templates are data, never code. */

export const TEMPLATE_SCHEMA_VERSION = 1 as const;

export type AspectClass = 'vertical' | 'square' | 'horizontal';

export type MetricId =
  | 'speed'
  | 'heartRate'
  | 'power'
  | 'cadence'
  | 'elevation'
  | 'distance'
  | 'elapsedTime'
  | 'grade';

/** Normalized 0..1 box inside the video frame. */
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetDef {
  id: string;
  metric: MetricId;
  visible: boolean;
  layout: Record<AspectClass, WidgetLayout>;
}

export interface TemplateTheme {
  fontFamily: string;
  text: string;
  accent: string;
  panel: string;
  panelOpacity: number;
}

export interface TemplateV1 {
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  theme: TemplateTheme;
  widgets: WidgetDef[];
}

export function classifyAspect(width: number, height: number): AspectClass {
  const ratio = width / height;
  if (ratio < 0.8) return 'vertical';
  if (ratio > 1.25) return 'horizontal';
  return 'square';
}
