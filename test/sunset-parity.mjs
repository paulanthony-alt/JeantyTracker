// Verifies the app model (js/sunset.js) and the service-worker model (sw.js)
// produce identical sunset scores, and checks calibration against reference
// scenarios so a hazy/washed-out sky can't score high again.
import assert from 'node:assert';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sunsetScoreForHour } from '../js/sunset.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Load sw.js in a sandbox with stubs so we can call its top-level sunsetScore().
const swSrc = fs.readFileSync(path.join(dir, '../sw.js'), 'utf8');
const sandbox = {
  self: { addEventListener() {}, registration: {}, clients: {}, location: { origin: '' }, skipWaiting() {} },
  caches: { open: async () => ({ match: async () => null, put: async () => {}, addAll: async () => {} }),
           keys: async () => [], match: async () => null, delete: async () => {} },
  fetch: async () => ({ json: async () => ({}) }),
  URL, Map, Math, Date, JSON, Response: class {}, console,
};
vm.createContext(sandbox);
vm.runInContext(swSrc, sandbox);
const swScore = sandbox.sunsetScore;
assert.equal(typeof swScore, 'function', 'sw.js must define sunsetScore');

const cases = [
  { n: 'vivid cirrus, clean dry horizon', h: { cloudHigh:45, cloudMid:15, cloudLow:5,  humidity:40, visibility:24000, precip:0, aod:0.10 } },
  { n: 'HAZY milky veil (the photo)',      h: { cloudHigh:55, cloudMid:40, cloudLow:15, humidity:80, visibility:11000, precip:0, aod:0.30 } },
  { n: 'low overcast',                     h: { cloudHigh:10, cloudMid:30, cloudLow:90, humidity:85, visibility:9000,  precip:0.2, aod:0.10 } },
  { n: 'clear dry sky',                    h: { cloudHigh:2,  cloudMid:1,  cloudLow:5,  humidity:40, visibility:25000, precip:0, aod:0.05 } },
  { n: 'rainy',                            h: { cloudHigh:60, cloudMid:70, cloudLow:80, humidity:95, visibility:6000,  precip:1.5, aod:0.2 } },
  { n: 'no aod (null) hazy',               h: { cloudHigh:50, cloudMid:30, cloudLow:20, humidity:78, visibility:12000, precip:0, aod:null } },
  { n: 'good cirrus, slightly humid',      h: { cloudHigh:35, cloudMid:20, cloudLow:10, humidity:62, visibility:20000, precip:0, aod:0.12 } },
];

console.log('scenario                          app  sw');
let allMatch = true;
for (const c of cases) {
  const a = sunsetScoreForHour(c.h);
  const s = swScore(c.h);
  const ok = a === s;
  allMatch = allMatch && ok;
  console.log(c.n.padEnd(34), String(a).padStart(3), String(s).padStart(3), ok ? '✓' : '✗ MISMATCH');
}
assert.ok(allMatch, 'app and sw scores must match exactly');

// Calibration guards
const score = (h) => sunsetScoreForHour(h);
const vivid = score(cases[0].h), hazy = score(cases[1].h), overcast = score(cases[2].h), clear = score(cases[3].h);
assert.ok(vivid >= 80, `vivid should be >=80, got ${vivid}`);
assert.ok(hazy <= 55, `hazy veil should be <=55 (was 80 before), got ${hazy}`);
assert.ok(hazy < vivid - 25, 'hazy must be well below vivid');
assert.ok(overcast <= 30, `overcast should be <=30, got ${overcast}`);
assert.ok(clear <= 50, `clear plain sky should be modest, got ${clear}`);
console.log('\nAll parity + calibration checks passed ✓');
