// Builds UI content specs from engine state. Pure (no DOM / three), so the
// in-VR panel and the HTML desktop fallback render the same content and the
// same action ids — one source for input parity (PRD FR-12).
import { SCENARIO, weightRange } from './scenario.js';
import { packWeightRange } from './pack/scenario.js';

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
  const { session } = view;
  if (session.isPaused()) return buildPauseSpec(view);
  switch (session.phase) {
    case 'setup': return buildSetupSpec(view);
    case 'briefing': return buildSessionBriefingSpec(view);
    case 'pack': return session.pack.isComplete() ? buildPackDoneSpec(view) : buildPackSpec(view);
    case 'dock-briefing': return buildBriefingSpec(view);
    case 'complete': return buildSessionResultsSpec(view);
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
    kicker: 'Station 2 · Dock Check · Briefing',
    title: 'Check packages before they ship',
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
  const reasons = [...view.session.pauseReasons];
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
    kicker: `Station 2 · ${def.label} · ${def.id} · Step ${stepIdx} of ${steps.length}`,
    title,
    objective: true,
    progress: { i: stepIdx, n: steps.length },
    bodySize: 30,
    body,
    feedback: view.feedback,
    buttons: [decision, manip, place, last],
    buttonHeight: 70,
  };
}

export function buildHelpSpec(view) {
  const { settings, vr } = view;
  const controls = vr ? [...SCENARIO.controls.vr, 'Scanner and tape gun: pick up, aim, pull TRIGGER to use.'] : SCENARIO.controls.desktop;
  const atPack = view.session.stationKey === 'pack';
  const rules = atPack ? view.session.pack.scenario.rules.slice(0, 3) : SCENARIO.rules.slice(1, 3);
  return {
    kicker: 'Help · training is paused while this is open',
    title: 'Controls, rules & settings',
    bodySize: 25,
    body: [
      { text: 'Controls', bold: true, size: 27 },
      ...controls.map((c) => ({ text: c, bullet: true, size: 24 })),
      { text: 'Rules', bold: true, size: 27 },
      ...rules.map((c) => ({ text: c, bullet: true, size: 24 })),
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

// ------------------------------------------------------------ two-station flow

function buildSessionBriefingSpec(view) {
  return {
    kicker: `${SCENARIO.org} · Shift briefing`,
    title: 'Two stations, one order journey',
    bodySize: 28,
    body: [
      { text: 'Station 1 · Pack-Out: pack a customer order correctly and send it to the dock.', bold: true },
      ...view.session.pack.scenario.rules.map((r) => ({ text: r, bullet: true, size: 25 })),
      { text: 'Station 2 · Dock Check: inspect outgoing packages before they are loaded.', bold: true },
      { text: 'Synthetic demo rules. Scored on first attempts; mistakes can be corrected but stay on the record.', color: '#9aa7b4', size: 23 },
    ],
    feedback: view.feedback,
    buttons: [[
      { id: 'help', label: 'Controls & help' },
      { id: 'station:skip', label: 'Skip to Station 2 (demo)' },
      { id: 'station:pack', label: 'Start Station 1', variant: 'primary' },
    ]],
  };
}

const PACK_STEPS = ['open', 'scan', 'exception', 'carton', 'pack', 'dunnage', 'seal', 'weigh', 'print', 'label', 'outbound', 'release'];

function packStepText(step, vr, e) {
  const S = e.scenario;
  const { min, max } = packWeightRange(S);
  const extra = S.itemOrder.find((k) => !S.items[k].onOrder);
  const extraKnown = extra && e.items[extra].scanned;
  const fragile = S.itemOrder.filter((k) => S.items[k].onOrder && S.items[k].fragile).map((k) => S.items[k].name.toLowerCase());
  const t = {
    open: ['Open the order', vr
      ? 'Pick up the yellow SCANNER (front of the bench). Aim the red beam at the tote label and pull TRIGGER.'
      : 'Select Scan tote. The order opens on the ORDER MONITOR (left).'],
    scan: ['Scan each item', vr
      ? 'Scan every item in the tote. Check each one against the ORDER MONITOR on your left: anything not listed there is NOT on the order.'
      : 'Choose an item with the Item button, then Scan item. Compare with the ORDER MONITOR (left).'],
    exception: ['Divert the extra item', extraKnown
      ? `The ${S.items[extra].name.toLowerCase()} is NOT on this order (it is not on the monitor). Put it in the yellow EXCEPTION bin; never pack it.`
      : 'One item in the tote is NOT on this order. Put it in the yellow EXCEPTION bin; never pack it.'],
    carton: ['Choose the carton', vr
      ? `The ORDER MONITOR shows which carton to use: size ${S.correctCarton}. Take it from the slots at the back and set it on the pack scale.`
      : `The ORDER MONITOR recommends size ${S.correctCarton} (the smallest that fits). Pick that carton.`],
    pack: ['Pack the order', vr ? 'Place each order item into the carton.' : 'Select an order item, then Pack in carton.'],
    dunnage: ['Protect the fragile item', vr
      ? `The ${fragile.join(' and ')} ${fragile.length > 1 ? 'are' : 'is'} fragile. Drop air pillows from the VOID FILL basket into the carton.`
      : 'Select Add void fill.'],
    seal: ['Seal the carton', vr
      ? 'Pick up the TAPE GUN. Hold it at one end of the top seam, keep TRIGGER held and draw it across to the other end.'
      : 'Select Seal carton.'],
    weigh: ['Confirm the weight', `Read the pack scale. Expected ${min.toFixed(2)} – ${max.toFixed(2)} kg. Is the weight within range?`],
    print: ['Print the shipping label', vr ? 'Select Print label, or point at the label printer and pull TRIGGER.' : 'Select Print label.'],
    label: ['Apply the label', vr ? 'Take the label from the printer and place it on top of the carton.' : 'Select Apply label.'],
    outbound: ['Send it outbound', vr ? 'Place the carton on the OUTBOUND roller conveyor (right).' : 'Select Place on outbound.'],
    release: ['Confirm release', 'Select Confirm release here or press the green button beside the conveyor.'],
  }[step] ?? ['Pack-Out', ''];
  return { title: t[0], body: [t[1]] };
}

function chunk(list, n) {
  const rows = [];
  for (let i = 0; i < list.length; i += n) rows.push(list.slice(i, i + n));
  return rows;
}

export function buildPackSpec(view) {
  const e = view.session.pack;
  const st = view.packStation;
  const step = e.step();
  const idx = PACK_STEPS.indexOf(step) + 1;
  const { title, body } = packStepText(step, view.vr, e);
  const S = e.scenario;
  const decision = [];
  if (!e.carton) S.cartonOrder.forEach((k) => decision.push({ id: `pk:carton:${k}`, label: `Carton ${k}` }));
  if (e.sealed && !e.weightConfirmed) {
    decision.push({ id: 'pk:weight:within', label: 'Weight IN range', variant: 'primary' });
    decision.push({ id: 'pk:weight:outside', label: 'Weight OUT of range', variant: 'primary' });
  }
  const itemRow = [];
  const selectable = st.selectableItems();
  if (!e.sealed && selectable.length) {
    itemRow.push({ id: 'pk:select', label: `Item: ${S.items[st.selected].name} ▸` });
    itemRow.push({ id: 'pk:scan:item', label: 'Scan item' });
    itemRow.push({ id: 'pk:pack', label: 'Pack in carton' });
    itemRow.push({ id: 'pk:divert', label: 'To exception bin' });
  }
  const tools = [];
  if (!e.orderOpen) tools.push({ id: 'pk:scan:tote', label: 'Scan tote', variant: 'primary' });
  if (e.carton && !e.sealed) {
    tools.push({ id: 'pk:dunnage', label: 'Add void fill' });
    tools.push({ id: 'pk:seal', label: 'Seal carton' });
  }
  if (e.sealed && !e.labelPrinted) tools.push({ id: 'pk:print', label: 'Print label' });
  if (e.labelPrinted && !e.labelApplied) tools.push({ id: 'pk:apply', label: 'Apply label' });
  if (e.labelApplied && !e.staged) tools.push({ id: 'pk:outbound', label: 'Place on outbound' });
  if (st.floorItems().length) tools.push({ id: 'pk:retrieve', label: 'Retrieve items', variant: 'primary' });
  const last = [{ id: 'help', label: 'Help / Pause' }];
  if (e.carton) last.push({ id: 'release', label: 'Confirm release', variant: e.staged ? 'primary' : 'default' });
  return {
    kicker: `Station 1 · Pack-Out · ${S.order.id} · Step ${idx} of ${PACK_STEPS.length}`,
    title,
    objective: true,
    progress: { i: idx, n: PACK_STEPS.length },
    bodySize: 30,
    body,
    feedback: view.feedback,
    buttons: [decision, itemRow, ...chunk(tools, 4), last],
    buttonHeight: 64,
  };
}

function buildPackDoneSpec(view) {
  const r = view.session.pack.results();
  return {
    kicker: 'Station 1 · Pack-Out · complete',
    title: 'Order packed and released',
    accent: r.status === 'proficient' ? '#2fae66' : '#e0b12b',
    body: [
      { text: `Station 1 score: ${r.score} / ${r.maxScore} (first attempts)`, bold: true, size: 34 },
      r.criticalErrors.length
        ? { text: `Critical errors: ${r.criticalErrors.map((c) => c.label).join('; ')}`, color: '#ff9b9b' }
        : { text: 'Critical errors: none', color: '#b8f5cf' },
      { gap: 8 },
      'Next: Station 2 · Dock Check. You will inspect outgoing packages before they are loaded.',
    ],
    feedback: view.feedback,
    buttons: [[
      { id: 'help', label: 'Help' },
      { id: 'station:replay-pack', label: 'Replay Station 1 (new order)' },
      { id: 'station:dock', label: 'Continue to Station 2', variant: 'primary' },
    ]],
  };
}

export function buildSessionResultsSpec(view) {
  const r = view.session.results();
  const page = view.resultsPage;
  const mark = (c) => (c.status === 'passed' ? 'PASS' : c.corrected ? 'MISS, corrected' : 'MISS');
  const station = r.stations.find((s) => s.key === page);
  let body;
  if (station) {
    body = [
      { text: `Station ${station.number} · ${station.name}: ${station.results.score}/${station.results.maxScore}${station.skipped ? ' (skipped)' : ''}`, bold: true, size: 28 },
      ...station.results.checkpoints.map((c) => ({
        text: `[${mark(c)}] ${c.label}${c.note && c.status !== 'passed' ? ` — ${c.note}` : ''}`,
        size: 22, color: c.status === 'passed' ? '#dbe2ea' : '#ffd29b',
      })),
    ];
  } else {
    body = [
      { text: `Total: ${r.score} / ${r.maxScore} (first attempts)`, bold: true, size: 34 },
      ...r.stations.map((s) => ({
        text: `Station ${s.number} · ${s.name}: ${s.skipped ? 'skipped' : `${s.results.score}/${s.results.maxScore} — ${s.results.statusLabel}`}`,
        size: 28,
      })),
      {
        text: r.criticalErrors.length
          ? `Critical errors: ${r.criticalErrors.map((c) => `S${c.station}: ${c.label}`).join('; ')}`
          : 'Critical errors: none',
        color: r.criticalErrors.length ? '#ff9b9b' : '#b8f5cf',
      },
      `Time: ${fmtTime(r.elapsedMs)} (informational, no speed bonus)`,
      { text: 'Demo threshold per station: ≥ 80 and zero critical errors (pending instructional validation).', color: '#9aa7b4', size: 23 },
    ];
  }
  const nav = [
    page !== 'summary' ? { id: 'results:summary', label: 'Summary' } : null,
    page !== 'pack' ? { id: 'results:pack', label: 'Station 1 details' } : null,
    page !== 'dock' ? { id: 'results:dock', label: 'Station 2 details' } : null,
  ].filter(Boolean);
  return {
    kicker: 'Results · session complete',
    title: r.statusLabel,
    titleSize: 44,
    accent: r.status === 'proficient' ? '#2fae66' : '#e0b12b',
    bodySize: 28,
    body,
    buttons: [nav, [{ id: 'help', label: 'Help' }, { id: 'replay', label: 'Replay', variant: 'primary' }]],
  };
}
