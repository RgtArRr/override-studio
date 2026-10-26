// npm run check — one small runnable check for the pure logic (no frameworks).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFit, sampleAt, summarize, widgetValue } from '../web/src/telemetry.ts';
import { classifyAspect } from '../shared/src/template.ts';
import { getCreationTime } from '../web/src/video-meta.ts';

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
]);
const dims = { horizontal: [1280, 720], square: [720, 720], vertical: [720, 1280] };
const files = readdirSync(join(root, 'fixtures/templates')).filter((f) => f.endsWith('.json'));
assert.ok(files.length >= 8);
const KINDS = new Set(['stat', 'number', 'gauge']);
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

console.log(`check passed: fit(120 samples) + aspects + ${files.length} templates + mvhd + widgets`);
