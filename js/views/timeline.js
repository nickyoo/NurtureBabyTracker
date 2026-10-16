// STUB: the Timeline screen team replaces this file (DESIGN §13 Frame 4).
// Follows the view contract (ARCHITECTURE §5.2); its one action pushes the
// pediatrician report screen, proving pushed screens + Back.

export default {
  id: 'timeline',
  title: 'Timeline',
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
        <p class="eyebrow">Timeline</p>
        <h1 class="page-title">Today</h1>
        <p class="page-sub">${ctx.format.dateLabel(Date.now())}</p>
      </div></header>
      <div class="empty-state cat-neutral">
        <span class="empty-disc">${iconHtml('timeline')}</span>
        <h2 class="empty-title">Coming together…</h2>
        <p class="empty-text">Your day, hour by hour, will appear here.</p>
        <button type="button" class="btn btn-primary" data-action="report">${iconHtml('report')}Pediatrician report</button>
      </div>
    </div>`);
    const onClick = (e) => { if (e.target.closest('[data-action="report"]')) ctx.router.push('report'); };
    root.addEventListener('click', onClick);
    return { unmount() { root.removeEventListener('click', onClick); } };
  },
};
