// STUB: the Memories screen team replaces this file (DESIGN §13 Frame 6).
// Follows the view contract (ARCHITECTURE §5.2); "Add a memory" opens the
// (stub) memory sheet through ctx.sheets.

export default {
  id: 'memories',
  title: 'Memories',
  /**
   * @param {HTMLElement} root
   * @param {object} ctx
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render } = ctx.html;
    const { iconHtml } = ctx.icons;
    const name = ctx.format.babyName(ctx.settings.activeBaby(), '');
    render(root, html`<div class="view-pad">
      <header class="page-hd"><div>
        <p class="eyebrow">${name ? `${ctx.format.possessive(name)} book` : 'The book'}</p>
        <h1 class="page-title">Memories</h1>
      </div></header>
      <div class="empty-state cat-mem">
        <span class="empty-disc">${iconHtml('spark')}</span>
        <h2 class="empty-title">Coming together…</h2>
        <p class="empty-text">Firsts and photos will fill this book. They never leave this phone.</p>
        <button type="button" class="btn btn-primary" data-action="add">${iconHtml('camera')}Add a memory</button>
      </div>
    </div>`);
    const onClick = (e) => { const b = e.target.closest('[data-action="add"]'); if (b) ctx.sheets.memory({ origin: b }); };
    root.addEventListener('click', onClick);
    return { unmount() { root.removeEventListener('click', onClick); } };
  },
};
