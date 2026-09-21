/* app.js — navegação entre módulos, montagem preguiçosa dos laboratórios, questionários e progresso. */
(function (CT) {
  'use strict';
  const { el, quiz, renderMath, store } = CT.ui;
  const sections = [...document.querySelectorAll('.module')];
  const modules = sections.map((s, i) => ({ i, id: s.dataset.module, title: s.dataset.title, short: s.dataset.short, el: s, mounted: false }));
  const byId = Object.fromEntries(modules.map(m => [m.id, m]));

  // ---- navegação
  const nav = document.getElementById('nav');
  modules.forEach(m => {
    const a = el('a', { href: '#/' + m.id, dataset: { module: m.id } }, el('span', { class: 'n', text: m.i === 0 ? '·' : String(m.i) }), el('span', { text: m.i === 0 ? m.title : m.short }), el('span', { class: 'done' }));
    nav.append(el('li', {}, a));
  });
  const cards = document.getElementById('module-cards');
  const blurbs = {
    modeling: 'Primeira e segunda ordem, motor CC, tempo morto: de onde vêm os modelos e quais números importam.',
    laplace: 'Pares de transformadas, os dois teoremas e polos como modos. Arraste um polo e observe a resposta.',
    transfer: 'Série, paralelo, realimentação. Polos de malha fechada, tipo do sistema e a tabela de Routh.',
    feedback: 'A malha aberta confia no modelo; a realimentação confia no sensor. S, T e o que cada estratégia custa.',
    pid: 'A lei de controle nas duas formas, o que cada termo entrega e os detalhes que a fazem funcionar no equipamento.',
    tuning: 'Identificação por ensaio de degrau, as famílias de regras, sintonia por relé. Compare-as em uma mesma planta.',
    frequency: 'Bode, Nyquist, margens de ganho e de fase, pico de sensibilidade e por que o atraso limita a banda.',
    rootlocus: 'Gire o ganho e acompanhe os polos de malha fechada. Zeros atraem, integradores empurram.',
    digital: 'Período de amostragem, discretização, ordem das operações no anti-windup e o código em TS, Dart e C.',
    challenges: 'Cinco malhas com especificação. Sintonize até todas as linhas passarem.',
  };
  modules.slice(1).forEach(m => cards.append(el('a', { class: 'module-card', href: '#/' + m.id }, el('span', { class: 'n', text: `Módulo ${m.i}` }), el('b', { html: m.title }), el('span', { text: blurbs[m.id] || '' }))));

  // ---- anterior / próximo
  modules.forEach((m, i) => {
    const prev = modules[i - 1], next = modules[i + 1];
    const bar = el('div', { class: 'module-nav' });
    bar.append(prev ? el('a', { href: '#/' + prev.id }, el('small', { text: '← anterior' }), el('span', { html: prev.title })) : el('span'));
    bar.append(next ? el('a', { href: '#/' + next.id, style: 'text-align:right' }, el('small', { text: 'próximo →' }), el('span', { html: next.title })) : el('span'));
    m.el.append(bar);
  });

  // ---- montagem preguiçosa
  function mount(m) {
    if (m.mounted) return;
    m.mounted = true;
    m.el.querySelectorAll('[data-lab]').forEach(node => {
      const fn = CT.labs[node.dataset.lab];
      if (!fn) { node.append(el('p', { class: 'ctl-hint', text: 'Laboratório indisponível.' })); return; }
      try { fn(node); } catch (e) { console.error('lab', node.dataset.lab, e); node.append(el('p', { class: 'status-line crit', text: 'Este laboratório não pôde iniciar: ' + e.message })); }
    });
    m.el.querySelectorAll('[data-quiz]').forEach(node => {
      const qs = CT.quizzes[node.dataset.quiz] || [];
      qs.forEach(q => quiz(node, q));
    });
    renderMath(m.el);
  }

  // ---- rotas
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
    document.title = m.i === 0 ? 'Oficina de Controle' : `${m.title.replace(/&amp;/g, '&')} · Oficina de Controle`;
  }
  window.addEventListener('hashchange', show);

  // ---- progresso
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
    document.getElementById('progress-text').textContent = `${done} de ${total} verificações concluídas`;
    document.getElementById('progress-fill').style.width = total ? `${100 * done / total}%` : '0';
  }
  document.addEventListener('ctw:progress', progress);

  renderMath(document);
  progress();
  show();
})(window.CT);
