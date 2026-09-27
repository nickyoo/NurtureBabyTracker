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
