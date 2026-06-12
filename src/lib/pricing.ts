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

export function calcStaffing(guests: number, eventHours: number, style: string): StaffingCalc {
  const s = PRICING.staffing;
  const ratio = s.guestsPerWaitstaff[style];
  const waitstaff = Math.max(1, Math.floor(guests / ratio));
  const totalHours = eventHours + s.setupBreakdownHours;
  const hourlyCost = waitstaff * s.waitstaffHourly + s.captainCount * s.captainHourly;
  return { waitstaff, totalHours, captain: s.captainCount, cost: hourlyCost * totalHours, hourlyCost };
}

export function calcPackage(
  guests: number,
  eventHours: number,
  style: string,
  opts: { appetizers: number; dessert: boolean; coffee: boolean }
): PackageCalc {
  const food = PRICING.foodPerGuest * guests;
  const staffing = calcStaffing(guests, eventHours, style);
  const apps    = opts.appetizers * PRICING.addons.appetizerPerPersonEach * guests;
  const dessert = opts.dessert ? PRICING.addons.dessertPerGuest * guests : 0;
  const coffee  = opts.coffee  ? PRICING.addons.coffeeTeaPerGuest * guests : 0;

  const rawSubtotal = food + staffing.cost + apps + dessert + coffee;
  const minimumApplied = rawSubtotal < PRICING.eventMinimum;
  const subtotal = Math.max(rawSubtotal, PRICING.eventMinimum);
  const tax     = subtotal * PRICING.salesTaxRate;
  const service = subtotal * PRICING.serviceFeeRate;
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

export const fmt  = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
export const fmtD = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
