// Short, scannable UI copy. Engines keep their full explanatory messages (for
// the log, the desktop panel's "More" and screen readers); the headset shows
// a one-glance version: a 1–3 word headline and one short line.

const B = (title, text) => ({ title, text });

const PACK = {
  ORDER_NOT_OPEN: B('Open the order first', 'Scan the tote label.'),
  ORDER_OPEN: B('Order open', 'Now scan each item.'),
  ITEM_OK: B('On the order', 'Scan the next item.'),
  NOT_ON_ORDER: B('Not on this order', 'Put it in the yellow bin.'),
  CARTON_OK: B('Carton ready', 'Pack the order items.'),
  CARTON_WRONG: null, // dynamic: too small / too large
  NO_CARTON: B('No carton yet', 'Set a carton on the scale first.'),
  WRONG_ITEM: B('Wrong item!', 'Not on the order. Yellow bin.'),
  SCAN_FIRST: B('Scan it first', 'Every item gets scanned.'),
  PACKED: B('Packed', 'Next item.'),
  ON_ORDER: B('That one ships', 'It belongs in the carton.'),
  DIVERTED: B('Set aside', 'A lead will sort it out.'),
  DUNNAGE: B('Fill added', 'Add more or tape it shut.'),
  FULL: B('Carton is full', 'Tape it shut.'),
  MISSING_ITEMS: B('Not done packing', 'An order item is missing.'),
  TOTE_NOT_CLEAR: B('Tote not clear', 'Extra item → yellow bin.'),
  NEEDS_DUNNAGE: B('Protect it first', 'Fragile: add air pillows.'),
  SEALED: B('Sealed', 'Check the weight.'),
  WEIGHT_OK: B('Weight OK', 'Print the label.'),
  WEIGHT_WRONG: B('Look again', 'Compare the scale to the range.'),
  PRINT_EARLY: B('Not yet', 'Confirm the weight first.'),
  PRINTED: B('Label printed', 'Stick it on top.'),
  LABELLED: B('Labelled', 'Put it on the conveyor.'),
  STAGED: B('On the conveyor', 'Confirm release.'),
  PREMATURE_RELEASE: B('Not ready to ship!', 'Seal, weigh and label first.'),
  RELEASED: B('Shipped!', 'Station 1 complete.'),
  NO_READ: B('No read', 'Aim the beam at a barcode.'),
  TAPE_NO_CARTON: B('No carton yet', 'Build one on the scale first.'),
  TAPE_FAR: B('Get closer', 'Start at one end of the top seam.'),
};

const DOCK = {
  INSPECTING: B('Inspecting', 'Check every side.'),
  CONDITION_OK: B('Correct', 'Now accept or reject.'),
  CONDITION_WRONG: B('Look again', 'Check every side.'),
  DECISION_OK: null, // dynamic: rejected vs accepted
  ACCEPTED_DAMAGED: B('Never accept damage!', 'Damaged → reject.'),
  REJECTED_INTACT: B('It’s intact', 'Good packages get accepted.'),
  DAMAGED_OUTBOUND: B('Never ship damage!', 'Damaged → quarantine.'),
  QUARANTINED: B('Quarantined', 'Next package.'),
  NOT_APPLICABLE: B('Not for this one', 'Follow the task above.'),
  STAGED: B('On the conveyor', 'Confirm release.'),
  PREMATURE_RELEASE: B('Not ready to ship!', 'Scan and weigh first.'),
  WRONG_DESTINATION: B('Wrong place', 'Accepted packages ship out.'),
  SCAN_FIRST: B('Scan first', 'Then weigh it.'),
  WEIGHED: B('Weighed', 'Check the reading.'),
  NO_READ: B('No read', 'Face the label to the scanner.'),
  SCANNED: B('Scanned', 'Now weigh it.'),
  WEIGHT_OK: B('Weight OK', 'Send it out.'),
  WEIGHT_WRONG: B('Look again', 'Compare the scale to the range.'),
  RELEASED: B('Shipped!', 'Great work.'),
  NOT_ACTIVE: B('One at a time', 'Finish the current package.'),
  PACKAGE_DONE: B('Already done', 'Work on the next one.'),
};

const COMMON = {
  PAUSED: B('Paused', 'Select Resume.'),
  NOT_STARTED: B('Not started', 'Press Start on the screen.'),
  COMPLETE: B('Station done', 'Continue or replay.'),
  PREREQ: B('Not yet', null),
  ALREADY: B('Already done', null),
  STARTED: B('Go!', null),
};

const TONE_TITLES = { success: 'Nice', error: 'Not quite', critical: 'Stop', warning: 'Not yet', info: 'Tip', neutral: '' };

/** First sentence of a long message, trimmed to fit one short line. */
function firstLine(msg, max = 64) {
  if (!msg) return '';
  const s = msg.replace(/^Blocked\.\s*/, '').split(/(?<=[.!?])\s/)[0];
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Brief UI copy for an engine result (or an app hint without a code).
 * Returns { title, text } — never longer than a headline and one line.
 */
export function brief(station, r) {
  if (!r) return null;
  const table = station === 'pack' ? PACK : DOCK;
  let b = (r.code && (table[r.code] ?? COMMON[r.code])) || null;
  if (r.code === 'CARTON_WRONG') b = /small/i.test(r.message) ? B('Too small', 'Check the order monitor.') : B('Too big', 'Use the size on the monitor.');
  if (r.code === 'NO_READ' && /facing away/i.test(r.message)) b = B('No read', 'Turn the barcode toward the scanner.');
  if (r.code === 'NO_READ' && /SCAN ZONE/.test(r.message)) b = B('No read', 'Hold the label in the green zone.');
  if (r.code === 'DECISION_OK') b = /reject/i.test(r.message) ? B('Rejected', 'Into the quarantine tote.') : B('Accepted', 'Scan its label.');
  return {
    title: b?.title ?? TONE_TITLES[r.tone] ?? '',
    text: b?.text ?? firstLine(r.message),
  };
}
