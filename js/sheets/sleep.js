// STUB: the Sleep sheet team replaces this file (DESIGN §6.3).
// Follows the sheet contract (ARCHITECTURE §5.3): opened through
// ctx.openSheet with an origin; renders a titled empty state whose button
// does something real. Registers its live-pill handlers in setup(ctx).

/**
 * Open the sleep sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {{ origin?: Element, preset?: object, resume?: object, finishing?: boolean }} [opts]
 * @returns {object} sheet api
 */
export function openSleepSheet(ctx, { origin, preset, resume } = {}) {
  const { html, render } = ctx.html;
  const { iconHtml } = ctx.icons;
  void preset;
  return ctx.openSheet({
    title: 'Sleep',
    origin,
    className: 'sheet-sleep',
    render(body, api) {
      render(body, html`<div class="empty-state cat-sleep">
          <span class="empty-disc">${iconHtml('moon')}</span>
          <h3 class="empty-title">Coming together…</h3>
          <p class="empty-text">Naps and night sleep are on their way.</p>
          ${resume
            ? html`<button type="button" class="btn btn-primary" data-finish>Log wake-up</button>`
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
  ctx.livePill.register('sleep', {
    open: (event, origin) => openSleepSheet(ctx, { origin, resume: event }),
    // Waking needs no extra input, so Finish logs it at once (with Undo).
    async finish(event) {
      await ctx.events.stop(event.id);
      ctx.toast({ message: 'Wake-up logged', action: { label: 'Undo', run: () => ctx.events.update(event.id, { endTime: null }) } });
    },
  });
}
