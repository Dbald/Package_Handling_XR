// Scenario configuration: rules, text, fixture values and scoring.
// Kept separate from scene assets and from the procedure engine (PRD §9).
// All rules here are SYNTHETIC DEMO RULES — a customer SME must approve
// replacements before operational training use (PRD §4).

// Packages arrive one at a time on the inbound conveyor, in `order`.
const PACKAGES = {
  A: {
    key: 'A',
    id: 'PKG-A-1042',
    label: 'Package A',
    condition: 'damaged',
    damage: 'corner',
    evidence: 'Crushed and torn top corner',
    from: 'Northwind Supply',
  },
  B: {
    key: 'B',
    id: 'PKG-B-2087',
    label: 'Package B',
    condition: 'intact',
    barcode: 'DG2087-4415',
    from: 'Atlas Books',
    contents: ['Hardcover book × 4'],
    expectedWeightKg: 5.0,
    toleranceKg: 0.2,
    measuredWeightKg: 4.96,
  },
  C: {
    key: 'C',
    id: 'PKG-C-3315',
    label: 'Package C',
    condition: 'intact',
    barcode: 'DG3315-7702',
    from: 'Brightline Home',
    contents: ['Desk lamp × 1', 'USB-C cable × 2'],
    fragile: true,
    expectedWeightKg: 2.4,
    toleranceKg: 0.15,
    measuredWeightKg: 2.43,
  },
  D: {
    key: 'D',
    id: 'PKG-D-4471',
    label: 'Package D',
    condition: 'damaged',
    damage: 'side',
    evidence: 'Punctured and torn on the back side',
    from: 'Coastal Parts Co.',
  },
};
const ORDER = ['A', 'B', 'C', 'D'];

// Checkpoints per package (PRD §8): damaged packages are scored on condition,
// rejection and quarantine; intact ones on the full receive-and-ship flow.
// A station's score is the share of checkpoint points earned (0–100).
function packageCheckpoints(def) {
  const k = def.key;
  const L = def.label;
  if (def.condition === 'damaged') {
    return [
      { id: `${k}_CONDITION`, pkg: k, points: 10, label: `${L}: spot the damage` },
      { id: `${k}_REJECT`, pkg: k, points: 10, label: `${L}: reject it` },
      { id: `${k}_QUARANTINE`, pkg: k, points: 10, label: `${L}: quarantine it` },
    ];
  }
  return [
    { id: `${k}_CONDITION`, pkg: k, points: 10, label: `${L}: identify it as intact` },
    { id: `${k}_ACCEPT`, pkg: k, points: 10, label: `${L}: accept it` },
    { id: `${k}_SCAN_FIRST`, pkg: k, points: 10, label: `${L}: scan before weighing` },
    { id: `${k}_WEIGH_AFTER_SCAN`, pkg: k, points: 10, label: `${L}: weigh after the scan` },
    { id: `${k}_WEIGHT_CONFIRM`, pkg: k, points: 10, label: `${L}: confirm the weight is in range` },
    { id: `${k}_OUTBOUND`, pkg: k, points: 10, label: `${L}: route outbound after every check` },
    { id: `${k}_NO_PREMATURE`, pkg: k, points: 10, label: `${L}: no early release` },
  ];
}

export const SCENARIO = Object.freeze({
  id: 'dg-package-handling-demo',
  version: '1.2.0',
  title: 'Package Handling Lab',
  org: 'Devinci Global',

  order: ORDER,
  packages: PACKAGES,
  checkpoints: ORDER.flatMap((k) => packageCheckpoints(PACKAGES[k])),

  criticalErrors: {
    ACCEPTED_DAMAGED: 'Accepted a visibly damaged package',
    DAMAGED_OUTBOUND: 'Attempted to send a damaged package outbound',
    PREMATURE_RELEASE: 'Attempted outbound release before scan and weight confirmation',
  },

  // Demo setting pending instructional validation (PRD §8).
  proficiency: { minScore: 80, maxCriticalErrors: 0 },

  rules: [
    'Inspect every package before deciding: turn it and check every side.',
    'Visible damage (crushed, torn, punctured): REJECT and place in QUARANTINE. Never send outbound.',
    'No visible damage: ACCEPT, then SCAN the label, WEIGH on the scale, CONFIRM the weight is in range, then route OUTBOUND.',
    'The receiving monitor shows each package’s contents and expected weight once it is scanned (scenario values, not a universal policy).',
    'Release outbound only after scan and weight confirmation.',
  ],

  controls: {
    vr: [
      'Grip: grab / release a package (either hand).',
      'Grip while pointing at a far package: assisted grab brings it to your hand.',
      'Trigger: select buttons with the ray; scan while holding the barcode in the scan zone.',
      'Thumbstick left/right while holding: rotate the package.',
      'B / Y button: open help and pause.',
    ],
    desktop: [
      'Click buttons in the side panel or on the 3D panel. Tab / Enter work too.',
      'Click a package to bring it into view; arrow keys rotate it.',
      'Drag with the mouse to look around. H opens help.',
    ],
  },
});

export function checkpointById(id) {
  return SCENARIO.checkpoints.find((c) => c.id === id);
}

export function weightRange(pkg = SCENARIO.packages.B) {
  return {
    min: +(pkg.expectedWeightKg - pkg.toleranceKg).toFixed(2),
    max: +(pkg.expectedWeightKg + pkg.toleranceKg).toFixed(2),
  };
}

export function weightWithinRange(pkg = SCENARIO.packages.B) {
  const { min, max } = weightRange(pkg);
  return pkg.measuredWeightKg >= min && pkg.measuredWeightKg <= max;
}

export const MAX_SCORE = 100;
