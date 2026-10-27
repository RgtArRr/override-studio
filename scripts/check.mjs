// npm run check — one small runnable check for the pure logic (no frameworks).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillDerivedGrade, parseFit, sampleAt, summarize, widgetValue } from '../web/src/telemetry.ts';
import { STRINGS, resolveLocale, setLocale, t } from '../web/src/i18n.ts';
import { classifyAspect, parseTemplateJson } from '../shared/src/template.ts';
import { formatElapsed, formatMetric } from '../web/src/format.ts';
import {
  getCreationDate,
  getCreationTime,
  resolveVideoInstant,
} from '../web/src/video-meta.ts';
import {
  METRIC_IDS,
  WIDGET_KINDS,
  defaultMetricFor,
  makeWidgetDef,
  kindLabel,
  mapStrokeWidths,
  metricLabel,
  navProject,
  navWindow,
  nextWidgetId,
} from '../web/src/widgets.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fitBytes = readFileSync(join(root, 'fixtures/activity/sample.fit'));
const fitBuf = fitBytes.buffer.slice(fitBytes.byteOffset, fitBytes.byteOffset + fitBytes.byteLength);

// FIT parsing (trust boundary).
const act = parseFit(fitBuf);
assert.equal(act.samples.length, 120);
assert.equal(act.durationSec, 119);
assert.equal(act.samples[0].t, 0);
assert.ok(typeof act.samples[0].lat === 'number');
assert.throws(() => parseFit(new ArrayBuffer(32)), /FIT/);

// Derived grade fills only when native grade is fully absent.
const gs = [
  { t: 0, elevation: 100, distance: 0 },
  { t: 10, elevation: 110, distance: 100 },
  { t: 20, elevation: 120, distance: 200 },
];
fillDerivedGrade(gs);
assert.equal(gs[1].grade, 10);
const native = [
  { t: 0, grade: 5, elevation: 100, distance: 0 },
  { t: 10, elevation: 110, distance: 100 },
];
fillDerivedGrade(native);
assert.equal(native[1].grade, undefined);
const stopped = [
  { t: 0, elevation: 100, distance: 0 },
  { t: 10, elevation: 100, distance: 2 },
];
fillDerivedGrade(stopped);
assert.equal(stopped[0].grade, 0);
const noElev = [{ t: 0, distance: 0 }];
fillDerivedGrade(noElev);
assert.equal(noElev[0].grade, undefined);

// Interpolation + clamp.
const mid = sampleAt(act, 30.5);
assert.equal(mid.t, 30.5);
const avg = (act.samples[30].speed + act.samples[31].speed) / 2;
assert.ok(Math.abs(mid.speed - avg) < 1e-9);
assert.equal(sampleAt(act, 9999).t, 119);
assert.equal(sampleAt(act, -5).t, 0);

// Summary sanity.
const s = summarize(act);
assert.equal(s.samples, 120);
assert.ok(s.distanceM > 1000 && s.distanceM < 1300);
assert.ok(s.avgSpeed > 8 && s.avgSpeed < 11);

// Aspect classification incl. edges.
assert.equal(classifyAspect(1280, 720), 'horizontal');
assert.equal(classifyAspect(720, 1280), 'vertical');
assert.equal(classifyAspect(720, 720), 'square');
assert.equal(classifyAspect(800, 1000), 'square');
assert.equal(classifyAspect(1250, 1000), 'square');

// Template layouts.
const METRICS = new Set([
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
]);
const dims = { horizontal: [1280, 720], square: [720, 720], vertical: [720, 1280] };
const files = readdirSync(join(root, 'fixtures/templates')).filter((f) => f.endsWith('.json'));
assert.ok(files.length >= 8);
const KINDS = new Set([
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
]);
const SHAPES = new Set(['rect', 'pill', 'none']);
for (const file of files) {
  const t = JSON.parse(readFileSync(join(root, 'fixtures/templates', file), 'utf8'));
  assert.equal(t.schemaVersion, 2, file);
  for (const w of t.widgets) {
    assert.ok(KINDS.has(w.kind), `${file} ${w.id} kind`);
    if (w.style?.shape) assert.ok(SHAPES.has(w.style.shape), `${file} ${w.id} shape`);
    if (w.range) {
      assert.ok(Array.isArray(w.range) && w.range.length === 2 && w.range[0] < w.range[1], `${file} ${w.id} range`);
    }
    if (w.strokeWidth !== undefined) {
      assert.ok(typeof w.strokeWidth === 'number' && w.strokeWidth > 0, `${file} ${w.id} strokeWidth`);
    }
  }
  for (const [aspect, [W, H]] of Object.entries(dims)) {
    const boxes = t.widgets.map((w) => {
      assert.ok(METRICS.has(w.metric), `${file} ${w.id}`);
      return w.layout[aspect];
    });
    for (const b of boxes) {
      assert.ok(b.x + b.w <= 1.001 && b.y + b.h <= 1.001, `${file}@${aspect} frame`);
      assert.ok(b.w * W >= 24 && b.h * H >= 16, `${file}@${aspect} size`);
      assert.ok(b.w * 512 >= 24 && b.h * 288 >= 16, `${file}@${aspect} thumb`);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!hit, `${file}@${aspect} overlap`);
      }
    }
  }
}

