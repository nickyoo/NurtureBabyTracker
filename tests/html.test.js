// html`` tagged template: escaping in every context (ARCHITECTURE §5.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, render, escapeHTML, isSafeHTML, safeUrl, cls } from '../js/ui/html.js';

const s = t => String(t);

test('text holes are escaped (classic XSS payloads)', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg onload=alert(1)>',
    "'><iframe src=javascript:alert(1)>",
    '<!-- --><b>x</b>',
    '&lt;already&gt;',
  ];
  for (const p of payloads) {
    const out = s(html`<p>${p}</p>`);
    assert.ok(!/<(script|img|svg|iframe|b)\b/i.test(out.slice(3, -4)), `unescaped markup for ${p}: ${out}`);
    assert.ok(!out.slice(3, -4).includes('<'), out);
  }
  assert.equal(s(html`<p>${'a & b < c > d " e \' f'}</p>`), '<p>a &amp; b &lt; c &gt; d &quot; e &#39; f</p>');
  assert.equal(s(html`<p>${'&amp;'}</p>`), '<p>&amp;amp;</p>', 'escapes once more: text is text');
});

test('null / undefined / false render nothing; 0, numbers and true render', () => {
  assert.equal(s(html`<i>${null}${undefined}${false}</i>`), '<i></i>');
  assert.equal(s(html`<i>${0}</i>`), '<i>0</i>');
  assert.equal(s(html`<i>${4.5}</i>`), '<i>4.5</i>');
  assert.equal(s(html`<i>${-1}</i>`), '<i>-1</i>');
  assert.equal(s(html`<i>${true}</i>`), '<i>true</i>');
  assert.equal(s(html`<i>${NaN}</i>`), '<i>NaN</i>');
  assert.equal(s(html`<i>${''}</i>`), '<i></i>');
});

