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
  // Autoplay flag: the headless test has no real user gesture before videos play.
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
  const sessionResults = () => page.evaluate(() => globalThis.__app.session.results());
  const state = (k) => page.evaluate((key) => globalThis.__app.engine.packageState(key), k);
  const settle = () => page.waitForFunction(() => !globalThis.__app.transition, null, { timeout: 5000 });
  const pick = (k) => page.evaluate((key) => globalThis.__app.dispatch(`pk:pick:${key}`, 'desktop'), k);
  // One whole tote through the accessible buttons, read from the scenario.
  const packToteUI = async () => {
    const sc = await page.evaluate(() => {
      const o = globalThis.__app.session.pack.scenario;
      return { items: o.itemOrder.map((k) => ({ k, on: o.items[k].onOrder, fragile: o.items[k].fragile })), carton: o.correctCarton };
    });
    await act('pk:scan:tote');
    for (const it of sc.items) { await pick(it.k); await act('pk:scan:item'); }
    for (const it of sc.items.filter((i) => !i.on)) { await pick(it.k); await act('pk:divert'); }
    await act(`pk:carton:${sc.carton}`);
    for (const it of sc.items.filter((i) => i.on)) { await pick(it.k); await act('pk:pack'); }
    if (sc.items.some((i) => i.on && i.fragile)) { await act('pk:dunnage'); await act('pk:dunnage'); }
    for (const id of ['pk:seal', 'pk:weight:within', 'pk:print', 'pk:apply', 'pk:outbound', 'release']) await act(id);
  };
  // One Station 2 package, done right, through the buttons.
  const dockPackageUI = async (k) => {
    const damaged = await page.evaluate((key) => globalThis.__app.engine.scenario.packages[key].condition === 'damaged', k);
    await act('assist:bring');
    await act(damaged ? 'condition:damaged' : 'condition:intact');
    if (damaged) {
      await act('decide:reject');
      await act('place:quarantine');
    } else {
      for (const id of ['decide:accept', 'scan', 'place:scale', 'weight:within', 'place:outbound', 'release']) await act(id);
    }
    assert.equal(await state(k), damaged ? 'quarantined' : 'outbound');
  };

  await shot('02-setup');
  // Bench height: labelled section with a cm readout, plus the physical switch under the bench edge.
  assert.match(await page.textContent('#actions'), /Bench height\s*92 cm/i);
  const viaSwitch = await page.evaluate(() => {
    const app = globalThis.__app;
    const btn = app.pack.w.heightSwitch.buttons[1];
    const V = btn.position.constructor;
    const target = btn.getWorldPosition(new V());
    const origin = target.clone().add(new V(0, 0.4, 0.3));
    const rc = app.desktop.raycaster;
    rc.set(origin, target.clone().sub(origin).normalize());
    const hit = app.pick(rc);
    const before = app.settings.benchHeight;
    if (hit?.kind === 'button') app.dispatch(hit.action, 'xr');
    return { kind: hit?.kind, action: hit?.action, delta: +(app.settings.benchHeight - before).toFixed(3) };
  });
  assert.deepEqual(viaSwitch, { kind: 'button', action: 'height:up', delta: 0.03 });
  assert.match(await page.textContent('#actions'), /95 cm/);
  await act('height:down');
  assert.match(await page.textContent('#actions'), /92 cm/);
  await act('posture:seated');
  await act('posture:standing');
  await act('continue');
  await shot('03-briefing');

  // Station 1 · Pack-Out, perfect run via the accessible buttons.
  await act('station:pack');
  await shot('03a-pack-start');
  await act('pk:scan:tote');
  await act('pk:scan:item'); // mug (selected first)
  await act('pk:select');
  await act('pk:scan:item'); // book
  await act('pk:select');
  await act('pk:scan:item'); // phone case → not on order
  await shot('03b-pack-scanned');
  await act('pk:divert');
  await act('pk:carton:M');
  await act('pk:pack'); // mug
  await act('pk:pack'); // book
  await act('pk:dunnage');
  await act('pk:dunnage');
  await act('pk:seal');
  await page.waitForTimeout(300);
  await shot('03c-pack-sealed');
  await act('pk:weight:within');
  await act('pk:print');
  await act('pk:apply');
  await act('pk:outbound');
  await act('release');
  // Tote 1 shipped: tote 2 rolls in and the station carries on.
  assert.equal(await page.evaluate(() => globalThis.__app.session.pack.scenario.order.id), 'ORD-58257');
  assert.match(await page.textContent('#side'), /Tote 2 of 4/);
  await page.waitForTimeout(1500);
  await shot('03d-pack-tote2');
  for (let i = 0; i < 3; i++) await packToteUI();
  const pr = await page.evaluate(() => globalThis.__app.session.pack.results());
  assert.equal(pr.score, 100, 'perfect four-tote shift scores 100');
  assert.equal(pr.status, 'proficient');
  await shot('03e-pack-done');

  // Replay Station 1: a new shift of four different totes.
  await act('station:replay-pack');
  assert.equal(await page.evaluate(() => globalThis.__app.session.pack.scenario.order.id), 'ORD-61102');
  assert.deepEqual(await page.evaluate(() => globalThis.__app.session.pack.scenario.itemOrder), ['mug', 'charger', 'cable']);
  for (let i = 0; i < 4; i++) await packToteUI();
  const pr2 = await page.evaluate(() => globalThis.__app.session.pack.results());
  assert.equal(pr2.score, 100, 'replay shift also perfect');
  await act('station:dock');
  await settle();
  await act('start');
  await act('assist:bring');
  await page.waitForTimeout(600);
  await shot('04-inspect-A');
  await act('condition:damaged');
  await act('decide:reject');
  await act('place:quarantine');
  assert.equal(await state('A'), 'quarantined');
  // Package B rolls in from the inbound conveyor.
  await page.waitForFunction(() => globalThis.__app.phys.B.zone === 'bench', null, { timeout: 5000 });
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
  await dockPackageUI('C');
  await dockPackageUI('D');
  await page.waitForTimeout(400);
  let r = await results();
  assert.equal(r.score, 100, 'perfect dock run scores 100');
  assert.equal(r.status, 'proficient');
  assert.equal(r.criticalErrors.length, 0);
  const sr = await sessionResults();
  assert.equal(sr.score, 200);
  assert.equal(sr.status, 'proficient');
  assert.ok(await page.isVisible('#results table'), 'results table shown');
  assert.match(await page.textContent('#side'), /proficiency met/);
  await shot('07-results');
  await act('results:pack');
  await shot('08-results-details');

  // Replay, then an error-path run.
  await act('replay');
  r = await results();
  assert.equal(r.score, 0);
  assert.equal(await state('A'), 'waiting');
  assert.equal(await page.evaluate(() => globalThis.__app.engine.log.length), 0);
  assert.equal(await page.evaluate(() => globalThis.__app.session.pack.log.length), 0);
  assert.equal(await page.evaluate(() => globalThis.__app.stationKey), 'pack');
  await act('continue');
  await act('station:skip'); // demo shortcut straight to Station 2
  await settle();
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
  await dockPackageUI('C');
  await dockPackageUI('D');
  r = await results();
  assert.equal(r.complete, true);
  assert.equal(r.status, 'practice');
  assert.equal(r.criticalErrors.length, 2);
  assert.equal(r.score, 85, 'three of twenty checkpoints missed');
  const sr2 = await sessionResults();
  assert.equal(sr2.status, 'incomplete', 'skipping Station 1 never passes');
  assert.match(await page.textContent('#side'), /Station 1 skipped/);

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

  await vrPackLogic(browser, errors);
  assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
  console.log('station 1 pack-out VR logic (simulated controllers): OK');

  await videoLogic(browser, errors);
  assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
  console.log('intro + coaching videos: OK');
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
  await act('station:skip');
  await page.waitForFunction(() => !globalThis.__app.transition);
  await act('start');
  await grip(L.mat.x, 0.12, L.mat.z); // the world moved to Station 2: re-place the hand

  // Package A: grab → inspect → reject → drop into the quarantine tote.
  assert.equal(await ev(() => globalThis.__squeeze()), 'A');
  assert.equal(await st('A'), 'inspecting');
  await act('condition:damaged');
  await act('decide:reject');
  await grip(L.tote.x, 0.3, L.tote.z);
  await ev(() => globalThis.__let());
  assert.equal(await st('A'), 'quarantined');
  assert.equal(await zone('A'), 'quarantine');
  // It drops to the floor of the sunken bin, below the bench top.
  const ay = await ev(() => globalThis.__app.world.packages.A.group.position.y);
  assert.ok(ay < 0, `A sits below the bench top in the bin, got ${ay}`);
  // Quarantined package stays put and cannot be picked back up.
  await grip(L.tote.x, ay, L.tote.z);
  assert.equal(await ev(() => globalThis.__squeeze()), null);

  // Package B rolls in from the inbound conveyor to the arrival pad.
  await page.waitForFunction(() => globalThis.__app.phys.B.zone === 'bench', null, { timeout: 5000 });
  assert.equal(await zone('C'), 'queue');
  await grip(L.mat.x, 0.13, L.mat.z);
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
  assert.equal(await ev(() => globalThis.__app.feedback.title), 'No read');
  assert.match(await ev(() => globalThis.__app.feedback.text), /Turn the barcode/);
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
  assert.equal(await st('B'), 'outbound');
  // C and D follow; the receiving monitor shows C's contents once scanned.
  await page.waitForFunction(() => globalThis.__app.phys.C.zone === 'bench', null, { timeout: 5000 });
  for (const id of ['assist:bring', 'condition:intact', 'decide:accept', 'scan']) await act(id);
  await page.waitForTimeout(150);
  assert.match(await ev(() => globalThis.__app.world.receiving.key), /Desk lamp/);
  for (const id of ['place:scale', 'weight:within', 'place:outbound', 'release']) await act(id);
  await page.waitForFunction(() => globalThis.__app.phys.D.zone === 'bench', null, { timeout: 5000 });
  for (const id of ['assist:bring', 'condition:damaged', 'decide:reject', 'place:quarantine']) await act(id);
  // D stacks on A in the bin.
  const [ya, yd] = await ev(() => ['A', 'D'].map((k) => globalThis.__app.world.packages[k].group.position.y));
  assert.ok(yd > ya + 0.15, `D stacked on A (${ya} → ${yd})`);
  const r = await ev(() => globalThis.__app.engine.results());
  assert.equal(r.complete, true);
  assert.equal(r.score, 90, 'two of twenty checkpoints missed');
  assert.equal(r.status, 'practice', 'premature release stays on the record');

  // Replay, start Station 1, then exit VR midway: paused, never complete or passing.
  await act('replay');
  await act('continue');
  await act('station:pack');
  await ev(() => globalThis.__app.xr.session.end());
  const after = await ev(() => ({
    paused: [...globalThis.__app.session.pack.pauseReasons],
    res: globalThis.__app.session.results(),
    xr: globalThis.__app.xr,
  }));
  assert.deepEqual(after.paused, ['xr-exit']);
  assert.equal(after.res.status, 'incomplete');
  assert.equal(after.xr, null);
  await page.close();
}

