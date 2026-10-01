# Package Handling Lab — VR-first WebXR training demo

Devinci Global · PRD v1.1 (Sept 30, 2026) implementation, extended to two stations.

One customer order, from packing to shipping:

1. **Station 1 · Pack-Out.** Scan the order tote to open the order. Scan each item against the monitor and send the item that is *not on the order* to the exception bin. Choose the smallest carton that fits, pack the items and add void fill around the fragile mug. Seal it with the tape gun, confirm the weight, then print and apply the shipping label. Release the carton to the outbound conveyor.
2. **Station 2 · Dock Check.** Inspect outgoing packages. Package A is damaged: reject it and quarantine it. Package B is intact: accept it, scan it, weigh it, confirm the weight and release it outbound.

The primary target is **Meta Quest 2 in Meta Quest Browser**, opened from an HTTPS link, with no PC, Link cable or Air Link. The desktop preview is secondary.

> **Status:** both stations have been run on a Quest 2 (see [`docs/HEADSET_TEST_LOG.md`](docs/HEADSET_TEST_LOG.md), sessions 1–2). The session 2 fixes have not been re-tested on the headset yet: frame-drop fix, console, taping, monitor and the warehouse hall. The headset run is the release gate (PRD §12).

## Run it

No build step. It is static files plus vendored three.js r180 (MIT).

```bash
npm start          # http://localhost:8080  (desktop preview)
npm test           # engine + session unit tests (node --test)
npm run test:e2e   # desktop flow + simulated-controller VR logic for both stations (Playwright)
```

WebXR needs **HTTPS**. `localhost` works for desktop, but the headset needs a real HTTPS URL:

- **Netlify (configured):** `netlify.toml` publishes the repo root with no build step and runs `npm test` before each deploy. Connect the repo under *Add new site → Import an existing project*, or drag the folder into app.netlify.com/drop.
- **GitHub Pages (prepared, not enabled):** `.github/workflows/deploy-pages.yml` only runs when started by hand. Set Settings → Pages → Source to *GitHub Actions*, then run it.

## Using it on Quest 2

1. Open **Meta Quest Browser**, enter the HTTPS URL and select **Enter VR**. The scene fades in from dark.
2. **Comfort setup** (not scored): Seated or Standing, then **Bench height** (its own labelled row with a live cm readout), then Recenter. The same **BENCH HEIGHT ▼ LOWER / ▲ RAISE** switch is mounted under the front edge of both benches, so the bench can be adjusted at any time. A prompt points at it during setup. Practise grabbing on the grey box.
3. **Shift briefing**, then **Start Station 1**. For demos, **Skip to Station 2** jumps straight to the dock. A skipped station is reported as *Incomplete*, so it can never produce a pass.
4. **Station 1 is a shift of four totes.** Each tote needs a different carton, in the order M, S, L, M. The totes mix fragile items, mis-picks and one clean tote. After each carton ships, the next tote rolls in along the inbound rollers. The order monitor shows *TOTE n OF 4*.
5. When all four totes are done, **Continue to Station 2**, or **Replay (new totes)** for a second shift of four different orders. Continuing fades out and back in at the dock bench. There is no walking or artificial movement.
6. **Station 2 handles four packages** (damaged, intact, intact, damaged). They queue on the inbound conveyor on the left. One sits on the arrival pad at a time, and the next rolls in once the current one is quarantined or shipped. Package D's damage is on the back, so it only shows when the package is turned around. The **receiving monitor** (left) shows the queue. Once a package's label is scanned, it shows what is inside and the expected weight.
7. The combined results show each station's score and critical errors, with one line per tote or package (*all correct*, or what was missed). **Replay** resets everything.

| Input | Action |
|---|---|
| Grip (either hand) | Grab / release. Point at a far object and squeeze to pull it to your hand. |
| Trigger | Press ray-targeted buttons. Use a held tool: the **scanner** reads what its red beam hits. For the **tape gun**, hold the trigger at one end of the carton's top seam and draw it across. At Station 2, trigger while holding a package in the scan zone scans it. |
| Trigger on the label printer | Prints the label (once the weight is confirmed) |
| Thumbstick while holding | Rotate the held object |
| B / Y | Help and pause panel |
| Panel buttons | Assisted equivalents of every step, for seated or limited-reach use and for desktop. Every option is always offered (all carton sizes, all destinations), so the buttons never give away the answer. |

