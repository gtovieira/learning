/* app.js — routing between modules, navigation, lazy lab mounting, quizzes and progress. */
(function (CT) {
  'use strict';
  const { el, quiz, renderMath, store } = CT.ui;
  const sections = [...document.querySelectorAll('.module')];
  const modules = sections.map((s, i) => ({ i, id: s.dataset.module, title: s.dataset.title, short: s.dataset.short, el: s, mounted: false }));
  const byId = Object.fromEntries(modules.map(m => [m.id, m]));

  // ---- navigation
  const nav = document.getElementById('nav');
  modules.forEach(m => {
    const a = el('a', { href: '#/' + m.id, dataset: { module: m.id } }, el('span', { class: 'n', text: m.i === 0 ? '·' : String(m.i) }), el('span', { text: m.i === 0 ? m.title : m.short }), el('span', { class: 'done' }));
    nav.append(el('li', {}, a));
  });
  const cards = document.getElementById('module-cards');
  const blurbs = {
    modeling: 'First and second order, the DC motor, dead time: where models come from and which numbers matter.',
    laplace: 'Transform pairs, the two theorems, and poles as modes. Drag a pole, watch the response.',
    transfer: 'Series, parallel, feedback. Closed-loop poles, system type, and the Routh table.',
    feedback: 'Open loop trusts the model, feedback trusts the sensor. S, T and what each strategy costs.',
    pid: 'The law in both forms, what each term buys, and the details that make it work on hardware.',
    tuning: 'Step-test identification, the rule families, relay auto-tuning. Compare them on one plant.',
    frequency: 'Bode, Nyquist, gain and phase margin, the sensitivity peak, and why delay caps bandwidth.',
    rootlocus: 'Turn the gain and watch the closed-loop poles travel. Zeros pull, integrators push.',
    digital: 'Sample time, discretization, anti-windup order of operations, and the code in TS, Dart and C.',
    challenges: 'Five loops with specs. Tune until every line passes.',
  };
  modules.slice(1).forEach(m => cards.append(el('a', { class: 'module-card', href: '#/' + m.id }, el('span', { class: 'n', text: `Module ${m.i}` }), el('b', { html: m.title }), el('span', { text: blurbs[m.id] || '' }))));

  // ---- prev / next
  modules.forEach((m, i) => {
    const prev = modules[i - 1], next = modules[i + 1];
    const bar = el('div', { class: 'module-nav' });
    bar.append(prev ? el('a', { href: '#/' + prev.id }, el('small', { text: '← previous' }), el('span', { html: prev.title })) : el('span'));
    bar.append(next ? el('a', { href: '#/' + next.id, style: 'text-align:right' }, el('small', { text: 'next →' }), el('span', { html: next.title })) : el('span'));
    m.el.append(bar);
  });

  // ---- lazy mounting
  function mount(m) {
    if (m.mounted) return;
    m.mounted = true;
    m.el.querySelectorAll('[data-lab]').forEach(node => {
      const fn = CT.labs[node.dataset.lab];
      if (!fn) { node.append(el('p', { class: 'ctl-hint', text: 'Lab not available.' })); return; }
      try { fn(node); } catch (e) { console.error('lab', node.dataset.lab, e); node.append(el('p', { class: 'status-line crit', text: 'This lab failed to start: ' + e.message })); }
    });
    m.el.querySelectorAll('[data-quiz]').forEach(node => {
      const qs = CT.quizzes[node.dataset.quiz] || [];
      qs.forEach(q => quiz(node, q));
    });
    renderMath(m.el);
  }

  // ---- routing
  function current() {
    const h = location.hash.replace(/^#\/?/, '');
    return byId[h] ? byId[h] : modules[0];
  }
  function show() {
    const m = current();
    modules.forEach(x => x.el.classList.toggle('is-active', x === m));
    nav.querySelectorAll('a').forEach(a => a.classList.toggle('is-active', a.dataset.module === m.id));
    mount(m);
    store.set('last', m.id);
    window.scrollTo({ top: 0 });
    document.title = m.i === 0 ? 'Control Loop Workshop' : `${m.title.replace(/&amp;/g, '&')} · Control Loop Workshop`;
  }
  window.addEventListener('hashchange', show);

  // ---- progress
  function progress() {
    const qd = store.get('quiz', {}), bd = store.get('badges', {});
    let total = 0, done = 0;
    modules.forEach(m => {
      const qs = CT.quizzes[m.id] || [];
      total += qs.length; const ok = qs.filter(q => qd[q.id] === true).length; done += ok;
      const mark = nav.querySelector(`a[data-module="${m.id}"] .done`);
      if (mark) mark.textContent = qs.length && ok === qs.length ? '✓' : (m.id === 'challenges' && CT.challenges && CT.challenges.every(c => bd[c.id]) ? '✓' : '');
    });
    if (CT.challenges) { total += CT.challenges.length; done += CT.challenges.filter(c => bd[c.id]).length; }
    document.getElementById('progress-text').textContent = `${done} of ${total} checks done`;
    document.getElementById('progress-fill').style.width = total ? `${100 * done / total}%` : '0';
  }
  document.addEventListener('ctw:progress', progress);

  renderMath(document);
  progress();
  show();
})(window.CT);