// mvhd creation_time parsing.
const mvhd = (version, creation) => {
  const b = new Uint8Array(32);
  b.set([0x6d, 0x76, 0x68, 0x64], 4);
  b[8] = version;
  const dv = new DataView(b.buffer);
  if (version === 1) {
    dv.setUint32(12, 0);
    dv.setUint32(16, creation);
  } else {
    dv.setUint32(12, creation);
  }
  return b;
};
const KNOWN = 3875513055; // 2026-10-22T11:24:15Z
assert.equal(
  (await getCreationTime(new Blob([mvhd(0, KNOWN)]))).toISOString(),
  '2026-10-22T11:24:15.000Z',
);
assert.equal(
  (await getCreationTime(new Blob([mvhd(1, KNOWN)]))).toISOString(),
  '2026-10-22T11:24:15.000Z',
);
assert.equal(await getCreationTime(new Blob([new Uint8Array(32)])), null);
assert.equal(await getCreationTime(new Blob([mvhd(0, 0)])), null);
const big = new Uint8Array(1500000);
big.set(mvhd(0, KNOWN), big.length - 100);
assert.equal(
  (await getCreationTime(new Blob([big]))).toISOString(),
  '2026-10-22T11:24:15.000Z',
);
assert.equal(
  (await getCreationTime(new Blob([readFileSync(join(root, 'fixtures/video/sample-720p.mp4'))]))).toISOString(),
  '2026-10-26T10:00:05.000Z',
);
assert.equal(
  await getCreationTime(new Blob([readFileSync(join(root, 'fixtures/video/sample-vertical.mp4'))])),
  null,
);

// Time widget shows FIT elapsed at the rendered moment.
const probe = { t: 999, speed: 10, heartRate: 150 };
assert.equal(widgetValue('elapsedTime', probe), 999);
assert.equal(widgetValue('speed', probe), 10);
assert.equal(widgetValue('power', probe), undefined);

// Widget catalog + factory (right panel: add widget, switch metric/kind).
const kindValues = WIDGET_KINDS;
assert.deepEqual(new Set(kindValues), KINDS);
const metricValues = METRIC_IDS;
assert.equal(metricValues.length, METRICS.size);
for (const m of metricValues) assert.ok(METRICS.has(m), `catalog metric ${m}`);
for (const kind of kindValues) {
  assert.ok(METRICS.has(defaultMetricFor(kind)), `default metric ${kind}`);
  const def = makeWidgetDef(kind, defaultMetricFor(kind), `t-${kind}`, 0);
  assert.equal(def.visible, true);
  assert.equal(def.kind, kind);
  for (const [aspect, [W, H]] of Object.entries(dims)) {
    const b = def.layout[aspect];
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001, `${kind}@${aspect} frame`);
    assert.ok(b.w * W >= 24 && b.h * H >= 16, `${kind}@${aspect} size`);
    assert.ok(b.w * 512 >= 24 && b.h * 288 >= 16, `${kind}@${aspect} thumb`);
  }
}
// Ids stay unique and cascaded copies stay inside the frame.
assert.equal(nextWidgetId(new Set(['gauge', 'gauge-2']), 'gauge'), 'gauge-3');
assert.equal(nextWidgetId(new Set(['gauge']), 'stat'), 'stat');
for (let slot = 0; slot < 8; slot++) {
  const def = makeWidgetDef('map', 'none', `m${slot}`, slot);
  for (const aspect of Object.keys(dims)) {
    const b = def.layout[aspect];
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001, `cascade@${aspect}#${slot}`);
  }
}

