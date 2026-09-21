/* ui.js — DOM helpers shared by the labs: sliders, selects, toggles, plant picker,
   metric grids, quizzes, tabs, math rendering and per-viewer storage. */
(function (CT) {
  'use strict';

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v; // only for trusted, author-written markup
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in e && typeof v !== 'string' && k !== 'style') e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) { if (c == null) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return e;
  }

  const fmt = (x, d = 2) => (x == null || Number.isNaN(x) || (typeof x === 'number' && !isFinite(x))) ? (x === Infinity ? '∞' : '—') : (+x).toFixed(d);
  const fmtG = (x, d = 3) => (x == null || Number.isNaN(x)) ? '—' : (!isFinite(x) ? '∞' : CT.fmtNum(x, d));

  // ---- storage (per viewer, best effort)
  const store = {
    get(key, def) { try { const v = localStorage.getItem('ctw:' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(key, val) { try { localStorage.setItem('ctw:' + key, JSON.stringify(val)); } catch (e) { /* ignore */ } },
  };

  // ---- slider
  function slider(o) {
    const log = !!o.log;
    const toUi = v => log ? Math.log10(v) : v;
    const fromUi = v => log ? Math.pow(10, v) : v;
    const input = el('input', { type: 'range', id: o.id, min: toUi(o.min), max: toUi(o.max), step: log ? (o.step || 0.01) : o.step, value: toUi(o.value) });
    const out = el('output', { class: 'ctl-val', for: o.id });
    const lab = el('label', { class: 'ctl-label', for: o.id, text: o.label });
    const unit = o.unit ? el('span', { class: 'ctl-unit', text: o.unit }) : null;
    const root = el('div', { class: 'ctl ctl-slider' }, el('div', { class: 'ctl-row' }, lab, el('span', { class: 'ctl-readout' }, out, unit)), input);
    const digits = o.digits ?? (log ? 3 : (String(o.step).split('.')[1] || '').length);
    const show = () => { const v = fromUi(+input.value); out.value = o.fmt ? o.fmt(v) : (log ? CT.fmtNum(v, digits) : v.toFixed(digits)); };
    show();
    input.addEventListener('input', () => { show(); if (o.onInput) o.onInput(fromUi(+input.value)); });
    return {
      root, input,
      get: () => fromUi(+input.value),
      set: (v, silent = true) => { input.value = toUi(v); show(); if (!silent && o.onInput) o.onInput(v); },
      setRange: (min, max) => { input.min = toUi(min); input.max = toUi(max); show(); },
    };
  }

  function select(o) {
    const sel = el('select', { id: o.id });
    for (const opt of o.options) sel.append(el('option', { value: opt.value, text: opt.label, selected: opt.value === o.value ? true : null }));
    if (o.value != null) sel.value = o.value;
    const root = el('div', { class: 'ctl ctl-select' }, el('label', { class: 'ctl-label', for: o.id, text: o.label }), sel);
    sel.addEventListener('change', () => { if (o.onChange) o.onChange(sel.value); });
    return { root, input: sel, get: () => sel.value, set: v => { sel.value = v; } };
  }

  function toggle(o) {
    const input = el('input', { type: 'checkbox', id: o.id, checked: !!o.checked });
    const root = el('div', { class: 'ctl ctl-toggle' }, input, el('label', { for: o.id, text: o.label }), o.hint ? el('span', { class: 'ctl-hint', text: o.hint }) : null);
    input.addEventListener('change', () => { if (o.onChange) o.onChange(input.checked); });
    return { root, input, get: () => input.checked, set: v => { input.checked = v; } };
  }

  function textField(o) {
    const input = el('input', { type: 'text', id: o.id, value: o.value ?? '', spellcheck: 'false', autocomplete: 'off' });
    const root = el('div', { class: 'ctl ctl-text' }, el('label', { class: 'ctl-label', for: o.id, text: o.label }), input, o.hint ? el('span', { class: 'ctl-hint', text: o.hint }) : null);
    input.addEventListener('change', () => { if (o.onChange) o.onChange(input.value); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { input.blur(); } });
    return { root, input, get: () => input.value, set: v => { input.value = v; } };
  }

  function button(label, onClick, cls = 'btn') { return el('button', { type: 'button', class: cls, text: label, onClick }); }

  function group(title, ...children) {
    return el('fieldset', { class: 'ctl-group' }, el('legend', { text: title }), ...children);
  }

  /* Plant picker: <select> + parameter sliders rebuilt when the plant changes. */
  function plantPicker(o) {
    const plants = o.plants || CT.plants;
    let def = CT.plantById[o.value || plants[0].id];
    let params = Object.assign(CT.plantDefaults(def), o.params || {});
    const paramsEl = el('div', { class: 'plant-params' });
    const formulaEl = el('div', { class: 'tex-block plant-formula' });
    const tagEl = el('p', { class: 'ctl-hint plant-tag' });
    const sel = select({
      id: o.id + '-plant', label: o.label || 'Plant', value: def.id,
      options: plants.map(p => ({ value: p.id, label: p.name })),
      onChange: v => { def = CT.plantById[v]; params = CT.plantDefaults(def); rebuild(); fire(); },
    });
    const sliders = {};
    function rebuild() {
      paramsEl.textContent = '';
      for (const p of def.params) {
        const s = slider({ id: `${o.id}-${p.key}`, label: p.label, min: p.min, max: p.max, step: p.step, value: params[p.key], unit: p.unit, onInput: v => { params[p.key] = v; fire(); } });
        sliders[p.key] = s; paramsEl.append(s.root);
      }
      formulaEl.textContent = def.formula; formulaEl.classList.remove('tex-done');
      renderMath(formulaEl);
      tagEl.textContent = def.tag;
    }
    function fire() { if (o.onChange) o.onChange(api.get()); }
    const root = el('div', { class: 'plant-picker' }, sel.root, formulaEl, tagEl, paramsEl);
    const api = {
      root,
      get: () => ({ def, params: { ...params }, tf: def.build(params) }),
      set: (id, p) => { def = CT.plantById[id]; params = Object.assign(CT.plantDefaults(def), p || {}); sel.set(id); rebuild(); },
    };
    rebuild();
    return api;
  }

  /* Metrics grid: [{label, value, unit, status:'good'|'warn'|'crit', note}] */
  function metrics(container, rows) {
    container.textContent = '';
    const dl = el('dl', { class: 'metrics' });
    for (const r of rows) {
      const dt = el('dt', { text: r.label });
      const dd = el('dd');
      const val = el('span', { class: 'metric-value', text: typeof r.value === 'string' ? r.value : fmt(r.value, r.digits ?? 2) });
      dd.append(val);
      if (r.unit) dd.append(el('span', { class: 'metric-unit', text: ' ' + r.unit }));
      if (r.status) dd.append(el('span', { class: 'pill pill-' + r.status, text: (r.status === 'good' ? '✓ ' : r.status === 'warn' ? '△ ' : '✕ ') + (r.note || r.status) }));
      dl.append(dt, dd);
    }
    container.append(dl);
    return dl;
  }

  /* Table builder from column defs and row objects (textContent only). */
  function table(cols, rows, cls = 'data-table') {
    const t = el('table', { class: cls });
    const thead = el('thead'), tr = el('tr');
    for (const c of cols) tr.append(el('th', { text: c.label, class: c.num ? 'num' : null }));
    thead.append(tr); t.append(thead);
    const tb = el('tbody');
    for (const r of rows) {
      const trr = el('tr', { class: r._class || null });
      for (const c of cols) {
        const v = typeof c.get === 'function' ? c.get(r) : r[c.key];
        const td = el('td', { class: c.num ? 'num' : null });
        if (v && v.nodeType) td.append(v); else td.textContent = v == null ? '—' : String(v);
        trr.append(td);
      }
      tb.append(trr);
    }
    t.append(tb);
    return t;
  }

  /* Quiz: single choice with instant feedback. Progress remembered per viewer. */
  function quiz(container, q) {
    const done = store.get('quiz', {});
    const root = el('div', { class: 'quiz', id: 'quiz-' + q.id });
    root.append(el('p', { class: 'quiz-q', html: q.q }));
    const opts = el('div', { class: 'quiz-opts' });
    const fb = el('div', { class: 'quiz-fb', hidden: true });
    q.options.forEach((opt, i) => {
      const b = el('button', { type: 'button', class: 'quiz-opt', html: opt });
      b.addEventListener('click', () => {
        const ok = i === q.answer;
        [...opts.children].forEach((c, j) => { c.classList.toggle('is-right', j === q.answer); c.classList.toggle('is-wrong', j === i && !ok); c.disabled = true; });
        fb.hidden = false; fb.className = 'quiz-fb ' + (ok ? 'ok' : 'nope');
        fb.innerHTML = (ok ? '<strong>Correct.</strong> ' : '<strong>Not quite.</strong> ') + q.explain;
        renderMath(fb);
        const d = store.get('quiz', {}); d[q.id] = ok; store.set('quiz', d);
        document.dispatchEvent(new CustomEvent('ctw:progress'));
      });
      opts.append(b);
    });
    root.append(opts, fb);
    if (done[q.id] === true) root.append(el('p', { class: 'quiz-done', text: '✓ answered correctly before' }));
    renderMath(root);
    container.append(root);
    return root;
  }

  function tabs(container, items) {
    const bar = el('div', { class: 'tabs', role: 'tablist' });
    const panels = el('div', { class: 'tab-panels' });
    items.forEach((it, i) => {
      const b = el('button', { type: 'button', class: 'tab' + (i === 0 ? ' is-active' : ''), role: 'tab', text: it.label, 'aria-selected': i === 0 ? 'true' : 'false' });
      const p = el('div', { class: 'tab-panel', role: 'tabpanel', hidden: i !== 0 });
      it.render(p);
      b.addEventListener('click', () => {
        [...bar.children].forEach((c, j) => { c.classList.toggle('is-active', j === i); c.setAttribute('aria-selected', String(j === i)); });
        [...panels.children].forEach((c, j) => { c.hidden = j !== i; });
      });
      bar.append(b); panels.append(p);
    });
    container.append(bar, panels);
  }

  function codeBlock(code, lang) {
    const pre = el('pre', { class: 'code' }, el('code', { class: lang ? 'lang-' + lang : null, text: code }));
    return pre;
  }

  /* KaTeX → MathML rendering with a plain-TeX fallback when the library is unavailable. */
  function renderMath(root = document) {
    const nodes = root.querySelectorAll ? root.querySelectorAll('.tex:not(.tex-done), .tex-block:not(.tex-done)') : [];
    const list = [...nodes];
    if (root.classList && (root.classList.contains('tex') || root.classList.contains('tex-block')) && !root.classList.contains('tex-done')) list.push(root);
    for (const n of list) {
      const src = n.dataset.tex || n.textContent;
      n.dataset.tex = src;
      if (window.katex) {
        try {
          window.katex.render(src, n, { output: 'mathml', displayMode: n.classList.contains('tex-block'), throwOnError: false, strict: 'ignore' });
        } catch (e) { n.classList.add('tex-fallback'); n.textContent = src; }
      } else { n.classList.add('tex-fallback'); n.textContent = src; }
      n.classList.add('tex-done');
    }
  }
  function tex(src, block = false) { const n = el(block ? 'div' : 'span', { class: block ? 'tex-block' : 'tex', text: src }); renderMath(n); return n; }

  /* Coalesce many slider events into one recompute per frame. */
  function frame(fn) { let pending = false; return (...args) => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; fn(...args); }); }; }

  function parsePoly(s) {
    const parts = String(s).replace(/[\[\]]/g, '').split(/[,\s]+/).filter(Boolean).map(Number);
    if (!parts.length || parts.some(v => Number.isNaN(v))) return null;
    return parts;
  }

  CT.ui = { el, fmt, fmtG, store, slider, select, toggle, textField, button, group, plantPicker, metrics, table, quiz, tabs, codeBlock, renderMath, tex, frame, parsePoly };
})(window.CT);
