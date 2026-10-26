import {
  classifyAspect,
  type MetricId,
  type PanelShape,
  type Template,
  type WidgetDef,
} from '@override-studio/shared';
import { widgetValue, type TelemetrySample } from './telemetry.js';
import { formatMetric, type Units } from './format.js';

const LABELS: Record<MetricId, string> = {
  speed: 'VEL',
  heartRate: 'FC',
  power: 'POT',
  cadence: 'CAD',
  elevation: 'ALT',
  distance: 'DIST',
  elapsedTime: 'TIEMPO',
  grade: 'PEND',
};

/** Fallback gauge scales in raw SI units, used when the widget sets no range. */
const GAUGE_DEFAULTS: Record<MetricId, [number, number]> = {
  speed: [0, 15],
  heartRate: [40, 200],
  power: [0, 400],
  cadence: [0, 120],
  elevation: [0, 1000],
  distance: [0, 10000],
  elapsedTime: [0, 3600],
  grade: [-15, 15],
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface ResolvedStyle {
  shape: PanelShape;
  background: string;
  backgroundOpacity: number;
  accent: string;
  text: string;
}

function resolveStyle(template: Template, widget: WidgetDef): ResolvedStyle {
  const s = widget.style ?? {};
  return {
    shape: s.shape ?? 'rect',
    background: s.background ?? template.theme.panel,
    backgroundOpacity: s.backgroundOpacity ?? template.theme.panelOpacity,
    accent: s.accent ?? template.theme.accent,
    text: s.text ?? template.theme.text,
  };
}

function paintPanel(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: PanelShape,
  color: string,
  opacity: number,
): void {
  if (shape === 'none') return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, shape === 'pill' ? Math.min(w, h) / 2 : Math.min(10, h * 0.18));
  ctx.fill();
  ctx.restore();
}

interface WidgetText {
  label: string;
  value: string;
  unit: string;
}

function widgetText(
  widget: WidgetDef,
  sample: TelemetrySample,
  units: Units,
): WidgetText {
  const raw = widgetValue(widget.metric, sample);
  const formatted =
    raw === undefined ? { value: '—', unit: '' } : formatMetric(widget.metric, raw, units);
  return {
    label: widget.label ?? LABELS[widget.metric],
    value: formatted.value,
    unit: widget.showUnit === false ? '' : formatted.unit,
  };
}

function drawStat(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
): void {
  const style = resolveStyle(template, widget);
  const text = widgetText(widget, sample, units);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);

  const pad = Math.min(w, h) * 0.14;
  const valueSize = h * 0.44;
  const labelSize = Math.max(9, h * 0.2);

  ctx.save();
  ctx.fillStyle = style.accent;
  ctx.font = `600 ${labelSize}px ${template.theme.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillText(text.label, x + pad, y + pad * 0.7, w - pad * 2);

  ctx.fillStyle = style.text;
  ctx.font = `700 ${valueSize}px ${template.theme.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, x + pad, y + h - pad * 0.8, w - pad * 2);
  ctx.restore();
}

function drawNumber(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
): void {
  const style = resolveStyle(template, widget);
  const text = widgetText(widget, sample, units);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);

  const cx = x + w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.52}px ${template.theme.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text.value, cx, text.unit ? y + h * 0.4 : y + h * 0.52, w * 0.92);
  if (text.unit) {
    ctx.fillStyle = style.accent;
    ctx.font = `600 ${Math.max(9, h * 0.18)}px ${template.theme.fontFamily}`;
    ctx.fillText(text.unit, cx, y + h * 0.8, w * 0.92);
  }
  ctx.restore();
}

function drawGauge(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
): void {
  const style = resolveStyle(template, widget);
  const text = widgetText(widget, sample, units);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);

  const [min, max] = widget.range ?? GAUGE_DEFAULTS[widget.metric];
  const raw = widgetValue(widget.metric, sample);
  const frac = raw === undefined ? 0 : Math.min(1, Math.max(0, (raw - min) / (max - min)));

  const cx = x + w / 2;
  const cy = y + h * 0.6;
  const r = Math.min(w / 2 - 6, h * 0.42);
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const lw = Math.max(4, Math.min(w, h) * 0.09);

  ctx.save();
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  ctx.strokeStyle = style.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.2}px ${template.theme.fontFamily}`;
  ctx.textBaseline = 'middle';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, cx, cy, w * 0.9);

  ctx.fillStyle = style.accent;
  ctx.font = `600 ${Math.max(8, h * 0.09)}px ${template.theme.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillText(text.label, cx, y + h * 0.06, w * 0.9);
  ctx.restore();
}

/** Paints every visible widget of the template over the current frame. */
export function drawOverlay(
  ctx: Ctx,
  template: Template,
  sample: TelemetrySample,
  frameW: number,
  frameH: number,
  units: Units,
): void {
  const aspect = classifyAspect(frameW, frameH);
  for (const widget of template.widgets) {
    if (!widget.visible) continue;
    const box = widget.layout[aspect];
    const x = box.x * frameW;
    const y = box.y * frameH;
    const w = box.w * frameW;
    const h = box.h * frameH;
    if (w < 24 || h < 16) continue;
    if (widget.kind === 'gauge') {
      drawGauge(ctx, widget, template, sample, x, y, w, h, units);
    } else if (widget.kind === 'number') {
      drawNumber(ctx, widget, template, sample, x, y, w, h, units);
    } else {
      drawStat(ctx, widget, template, sample, x, y, w, h, units);
    }
  }
}
