export const PRICING = {
  foodPerGuest: 65.00,

  menuComposition: {
    'Buffet':       '1 salad, 2 mains, and 3 sides',
    'Family Style': '1 salad, 2 mains, and 3 sides',
    'Plated':       '2-course plated service: 1 starter and 1 main with 2 protein options and 1 vegetarian option',
  } as Record<string, string>,

  staffing: {
    waitstaffHourly: 40.00,
    captainHourly:   50.00,
    captainCount:    1,
    setupBreakdownHours: 4,
    guestsPerWaitstaff: {
      'Buffet':       25,
      'Family Style': 13,
      'Plated':       10,
    } as Record<string, number>,
  },

  addons: {
    appetizerPerPersonEach: 3.00,
    dessertPerGuest:        4.75,
    coffeeTeaPerGuest:      2.85,
  },

  bar: {
    'Soft Bar': {
      perGuest: 26.00,
      guestsPerBartender: 75,
      description: 'All essential sodas, ice, still & sparkling water, garnish fruit, straws, napkins, tubs for chilling & ice storage. Certified and insured lead bartender as event point of contact. General and liquor liability included. Client provides all beer, wine and alcohol for 2 signature cocktails.',
    },
    'Full Bar': {
      perGuest: 29.00,
      guestsPerBartender: 50,
      description: 'All essential sodas, ice, still & sparkling water, garnish fruit, straws, napkins, tubs for chilling & ice storage. Certified and insured lead bartender as event point of contact. General and liquor liability included. Client provides all beer, wine and alcohol.',
    },
  } as Record<string, { perGuest: number; guestsPerBartender: number; description: string }>,

  eventMinimum: 5000.00,
  salesTaxRate:   0.0925,
  serviceFeeRate: 0.10,
  chargeFeeRate:  0.035,
  depositRate:    0.25,
};

export const STYLES = ['Buffet', 'Family Style', 'Plated'] as const;
export type ServiceStyle = typeof STYLES[number];

export interface StaffingCalc {
  waitstaff: number;
  totalHours: number;
  captain: number;
  cost: number;
  hourlyCost: number;
}

export interface PackageCalc {
  food: number;
  staffing: StaffingCalc;
  apps: number;
  dessert: number;
  coffee: number;
  rawSubtotal: number;
  minimumApplied: boolean;
  subtotal: number;
  tax: number;
  service: number;
  charge: number;
  total: number;
  deposit: number;
}

export interface BarCalc {
  base: number;
  bartenders: number;
  subtotal: number;
  tax: number;
  service: number;
  charge: number;
  total: number;
}

// Optional per-event overrides. Omitting any keeps the standard default, so the
// public quote form (which passes none) is unaffected.
export interface PackageOverrides {
  foodPerGuest?: number;       // default $65
  serviceFeeRate?: number;     // default 0.10 (also 0.05, 0.15 in practice)
  includeCaptain?: boolean;    // default true
  setupBreakdownHours?: number; // default 4 (also 3 in practice)
  staffRatio?: number;         // default per-style; she overrides per event
  applyMinimum?: boolean;      // default true (form); admin estimate passes false
}

export function calcStaffing(
  guests: number, eventHours: number, style: string, ov: PackageOverrides = {}
): StaffingCalc {
  const s = PRICING.staffing;
  const ratio = ov.staffRatio ?? s.guestsPerWaitstaff[style];
  const waitstaff = Math.max(1, Math.floor(guests / ratio));
  const setupBreak = ov.setupBreakdownHours ?? s.setupBreakdownHours;
  const totalHours = eventHours + setupBreak;
  const captain = ov.includeCaptain === false ? 0 : s.captainCount;
  const hourlyCost = waitstaff * s.waitstaffHourly + captain * s.captainHourly;
  return { waitstaff, totalHours, captain, cost: hourlyCost * totalHours, hourlyCost };
}

