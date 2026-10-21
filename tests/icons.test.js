// icons.js: every icon the screens need exists, renders as inert inline SVG,
// and its options can't smuggle markup (the output is trusted via raw()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon, iconHtml, categoryIcon, diaperGlyph, hasIcon, ICON_NAMES } from '../js/ui/icons.js';
import { isSafeHTML } from '../js/ui/html.js';

// Everything the mockup + the foundation brief use (names or aliases).
const REQUIRED = [
  'bottle', 'breast', 'pump', 'sleep', 'moon', 'wake', 'sun', 'diaper', 'stash', 'pouch', 'fridge', 'snowflake',
  'memory', 'sparkle', 'camera', 'today', 'timeline', 'plus', 'plus-bold', 'close', 'chev-l', 'chev-r', 'chev-d', 'chev-u',
  'gear', 'check', 'undo', 'share', 'download', 'upload', 'trash', 'edit', 'lock', 'shield', 'calendar', 'report',
  'grip', 'drag-handle', 'baby', 'avatar', 'book', 'home', 'thaw', 'clock', 'wet', 'dirty', 'both', 'motion', 'phone', 'export',
];

test('every required icon (or alias) exists', () => {
  const missing = REQUIRED.filter((n) => !hasIcon(n));
  assert.deepEqual(missing, []);
});

test('icons are aria-hidden, unfocusable 24-grid SVGs in currentColor', () => {
  for (const name of ICON_NAMES) {
    const svg = icon(name);
    assert.match(svg, /^<svg class="ic ic-[\w-]+" width="24" height="24" viewBox="0 0 24 24" /, name);
    assert.match(svg, /aria-hidden="true" focusable="false">/, name);
    assert.ok(svg.endsWith('</svg>'), name);
    assert.ok(/currentColor/.test(svg), `${name} uses currentColor`);
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(svg), `${name} has no hard-coded color`);
    assert.ok(!/<script|on\w+=|style=/i.test(svg), `${name} is inert`);
  }
});

test('size and className are validated, never interpolated raw', () => {
  assert.match(icon('bottle', { size: 20 }), /width="20" height="20"/);
  assert.match(icon('bottle', { size: '"><script>' }), /width="24" height="24"/);
  assert.match(icon('bottle', { size: -3 }), /width="24"/);
  assert.match(icon('bottle', { className: 'big ic-s' }), /class="ic ic-bottle big ic-s"/);
  assert.ok(!icon('bottle', { className: '"><img src=x onerror=1>' }).includes('<img'));
});

test('unknown names render an empty box instead of throwing', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.match(icon('no-such-icon'), /class="ic ic-missing"[^>]*><\/svg>$/);
  } finally { console.warn = warn; }
});

test('iconHtml wraps in raw() for html``', () => {
  assert.ok(isSafeHTML(iconHtml('plus')));
});

test('categoryIcon and diaperGlyph pick one metaphor per concept', () => {
  assert.equal(categoryIcon('feed'), 'bottle');
  assert.equal(categoryIcon({ type: 'feed', data: { method: 'breast' } }), 'breast');
  assert.equal(categoryIcon({ type: 'feed', data: { method: 'bottle' } }), 'bottle');
  assert.equal(categoryIcon('pump'), 'pump');
  assert.equal(categoryIcon('sleep'), 'moon');
  assert.equal(categoryIcon('diaper'), 'diaper');
  assert.equal(categoryIcon('milestone'), 'spark');
  assert.equal(categoryIcon('stash'), 'pouch');
  assert.equal(diaperGlyph('wet'), 'wet');
  assert.equal(diaperGlyph('dirty'), 'dirty');
  assert.equal(diaperGlyph('both'), 'both');
  assert.equal(diaperGlyph('dry'), 'wet');
});
