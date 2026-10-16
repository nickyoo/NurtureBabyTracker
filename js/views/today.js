// STUB: the Today screen team replaces this file (DESIGN §13 Frame 1).
// It follows the view contract (ARCHITECTURE §5.2) so the shell boots and
// the plumbing is provable end to end: masthead from settings, avatar →
// Settings, and a real "Log something" that opens the quick-log sheet.

export default {
  id: 'today',
  title: 'Today',
  /**
   * @param {HTMLElement} root
   * @param {object} ctx
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render } = ctx.html;
    const { iconHtml } = ctx.icons;
    const draw = () => {
      const baby = ctx.settings.activeBaby();
      const name = ctx.format.babyName(baby);
      const age = baby ? ctx.format.babyAge(baby.birthDate) : '';
      render(root, html`<div class="view-pad">
        <header class="masthead">
          <div class="masthead-text">
            <p class="eyebrow">${ctx.format.eyebrowDate()}</p>
            <h1 class="masthead-title"><span class="masthead-name">${name}</span>${age ? html`<span class="masthead-age">${age}</span>` : ''}</h1>
          </div>
          <button type="button" class="avatar-btn" data-action="settings" aria-label="${ctx.format.possessive(name)} profile and settings">
            <span class="avatar avatar-fallback" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>
            <span class="gear-badge" aria-hidden="true">${iconHtml('gear')}</span>
          </button>
        </header>
        <div class="empty-state cat-feed">
          <span class="empty-disc">${iconHtml('bottle')}</span>
          <h2 class="empty-title">Coming together…</h2>
          <p class="empty-text">Since-last cards for feeds, sleep, diapers and pumping land here soon. You can already log from +.</p>
          <button type="button" class="btn btn-primary" data-action="log">${iconHtml('plus')}Log something</button>
        </div>
      </div>`);
    };
    const onClick = (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'settings') ctx.router.push('settings');
      if (b.dataset.action === 'log') ctx.sheets.quickLog({ origin: b });
    };
    draw();
    root.addEventListener('click', onClick);
    const off = ctx.settings.subscribe((c) => { if (['*', 'babies', 'activeBabyId'].includes(c.key)) draw(); });
    return { unmount() { off(); root.removeEventListener('click', onClick); } };
  },
};
