# Package Handling Lab — VR-first WebXR training demo

Devinci Global · PRD v1.1 (Sept 30, 2026) implementation.

A learner inspects two packages at a receiving workstation, decides what to accept, and processes them correctly. Package A (damaged) is rejected and quarantined. Package B (intact) is accepted, scanned, weighed, weight-confirmed and released outbound. The primary target is **Meta Quest 2 in Meta Quest Browser**, opened from an HTTPS link, with no PC, Link cable or Air Link. The desktop preview is secondary.

> **Status:** code-complete through Milestone 2 (full VR learning loop). It has **not yet run on a Quest 2**, and headset acceptance (PRD §11 Milestone 1, §12) is still the release gate. Use [`docs/HEADSET_TEST_LOG.md`](docs/HEADSET_TEST_LOG.md) for that test.

## Run it

No build step. It is static files plus vendored three.js r180 (MIT).

```bash
npm start          # http://localhost:8080  (desktop preview)
npm test           # procedure-engine unit tests (node --test)
npm run test:e2e   # desktop flow + simulated-controller VR logic (Playwright/Chromium)
```

WebXR needs **HTTPS**. `localhost` works for desktop, but the headset needs a real HTTPS URL. To get one:

- **GitHub Pages (prepared, not enabled):** `.github/workflows/deploy-pages.yml` runs only when started by hand. In the repo, go to Settings → Pages → Source: *GitHub Actions*, then run the workflow from the Actions tab. The URL will be `https://<owner>.github.io/Package_Handling_XR/`.
- **Netlify (configured):** `netlify.toml` publishes the repo root with no build (it runs `npm test` as a gate). Connect the repo under *Add new site → Import an existing project*, or drag the folder into app.netlify.com/drop.
- Any other static HTTPS host (Cloudflare Pages, S3+CloudFront) also works. Serve the repo root.

Hosting is not switched on automatically, because the PRD says deployment needs a separate decision.

## Using it on Quest 2

1. On the headset, open **Meta Quest Browser** and enter the HTTPS URL. The hotspot only has to load the page. No PC is involved.
2. Select **Enter VR** and allow the VR prompt. If you decline, you get a retry option and the desktop preview.
3. **Comfort setup** (not scored): choose Seated or Standing, move the bench up or down, and Recenter. Practise grip and trigger on the grey box.
4. **Briefing**, then **Start exercise**.

| Input | Action |
|---|---|
| Grip (either hand) | Grab / release. Pointing at a far package and squeezing pulls it to your hand (assisted grab). |
| Trigger | Press ray-targeted buttons. While holding a package near the scanner, scan it. |
| Thumbstick while holding | Rotate the package |
| B / Y | Help and pause panel |
| Panel buttons | Assisted Bring-to-me / Rotate / Flip / Place / Scan for seated or limited-reach use. Every destination is always offered, so the buttons never give away the answer. |

## Architecture

```
index.html           launch screen, boot/failure/retry, import map
src/scenario.js      rules, text, fixture values, scoring config (no rendering)
src/engine.js        procedure engine: package state machines, first-attempt scoring,
                     critical errors, pause/timer, session log. Pure JS, unit-tested.
src/guidance.js      engine state → UI spec. The same spec drives the VR panel AND the
                     HTML panel, so both inputs get identical actions (FR-12).
src/app.js           orchestrator: scene, tweens, grab/drop targets, scanning, XR lifecycle
src/xr-input.js      controllers: grab, ray select, hand scan, haptics, tracking loss
src/desktop-input.js mouse look, click-select, keyboard rotation
src/scene.js         procedural workstation (no downloaded models/textures)
src/panel.js         canvas-rendered world-space panels with ray hit-testing
```

Design rules taken from the PRD:
- **Every procedural action goes through `ProcedureEngine`.** Controllers, assisted buttons, mouse and keyboard all reach the engine through `App.dispatch` or the drop handlers. Animations run only after the engine accepts the action.
- **Invalid actions never change state.** The package snaps back to the bench, the attempt is logged, and the learner gets an explanation.
- **Placing a package on a target never sends it.** Outbound always needs an explicit *Confirm release*. Lifting a package off the conveyor un-stages it.
- **Tracking loss or disconnect** pauses scoring and the timer, and freezes any held item in mid-air (it is never dropped). *Resume* only works once a controller is tracked again. Exiting VR keeps progress and pauses. It never marks the session complete.

## Scoring (PRD §8)

There are 10 checkpoints worth 10 points each. Only the first attempt at each counts. A learner can correct a mistake to finish, but the mistake stays on the record. Proficiency means ≥ 80 **and** zero critical errors. This threshold is a demo setting that still needs instructional validation. The critical errors are: accepting the damaged package, sending the damaged package outbound, and releasing before scan and weight confirmation. Results show *Completed — proficiency met*, *Completed — practice recommended*, or *Incomplete*.

These interpretation choices are written into the tests:
- Weighing before scanning is blocked and fails both *scan before weighing* and *weigh after scan success*. Those are the literal first evaluations of both checkpoints.
- Any outbound attempt on Package B before its weight is confirmed counts as a premature release. That includes dropping it on the conveyor.
- Actions on Package B while Package A is still active are guidance only and are never scored.
- A scan with the barcode outside the target is a "no read". It is not penalised.

Session data (anonymous ID, scenario version, package, checkpoint, action, timestamp, validity, first-attempt outcome, critical flag, score, completion, input mode) is kept only in memory. Refreshing the page starts a new session. There is no backend and no analytics.

## Verified here vs. still needs the headset

| Verified in this repo | Needs Quest 2 hardware |
|---|---|
| Engine rules, scoring, reset, 5 replay cycles (unit tests) | Entering immersive mode, controller mapping, local-floor alignment |
| Full desktop flow, results, replay, help-pause, 200 % zoom layout (Playwright) | Text legibility, reach seated and standing, comfort |
| Grab/drop targets, hand-scan alignment, tracking-loss freeze, disconnect → resume gating, missed drop + retrieve, exit-VR state, all with simulated controllers | 72 Hz frame budget (≥ 95 % of frames ≤ 13.9 ms), loading over hotspot |
| Payload ≈ 0.9 MB (≈ 230 KB gzipped) against the 15 MB budget | Denied permission, system-menu interruption, re-entry |

Desktop and emulation results support development. They cannot satisfy the headset release gate (PRD §12).
