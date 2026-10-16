// Icon set (DESIGN §9): 24×24 grid, 1.75 stroke, round caps/joins, no
// fills, currentColor only — so every icon takes its color from CSS
// (category ink, --text-2, --accent on the active tab).
//
// Why inline SVG strings instead of DESIGN §9's <symbol> sprite in
// index.html: views render through html`` and need icons in templates; a
// string is self-contained (no id coupling between index.html and modules,
// works in sheets and the live pill alike) and costs no network request.
// Geometry is copied 1:1 from the final mockup's sprite.
//
//   import { icon } from '../ui/icons.js';
//   html`<span class="chip-ic">${raw(icon('bottle', { size: 22 }))}</span>`
//   html`${iconHtml('bottle')}`   // same, already wrapped in raw()
//
// Every icon is aria-hidden: the visible word or the button's aria-label
// carries the meaning (DESIGN §6 shared rules).

import { raw } from './html.js';

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

// name → [svgAttributes, innerMarkup]. svgAttributes default to STROKE.
const ICONS = {
  // ---- categories ----
  bottle: [STROKE, '<path d="M10.6 5.2c0-1.7.5-2.7 1.4-2.7s1.4 1 1.4 2.7"/><rect x="8.5" y="5.2" width="7" height="2.6" rx="1"/><path d="M9.2 7.8h5.6l1.2 3v8.4a2.3 2.3 0 0 1-2.3 2.3h-3.4A2.3 2.3 0 0 1 8 19.2v-8.4z"/><path d="M10.6 13.2h2.2M10.6 16.2h2.2"/>'],
  breast: [STROKE, '<path d="M4.5 9.5c0 5 3.4 9 7.5 9s7.5-4 7.5-9"/><circle cx="12" cy="13" r="1.9"/><path d="M4.5 9.5c1.6-2.6 4.4-4 7.5-4s5.9 1.4 7.5 4"/>'],
  pump: [STROKE, '<path d="M4.5 3.75h15l-5 6.25h-5z"/><path d="M9.5 10v8.5A2.5 2.5 0 0 0 12 21a2.5 2.5 0 0 0 2.5-2.5V10"/><path d="M9.5 14.5h2"/>'],
  moon: [STROKE, '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>'],
  sun: [STROKE, '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v1.8M12 19.4v1.8M2.8 12h1.8M19.4 12h1.8M5.5 5.5l1.3 1.3M17.2 17.2l1.3 1.3M5.5 18.5l1.3-1.3M17.2 6.8l1.3-1.3"/>'],
  diaper: [STROKE, '<path d="M3.5 7h17v3c0 5.2-3.9 8.8-8.5 8.8S3.5 15.2 3.5 10z"/><path d="M8.6 18.2c.4-2.6 1.6-4 3.4-4s3 1.4 3.4 4"/><path d="M3.5 10.2h2.6M17.9 10.2h2.6"/>'],
  pouch: [STROKE, '<path d="M7 3.5h10v3.2l1.6 2.6v9.9a1.8 1.8 0 0 1-1.8 1.8H7.2a1.8 1.8 0 0 1-1.8-1.8V9.3L7 6.7z"/><path d="M7 6.7h10"/><path d="M9 13.5h3"/>'],
  fridge: [STROKE, '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M6 10h12M9 6v1.5M9 13v2.5"/>'],
  snow: [STROKE, '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.8 4.8L12 6.7l2.2-1.9M9.8 19.2L12 17.3l2.2 1.9"/>'],
  thaw: [STROKE, '<path d="M12 3.5s5 5.4 5 9a5 5 0 0 1-10 0c0-3.6 5-9 5-9z"/><path d="M4 20.5c1.3-.9 2.7-.9 4 0s2.7.9 4 0 2.7-.9 4 0 2.7.9 4 0"/>'],
  spark: [STROKE, '<path d="M12 3.2l1.8 5.1 5.2 1.8-5.2 1.8L12 17l-1.8-5.1L5 10.1l5.2-1.8z"/><path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>'],
  camera: [STROKE, '<path d="M4.5 8.2h3l1.6-2.4h5.8l1.6 2.4h3a1.5 1.5 0 0 1 1.5 1.5v8.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9.7a1.5 1.5 0 0 1 1.5-1.5z"/><circle cx="12" cy="13.4" r="3.4"/>'],
  // diaper-type glyphs: shape, not color, carries the meaning (DESIGN §11)
  wet: ['fill="none" stroke="currentColor" stroke-width="2.2"', '<circle cx="12" cy="12" r="5.5"/>'],
  dirty: ['fill="currentColor"', '<circle cx="12" cy="12" r="5.5"/>'],
  both: ['fill="none"', '<circle cx="12" cy="12" r="6.5" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>'],

  // ---- navigation ----
  home: [STROKE, '<path d="M4 10.4L12 4l8 6.4v8.4a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.8z"/><path d="M9.5 20.5v-5.2h5v5.2"/>'],
  timeline: [STROKE, '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.3"/><circle cx="4.8" cy="12" r="1.3"/><circle cx="4.8" cy="17.5" r="1.3"/>'],
  book: [STROKE, '<path d="M5 19.5V4.6A1.6 1.6 0 0 1 6.6 3H19v15H6.6A1.6 1.6 0 0 0 5 19.5a1.6 1.6 0 0 0 1.6 1.5H19"/><path d="M10 3v6.2l2-1.4 2 1.4V3"/>'],
  plus: [STROKE, '<path d="M12 5v14M5 12h14"/>'],
  'plus-bold': [STROKE.replace('1.75', '2.25'), '<path d="M12 5v14M5 12h14"/>'],
  minus: [STROKE, '<path d="M5 12h14"/>'],
  close: [STROKE, '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'],
  'chev-r': [STROKE, '<path d="M9.5 6l6 6-6 6"/>'],
  'chev-l': [STROKE, '<path d="M14.5 6l-6 6 6 6"/>'],
  'chev-d': [STROKE, '<path d="M6 9.5l6 6 6-6"/>'],
  'chev-u': [STROKE, '<path d="M6 14.5l6-6 6 6"/>'],
  gear: [STROKE, '<path d="M10.3 3.5h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.7 1.6v1.8l1.7 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.7-1.6v-1.8L4.3 8.8 6 5.9l2.2.8 1.6-.9z"/><circle cx="12" cy="12" r="2.6"/>'],
  grip: ['fill="currentColor"', '<circle cx="9" cy="6.5" r="1.35"/><circle cx="15" cy="6.5" r="1.35"/><circle cx="9" cy="12" r="1.35"/><circle cx="15" cy="12" r="1.35"/><circle cx="9" cy="17.5" r="1.35"/><circle cx="15" cy="17.5" r="1.35"/>'],

  // ---- actions ----
  check: [STROKE, '<path d="M5.5 12.5l4.2 4.2 8.8-9"/>'],
  undo: [STROKE, '<path d="M9 14.5L4.5 10 9 5.5"/><path d="M4.5 10h9.2a5.8 5.8 0 0 1 0 11.6H11"/>'],
  share: [STROKE, '<path d="M12 15V3.8M7.8 7.6L12 3.5l4.2 4.1"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6.5a1.5 1.5 0 0 0-1.5-1.5H16"/>'],
  download: [STROKE, '<path d="M12 3.8V15M7.8 10.9L12 15l4.2-4.1"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>'],
  upload: [STROKE, '<path d="M12 15V3.8M7.8 7.9L12 3.8l4.2 4.1"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>'],
  trash: [STROKE, '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4.7a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2v1.8"/><path d="M6.5 6.5l.8 12.3a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7l.8-12.3"/><path d="M10.2 10.5v6M13.8 10.5v6"/>'],
  edit: [STROKE, '<path d="M14.6 5.4l4 4L8.8 19.2l-4.8.8.8-4.8z"/><path d="M12.8 7.2l4 4"/>'],
  pause: [STROKE, '<path d="M9 6v12M15 6v12"/>'],
  play: [STROKE, '<path d="M8 5.5v13l10-6.5z"/>'],
  stop: [STROKE, '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'],
  more: ['fill="currentColor"', '<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>'],

  // ---- info + settings ----
  clock: [STROKE, '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
  calendar: [STROKE, '<rect x="4" y="5.5" width="16" height="15" rx="2.2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="M8 14h2M14 14h2M8 17h2"/>'],
  report: [STROKE, '<path d="M8.5 4.5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-1.5"/><rect x="8.5" y="3" width="7" height="3.2" rx="1.2"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>'],
  shield: [STROKE, '<path d="M12 3.2l7 2.8v5.6c0 4.4-3 7.9-7 9.2-4-1.3-7-4.8-7-9.2V6z"/><path d="M9 12.2l2.1 2.1 4-4.1"/>'],
  lock: [STROKE, '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/>'],
  phone: [STROKE, '<rect x="7" y="2.8" width="10" height="18.4" rx="2.4"/><path d="M11 18h2"/>'],
  motion: [STROKE, '<circle cx="15" cy="12" r="5"/><path d="M3.5 9h4M2.5 12h5M3.5 15h4"/>'],
  bell: [STROKE, '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'],
  sound: [STROKE, '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'],
  info: [STROKE, '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.2"/>'],
  baby: [STROKE, '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 13.8c.7.9 1.7 1.4 2.8 1.4s2.1-.5 2.8-1.4"/><path d="M9.3 10.3v.1M14.7 10.3v.1"/><path d="M12 3.5c-1.5 1.2-1.6 2.9-.2 3.6"/>'],
  photo: [STROKE, '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 16l-5-5-8.5 8"/>'],
};

// Friendly aliases so call sites can use the concept's name.
const ALIASES = {
  sleep: 'moon', asleep: 'moon', nap: 'moon', wake: 'sun', awake: 'sun',
  stash: 'pouch', freezer: 'snow', snowflake: 'snow', deepFreezer: 'snow',
  memory: 'spark', memories: 'spark', milestone: 'spark', sparkle: 'spark',
  today: 'home', feed: 'bottle', breastfeed: 'breast', breastfeeding: 'breast',
  x: 'close', 'chevron-right': 'chev-r', 'chevron-left': 'chev-l', 'chevron-down': 'chev-d', 'chevron-up': 'chev-u',
  settings: 'gear', drag: 'grip', 'drag-handle': 'grip', export: 'share', import: 'upload',
  delete: 'trash', pencil: 'edit', avatar: 'baby', privacy: 'shield',
};

/** Every icon name (aliases excluded), for tests and docs. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/**
 * Does an icon (or alias) exist?
 * @param {string} name
 * @returns {boolean}
 */
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, ALIASES[name] || name);
}

