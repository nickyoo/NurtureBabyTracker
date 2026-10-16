// STUB: the Memory sheet team replaces this file (DESIGN §6.8 MemoryCover).
// Follows the sheet contract (ARCHITECTURE §5.3): opened through
// ctx.openSheet with an origin; renders a titled empty state whose button
// does something real.

/**
 * Open the memory sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {{ origin?: Element, preset?: object, event?: object }} [opts]
 * @returns {object} sheet api
 */
export function openMemorySheet(ctx, { origin, preset } = {}) {
  const { html, render } = ctx.html;
  const { iconHtml } = ctx.icons;
  void preset;
  return ctx.openSheet({
    title: 'Memory',
    origin,
    className: 'sheet-memory',
    render(body, api) {
      render(body, html`<div class="empty-state cat-mem">
          <span class="empty-disc">${iconHtml('spark')}</span>
          <h3 class="empty-title">Coming together…</h3>
          <p class="empty-text">Firsts and photos are on their way.</p>
          <button type="button" class="btn btn-primary" data-close>Done</button>
        </div>`);
      const close = body.querySelector('[data-close]');
      if (close) close.addEventListener('click', () => api.close());
    },
  });
}

/**
 * One-time wiring at boot (called by app.js).
 * @param {object} ctx
 */
export function setup(ctx) {
  void ctx;
}
