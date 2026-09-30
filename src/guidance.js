// Builds UI content specs from engine state. Pure (no DOM / three), so the
// in-VR panel and the HTML desktop fallback render the same content and the
// same action ids — one source for input parity (PRD FR-12).
import { SCENARIO, weightRange } from './scenario.js';

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export { fmtTime };

const STEPS = {
  damaged: ['inspect', 'decide', 'quarantine'],
  intact: ['inspect', 'decide', 'scan', 'weigh', 'confirm', 'route', 'release'],
};

const STATE_STEP = {
  waiting: 'inspect', inspecting: 'inspect', condition_submitted: 'decide',
  rejected: 'quarantine', accepted: 'scan', scanned: 'weigh', weighed: 'confirm',
  weight_confirmed: 'route', staged: 'release',
};

/** Where the local "next step" prompt should point. */
export function markerTarget(engine) {
  const key = engine.activePackage();
  if (!key) return null;
  const st = engine.packageState(key);
  switch (st) {
    case 'waiting':
    case 'inspecting':
      return { target: `package:${key}`, text: 'INSPECT' };
    case 'rejected': return { target: 'quarantine', text: 'NEXT: QUARANTINE' };
    case 'accepted': return { target: 'scanZone', text: 'NEXT: SCAN HERE' };
    case 'scanned': return { target: 'scale', text: 'NEXT: WEIGH' };
    case 'weighed': return { target: 'scaleScreen', text: 'READ THE SCALE' };
    case 'weight_confirmed': return { target: 'outbound', text: 'NEXT: OUTBOUND' };
    case 'staged': return { target: 'releaseButton', text: 'CONFIRM RELEASE' };
    default: return null;
  }
}

function stepText(key, state, { vr }) {
  const def = SCENARIO.packages[key];
  const grab = vr ? 'Squeeze GRIP to pick it up (or point at it and squeeze to pull it to your hand)' : 'Select Bring to me, or click the package';
  const { min, max } = weightRange(SCENARIO.packages.B);
  switch (state) {
    case 'waiting':
      return { title: `Inspect ${def.label}`, body: [`${grab}.`, 'Turn it to check every side for crushes, tears or punctures.'] };
    case 'inspecting':
      return {
        title: `Inspect ${def.label}`,
        body: [vr ? 'Turn the package in your hand (or use the thumbstick / Rotate) to check every side.' : 'Use Rotate and Flip (or the arrow keys) to check every side.',
          'Then record its condition below.'],
      };
    case 'condition_submitted':
      return { title: `Decide: accept or reject ${def.label}`, body: ['Rule: visible damage → REJECT. No visible damage → ACCEPT.'] };
    case 'rejected':
      return {
        title: `Quarantine ${def.label}`,
        body: [vr ? 'Carry it to the QUARANTINE tote on the left and release it inside.' : 'Select Place: Quarantine.',
          'Assisted placement buttons below also work.'],
      };
    case 'accepted':
      return {
        title: `Scan ${def.label}`,
        body: [vr ? 'Hold the barcode label inside the green SCAN ZONE, facing the scanner, and press TRIGGER.' : 'Select Scan (assisted).',
          'The scanner shows the package ID when the read succeeds.'],
      };
    case 'scanned':
      return { title: `Weigh ${def.label}`, body: [vr ? 'Place it on the scale plate and let go.' : 'Select Place: Scale.'] };
    case 'weighed':
      return {
        title: 'Confirm the weight',
        body: [`Read the scale display. Expected range: ${min.toFixed(2)} – ${max.toFixed(2)} kg (scenario value).`, 'Is the measured weight within range?'],
      };
    case 'weight_confirmed':
      return { title: 'Route outbound', body: [vr ? 'Place the package on the OUTBOUND conveyor on the right.' : 'Select Place: Outbound.'] };
    case 'staged':
      return { title: 'Confirm release', body: ['Select Confirm Release (here or the green button beside the conveyor) to send it.'] };
    default:
      return { title: def.label, body: [] };
  }
}

/**
 * view: {
 *   engine, vr: bool, xrActive: bool, held: key|null, heldBy: 'hand'|'assist'|null,
 *   onFloor: [keys], settings: {posture, reducedMotion, muted}, resultsPage, needsTrackingForResume
 * }
 */
export function buildMainSpec(view) {
  const { engine } = view;
  if (engine.isPaused()) return buildPauseSpec(view);
  switch (engine.phase) {
    case 'setup': return buildSetupSpec(view);
    case 'briefing': return buildBriefingSpec(view);
    case 'complete': return buildResultsSpec(view);
    default: return buildExerciseSpec(view);
  }
}

