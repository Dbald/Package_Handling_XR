# Media: videos, sounds, music, voice

Everything here is optional. Anything you don't supply is skipped (videos) or uses a built-in placeholder (sounds).

**To add a file:**
1. Put it in `media/video/` or `media/audio/`.
2. List it in `media/manifest.json`.
3. Deploy.

No code changes are needed.

```json
{
  "videos": {
    "intro": "video/intro.mp4",
    "pack:WRONG_ITEM": "video/wrong-item.mp4"
  },
  "audio": {
    "sfx": { "scan": "audio/scan-beep.mp3", "grab": "audio/cardboard-grab.mp3" },
    "ambience": "audio/warehouse-loop.mp3",
    "music": null
  }
}
```

---

## 1. Videos (play on the instruction console)

**How they play**
- **Intro** plays automatically the first time the shift briefing opens.
- **Coaching clips** play automatically the first time a learner makes that mistake in a session. They never repeat in the same session.
- Every video has **Skip** and **Replay**, and scoring pauses while a video plays.

| Key | Plays when | Suggested content (≤ 30 s) | Priority |
|---|---|---|---|
| `intro` | Shift briefing opens | The 3 goals: **pack it right, check it, ship verified**. Show the two stations. | ★★★ |
| `dock-intro` | "▶ Watch" on the Station 2 briefing | Inspect → decide → scan/weigh/ship | ★★ |
| `pack:ORDER_NOT_OPEN` | Touched items before scanning the tote | "Always scan the tote first. It opens the order." | ★★ |
| `pack:NO_READ` | Scanner gun missed | Point the beam at the barcode, pull the trigger | ★★★ |
| `pack:WRONG_ITEM` | Tried to pack the item that isn't on the order | Compare items with the monitor; extras go to the yellow bin | ★★★ |
| `pack:SCAN_FIRST` | Packed an item without scanning it | Every item gets scanned before it goes in | ★★ |
| `pack:CARTON_WRONG` | Picked the wrong carton | Read "USE CARTON" on the monitor | ★★★ |
| `pack:NEEDS_DUNNAGE` | Sealed a fragile item without fill | Air pillows around fragile items | ★★ |
| `pack:MISSING_ITEMS` | Sealed before packing everything | Check the PACKED column first | ★ |
| `pack:TOTE_NOT_CLEAR` | Sealed with the extra item still in the tote | Clear the tote before closing the order | ★ |
| `pack:PRINT_EARLY` | Printed the label before confirming weight | Seal → weigh → then label | ★ |
| `pack:WEIGHT_WRONG` | Misread the scale | How to read the range | ★ |
| `pack:PREMATURE_RELEASE` | Tried to ship an unfinished carton | Sealed + weighed + labelled before release | ★★ |
| `dock:NO_READ` | Scan zone didn't read | Label in the green zone, facing the scanner, **pull the trigger** | ★★★ |
| `dock:CONDITION_WRONG` | Misjudged damaged vs intact | What damage looks like (crush, tear, puncture) | ★★ |
| `dock:ACCEPTED_DAMAGED` | Accepted the damaged package | Why damage is never accepted | ★★★ |
| `dock:REJECTED_INTACT` | Rejected a good package | Good packages get accepted | ★ |
| `dock:DAMAGED_OUTBOUND` | Sent damage outbound | Damage goes to quarantine | ★★ |
| `dock:SCAN_FIRST` | Weighed before scanning | Scan first, then weigh | ★ |
| `dock:WEIGHT_WRONG` | Misread the scale | How to read the range | ★ |
| `dock:PREMATURE_RELEASE` | Tried to ship before scan and weight | Scan + weigh before release | ★★ |

**Specs**
- **Format:** MP4 (H.264 video + AAC audio).
- **Size:** 1280×720, 30 fps, about 2 Mbps.
- **Length:** under 30 s for coaching clips, under 60 s for the intro.
- **Captions:** burn them in. Some learners will have sound off, and the training never relies on sound alone (PRD FR-09).
- **Framing:** the console screen is 16:9 and about 1.2 m wide at arm's length. Keep text big and in the centre 80% of the frame.
- **Loading:** files are fetched only when they play, so they don't slow the first load.

---

## 2. Sound effects

The **Key** column is the name to use in `audio.sfx`. "Placeholder" means a built-in synthesized sound is used until you supply a file. Keep effects short (under 1 s unless noted), mono, 48 kHz, as MP3 or OGG, with peaks around −3 dBFS. Normalize them so they sit at a similar loudness.

