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