// Map stroke widths: explicit px wins (trail at 70%), else auto from the box.
const autoW = mapStrokeWidths(undefined, 397, 396);
assert.ok(Math.abs(autoW.ridden - 396 * 0.013) < 1e-9);
assert.ok(Math.abs(autoW.track - 396 * 0.009) < 1e-9);
assert.ok(autoW.ridden > autoW.track);
const tinyW = mapStrokeWidths(undefined, 24, 16);
assert.equal(tinyW.track, 2.5);
assert.equal(tinyW.ridden, 3.5);
const expW = mapStrokeWidths(6, 397, 396);
assert.equal(expW.ridden, 6);
assert.ok(Math.abs(expW.track - 4.2) < 1e-9);
assert.equal(mapStrokeWidths(0, 100, 100).ridden, 1);
assert.equal(mapStrokeWidths(-3, 100, 100).track, 1);
assert.deepEqual(mapStrokeWidths(NaN, 100, 100), mapStrokeWidths(undefined, 100, 100));

// Nav window + course-up projection (synthetic straight track, 10 m spacing).
const DEG10 = 10 / 110540;
const track = [];
for (let i = 0; i <= 100; i++) track.push({ lon: -3.7, lat: 40.4 + i * DEG10, t: i });
const win = navWindow(track, 50, 55, 405);
assert.equal(win.start, 44);
assert.equal(win.end, 91);
assert.equal(navWindow(track, 0, 55, 405).start, 0);
assert.equal(navWindow(track, 100, 55, 405).end, 100);
const pN = navProject(track[60].lon, track[60].lat, track[50], 0);
assert.ok(Math.abs(pN.fwd - 100) < 0.5 && Math.abs(pN.right) < 0.5);
const pE = navProject(track[60].lon, track[60].lat, track[50], 90);
assert.ok(Math.abs(pE.fwd) < 0.5 && Math.abs(pE.right + 100) < 0.5);

// com.apple.quicktime.creationdate: wall reading + embedded offset.
const mkMdta = (payload) => {
  const enc = new TextEncoder();
  const key = enc.encode('creationdate');
  const data = enc.encode(payload);
  const box = new Uint8Array(16 + data.length);
  const dv = new DataView(box.buffer);
  dv.setUint32(0, box.length);
  box.set([0x64, 0x61, 0x74, 0x61], 4); // 'data'
  dv.setUint32(8, 1); // utf-8
  dv.setUint32(12, 0); // locale
  box.set(data, 16);
  const out = new Uint8Array(key.length + 8 + box.length);
  out.set(key, 0);
  out.set(box, key.length + 8);
  return new Blob([out]);
};
const cd = await getCreationDate(mkMdta('2026-10-22T11:24:15-0600'));
assert.equal(cd.wallMs, Date.UTC(2026, 9, 22, 11, 24, 15));
assert.equal(cd.offsetMin, -360);
const cdZ = await getCreationDate(mkMdta('2026-10-22T11:24:15Z'));
assert.equal(cdZ.offsetMin, 0);
assert.equal(await getCreationDate(new Blob([new Uint8Array(64)])), null);
assert.equal(await getCreationDate(mkMdta('not-a-date')), null);
// iPhone layout: a decoy value first, real date ~600 bytes after the key.
const mkGap = (payload, gap) => {
  const enc = new TextEncoder();
  const key = enc.encode('creationdate');
  const decoy = enc.encode('3.466196');
  const dbox = new Uint8Array(16 + decoy.length);
  const dd = new DataView(dbox.buffer);
  dd.setUint32(0, dbox.length);
  dbox.set([0x64, 0x61, 0x74, 0x61], 4);
  dd.setUint32(8, 1);
  dd.setUint32(12, 0);
  dbox.set(decoy, 16);
  const data = enc.encode(payload);
  const box = new Uint8Array(16 + data.length);
  const dv = new DataView(box.buffer);
  dv.setUint32(0, box.length);
  box.set([0x64, 0x61, 0x74, 0x61], 4);
  dv.setUint32(8, 1);
  dv.setUint32(12, 0);
  box.set(data, 16);
  const out = new Uint8Array(key.length + dbox.length + gap + box.length);
  out.set(key, 0);
  out.set(dbox, key.length);
  out.set(box, key.length + dbox.length + gap);
  return new Blob([out]);
};
const cdGap = await getCreationDate(mkGap('2026-10-22T06:24:15-0500', 600));
assert.equal(cdGap.wallMs, Date.UTC(2026, 9, 22, 6, 24, 15));
assert.equal(cdGap.offsetMin, -300);

