// Safe HTML templating (ARCHITECTURE §5.1).
//
//   import { html, raw, render } from '../ui/html.js';
//   render(el, html`<li class="row ${cls}">${event.note}</li>`);
//
// Why a tagged template and not DOM builders: views are mostly static markup
// with a few holes, and a template reads like the mockup it came from. The
// tag makes the safe thing the default — EVERY interpolation is escaped —
// so a baby name like `<img onerror=…>` or a hostile import can never become
// markup. The only way to inject markup is an explicit raw(), reserved for
// our own static SVG icons (icons.js).
//
// The tag also knows WHERE each hole sits (text, quoted attribute, unquoted
// attribute, attribute-name position) so it can:
//  - quote unquoted attribute values (`class=${x}` can't smuggle extra attrs),
//  - neutralise javascript:/vbscript:/data:text URLs in href/src/action,
//  - refuse holes in on* handlers and style="" (CSP forbids both anyway; a
//    loud error in development beats a silently dead button in production).
//
// No DOM access at import time, so it unit-tests under plain Node.

const SAFE = Symbol('nurture.safeHtml');

/** A string of markup the template system has vouched for. */
class SafeHTML {
  /** @param {string} s */
  constructor(s) {
    this[SAFE] = true;
    this.value = s;
  }

  toString() {
    return this.value;
  }
}

/**
 * Is this value already-safe markup (from html`` or raw())?
 * @param {unknown} v
 * @returns {v is SafeHTML}
 */
export function isSafeHTML(v) {
  return v instanceof SafeHTML || (v !== null && typeof v === 'object' && v[SAFE] === true);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };

/**
 * Escape text for use in HTML text OR a quoted attribute value. Also escapes
 * ` and = so an escaped value is inert even if someone later drops the quotes.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHTML(value) {
  return String(value).replace(/[&<>"'`=]/g, ch => ESCAPES[ch]);
}

/**
 * Opt out of escaping. ONLY for markup we wrote ourselves (static SVG icons).
 * Never pass user data, imported data or anything from storage through this.
 * @param {string|SafeHTML} markup
 * @returns {SafeHTML}
 */
export function raw(markup) {
  if (isSafeHTML(markup)) return markup;
  return new SafeHTML(markup === null || markup === undefined ? '' : String(markup));
}

