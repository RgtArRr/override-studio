import {
  classifyAspect,
  type MetricId,
  type PanelShape,
  type Template,
  type WidgetDef,
} from '@override-studio/shared';
import {
  sampleAt,
  widgetValue,
  formatSpan,
  type Activity,
  type TelemetrySample,
} from './telemetry.js';
import { formatMetric, type Units } from './format.js';
import { mapStrokeWidths, navProject, navWindow } from './widgets.js';
import { t } from './i18n.js';

const labelFor = (metric: MetricId): string => t(`ovl.${metric}`);

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
  vam: [0, 2000],
  gears: [0, 1],
  none: [0, 1],
};

/** Coggan power zones (% FTP) and 5 HR zones (% max HR). */
const POWER_ZONE_BOUNDS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
const HR_ZONE_BOUNDS = [0.6, 0.7, 0.8, 0.9];
const ZONE_COLORS = ['#8e8e93', '#0099ff', '#34c759', '#ffd60a', '#ff9f0a', '#ff453a', '#bf5af2'];

/** Full series access for history widgets (spark, profile, map, compass, vam). */
export interface OverlayHistory {
  activity: Activity;
  t: number;
}

const zoneIndex = (frac: number, bounds: number[]): number => {
  for (let i = 0; i < bounds.length; i++) {
    if (frac < bounds[i]) return i;
  }
  return bounds.length;
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface ResolvedStyle {
  shape: PanelShape;
  background: string;
  backgroundOpacity: number;
  accent: string;
  text: string;
  labelFont: string;
  labelScale: number;
  valueFont: string;
  valueScale: number;
}

function resolveStyle(template: Template, widget: WidgetDef): ResolvedStyle {
  const s = widget.style ?? {};
  return {
    shape: s.shape ?? 'rect',
    background: s.background ?? template.theme.panel,
    backgroundOpacity: s.backgroundOpacity ?? template.theme.panelOpacity,
    accent: s.accent ?? template.theme.accent,
    text: s.text ?? template.theme.text,
    labelFont: s.labelFont ?? template.theme.fontFamily,
    labelScale: s.labelScale ?? 1,
    valueFont: s.valueFont ?? template.theme.fontFamily,
    valueScale: s.valueScale ?? 1,
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
    label: widget.label ?? labelFor(widget.metric),
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
  ctx.font = `600 ${labelSize * style.labelScale}px ${style.labelFont}`;
  ctx.textBaseline = 'top';
  ctx.fillText(text.label, x + pad, y + pad * 0.7, w - pad * 2);

  ctx.fillStyle = style.text;
  ctx.font = `700 ${valueSize * style.valueScale}px ${style.valueFont}`;
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
  ctx.font = `700 ${h * 0.52 * style.valueScale}px ${style.valueFont}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text.value, cx, text.unit ? y + h * 0.4 : y + h * 0.52, w * 0.92);
  if (text.unit) {
    ctx.fillStyle = style.accent;
    ctx.font = `600 ${Math.max(9, h * 0.18) * style.labelScale}px ${style.labelFont}`;
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
  ctx.font = `700 ${h * 0.2 * style.valueScale}px ${style.valueFont}`;
  ctx.textBaseline = 'middle';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  // Nudged below the arc center: optical middle sits lower than cy.
  ctx.fillText(line, cx, cy + h * 0.05, w * 0.9);

  ctx.fillStyle = style.accent;
  ctx.font = `600 ${Math.max(8, h * 0.09) * style.labelScale}px ${style.labelFont}`;
  ctx.textBaseline = 'top';
  ctx.fillText(text.label, cx, y + h * 0.06, w * 0.9);
  ctx.restore();
}

/** Centered '—' for widgets with no data at this moment. Panel already painted. */
function drawMissing(
  ctx: Ctx,
  style: ResolvedStyle,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.3 * style.valueScale}px ${style.valueFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('—', x + w / 2, y + h / 2);
  ctx.restore();
}

function drawLabelTop(
  ctx: Ctx,
  style: ResolvedStyle,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.fillStyle = style.accent;
  ctx.font = `600 ${Math.max(8, h * 0.09) * style.labelScale}px ${style.labelFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, x + w / 2, y + h * 0.06, w * 0.9);
  ctx.restore();
}

/** Power zone arc: 7 Coggan segments, active zone lit. */
function drawZones(
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
  drawLabelTop(ctx, style, text.label, x, y, w, h);
  const raw = widgetValue(widget.metric, sample);
  if (raw === undefined) {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  const zi = zoneIndex(raw / (widget.zoneBase ?? 250), POWER_ZONE_BOUNDS);
  const cx = x + w / 2;
  const cy = y + h * 0.62;
  const r = Math.min(w / 2 - 8, h * 0.42);
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const segs = POWER_ZONE_BOUNDS.length + 1;
  ctx.save();
  ctx.lineWidth = Math.max(5, Math.min(w, h) * 0.09);
  ctx.lineCap = 'butt';
  for (let i = 0; i < segs; i++) {
    const s0 = a0 + ((a1 - a0) * i) / segs + 0.02;
    const s1 = a0 + ((a1 - a0) * (i + 1)) / segs - 0.02;
    ctx.globalAlpha = i === zi ? 1 : 0.28;
    ctx.strokeStyle = ZONE_COLORS[i];
    ctx.beginPath();
    ctx.arc(cx, cy, r, s0, s1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.2 * style.valueScale}px ${style.valueFont}`;
  ctx.textBaseline = 'middle';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, cx, cy + h * 0.05, w * 0.9);
  ctx.fillStyle = ZONE_COLORS[zi];
  ctx.font = `700 ${h * 0.11 * style.labelScale}px ${style.labelFont}`;
  ctx.fillText(`Z${zi + 1}`, cx, cy + h * 0.2, w * 0.9);
  ctx.restore();
}

/** Classic semicircular speedometer with needle + digital readout. */
function drawSpeedo(
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
  drawLabelTop(ctx, style, text.label, x, y, w, h);
  const raw = widgetValue(widget.metric, sample);
  if (raw === undefined) {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  const [min, max] = widget.range ?? GAUGE_DEFAULTS[widget.metric];
  const frac = Math.min(1, Math.max(0, (raw - min) / (max - min)));
  const cx = x + w / 2;
  const cy = y + h * 0.74;
  const r = Math.min(w / 2 - 10, h * 0.6);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, h * 0.045);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 2;
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (Math.PI * i) / 6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - h * 0.03), cy + Math.sin(a) * (r - h * 0.03));
    ctx.lineTo(cx + Math.cos(a) * (r + h * 0.02), cy + Math.sin(a) * (r + h * 0.02));
    ctx.stroke();
  }
  const na = Math.PI + Math.PI * frac;
  const needleW = Math.max(4, h * 0.032);
  ctx.strokeStyle = style.text;
  ctx.lineWidth = needleW;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(na) * r * 0.92, cy + Math.sin(na) * r * 0.92);
  ctx.stroke();
  ctx.fillStyle = style.text;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(4, needleW * 0.9), 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.16 * style.valueScale}px ${style.valueFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, cx, y + h * 0.98, w * 0.9);
  ctx.restore();
}

/** Generic full ring for any metric + range, value centered. */
function drawRing(
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
  drawLabelTop(ctx, style, text.label, x, y, w, h);
  const raw = widgetValue(widget.metric, sample);
  if (raw === undefined) {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  const [min, max] = widget.range ?? GAUGE_DEFAULTS[widget.metric];
  const frac = Math.min(1, Math.max(0, (raw - min) / (max - min)));
  const cx = x + w / 2;
  const cy = y + h * 0.56;
  const r = Math.min(w, h) / 2 - 10;
  ctx.save();
  ctx.lineWidth = Math.max(4, Math.min(w, h) * 0.09);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = style.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * frac);
  ctx.stroke();
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.2 * style.valueScale}px ${style.valueFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, cx, cy, w * 0.8);
  ctx.restore();
}

/** Horizontal HR zone bar with position marker. */
function drawHbar(
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
  drawLabelTop(ctx, style, text.label, x, y, w, h);
  const raw = widgetValue(widget.metric, sample);
  if (raw === undefined) {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  const zi = zoneIndex(raw / (widget.zoneBase ?? 185), HR_ZONE_BOUNDS);
  const pad = w * 0.06;
  const bx = x + pad;
  const bw = w - pad * 2;
  const by = y + h * 0.62;
  const bh = Math.max(6, h * 0.12);
  // Domain 0.5..1.0 of max HR split by the zone bounds.
  const edges = [0.5, ...HR_ZONE_BOUNDS, 1.0];
  ctx.save();
  for (let i = 0; i < edges.length - 1; i++) {
    const sx = bx + ((edges[i] - 0.5) / 0.5) * bw;
    const sw = ((edges[i + 1] - edges[i]) / 0.5) * bw;
    ctx.globalAlpha = i === zi ? 1 : 0.3;
    ctx.fillStyle = ZONE_COLORS[i + 1];
    ctx.fillRect(sx + 1, by, sw - 2, bh);
  }
  ctx.restore();
  const frac = Math.min(1, Math.max(0, (raw / (widget.zoneBase ?? 185) - 0.5) / 0.5));
  const mx = bx + frac * bw;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(mx - 5, by - 2);
  ctx.lineTo(mx + 5, by - 2);
  ctx.lineTo(mx, by - 10);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.26 * style.valueScale}px ${style.valueFont}`;
  ctx.textBaseline = 'middle';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, x + w / 2, y + h * 0.38, w * 0.9);
  ctx.fillStyle = ZONE_COLORS[zi + 1];
  ctx.font = `700 ${h * 0.11 * style.labelScale}px ${style.labelFont}`;
  ctx.textAlign = 'right';
  ctx.fillText(`Z${zi + 1}`, x + w - pad, by + bh + h * 0.04, w * 0.3);
  ctx.restore();
}

/** Grade inclinometer: bubble on a centered track. */
function drawSlope(
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
  drawLabelTop(ctx, style, text.label, x, y, w, h);
  const raw = widgetValue(widget.metric, sample);
  if (raw === undefined) {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  const [min, max] = widget.range ?? GAUGE_DEFAULTS[widget.metric];
  const frac = Math.min(1, Math.max(0, (raw - min) / (max - min)));
  const pad = w * 0.08;
  const ty = y + h * 0.66;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = Math.max(3, h * 0.03);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + pad, ty);
  ctx.lineTo(x + w - pad, ty);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, ty - h * 0.05);
  ctx.lineTo(x + w / 2, ty + h * 0.05);
  ctx.stroke();
  ctx.fillStyle = style.accent;
  ctx.beginPath();
  ctx.arc(x + pad + frac * (w - pad * 2), ty, Math.max(5, h * 0.055), 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.3 * style.valueScale}px ${style.valueFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, x + w / 2, y + h * 0.36, w * 0.9);
  ctx.restore();
}

/** Front × rear gear teeth, step-held between shift events. */
function drawGears(
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
  drawLabelTop(ctx, style, text.label, x, y, w, h);
  if (typeof sample.frontGear !== 'number' || typeof sample.rearGear !== 'number') {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.34 * style.valueScale}px ${style.valueFont}`;
  ctx.fillText(`${sample.frontGear}×${sample.rearGear}`, x + w / 2, y + h * 0.52, w * 0.92);
  ctx.fillStyle = style.accent;
  ctx.font = `600 ${Math.max(8, h * 0.1) * style.labelScale}px ${style.labelFont}`;
  ctx.fillText(t('ovl.gearsSub'), x + w / 2, y + h * 0.78, w * 0.9);
  ctx.restore();
}

/** Last-30 s sparkline of any metric. */
function drawSpark(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
  hist: OverlayHistory | undefined,
): void {
  const style = resolveStyle(template, widget);
  const text = widgetText(widget, sample, units);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);
  const pts: [number, number][] = [];
  if (hist) {
    for (const s of hist.activity.samples) {
      if (s.t < hist.t - 30 || s.t > hist.t) continue;
      const v = widget.metric === 'elapsedTime' ? s.t : s[widget.metric as keyof TelemetrySample];
      if (typeof v === 'number') pts.push([s.t, v]);
    }
  }
  ctx.save();
  ctx.fillStyle = style.accent;
  ctx.font = `600 ${Math.max(8, h * 0.11) * style.labelScale}px ${style.labelFont}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(text.label, x + w * 0.05, y + h * 0.06, w * 0.4);
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.16 * style.valueScale}px ${style.valueFont}`;
  ctx.textAlign = 'right';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, x + w * 0.95, y + h * 0.05, w * 0.5);
  ctx.restore();
  if (pts.length < 2) {
    drawMissing(ctx, style, x, y + h * 0.2, w, h * 0.8);
    return;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of pts) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const cx0 = x + w * 0.04;
  const cx1 = x + w * 0.96;
  const cy0 = y + h * 0.3;
  const cy1 = y + h * 0.94;
  const X = (t: number): number => cx0 + ((t - (hist?.t ?? 0) + 30) / 30) * (cx1 - cx0);
  const Y = (v: number): number => cy1 - ((v - min) / (max - min)) * (cy1 - cy0);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(X(pts[0][0]), cy1);
  for (const [t, v] of pts) ctx.lineTo(X(t), Y(v));
  ctx.lineTo(X(pts[pts.length - 1][0]), cy1);
  ctx.closePath();
  ctx.fillStyle = style.accent;
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  pts.forEach(([t, v], i) => {
    if (i === 0) ctx.moveTo(X(t), Y(v));
    else ctx.lineTo(X(t), Y(v));
  });
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  const [lt, lv] = pts[pts.length - 1];
  ctx.fillStyle = style.text;
  ctx.beginPath();
  ctx.arc(X(lt), Y(lv), 3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

/** Full-ride elevation profile with ridden shading + you-are-here dot. */
function drawProfile(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
  hist: OverlayHistory | undefined,
): void {
  const style = resolveStyle(template, widget);
  const text = widgetText(widget, sample, units);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);
  const series: [number, number][] = [];
  if (hist) {
    const useDist =
      typeof hist.activity.samples[0]?.distance === 'number' &&
      typeof sample.distance === 'number';
    for (const s of hist.activity.samples) {
      if (typeof s.elevation !== 'number') continue;
      const xk = useDist ? s.distance : s.t;
      if (typeof xk !== 'number') continue;
      series.push([xk, s.elevation]);
    }
  }
  ctx.save();
  ctx.fillStyle = style.accent;
  ctx.font = `600 ${Math.max(8, h * 0.11) * style.labelScale}px ${style.labelFont}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(text.label, x + w * 0.05, y + h * 0.06, w * 0.4);
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.16 * style.valueScale}px ${style.valueFont}`;
  ctx.textAlign = 'right';
  const line = text.unit ? `${text.value} ${text.unit}` : text.value;
  ctx.fillText(line, x + w * 0.95, y + h * 0.05, w * 0.5);
  ctx.restore();
  if (series.length < 2 || !hist) {
    drawMissing(ctx, style, x, y + h * 0.2, w, h * 0.8);
    return;
  }
  const xMax = series[series.length - 1][0];
  const xMin = series[0][0];
  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of series) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 1e-9 || xMax - xMin < 1e-9) {
    drawMissing(ctx, style, x, y + h * 0.2, w, h * 0.8);
    return;
  }
  const cx0 = x + w * 0.04;
  const cx1 = x + w * 0.96;
  const cy0 = y + h * 0.3;
  const cy1 = y + h * 0.92;
  const X = (v: number): number => cx0 + ((v - xMin) / (xMax - xMin)) * (cx1 - cx0);
  const Y = (v: number): number => cy1 - ((v - min) / (max - min)) * (cy1 - cy0);
  const nowX =
    typeof sample.distance === 'number' &&
    typeof hist.activity.samples[0]?.distance === 'number'
      ? sample.distance
      : sample.t;
  ctx.save();
  // Ahead: faint full area. Ridden: accent area + dot.
  const trace = (upto: number): void => {
    ctx.beginPath();
    ctx.moveTo(X(series[0][0]), cy1);
    for (const [xk, v] of series) {
      if (xk > upto) break;
      ctx.lineTo(X(xk), Y(v));
    }
    ctx.lineTo(X(Math.min(upto, xMax)), cy1);
    ctx.closePath();
  };
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.14;
  trace(xMax);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.accent;
  ctx.globalAlpha = 0.45;
  trace(nowX);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(X(Math.min(nowX, xMax)), Y(sample.elevation ?? min), 4, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Climb rate over the last 60 s, with trend arrow. */
function drawVam(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
  hist: OverlayHistory | undefined,
): void {
  const style = resolveStyle(template, widget);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);
  const label = widget.label ?? labelFor(widget.metric);
  drawLabelTop(ctx, style, label, x, y, w, h);
  const e1 = hist ? sampleAt(hist.activity, hist.t).elevation : sample.elevation;
  const e0 = hist ? sampleAt(hist.activity, hist.t - 60).elevation : undefined;
  if (typeof e1 !== 'number' || typeof e0 !== 'number') {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  const vam = ((e1 - e0) / 60) * 3600;
  const prev = hist ? sampleAt(hist.activity, hist.t - 120).elevation : undefined;
  const prevVam = typeof prev === 'number' ? ((e0 - prev) / 60) * 3600 : vam;
  const arrow = vam > prevVam + 20 ? '▲' : vam < prevVam - 20 ? '▼' : '■';
  const fmt = formatMetric('vam', vam, units);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.34 * style.valueScale}px ${style.valueFont}`;
  ctx.fillText(`${fmt.value} ${fmt.unit}`, x + w / 2, y + h * 0.52, w * 0.92);
  ctx.fillStyle = vam >= 0 ? style.accent : style.text;
  ctx.font = `600 ${Math.max(8, h * 0.12) * style.labelScale}px ${style.labelFont}`;
  ctx.fillText(`${arrow} 60 s`, x + w / 2, y + h * 0.8, w * 0.9);
  ctx.restore();
}

