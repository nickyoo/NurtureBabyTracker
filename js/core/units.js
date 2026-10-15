// oz / mL conversion + formatting (pure, no DOM, no state).
//
// Amounts are stored in the unit they were entered in, with that unit
// recorded next to them (ARCHITECTURE §3). Everything that totals or displays
// an amount goes through here, so "4 oz + 120 mL" can never again render as
// "124 mL" (AUDIT F6).

/** Millilitres per US fluid ounce. */
export const ML_PER_OZ = 29.5735;

/** The two supported units. */
export const UNITS = Object.freeze(['oz', 'mL']);

/**
 * Normalise any unit spelling to 'oz' | 'mL'. Unknown/missing → 'oz' (v1's
 * canonical unit, so legacy records without a unit keep their meaning).
 * @param {unknown} unit
 * @returns {'oz'|'mL'}
 */
export function normalizeUnit(unit) {
  return typeof unit === 'string' && unit.trim().toLowerCase() === 'ml' ? 'mL' : 'oz';
}

/**
 * Convert a raw quantity between units. NaN/null quantities count as 0 so one
 * bad record can't poison a whole day's total (the v1.6 NaN-pump bug).
 * @param {unknown} qty
 * @param {unknown} fromUnit
 * @param {unknown} toUnit
 * @returns {number}
 */
export function convertQty(qty, fromUnit, toUnit) {
  const n = toFiniteNumber(qty);
  if (n === null) return 0;
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return n;
  return to === 'mL' ? n * ML_PER_OZ : n / ML_PER_OZ;
}

/**
 * Round for display/storage in a unit: whole mL, 0.1 oz.
 * @param {number} n
 * @param {'oz'|'mL'} unit
 * @returns {number}
 */
export function roundForUnit(n, unit) {
  if (!Number.isFinite(n)) return 0;
  // Math.round(x * 10) / 10 leaves float dust on some inputs; toFixed fixes it.
  return normalizeUnit(unit) === 'mL' ? Math.round(n) : Number((Math.round(n * 10) / 10).toFixed(1));
}

/**
 * The {amount, unit} a record carries, whatever its shape:
 * a v2 event (`data.amount` / `data.unit`), an inventory pouch
 * (`quantity` / `unit`) or a v1 session (`outputQty` / `unit`).
 * @param {object} rec
 * @returns {{ amount: number|null, unit: 'oz'|'mL' }}
 */
export function amountOf(rec) {
  if (!rec || typeof rec !== 'object') return { amount: null, unit: 'oz' };
  if (rec.data && typeof rec.data === 'object') {
    return { amount: toFiniteNumber(rec.data.amount), unit: normalizeUnit(rec.data.unit) };
  }
  if ('quantity' in rec) return { amount: toFiniteNumber(rec.quantity), unit: normalizeUnit(rec.unit) };
  if ('outputQty' in rec) return { amount: toFiniteNumber(rec.outputQty), unit: normalizeUnit(rec.unit) };
  return { amount: null, unit: normalizeUnit(rec.unit) };
}

/**
 * Sum amounts of events or inventory items in the display unit, converting
 * each record from its own unit. Records without an amount (breastfeeding,
 * diapers, a NaN legacy pump) contribute 0.
 * @param {object[]} records
 * @param {'oz'|'mL'} unit display unit
 * @param {{ round?: boolean }} [opts] round=false returns the raw float
 * @returns {number}
 */
export function sumAmounts(records, unit, { round = true } = {}) {
  let total = 0;
  for (const r of records || []) {
    const { amount, unit: from } = amountOf(r);
    total += convertQty(amount, from, unit);
  }
  return round ? roundForUnit(total, unit) : total;
}

/**
 * Split an amount into display parts (big numeral + small unit in the UI).
 * Missing amounts render as an em dash so the UI shows "—" and offers edit.
 * @param {unknown} amount
 * @param {unknown} unit the unit the amount is stored in
 * @param {unknown} [displayUnit] defaults to `unit`
 * @returns {{ value: string, unit: 'oz'|'mL', missing: boolean }}
 */
