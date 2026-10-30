// Generates a FIT activity fixture: N records @1Hz.
// Run: node fixtures/make-sample-fit.mjs [records=120] [name=sample] [enhanced]
// The `enhanced` variant mirrors newer Edge firmware: enhanced-only
// altitude/speed and no native grade (derived from elevation+distance).
import { Encoder, Profile } from '@garmin/fitsdk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(root, 'activity'), { recursive: true });
const argCount = Math.max(1, Number(process.argv[2]) || 120);
const argName = process.argv[3] || 'sample';
const enhancedOnly = process.argv[4] === 'enhanced';

const DEG_TO_SEMI = 2 ** 31 / 180;
const start = new Date('2026-10-26T10:00:00Z');
let lat = 40.4168;
let lon = -3.7038;
let distance = 0;

const encoder = new Encoder();
encoder.onMesg(Profile.MesgNum.FILE_ID, {
  manufacturer: 'development',
  product: 1,
  timeCreated: start,
  type: 'activity',
});

const N = argCount;
for (let i = 0; i < N; i++) {
  const speed = 9 + 2.5 * Math.sin(i / 8);
  const hr = Math.round(145 + 10 * Math.sin(i / 15) + 3 * Math.sin(i / 3));
  const power = Math.round(200 + 50 * Math.sin(i / 10));
  const cadence = Math.round(88 + 5 * Math.sin(i / 7));
  distance += speed;
  // Drift north-east; ~meters per degree.
  lat += (speed * 0.7) / 111320;
  lon += (speed * 0.7) / (111320 * Math.cos((lat * Math.PI) / 180));
  const ele = 500 + i * 0.4 + 2 * Math.sin(i / 12);
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: new Date(start.getTime() + i * 1000),
    positionLat: Math.round(lat * DEG_TO_SEMI),
    positionLong: Math.round(lon * DEG_TO_SEMI),
    ...(enhancedOnly ? { enhancedAltitude: ele, enhancedSpeed: speed } : { altitude: ele, speed }),
    heartRate: hr,
    cadence,
    distance,
    power,
    ...(enhancedOnly ? {} : { grade: 2 * Math.sin(i / 20) }),
  });
}

// A couple of shift events (Edge + AXS record them as event markers).
for (const [sec, rearNum, rearTeeth] of [
  [10, 5, 28],
  [60, 6, 24],
]) {
  encoder.onMesg(Profile.MesgNum.EVENT, {
    timestamp: new Date(start.getTime() + sec * 1000),
    event: 'rearGearChange',
    eventType: 'marker',
    rearGearNum: rearNum,
    rearGear: rearTeeth,
    frontGearNum: 1,
    frontGear: 34,
  });
}

const bytes = encoder.close();
const out = join(root, 'activity', `${argName}.fit`);
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes, ${N} records)`);