function comfortRows(view) {
  const { settings } = view;
  return [
    [
      { id: 'posture:seated', label: 'Seated', active: settings.posture === 'seated' },
      { id: 'posture:standing', label: 'Standing', active: settings.posture === 'standing' },
    ],
    [
      { id: 'height:down', label: 'Bench lower' },
      { id: 'height:up', label: 'Bench higher' },
      { id: 'recenter', label: 'Recenter' },
    ],
  ];
}

function buildSetupSpec(view) {
  const vr = view.vr;
  return {
    kicker: `${SCENARIO.org} · Comfort setup · not scored`,
    title: 'Set up your workstation',
    body: [
      'Choose Seated or Standing, then adjust the bench to a comfortable height. Recenter if the bench is not in front of you.',
      vr
        ? 'Practice: squeeze GRIP near the grey practice box to grab it, release GRIP to let go. Point and pull TRIGGER to press buttons.'
        : 'Desktop preview: click buttons or use Tab + Enter. Drag to look around.',
    ],
    feedback: view.feedback,
    buttons: [
      ...comfortRows(view),
      [{ id: 'help', label: 'Controls & help' }, { id: 'continue', label: 'Continue to briefing', variant: 'primary' }],
    ],
  };
}

function buildBriefingSpec(view) {
  return {
    kicker: `${SCENARIO.org} · Briefing`,
    title: 'Receiving procedure (demo rules)',
    bodySize: 29,
    body: [
      ...SCENARIO.rules.map((r) => ({ text: r, bullet: true })),
      { text: 'Synthetic demonstration rules — not an approved operating procedure.', color: '#9aa7b4', size: 24 },
      { text: 'Score: first attempt at each of 10 checkpoints. Mistakes can be corrected so you can finish, but they stay on the record.', color: '#9aa7b4', size: 24 },
    ],
    feedback: view.feedback,
    buttons: [[{ id: 'help', label: 'Controls & help' }, { id: 'start', label: 'Start exercise', variant: 'primary' }]],
  };
}

function buildPauseSpec(view) {
  const { engine } = view;
  const reasons = [...engine.pauseReasons];
  const lines = [];
  if (reasons.includes('input')) lines.push('A controller disconnected. Any package you were holding is frozen in place.');
  if (reasons.includes('xr-visibility')) lines.push('The headset view was interrupted (system menu or tracking loss).');
  if (reasons.includes('xr-exit')) lines.push('You left VR. Your progress is kept — select Enter VR to continue in the headset, or Resume here in the preview.');
  if (reasons.includes('hidden')) lines.push('The page was hidden.');
  if (reasons.includes('menu')) lines.push('Help is open.');
  lines.push('Scoring and the timer are paused. Nothing you do while paused is scored.');
  if (view.needsTrackingForResume) lines.push('Waiting for controller tracking before you can resume…');
  return {
    kicker: 'Paused',
    title: 'Training paused',
    accent: '#4a9be0',
    body: lines,
    feedback: view.feedback,
    buttons: [[
      { id: 'help', label: 'Help & settings' },
      { id: 'resume', label: 'Resume', variant: 'primary', enabled: !view.needsTrackingForResume },
    ]],
  };
}

function buildExerciseSpec(view) {
  const { engine } = view;
  const key = engine.activePackage();
  const def = SCENARIO.packages[key];
  const st = engine.packageState(key);
  const steps = STEPS[def.condition];
  const stepIdx = steps.indexOf(STATE_STEP[st]) + 1;
  const { title, body } = stepText(key, st, view);

  const decision = [];
  if (st === 'waiting' || st === 'inspecting') {
    decision.push({ id: 'condition:damaged', label: 'Condition: DAMAGED', enabled: st === 'inspecting' });
    decision.push({ id: 'condition:intact', label: 'Condition: INTACT', enabled: st === 'inspecting' });
  } else if (st === 'condition_submitted') {
    decision.push({ id: 'decide:accept', label: 'ACCEPT', variant: 'primary' });
    decision.push({ id: 'decide:reject', label: 'REJECT', variant: 'primary' });
  } else if (st === 'weighed') {
    decision.push({ id: 'weight:within', label: 'Weight IN range', variant: 'primary' });
    decision.push({ id: 'weight:outside', label: 'Weight OUT of range', variant: 'primary' });
  }

  const heldHere = view.held === key;
  const onFloor = view.onFloor.includes(key);
  const manip = [
    onFloor
      ? { id: 'retrieve', label: 'Retrieve package', variant: 'primary' }
      : heldHere
        ? { id: 'assist:return', label: 'Return to bench' }
        : { id: 'assist:bring', label: 'Bring to me' },
    { id: 'assist:rotate', label: 'Rotate 90°', enabled: heldHere && view.heldBy === 'assist' },
    { id: 'assist:flip', label: 'Flip 90°', enabled: heldHere && view.heldBy === 'assist' },
  ];
  // All destinations are always offered, so assistance never reveals the answer.
  const place = [
    { id: 'place:quarantine', label: 'Place: Quarantine' },
    { id: 'scan', label: 'Scan (assisted)' },
    { id: 'place:scale', label: 'Place: Scale' },
    { id: 'place:outbound', label: 'Place: Outbound' },
  ];
  const last = [{ id: 'help', label: 'Help / Pause' }];
  if (def.condition === 'intact' && engine.stateAtLeast(key, 'accepted')) {
    last.push({ id: 'release', label: 'Confirm release', variant: st === 'staged' ? 'primary' : 'default' });
  }
  return {
    kicker: `${def.label} · ${def.id} · Step ${stepIdx} of ${steps.length}`,
    title,
    body,
    feedback: view.feedback,
    buttons: [decision, manip, place, last],
    buttonHeight: 70,
  };
}