**Guidance design.**
- Instructions appear on a physical **work-instruction console**. It stands behind the bench and is clear of the conveyors at both stations.
- Each screen shows:
  - a station chip with the tote or package count (*Tote 2 of 4*, *Package C · 3 of 4*);
  - a step counter and progress bar;
  - an icon, with **one short headline and one line under it**.
- Controller hints ("TRIGGER · scan") sit in amber key chips. When the task changes, the light bar pulses with a chime.
- Feedback is a coloured card: a title such as *Wrong carton* plus one line, with the full explanation under **More** on desktop. Detailed tips live behind an **Assist** toggle.
- Prompts float over the relevant tool (*PICK UP SCANNER*, then *SCAN TOTE LABEL*). A hint chip above the controller says what the trigger does right now. At Station 2 it turns green and pulses, with a haptic tick, when the label is in the scan zone: **PULL TRIGGER TO SCAN**.
- The **order monitor** (Station 1) and the **receiving monitor** (Station 2) stand in the same place, to the learner's left. Until the carton is built, a large amber **USE CARTON M** card on the order monitor and a glowing frame make the carton size stand out.
- At Station 2, rejected packages go into a **quarantine drop bin** sunk into the middle of the bench. Rejects stack below the bench top, so they never block the console.

**Videos, sounds and music.** Record them, drop the files into `media/` and list them in `media/manifest.json`. No code changes are needed.
- The **intro** video plays on the console when the shift briefing opens.
- A **coaching clip** plays the first time a learner makes the matching mistake.
- Scoring pauses while a video plays, and every video has Skip and Replay.
- Recorded sounds replace the built-in synthesized placeholders.
- Ambience (on by default) and music (off by default) loops can each be switched in Help.

[`media/README.md`](media/README.md) lists every slot, when it plays, the file specs, the voice-over lines and a recording checklist in priority order.

**Performance on Quest 2.**
- Hovering a button moves a small overlay instead of redrawing the panel.
- Panel and screen images are uploaded asynchronously (`createImageBitmap`).
- Instrument screens refresh at 10 Hz.
- All static scenery is batched, with plain colours baked into vertex colours, and stock cartons are instanced. The fully dressed hall peaks at about 96 draw calls in a full 360° turn. Each package uses a single texture atlas, so it costs one draw call instead of six.
- Add `?perf` to the URL to show an fps and frame-time meter under the console.

## Architecture

```
index.html             launch screen, boot/failure/retry, import map
src/session.js         flow: setup → briefing → Station 1 → Station 2 → results; combined scoring
src/engine-base.js     shared core: phases, pause-aware timer, first-attempt scoring, critical errors, log
src/engine.js          Station 2 Dock Check engine          src/scenario.js       its rules and fixtures
src/pack/engine.js     Station 1 Pack-Out engine            src/pack/scenario.js  order, items, cartons, rules
src/guidance.js        state → UI spec. One spec drives both the VR panel and the HTML panel (FR-12).
src/app.js             orchestrator: stations, transitions, picking, grab/drop, XR lifecycle
src/pack/station.js    Station 1 interactions: scanner gun, tape gun, printer, carton, drop targets
src/pack/scene.js      Station 1 geometry: tote, exception bin, carton slots, pack scale, monitor, rollers
src/scene.js           Station 2 geometry                 src/dressing.js  warehouse hall (textures, racking, AO)
src/console.js         instruction console + ?perf meter  src/merge.js     static draw-call batching
src/xr-input.js        controllers: grab, ray select, tools, haptics, tracking loss, trigger hint chips
src/copy.js            short learner-facing copy: result code → headline + one line
src/media.js           manifest loader, intro/coaching video player on the console
src/audio.js           sound effects, ambience/music loops; recorded files override synth placeholders
src/desktop-input.js   mouse look, click-select, keyboard
```