// Attributes whose value is a URL that a browser may navigate to or load.
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'srcset', 'background', 'cite', 'data']);
// Schemes we allow at the very start of a URL hole. Relative URLs, fragments
// and query-only URLs have no scheme and are always fine.
const SAFE_URL = /^(?:(?:https?|mailto|tel|blob):|data:image\/(?:png|jpe?g|gif|webp|avif);base64,|[^:/?#]*(?:[/?#]|$))/i;
const UNSAFE_URL_REPLACEMENT = 'about:invalid#nurture-unsafe-url';

/**
 * Make a URL safe to put in href/src: keeps http(s), mailto, tel, blob,
 * image data URLs and relative URLs; anything else (javascript:, vbscript:,
 * data:text/html…) becomes an inert about:invalid URL.
 * @param {unknown} url
 * @returns {string}
 */
export function safeUrl(url) {
  // Browsers ignore leading whitespace/control chars and embedded tabs/newlines
  // in schemes ("java\tscript:"), so test the URL the way the browser sees it.
  // eslint-disable-next-line no-control-regex
  const s = String(url).replace(/^[\u0000- ]+/, '').replace(/[\t\n\r]/g, '');
  return SAFE_URL.test(s) ? s : UNSAFE_URL_REPLACEMENT;
}

// ------------------------------------------------------------- context scan

// States of a tiny HTML tokenizer: just enough to know what kind of hole
// each interpolation is. Our templates are hand-written, so we don't need
// the full HTML5 state machine — only text / tag / quoted value / comment.
const TEXT = 0;
const TAG = 1;
const DQ = 2;
const SQ = 3;
const COMMENT = 4;

/**
 * Walk one static chunk, updating the scanner state.
 * @param {{ state: number, tag: string }} st `tag` accumulates the source of
 *   the current tag (static text + hole placeholders) so attribute names can
 *   be recovered when a hole is reached.
 * @param {string} chunk
 */
function scan(st, chunk) {
  for (let i = 0; i < chunk.length; i += 1) {
    const ch = chunk[i];
    switch (st.state) {
      case TEXT:
        if (ch === '<') {
          if (chunk.startsWith('!--', i + 1)) { st.state = COMMENT; i += 3; } else if (/[A-Za-z/!?]/.test(chunk[i + 1] || '')) { st.state = TAG; st.tag = ''; }
        }
        break;
      case TAG:
        st.tag += ch;
        if (ch === '"') st.state = DQ;
        else if (ch === "'") st.state = SQ;
        else if (ch === '>') st.state = TEXT;
        break;
      case DQ:
        st.tag += ch;
        if (ch === '"') st.state = TAG;
        break;
      case SQ:
        st.tag += ch;
        if (ch === "'") st.state = TAG;
        break;
      case COMMENT:
        if (ch === '-' && chunk.startsWith('-->', i)) { st.state = TEXT; i += 2; }
        break;
      default:
        break;
    }
  }
}

// Name of the attribute whose (quoted) value we're inside, plus whether the
// hole is at the very start of that value.
function quotedAttr(tagSrc) {
  const m = /([^\s"'<>/=]+)\s*=\s*(["'])([^"']*)$/.exec(tagSrc);
  return m ? { name: m[1].toLowerCase(), atStart: m[3] === '' } : { name: '', atStart: false };
}

// Name of the attribute for an UNQUOTED hole (`name=${x}`), or null when
// the hole sits in attribute-name position (`<button ${x}>`).
function unquotedAttr(tagSrc) {
  const m = /([^\s"'<>/=]+)\s*=\s*$/.exec(tagSrc);
  return m ? m[1].toLowerCase() : null;
}

function isForbiddenAttr(name) {
  // Event handlers would execute the escaped text as JS (CSP blocks them, but
  // fail loudly instead of shipping a dead control); style="" is blocked by
  // our CSP — use classes or el.style.setProperty('--x', …).
  return name.startsWith('on') || name === 'style' || name === 'srcdoc';
}

// ------------------------------------------------------------ interpolation

function flatten(value, out) {
  if (value === null || value === undefined || value === false) return;
  if (Array.isArray(value)) {
    for (const v of value) flatten(v, out);
    return;
  }
  out.push(value);
}

// Text-context rendering: arrays concatenate, SafeHTML passes through,
// null/undefined/false render nothing, everything else is escaped.
function textValue(value) {
  const parts = [];
  flatten(value, parts);
  let s = '';
  for (const p of parts) s += isSafeHTML(p) ? p.value : escapeHTML(p);
  return s;
}

// Attribute-context rendering: arrays join with a space (handy for class
// lists), and SafeHTML is escaped too — markup has no business in an
// attribute value, and escaping keeps the quotes balanced.
function attrValue(value) {
  const parts = [];
  flatten(value, parts);
  return parts.map(p => (isSafeHTML(p) ? p.value : String(p))).join(' ');
}

/**
 * Tagged template that escapes every interpolation. Returns SafeHTML (use
 * render() to put it in the DOM, or nest it inside another html``).
 *  - text holes: escaped; arrays of templates concatenate; null/undefined/
 *    false render nothing; numbers render as-is (0 included).
 *  - quoted attribute holes: escaped (quotes included); arrays join with ' '.
 *  - unquoted attribute holes (`class=${x}`): quoted automatically.
 *  - URL attributes (href, src, action…): unsafe schemes are neutralised.
 *  - attribute-name holes (`<input ${attrs}>`): only plain attribute names
 *    (e.g. 'disabled', 'hidden checked') or raw() markup are accepted.
 *  - holes in on*="" handlers or style="" throw a TypeError.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHTML}
 */
export function html(strings, ...values) {
  const st = { state: TEXT, tag: '' };
  let out = '';
  for (let i = 0; i < strings.length; i += 1) {
    const chunk = strings[i];
    out += chunk;
    scan(st, chunk);
    if (i >= values.length) break;
    const value = values[i];

    if (st.state === TEXT || st.state === COMMENT) {
      out += textValue(value);
      continue;
    }

    if (st.state === DQ || st.state === SQ) {
      const { name, atStart } = quotedAttr(st.tag);
      if (isForbiddenAttr(name)) throw new TypeError(`html: interpolation in ${name}="" is not allowed`);
      let v = attrValue(value);
      if (atStart && URL_ATTRS.has(name)) v = safeUrl(v);
      const escaped = escapeHTML(v);
      out += escaped;
      st.tag += 'x'; // placeholder so later regexes see a non-empty value
      continue;
    }

    // TAG state: either `name=${x}` (unquoted value) or `<el ${x}>`.
    const name = unquotedAttr(st.tag);
    if (name !== null) {
      if (isForbiddenAttr(name)) throw new TypeError(`html: interpolation in ${name}= is not allowed`);
      let v = attrValue(value);
      if (URL_ATTRS.has(name)) v = safeUrl(v);
      out += `"${escapeHTML(v)}"`;
      st.tag += '"x"';
      continue;
    }
    if (value === null || value === undefined || value === false || value === '') continue;
    if (isSafeHTML(value)) { out += value.value; st.tag += value.value; continue; }
    const s = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    if (!/^[A-Za-z_:][\w:.-]*(\s+[A-Za-z_:][\w:.-]*)*$/.test(s.trim())) {
      throw new TypeError('html: only bare attribute names may be interpolated in tag position');
    }
    if (s.trim().split(/\s+/).some(isForbiddenAttr)) throw new TypeError('html: on*/style attributes are not allowed');
    out += s.trim();
    st.tag += s;
  }
  return new SafeHTML(out);
}

/**
 * Join a class list, skipping falsy entries; objects map class → condition.
 *   cls('row', live && 'is-live', { 'is-new': fresh }) → 'row is-live is-new'
 * The result is plain text — interpolate it into class="…" (escaped there).
 * @param {...(string|false|null|undefined|Record<string, unknown>)} parts
 * @returns {string}
 */
export function cls(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'object') {
      for (const [k, on] of Object.entries(p)) if (on) out.push(k);
    } else {
      out.push(String(p));
    }
  }
  return out.join(' ');
}

/**
 * Put a template into the DOM, replacing the target's children. This is the
 * ONLY sanctioned innerHTML write in the app. Plain strings are treated as
 * text (escaped), arrays of templates concatenate, null clears the target.
 * @param {Element|DocumentFragment|{innerHTML: string}} target
 * @param {SafeHTML|SafeHTML[]|string|null|undefined} template
 * @returns {typeof target}
 */
export function render(target, template) {
  if (!target) throw new TypeError('render: no target element');
  const markup = isSafeHTML(template) ? template.value : textValue(template);
  // eslint-disable-next-line no-param-reassign -- the one place innerHTML is set
  target.innerHTML = markup;
  return target;
}

/**
 * Parse a template into a DocumentFragment (for insertBefore/append without
 * replacing siblings). Browser-only.
 * @param {SafeHTML|SafeHTML[]|string} template
 * @returns {DocumentFragment}
 */
export function fragment(template) {
  const t = document.createElement('template');
  render(t, template);
  return t.content;
}

/**
 * Parse a template that has ONE root element and return that element.
 * Browser-only.
 * @param {SafeHTML} template
 * @returns {Element|null}
 */
export function element(template) {
  return fragment(template).firstElementChild;
}