test('nested templates and arrays concatenate without double escaping', () => {
  const items = ['<a>', 'b&c'];
  const out = s(html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`);
  assert.equal(out, '<ul><li>&lt;a&gt;</li><li>b&amp;c</li></ul>');
  const deep = s(html`<div>${[[html`<b>1</b>`, ['<x>', [html`<i>${'<y>'}</i>`]]], null, false]}</div>`);
  assert.equal(deep, '<div><b>1</b>&lt;x&gt;<i>&lt;y&gt;</i></div>');
  assert.equal(s(html`<ul>${[]}</ul>`), '<ul></ul>');
});

test('quoted attribute holes escape quotes in both quote styles', () => {
  const evil = '" onmouseover="alert(1)';
  assert.equal(s(html`<div title="${evil}"></div>`), '<div title="&quot; onmouseover&#61;&quot;alert(1)"></div>');
  const evil2 = "' onfocus='alert(1)";
  assert.equal(s(html`<div title='${evil2}'></div>`), "<div title='&#39; onfocus&#61;&#39;alert(1)'></div>");
  // several holes in one attribute; arrays join with spaces
  assert.equal(s(html`<li class="row ${'cat-feed'} ${['is-live', false, 'x"y']}"></li>`), '<li class="row cat-feed is-live x&quot;y"></li>');
});

test('unquoted attribute holes are quoted so they cannot add attributes', () => {
  assert.equal(s(html`<div class=${'a onclick=alert(1)'}></div>`), '<div class="a onclick&#61;alert(1)"></div>');
  assert.equal(s(html`<input value=${'x>'}>`), '<input value="x&gt;">');
  assert.equal(s(html`<input value=${0}>`), '<input value="0">');
});

test('SafeHTML inside an attribute is still escaped', () => {
  assert.equal(s(html`<div title="${html`<b>"</b>`}"></div>`), '<div title="&lt;b&gt;&quot;&lt;/b&gt;"></div>');
});

test('URL attributes neutralise dangerous schemes', () => {
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'data:text/html,<script>', '\u0001javascript:x']) {
    const out = s(html`<a href="${bad}">x</a>`);
    assert.match(out, /href="about:invalid#nurture-unsafe-url"/, `${JSON.stringify(bad)} → ${out}`);
    assert.match(s(html`<a href=${bad}>x</a>`), /href="about:invalid/);
  }
  for (const ok of ['https://example.org/a?b=c', 'mailto:a@b.co', 'tel:+15551234', '#top', './x.html', '/abs', '?q=1', 'blob:http://x/uuid', 'data:image/png;base64,AAAA', 'icons/icon.svg']) {
    assert.ok(!s(html`<a href="${ok}">x</a>`).includes('about:invalid'), ok);
  }
  // A static prefix fixes the scheme, so later holes are only escaped.
  assert.equal(s(html`<a href="#/event/${'javascript:x'}">x</a>`), '<a href="#/event/javascript:x">x</a>');
  assert.equal(s(html`<img src="${'data:image/svg+xml;base64,AA'}">`), '<img src="about:invalid#nurture-unsafe-url">');
});

test('holes in event handlers and style="" throw', () => {
  assert.throws(() => html`<button onclick="${'x'}"></button>`, TypeError);
  assert.throws(() => html`<button onclick=${'x'}></button>`, TypeError);
  assert.throws(() => html`<div style="${'color:red'}"></div>`, TypeError);
  assert.throws(() => html`<div style="width: ${'1px'}"></div>`, TypeError);
  assert.throws(() => html`<iframe srcdoc="${'<b>'}"></iframe>`, TypeError);
});

test('attribute-name holes accept bare names only', () => {
  assert.equal(s(html`<button ${'disabled'}>x</button>`), '<button disabled>x</button>');
  assert.equal(s(html`<input ${['checked', false, 'required']}>`), '<input checked required>');
  assert.equal(s(html`<button ${false}>x</button>`), '<button >x</button>');
  assert.equal(s(html`<button ${null} class="a">x</button>`), '<button  class="a">x</button>');
  assert.throws(() => html`<button ${'onclick=alert(1)'}>x</button>`, TypeError);
  assert.throws(() => html`<button ${'x" y'}>x</button>`, TypeError);
  assert.throws(() => html`<button ${'onfocus'}>x</button>`, TypeError);
  assert.equal(s(html`<button ${raw('aria-pressed="true"')}>x</button>`), '<button aria-pressed="true">x</button>');
});

test('context tracking survives > inside quoted values and comments', () => {
  assert.equal(s(html`<div title="a>b" class="${'"'}">${'<'}</div>`), '<div title="a>b" class="&quot;">&lt;</div>');
  assert.equal(s(html`<!-- ${'-->'} --><p>${'<b>'}</p>`), '<!-- --&gt; --><p>&lt;b&gt;</p>');
  assert.equal(s(html`<p>1 < 2 and ${'<x>'}</p>`), '<p>1 < 2 and &lt;x&gt;</p>');
  // after a tag closes we're back in text
  assert.equal(s(html`<a href="#">${'javascript:x'}</a>`), '<a href="#">javascript:x</a>');
});

test('raw() passes markup through and is idempotent', () => {
  const svg = '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>';
  assert.equal(s(html`<span>${raw(svg)}</span>`), `<span>${svg}</span>`);
  const r = raw(svg);
  assert.equal(raw(r), r);
  assert.equal(s(raw(null)), '');
  assert.ok(isSafeHTML(r));
  assert.ok(isSafeHTML(html`x`));
  assert.ok(!isSafeHTML('x'));
  assert.ok(!isSafeHTML({ value: '<b>' }), 'look-alike objects are not trusted');
});

test('render() writes safe markup; plain strings become text', () => {
  const el = { innerHTML: 'old' };
  render(el, html`<b>${'<i>'}</b>`);
  assert.equal(el.innerHTML, '<b>&lt;i&gt;</b>');
  render(el, '<script>x</script>');
  assert.equal(el.innerHTML, '&lt;script&gt;x&lt;/script&gt;');
  render(el, [html`<i>1</i>`, html`<i>2</i>`]);
  assert.equal(el.innerHTML, '<i>1</i><i>2</i>');
  render(el, null);
  assert.equal(el.innerHTML, '');
  assert.throws(() => render(null, html`x`), TypeError);
  const evil = { value: '<img onerror=x>' };
  render(el, evil);
  assert.equal(el.innerHTML, '[object Object]', 'objects are stringified and escaped, never trusted');
});

test('escapeHTML / safeUrl / cls helpers', () => {
  assert.equal(escapeHTML('<a href="x">\'`=</a>'), '&lt;a href&#61;&quot;x&quot;&gt;&#39;&#96;&#61;&lt;/a&gt;');
  assert.equal(safeUrl('javascript:x'), 'about:invalid#nurture-unsafe-url');
  assert.equal(safeUrl('  https://a.b'), 'https://a.b');
  assert.equal(cls('row', false, null, 'is-live', { 'is-new': true, gone: 0 }), 'row is-live is-new');
  assert.equal(cls(), '');
});
