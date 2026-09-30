// Desktop-preview smoke test (secondary path). Serves the site, drives both
// package paths through the accessible HTML buttons, checks results/reset and
// fails on any page error. Headset behaviour still requires Quest 2 testing.
//
//   npm run test:e2e              (needs the `playwright` package + Chromium)
//   SCREENSHOTS=dir npm run test:e2e
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const shots = process.env.SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const errors = [];
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(base);
  await page.waitForFunction(() => globalThis.__boot?.isReady, null, { timeout: 30000 });
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  await shot('01-welcome');
  await page.click('#welcome-preview');

  const act = async (id) => {
    const sel = `#actions button[data-id="${id}"]`;
    await page.waitForSelector(`${sel}:not([disabled])`, { timeout: 5000 });
    await page.click(sel);
  };
  const results = () => page.evaluate(() => globalThis.__app.engine.results());
  const state = (k) => page.evaluate((key) => globalThis.__app.engine.packageState(key), k);

  await shot('02-setup');
  await act('posture:seated');
  await act('posture:standing');
  await act('continue');
  await shot('03-briefing');
  await act('start');
  await act('assist:bring');
  await page.waitForTimeout(600);
  await shot('04-inspect-A');
  await act('condition:damaged');
  await act('decide:reject');
  await act('place:quarantine');
  assert.equal(await state('A'), 'quarantined');
  await act('assist:bring');
  await act('condition:intact');
  await act('decide:accept');
  await act('scan');
  await page.waitForTimeout(600);
  await shot('05-scan-B');
  await act('place:scale');
  await page.waitForTimeout(500);
  await shot('06-weigh-B');
  await act('weight:within');
  await act('place:outbound');
  await act('release');
  await page.waitForTimeout(400);
  let r = await results();
  assert.equal(r.score, 100, 'perfect run scores 100');
  assert.equal(r.status, 'proficient');
  assert.equal(r.criticalErrors.length, 0);
  assert.ok(await page.isVisible('#results table'), 'results table shown');
  assert.match(await page.textContent('#title'), /proficiency met/);
  await shot('07-results');
  await act('results:details');
  await shot('08-results-details');

  // Replay, then an error-path run.
  await act('replay');
  r = await results();
  assert.equal(r.score, 0);
  assert.equal(await state('A'), 'waiting');
  assert.equal(await page.evaluate(() => globalThis.__app.engine.log.length), 0);
  await act('continue');
  await act('start');
  await act('assist:bring');
  await act('condition:damaged');
  await act('decide:accept'); // critical
  assert.equal(await page.getAttribute('#feedback', 'data-tone'), 'critical');
  assert.equal(await page.getAttribute('#feedback', 'aria-live'), 'assertive');
  await shot('09-critical');
  await act('decide:reject');
  await act('place:quarantine');
  await act('assist:bring');
  await act('condition:intact');
  await act('decide:accept');
  await act('place:outbound'); // premature → critical, blocked
  assert.equal(await state('B'), 'accepted');
  // Help pauses scoring; actions are blocked until resume.
  await act('help');
  assert.equal(await page.evaluate(() => globalThis.__app.engine.isPaused()), true);
  await shot('10-help');
  await page.click('#help-actions button[data-id="resume"]');
  assert.equal(await page.evaluate(() => globalThis.__app.engine.isPaused()), false);
  await act('scan');
  await act('place:scale');
  await act('weight:within');
  await act('place:outbound');
  await act('release');
  r = await results();
  assert.equal(r.complete, true);
  assert.equal(r.status, 'practice');
  assert.equal(r.criticalErrors.length, 2);
  assert.equal(r.score, 70);

  // Narrow / zoomed layout stays usable (1280×720 at 200% ≈ 640×360 CSS px).
  await page.setViewportSize({ width: 640, height: 360 });
  await page.waitForTimeout(200);
  await shot('11-narrow');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'no horizontal overflow at 200% zoom equivalent');

  assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
  console.log('desktop smoke: OK');

  await vrLogic(browser, errors);
  assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
  console.log('vr interaction logic (simulated controllers): OK');
} catch (err) {
  failed = true;
  console.error(err);
  if (errors.length) console.error(errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------
// VR interaction logic with simulated controllers. Headless Chromium has no
// XR device, so this marks the app as "in XR" and positions controller grip
// matrices directly. It exercises grab/drop targets, hand scanning, tracking
// loss, disconnect/resume, missed drops and exit — not real WebXR rendering.
async function vrLogic(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror(vr): ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console(vr): ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => globalThis.__boot?.isReady, null, { timeout: 30000 });
  await page.evaluate(() => {
    const app = globalThis.__app;
    app.settings.reducedMotion = true; // instant snaps for deterministic checks
    app.xr = { session: { end: async () => app.onXREnd() }, floor: true, visibility: 'visible' };
    const c = app.xrInput.controllers[0];
    c.connected = true;
    c.source = { targetRayMode: 'tracked-pointer', handedness: 'right', gamepad: null };
    c.grip.visible = true;
    globalThis.__grip = (x, y, z, yaw = 0) => {
      const V = c.grip.position.constructor;
      const Q = c.grip.quaternion.constructor;
      const p = app.station.localToWorld(new V(x, y, z));
      c.grip.matrix.compose(p, new Q().setFromAxisAngle(new V(0, 1, 0), yaw), new V(1, 1, 1));
      c.grip.updateMatrixWorld(true);
    };
    globalThis.__squeeze = () => { c.near = app.xrInput.nearest(c); app.xrInput.onSqueeze(c); return c.held; };
    globalThis.__let = () => app.xrInput.onSqueezeEnd(c);
    globalThis.__trigger = () => app.xrInput.onSelect(c);
  });
  const L = await page.evaluate(async () => (await import('./src/scene.js')).LAYOUT);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const st = (k) => ev((key) => globalThis.__app.engine.packageState(key), k);
  const zone = (k) => ev((key) => globalThis.__app.phys[key].zone, k);
  const act = (id) => ev((i) => globalThis.__app.dispatch(i, 'xr'), id);
  const grip = (x, y, z, yaw) => ev(([a, b, c2, d]) => globalThis.__grip(a, b, c2, d), [x, y, z, yaw ?? 0]);

  // Packages cannot be grabbed before the exercise starts.
  await grip(L.mat.x, 0.12, L.mat.z);
  assert.equal(await ev(() => globalThis.__squeeze()), null);
  await act('continue');
  await act('start');

  // Package A: grab → inspect → reject → drop into the quarantine tote.
  assert.equal(await ev(() => globalThis.__squeeze()), 'A');
  assert.equal(await st('A'), 'inspecting');
  await act('condition:damaged');
  await act('decide:reject');
  await grip(L.tote.x, 0.3, L.tote.z);
  await ev(() => globalThis.__let());
  assert.equal(await st('A'), 'quarantined');
  assert.equal(await zone('A'), 'quarantine');
  // Quarantined package stays put and cannot be picked back up.
  await grip(L.tote.x, 0.14, L.tote.z);
  assert.equal(await ev(() => globalThis.__squeeze()), null);

  // Package B.
  await grip(L.incoming.x, 0.13, L.incoming.z);
  assert.equal(await ev(() => globalThis.__squeeze()), 'B');
  await act('condition:intact');
  await act('decide:accept');

  // Tracking loss while holding: frozen in place, not dropped.
  await grip(0, 0.35, -0.5);
  await ev(() => { globalThis.__app.xrInput.controllers[0].grip.visible = false; });
  await page.waitForFunction(() => globalThis.__app.xrInput.controllers[0].held === null, null, { timeout: 5000 });
  assert.equal(await zone('B'), 'frozen');
  const frozenY = await ev(() => globalThis.__app.world.packages.B.group.position.y);
  assert.ok(Math.abs(frozenY - 0.35) < 0.01, `frozen at hand height, got ${frozenY}`);
  await ev(() => { globalThis.__app.xrInput.controllers[0].grip.visible = true; });

  // Controller disconnect: pause; Resume refused until tracking returns.
  await ev(() => globalThis.__app.xrInput.onDisconnected(globalThis.__app.xrInput.controllers[0]));
  await page.waitForFunction(() => globalThis.__app.engine.pauseReasons.has('input'));
  await act('resume');
  assert.equal(await ev(() => globalThis.__app.engine.isPaused()), true, 'cannot resume without tracking');
  assert.equal(await ev(() => globalThis.__app.engine.place('B', 'scale', { input: 'xr' }).code), 'PAUSED');
  await ev(() => {
    const c = globalThis.__app.xrInput.controllers[0];
    c.grip.visible = true;
    globalThis.__app.xrInput.onConnected(c, { targetRayMode: 'tracked-pointer', handedness: 'right', gamepad: null });
  });
  await act('resume');
  assert.equal(await ev(() => globalThis.__app.engine.isPaused()), false);

  // Missed drop off the bench → floor, no penalty, Retrieve brings it back.
  const scoreBefore = await ev(() => globalThis.__app.engine.score());
  await grip(0, 0.35, -0.5);
  assert.equal(await ev(() => globalThis.__squeeze()), 'B');
  await grip(-1.4, 0.3, 0.4);
  await ev(() => globalThis.__let());
  assert.equal(await zone('B'), 'floor');
  await act('retrieve');
  assert.equal(await zone('B'), 'bench');
  assert.equal(await ev(() => globalThis.__app.engine.score()), scoreBefore);

  // Premature drop on the conveyor: blocked, critical, package returns to bench.
  await grip(L.mat.x, 0.13, L.mat.z);
  assert.equal(await ev(() => globalThis.__squeeze()), 'B');
  await grip(L.conveyor.x, 0.25, L.conveyor.intakeZ);
  await ev(() => globalThis.__let());
  assert.equal(await st('B'), 'accepted');
  assert.equal(await zone('B'), 'bench');
  assert.equal(await ev(() => globalThis.__app.engine.criticals.length), 1);

  // Hand scan: barcode facing away → no read; facing the scanner → scanned.
  await grip(L.mat.x, 0.13, L.mat.z);
  assert.equal(await ev(() => globalThis.__squeeze()), 'B');
  const [w, h, d] = [0.36, 0.26, 0.28];
  const Z = L.scanZone;
  const cx = Z.x - 0.09 * w;
  const cy = Z.y + 0.12 * h;
  await grip(Z.x + 0.09 * w, cy, Z.z - d / 2 + 0.02, 0); // label faces the user
  await ev(() => globalThis.__trigger());
  assert.equal(await st('B'), 'accepted');
  assert.match(await ev(() => globalThis.__app.feedback.text), /No read/);
  await grip(cx + 0.09 * w * 2, cy, Z.z + d / 2, Math.PI); // turned toward the scanner
  const align = await ev(() => globalThis.__app.scanAlignment('B'));
  assert.ok(align.aligned, `barcode aligned: ${JSON.stringify(align)}`);
  await ev(() => globalThis.__trigger());
  assert.equal(await st('B'), 'scanned');

  // Scale, weight confirmation, conveyor staging, explicit release.
  await grip(L.scale.x, 0.3, L.scale.z);
  await ev(() => globalThis.__let());
  assert.equal(await st('B'), 'weighed');
  assert.equal(await zone('B'), 'scale');
  await act('weight:within');
  await grip(L.scale.x, L.scale.top + 0.13, L.scale.z);
  assert.equal(await ev(() => globalThis.__squeeze()), 'B');
  await grip(L.conveyor.x, 0.25, L.conveyor.intakeZ);
  await ev(() => globalThis.__let());
  assert.equal(await st('B'), 'staged');
  // Picking it back off the conveyor un-stages it (targets never auto-route).
  await grip(L.conveyor.x, L.conveyor.top + 0.13, L.conveyor.intakeZ);
  assert.equal(await ev(() => globalThis.__squeeze()), 'B');
  assert.equal(await st('B'), 'weight_confirmed');
  await grip(L.conveyor.x, 0.25, L.conveyor.intakeZ);
  await ev(() => globalThis.__let());
  await act('release');
  const r = await ev(() => globalThis.__app.engine.results());
  assert.equal(r.complete, true);
  assert.equal(r.score, 80);
  assert.equal(r.status, 'practice', 'premature release stays on the record');

  // Replay, start, then exit VR midway: paused, never complete or passing.
  await act('replay');
  await act('continue');
  await act('start');
  await ev(() => globalThis.__app.xr.session.end());
  const after = await ev(() => ({
    paused: [...globalThis.__app.engine.pauseReasons],
    res: globalThis.__app.engine.results(),
    xr: globalThis.__app.xr,
  }));
  assert.deepEqual(after.paused, ['xr-exit']);
  assert.equal(after.res.status, 'incomplete');
  assert.equal(after.xr, null);
  await page.close();
}
