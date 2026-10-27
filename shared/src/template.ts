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
  | 'grade'
  | 'vam'
  | 'gears'
  | 'none';

export type WidgetKind =
  | 'stat'
  | 'number'
  | 'gauge'
  | 'zones'
  | 'speedo'
  | 'ring'
  | 'hbar'
  | 'slope'
  | 'gears'
  | 'spark'
  | 'profile'
  | 'vam'
  | 'map'
  | 'navmap'
  | 'compass'
  | 'goal';

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
  /** Font family for the label line; theme font when absent. */
  labelFont?: string;
  /** Size multiplier for the label line. Defaults to 1. */
  labelScale?: number;
  /** Font family for the value (number) line; theme font when absent. */
  valueFont?: string;
  /** Size multiplier for the value (number) line. Defaults to 1. */
  valueScale?: number;
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
  /** Zone base in raw units: FTP watts (zones) or max HR bpm (hbar). */
  zoneBase?: number;
  /** Map ridden-trail stroke width in px. Auto-sized from the box when absent. */
  strokeWidth?: number;
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

/** Neutral theme for blank or imported templates missing theme fields. */
export const DEFAULT_TEMPLATE_THEME: TemplateTheme = {
  fontFamily: 'system-ui, sans-serif',
  text: '#ffffff',
  accent: '#7dd3fc',
  panel: '#0b0e11',
  panelOpacity: 0.45,
};

const ASPECTS: AspectClass[] = ['vertical', 'square', 'horizontal'];

const isLayout = (value: unknown): value is WidgetLayout =>
  typeof value === 'object' &&
  value !== null &&
  ['x', 'y', 'w', 'h'].every(
    (k) => typeof (value as Record<string, unknown>)[k] === 'number',
  );

/**
 * Parse an exported template file back into a Template. Throws
 * `not a template` on malformed JSON or a wrong shape; the caller assigns a
 * fresh id (an export keeps its original id, which may already exist).
 */
export function parseTemplateJson(text: string): Template {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('not a template');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('not a template');
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.name !== 'string' || !Array.isArray(rec.widgets)) {
    throw new Error('not a template');
  }
  for (const w of rec.widgets) {
    if (typeof w !== 'object' || w === null) throw new Error('not a template');
    const widget = w as Record<string, unknown>;
    if (typeof widget.id !== 'string' || typeof widget.kind !== 'string') {
      throw new Error('not a template');
    }
    const layout = widget.layout as Record<string, unknown> | undefined;
    if (
      typeof layout !== 'object' ||
      layout === null ||
      !ASPECTS.every((a) => isLayout(layout[a]))
    ) {
      throw new Error('not a template');
    }
  }
  const theme =
    typeof rec.theme === 'object' && rec.theme !== null
      ? (rec.theme as Record<string, unknown>)
      : {};
  const pick = (key: keyof TemplateTheme, fallback: number | string): number | string => {
    const value = theme[key as string];
    return typeof value === typeof fallback ? (value as number | string) : fallback;
  };
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: typeof rec.id === 'string' && rec.id ? rec.id : 'imported',
    name: rec.name as string,
    ...(typeof rec.description === 'string' ? { description: rec.description } : {}),
    theme: {
      fontFamily: pick('fontFamily', DEFAULT_TEMPLATE_THEME.fontFamily) as string,
      text: pick('text', DEFAULT_TEMPLATE_THEME.text) as string,
      accent: pick('accent', DEFAULT_TEMPLATE_THEME.accent) as string,
      panel: pick('panel', DEFAULT_TEMPLATE_THEME.panel) as string,
      panelOpacity: pick('panelOpacity', DEFAULT_TEMPLATE_THEME.panelOpacity) as number,
    },
    widgets: (rec.widgets as Template['widgets']).map((w) => ({
      ...w,
      visible: w.visible ?? true,
    })),
  };
}
