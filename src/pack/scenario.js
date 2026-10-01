// Station 1 — Pack-Out. Orders, items, cartons, weights, rules and scoring.
// SYNTHETIC DEMO RULES: a customer SME must approve replacements before
// operational use. Swapping this file is how a client pilot adapts the station.

// Item catalogue (size in metres: x, y, z as the item lies in the tote).
const CATALOG = {
  mug: { key: 'mug', sku: 'MUG-0412', name: 'Ceramic mug', fragile: true, weightKg: 0.46, dims: '12 × 12 × 12 cm', size: [0.12, 0.12, 0.12], barcodeFace: 'pz' },
  book: { key: 'book', sku: 'BK-7730', name: 'Hardcover book', fragile: false, weightKg: 0.92, dims: '23 × 16 × 4 cm', size: [0.23, 0.04, 0.16], barcodeFace: 'py' },
  case: { key: 'case', sku: 'CS-1180', name: 'Phone case', fragile: false, weightKg: 0.08, dims: '18 × 10 × 2 cm', size: [0.1, 0.025, 0.18], barcodeFace: 'py' },
  charger: { key: 'charger', sku: 'CH-2045', name: 'Wall charger', fragile: false, weightKg: 0.18, dims: '10 × 7 × 6 cm', size: [0.1, 0.06, 0.07], barcodeFace: 'pz' },
  cable: { key: 'cable', sku: 'CB-3310', name: 'USB-C cable', fragile: false, weightKg: 0.06, dims: '12 × 8 × 2 cm', size: [0.12, 0.02, 0.08], barcodeFace: 'py' },
  lamp: { key: 'lamp', sku: 'LMP-5520', name: 'Desk lamp', fragile: true, weightKg: 1.6, dims: '34 × 13 × 13 cm', size: [0.34, 0.13, 0.13], barcodeFace: 'pz' },
};

const CARTONS = {
  S: { key: 'S', inner: '20 × 15 × 10 cm', size: [0.22, 0.12, 0.17], weightKg: 0.2 },
  M: { key: 'M', inner: '30 × 22 × 16 cm', size: [0.32, 0.18, 0.24], weightKg: 0.32 },
  L: { key: 'L', inner: '45 × 35 × 30 cm', size: [0.46, 0.3, 0.36], weightKg: 0.55 },
};
const CARTON_ORDER = ['S', 'M', 'L'];

// Orders: which items, the extra (mis-picked) item, the system-recommended
// carton, and where each item sits in the tote and in the packed carton
// (x, y, z offsets; `rot` = yaw, `stand` = book stood on its spine).
const ORDERS = [
  {
    id: 'ORD-58213', tote: 'TOTE-0417', items: ['mug', 'book'], extra: 'case', carton: 'M',
    tote_slots: { mug: [-0.1, 0.08, -0.04], book: [0.07, 0.04, 0.04], case: [0.07, 0.0565, 0.02, 0.25] },
    carton_slots: { mug: [-0.07, 0.066, 0.03], book: [0.12, 0.086, 0, 'stand'] },
  },
  {
    id: 'ORD-58257', tote: 'TOTE-0422', items: ['charger', 'cable'], extra: 'book', carton: 'S',
    tote_slots: { charger: [-0.11, 0.05, -0.05], cable: [0.08, 0.03, 0.07], book: [0.06, 0.04, -0.06] },
    carton_slots: { charger: [-0.05, 0.036, 0], cable: [0.05, 0.016, 0, Math.PI / 2] },
  },
  {
    id: 'ORD-58301', tote: 'TOTE-0430', items: ['lamp', 'cable'], extra: 'charger', carton: 'L',
    tote_slots: { lamp: [0, 0.085, -0.06], cable: [-0.08, 0.03, 0.08], charger: [0.09, 0.05, 0.08] },
    carton_slots: { lamp: [0, 0.071, -0.08], cable: [-0.1, 0.016, 0.1] },
  },
];

const BASE = {
  version: '1.1.0',
  station: 'Station 1',
  title: 'Pack-Out',
  cartons: CARTONS,
  cartonOrder: CARTON_ORDER,
  dunnageKg: 0.01,
  maxDunnage: 6,
  toleranceKg: 0.1,
  checkpoints: [
    { id: 'PK_ORDER_FIRST', points: 10, label: 'Open the order (scan the tote) before handling items' },
    { id: 'PK_SCAN_ITEMS', points: 10, label: 'Scan every order item before packing it' },
    { id: 'PK_EXCEPTION', points: 10, label: 'Divert the item not on the order to the exception bin' },
    { id: 'PK_CARTON', points: 10, label: 'Use the carton size the order monitor recommends' },
    { id: 'PK_DUNNAGE', points: 10, label: 'Protect fragile items with void fill before sealing' },
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
    'Scan the tote label first. It opens the order on the ORDER MONITOR (left).',
    'Scan every item and compare it with the monitor. Anything NOT ON ORDER goes to the EXCEPTION bin.',
    'Use the carton size the monitor recommends: the smallest that fits everything.',
    'Fragile items need void fill (air pillows) before the carton is sealed.',
    'Seal with the tape gun, confirm the weight is in range, then print and apply the label.',
    'Release outbound only when the carton is sealed, weighed and labelled.',
  ],
};

export const PACK_ORDER_COUNT = ORDERS.length;
export const PACK_CATALOG = CATALOG;

/** Full scenario for order `index` (wraps around). */
export function packScenario(index = 0) {
  const o = ORDERS[((index % ORDERS.length) + ORDERS.length) % ORDERS.length];
  const itemOrder = [...o.items, o.extra];
  const items = {};
  for (const k of itemOrder) items[k] = { ...CATALOG[k], onOrder: k !== o.extra };
  const largest = o.items.map((k) => CATALOG[k]).sort((a, b) => Math.max(...b.size) - Math.max(...a.size))[0];
  const correctIdx = CARTON_ORDER.indexOf(o.carton);
  const cartons = {};
  CARTON_ORDER.forEach((k, i) => {
    let why;
    if (i < correctIdx) why = `Too small: the ${largest.name.toLowerCase()} (${largest.dims}) does not fit in a size ${k} carton (${CARTONS[k].inner} inside).`;
    if (i > correctIdx) why = 'Too large: oversized cartons are billed by dimensional weight and need far more void fill. Use the size the monitor recommends.';
    cartons[k] = { ...CARTONS[k], why };
  });
  const expected = o.items.reduce((a, k) => a + CATALOG[k].weightKg, 0) + CARTONS[o.carton].weightKg + 2 * BASE.dunnageKg;
  return Object.freeze({
    ...BASE,
    id: `dg-pack-out/${o.id}`,
    variant: index,
    order: { id: o.id, tote: o.tote, service: 'Standard Ground' },
    items,
    itemOrder,
    cartons,
    correctCarton: o.carton,
    expectedWeightKg: +expected.toFixed(2),
    toteSlots: o.tote_slots,
    cartonSlots: o.carton_slots,
  });
}

export const PACK_SCENARIO = packScenario(0);

export function packWeightRange(s = PACK_SCENARIO) {
  return {
    min: +(s.expectedWeightKg - s.toleranceKg).toFixed(2),
    max: +(s.expectedWeightKg + s.toleranceKg).toFixed(2),
  };
}
