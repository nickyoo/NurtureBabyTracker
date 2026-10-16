// Computes WCAG 2.1 contrast for every token pair Nurture uses, read straight from css/tokens.css.
import { readFileSync } from 'node:fs';
const css = readFileSync(process.argv[2] || '/home/user/NurtureBabyTracker/css/tokens.css', 'utf8');
function block(selStart) {
  const i = css.indexOf(selStart); const open = css.indexOf('{', i); let depth = 0, j = open;
  for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (!depth) break; } }
  const body = css.slice(open + 1, j).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = {}; for (const d of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) m[d[1]] = d[2].trim(); return m;
}
const light = block(':root,\n[data-theme="light"]');
const dark = { ...light, ...block(':root[data-theme="dark"],') };
const parse = (v, map, depth = 0) => {
  v = v.trim(); const r = v.match(/^var\(--([\w-]+)\)$/); if (r) return parse(map[r[1]], map, depth + 1);
  if (v.startsWith('#')) { const h = v.slice(1); return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)).concat(1); }
  const a = v.match(/rgba?\(([^)]+)\)/); if (a) { const p = a[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error('cannot parse ' + v);
};
const blend = (fg, bg) => fg[3] >= 1 ? fg : [0, 1, 2].map(k => fg[k] * fg[3] + bg[k] * (1 - fg[3])).concat(1);
const lum = c => { const [r, g, b] = c.slice(0, 3).map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = c => '#' + c.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
// [fg, bg, use, target, base-under-bg (for translucent bg)]
const cats = ['feed', 'sleep', 'diaper', 'pump', 'mem'];
const P = [
  ['text', 'bg', 'Primary text, titles', 4.5], ['text', 'surface', 'Card + row text', 4.5], ['text', 'surface-2', 'Field values, secondary button label', 4.5],
  ['text', 'sheet-bg', 'Sheet text', 4.5], ['text', 'band', 'Strip labels over the night band', 4.5],
  ['text-2', 'bg', 'Secondary text on page', 4.5], ['text-2', 'surface', 'Row meta', 4.5], ['text-2', 'surface-2', 'Field labels, time chip', 4.5], ['text-2', 'sheet-bg', 'Sheet hints', 4.5],
  ['text-3', 'bg', 'Tertiary: eyebrow, AM/PM, axis', 4.5], ['text-3', 'surface', 'AM/PM in rows, axis labels', 4.5], ['text-3', 'nav-bg', 'Inactive tab label', 4.5], ['text-3', 'sheet-bg', 'Sheet tertiary', 4.5],
  ['accent-ink', 'bg', 'Links, wordmark, eyebrow accent', 4.5], ['accent-ink', 'surface', 'Ghost buttons on cards', 4.5], ['accent-ink', 'accent-soft', 'Use-next tag, photo-picker label', 4.5], ['accent-ink', 'sheet-bg', 'Links in sheets', 4.5],
  ['on-primary', 'primary-bg', 'Primary button label', 4.5], ['on-primary', 'primary-press', 'Primary pressed label', 4.5],
  ['on-fab', 'fab-bg', '+ glyph (2.25px stroke, non-text)', 3], ['fab-bg', 'nav-bg', '+ disc vs nav (UI)', 3],
  ['accent', 'nav-bg', 'Active tab icon (UI)', 3], ['accent', 'surface', 'Toggle-on track, now-line (UI)', 3], ['accent', 'surface-2', 'Now-line over strip track (UI)', 3], ['accent', 'band', 'Now-line over night band (UI)', 3],
  ['line-strong', 'surface', 'Off toggle: outline + knob on a --surface track; input border (UI)', 3], ['toggle-on', 'surface', 'Toggle-on track vs row (UI)', 3], ['toggle-on', 'sheet-bg', 'Toggle-on track in sheets (UI)', 3], ['knob', 'toggle-on', 'Knob vs on-track (UI)', 3], ['text', 'accent-soft', 'Text on accent tint (picker, privacy chip)', 4.5], ['line-strong', 'sheet-bg', 'Input border in sheets (UI)', 3],
  ['pill-text', 'pill-bg', 'Live pill title + timer', 4.5], ['pill-text-2', 'pill-bg', 'Live pill sub-line', 4.5], ['pill-btn-text', 'pill-btn-bg', 'Finish button label', 4.5],
  ['pill-btn-bg', 'pill-bg', 'Finish button edge vs pill (UI)', 3, null, 'light-only'],
  ['pill-feed', 'pill-bg', 'Pill icon / ring / Undo (feed)', 4.5], ['pill-feed', 'pill-well', 'Pill icon in its well', 3], ['pill-sleep', 'pill-bg', 'Pill icon (sleep)', 3], ['pill-pump', 'pill-bg', 'Pill icon (pump)', 3], ['pill-warn', 'pill-bg', 'Pill warning sub-line', 4.5],
  ['pill-bg', 'bg', 'Pill vs page (UI boundary)', 3, null, 'light-only'],
  ['warn-ink', 'warn-tint', 'Expiry-soon / due badge', 4.5], ['ok-ink', 'ok-tint', 'Fresh badge', 4.5], ['danger-ink', 'danger-tint', 'Expired badge, soft destructive', 4.5], ['danger-ink', 'surface', 'Destructive text on cards', 4.5], ['on-danger', 'danger-ink', 'Filled destructive (confirm sheet)', 4.5],
];
for (const c of cats) {
  P.push([`${c}-ink`, `${c}-card`, `${c}: label word on since-last card`, 4.5]);
  P.push(['text', `${c}-card`, `${c}: numeral on card`, 4.5]);
  P.push(['text-2', `${c}-card`, `${c}: detail line + unit on card`, 4.5]);
  P.push([`${c}-ink`, `${c}-well`, `${c}: icon in card well (UI)`, 3, `${c}-card`]);
  P.push([`${c}-ink`, `${c}-tint`, `${c}: icon/label on tint (chips, tiles, wells in rows)`, 4.5]);
  P.push(['text', `${c}-tint`, `${c}: text on tint (live card, tiles, stat tiles)`, 4.5]);
  P.push(['text-2', `${c}-tint`, `${c}: secondary text on tint`, 4.5]);
  P.push([`${c}-ink`, 'surface', `${c}: icon/word on neutral surface`, 4.5]);
  P.push([`${c}-ink`, 'sheet-bg', `${c}: icon/word in sheet`, 4.5]);
  P.push([`${c}-mid`, 'surface-2', `${c}: strip mark on lane track (UI)`, 3]);
  P.push([`${c}-mid`, 'band', `${c}: strip mark over night band (UI)`, 3]);
  P.push([`${c}-mid`, 'surface', `${c}: graphic on card, goal bar (UI)`, 3]);
}
P.push(['pump-mid', 'track-on-card', 'pump: goal-bar fill vs its track (UI)', 3, 'pump-card']);
const out = []; let fails = 0;
const row = (map, p) => {
  const [f, b, , , base] = p; let bg = parse(map[b], map);
  if (bg[3] < 1) bg = blend(bg, parse(map[base] ?? map['surface'], map));
  if (base && b.endsWith('-well')) bg = blend(parse(map[b], map), parse(map[base], map));
  const fg = blend(parse(map[f], map), bg); return { fg, bg, r: ratio(fg, bg) };
};
out.push('| Pair (fg on bg) | Used for | Target | Light | Dark |', '|---|---|---|---|---|');
for (const p of P) {
  const L = row(light, p), D = row(dark, p); const t = p[3];
  const onlyL = p[5] === 'light-only';
  const cell = (x, skip) => skip ? 'n/a (dark: ring + luminance step)' : `${hex(x.fg)} / ${hex(x.bg)} **${x.r.toFixed(2)}**${x.r >= t ? '' : ' FAIL'}`;
  if (L.r < t) fails++; if (!onlyL && D.r < t) fails++;
  out.push(`| \`${p[0]}\` on \`${p[1]}\` | ${p[2]} | ${t}:1 | ${cell(L)} | ${cell(D, onlyL)} |`);
}
console.log(out.join('\n'));
console.error('pairs', P.length, 'fails', fails);