/**
 * Inline SVG markup for an icon. Wrap it in raw() inside html``, or use
 * iconHtml(). Unknown names render an empty 24×24 box (and warn once) so a
 * typo never breaks a whole view.
 * @param {string} name icon name or alias (see ICON_NAMES)
 * @param {{ size?: number, className?: string }} [opts] size in px (default 24;
 *   DESIGN sizes: 14 badges · 18 inline · 20 labels/tiles · 22 rows/pill ·
 *   24 default · 26 tabs · 30 the +)
 * @returns {string}
 */
export function icon(name, { size = 24, className = '' } = {}) {
  const key = ALIASES[name] || name;
  const def = Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : null;
  if (!def) warnOnce(name);
  // Both inputs end up inside markup we return as trusted, so validate them
  // instead of escaping: a number and a plain class list.
  const px = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 24;
  const extra = /^[\w -]*$/.test(String(className)) ? ` ${String(className).trim()}` : '';
  const [attrs, inner] = def || [STROKE, ''];
  return `<svg class="ic ic-${def ? key : 'missing'}${extra.trimEnd()}" width="${px}" height="${px}" viewBox="0 0 24 24" ${attrs} aria-hidden="true" focusable="false">${inner}</svg>`;
}

/**
 * icon() already wrapped in raw(), for direct use inside html``.
 * @param {string} name
 * @param {{ size?: number, className?: string }} [opts]
 * @returns {import('./html.js').SafeHTML}
 */
