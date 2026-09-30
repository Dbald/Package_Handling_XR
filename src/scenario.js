// Scenario configuration: rules, text, fixture values and scoring.
// Kept separate from scene assets and from the procedure engine (PRD §9).
// All rules here are SYNTHETIC DEMO RULES — a customer SME must approve
// replacements before operational training use (PRD §4).

export const SCENARIO = Object.freeze({
  id: 'dg-package-handling-demo',
  version: '1.1.0',
  title: 'Package Handling Lab',
  org: 'Devinci Global',

  // Packages are processed in this order during the guided exercise.
  order: ['A', 'B'],

  packages: {
    A: {
      key: 'A',
      id: 'PKG-A-1042',
      label: 'Package A',
      condition: 'damaged',
      evidence: 'Crushed and torn top corner',
    },
    B: {
      key: 'B',
      id: 'PKG-B-2087',
      label: 'Package B',
      condition: 'intact',
      barcode: 'DG2087-4415',
      expectedWeightKg: 5.0,
      toleranceKg: 0.2,
      measuredWeightKg: 4.96,
    },
  },

  // Ten checkpoints × 10 points (PRD §8).
  checkpoints: [
    { id: 'A_CONDITION', pkg: 'A', points: 10, label: "Identify Package A's damaged condition" },
    { id: 'A_REJECT', pkg: 'A', points: 10, label: 'Reject Package A' },
    { id: 'A_QUARANTINE', pkg: 'A', points: 10, label: 'Select quarantine for Package A' },
    { id: 'B_CONDITION', pkg: 'B', points: 10, label: "Identify Package B's intact condition" },
    { id: 'B_ACCEPT', pkg: 'B', points: 10, label: 'Accept Package B' },
    { id: 'B_SCAN_FIRST', pkg: 'B', points: 10, label: 'Scan Package B before weighing' },
    { id: 'B_WEIGH_AFTER_SCAN', pkg: 'B', points: 10, label: 'Weigh Package B after scan success' },
    { id: 'B_WEIGHT_CONFIRM', pkg: 'B', points: 10, label: 'Confirm the weight is within the displayed range' },
    { id: 'B_OUTBOUND', pkg: 'B', points: 10, label: 'Choose outbound after all prerequisites' },
    { id: 'B_NO_PREMATURE', pkg: 'B', points: 10, label: 'No premature outbound release attempt' },
  ],

  criticalErrors: {
    ACCEPTED_DAMAGED: 'Accepted a visibly damaged package',
    DAMAGED_OUTBOUND: 'Attempted to send a damaged package outbound',
    PREMATURE_RELEASE: 'Attempted outbound release before scan and weight confirmation',
  },

  // Demo setting pending instructional validation (PRD §8).
  proficiency: { minScore: 80, maxCriticalErrors: 0 },

  rules: [
    'Inspect every package before deciding.',
    'Visible damage (crushed, torn, punctured): REJECT and place in QUARANTINE. Never send outbound.',
    'No visible damage: ACCEPT, then SCAN the barcode, WEIGH on the scale, CONFIRM the weight is in range, then route OUTBOUND.',
    'Package B expected weight: 5.0 kg ± 0.2 kg (scenario value, not a universal policy).',
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

export const MAX_SCORE = SCENARIO.checkpoints.reduce((s, c) => s + c.points, 0);
