// Small pure display helpers shared across view controllers (dashboard,
// feed flow) — no DOM, no state, safe to import from anywhere.

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Converts an inventory item's stored quantity into the display unit,
// rounding sensibly (whole mL, 0.1 oz).
export function displayQty(item, unit) {
  let qty = item.quantity;
  let qtyUnit = item.unit || 'oz';
  if (unit === 'mL' && qtyUnit === 'oz') {
    qty = Math.round(qty * 29.5735);
    qtyUnit = 'mL';
  } else if (unit === 'oz' && qtyUnit === 'mL') {
    qty = Math.round((qty / 29.5735) * 10) / 10;
    qtyUnit = 'oz';
  } else {
    qty = Math.round(qty * 10) / 10;
  }
  return { qty, qtyUnit };
}

const ML_PER_OZ = 29.5735;

// Converts a raw quantity between units. Unknown/missing units are treated
// as oz (the app's canonical unit). NaN/null quantities count as 0 so one
// bad record can't poison a whole day's total.
export function convertQty(qty, fromUnit, toUnit) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  const from = fromUnit === 'mL' ? 'mL' : 'oz';
  const to = toUnit === 'mL' ? 'mL' : 'oz';
  if (from === to) return n;
  return to === 'mL' ? n * ML_PER_OZ : n / ML_PER_OZ;
}

// Sums session outputQty in the display unit, rounded for display
// (whole mL, 0.1 oz). Sessions logged in either unit total correctly.
export function sumQty(sessions, unit) {
  const total = (sessions || []).reduce((acc, s) => acc + convertQty(s.outputQty, s.unit, unit), 0);
  return unit === 'mL' ? Math.round(total) : Math.round(total * 10) / 10;
}

// A session's own quantity, converted to the display unit.
export function sessionQty(session, unit) {
  return displayQty({ quantity: Number.isFinite(Number(session.outputQty)) ? Number(session.outputQty) : 0, unit: session.unit }, unit);
}

// "1 pump" / "3 pumps"
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