export function buildResultsSpec(view) {
  const r = view.engine.results();
  const tone = r.status === 'proficient' ? '#2fae66' : '#e0b12b';
  const mark = (c) => (c.status === 'passed' ? 'PASS' : c.corrected ? 'MISS, corrected' : 'MISS');
  const details = view.resultsPage === 'details';
  const summary = [
    { text: `Score: ${r.score} / ${r.maxScore} (first attempts)`, bold: true, size: 34 },
    {
      text: r.criticalErrors.length
        ? `Critical errors: ${r.criticalErrors.length} — ${r.criticalErrors.map((c) => c.label).join('; ')}`
        : 'Critical errors: none',
      color: r.criticalErrors.length ? '#ff9b9b' : '#b8f5cf',
    },
    `Corrections made: ${r.corrections}   ·   Time: ${fmtTime(r.elapsedMs)} (informational, no speed bonus)`,
    { text: `Demo threshold: ≥ ${r.threshold.minScore} and zero critical errors (pending instructional validation).`, color: '#9aa7b4', size: 24 },
  ];
  const stageLines = ['A', 'B'].map((k) => {
    const cps = r.checkpoints.filter((c) => c.pkg === k);
    const got = cps.filter((c) => c.status === 'passed').reduce((a, c) => a + c.points, 0);
    const max = cps.reduce((a, c) => a + c.points, 0);
    const missed = cps.filter((c) => c.status !== 'passed').map((c) => c.label);
    return { text: `${SCENARIO.packages[k].label}: ${got}/${max}${missed.length ? ` — review: ${missed.join('; ')}` : ' — all first attempts correct'}`, size: 26 };
  });
  const body = details
    ? r.checkpoints.map((c) => ({ text: `[${mark(c)}] ${c.label}${c.note && c.status !== 'passed' ? ` — ${c.note}` : ''}`, size: 23, color: c.status === 'passed' ? '#dbe2ea' : '#ffd29b' }))
    : [...summary, { gap: 6 }, ...stageLines];
  return {
    kicker: `Results · ${r.complete ? 'session complete' : 'in progress'}`,
    title: r.statusLabel,
    titleSize: 44,
    accent: tone,
    bodySize: 28,
    body,
    buttons: [[
      { id: details ? 'results:summary' : 'results:details', label: details ? 'Summary' : 'Checkpoint details' },
      { id: 'help', label: 'Help' },
      { id: 'replay', label: 'Replay', variant: 'primary' },
    ]],
  };
}

export function buildHelpSpec(view) {
  const { settings, vr } = view;
  const controls = vr ? SCENARIO.controls.vr : SCENARIO.controls.desktop;
  return {
    kicker: 'Help · training is paused while this is open',
    title: 'Controls, rules & settings',
    bodySize: 25,
    body: [
      { text: 'Controls', bold: true, size: 27 },
      ...controls.map((c) => ({ text: c, bullet: true, size: 24 })),
      { text: 'Rules', bold: true, size: 27 },
      ...SCENARIO.rules.slice(1, 3).map((c) => ({ text: c, bullet: true, size: 24 })),
    ],
    buttons: [
      ...comfortRows(view),
      [
        { id: 'toggle:motion', label: `Reduced motion: ${settings.reducedMotion ? 'ON' : 'OFF'}`, active: settings.reducedMotion },
        { id: 'toggle:sound', label: `Sound: ${settings.muted ? 'OFF' : 'ON'}`, active: !settings.muted },
      ],
      [
        { id: 'restart', label: 'Restart session', variant: 'danger' },
        ...(view.xrActive ? [{ id: 'exitvr', label: 'Exit VR' }] : []),
        { id: 'resume', label: 'Close & resume', variant: 'primary', enabled: !view.needsTrackingForResume },
      ],
    ],
    buttonHeight: 68,
  };
}
