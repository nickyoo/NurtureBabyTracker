// STUB: the Stash screen team replaces this file (DESIGN §13 Frame 5).
// Follows the view contract (ARCHITECTURE §5.2); "Add pouch" opens the
// (stub) stash sheet through ctx.sheets.

export default {
  id: 'stash',
  title: 'Stash',
  /**
   * @param {HTMLElement} root
   * @param {object} ctx
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render } = ctx.html;
    const { iconHtml } = ctx.icons;
    render(root, html`<div class="view-pad">
      <header class="page-hd"><div>
        <p class="eyebrow">Milk stash</p>
        <h1 class="page-title">Stash</h1>
      </div></header>
      <div class="empty-state cat-pump">
        <span class="empty-disc">${iconHtml('pouch')}</span>
        <h2 class="empty-title">Coming together…</h2>
        <p class="empty-text">Pumped milk you save will line up here, oldest first.</p>
        <button type="button" class="btn btn-primary" data-action="add">${iconHtml('plus')}Add pouch</button>
      </div>
    </div>`);
    const onClick = (e) => { const b = e.target.closest('[data-action="add"]'); if (b) ctx.sheets.stash({ origin: b }); };
    root.addEventListener('click', onClick);
    return { unmount() { root.removeEventListener('click', onClick); } };
  },
};
