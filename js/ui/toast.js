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
//  - Every exit animates (160 ms fade-and-drop; reduced motion: the fade).
//    A toast replaced while visible leaves in place UNDER the new one.
//  - A sheet opening over a toast (which sits under the scrim) sends it out
//    with that same exit, timer still running, so it can't be revealed by the
//    sheet sliding away only to be replaced a frame later (MAV-9). Once every
//    sheet is gone it rises back in — unless a new toast took its place in
//    the meantime, or its time ran out while covered.
//    NOTE: a toast raised while a sheet is open sits UNDER that sheet (z
//    order) and is not seen until the sheet goes — show in-sheet results in
//    the sheet (DESIGN §6.8).

import { html, element } from './html.js';
import { afterTransition, guardEnterTaps, onSheetChange, openSheetCount, whenSheetsIdle } from './sheet.js';

const EXIT_MS = 160;
const RESTORED_MS = 1200;
// After the last sheet is removed, wait this long before a covered toast
// rises back: the sheet's own follow-up (e.g. "Bottle deleted · Undo" after
// an entry sheet's Delete) arrives within a frame and replaces it unseen.
export const UNCOVER_DELAY_MS = 120;

let current = null;
let sheetsWatched = false;
let uncoverTimer = 0;

function watchSheets() {
  if (sheetsWatched) return;
  sheetsWatched = true;
  onSheetChange(({ count }) => {
    clearTimeout(uncoverTimer);
    if (count > 0) { if (current) current.cover(); return; }
    whenSheetsIdle().then(() => {
      clearTimeout(uncoverTimer);
      uncoverTimer = setTimeout(() => { if (!openSheetCount() && current) current.uncover(); }, UNCOVER_DELAY_MS);
    });
  });
}

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
  // MAV-9: a visible toast being replaced runs its own 160 ms fade-and-drop
  // UNDER the new one (cross-fade), instead of blinking out between frames.
  if (current) current.leave('replaced', !current.visible());
  watchSheets();
  const root = toastRoot();
  const safeTone = ['default', 'success', 'warn'].includes(tone) ? tone : 'default';
  const el = element(html`
    <div class="toast" data-tone="${safeTone}" data-state="pre">
      <p class="toast-msg">${message}</p>
      ${action ? html`<button type="button" class="toast-action toast-action-1">${action.label}</button>` : ''}
      ${secondaryAction ? html`<button type="button" class="toast-action toast-action-2">${secondaryAction.label}</button>` : ''}
    </div>`);
  // First in the region: a replaced toast still fading out (is-replaced) sits
  // after it in the DOM and under it on screen.
  root.insertBefore(el, root.firstChild);
  guardEnterTaps(el);

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let timer = 0;
  let remaining = duration;
  let startedAt = 0;
  let paused = 0; // a counter: hover and focus can overlap
  let leaving = false;
  let covered = false;

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
    // Already out of sight (covered by a sheet, or never painted): nothing
    // to animate, it simply goes.
    if (covered) fast = true;
    if (reason === 'replaced' && !fast) { el.classList.add('is-replaced'); el.setAttribute('aria-hidden', 'true'); }
    el.setAttribute('data-state', 'leaving');
    const remove = () => { el.remove(); resolveDone(reason); };
    if (fast) remove(); else afterTransition(el, EXIT_MS + 160, remove, { property: 'opacity' });
  }

  // A sheet opened over it: the ordinary exit (fade + drop), out of the
  // reading order; the timer keeps running.
  function cover() {
    if (leaving || covered) return;
    covered = true;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-state', 'leaving');
    afterTransition(el, EXIT_MS + 160, () => { if (covered && !leaving) el.setAttribute('data-state', 'covered'); }, { property: 'opacity' });
  }

  // Every sheet is gone: rise back in from the pre state (the enter).
  function uncover() {
    if (leaving || !covered) return;
    covered = false;
    el.removeAttribute('aria-hidden');
    el.setAttribute('data-state', 'pre');
    el.getBoundingClientRect();
    el.setAttribute('data-state', 'in');
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

  // enter on the next frame so the transition runs from the pre state. (A
  // toast raised from inside an open sheet enters as usual, under that
  // sheet, and shows as the sheet goes; only a sheet opening OVER a toast
  // covers it.)
  el.getBoundingClientRect();
  el.setAttribute('data-state', 'in');
  start();

  current = {
    el,
    leave,
    cover,
    uncover,
    // Seen right now: entered, not covered, on a visible page.
    visible: () => el.isConnected && el.getAttribute('data-state') === 'in' && !covered && !document.hidden,
  };
  return { dismiss: () => leave('dismissed'), done };
}

/**
 * Send the current toast away (e.g. on navigation): its exit animation when
 * it is on screen, at once when nobody can see it.
 */
export function clearToast() {
  if (current) current.leave('dismissed', !current.visible());
}
