// STUB: the Settings screen team replaces this file (DESIGN §13 Frame 7).
// A pushed screen (ARCHITECTURE §7.4): ctx.params.page selects a sub-page,
// and each sub-page is pushed with router.push('settings', { page }).

const PAGES = { customize: 'Customize' };

export default {
  id: 'settings',
  title: 'Settings',
  /**
   * @param {HTMLElement} root
   * @param {object} ctx
   * @param {{ page?: string }} [params]
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx, params = {}) {
    const { html, render } = ctx.html;
    const { iconHtml } = ctx.icons;
    const sub = PAGES[params.page] ? params.page : null;
    render(root, html`<div class="view-pad">
      <div class="navbar">
        <button type="button" class="back" data-action="back">${iconHtml('chev-l')}${sub ? 'Settings' : 'Today'}</button>
        <h1 class="navbar-title">${sub ? PAGES[sub] : 'Settings'}</h1><span></span>
      </div>
      <div class="empty-state cat-neutral">
        <span class="empty-disc">${iconHtml('gear')}</span>
        <h2 class="empty-title">Coming together…</h2>
        <p class="empty-text">${sub ? 'Choose what shows on Today and in +.' : 'Baby, feeding, appearance, backups and privacy will live here.'}</p>
        ${sub
          ? html`<button type="button" class="btn btn-primary" data-action="back">Done</button>`
          : html`<button type="button" class="btn btn-primary" data-action="customize">Customize</button>`}
      </div>
    </div>`);
    const onClick = (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'back') ctx.router.back();
      if (b.dataset.action === 'customize') ctx.router.push('settings', { page: 'customize' });
    };
    root.addEventListener('click', onClick);
    return { unmount() { root.removeEventListener('click', onClick); } };
  },
};
