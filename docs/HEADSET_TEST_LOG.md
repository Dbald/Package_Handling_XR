# Quest 2 headset acceptance log

PRD §10–§12. Fill this in on the real headset. Desktop or emulator results do not count toward this gate.

## Environment

| Item | Value |
|---|---|
| Date / tester | |
| Headset | Meta Quest 2 (standalone) |
| Quest OS version | |
| Meta Quest Browser version | |
| Network (hotspot, measured Mbps) | |
| Deployed URL + commit | |
| Runtime refresh rate (Hz) | |

## Milestone 1 — headset proof

- [ ] HTTPS URL opens in a fresh Quest Browser session over the hotspot
- [ ] Enter VR works; declining the permission shows retry + preview guidance
- [ ] Floor height and bench position look right; Recenter works
- [ ] Both controllers tracked; controller visuals aligned; no object "swimming"
- [ ] Grab / rotate / place a package with either hand
- [ ] Select a world-space button with the trigger ray

## §12 release checklist

- [ ] Correct two-package flow entirely in VR → 100/100, no critical errors, *Completed — proficiency met*
- [ ] Accept damaged package → blocked, recover via quarantine → *practice recommended*, error retained
- [ ] Early outbound (drop on conveyor / press release) → blocked, prerequisite explained, error retained
- [ ] Reject intact package → correction allowed, first-attempt points withheld
- [ ] Repeat invalid clicks/controller actions → no duplicate score changes or transitions
- [ ] Exit VR midway → paused, not complete, not passing; re-enter and resume
- [ ] Replay after a perfect run and after a failed run → full reset (packages, instruments, score, timer, feedback, log)
- [ ] All steps with controllers **seated**; all steps **standing**; all steps with **assisted placement only**
- [ ] Controller disconnect (take batteries out / turn off) → pause, held item frozen, resume only after reconnect
- [ ] System menu (Oculus button) mid-task → pause; resume explicit
- [ ] Missed drop to the floor → no penalty, *Retrieve package* works
- [ ] Damage evidence, barcode, scan zone, scale reading, instructions and results are legible in VR
- [ ] Desktop fallback: full flow with keyboard only (Tab/Enter)

## Performance (5-minute run)

Record frame timing with the Meta Quest Developer Hub / OVR Metrics Tool.

| Metric | Target | Measured |
|---|---|---|
| Frames ≤ 13.9 ms @ 72 Hz | ≥ 95 % | |
| Cold-cache load to interactive @ 20 Mbps | ≤ 10 s | |
| Initial payload (compressed) | ≤ 15 MB | ≈ 0.23 MB (measured from repo) |

## Reliability

- [ ] 5 complete replay cycles in headset without stale state
- [ ] 3 exit/re-enter cycles
- [ ] 3 tracking-interruption cycles

## Usability (§13): 5 people new to the build

| # | Completed both paths unaided? | Explained why A was quarantined? | Comfort / reach / readability notes | Assistance needed |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

Proposed gate: ≥ 4 of 5 complete both paths without intervention.

---

## Session 1: first headset run (Oct 1, 2026, Devin, Quest 2, Meta Quest Browser)

**Worked**
- Loaded from the hosted HTTPS link. Enter VR showed the browser's immersive prompt, Allow went straight into the scene.
- Smooth frame rate (subjective, not yet measured with OVR Metrics).
- Panel text easy to read. Some softness, partly from the headset lenses.
- Grab, hold and rotate feel natural. Box textures look good. Quarantine and scan interactions work well.
- Setup controls (seated/standing, bench lower/higher, recenter) put the bench in the right spot. No need to move around the room.

**Issues → fixes (next commit)**
| Observation | Fix |
|---|---|
| Wanted sharper text and visuals | Framebuffer scale 1.0 → 1.25, fixed foveation 1 → 0.5, world panels drawn at 1.5× resolution, 8× anisotropic filtering. **Re-check frame rate.** |
| Quarantine "Hold for review" sign flickered against its post (same plane) | Sign moved 1.5 cm in front of the post |
| Outbound sign post stood in the middle of the conveyor | Post moved beside the belt, so the belt is clear |
| Jump into VR felt abrupt | Fade-in from dark with a short title card (about 2 s). The world itself does not move, for comfort. |

**Still to record:** OS and browser versions, full §12 checklist, a measured 5-minute frame-timing run.

**Product feedback:** real parcel hubs work a sort-and-load flow: packages come down a ramp, a handheld scanner gives the destination, and the worker loads a trailer next to a coworker. Proposed as the next scenario (see session notes).

---

## Session 2 checklist: Station 1 Pack-Out (new, not yet run on the headset)

