// STUB: the Quick-log team replaces this file (DESIGN §6.7, Frame 3).
// Already a REAL sheet: it grows out of the + (the + is the origin and
// carries [data-sheet-grow]), lists one tile per VISIBLE tracker, and each
// tile closes this sheet and opens its own (stub) sheet through ctx.sheets —
// proving the + → quick log → feed/pump/… plumbing end to end.

/**
 * Open the quick-log sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {{ origin?: Element }} [opts]
 * @returns {object} sheet api
 */
export function openQuickLogSheet(ctx, { origin } = {}) {
  const { html, render, raw } = ctx.html;
  const { icon } = ctx.icons;
  const t = ctx.settings.get('trackers');
  const name = ctx.format.babyName(ctx.settings.activeBaby());
  const tiles = [
    t.bottle && { key: 'bottle', cat: 'feed', icon: 'bottle', label: 'Bottle', sub: 'Feed a bottle', open: (o) => ctx.sheets.feed({ origin: o, preset: { method: 'bottle' } }) },
    t.breastfeeding && { key: 'breast', cat: 'feed', icon: 'breast', label: 'Breastfeed', sub: 'Left / right timer', open: (o) => ctx.sheets.feed({ origin: o, preset: { method: 'breast' } }) },
    t.pump && { key: 'pump', cat: 'pump', icon: 'pump', label: 'Pump', sub: 'Timer or past pump', open: (o) => ctx.sheets.pump({ origin: o }) },
    t.sleep && { key: 'sleep', cat: 'sleep', icon: 'moon', label: 'Sleep', sub: 'Start a nap', open: (o) => ctx.sheets.sleep({ origin: o }) },
    t.diaper && { key: 'diaper', cat: 'diaper', icon: 'diaper', label: 'Diaper', sub: 'Wet, dirty or both', open: (o) => ctx.sheets.diaper({ origin: o }) },
  ].filter(Boolean);
  const rows = [
    t.memories && { key: 'memory', cat: 'mem', icon: 'spark', label: 'Memory', sub: 'Photo or first', open: (o) => ctx.sheets.memory({ origin: o }) },
    t.stash && { key: 'stash', cat: 'pump', icon: 'pouch', label: 'Stash milk', sub: 'Fridge or freezer', open: (o) => ctx.sheets.stash({ origin: o }) },
  ].filter(Boolean);
  const all = [...tiles, ...rows];

  return ctx.openSheet({
    title: `Log for ${name}`,
    origin,
    className: 'sheet-quicklog',
    render(body, api) {
      render(body, html`
        ${tiles.length ? html`<div class="tiles">${tiles.map((x) => html`
          <button type="button" class="tile cat-${x.cat}" data-key="${x.key}" data-stagger>
            <span class="tile-ic">${raw(icon(x.icon, { size: 20 }))}</span>
            <span class="tile-label">${x.label}</span><small class="tile-ctx">${x.sub}</small>
          </button>`)}</div>` : ''}
        ${rows.length ? html`<div class="tiles mt-3">${rows.map((x) => html`
          <button type="button" class="tile row-tile cat-${x.cat}" data-key="${x.key}" data-stagger>
            <span class="tile-ic">${raw(icon(x.icon, { size: 20 }))}</span>
            <span class="tile-text"><span class="tile-label">${x.label}</span><small class="tile-ctx">${x.sub}</small></span>
          </button>`)}</div>` : ''}
        ${all.length ? '' : html`<div class="empty-state cat-neutral"><p class="empty-text">Every tracker is hidden. Turn some on in Settings → Customize.</p></div>`}`);
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-key]');
        if (!b) return;
        const tile = all.find((x) => x.key === b.dataset.key);
        api.close();
        // The tile is about to disappear, so the next sheet's origin is the +
        // (focus returns there when it closes).
        tile.open(ctx.fab || origin);
      });
    },
  });
}

/** @param {object} ctx */
export function setup(ctx) { void ctx; }