export function calcPackage(
  guests: number,
  eventHours: number,
  style: string,
  opts: { appetizers: number; dessert: boolean; coffee: boolean } & PackageOverrides
): PackageCalc {
  const foodPerGuest = opts.foodPerGuest ?? PRICING.foodPerGuest;
  const serviceFeeRate = opts.serviceFeeRate ?? PRICING.serviceFeeRate;
  const applyMinimum = opts.applyMinimum ?? true;

  const food = foodPerGuest * guests;
  const staffing = calcStaffing(guests, eventHours, style, opts);
  const apps    = opts.appetizers * PRICING.addons.appetizerPerPersonEach * guests;
  const dessert = opts.dessert ? PRICING.addons.dessertPerGuest * guests : 0;
  const coffee  = opts.coffee  ? PRICING.addons.coffeeTeaPerGuest * guests : 0;

  const rawSubtotal = food + staffing.cost + apps + dessert + coffee;
  const minimumApplied = applyMinimum && rawSubtotal < PRICING.eventMinimum;
  const subtotal = minimumApplied ? PRICING.eventMinimum : rawSubtotal;
  const tax     = subtotal * PRICING.salesTaxRate;
  const service = subtotal * serviceFeeRate;
  const charge  = subtotal * PRICING.chargeFeeRate;
  const total   = subtotal + tax + service + charge;
  const deposit = total * PRICING.depositRate;

  return { food, staffing, apps, dessert, coffee, rawSubtotal, minimumApplied, subtotal, tax, service, charge, total, deposit };
}

export function calcBar(guests: number, barType: string): BarCalc {
  const b = PRICING.bar[barType];
  const base = b.perGuest * guests;
  const bartenders = Math.ceil(guests / b.guestsPerBartender);
  const subtotal = base;
  const tax     = subtotal * PRICING.salesTaxRate;
  const service = subtotal * PRICING.serviceFeeRate;
  const charge  = subtotal * PRICING.chargeFeeRate;
  return { base, bartenders, subtotal, tax, service, charge, total: subtotal + tax + service + charge };
}

// Bar options (rates are editable defaults — real invoices vary $11–35/guest)
export const BAR_TYPES: Record<string, { perGuest: number; guestsPerBartender: number }> = {
  'None':          { perGuest: 0,  guestsPerBartender: 0 },
  'Beer & Wine':   { perGuest: 14, guestsPerBartender: 75 },
  'Soft Bar':      { perGuest: 26, guestsPerBartender: 75 },
  'Full Bar':      { perGuest: 29, guestsPerBartender: 50 },
};

// À la carte add-on presets, with default rates extracted from real invoices.
// `unit`: 'guest' = price × guest count, 'flat' = one-time, 'each' = price × qty.
export interface PresetItem { name: string; rate: number; unit: 'guest' | 'flat' | 'each'; }
export const ADDON_PRESETS: PresetItem[] = [
  { name: 'Equipment / Rentals',        rate: 21,  unit: 'guest' },
  { name: 'Graze Table',                rate: 14,  unit: 'guest' },
  { name: 'Late Night Bites',           rate: 8,   unit: 'guest' },
  { name: 'Kids Menu',                  rate: 25,  unit: 'guest' },
  { name: 'Additional Main Entrée',     rate: 12,  unit: 'guest' },
  { name: 'Flatbread (cocktail hour)',  rate: 6,   unit: 'guest' },
  { name: 'Coffee & Tea',               rate: 2.85, unit: 'guest' },
  { name: 'Dessert',                    rate: 4.75, unit: 'guest' },
  { name: 'Vendor Meals',               rate: 30,  unit: 'each' },
  { name: 'Tasting',                    rate: 250, unit: 'each' },
  { name: 'Ceremony Chair Flip',        rate: 150, unit: 'flat' },
  { name: 'Bar Production Fee (2nd bar)', rate: 0, unit: 'flat' },
  { name: 'Full Sheet Cake',            rate: 385, unit: 'flat' },
  { name: 'Half Sheet Cake',            rate: 186, unit: 'flat' },
  { name: 'Cutting Cake',               rate: 70,  unit: 'flat' },
  { name: 'Welcome Refreshment',        rate: 0,   unit: 'flat' },
];

export const fmt  = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
export const fmtD = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
