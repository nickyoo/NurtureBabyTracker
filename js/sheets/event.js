// STUB: the Entry sheet team replaces this file (DESIGN §6.4).
// Follows the sheet contract (ARCHITECTURE §5.3): opened through
// ctx.openSheet with an origin; renders a titled empty state whose button
// does something real.

/**
 * Open the event sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {{ origin?: Element, preset?: object, event?: object }} [opts]
 * @returns {object} sheet api
 */
export function openEventSheet(ctx, { origin, preset } = {}) {
  const { html, render } = ctx.html;
  const { iconHtml } = ctx.icons;
  void preset;
  return ctx.openSheet({
    title: 'Entry',
    origin,
    className: 'sheet-event',
    render(body, api) {
      render(body, html`<div class="empty-state cat-neutral">
          <span class="empty-disc">${iconHtml('edit')}</span>
          <h3 class="empty-title">Coming together…</h3>
          <p class="empty-text">Viewing, editing and deleting entries is on its way.</p>
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