// resolveVideoInstant: fixed offsets reinterpret the file wall reading.
const WALL = Date.UTC(2026, 9, 22, 16, 0, 0);
assert.equal(resolveVideoInstant(WALL, -6), WALL + 6 * 3600e3);
assert.equal(resolveVideoInstant(WALL, 5.5), WALL - 5.5 * 3600e3);
assert.equal(resolveVideoInstant(WALL, 0), WALL);

// i18n: stored preference wins, else navigator autodetect, else English.
assert.equal(resolveLocale('en', ['es-ES']), 'en');
assert.equal(resolveLocale('es', ['en-US']), 'es');
assert.equal(resolveLocale('fr', ['es-MX']), 'es');
assert.equal(resolveLocale(null, ['es-ES', 'es']), 'es');
assert.equal(resolveLocale(null, ['en-US']), 'en');
assert.equal(resolveLocale(null, []), 'en');
assert.equal(resolveLocale(null, ['fr-FR', 'de']), 'en');
assert.equal(resolveLocale(null, ['ES-mx']), 'es');
// Both locales carry the same keys; interpolation + fallback hold.
assert.deepEqual(Object.keys(STRINGS.es).sort(), Object.keys(STRINGS.en).sort());
setLocale('en');
assert.equal(t('clip.title'), 'Clip');
assert.equal(t('st.clipAdded', { name: 'X' }), 'Clip added: X.');
assert.equal(t('no.such.key'), 'no.such.key');
assert.equal(kindLabel('speedo'), 'Speedometer');
assert.equal(metricLabel('heartRate'), 'Heart rate');
assert.throws(() => parseFit(new Uint8Array(8).buffer), /not a valid FIT/);
setLocale('es');
assert.equal(t('clip.title'), 'Clip');
assert.equal(kindLabel('speedo'), 'Velocímetro');
assert.equal(metricLabel('heartRate'), 'Frecuencia cardiaca');
assert.throws(() => parseFit(new Uint8Array(8).buffer), /no es un FIT/);

// Template export/import roundtrip: every fixture parses, and bad shapes throw.
for (const f of files) {
  const tpl = parseTemplateJson(readFileSync(join(root, 'fixtures/templates', f), 'utf8'));
  assert.equal(tpl.schemaVersion, 2);
  assert.ok(tpl.name.length > 0);
  assert.ok(Array.isArray(tpl.widgets));
  assert.equal(parseTemplateJson(JSON.stringify(tpl)).widgets.length, tpl.widgets.length);
}
assert.throws(() => parseTemplateJson('no json'), /not a template/);
assert.throws(() => parseTemplateJson('{}'), /not a template/);
assert.throws(() => parseTemplateJson('{"name":"x"}'), /not a template/);
assert.throws(() => parseTemplateJson('{"name":"x","widgets":[null]}'), /not a template/);
assert.throws(
  () => parseTemplateJson('{"name":"x","widgets":[{"id":"a","kind":"stat"}]}'),
  /not a template/,
);
const slim = parseTemplateJson('{"name":"","widgets":[]}');
assert.equal(slim.id, 'imported');
assert.equal(slim.theme.accent, '#7dd3fc');

// Elapsed-time formats (+ roundtrip through template JSON).
assert.equal(formatElapsed(5025), '1:23:45');
assert.equal(formatElapsed(90), '01:30');
assert.equal(formatElapsed(5025, 'hmm'), '1:23');
assert.equal(formatElapsed(5025, 'hmmss'), '1:23:45');
assert.equal(formatElapsed(90, 'hmmss'), '0:01:30');
assert.equal(formatElapsed(5025, 'h'), '1h');
assert.equal(formatElapsed(5025, 'hm'), '1h 23m');
assert.equal(formatMetric('elapsedTime', 5025, 'metric', 'h').value, '1h');
assert.equal(formatMetric('elapsedTime', 90, 'metric').value, '01:30');
const box = { x: 0, y: 0, w: 1, h: 1 };
const withFmt = parseTemplateJson(
  JSON.stringify({
    name: 't',
    widgets: [
      { id: 'a', kind: 'stat', metric: 'elapsedTime', timeFormat: 'hm', layout: { vertical: box, square: box, horizontal: box } },
    ],
  }),
);
assert.equal(withFmt.widgets[0].timeFormat, 'hm');

console.log(`check passed: fit(120 samples) + aspects + ${files.length} templates + mvhd + widgets + catalog(${kindValues.length} kinds) + i18n + tpljson`);
