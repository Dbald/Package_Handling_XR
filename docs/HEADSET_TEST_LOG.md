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