// ---------------------------------------------------------------------------
// Station 1 with a simulated controller: handheld scanner aimed by the ray,
// items carried to the carton / exception bin, void fill, tape gun, label and
// conveyor. Exercises the real interaction code, not WebXR rendering.
async function vrPackLogic(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror(pack): ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console(pack): ${m.text()}`); });
  await page.goto(base);
  await page.waitForFunction(() => globalThis.__boot?.isReady, null, { timeout: 30000 });
  await page.evaluate(() => {
    const app = globalThis.__app;
    app.settings.reducedMotion = true;
    app.xr = { session: { end: async () => app.onXREnd() }, floor: true, visibility: 'visible' };
    const c = app.xrInput.controllers[0];
    c.connected = true;
    c.source = { targetRayMode: 'tracked-pointer', handedness: 'right', gamepad: null };
    c.grip.visible = true;
    const V = c.grip.position.constructor;
    const Q = c.grip.quaternion.constructor;
    const M = c.grip.matrix.constructor;
    const toWorld = (x, y, z) => app.pack.group.localToWorld(new V(x, y, z));
    globalThis.__g = (x, y, z) => {
      c.grip.matrix.compose(toWorld(x, y, z), new Q(), new V(1, 1, 1));
      c.grip.updateMatrixWorld(true);
    };
    // Ray at (x,y,z) pointing toward (tx,ty,tz), all in Station 1 coordinates.
    globalThis.__aim = (x, y, z, tx, ty, tz) => {
      const eye = toWorld(x, y, z);
      const m = new M().lookAt(eye, toWorld(tx, ty, tz), new V(0, 1, 0));
      const q = new Q().setFromRotationMatrix(m);
      c.ray.matrix.compose(eye, q, new V(1, 1, 1));
      c.ray.updateMatrixWorld(true);
    };
    globalThis.__sq = () => { c.near = app.xrInput.nearest(c); app.xrInput.onSqueeze(c); return c.held; };
    globalThis.__let = () => app.xrInput.onSqueezeEnd(c);
    globalThis.__trig = () => app.xrInput.onSelect(c);
  });
  const L = await page.evaluate(async () => (await import('./src/pack/scene.js')).PACK_LAYOUT);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const g = (x, y, z) => ev(([a, b, c]) => globalThis.__g(a, b, c), [x, y, z]);
  const aim = (...a) => ev((args) => globalThis.__aim(...args), a);
  const sq = () => ev(() => globalThis.__sq());
  const let_ = () => ev(() => globalThis.__let());
  const trig = () => ev(() => globalThis.__trig());
  const pe = (fn) => ev(`(${fn})(globalThis.__app.session.pack)`);
  const act = (id) => ev((i) => globalThis.__app.dispatch(i, 'xr'), id);
  const T = L.tote;
  const P = L.packZone;

  await act('continue');
  await act('station:pack');

  // Scanner: grab, aim at the tote label, trigger → order opens.
  await g(L.scanner.x, 0.025, L.scanner.z);
  assert.equal(await sq(), 'pk:scanner');
  const lblY = T.h * 0.55;
  await aim(T.x, lblY + 0.03, T.z + 0.5, T.x, lblY + 0.03, T.z + T.d / 2);
  await trig();
  assert.equal(await pe((e) => e.orderOpen), true, 'tote scan opens the order');

  // Mug barcode faces the learner: aim from above-front.
  const mug = [T.x - 0.1, 0.08, T.z - 0.04];
  await aim(mug[0], 0.38, T.z + 0.32, mug[0], 0.1, mug[2] + 0.06);
  await trig();
  assert.equal(await pe((e) => e.items.mug.scanned), true, 'mug scanned');
  // The phone case lies on the book; its barcode is on top.
  const caseP = [T.x + 0.07, 0.0565, T.z + 0.02];
  await aim(caseP[0], 0.42, caseP[2] + 0.06, caseP[0], caseP[1], caseP[2]);
  await trig();
  assert.equal(await pe((e) => e.items.case.scanned), true, 'case scanned (flagged not on order)');
  await let_(); // scanner returns to its spot

  // Case → exception bin.
  await g(...caseP);
  assert.equal(await sq(), 'pk:case');
  await g(L.exception.x, 0.25, L.exception.z);
  await let_();
  assert.equal(await pe((e) => e.items.case.loc), 'exception');

  // Book barcode on top: scan from above.
  await g(L.scanner.x, 0.025, L.scanner.z);
  assert.equal(await sq(), 'pk:scanner');
  const book = [T.x + 0.07, 0.04, T.z + 0.04];
  await aim(book[0] + 0.03, 0.4, book[2] + 0.08, book[0] + 0.03, book[1], book[2]);
  await trig();
  assert.equal(await pe((e) => e.items.book.scanned), true, 'book scanned');
  await let_();

  // Carton M from its slot onto the pack scale.
  await g(L.slots.xs.M, 0.081, L.slots.z);
  assert.equal(await sq(), 'pk:carton-M');
  await g(P.x, 0.2, P.z);
  await let_();
  assert.equal(await pe((e) => e.carton), 'M');

  // Pack both order items.
  await g(...mug);
  assert.equal(await sq(), 'pk:mug');
  await g(P.x, 0.25, P.z);
  await let_();
  await g(...book);
  assert.equal(await sq(), 'pk:book');
  await g(P.x, 0.25, P.z);
  await let_();
  assert.equal(await pe((e) => e.items.mug.loc + e.items.book.loc), 'boxbox');

  // Two air pillows.
  for (let i = 0; i < 2; i++) {
    await g(L.basket.x, 0.085, L.basket.z);
    assert.equal(await sq(), 'pk:pillow');
    await g(P.x, 0.3, P.z);
    await let_();
  }
  assert.equal(await pe((e) => e.dunnage), 2);

  // Tape gun: too far → hint; over the carton → sealed.
  await g(L.tape.x, 0.05, L.tape.z);
  assert.equal(await sq(), 'pk:tape');
  await aim(P.x + 0.6, 0.6, P.z + 0.6, P.x + 0.6, 0.6, P.z);
  await trig();
  assert.equal(await pe((e) => e.sealed), false);
  // Gun nose hangs 7 cm below and 11 cm ahead of the ray origin. Hold the
  // trigger at one end of the seam and draw the gun across the carton top.
  const noseY = P.top + 0.18 + 0.02;
  const at = (x) => aim(x, noseY + 0.07, P.z + 0.11, x, noseY + 0.07, P.z - 1);
  await at(P.x - 0.17);
  await trig();
  assert.equal(await pe((e) => e.sealed), false, 'pressing alone does not seal');
  for (let x = -0.17; x <= 0.171; x += 0.02) {
    await at(P.x + x);
    await page.waitForTimeout(40);
    if (x > -0.05 && x < 0.0) {
      assert.equal(await pe((e) => e.sealed), false, 'half a strip is not a seal');
    }
  }
  await page.waitForFunction(() => globalThis.__app.session.pack.sealed, null, { timeout: 3000 });
  await ev(() => globalThis.__app.onHeldTriggerEnd(globalThis.__app.xrInput.controllers[0]));
  await let_();

  await act('pk:weight:within');
  // Point at the printer and pull the trigger.
  const PR = L.printer;
  await aim(PR.x, 0.4, PR.z + 0.4, PR.x, PR.h / 2, PR.z);
  await ev(() => {
    const c = globalThis.__app.xrInput.controllers[0];
    c.ray.visible = true;
  });
  // Wait for a rendered frame to put the ray's hover on the printer.
  await page.waitForFunction(() => globalThis.__app.xrInput.controllers[0].hover?.key === 'pk:printer', null, { timeout: 5000 });
  await trig();
  assert.equal(await pe((e) => e.labelPrinted), true, 'trigger on the printer prints the label');

  // Label onto the carton top.
  await g(PR.x, 0.075, PR.z + PR.d / 2 + 0.06);
  assert.equal(await sq(), 'pk:label');
  await g(P.x, 0.3, P.z);
  await let_();
  assert.equal(await pe((e) => e.labelApplied), true);

  // Carton → outbound conveyor → confirm release.
  await g(P.x, P.top + 0.09, P.z);
  assert.equal(await sq(), 'pk:box');
  await g(L.conveyor.x, 0.25, L.conveyor.intakeZ);
  await let_();
  assert.equal(await pe((e) => e.staged), true);
  await act('release');
  // Tote 2 rolls in: new order, its items in the tote, the shipped carton gone.
  const t2 = await ev(() => {
    const app = globalThis.__app;
    const w = app.pack.w;
    return {
      order: app.session.pack.scenario.order.id,
      visible: Object.keys(w.items).filter((k) => w.items[k].group.visible).sort(),
      cartonM: w.cartons.M.group.visible,
      flats: Object.values(w.flats).every((f) => f.group.visible),
      tote: app.pack.loc['pk:charger'],
      complete: app.session.pack.isComplete(),
    };
  });
  assert.deepEqual(t2, { order: 'ORD-58257', visible: ['book', 'cable', 'charger'], cartonM: false, flats: true, tote: 'home', complete: false });
  // Remaining totes through the assisted actions (same validated engine calls).
  await ev(() => {
    const app = globalThis.__app;
    const d = (id) => app.dispatch(id, 'xr');
    for (let i = 0; i < 3; i++) {
      const o = app.session.pack.scenario;
      d('pk:scan:tote');
      for (const k of o.itemOrder) { d(`pk:pick:${k}`); d('pk:scan:item'); }
      for (const k of o.itemOrder.filter((k2) => !o.items[k2].onOrder)) { d(`pk:pick:${k}`); d('pk:divert'); }
      d(`pk:carton:${o.correctCarton}`);
      for (const k of o.itemOrder.filter((k2) => o.items[k2].onOrder)) { d(`pk:pick:${k}`); d('pk:pack'); }
      if (o.itemOrder.some((k) => o.items[k].onOrder && o.items[k].fragile)) d('pk:dunnage');
      for (const id of ['pk:seal', 'pk:weight:within', 'pk:print', 'pk:apply', 'pk:outbound', 'release']) d(id);
    }
  });
  const r = await pe((e) => e.results());
  assert.equal(r.complete, true);
  assert.equal(r.score, 100, `pack VR run should be perfect: ${JSON.stringify(r.checkpoints.filter((c) => c.status !== 'passed'))}`);
  // The last carton of the shift stays at the end of the outbound line.
  assert.equal(await ev(() => globalThis.__app.pack.w.cartons.M.group.visible), true);
  await page.close();
}

// ---------------------------------------------------------------------------
// Video slots. The test checks the player logic, not the browser's codec
// support: the <video> element's loading/playback is stubbed so headless
// Chromium can't reject it, and "ended" is dispatched by hand. Intro
// autoplays on the briefing and pauses scoring; a mistake plays its coaching
// clip once per session.
async function videoLogic(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror(video): ${e.message}`));
  await page.goto(base);
  await page.waitForFunction(() => globalThis.__boot?.isReady, null, { timeout: 30000 });
  await page.click('#welcome-preview');
  await page.evaluate(() => {
    const { video } = globalThis.__app;
    const el = video.el;
    let src = '';
    Object.defineProperty(el, 'src', { get: () => src, set: (v) => { src = v; } });
    el.play = () => Promise.resolve();
    el.pause = () => {};
    video.setFiles({ intro: 'video/intro.mp4', 'pack:CARTON_WRONG': 'video/carton.mp4' });
  });
  const ev = (fn) => page.evaluate(fn);
  const act = (id) => page.evaluate((i) => globalThis.__app.dispatch(i, 'desktop'), id);
  await act('continue');
  assert.equal(await ev(() => globalThis.__app.video.current?.key), 'intro', 'intro autoplays on the briefing');
  assert.equal(await ev(() => globalThis.__app.session.pauseReasons.has('video')), true, 'scoring paused during video');
  assert.equal(await ev(() => globalThis.__app.video.mesh.visible), true);
  assert.equal(await ev(() => globalThis.__app.video.el.src), 'media/video/intro.mp4');
  await ev(() => globalThis.__app.video.el.dispatchEvent(new Event('ended')));
  assert.equal(await ev(() => globalThis.__app.video.current?.ended), true);
  await page.waitForSelector('#actions button[data-id="video:skip"]');
  assert.match(await page.textContent('#actions button[data-id="video:skip"]'), /Continue/);
  await act('video:skip');
  assert.equal(await ev(() => globalThis.__app.session.isPaused()), false);
  assert.equal(await ev(() => globalThis.__app.video.mesh.visible), false);
  // "Watch intro" button is offered after the autoplay.
  assert.ok(await page.isVisible('#actions button[data-id="video:intro"]'));
  await act('station:pack');
  await act('pk:scan:tote');
  await act('pk:carton:L'); // mistake → coaching clip
  assert.equal(await ev(() => globalThis.__app.video.current?.key), 'pack:CARTON_WRONG');
  await act('video:skip');
  await act('pk:carton:S'); // same mistake again → no repeat
  assert.equal(await ev(() => globalThis.__app.video.current), null, 'coaching plays once per session');
  await page.close();
}
