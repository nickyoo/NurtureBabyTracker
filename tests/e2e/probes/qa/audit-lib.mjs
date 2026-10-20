// In-page a11y audit: small targets, small text, missing names, low contrast.
export const auditFn = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return false; if (el.closest('[inert],[aria-hidden="true"]') && !el.closest('.sheet-layer:last-child')) return false; if (el.closest('.sr-only, .sr-only-focusable, .visually-hidden')) return false; return true; };
  const top = [...document.querySelectorAll('.sheet-layer')].pop();
  const scope = top || document.body;
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = (el) => { const layers = []; let e = el; while (e && e.nodeType === 1) { const cs = getComputedStyle(e); const c = parse(cs.backgroundColor); if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null; if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } e = e.parentElement; } let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; for (const l of layers.reverse()) base = blend(l, base); return base; };
  const effOpacity = (el) => { let o = 1; let e = el; while (e && e.nodeType === 1) { o *= +getComputedStyle(e).opacity; e = e.parentElement; } return o; };
  const name = (el) => { const l = el.getAttribute('aria-label'); if (l) return l.trim(); const lb = el.getAttribute('aria-labelledby'); if (lb) return lb.split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ').trim(); if (el.id) { const lab = document.querySelector(`label[for="${el.id}"]`); if (lab) return lab.textContent.trim(); } const wrap = el.closest('label'); if (wrap) return wrap.textContent.trim(); if (el.title) return el.title; return (el.textContent || el.value || el.alt || '').trim(); };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(name(el) || '').replace(/\s+/g, ' ').slice(0, 40)}"`;
  const out = { small: [], noname: [], tinyText: [], lowContrast: [], divClick: [] };
  for (const el of scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=switch], [role=button], [role=tab], [role=radio], [role=slider], [tabindex]:not([tabindex="-1"])')) {
    if (!vis(el)) continue;
    if (top === undefined && el.closest('.sheet-layer')) continue;
    const r = el.getBoundingClientRect();
    // honour a ::before/::after hit extender with inset negative
    let w = r.width, h = r.height;
    for (const pse of ['::before', '::after']) { const cs = getComputedStyle(el, pse); if (cs.content !== 'none' && cs.position === 'absolute') { const t = parseFloat(cs.top), b = parseFloat(cs.bottom), lft = parseFloat(cs.left), rt = parseFloat(cs.right); if (!isNaN(t) && !isNaN(b) && t < 0) h = Math.max(h, r.height - t - b); if (!isNaN(lft) && !isNaN(rt) && lft < 0) w = Math.max(w, r.width - lft - rt); } }
    if ((w < 43.5 || h < 43.5) && el.type !== 'radio' && el.type !== 'checkbox') out.small.push(`${desc(el)} ${Math.round(w)}x${Math.round(h)}`);
    if (!name(el) && el.tagName !== 'INPUT') out.noname.push(desc(el));
    if (el.tagName === 'INPUT' && !name(el) && !el.getAttribute('aria-labelledby')) out.noname.push(desc(el) + ' (input)');
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (!top && el.closest('.sheet-layer')) continue;
    if (!vis(el) || el.closest('svg, script, style, noscript')) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 12) out.tinyText.push(`${desc(el)} "${t.textContent.trim().slice(0, 30)}" ${fs}px`);
    const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
    const o = effOpacity(el); if (o < 0.99) continue; // disabled/faded handled separately
    if (el.closest('[aria-disabled="true"], :disabled')) continue;
    const c = blend(fg, bg); const L1 = lum(c), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) out.lowContrast.push(`${desc(el)} "${t.textContent.trim().slice(0, 28)}" ${ratio.toFixed(2)} fs${fs} fw${cs.fontWeight} fg${cs.color} bg rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
  }
  return out;
};