### Highest impact first (★★★)
| Key | When it plays | What it should sound like | Placeholder |
|---|---|---|---|
| `scan` | Successful scan (both stations) | Classic retail "beep" | yes |
| `noread` | Scan missed | Short low double-buzz | yes |
| `grab` | Picking anything up | Cardboard handling / brush | yes |
| `drop` | Setting something down | Soft cardboard thud on a bench | yes |
| `tape` | While drawing the tape gun (repeats) | Tape-gun screech grain, about 80 ms, several variations if possible | yes |
| `tapeEnd` | Carton sealed | Tape tear-off "rip" + blade snap | no |
| `step` | A new task appears on the console | Gentle two-note chime | yes |
| `success` | Correct action | Positive short chime | yes |
| `error` | Wrong, recoverable | Soft "nope" thud | yes |
| `critical` | Critical mistake | Firm buzzer (not alarming or painful) | yes |

### Adds realism (★★)
| Key | When | Sound | Placeholder |
|---|---|---|---|
| `fold` | Carton built | Cardboard fold / pop open | no |
| `pillow` | Air pillow added | Plastic rustle / squeak | no |
| `print` | Label printing | Thermal printer feed buzz (about 0.6 s) | yes |
| `label` | Label applied | Peel and press | no |
| `bin` | Item into the exception bin or quarantine tote | Plastic tote thunk | no |
| `conveyor` | Released carton travels away | Rollers rumbling (2–3 s) | no |
| `warning` | Blocked ("not yet") | Neutral low blip | yes |
| `click` | Button press | Soft tactile click | yes |
| `complete` | Station complete | Short celebratory sting (about 1.5 s) | yes |
| `transition` | Fade between stations | Soft whoosh | yes |

---

## 3. Ambience and music (looping beds)

| Slot | Default | Content | Spec |
|---|---|---|---|
| `ambience` | **On** (low level) | Warehouse room tone: HVAC hum, distant forklift beeps, pallet jack, far-off conveyor, muffled voices. **No speech the learner might try to follow.** | 60–120 s seamless loop, stereo, about −30 LUFS |
| `music` | **Off** (PRD: no auto-playing music) | Optional low-key lo-fi or electronic bed for the briefing and results | 60–120 s seamless loop, about −28 LUFS |

Learners can switch Sounds, Ambience and Music independently in Help.

---

## 4. Optional voice-over, one line per step

If a file is listed as `audio.sfx["vo:<step>"]`, it plays each time that step starts.

**Station 1**

| Key | Line |
|---|---|
| `vo:pack:open` | "Grab the scanner and scan the tote." |
| `vo:pack:scan` | "Scan each item. Check them on the monitor." |
| `vo:pack:exception` | "That one's not ordered. Yellow bin." |
| `vo:pack:carton` | "Grab the carton size on the monitor." |
| `vo:pack:pack` | "Pack the order items." |
| `vo:pack:dunnage` | "Fragile. Add air pillows." |
| `vo:pack:seal` | "Tape it shut along the top." |
| `vo:pack:weigh` | "Check the weight." |
| `vo:pack:print` | "Print the label." |
| `vo:pack:label` | "Label on top." |
| `vo:pack:outbound` | "On the conveyor." |
| `vo:pack:release` | "Ship it." |

**Station 2**

| Key | Line |
|---|---|
| `vo:dock:A:inspect` | "Pick it up. Check every side." |
| `vo:dock:A:decide` | "Accept or reject?" |
| `vo:dock:A:quarantine` | "Damaged. Quarantine it." |
| `vo:dock:B:inspect` | "Pick up Package B. Check every side." |
| `vo:dock:B:decide` | "Accept or reject?" |
| `vo:dock:B:scan` | "Label in the green zone. Pull the trigger." |
| `vo:dock:B:weigh` | "Set it on the scale." |
| `vo:dock:B:confirm` | "Check the weight." |
| `vo:dock:B:route` | "On the conveyor." |
| `vo:dock:B:release` | "Ship it." |

Keep each line under 3 seconds, recorded dry (no reverb), with a consistent voice.

---

## Recording checklist (shortest path to "feels real")

1. `intro` video (3 goals).
2. `dock:NO_READ` and `pack:NO_READ` "how to scan" clips. These answer the trigger confusion seen in testing.
3. `pack:CARTON_WRONG`, `pack:WRONG_ITEM` and `dock:ACCEPTED_DAMAGED` coaching clips.
4. Sounds: `scan`, `grab`, `drop`, `tape`, `tapeEnd`, `step`, `success`, `error`, `critical`.
5. `ambience` loop.
6. Everything else as time allows.
