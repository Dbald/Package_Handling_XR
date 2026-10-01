// Builds UI content specs from engine state. Pure (no DOM / three), so the
// in-VR console and the HTML desktop fallback render the same content and
// the same action ids — one source for input parity (PRD FR-12).
//
// Copy rules (from learner testing): one task per screen, a title of a few
// words, at most one short line under it, controller hints as chips, and
// feedback as a headline + one line. Assisted controls are one "Assist" tap
// away in VR; the desktop shows them all (it has no hands).
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

const HINT = {
  grab: { key: 'GRIP', text: 'grab' },
  press: { key: 'TRIGGER', text: 'press buttons' },
  scan: { key: 'TRIGGER', text: 'scan' },
  turn: { key: 'STICK', text: 'turn it' },
  holdDrag: { key: 'HOLD TRIGGER', text: 'drag' },
  release: { key: 'LET GO', text: 'to drop' },
};

/** Where the local "next step" prompt should point (Station 2). */
export function markerTarget(engine) {
  const key = engine.activePackage();
  if (!key) return null;
  const st = engine.packageState(key);
  switch (st) {
    case 'waiting':
    case 'inspecting':
      return { target: `package:${key}`, text: 'INSPECT ME' };
    case 'rejected': return { target: 'quarantine', text: 'QUARANTINE' };
    case 'accepted': return { target: 'scanZone', text: 'SCAN HERE' };
    case 'scanned': return { target: 'scale', text: 'WEIGH HERE' };
    case 'weighed': return { target: 'scaleScreen', text: 'READ THE SCALE' };
    case 'weight_confirmed': return { target: 'outbound', text: 'SHIP HERE' };
    case 'staged': return { target: 'releaseButton', text: 'PRESS TO SHIP' };
    default: return null;
  }
}

