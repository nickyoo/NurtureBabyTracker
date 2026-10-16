// STUB: the Onboarding screen team replaces this file (DESIGN §13 Frame 8).
// Shown as a router root (no nav, no live pill). Finishing onboarding is
// just settings.set('onboarded', true): app.js then lands on Today and asks
// the browser to persist storage (ARCHITECTURE §10b).

export default {
  id: 'onboarding',
  title: 'Welcome',
  /**
   * @param {HTMLElement} root
   * @param {object} ctx
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render } = ctx.html;
    const { iconHtml } = ctx.icons;
    render(root, html`<div class="view-pad">
      <div class="spread mt-3"><span class="wordmark">Nurture</span></div>
      <div class="empty-state cat-accent">
        <span class="empty-disc">${iconHtml('shield')}</span>
        <h1 class="empty-title">Coming together…</h1>
        <p class="empty-text">Free. Private. Everything stays on this phone.</p>
        <button type="button" class="btn btn-primary" data-action="start">Get started</button>
      </div>
    </div>`);
    const onClick = async (e) => {
      const b = e.target.closest('[data-action="start"]');
      if (!b) return;
      b.setAttribute('aria-busy', 'true');
      try { await ctx.settings.set('onboarded', true); } finally { b.removeAttribute('aria-busy'); }
    };
    root.addEventListener('click', onClick);
    return { unmount() { root.removeEventListener('click', onClick); } };
  },
};