/** GPS track: faint full route, accent ridden trail, you-are-here dot. */
function drawMap(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
  hist: OverlayHistory | undefined,
): void {
  void units;
  const style = resolveStyle(template, widget);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);
  const pts: [number, number, number][] = [];
  if (hist) {
    for (const s of hist.activity.samples) {
      if (typeof s.lat === 'number' && typeof s.lon === 'number') pts.push([s.lon, s.lat, s.t]);
    }
  }
  if (pts.length < 2 || !hist) {
    drawLabelTop(ctx, style, widget.label ?? t('ovl.map'), x, y, w, h);
    drawMissing(ctx, style, x, y + h * 0.15, w, h * 0.85);
    return;
  }
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // Equirectangular fit: shrink longitude by cos(latitude).
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanLon = Math.max(1e-9, (maxLon - minLon) * kx);
  const spanLat = Math.max(1e-9, maxLat - minLat);
  const pad = Math.min(w, h) * 0.1;
  const scale = Math.min((w - pad * 2) / spanLon, (h - pad * 2) / spanLat);
  const X = (lon: number): number =>
    x + w / 2 + ((lon - (minLon + maxLon) / 2) * kx * scale);
  const Y = (lat: number): number =>
    y + h / 2 - ((lat - (minLat + maxLat) / 2) * scale);
  const { track: trackW, ridden: riddenW } = mapStrokeWidths(widget.strokeWidth, w, h);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = trackW;
  ctx.beginPath();
  pts.forEach(([lon, lat], i) => {
    if (i === 0) ctx.moveTo(X(lon), Y(lat));
    else ctx.lineTo(X(lon), Y(lat));
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = riddenW;
  ctx.beginPath();
  let started = false;
  let curX = X(pts[0][0]);
  let curY = Y(pts[0][1]);
  for (const [lon, lat, t] of pts) {
    if (t > hist.t) break;
    if (!started) {
      ctx.moveTo(X(lon), Y(lat));
      started = true;
    } else ctx.lineTo(X(lon), Y(lat));
    curX = X(lon);
    curY = Y(lat);
  }
  if (started) ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(X(pts[0][0]) - 3, Y(pts[0][1]) - 3, 6, 6);
  ctx.fillStyle = style.accent;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(curX, curY, 5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Navigation map: 50 m behind + 400 m ahead, course-up, position arrow. */
function drawNavMap(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
  hist: OverlayHistory | undefined,
): void {
  void units;
  const style = resolveStyle(template, widget);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);
  const pts: [number, number, number][] = [];
  if (hist) {
    for (const s of hist.activity.samples) {
      if (typeof s.lat === 'number' && typeof s.lon === 'number') pts.push([s.lon, s.lat, s.t]);
    }
  }
  const missing = (): void => {
    drawLabelTop(ctx, style, widget.label ?? t('ovl.nav'), x, y, w, h);
    drawMissing(ctx, style, x, y + h * 0.15, w, h * 0.85);
  };
  if (pts.length < 2 || !hist) {
    missing();
    return;
  }
  // Course: GPS motion first, route direction as fallback.
  let course: number | undefined;
  const a = sampleAt(hist.activity, hist.t - 3);
  const b = sampleAt(hist.activity, hist.t);
  if (
    typeof a.lat === 'number' &&
    typeof a.lon === 'number' &&
    typeof b.lat === 'number' &&
    typeof b.lon === 'number' &&
    (a.lat !== b.lat || a.lon !== b.lon)
  ) {
    course = bearingDeg(a.lat, a.lon, b.lat, b.lon);
  }
  let i0 = 0;
  while (i0 + 1 < pts.length && pts[i0 + 1][2] <= hist.t) i0 += 1;
  if (course === undefined) {
    const here = pts[i0];
    const next = pts[i0 + 1];
    const prev = pts[i0 - 1];
    if (next && (next[0] !== here[0] || next[1] !== here[1])) {
      course = bearingDeg(here[1], here[0], next[1], next[0]);
    } else if (prev && (prev[0] !== here[0] || prev[1] !== here[1])) {
      course = bearingDeg(prev[1], prev[0], here[1], here[0]);
    }
  }
  if (course === undefined) {
    missing();
    return;
  }
  const heading: number = course;
  const origin = { lon: sample.lon ?? pts[i0][0], lat: sample.lat ?? pts[i0][1] };
  const { start, end } = navWindow(
    pts.map(([lon, lat, t]) => ({ lon, lat, t })),
    hist.t,
  );
  const pad = Math.min(w, h) * 0.08;
  const scale = (h - pad * 2) / 450;
  const dotX = x + w / 2;
  const dotY = y + h - pad - 50 * scale;
  const proj = (lon: number, lat: number): [number, number] => {
    const { fwd, right } = navProject(lon, lat, origin, heading);
    return [dotX + right * scale, dotY - fwd * scale];
  };
  const upcoming: [number, number][] = [proj(origin.lon, origin.lat)];
  const ridden: [number, number][] = [];
  for (let i = start; i <= end; i++) {
    const [lon, lat, t] = pts[i];
    const p = proj(lon, lat);
    if (t <= hist.t) ridden.push(p);
    if (t >= hist.t) upcoming.push(p);
  }
  ridden.push(proj(origin.lon, origin.lat));
  const { track: trackW, ridden: riddenW } = mapStrokeWidths(widget.strokeWidth, w, h);
  ctx.save();
  ctx.beginPath();
  const radius =
    style.shape === 'pill'
      ? Math.min(w, h) / 2
      : style.shape === 'none'
        ? 0
        : Math.min(10, h * 0.18);
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const trace = (line: [number, number][]): void => {
    ctx.beginPath();
    line.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = trackW;
  if (upcoming.length > 1) trace(upcoming);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = riddenW;
  if (ridden.length > 1) trace(ridden);
  // Position arrow, always pointing up.
  const s = Math.min(14, Math.max(7, Math.min(w, h) * 0.055));
  ctx.fillStyle = style.accent;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(dotX, dotY - s);
  ctx.lineTo(dotX - s * 0.7, dotY + s * 0.6);
  ctx.lineTo(dotX + s * 0.7, dotY + s * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const bearingDeg = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) / toRad + 360) % 360;
};

/** Heading compass from GPS motion, dial rotated so course points up. */
function drawCompass(
  ctx: Ctx,
  widget: WidgetDef,
  template: Template,
  sample: TelemetrySample,
  x: number,
  y: number,
  w: number,
  h: number,
  units: Units,
  hist: OverlayHistory | undefined,
): void {
  void units;
  void sample;
  const style = resolveStyle(template, widget);
  paintPanel(ctx, x, y, w, h, style.shape, style.background, style.backgroundOpacity);
  let course: number | undefined;
  if (hist && hist.t > 3) {
    const a = sampleAt(hist.activity, hist.t - 3);
    const b = sampleAt(hist.activity, hist.t);
    if (
      typeof a.lat === 'number' &&
      typeof a.lon === 'number' &&
      typeof b.lat === 'number' &&
      typeof b.lon === 'number' &&
      (a.lat !== b.lat || a.lon !== b.lon)
    ) {
      course = bearingDeg(a.lat, a.lon, b.lat, b.lon);
    }
  }
  if (course === undefined) {
    drawLabelTop(ctx, style, widget.label ?? t('ovl.compass'), x, y, w, h);
    drawMissing(ctx, style, x, y + h * 0.15, w, h * 0.85);
    return;
  }
  const cx = x + w / 2;
  const cy = y + h * 0.46;
  const r = Math.min(w, h * 0.72) / 2 - 8;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cards: [string, number][] = [
    ['N', 0],
    ['E', 90],
    ['S', 180],
    [t('ovl.west'), 270],
  ];
  for (const [glyph, deg] of cards) {
    const a = ((deg - course) * Math.PI) / 180 - Math.PI / 2;
    ctx.fillStyle = glyph === 'N' ? style.accent : style.text;
    ctx.font = `700 ${Math.max(8, h * 0.09) * style.labelScale}px ${style.labelFont}`;
    ctx.fillText(glyph, cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78);
  }
  ctx.fillStyle = style.accent;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.52);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.2);
  ctx.lineTo(cx + r * 0.1, cy + r * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.14 * style.valueScale}px ${style.valueFont}`;
  ctx.fillText(`${String(Math.round(course)).padStart(3, '0')}°`, cx, y + h * 0.88, w * 0.6);
  ctx.restore();
}

/** Goal progress: % of target distance + live ETA. */
function drawGoal(
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
  drawLabelTop(ctx, style, text.label, x, y, w, h);
  const target = (widget.range ?? [0, 20000])[1];
  const dist = sample.distance;
  if (typeof dist !== 'number' || target <= 0) {
    drawMissing(ctx, style, x, y, w, h);
    return;
  }
  const frac = Math.min(1, Math.max(0, dist / target));
  const pad = w * 0.06;
  const by = y + h * 0.52;
  const bh = Math.max(6, h * 0.1);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(x + pad, by, w - pad * 2, bh);
  ctx.fillStyle = style.accent;
  ctx.fillRect(x + pad, by, (w - pad * 2) * frac, bh);
  ctx.textAlign = 'center';
  ctx.fillStyle = style.text;
  ctx.font = `700 ${h * 0.24 * style.valueScale}px ${style.valueFont}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(frac * 100)} %`, x + w / 2, y + h * 0.34, w * 0.9);
  ctx.font = `600 ${Math.max(8, h * 0.11) * style.labelScale}px ${style.labelFont}`;
  ctx.fillStyle = style.accent;
  let sub: string;
  if (frac >= 1) {
    sub = t('ovl.goalDone');
  } else if (typeof sample.speed === 'number' && sample.speed > 0.5) {
    const eta = (target - dist) / sample.speed;
    const fmt = formatMetric('distance', target - dist, units);
    sub = t('ovl.goalEta', { v: fmt.value, u: fmt.unit, eta: formatSpan(eta) });
  } else {
    const fmt = formatMetric('distance', target - dist, units);
    sub = t('ovl.goalLeft', { v: fmt.value, u: fmt.unit });
  }
  ctx.fillText(sub, x + w / 2, y + h * 0.82, w * 0.92);
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
  hist?: OverlayHistory,
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
    switch (widget.kind) {
      case 'gauge':
        drawGauge(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'number':
        drawNumber(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'zones':
        drawZones(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'speedo':
        drawSpeedo(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'ring':
        drawRing(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'hbar':
        drawHbar(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'slope':
        drawSlope(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'gears':
        drawGears(ctx, widget, template, sample, x, y, w, h, units);
        break;
      case 'spark':
        drawSpark(ctx, widget, template, sample, x, y, w, h, units, hist);
        break;
      case 'profile':
        drawProfile(ctx, widget, template, sample, x, y, w, h, units, hist);
        break;
      case 'vam':
        drawVam(ctx, widget, template, sample, x, y, w, h, units, hist);
        break;
      case 'map':
        drawMap(ctx, widget, template, sample, x, y, w, h, units, hist);
        break;
      case 'navmap':
        drawNavMap(ctx, widget, template, sample, x, y, w, h, units, hist);
        break;
      case 'compass':
        drawCompass(ctx, widget, template, sample, x, y, w, h, units, hist);
        break;
      case 'goal':
        drawGoal(ctx, widget, template, sample, x, y, w, h, units);
        break;
      default:
        drawStat(ctx, widget, template, sample, x, y, w, h, units);
        break;
    }
  }
}
