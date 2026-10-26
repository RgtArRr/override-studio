import {
  classifyAspect,
  type MetricId,
  type TemplateV1,
  type WidgetDef,
} from '@override-studio/shared';
import type { TelemetrySample } from './telemetry.js';
import { formatMetric, type Units } from './format.js';

function widgetValue(metric: MetricId, sample: TelemetrySample): number | undefined {
  if (metric === 'elapsedTime') return sample.t;
  return sample[metric];
}

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

function drawWidget(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  widget: WidgetDef,
  template: TemplateV1,
  sample: TelemetrySample,
  frameW: number,
  frameH: number,
  units: Units,
): void {
  const aspect = classifyAspect(frameW, frameH);
  const box = widget.layout[aspect];
  const x = box.x * frameW;
  const y = box.y * frameH;
  const w = box.w * frameW;
  const h = box.h * frameH;
  if (w < 24 || h < 16) return;

  ctx.save();
  ctx.globalAlpha = template.theme.panelOpacity;
  ctx.fillStyle = template.theme.panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(10, h * 0.18));
  ctx.fill();
  ctx.restore();

  const raw = widgetValue(widget.metric, sample);
  const formatted =
    raw === undefined ? { value: '—', unit: '' } : formatMetric(widget.metric, raw, units);

  const pad = Math.min(w, h) * 0.14;
  const valueSize = h * 0.44;
  const labelSize = Math.max(9, h * 0.2);

  ctx.save();
  ctx.fillStyle = template.theme.accent;
  ctx.font = `600 ${labelSize}px ${template.theme.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillText(LABELS[widget.metric], x + pad, y + pad * 0.7, w - pad * 2);

  ctx.fillStyle = template.theme.text;
  ctx.font = `700 ${valueSize}px ${template.theme.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  const text = formatted.unit ? `${formatted.value} ${formatted.unit}` : formatted.value;
  ctx.fillText(text, x + pad, y + h - pad * 0.8, w - pad * 2);
  ctx.restore();
}

/** Paints every visible widget of the template over the current frame. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  template: TemplateV1,
  sample: TelemetrySample,
  frameW: number,
  frameH: number,
  units: Units,
): void {
  for (const widget of template.widgets) {
    if (widget.visible) drawWidget(ctx, widget, template, sample, frameW, frameH, units);
  }
}