export function buildMainSpec(view) {
  const { session } = view;
  if (view.video) return buildVideoSpec(view);
  if (session.isPaused()) return buildPauseSpec(view);
  switch (session.phase) {
    case 'setup': return buildSetupSpec(view);
    case 'briefing': return buildSessionBriefingSpec(view);
    case 'pack': return session.pack.isComplete() ? buildPackDoneSpec(view) : buildPackSpec(view);
    case 'dock-briefing': return buildDockBriefingSpec(view);
    case 'complete': return buildSessionResultsSpec(view);
    default: return buildDockSpec(view);
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

function chunk(list, n) {
  const rows = [];
  for (let i = 0; i < list.length; i += n) rows.push(list.slice(i, i + n));
  return rows;
}

/** VR shows only the essentials plus an Assist toggle; desktop shows all. */
function withAssist(view, essentials, assistRows, footer) {
  if (!view.vr) return [essentials, ...assistRows, footer];
  const toggle = { id: 'assist:toggle', label: view.assistOpen ? 'Hide assist' : 'Assist ▸', variant: 'ghost' };
  return view.assistOpen
    ? [essentials, ...assistRows, [...footer, toggle]]
    : [essentials, [...footer, toggle]];
}

// ------------------------------------------------------------- phases

function buildSetupSpec(view) {
  return {
    chip: 'Setup · not scored',
    icon: 'gear',
    title: 'Get comfortable',
    subtitle: view.vr ? 'Set your height. Try grabbing the grey box.' : 'Set your view, then continue.',
    hints: view.vr ? [HINT.grab, HINT.press] : [],
    feedback: view.feedback,
    buttons: [
      ...comfortRows(view),
      [{ id: 'help', label: 'Help' }, { id: 'continue', label: 'Next', variant: 'primary' }],
    ],
  };
}

function buildSessionBriefingSpec(view) {
  const row = [];
  if (view.videos?.has('intro')) row.push({ id: 'video:intro', label: '▶ Watch intro' });
  row.push({ id: 'station:skip', label: 'Skip to Station 2', variant: 'ghost' });
  row.push({ id: 'station:pack', label: 'Start', variant: 'primary' });
  return {
    chip: 'Your shift',
    title: 'Three goals',
    subtitle: 'Pack it, check it, ship it right.',
    cards: [
      { icon: 'box', title: 'Pack it right', text: 'Right items, right box.' },
      { icon: 'eye', title: 'Check it', text: 'Damage → quarantine.' },
      { icon: 'ship', title: 'Ship verified', text: 'Scan, weigh, label.' },
    ],
    feedback: view.feedback,
    buttons: [row],
  };
}

function buildDockBriefingSpec(view) {
  const row = [{ id: 'help', label: 'Help' }];
  if (view.videos?.has('dock-intro')) row.push({ id: 'video:dock-intro', label: '▶ Watch' });
  row.push({ id: 'start', label: 'Start', variant: 'primary' });
  return {
    chip: 'Station 2 · Dock check',
    title: 'Check before it ships',
    cards: [
      { icon: 'eye', title: 'Inspect', text: 'Look at every side.' },
      { icon: 'decide', title: 'Decide', text: 'Damaged → reject.' },
      { icon: 'scan', title: 'Process', text: 'Scan, weigh, ship.' },
    ],
    feedback: view.feedback,
    buttons: [row],
  };
}

function buildPauseSpec(view) {
  const reasons = [...view.session.pauseReasons];
  let subtitle = 'Nothing is scored while paused.';
  if (reasons.includes('input')) subtitle = 'Controller lost. Pick it back up.';
  else if (reasons.includes('xr-visibility')) subtitle = 'Headset view was interrupted.';
  else if (reasons.includes('xr-exit')) subtitle = 'You left VR. Progress is saved.';
  else if (reasons.includes('menu')) subtitle = 'Help is open.';
  return {
    chip: 'Paused',
    icon: 'pause',
    iconColor: '#4a9be0',
    accent: '#4a9be0',
    title: 'Paused',
    subtitle: view.needsTrackingForResume ? 'Waiting for your controller…' : subtitle,
    feedback: view.feedback,
    buttons: [[
      { id: 'help', label: 'Help & settings' },
      { id: 'resume', label: 'Resume', variant: 'primary', enabled: !view.needsTrackingForResume },
    ]],
  };
}

function buildVideoSpec(view) {
  return {
    video: true,
    accent: '#4a9be0',
    buttons: [[
      { id: 'video:replay', label: 'Replay' },
      { id: 'video:skip', label: view.video.ended ? 'Continue' : 'Skip', variant: 'primary' },
    ]],
    buttonHeight: 64,
  };
}

// ---------------------------------------------------------- Station 2

function dockStep(key, state, vr) {
  const def = SCENARIO.packages[key];
  const { min, max } = weightRange(SCENARIO.packages.B);
  const T = (icon, title, subtitle, hints = []) => ({ icon, title, subtitle, hints: vr ? hints : [] });
  switch (state) {
    case 'waiting': return T('eye', `Pick up ${def.label}`, vr ? 'Look for any damage.' : 'Select Bring to me.', [HINT.grab, HINT.turn]);
    case 'inspecting': return T('eye', 'Damaged or intact?', vr ? 'Turn it. Check every side.' : 'Rotate it. Check every side.', [HINT.turn]);
    case 'condition_submitted': return T('decide', 'Accept or reject?', 'Damaged → reject. Intact → accept.');
    case 'rejected': return T('bin', 'Quarantine it', vr ? 'Drop it in the red tote.' : 'Select Quarantine.', [HINT.grab, HINT.release]);
    case 'accepted': return T('scan', 'Scan the label', vr ? 'Label in the green zone, then pull TRIGGER.' : 'Select Scan.', [{ key: 'LABEL', text: 'in green zone' }, HINT.scan]);
    case 'scanned': return T('scale', 'Weigh it', vr ? 'Set it on the scale.' : 'Select Scale.', [HINT.release]);
    case 'weighed': return T('scale', 'Check the weight', `Is it ${min.toFixed(2)}–${max.toFixed(2)} kg?`);
    case 'weight_confirmed': return T('ship', 'Send it out', vr ? 'Set it on the conveyor.' : 'Select Outbound.', [HINT.release]);
    case 'staged': return T('ship', 'Ship it', vr ? 'Press the green button.' : 'Select Confirm release.');
    default: return T('eye', def.label, '');
  }
}

function buildDockSpec(view) {
  const { engine } = view;
  const key = engine.activePackage();
  const def = SCENARIO.packages[key];
  const st = engine.packageState(key);
  const steps = STEPS[def.condition];
  const stepIdx = steps.indexOf(STATE_STEP[st]) + 1;
  const step = dockStep(key, st, view.vr);

  const decision = [];
  if (st === 'waiting' || st === 'inspecting') {
    decision.push({ id: 'condition:damaged', label: 'Damaged', enabled: st === 'inspecting', variant: 'primary' });
    decision.push({ id: 'condition:intact', label: 'Intact', enabled: st === 'inspecting', variant: 'primary' });
  } else if (st === 'condition_submitted') {
    decision.push({ id: 'decide:accept', label: 'Accept', variant: 'primary' });
    decision.push({ id: 'decide:reject', label: 'Reject', variant: 'primary' });
  } else if (st === 'weighed') {
    decision.push({ id: 'weight:within', label: 'In range', variant: 'primary' });
    decision.push({ id: 'weight:outside', label: 'Out of range', variant: 'primary' });
  }
  const heldHere = view.held === key;
  if (view.onFloor.includes(key)) decision.unshift({ id: 'retrieve', label: 'Retrieve package', variant: 'primary' });
  const manip = [
    heldHere ? { id: 'assist:return', label: 'Return to bench' } : { id: 'assist:bring', label: 'Bring to me' },
    { id: 'assist:rotate', label: 'Rotate', enabled: heldHere && view.heldBy === 'assist' },
    { id: 'assist:flip', label: 'Flip', enabled: heldHere && view.heldBy === 'assist' },
  ];
  // All destinations are always offered, so assistance never reveals the answer.
  const place = [
    { id: 'place:quarantine', label: 'Quarantine' },
    { id: 'scan', label: 'Scan' },
    { id: 'place:scale', label: 'Scale' },
    { id: 'place:outbound', label: 'Outbound' },
  ];
  const footer = [{ id: 'help', label: 'Help' }];
  if (def.condition === 'intact' && engine.stateAtLeast(key, 'accepted')) footer.push({ id: 'release', label: 'Confirm release' });
  return {
    chip: `Station 2 · ${def.label}`,
    stepId: `dock:${key}:${STATE_STEP[st]}`,
    stepLabel: `${stepIdx} / ${steps.length}`,
    progress: { i: stepIdx, n: steps.length },
    ...step,
    feedback: view.feedback,
    buttons: withAssist(view, decision, [manip, place], footer),
    buttonHeight: view.vr && !view.assistOpen ? 74 : 60,
  };
}

// ---------------------------------------------------------- Station 1

const PACK_STEPS = ['open', 'scan', 'exception', 'carton', 'pack', 'dunnage', 'seal', 'weigh', 'print', 'label', 'outbound', 'release'];

function packStep(step, vr, e) {
  const S = e.scenario;
  const { min, max } = packWeightRange(S);
  const extra = S.itemOrder.find((k) => !S.items[k].onOrder);
  const extraKnown = extra && e.items[extra].scanned;
  const T = (icon, title, subtitle, hints = []) => ({ icon, title, subtitle, hints: vr ? hints : [] });
  switch (step) {
    case 'open': return T('scan', 'Open the order', vr ? 'Scan the tote label.' : 'Select Scan tote.', [{ key: 'GRIP', text: 'yellow scanner' }, HINT.scan]);
    case 'scan': return T('scan', 'Scan each item', 'Check them on the order monitor (left).', [HINT.scan]);
    case 'exception': return T('bin', 'Remove the extra item', extraKnown
      ? `The ${S.items[extra].name.toLowerCase()} isn't ordered → yellow bin.`
      : 'One item isn’t ordered → yellow bin.', [HINT.grab, HINT.release]);
    case 'carton': return T('box', 'Pick the carton', 'Use the size on the order monitor.', [HINT.grab]);
    case 'pack': return T('box', 'Pack the items', vr ? 'Drop each order item in.' : 'Pick an item, then Pack.', [HINT.grab, HINT.release]);
    case 'dunnage': return T('fill', 'Protect it', 'Fragile: add air pillows.', [HINT.grab, HINT.release]);
    case 'seal': return T('tape', 'Tape it shut', vr ? 'Drag the tape gun along the top.' : 'Select Seal.', [{ key: 'GRIP', text: 'tape gun' }, HINT.holdDrag]);
    case 'weigh': return T('scale', 'Check the weight', `Is it ${min.toFixed(2)}–${max.toFixed(2)} kg?`);
    case 'print': return T('label', 'Print the label', vr ? 'Point at the printer.' : 'Select Print label.', [{ key: 'TRIGGER', text: 'print' }]);
    case 'label': return T('label', 'Label the carton', vr ? 'Stick it on top.' : 'Select Apply label.', [HINT.grab, HINT.release]);
    case 'outbound': return T('ship', 'Send it out', vr ? 'Set it on the conveyor.' : 'Select To outbound.', [HINT.grab, HINT.release]);
    case 'release': return T('ship', 'Ship it', vr ? 'Press the green button.' : 'Select Confirm release.');
    default: return T('box', 'Pack-Out', '');
  }
}

export function buildPackSpec(view) {
  const e = view.session.pack;
  const st = view.packStation;
  const step = e.step();
  const idx = PACK_STEPS.indexOf(step) + 1;
  const S = e.scenario;
  const decision = [];
  if (st.floorItems().length) decision.push({ id: 'pk:retrieve', label: 'Retrieve items', variant: 'primary' });
  if (e.sealed && !e.weightConfirmed) {
    decision.push({ id: 'pk:weight:within', label: 'In range', variant: 'primary' });
    decision.push({ id: 'pk:weight:outside', label: 'Out of range', variant: 'primary' });
  }
  if (e.weightConfirmed && !e.labelPrinted) decision.push({ id: 'pk:print', label: 'Print label', variant: 'primary' });

  const assist = [];
  if (!e.carton) assist.push(S.cartonOrder.map((k) => ({ id: `pk:carton:${k}`, label: `Carton ${k}` })));
  const selectable = st.selectableItems();
  if (!e.sealed && selectable.length) {
    assist.push([
      { id: 'pk:select', label: `${S.items[st.selected].name} ▸` },
      { id: 'pk:scan:item', label: 'Scan' },
      { id: 'pk:pack', label: 'Pack' },
      { id: 'pk:divert', label: 'To bin' },
    ]);
  }
  const tools = [];
  if (!e.orderOpen) tools.push({ id: 'pk:scan:tote', label: 'Scan tote' });
  if (e.carton && !e.sealed) {
    tools.push({ id: 'pk:dunnage', label: 'Add fill' });
    tools.push({ id: 'pk:seal', label: 'Seal' });
  }
  if (e.sealed && !e.weightConfirmed) tools.push({ id: 'pk:print', label: 'Print label' });
  if (e.labelPrinted && !e.labelApplied) tools.push({ id: 'pk:apply', label: 'Apply label' });
  if (e.labelApplied && !e.staged) tools.push({ id: 'pk:outbound', label: 'To outbound' });
  assist.push(...chunk(tools, 4));
  const footer = [{ id: 'help', label: 'Help' }];
  if (e.carton) footer.push({ id: 'release', label: 'Confirm release' });
  return {
    chip: `Station 1 · ${S.order.id}`,
    stepId: `pack:${step}`,
    stepLabel: `${idx} / ${PACK_STEPS.length}`,
    progress: { i: idx, n: PACK_STEPS.length },
    ...packStep(step, view.vr, e),
    feedback: view.feedback,
    buttons: withAssist(view, decision, assist, footer),
    buttonHeight: view.vr && !view.assistOpen ? 74 : 58,
  };
}

function buildPackDoneSpec(view) {
  const r = view.session.pack.results();
  const ok = r.status === 'proficient';
  return {
    chip: 'Station 1 complete',
    icon: 'star',
    iconColor: ok ? '#2fae66' : '#e0b12b',
    accent: ok ? '#2fae66' : '#e0b12b',
    title: `${r.score} / ${r.maxScore}`,
    titleSize: 72,
    subtitle: ok ? 'Order packed right. Next: the dock.' : `Practice recommended${r.criticalErrors.length ? ` · ${r.criticalErrors.length} critical` : ''}.`,
    feedback: view.feedback,
    buttons: [[
      { id: 'station:replay-pack', label: 'Replay (new order)' },
      { id: 'station:dock', label: 'Next station', variant: 'primary' },
    ]],
  };
}

export function buildSessionResultsSpec(view) {
  const r = view.session.results();
  const page = view.resultsPage;
  const mark = (c) => (c.status === 'passed' ? 'PASS' : c.corrected ? 'MISS, fixed' : 'MISS');
  const station = r.stations.find((s) => s.key === page);
  const ok = r.status === 'proficient';
  const nav = [
    page !== 'summary' ? { id: 'results:summary', label: 'Summary' } : null,
    page !== 'pack' ? { id: 'results:pack', label: 'Station 1' } : null,
    page !== 'dock' ? { id: 'results:dock', label: 'Station 2' } : null,
  ].filter(Boolean);
  const buttons = [nav, [{ id: 'help', label: 'Help' }, { id: 'replay', label: 'Replay', variant: 'primary' }]];
  if (station) {
    return {
      chip: `Station ${station.number} · ${station.name}`,
      stepLabel: `${station.results.score} / ${station.results.maxScore}`,
      bodySize: 24,
      body: station.results.checkpoints.map((c) => ({
        text: `${mark(c)} · ${c.label}`,
        size: 24, color: c.status === 'passed' ? '#cfd8e1' : '#ffd29b',
      })),
      buttons,
      buttonHeight: 60,
    };
  }
  return {
    chip: 'Results',
    icon: 'star',
    iconColor: ok ? '#2fae66' : '#e0b12b',
    accent: ok ? '#2fae66' : '#e0b12b',
    title: `${r.score} / ${r.maxScore}`,
    titleSize: 72,
    subtitle: r.statusLabel,
    cards: r.stations.map((s) => ({
      icon: s.key === 'pack' ? 'box' : 'eye',
      title: s.skipped ? 'Skipped' : `${s.results.score} / ${s.results.maxScore}`,
      text: `Station ${s.number}${s.results.criticalErrors.length ? ` · ${s.results.criticalErrors.length} critical` : ''}`,
    })).concat([{ icon: 'scale', title: fmtTime(r.elapsedMs), text: 'Time (not scored)' }]),
    buttons,
    buttonHeight: 60,
  };
}

export function buildHelpSpec(view) {
  const { settings, vr } = view;
  const controls = vr
    ? ['GRIP: grab and let go (either hand)', 'TRIGGER: buttons, scanner, tape gun', 'STICK: turn what you hold', 'B / Y: this menu']
    : ['Click buttons or use Tab + Enter', 'Drag to look around; arrows rotate', 'H: this menu'];
  const atPack = view.session.stationKey === 'pack';
  const rules = atPack ? view.session.pack.scenario.rules.slice(0, 3) : SCENARIO.rules.slice(1, 3);
  return {
    chip: 'Help · paused',
    title: 'Controls & settings',
    titleSize: 46,
    bodySize: 25,
    body: [
      ...controls.map((c) => ({ text: c, bullet: true, size: 25 })),
      { gap: 4 },
      ...rules.map((c) => ({ text: c, bullet: true, size: 23, color: '#aab7c4' })),
    ],
    buttons: [
      ...comfortRows(view),
      [
        { id: 'toggle:sound', label: `Sounds ${settings.muted ? 'off' : 'on'}`, active: !settings.muted },
        { id: 'toggle:ambience', label: `Ambience ${settings.ambience ? 'on' : 'off'}`, active: !!settings.ambience },
        { id: 'toggle:music', label: `Music ${settings.music ? 'on' : 'off'}`, active: !!settings.music },
        { id: 'toggle:motion', label: `Calm motion ${settings.reducedMotion ? 'on' : 'off'}`, active: settings.reducedMotion },
      ],
      [
        { id: 'restart', label: 'Restart', variant: 'danger' },
        ...(view.xrActive ? [{ id: 'exitvr', label: 'Exit VR' }] : []),
        { id: 'resume', label: 'Close', variant: 'primary', enabled: !view.needsTrackingForResume },
      ],
    ],
    buttonHeight: 60,
  };
}
