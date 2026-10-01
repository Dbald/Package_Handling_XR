// Station 1 — Pack-Out. Order, items, cartons, weights, rules and scoring.
// SYNTHETIC DEMO RULES: a customer SME must approve replacements before
// operational use. Swapping this file is how a client pilot adapts the station.

const items = {
  mug: {
    key: 'mug', sku: 'MUG-0412', name: 'Ceramic mug', onOrder: true, fragile: true,
    weightKg: 0.46, dims: '12 × 12 × 12 cm', size: [0.12, 0.12, 0.12],
  },
  book: {
    key: 'book', sku: 'BK-7730', name: 'Hardcover book', onOrder: true, fragile: false,
    weightKg: 0.92, dims: '23 × 16 × 4 cm', size: [0.23, 0.04, 0.16],
  },
  case: {
    key: 'case', sku: 'CS-1180', name: 'Phone case', onOrder: false, fragile: false,
    weightKg: 0.08, dims: '18 × 10 × 2 cm', size: [0.1, 0.025, 0.18],
  },
};

const cartons = {
  S: {
    key: 'S', inner: '20 × 15 × 10 cm', size: [0.22, 0.12, 0.17], weightKg: 0.2,
    why: 'Too small: the book is 23 cm long and an S carton is only 20 cm inside.',
  },
  M: { key: 'M', inner: '30 × 22 × 16 cm', size: [0.32, 0.18, 0.24], weightKg: 0.32 },
  L: {
    key: 'L', inner: '45 × 35 × 30 cm', size: [0.46, 0.3, 0.36], weightKg: 0.55,
    why: 'Too large: oversized cartons are billed by dimensional weight and need far more void fill. Use the smallest carton that fits.',
  },
};

export const PACK_SCENARIO = Object.freeze({
  id: 'dg-pack-out-demo',
  version: '1.0.0',
  station: 'Station 1',
  title: 'Pack-Out',
  order: { id: 'ORD-58213', tote: 'TOTE-0417', service: 'Standard Ground' },
  items,
  itemOrder: ['mug', 'book', 'case'],
  cartons,
  cartonOrder: ['S', 'M', 'L'],
  correctCarton: 'M',
  dunnageKg: 0.01,
  maxDunnage: 6,
  expectedWeightKg: 1.72,
  toleranceKg: 0.1,

  checkpoints: [
    { id: 'PK_ORDER_FIRST', points: 10, label: 'Open the order (scan the tote) before handling items' },
    { id: 'PK_SCAN_ITEMS', points: 10, label: 'Scan every order item before packing it' },
    { id: 'PK_EXCEPTION', points: 10, label: 'Divert the item not on the order to the exception bin' },
    { id: 'PK_CARTON', points: 10, label: 'Choose the right carton size' },
    { id: 'PK_DUNNAGE', points: 10, label: 'Protect the fragile item with void fill before sealing' },
    { id: 'PK_SEAL', points: 10, label: 'Seal only after every order item is packed' },
    { id: 'PK_WEIGHT', points: 10, label: 'Confirm the packed weight is within range' },
    { id: 'PK_LABEL_ORDER', points: 10, label: 'Print the label only after the weight is confirmed' },
    { id: 'PK_LABEL', points: 10, label: 'Label the carton before releasing it' },
    { id: 'PK_RELEASE', points: 10, label: 'No premature outbound release' },
  ],

  criticalErrors: {
    WRONG_ITEM_PACKED: 'Attempted to pack an item that is not on the order',
    UNLABELED_RELEASE: 'Attempted to release a carton before it was sealed, weighed and labelled',
  },

  proficiency: { minScore: 80, maxCriticalErrors: 0 },

  rules: [
    'Scan the tote label first. It opens the order on the monitor.',
    'Scan every item before it goes in the carton. Anything NOT ON ORDER goes to the EXCEPTION bin.',
    'Use the smallest carton that fits everything.',
    'Fragile items need void fill (air pillows) before the carton is sealed.',
    'Seal, then confirm the weight is in range, then print and apply the label.',
    'Release outbound only when the carton is sealed, weighed and labelled.',
  ],
});

export function packWeightRange(s = PACK_SCENARIO) {
  return {
    min: +(s.expectedWeightKg - s.toleranceKg).toFixed(2),
    max: +(s.expectedWeightKg + s.toleranceKg).toFixed(2),
  };
}