- [ ] Shift briefing reads clearly. **Start Station 1** lands at the pack bench.
- [ ] Handheld scanner: pick up from the front left, the red beam is visible, the tote label scans and the order monitor updates.
- [ ] Item barcodes read when facing the beam. Facing away gives "no read" with no penalty.
- [ ] Phone case scans as NOT ON ORDER. Dropping it into the yellow exception bin works.
- [ ] Carton slots S/M/L are reachable seated and standing. S and L are refused with an explanation. M builds on the pack scale.
- [ ] Items drop into the carton. Air pillows from the basket drop in.
- [ ] Tape gun seals only when held over the carton. The flaps close and the tape shows.
- [ ] Scale and monitor weight are readable. Trigger on the printer prints the label. The label goes onto the carton top.
- [ ] Carton onto the roller conveyor, then Confirm Release. Station 1 shows its score.
- [ ] **Continue to Station 2** fades to the dock bench comfortably (no nausea).
- [ ] Mistake run: pack the phone case (critical), ship before labelling (critical). Both are blocked and retained, and the result is practice recommended.
- [ ] Frame rate with both stations in view (OVR Metrics: ≥ 95 % of frames ≤ 13.9 ms at 72 Hz).
- [ ] Order monitor text legible from the standing position.

---

## Session 2: first run of both stations (Oct 1, 2026, Devin, Quest 2, standing)

**Worked:** both stations completed as planned. Setup controls and readable panels worked. The label print quality was praised. The floating step prompts help. Scan, quarantine and handling feel natural.

**Issues → fixes**
| Observation | Cause | Fix |
|---|---|---|
| Image "clips and distorts" when moving the head while the controller ray is on the menu, and sometimes while carrying a package | Dropped frames. Every hover change re-uploaded the full ~10 MB panel texture (and feedback changes did the same), so Quest reprojected the missed frames. | Hover is now an overlay mesh (no redraw). Texture uploads are asynchronous via ImageBitmap. Instrument screens update at 10 Hz. Per-frame allocations removed. **Re-test, and check with `?perf`.** |
| Order monitor rotated into its arm and overlapping the OUTBOUND sign; bottom text unreadable | Yawed screen on a side arm | Monitor moved to the learner's left, on its own floor pole, with an ORDER MONITOR sign. Larger screen. |
| Scanner not recognisable (dark, lying flat in front of the tote) | — | Bright yellow, standing in a labelled cradle. Prompt now says *PICK UP SCANNER* first. |
| Didn't know to read the order monitor, or which item was extra | — | Step text points to the monitor (left). The exception step names the scanned extra item. |
| "How am I supposed to know it's size M?" | No rule source | The monitor recommends the carton size (WMS cartonization). Item and carton sizes are shown. |
| Tape gun felt abstract | Single trigger press | Hold the trigger and draw the gun along the seam. Tape extends under the gun, with haptic and sound. Flaps fold shut. |
| Void fill visible through the closed carton | Pillow positions outside the walls | Pillows scale with the carton and are clamped inside the walls. |
| Want to replay Station 1 with other configurations | — | **Replay Station 1 (new order)**: three orders with different items, cartons and mis-picks. |
| Room needs realism | Flat-coloured shell | Textured concrete floor and block-and-cladding walls with windows. Columns, trusses, high-bay lights, stocked racking, pallets, lanes and baked contact shadows. 92 draw calls worst case. |
| Learners may ignore a floating text panel | — | The panel is now a physical work-instruction console. The YOUR TASK band and step progress bar sit on screen. The light bar pulses with a chime on each new task. |

**Still to record:** OS and browser version, a `?perf` reading at each station, and the five-person usability test.

---

## Session 3: first-time user test (Oct 1, 2026, a friend of the trainer, Quest 2, first time in the demo)

**Observed**
- Too much text on the console. The learner didn't read it, and it didn't feel like a game.
- No overview of what the training is for before starting.
- After a mistake there was nothing showing *how* to do it right.
- At Station 2, didn't know that the trigger scans once the label is in the scan zone.
- Missed the carton size suggestion on the order monitor.

**Fixes**
| Observation | Fix |
|---|---|
| Too many words, not gamified | The console was redesigned around one headline plus one line, with an icon, a step counter and progress bar, and amber key-chip hints. Padding and spacing are larger. Feedback cards have a title plus one line; details sit under the **Assist** toggle (VR) or **More** (desktop). The briefing is 3 goal cards. Results show a large score and station cards. |
| Needs an intro that outlines the 3 objectives | Briefing cards: **Pack it right · Check it · Ship verified**. An `intro` video slot autoplays on the console with scoring paused, and **Watch intro** stays available. |
| No correction after a mistake | Coaching-video slots per mistake code play once per session on the console, with Replay and Continue. |
| Didn't know to pull the trigger to scan | A hint chip above the controller always says what the trigger does. In the scan zone it turns green and pulses, with a haptic tick: **PULL TRIGGER TO SCAN**. A floating PULL TRIGGER tag shows over the scan zone. The no-read message now says what to change. |
| Carton suggestion didn't stand out | The order monitor has a large amber **USE CARTON [size]** card with the inner dimensions. The monitor frame glows during the carton step. A wrong carton says "too small" or "too big". |
| Immersion | Event sounds were added (grab, drop, print, no-read, step chime, completion). Recorded-sound, ambience, music and voice-over slots are in `media/manifest.json`. See `media/README.md`. |

**Re-test with a new first-time user:**
- [ ] They can say the 3 objectives after the intro.
- [ ] They scan at Station 2 without being told.
- [ ] They pick the right carton first try.
- [ ] Time to finish Station 1.