Design rules (from the PRD, applied to both stations):
- **Every procedural action goes through a station engine.** Controllers, assisted buttons, mouse and keyboard all call the same validated actions. Animations follow only accepted results.
- **Invalid actions never change state.** The object returns to where it belongs, the attempt is logged, and the learner gets an explanation.
- **Placing on a target never ships.** Outbound always needs an explicit *Confirm release*. Lifting a carton or package off a conveyor un-stages it.
- **Tracking loss or controller disconnect** pauses scoring and timers and freezes held items in place. *Resume* needs a tracked controller. Exiting VR keeps progress and pauses.
- **Client pilots swap data, not code:** `src/pack/scenario.js` and `src/scenario.js` hold the order, items, cartons, weights, rules and checkpoints.

## Scoring

Each station is scored **0–100: the share of its checkpoints passed on the first attempt** (session total 200). Mistakes can be corrected so the learner can finish, but they stay on the record. A station counts as proficient at **≥ 80 and zero critical errors** (a demo setting pending instructional validation). The session passes only if both stations are completed and proficient.
- **Station 1:** every tote has its own checkpoints (37 across the first shift, 38 across the replay shift). Only the checkpoints that apply are counted: a tote with no mis-pick has no exception check, and one with nothing fragile has no void-fill check. Repeating the same mistake on a later tote counts again.
- **Station 2:** each damaged package has 3 checkpoints and each intact one has 7, giving 20 in total.

| Station | Critical errors |
|---|---|
| 1 · Pack-Out | Packing an item that is not on the order · releasing a carton before it is sealed, weighed and labelled |
| 2 · Dock Check | Accepting a damaged package · sending a damaged package outbound · releasing before scan and weight confirmation |

Interpretation choices, all covered by tests:
- **Station 1:**
  - Touching items, cartons or the label before scanning the tote fails *open the order first*.
  - Sealing is blocked if order items are missing, if the extra item is still in the tote, or if the fragile item has no void fill.
  - Printing the label before the weight is confirmed is blocked and scored.
- **Station 2:**
  - Weighing before scanning fails both scan-order checkpoints.
  - Any outbound attempt before the weight is confirmed counts as a premature release.
- **Both stations:** a scan with the barcode facing away is a "no read" with no penalty, and dropped items can be retrieved with no penalty.

Session data (anonymous ID, scenario version, item or package, checkpoint, action, timestamp, validity, first-attempt outcome, critical flag, score, completion, input mode) stays in memory only. There is no backend and no analytics.

## Verified here vs. still needs the headset

| Verified in this repo | Needs Quest 2 hardware |
|---|---|
| 40 unit tests: both engines (four totes, four packages), every order fits its tote and carton, session flow, skip rules, reset | Station 1 reach and comfort: carton slots, scanner and tape gun handling |
| Desktop flow through both stations, results, replay, help-pause, 200 % zoom (Playwright) | Scanner-gun aim feel; legibility of the order monitor |
| Simulated-controller runs of Station 1: aimed scanner reads (front- and top-facing barcodes), exception bin, carton build, void fill, tape gun (rejected when too far), printer trigger, label, conveyor | 72 Hz frame budget with both stations. Measured here: 96 draw calls worst case after batching and per-package texture atlases (the build that ran smoothly was 92). |
| Station 2 simulated-controller suite (grab, scan zone, tracking loss, disconnect/resume, missed drop, exit VR) | Fade transition between stations |
| Video logic: intro autoplay, scoring pause, Continue/Skip, coaching clip once per session |
| Tote hand-off (next tote rolls in, shipped carton leaves), inbound package queue, stacking in the drop bin, bench-height switch hit by a ray | Reach to the arrival pad and the drop bin; whether the switch under the bench edge is found without help | Recorded videos and sound on the headset (autoplay with sound, caption legibility) |
| Payload ≈ 1.0 MB (≈ 250 KB gzipped) against the 15 MB budget | |

Desktop and emulation results support development. They cannot satisfy the headset release gate (PRD §12).