export function iconHtml(name, opts) {
  return raw(icon(name, opts));
}

/**
 * The icon for an event type or category, aware of the event's details:
 * breastfeeding → breast, running/finished sleep → moon, stash → pouch.
 * @param {string|object} typeOrEvent 'feed'|'pump'|'sleep'|'diaper'|'milestone'|'stash' or an event
 * @returns {string} icon name
 */
export function categoryIcon(typeOrEvent) {
  const type = typeof typeOrEvent === 'string' ? typeOrEvent : typeOrEvent && typeOrEvent.type;
  const data = typeof typeOrEvent === 'object' && typeOrEvent ? typeOrEvent.data || {} : {};
  switch (type) {
    case 'feed': return data.method === 'breast' ? 'breast' : 'bottle';
    case 'breast': case 'breastfeeding': return 'breast';
    case 'bottle': case 'formula': return 'bottle';
    case 'pump': return 'pump';
    case 'sleep': return 'moon';
    case 'diaper': return 'diaper';
    case 'milestone': case 'memory': case 'memories': case 'mem': return 'spark';
    case 'stash': return 'pouch';
    default: return 'spark';
  }
}

/**
 * The diaper-type glyph name for a diaper kind (ring / dot / ring+dot).
 * @param {'wet'|'dirty'|'both'|'dry'|string} kind
 * @returns {string}
 */
export function diaperGlyph(kind) {
  return kind === 'dirty' ? 'dirty' : kind === 'both' ? 'both' : 'wet';
}

const warned = new Set();
function warnOnce(name) {
  if (warned.has(name)) return;
  warned.add(name);
  if (typeof console !== 'undefined') console.warn(`icons: unknown icon "${name}"`);
}

/** The icons API as one object, for ctx injection (ARCHITECTURE §5.2). */
export const icons = Object.freeze({ icon, iconHtml, categoryIcon, diaperGlyph, hasIcon, ICON_NAMES });
