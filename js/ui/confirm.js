// ConfirmSheet (ARCHITECTURE §7.3, DESIGN §6.8): a small sheet, never the
// browser's confirm(). ONLY for non-undoable actions (erase all data,
// import-replace). Anything reversible gets an Undo toast instead.
//
//   if (await confirmSheet({ title: 'Erase everything on this phone?',
//     body: 'This can’t be undone.', confirmLabel: 'Erase', destructive: true })) { … }
//
// Esc, scrim tap, drag-down and Back all resolve false. Initial focus is on
// the safe choice ("Keep it"), so a stray Enter never destroys anything.

import { html, render } from './html.js';
import { openSheet } from './sheet.js';

/**
 * Ask for confirmation in a bottom sheet.
 * @param {object} opts
 * @param {string} opts.title the question ("Erase everything on this phone?")
 * @param {string} [opts.body] one sentence of consequence
 * @param {string} [opts.confirmLabel='Confirm']
 * @param {string} [opts.cancelLabel='Keep it']
 * @param {boolean} [opts.destructive=false] confirm button uses the danger fill
 * @param {Element|null} [opts.origin] the trigger (focus returns to it)
 * @returns {Promise<boolean>} true only when the confirm button was pressed
 */
export function confirmSheet({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Keep it', destructive = false, origin = null } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      origin,
      className: 'sheet-confirm',
      onClose: (result) => { if (!answered) { answered = true; resolve(result === true); } },
      render(el, api) {
        render(el, html`
          ${body ? html`<p class="confirm-body">${body}</p>` : ''}
          <div class="confirm-actions sheet-footer">
            <button type="button" class="btn btn-block ${destructive ? 'btn-danger' : 'btn-primary'}" data-confirm>${confirmLabel}</button>
            <button type="button" class="btn btn-block btn-secondary" data-cancel autofocus>${cancelLabel}</button>
          </div>`);
        el.querySelector('[data-confirm]').addEventListener('click', () => api.close(true));
        el.querySelector('[data-cancel]').addEventListener('click', () => api.close(false));
      },
    });
  });
}
