// STUB: the Report team replaces this file (ARCHITECTURE §10c). A pushed
// screen with a back button.

export default {
  id: 'report',
  title: 'Report',
  /**
   * @param {HTMLElement} root
   * @param {object} ctx
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render } = ctx.html;
    const { iconHtml } = ctx.icons;
    render(root, html`<div class="view-pad">
      <div class="navbar">
        <button type="button" class="back" data-action="back">${iconHtml('chev-l')}Back</button>
        <h1 class="navbar-title">Report</h1><span></span>
      </div>
      <div class="empty-state cat-neutral">
        <span class="empty-disc">${iconHtml('report')}</span>
        <h2 class="empty-title">Coming together…</h2>
        <p class="empty-text">A 7 or 14 day summary for the pediatrician, made on this phone.</p>
        <button type="button" class="btn btn-primary" data-action="back">Done</button>
      </div>
    </div>`);
    const onClick = (e) => { if (e.target.closest('[data-action="back"]')) ctx.router.back(); };
    root.addEventListener('click', onClick);
    return { unmount() { root.removeEventListener('click', onClick); } };
  },
};