export function amountParts(amount, unit, displayUnit) {
  const to = normalizeUnit(displayUnit === undefined ? unit : displayUnit);
  const n = toFiniteNumber(amount);
  if (n === null) return { value: '—', unit: to, missing: true };
  const v = roundForUnit(convertQty(n, unit, to), to);
  return { value: String(v), unit: to, missing: false };
}

/**
 * Format an amount: '4 oz', '4.5 oz', '120 mL', or '—' when missing.
 * @param {unknown} amount
 * @param {unknown} unit the unit the amount is stored in
 * @param {unknown} [displayUnit] defaults to `unit`
 * @returns {string}
 */
export function formatAmount(amount, unit, displayUnit) {
  const p = amountParts(amount, unit, displayUnit);
  return p.missing ? '—' : `${p.value} ${p.unit}`;
}

/**
 * Clamp + snap to step, without float dust (4.0, not 4.0000000004).
 * Non-numeric input falls back to `min`.
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @returns {number}
 */
export function clampAmount(v, min, max, step) {
  const num = typeof v === 'number' ? v : parseFloat(v);
  const safe = Number.isNaN(num) ? min : num;
  const clamped = Math.min(max, Math.max(min, safe));
  const stepped = Math.round(clamped / step) * step;
  const decimals = decimalsOf(step);
  return Number(stepped.toFixed(decimals));
}

/** Per-unit input ergonomics, so every stepper/chip row agrees (AUDIT F14). */
export const UNIT_INPUT = Object.freeze({
  oz: Object.freeze({ step: 0.5, fineStep: 0.1, min: 0, max: 16, presets: Object.freeze([2, 4, 6, 8]), chips: Object.freeze([0.5, 1, 2]) }),
  mL: Object.freeze({ step: 10, fineStep: 5, min: 0, max: 480, presets: Object.freeze([60, 120, 180, 240]), chips: Object.freeze([15, 30, 60, 90]) }),
});

/**
 * Input config for a unit (step, fine step, min/max, preset + chip values).
 * @param {unknown} unit
 * @returns {{step:number, fineStep:number, min:number, max:number, presets:readonly number[], chips:readonly number[]}}
 */
export function inputConfig(unit) {
  return UNIT_INPUT[normalizeUnit(unit)];
}

/**
 * Nudge an amount by `delta` in its unit, clamped to the unit's range and
 * snapped to its fine step. Used by +/- steppers and chips.
 * @param {unknown} value
 * @param {number} delta
 * @param {unknown} unit
 * @returns {number}
 */
export function stepAmount(value, delta, unit) {
  const cfg = inputConfig(unit);
  const base = toFiniteNumber(value) ?? 0;
  const d = Number.isFinite(delta) ? delta : 0;
  return clampAmount(base + d, cfg.min, cfg.max, cfg.fineStep);
}

/**
 * Convert an in-progress amount when the user flips units mid-entry, snapped
 * to the new unit's fine step (4 oz → 120 mL, 120 mL → 4.1 oz).
 * @param {unknown} value
 * @param {unknown} fromUnit
 * @param {unknown} toUnit
 * @returns {number}
 */
export function switchUnit(value, fromUnit, toUnit) {
  const to = normalizeUnit(toUnit);
  const cfg = inputConfig(to);
  return clampAmount(convertQty(value, fromUnit, to), cfg.min, Number.MAX_SAFE_INTEGER, cfg.fineStep);
}

/**
 * Strict number coercion used across the data layer: finite numbers and
 * plain numeric strings only. Booleans, '', arrays, objects → null (so
 * `Number(true) === 1` style accidents can't sneak in).
 * @param {unknown} v
 * @returns {number|null}
 */
export function toFiniteNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function decimalsOf(step) {
  if (!Number.isFinite(step) || step >= 1) return 0;
  const s = String(step);
  const i = s.indexOf('.');
  return i === -1 ? 0 : Math.min(6, s.length - i - 1);
}
