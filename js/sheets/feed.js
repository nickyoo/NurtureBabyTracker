// STUB: the Feed sheet team replaces this file (DESIGN §6.7, Frame 3).
// Follows the sheet contract (ARCHITECTURE §5.3): opened through
// ctx.openSheet with an origin; renders a titled empty state whose button
// does something real. Registers its live-pill handlers in setup(ctx).

/**
 * Open the feed sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {{ origin?: Element, preset?: object, resume?: object, finishing?: boolean }} [opts]
 * @returns {object} sheet api
 */
export function openFeedSheet(ctx, { origin, preset, resume } = {}) {
  const { html, render } = ctx.html;
  const { iconHtml } = ctx.icons;
  void preset;
  return ctx.openSheet({
    title: 'Feed',
    origin,
    className: 'sheet-feed',
    render(body, api) {
      render(body, html`<div class="empty-state cat-feed">
          <span class="empty-disc">${iconHtml('bottle')}</span>
          <h3 class="empty-title">Coming together…</h3>
          <p class="empty-text">Bottle and breastfeeding logging is on its way.</p>
          ${resume
            ? html`<button type="button" class="btn btn-primary" data-finish>Finish feed</button>`
            : html`<button type="button" class="btn btn-primary" data-close>Done</button>`}
        </div>`);
      const close = body.querySelector('[data-close]');
      if (close) close.addEventListener('click', () => api.close());
      const finishBtn = body.querySelector('[data-finish]');
      if (finishBtn) finishBtn.addEventListener('click', async () => {
        finishBtn.setAttribute('aria-busy', 'true');
        try { await ctx.events.stop(resume.id); } finally { api.close(); }
      });
    },
  });
}

/**
 * One-time wiring at boot (called by app.js).
 * @param {object} ctx
 */
export function setup(ctx) {
  ctx.livePill.register('feed', {
    open: (event, origin) => openFeedSheet(ctx, { origin, resume: event }),
    // The real sheet opens its "how much?" step here (DESIGN §6.5).
    finish: (event, origin) => openFeedSheet(ctx, { origin, resume: event, finishing: true }),
  });
}
