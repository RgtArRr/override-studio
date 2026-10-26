/** Template schema v2: templates are data, never code. */

export const TEMPLATE_SCHEMA_VERSION = 2 as const;

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

export type WidgetKind = 'stat' | 'number' | 'gauge';

export type PanelShape = 'rect' | 'pill' | 'none';

/** Normalized 0..1 box inside the video frame. */
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-widget overrides. Anything absent falls back to the theme + 'rect'. */
export interface WidgetStyle {
  shape?: PanelShape;
  background?: string;
  backgroundOpacity?: number;
  accent?: string;
  text?: string;
}

export interface WidgetDef {
  id: string;
  metric: MetricId;
  kind: WidgetKind;
  visible: boolean;
  /** Custom label; defaults to the metric short name. Ignored by 'number'. */
  label?: string;
  /** Show the unit next to the value. Defaults to true. */
  showUnit?: boolean;
  /** Gauge scale in raw SI units. Defaults per metric when absent. */
  range?: [number, number];
  style?: WidgetStyle;
  layout: Record<AspectClass, WidgetLayout>;
}

export interface TemplateTheme {
  fontFamily: string;
  text: string;
  accent: string;
  panel: string;
  panelOpacity: number;
}

export interface Template {
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
