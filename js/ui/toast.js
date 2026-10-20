// Toast with Undo (ARCHITECTURE §7.2, DESIGN §6.8 + motion contract #10).
//
//   toast({ message: 'Deleted', action: { label: 'Undo', run: () => events.restore(e) } });
//
// Only for background or reversible actions (delete, mark used, discard,
// one-tap diaper). A success inside a sheet is shown IN the sheet, not here.
//  - Rises from just above the live pill / nav (never from the top edge):
//    translateY(--move-md) + fade in over --dur-fast; exits fading and
//    dropping --move-sm over 160 ms. Position comes from CSS (it reads the
//    same --pill-* variables as the live pill), so it always clears the pill.
//  - One at a time: a new toast replaces the current one.
//  - Lives in #toastRoot, a persistent role="status" aria-live="polite"
//    region (the region must exist before text is inserted for screen
//    readers to announce it reliably).
//  - The timer pauses while the toast is touched, hovered or focused, so a
//    parent reaching for Undo never loses it mid-tap.
//  - Undo runs the action, shows "Restored" for 1.2 s, then leaves.
//  - Taps that land within ENTER_GUARD_MS of the toast appearing are ignored
//    (guardEnterTaps). Finishing a live pill drops --pill-count, so the toast
//    rises into the slot the pill's Finish just left: the second tap of a
//    double-tap on Finish would otherwise hit Undo and restart the activity.
//    Keyboard activation is never delayed.

import { html, element } from './html.js';
import { afterTransition, guardEnterTaps } from './sheet.js';

const EXIT_MS = 160;
const RESTORED_MS = 1200;

let current = null;

function toastRoot() {
  let root = document.getElementById('toastRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toastRoot';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  return root;
}

/**
 * @typedef {object} ToastHandle
 * @property {() => void} dismiss  leave now (animated)
 * @property {Promise<'timeout'|'action'|'dismissed'|'replaced'>} done  why it went away
 */

/**
 * Show a toast (replacing any current one).
 * @param {object} opts
 * @param {string} opts.message plain text (escaped)
 * @param {{ label: string, run: () => (void|Promise<void>), doneMessage?: string }} [opts.action]
 *   one action button (usually Undo). After it runs the toast shows
 *   `doneMessage` (default "Restored" for Undo) for 1.2 s.
 * @param {{ label: string, run: () => (void|Promise<void>) }} [opts.secondaryAction]
 *   an optional second, quieter button (e.g. "Add details" next to Undo on a
 *   one-tap diaper). It runs and the toast leaves at once.
 * @param {number} [opts.duration=5000] ms before it leaves on its own (0 = stays until dismissed)
 * @param {'default'|'success'|'warn'} [opts.tone]
 * @returns {ToastHandle}
 */
export function toast({ message, action, secondaryAction, duration = 5000, tone = 'default' } = {}) {
  if (current) current.leave('replaced', true);
  const root = toastRoot();
  const safeTone = ['default', 'success', 'warn'].includes(tone) ? tone : 'default';
  const el = element(html`
    <div class="toast" data-tone="${safeTone}" data-state="pre">
      <p class="toast-msg">${message}</p>
      ${action ? html`<button type="button" class="toast-action toast-action-1">${action.label}</button>` : ''}
      ${secondaryAction ? html`<button type="button" class="toast-action toast-action-2">${secondaryAction.label}</button>` : ''}
    </div>`);
  root.appendChild(el);
  guardEnterTaps(el);

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let timer = 0;
  let remaining = duration;
  let startedAt = 0;
  let paused = 0; // a counter: hover and focus can overlap
  let leaving = false;

  const start = () => {
    if (!remaining || leaving) return;
    startedAt = Date.now();
    timer = setTimeout(() => leave('timeout'), remaining);
  };
  const pause = () => {
    paused += 1;
    if (paused === 1 && timer) {
      clearTimeout(timer);
      timer = 0;
      remaining = Math.max(800, remaining - (Date.now() - startedAt));
    }
  };
  const resume = () => {
    paused = Math.max(0, paused - 1);
    if (!paused) start();
  };

  function leave(reason, fast = false) {
    if (leaving) return;
    leaving = true;
    clearTimeout(timer);
    if (current && current.el === el) current = null;
    el.setAttribute('data-state', 'leaving');
    const remove = () => { el.remove(); resolveDone(reason); };
    if (fast) remove(); else afterTransition(el, EXIT_MS + 160, remove, { property: 'opacity' });
  }

  el.addEventListener('pointerenter', pause);
  el.addEventListener('pointerleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', resume);

  const btn2 = el.querySelector('.toast-action-2');
  if (btn2 && secondaryAction) {
    btn2.addEventListener('click', async () => {
      if (leaving || btn2.disabled) return;
      btn2.disabled = true;
      leave('action');
      try { await secondaryAction.run(); } catch (err) { console.error('toast action failed', err); }
    });
  }

  const btn = el.querySelector('.toast-action-1');
  if (btn && action) {
    btn.addEventListener('click', async () => {
      if (leaving || btn.disabled) return;
      btn.disabled = true;
      clearTimeout(timer);
      try {
        await action.run();
      } catch (err) {
        console.error('toast action failed', err);
        el.querySelector('.toast-msg').textContent = 'That didn’t work. Try again.';
        btn.disabled = false;
        start();
        return;
      }
      const doneMessage = action.doneMessage ?? (/^undo$/i.test(String(action.label)) ? 'Restored' : '');
      if (doneMessage) {
        el.querySelector('.toast-msg').textContent = doneMessage;
        btn.remove();
        if (btn2) btn2.remove();
        el.classList.add('is-done');
        setTimeout(() => leave('action'), RESTORED_MS);
      } else {
        leave('action');
      }
    });
  }

  // enter on the next frame so the transition runs from the pre state
  el.getBoundingClientRect();
  el.setAttribute('data-state', 'in');
  start();

  current = { el, leave };
  return { dismiss: () => leave('dismissed'), done };
}

/**
 * Remove the current toast immediately (no animation), e.g. on navigation.
 */
export function clearToast() {
  if (current) current.leave('dismissed', true);
}
