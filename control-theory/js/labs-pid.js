/* labs-pid.js — laboratórios dos módulos 5, 6, 9 e 10: bancada PID, bancada de sintonia, amostragem, código de referência, desafios. */
(function (CT) {
  'use strict';
  const { el, slider, select, toggle, metrics, table, fmt, fmtG, frame, plantPicker, group, button, tabs, codeBlock, store } = CT.ui;
  const { P, TF, C } = CT;
  const { labFrame, plotIn, readout, polesText, simT } = CT.labs.util;

  // ------------------------------------------------------------ auxiliares
  /* Ensaio de degrau em malha aberta → ajuste FOPDT → PID por IMC. Alternativas para plantas que não acomodam. */
  function autoTune(tf, plantId) {
    if (plantId === 'integrator') { const kv = TF.dcGain(TF.make(tf.num, P.trim(tf.den).slice(0, -1))); return { Kp: 2 / kv, Ki: 0, Kd: 0.8 / kv, why: 'planta integradora: pré-ajuste PD (não há ajuste FOPDT possível)' }; }
    const poles = TF.poles(tf);
    const T = simT(poles, 5, 400, 10) + (tf.delay || 0) * 3;
    const res = CT.simulate({ plant: tf, T, Ts: T / 3000, uOpen: () => 1 });
    const id = CT.identifyFOPDT(res, 1);
    if (!id || !isFinite(id.K) || id.K === 0 || !(id.tau > 0)) return { Kp: 1, Ki: 0.1, Kd: 0, why: 'o ajuste falhou: PI genérico' };
    const lambda = Math.max(id.L, 0.3 * id.tau, 0.05);
    const g = CT.ruleById['imc-pid'].fn(id, lambda);
    const p = CT.standardToParallel(g.Kp, g.Ti, g.Td);
    return { ...p, ident: id, lambda, why: `IMC com λ = ${fmt(lambda)} s sobre o FOPDT ajustado (K ${fmt(id.K)}, τ ${fmt(id.tau)} s, L ${fmt(id.L)} s)` };
  }

  function gainSliders(prefix, st, onInput, ranges = {}) {
    const r = Object.assign({ Kp: [0, 20, 0.05], Ki: [0, 3, 0.01], Kd: [0, 5, 0.01] }, ranges);
    const sKp = slider({ id: prefix + '-Kp', label: 'Kp (proporcional)', min: r.Kp[0], max: r.Kp[1], step: r.Kp[2], value: st.Kp, onInput: v => { st.Kp = v; onInput(); } });
    const sKi = slider({ id: prefix + '-Ki', label: 'Ki (integral, por s)', min: r.Ki[0], max: r.Ki[1], step: r.Ki[2], value: st.Ki, onInput: v => { st.Ki = v; onInput(); } });
    const sKd = slider({ id: prefix + '-Kd', label: 'Kd (derivativo, s)', min: r.Kd[0], max: r.Kd[1], step: r.Kd[2], value: st.Kd, onInput: v => { st.Kd = v; onInput(); } });
    const eq = el('div', { class: 'ctl-hint' });
    const root = el('div', { class: 'ctl-group-inner', style: 'display:flex;flex-direction:column;gap:8px' }, sKp.root, sKi.root, sKd.root, eq);
    const refresh = () => {
      sKp.set(st.Kp); sKi.set(st.Ki); sKd.set(st.Kd);
      const s = CT.parallelToStandard(st.Kp, st.Ki, st.Kd);
      eq.textContent = `Forma padrão: Ti = ${isFinite(s.Ti) ? fmt(s.Ti) + ' s' : '∞ (sem integral)'}, Td = ${fmt(s.Td)} s`;
    };
    refresh();
    return { root, refresh, sliders: { sKp, sKi, sKd } };
  }

  function tailTV(res, seconds) {
    const t = res.t; let i0 = t.length - 1; while (i0 > 0 && t[t.length - 1] - t[i0] < seconds) i0--;
    return CT.totalVariation(res.u, i0);
  }

  // ====================================================== 5.1 bancada PID
  CT.labs['pid-sandbox'] = root => {
    const f = labFrame(root);
    const st = { Kp: 1, Ki: 0, Kd: 0, N: 10, dOnMeas: true, aw: 'clamp', limits: false, umin: -1, umax: 2, noise: 0, dist: -0.5, b: 1, T: 60, parts: false, Ts: 0.05 };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l51', value: 'fopdt', label: 'Planta', onChange: () => upd() });
    const gains = gainSliders('l51', st, () => { presets.set('custom'); upd(); });
    const presets = select({
      id: 'l51-preset', label: 'Pré-ajuste', value: 'custom',
      options: [{ value: 'custom', label: '— personalizado —' }, { value: 'p', label: 'Só P (Kp = 1)' }, { value: 'pi', label: 'PI (Kp = 1, Ki = 0,2)' }, { value: 'pid', label: 'PID (Kp = 1,5, Ki = 0,2, Kd = 1)' }, { value: 'auto', label: 'Sintonia automática (IMC sobre ensaio de degrau)' }],
      onChange: v => {
        const p = picker.get();
        if (v === 'p') Object.assign(st, { Kp: 1, Ki: 0, Kd: 0 });
        else if (v === 'pi') Object.assign(st, { Kp: 1, Ki: 0.2, Kd: 0 });
        else if (v === 'pid') Object.assign(st, { Kp: 1.5, Ki: 0.2, Kd: 1 });
        else if (v === 'auto') { const a = autoTune(p.tf, p.def.id); Object.assign(st, { Kp: a.Kp, Ki: a.Ki, Kd: a.Kd }); whyEl.textContent = a.why; }
        if (v !== 'auto') whyEl.textContent = '';
        gains.refresh(); upd();
      },
    });
    const whyEl = el('div', { class: 'ctl-hint' });
    const sMin = slider({ id: 'l51-umin', label: 'u mínimo', min: -3, max: 0, step: 0.1, value: st.umin, onInput: v => { st.umin = v; upd(); } });
    const sMax = slider({ id: 'l51-umax', label: 'u máximo', min: 0.5, max: 5, step: 0.1, value: st.umax, onInput: v => { st.umax = v; upd(); } });
    const awSel = select({ id: 'l51-aw', label: 'Anti-windup', value: st.aw, options: [{ value: 'clamp', label: 'Limitação condicional da integração' }, { value: 'backcalc', label: 'Retrocálculo (Tt = Ti)' }, { value: 'none', label: 'Nenhum (veja o integrador saturar)' }], onChange: v => { st.aw = v; upd(); } });
    const limBox = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, sMin.root, sMax.root, awSel.root);
    limBox.hidden = true;
    f.controls.append(
      picker.root,
      group('Controlador (forma paralela)', presets.root, whyEl, gains.root),
      group('Detalhes de implementação',
        slider({ id: 'l51-N', label: 'Filtro da derivada N (Tf = Td/N)', min: 2, max: 50, step: 1, value: st.N, onInput: v => { st.N = v; upd(); } }).root,
        toggle({ id: 'l51-dom', label: 'Derivada sobre a medição', checked: st.dOnMeas, hint: 'desligado = derivada sobre o erro (pico na mudança de referência)', onChange: v => { st.dOnMeas = v; upd(); } }).root,
        slider({ id: 'l51-b', label: 'Ponderação da referência b', min: 0, max: 1, step: 0.1, value: st.b, onInput: v => { st.b = v; upd(); } }).root,
        toggle({ id: 'l51-lim', label: 'Limites do atuador', checked: st.limits, onChange: v => { st.limits = v; limBox.hidden = !v; upd(); } }).root,
        limBox,
      ),
      group('Cenário',
        slider({ id: 'l51-T', label: 'Duração da simulação', min: 20, max: 300, step: 10, value: st.T, unit: 's', onInput: v => { st.T = v; upd(); } }).root,
        slider({ id: 'l51-dist', label: 'Perturbação de carga em T/2', min: -1, max: 1, step: 0.1, value: st.dist, onInput: v => { st.dist = v; upd(); } }).root,
        slider({ id: 'l51-noise', label: 'Ruído do sensor σ', min: 0, max: 0.05, step: 0.005, value: st.noise, digits: 3, onInput: v => { st.noise = v; upd(); } }).root,
        toggle({ id: 'l51-parts', label: 'Exibir contribuições P / I / D', checked: st.parts, onChange: v => { st.parts = v; partsPlot.el.hidden = !v; upd(); } }).root,
      ),
    );
    const yPlot = plotIn(f.plots, { height: 260, xLabel: 't (s)', yLabel: 'y', title: 'Variável de processo e referência', ariaLabel: 'Resposta em malha fechada' });
    const uPlot = plotIn(f.plots, { height: 170, xLabel: 't (s)', yLabel: 'u', title: 'Saída do controlador' });
    const partsPlot = plotIn(f.plots, { height: 190, xLabel: 't (s)', yLabel: 'contribuição', title: 'Contribuição de cada termo' });
    partsPlot.el.hidden = true;
    const mEl = el('div'); f.plots.append(mEl);
    const pidLine = el('div', { class: 'status-line' }); f.plots.append(pidLine);
    function update() {
      const p = picker.get();
      const T = st.T, tD = T / 2, Ts = st.Ts;
      const pid = new CT.PID({ Kp: st.Kp, Ki: st.Ki, Kd: st.Kd, Ts, N: st.N, dOnMeasurement: st.dOnMeas, antiWindup: st.aw, b: st.b, umin: st.limits ? st.umin : -Infinity, umax: st.limits ? st.umax : Infinity });
      const res = CT.simulate({ plant: p.tf, T, Ts, controller: pid, disturbance: CT.stepAt(tD, st.dist), noise: st.noise, seed: 5, record: 'parts' });
      const series = [{ name: 'referência r', x: res.t, y: res.r, color: 'ink-2', width: 1 }];
      if (st.noise > 0) series.push({ name: 'medição', x: res.t, y: res.ym, color: 'muted', width: 1, alpha: 0.7 });
      series.push({ name: 'saída y', x: res.t, y: res.y, color: 'series-1' });
      yPlot.set({ series, vlines: [{ x: tD, label: 'degrau de carga' }] });
      uPlot.set({ series: [{ name: 'u', x: res.t, y: res.u, color: 'series-2' }], refLines: st.limits ? [{ y: st.umax, label: 'u máx', color: 'crit' }, { y: st.umin, label: 'u mín', color: 'crit' }] : [] });
      if (st.parts) partsPlot.set({ series: [{ name: 'P', x: res.t, y: res.parts.P, color: 'series-1' }, { name: 'I', x: res.t, y: res.parts.I, color: 'series-3' }, { name: 'D', x: res.t, y: res.parts.D, color: 'series-2' }] });
      const m = CT.stepMetrics(res, { t1: tD, ref: 1 });
      const d = CT.disturbanceMetrics(res, { tD, scale: 1 });
      metrics(mEl, [
        { label: 'Subida 10–90 %', value: m.rise, unit: 's' },
        { label: 'Sobressinal', value: m.overshoot, unit: '%', digits: 1, status: m.overshoot < 10 ? 'good' : m.overshoot < 25 ? 'warn' : 'crit', note: m.overshoot < 10 ? 'adequado' : m.overshoot < 25 ? 'alto' : 'oscilando' },
        { label: 'Acomodação 2 %', value: m.settled ? m.settling : NaN, unit: m.settled ? 's' : 'não acomodou', status: m.settled ? undefined : 'warn', note: 'antes de T/2' },
        { label: 'Erro em regime', value: m.ess, digits: 3, status: Math.abs(m.ess) < 0.01 ? 'good' : 'warn', note: Math.abs(m.ess) < 0.01 ? 'nulo' : 'desvio' },
        { label: 'IAE (referência)', value: m.iae, digits: 2 },
        { label: 'Carga: desvio máximo', value: d ? d.peak : NaN, digits: 3 },
        { label: 'Carga: recuperação 2 %', value: d && !isNaN(d.recovery) ? d.recovery : NaN, unit: 's' },
        { label: 'Esforço de controle TV(u)', value: CT.totalVariation(res.u), digits: 1 },
        { label: 'Tempo em saturação', value: 100 * res.satFraction, unit: '%', digits: 0, status: res.satFraction > 0.3 ? 'warn' : undefined, note: 'risco de windup' },
      ]);
      const Ctf = CT.pidTF(st.Kp, st.Ki, st.Kd, st.N);
      pidLine.textContent = `C(s) = ${TF.toString(Ctf)}   ·   Ts = ${fmt(Ts, 2)} s`;
    }
    update();
    f.foot.append(el('p', { text: 'Roteiro sugerido: pré-ajuste “Só P”, eleve Kp a 4 na planta FOPDT e observe a oscilação. Recue para 2 e acrescente Ki = 0,25: o desvio desaparece e o sobressinal cresce. Acrescente Kd = 2: amortecido. Agora ative os limites do atuador com u máximo = 1,2 e escolha anti-windup “Nenhum”: o integrador continua carregando enquanto o atuador está no limite, e a malha ultrapassa a referência por larga margem quando ele se solta.' }));
  };

  // ====================================================== 6.1 bancada de sintonia
  CT.labs['tuning-bench'] = root => {
    const f = labFrame(root);
    const st = { du: 1, lambda: 1, lambdaAuto: true, selected: new Set(['imc-pid', 'zn-ol-pid', 'simc-pi']), d: 1, eps: 0.02, ident: null, relay: null, exact: null, plant: null };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l61', value: 'cubic', label: 'Planta', onChange: () => { st.lambdaAuto = true; upd(); } });
    const sLam = slider({ id: 'l61-lam', label: 'λ (constante de tempo de malha fechada, IMC / SIMC)', min: 0.05, max: 50, log: true, value: st.lambda, unit: 's', onInput: v => { st.lambda = v; st.lambdaAuto = false; upd(); } });
    const lamHint = el('div', { class: 'ctl-hint', text: 'Padrão λ = L (o tempo morto ajustado). Aumente para trocar velocidade por tolerância a erro de modelo.' });
    f.controls.append(
      picker.root,
      group('Ensaio de degrau', slider({ id: 'l61-du', label: 'Amplitude do degrau Δu', min: 0.2, max: 2, step: 0.1, value: st.du, onInput: v => { st.du = v; upd(); } }).root),
      group('Regras', sLam.root, lamHint, el('div', { class: 'ctl-hint', text: 'Marque até quatro regras na tabela para compará-las.' })),
      group('Ensaio com relé',
        slider({ id: 'l61-d', label: 'Amplitude do relé d', min: 0.2, max: 2, step: 0.1, value: st.d, onInput: v => { st.d = v; upd(); } }).root,
        slider({ id: 'l61-eps', label: 'Histerese ε', min: 0, max: 0.1, step: 0.005, value: st.eps, digits: 3, onInput: v => { st.eps = v; upd(); } }).root,
      ),
    );
    const steps = el('div', { class: 'lab-steps' }, el('span', { class: 'step-chip is-on', text: '1 · Identificar' }), el('span', { class: 'step-chip is-on', text: '2 · Aplicar regras e comparar' }), el('span', { class: 'step-chip is-on', text: '3 · Ensaio com relé' }));
    f.plots.append(steps);
    const stepPlot = plotIn(f.plots, { height: 230, xLabel: 't (s)', yLabel: 'y', title: 'Passo 1 — ensaio de degrau em malha aberta e ajuste FOPDT' });
    const identEl = el('div'); f.plots.append(identEl);
    const rulesWrap = el('div', { class: 'table-wrap' }); f.plots.append(el('div', { class: 'plot-title', text: 'Passo 2 — ganhos de cada regra (forma padrão e forma paralela)' }), rulesWrap);
    const cmpPlot = plotIn(f.plots, { height: 270, xLabel: 't (s)', yLabel: 'y', title: 'Respostas em malha fechada sobre a planta verdadeira (degrau de referência, depois carga −0,5 em T/2)' });
    const cmpU = plotIn(f.plots, { height: 160, xLabel: 't (s)', yLabel: 'u', title: 'Saídas dos controladores' });
    const cmpWrap = el('div', { class: 'table-wrap' }); f.plots.append(cmpWrap);
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const relayY = plotIn(row, { height: 200, xLabel: 't (s)', yLabel: 'y', title: 'Passo 3 — ensaio com relé: saída' });
    const relayU = plotIn(row, { height: 200, xLabel: 't (s)', yLabel: 'u', title: 'Saída do relé' });
    const relayEl = el('div'); f.plots.append(relayEl);
    function update() {
      const p = picker.get();
      const tf = p.tf;
      // Passo 1: identificação
      const poles = TF.poles(tf);
      const integrating = p.def.id === 'integrator';
      const T1 = simT(poles, 5, 400, 10) + (tf.delay || 0) * 3;
      const res = CT.simulate({ plant: tf, T: T1, Ts: T1 / 3000, uOpen: () => st.du });
      st.ident = integrating ? null : CT.identifyFOPDT(res, st.du);
      const id = st.ident;
      const series = [{ name: 'planta verdadeira', x: res.t, y: res.y, color: 'series-1' }];
      const markers = [];
      if (id && isFinite(id.K) && id.tau > 0) {
        const fit = TF.make([id.K], [id.tau, 1], id.L);
        const rf = CT.simulate({ plant: fit, T: T1, Ts: T1 / 3000, uOpen: () => st.du });
        series.push({ name: 'ajuste FOPDT', x: rf.t, y: rf.y, color: 'series-2' });
        markers.push({ x: id.t28, y: id.y0 + 0.283 * (id.yss - id.y0), label: 't₂₈' }, { x: id.t63, y: id.y0 + 0.632 * (id.yss - id.y0), label: 't₆₃' });
        if (st.lambdaAuto) { st.lambda = Math.max(0.05, id.L || 0.3 * id.tau); sLam.set(st.lambda); }
        const ratio = id.L / id.tau;
        identEl.replaceChildren(readout([
          ['modelo ajustado', `K = ${fmt(id.K, 3)},  τ = ${fmt(id.tau)} s,  L = ${fmt(id.L)} s`],
          ['método', `dois pontos: τ = 1,5 (t₆₃ − t₂₈) = 1,5 (${fmt(id.t63)} − ${fmt(id.t28)}),  L = t₆₃ − τ`],
          ['dificuldade L/τ', el('span', {}, `${fmt(ratio)}  `, el('span', { class: 'pill ' + (ratio < 1 ? 'pill-good' : 'pill-warn'), text: ratio < 0.1 ? '✓ dominada pelo atraso de primeira ordem: fácil' : ratio < 1 ? '✓ equilibrada: qualquer regra boa funciona' : '△ dominada pelo tempo morto: vá devagar, PI' }))],
          ['planta verdadeira', TF.toString(tf)],
        ]));
      } else {
        identEl.replaceChildren(el('div', { class: 'status-line warn', text: integrating ? 'Esta planta integra: o degrau em malha aberta nunca acomoda, portanto um ajuste FOPDT não tem significado. Só as regras de ganho crítico (passo 3) se aplicam aqui.' : 'O ensaio de degrau não produziu um ajuste utilizável.' }));
      }
      stepPlot.set({ series, markers, refLines: id ? [{ y: id.yss, label: 'valor final' }] : [] });
      // Passo 3: relé e valores críticos exatos
      const bd = CT.bode(tf, 1e-3, 1e3, 1200);
      const mg = CT.margins(bd);
      st.exact = mg.gmDb != null ? { Ku: Math.pow(10, mg.gmDb / 20), Pu: 2 * Math.PI / mg.wpc } : null;
      const Tr = Math.min(600, Math.max(40, st.exact ? 12 * st.exact.Pu : 60));
      const rl = CT.relayTest(tf, { d: st.d, eps: st.eps, T: Tr, Ts: Tr / 6000 });
      st.relay = rl.ok ? rl : null;
      relayY.set({ series: [{ name: 'y', x: rl.res.t, y: rl.res.y, color: 'series-1' }], refLines: [{ y: 0, label: 'referência' }], bands: rl.ok ? [{ x0: rl.tStart, color: 'series-3', alpha: 0.08 }] : [] });
      relayU.set({ series: [{ name: 'u do relé', x: rl.res.t, y: rl.res.u, color: 'series-2' }] });
      relayEl.replaceChildren(readout([
        ['ciclo-limite', rl.ok ? `amplitude a = ${fmt(rl.a, 3)},  período Pu = ${fmt(rl.Pu)} s  (medidos na janela sombreada)` : 'nenhum ciclo-limite estável foi detectado no ensaio'],
        ['estimativa pelo relé', rl.ok ? `Ku = 4d/(π√(a² − ε²)) = ${fmt(rl.Ku)}` : '—'],
        ['exato, a partir de L(jω)', st.exact ? `Ku = ${fmt(st.exact.Ku)} (margem de ganho da planta sozinha),  Pu = ${fmt(st.exact.Pu)} s` : 'não há cruzamento de fase: o ganho proporcional sozinho não instabiliza esta planta, portanto Ku não existe e os números do relé são um artefato da histerese'],
      ]));
      // Passo 2: tabela de regras e comparação
      const rows = [];
      CT.rules.forEach((r, i) => {
        let g = null, avail = true;
        if (r.needs === 'fopdt') { if (id && isFinite(id.K) && id.tau > 0 && id.L > 0) g = r.fn(id, st.lambda); else if (id && id.L === 0 && r.hasLambda) g = r.fn({ ...id, L: 1e-3 }, st.lambda); else avail = false; }
        else { if (st.relay) g = r.fn({ Ku: st.relay.Ku, Pu: st.relay.Pu }); else avail = false; }
        if (g && (!isFinite(g.Kp) || g.Kp <= 0)) { g = null; avail = false; }
        const par = g ? CT.standardToParallel(g.Kp, g.Ti, g.Td) : null;
        const cb = el('input', { type: 'checkbox', id: 'l61-sel-' + r.id, checked: st.selected.has(r.id) ? true : null, disabled: !avail ? true : null });
        cb.addEventListener('change', () => { if (cb.checked) { if (st.selected.size >= 4) { cb.checked = false; return; } st.selected.add(r.id); } else st.selected.delete(r.id); upd(); });
        const key = el('span', { class: 'legend-glyph', style: `--c: var(--series-${i + 1}); margin-right:6px` });
        rows.push({ r, g, par, avail, cb, key, i });
      });
      rulesWrap.replaceChildren(table([
        { label: '', get: x => x.cb },
        { label: 'Regra', get: x => el('span', {}, x.key, el('label', { for: 'l61-sel-' + x.r.id, text: x.r.name })) },
        { label: 'Kp', num: true, get: x => x.g ? fmt(x.g.Kp, 3) : (x.r.needs === 'ultimate' ? 'precisa do relé' : 'precisa do ajuste') },
        { label: 'Ti (s)', num: true, get: x => x.g ? (isFinite(x.g.Ti) ? fmt(x.g.Ti) : '∞') : '—' },
        { label: 'Td (s)', num: true, get: x => x.g ? fmt(x.g.Td) : '—' },
        { label: 'Ki', num: true, get: x => x.par ? fmt(x.par.Ki, 3) : '—' },
        { label: 'Kd', num: true, get: x => x.par ? fmt(x.par.Kd, 3) : '—' },
        { label: 'Caráter', get: x => x.r.note },
      ], rows));
      const ySeries = [], uSeries = [], mrows = [];
      const Tc = id ? Math.min(400, Math.max(20, 15 * (id.tau + id.L))) : (st.exact ? Math.min(400, Math.max(20, 12 * st.exact.Pu)) : 60);
      const tD = Tc / 2, Ts = Math.min(0.05, Tc / 4000);
      for (const x of rows) {
        if (!st.selected.has(x.r.id) || !x.par) continue;
        const pid = new CT.PID({ Kp: x.par.Kp, Ki: x.par.Ki, Kd: x.par.Kd, Ts, N: 10 });
        const cr = CT.simulate({ plant: tf, T: Tc, Ts, controller: pid, disturbance: CT.stepAt(tD, -0.5) });
        const col = `series-${x.i + 1}`;
        ySeries.push({ name: x.r.name, x: cr.t, y: cr.y, color: col });
        uSeries.push({ name: x.r.name, x: cr.t, y: cr.u, color: col });
        const m = CT.stepMetrics(cr, { t1: tD, ref: 1 }), d = CT.disturbanceMetrics(cr, { tD, scale: 1 });
        mrows.push({ name: x.r.name, key: el('span', { class: 'legend-glyph', style: `--c: var(--series-${x.i + 1}); margin-right:6px` }), os: fmt(m.overshoot, 1), ts: m.settled ? fmt(m.settling, 1) : 'não', iae: fmt(m.iae, 2), pk: d ? fmt(d.peak, 3) : '—', rec: d && !isNaN(d.recovery) ? fmt(d.recovery, 1) : 'não', tv: fmt(CT.totalVariation(cr.u), 1) });
      }
      ySeries.unshift({ name: 'referência', x: [0, Tc], y: [1, 1], color: 'ink-2', width: 1, noTip: true });
      cmpPlot.set({ series: ySeries, vlines: [{ x: tD, label: 'carga −0,5' }] });
      cmpU.set({ series: uSeries });
      cmpWrap.replaceChildren(mrows.length ? table([
        { label: 'Regra', get: x => el('span', {}, x.key, x.name) },
        { label: 'Sobressinal %', key: 'os', num: true }, { label: 'Acomodação 2 % (s)', key: 'ts', num: true }, { label: 'IAE referência', key: 'iae', num: true },
        { label: 'Carga: desvio máx.', key: 'pk', num: true }, { label: 'Carga: recuperação (s)', key: 'rec', num: true }, { label: 'TV(u)', key: 'tv', num: true },
      ], mrows) : el('p', { class: 'ctl-hint', text: 'Selecione ao menos uma regra com ganhos disponíveis.' }));
    }
    update();
    f.foot.append(el('p', { text: 'O que observar: na planta de três atrasos o ajuste FOPDT é razoável, e as regras de decaimento de um quarto (ZN, Cohen–Coon) fazem exatamente o que prometem: rápidas e oscilatórias. IMC e SIMC com λ = L são mais calmas, com rejeição de carga semelhante. Compare a estimativa de Ku pelo relé com a exata: a aproximação por função descritiva costuma ficar dentro de 10 % a 15 %. Depois troque para a planta FOPDT e eleve L a 8 s (L/τ = 1): as regras agressivas se desfazem; as regras com λ apenas ficam mais lentas.' }));
  };

  // ====================================================== 9.1 amostragem
  CT.labs['sampling'] = root => {
    const f = labFrame(root);
    const st = { Ts: 0.05, noise: 0, N: 10, gains: null };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l91', value: 'second', label: 'Planta', params: { K: 1, wn: 1, zeta: 0.3 }, onChange: () => { st.gains = null; upd(); } });
    const gEl = el('div', { class: 'ctl-hint' });
    f.controls.append(
      picker.root,
      group('Controlador (fixo, sintonia automática)', gEl, button('Sintonizar de novo para esta planta', () => { st.gains = null; upd(); }, 'btn secondary')),
      group('Implementação',
        slider({ id: 'l91-Ts', label: 'Período de amostragem Ts', min: 0.005, max: 3, log: true, value: st.Ts, unit: 's', onInput: v => { st.Ts = v; upd(); } }).root,
        slider({ id: 'l91-N', label: 'Filtro da derivada N', min: 1, max: 50, step: 1, value: st.N, onInput: v => { st.N = v; upd(); } }).root,
        slider({ id: 'l91-noise', label: 'Ruído do sensor σ', min: 0, max: 0.05, step: 0.005, value: st.noise, digits: 3, onInput: v => { st.noise = v; upd(); } }).root,
      ),
    );
    const verdict = el('div', { class: 'status-line' }); f.controls.append(verdict);
    const yPlot = plotIn(f.plots, { height: 250, xLabel: 't (s)', yLabel: 'y', title: 'Resposta em malha fechada: amostragem fina × Ts escolhido' });
    const uPlot = plotIn(f.plots, { height: 190, xLabel: 't (s)', yLabel: 'u', title: 'Saída do controlador (retida entre amostras)' });
    const mEl = el('div'); f.plots.append(mEl);
    function update() {
      const p = picker.get();
      if (!st.gains) { st.gains = autoTune(p.tf, p.def.id); gEl.textContent = `Kp = ${fmt(st.gains.Kp, 3)}, Ki = ${fmt(st.gains.Ki, 3)}, Kd = ${fmt(st.gains.Kd, 3)} — ${st.gains.why}`; }
      const g = st.gains;
      const T = Math.min(200, Math.max(10, simT(TF.poles(p.tf), 5, 200, 12) + 4 * (p.tf.delay || 0)));
      const mk = Ts => new CT.PID({ Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, Ts, N: st.N });
      const fine = CT.simulate({ plant: p.tf, T, Ts: 0.005, controller: mk(0.005), noise: st.noise, seed: 9, disturbance: CT.stepAt(T / 2, -0.4) });
      const cur = CT.simulate({ plant: p.tf, T, Ts: st.Ts, controller: mk(st.Ts), noise: st.noise, seed: 9, disturbance: CT.stepAt(T / 2, -0.4) });
      yPlot.set({ series: [{ name: 'Ts = 5 ms (referência)', x: fine.t, y: fine.y, color: 'series-3', width: 1.5 }, { name: `Ts = ${CT.fmtNum(st.Ts, 3)} s`, x: cur.t, y: cur.y, color: 'series-1' }], refLines: [{ y: 1, label: 'referência' }], vlines: [{ x: T / 2, label: 'carga −0,4' }] });
      uPlot.set({ series: [{ name: 'Ts = 5 ms', x: fine.t, y: fine.u, color: 'series-3', width: 1.5 }, { name: `Ts = ${CT.fmtNum(st.Ts, 3)} s`, x: cur.t, y: cur.u, color: 'series-1' }] });
      const mf = CT.stepMetrics(fine, { t1: T / 2, ref: 1 }), mc = CT.stepMetrics(cur, { t1: T / 2, ref: 1 });
      const spr = mf.rise / st.Ts;
      const lvl = spr >= 10 ? 'good' : spr >= 4 ? 'warn' : 'crit';
      verdict.className = 'status-line ' + lvl;
      verdict.textContent = `${fmt(spr, 1)} amostras por tempo de subida (subida de ${fmt(mf.rise)} s com amostragem fina). ${lvl === 'good' ? 'Confortável: o atraso do retentor Ts/2 é uma fração pequena da dinâmica da malha.' : lvl === 'warn' ? 'No limite: o atraso do retentor está consumindo margem de fase; espere mais sobressinal.' : 'Lento demais: o controlador reage a informação envelhecida.'}`;
      metrics(mEl, [
        { label: 'Sobressinal (fina)', value: mf.overshoot, unit: '%', digits: 1 },
        { label: 'Sobressinal (Ts)', value: mc.overshoot, unit: '%', digits: 1, status: mc.overshoot > mf.overshoot + 10 ? 'warn' : undefined, note: 'degradado' },
        { label: 'IAE (fina)', value: mf.iae, digits: 2 },
        { label: 'IAE (Ts)', value: mc.iae, digits: 2 },
        { label: 'TV(u) (fina)', value: CT.totalVariation(fine.u), digits: 1 },
        { label: 'TV(u) (Ts)', value: CT.totalVariation(cur.u), digits: 1 },
        { label: 'Atraso do retentor Ts/2', value: st.Ts / 2, unit: 's', digits: 3 },
      ]);
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: aumente Ts até a leitura de amostras por tempo de subida cair abaixo de 10 e observe o sobressinal subir; abaixo de 4 a malha já é outra. Depois ajuste ruído 0,02 com N = 50: a derivada transforma o ruído em um u serrilhado. Reduza N para 5 e ele se acalma quase sem mudança em y. É por isso que o filtro faz parte do controlador, e não é uma opção.' }));
  };

  // ====================================================== 9 código de referência
  CT.labs['pid-code'] = root => {
    const ts = `// pid.ts — PID discreto: forma paralela, derivada sobre a medição com filtro de
// primeira ordem, anti-windup (limitação condicional ou retrocálculo), limites de saída.
export interface PidConfig {
  kp: number; ki: number; kd: number;   // ganhos paralelos (ki em 1/s, kd em s)
  ts: number;                            // período de amostragem [s]
  n?: number;                            // razão do filtro da derivada, Tf = Td/N (padrão 10)
  umin?: number; umax?: number;          // limites de saída
  antiWindup?: 'clamp' | 'backcalc' | 'none';
  dOnMeasurement?: boolean;              // padrão true: sem pico na mudança de referência
  b?: number;                            // ponderação da referência no termo P (padrão 1)
}

export class Pid {
  private i = 0; private d = 0; private prevX: number | null = null;
  constructor(private c: PidConfig) {}

  /** Partida sem solavanco: a primeira saída automática iguala a saída manual atual. */
  reset(y: number, u0 = 0): void { this.i = u0; this.d = 0; this.prevX = this.c.dOnMeasurement === false ? 0 : -y; }

  update(r: number, y: number): number {
    const { kp, ki, kd, ts } = this.c;
    const n = this.c.n ?? 10, b = this.c.b ?? 1;
    const umin = this.c.umin ?? -Infinity, umax = this.c.umax ?? Infinity;
    const e = r - y;
    const p = kp * (b * r - y);
    // derivada filtrada (Euler regressivo no filtro)
    const x = this.c.dOnMeasurement === false ? e : -y;
    if (this.prevX === null) this.prevX = x;
    const td = kp !== 0 ? kd / Math.abs(kp) : kd;
    const tf = td / n;
    this.d = kd === 0 ? 0 : (tf / (tf + ts)) * this.d + (kd / (tf + ts)) * (x - this.prevX);
    this.prevX = x;
    // integral (Euler regressivo), depois saturação, depois correção anti-windup
    const di = ki * ts * e;
    let i = this.i + di;
    const v = p + i + this.d;
    const u = Math.min(umax, Math.max(umin, v));
    if (u !== v) {
      const mode = this.c.antiWindup ?? 'clamp';
      if (mode === 'clamp' && Math.sign(di) === Math.sign(v - u)) i = this.i;       // não empurrar contra o limite
      else if (mode === 'backcalc') { const tt = ki > 0 ? kp / ki : 1; i += (ts / tt) * (u - v); }
    }
    this.i = i;
    return u;
  }
}`;
    const dart = `// pid.dart — o mesmo controlador para Flutter / Dart embarcado.
class Pid {
  final double kp, ki, kd, ts;
  final double n, b, umin, umax;
  final bool dOnMeasurement;
  final String antiWindup; // 'clamp' | 'backcalc' | 'none'
  double _i = 0, _d = 0;
  double? _prevX;

  Pid({required this.kp, required this.ki, required this.kd, required this.ts,
       this.n = 10, this.b = 1, this.umin = double.negativeInfinity,
       this.umax = double.infinity, this.dOnMeasurement = true, this.antiWindup = 'clamp'});

  /// Partida sem solavanco: inicializa o integrador com a saída manual atual.
  void reset(double y, [double u0 = 0]) { _i = u0; _d = 0; _prevX = dOnMeasurement ? -y : 0; }

  double update(double r, double y) {
    final e = r - y;
    final p = kp * (b * r - y);
    final x = dOnMeasurement ? -y : e;
    _prevX ??= x;
    final td = kp != 0 ? kd / kp.abs() : kd;
    final tf = td / n;
    _d = kd == 0 ? 0 : (tf / (tf + ts)) * _d + (kd / (tf + ts)) * (x - _prevX!);
    _prevX = x;
    final di = ki * ts * e;
    var i = _i + di;
    final v = p + i + _d;
    final u = v.clamp(umin, umax).toDouble();
    if (u != v) {
      if (antiWindup == 'clamp' && di.sign == (v - u).sign) i = _i;
      else if (antiWindup == 'backcalc') { final tt = ki > 0 ? kp / ki : 1.0; i += (ts / tt) * (u - v); }
    }
    _i = i;
    return u;
  }
}`;
    const c = `/* pid.c — PID a taxa fixa para uma tarefa de MCU ou CLP. Chame pid_update() uma vez a cada ts segundos. */
typedef struct {
  float kp, ki, kd, ts, n, b, umin, umax;
  int d_on_measurement;      /* 1: derivada sobre -y (sem pico); 0: sobre o erro */
  int backcalc;              /* 0: anti-windup por limitação condicional, 1: retrocálculo */
  float i, d, prev_x; int started;
} pid_t;

void pid_reset(pid_t *p, float y, float u0) { p->i = u0; p->d = 0; p->prev_x = p->d_on_measurement ? -y : 0; p->started = 1; }

float pid_update(pid_t *p, float r, float y) {
  float e = r - y;
  float pt = p->kp * (p->b * r - y);
  float x = p->d_on_measurement ? -y : e;
  if (!p->started) { p->prev_x = x; p->started = 1; }
  float td = (p->kp != 0.0f) ? p->kd / fabsf(p->kp) : p->kd;
  float tf = td / p->n;
  p->d = (p->kd == 0.0f) ? 0.0f : (tf / (tf + p->ts)) * p->d + (p->kd / (tf + p->ts)) * (x - p->prev_x);
  p->prev_x = x;
  float di = p->ki * p->ts * e;
  float i = p->i + di;
  float v = pt + i + p->d;
  float u = v > p->umax ? p->umax : (v < p->umin ? p->umin : v);
  if (u != v) {
    if (!p->backcalc) { if ((di > 0) == (v - u > 0)) i = p->i; }
    else { float tt = p->ki > 0 ? p->kp / p->ki : 1.0f; i += (p->ts / tt) * (u - v); }
  }
  p->i = i;
  return u;
}`;
    tabs(root, [
      { label: 'TypeScript', render: p => p.append(codeBlock(ts, 'ts')) },
      { label: 'Dart', render: p => p.append(codeBlock(dart, 'dart')) },
      { label: 'C', render: p => p.append(codeBlock(c, 'c')) },
    ]);
    root.append(el('p', { class: 'ctl-hint', text: 'Unidades: Kp em unidades de saída por unidade de processo; Ki é Kp/Ti (por segundo); Kd é Kp·Td (segundos). Execute a atualização a taxa fixa, disparada por temporizador e nunca pela cadência do laço principal, e alimente-a com a medição mesmo em modo manual, para que a derivada e a inicialização continuem com significado.' }));
  };

  // ====================================================== 10 desafios
  const challenges = [
    {
      id: 'offset', title: 'Elimine o desvio', short: 'Processo térmico de primeira ordem. Sem desvio, sem sobressinal, segurando a carga.', plant: () => TF.make([2], [5, 1]), T: 40, tD: 20, dist: -0.5, noise: 0,
      brief: 'Um processo térmico de primeira ordem (K = 2, τ = 5 s). Chegue à referência sem erro em regime permanente e quase sem sobressinal, e mantenha-a quando a carga mudar.',
      specs: [
        { label: 'Erro em regime abaixo de 1 % (antes do degrau de carga)', test: g => Math.abs(g.m.ess) < 0.01, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'Sobressinal abaixo de 5 %', test: g => g.m.overshoot < 5, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'De volta à faixa de 2 % em menos de 12 s após o degrau de carga', test: g => g.d.recovery < 12, show: g => isNaN(g.d.recovery) ? 'nunca' : `${fmt(g.d.recovery, 1)} s` },
      ],
      hint: 'P sozinho deixa um erro de 1/(1 + Kp·K) (módulo 3). A ação integral eleva o tipo do sistema e o elimina (módulo 5); em excesso, traz o sobressinal de volta.',
      start: { Kp: 1, Ki: 0, Kd: 0 },
    },
    {
      id: 'deadtime', title: 'Respeite o tempo morto', short: 'FOPDT com L/τ = 0,5. Ir rápido é tentador; o atraso diz o contrário.', plant: () => TF.make([1], [4, 1], 2), T: 60, tD: 30, dist: -0.5, noise: 0,
      brief: 'FOPDT com K = 1, τ = 4 s, L = 2 s (L/τ = 0,5). Ir rápido é tentador; o atraso diz o contrário.',
      specs: [
        { label: 'Sobressinal abaixo de 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Acomodação a 2 % em menos de 25 s', test: g => g.m.settled && g.m.settling < 25, show: g => g.m.settled ? `${fmt(g.m.settling, 1)} s` : 'não acomodou' },
        { label: 'Erro em regime abaixo de 1 %', test: g => Math.abs(g.m.ess) < 0.01, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'Desvio máximo com a carga abaixo de 0,35', test: g => g.d.peak < 0.35, show: g => fmt(g.d.peak, 3) },
      ],
      hint: 'Módulo 6: com L/τ = 0,5, uma regra IMC ou SIMC com λ ≈ L chega perto. O módulo 7 explica por que o cruzamento de ganho não pode passar muito de 1/L.',
      start: { Kp: 3, Ki: 0.5, Kd: 0 },
    },
    {
      id: 'motor', title: 'Posicione um motor', short: 'Planta integradora. A referência é fácil; a carga de torque é a prova.', plant: () => TF.make([1], [0.5, 1, 0]), T: 12, tD: 6, dist: -0.3, noise: 0,
      brief: 'Uma planta integradora: posição de motor, G = 1/(s(0,5s + 1)). A referência é fácil. A carga de torque em t = 6 s é a prova de verdade.',
      specs: [
        { label: 'Sobressinal abaixo de 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Acomodação a 2 % em menos de 3 s', test: g => g.m.settled && g.m.settling < 3, show: g => g.m.settled ? `${fmt(g.m.settling, 2)} s` : 'não acomodou' },
        { label: 'Desvio máximo com a carga abaixo de 0,08', test: g => g.d.peak < 0.08, show: g => fmt(g.d.peak, 3) },
        { label: 'De volta à faixa de 2 % em menos de 4 s após a carga', test: g => g.d.recovery < 4, show: g => isNaN(g.d.recovery) ? 'nunca' : `${fmt(g.d.recovery, 2)} s` },
      ],
      hint: 'A planta já integra, portanto P dá erro nulo à referência (módulo 3) e D acrescenta o amortecimento que falta ao integrador (módulo 8: o zero do PD puxa o lugar das raízes para a esquerda). Porém uma carga na entrada de uma planta integradora ainda deixa um desvio de d/Kp sem ação integral.',
      start: { Kp: 2, Ki: 0, Kd: 0 },
    },
    {
      id: 'ringing', title: 'Domine a ressonância', short: 'Segunda ordem com ζ = 0,15. O controlador precisa fornecer o amortecimento.', plant: () => TF.make([4], [1, 0.6, 4]), T: 20, tD: 10, dist: -0.5, noise: 0,
      brief: 'Uma planta de segunda ordem pouco amortecida, ζ = 0,15 em ωₙ = 2 rad/s. Ela oscila sozinha; o controlador precisa fornecer o amortecimento.',
      specs: [
        { label: 'Sobressinal abaixo de 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Acomodação a 2 % em menos de 5 s', test: g => g.m.settled && g.m.settling < 5, show: g => g.m.settled ? `${fmt(g.m.settling, 2)} s` : 'não acomodou' },
        { label: 'Erro em regime abaixo de 1 %', test: g => Math.abs(g.m.ess) < 0.01, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'De volta à faixa de 2 % em menos de 6 s após a carga', test: g => g.d.recovery < 6, show: g => isNaN(g.d.recovery) ? 'nunca' : `${fmt(g.d.recovery, 2)} s` },
      ],
      hint: 'A ação derivativa é realimentação de velocidade: afasta os polos de malha fechada do eixo imaginário (módulo 8). Depois, ação integral para o desvio, com moderação.',
      start: { Kp: 1, Ki: 0, Kd: 0 },
    },
    {
      id: 'noisy', title: 'Atuador calmo, sensor ruidoso', short: 'FOPDT com medição ruidosa. Cumpra as especificações com sinal de controle tranquilo.', plant: () => TF.make([1.5], [8, 1], 1), T: 80, tD: 40, dist: -0.5, noise: 0.01,
      brief: 'FOPDT (K = 1,5, τ = 8 s, L = 1 s) com medição ruidosa (σ = 0,01). Cumpra as especificações de resposta mantendo o sinal de controle tranquilo: a variação total de u nos últimos 20 s precisa ficar pequena.',
      specs: [
        { label: 'Sobressinal abaixo de 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Acomodação a 2 % em menos de 30 s', test: g => g.m.settled && g.m.settling < 30, show: g => g.m.settled ? `${fmt(g.m.settling, 1)} s` : 'não acomodou' },
        { label: 'Erro em regime abaixo de 2 %', test: g => Math.abs(g.m.ess) < 0.02, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'TV(u) nos 20 s finais abaixo de 30', test: g => g.tv < 30, show: g => fmt(g.tv, 1) },
      ],
      hint: 'Módulos 5 e 9: o ganho derivativo multiplica o ruído do sensor por Kd/(Tf + Ts). Ou filtre com força (N pequeno), ou aceite que uma planta dominada pelo atraso com sensor ruidoso é uma malha PI.',
      start: { Kp: 3, Ki: 0.3, Kd: 2 },
    },
  ];

  CT.labs['challenges'] = root => {
    const cards = el('div', { class: 'challenge-list' });
    const panel = el('div', { class: 'lab' });
    root.append(cards, panel);
    let active = null;
    const badges = () => store.get('badges', {});
    function renderCards() {
      cards.textContent = '';
      const b = badges();
      challenges.forEach((ch, i) => {
        const btn = el('button', { type: 'button', class: 'challenge-card' + (active === ch ? ' is-active' : '') }, el('b', { text: `${i + 1}. ${ch.title}` }), el('span', { text: ch.short }), el('span', { class: 'badge pill ' + (b[ch.id] ? 'pill-good' : ''), text: b[ch.id] ? '✓ resolvido' : 'pendente' }));
        btn.addEventListener('click', () => open(ch));
        cards.append(btn);
      });
    }
    function open(ch) {
      active = ch; renderCards();
      panel.textContent = '';
      const st = { ...ch.start, N: 10, dOnMeas: true };
      const upd = frame(update);
      panel.append(el('div', { class: 'lab-head' }, el('span', { class: 'lab-kicker', text: 'Desafio' }), el('h3', { text: ch.title }), el('p', { text: ch.brief })));
      const f = labFrame(panel);
      const gains = gainSliders('ch-' + ch.id, st, upd, { Kp: [0, 30, 0.05], Ki: [0, 5, 0.01], Kd: [0, 10, 0.01] });
      f.controls.append(
        group('Seu controlador', gains.root),
        group('Detalhes',
          slider({ id: `ch-${ch.id}-N`, label: 'Filtro da derivada N', min: 1, max: 50, step: 1, value: st.N, onInput: v => { st.N = v; upd(); } }).root,
          toggle({ id: `ch-${ch.id}-dom`, label: 'Derivada sobre a medição', checked: true, onChange: v => { st.dOnMeas = v; upd(); } }).root,
        ),
        el('details', {}, el('summary', { text: 'Dica' }), el('p', { class: 'ctl-hint', text: ch.hint })),
      );
      const specEl = el('ul', { class: 'spec-list' }); f.plots.append(el('div', { class: 'plot-title', text: 'Especificação' }), specEl);
      const status = el('div', { class: 'status-line' }); f.plots.append(status);
      const yPlot = plotIn(f.plots, { height: 240, xLabel: 't (s)', yLabel: 'y', title: 'Resposta' });
      const uPlot = plotIn(f.plots, { height: 150, xLabel: 't (s)', yLabel: 'u', title: 'Saída do controlador' });
      function update() {
        const plant = ch.plant();
        const Ts = 0.05;
        const pid = new CT.PID({ Kp: st.Kp, Ki: st.Ki, Kd: st.Kd, Ts, N: st.N, dOnMeasurement: st.dOnMeas });
        const res = CT.simulate({ plant, T: ch.T, Ts, controller: pid, disturbance: CT.stepAt(ch.tD, ch.dist), noise: ch.noise, seed: 21 });
        const g = { m: CT.stepMetrics(res, { t1: ch.tD, ref: 1 }), d: CT.disturbanceMetrics(res, { tD: ch.tD, scale: 1 }) || { peak: NaN, recovery: NaN }, tv: tailTV(res, 20), umax: CT.maxAbs(res.u) };
        const series = [{ name: 'referência', x: res.t, y: res.r, color: 'ink-2', width: 1 }];
        if (ch.noise) series.push({ name: 'medição', x: res.t, y: res.ym, color: 'muted', width: 1, alpha: 0.7 });
        series.push({ name: 'saída y', x: res.t, y: res.y, color: 'series-1' });
        yPlot.set({ series, vlines: [{ x: ch.tD, label: 'degrau de carga' }] });
        uPlot.set({ series: [{ name: 'u', x: res.t, y: res.u, color: 'series-2' }] });
        specEl.textContent = '';
        let all = true;
        for (const s of ch.specs) {
          const ok = !!s.test(g); all = all && ok;
          specEl.append(el('li', {}, el('span', { class: 'pill ' + (ok ? 'pill-good' : 'pill-crit'), text: ok ? '✓ atende' : '✕ não atende' }), el('span', { text: s.label + ' — ' }), el('strong', { class: 'mono', text: s.show(g) })));
        }
        status.className = 'status-line ' + (all ? 'good' : '');
        if (all) {
          status.textContent = `Resolvido com Kp = ${fmt(st.Kp)}, Ki = ${fmt(st.Ki)}, Kd = ${fmt(st.Kd)}. Selo gravado.`;
          const b = badges(); if (!b[ch.id]) { b[ch.id] = true; store.set('badges', b); renderCards(); document.dispatchEvent(new CustomEvent('ctw:progress')); }
        } else status.textContent = 'Ajuste os ganhos até que todas as linhas atendam. As métricas são atualizadas conforme os controles se movem.';
      }
      update();
    }
    renderCards();
    open(challenges[0]);
  };
  CT.challenges = challenges;

  // ====================================================== questionários 5, 6, 7, 8, 9
  CT.quizzes.pid = [
    { id: 'pid1', q: 'Seu CLP usa a forma padrão com Kp = 2 e Ti = 8 s. O ganho integral equivalente Ki na forma paralela é…', options: ['16', '0,25', '4', '0,5'], answer: 1, explain: 'Ki = Kp/Ti = 2/8 = 0,25 por segundo. Digitar 16 em um controlador de forma paralela seria 64 vezes mais ação integral do que o pretendido.' },
    { id: 'pid2', q: 'A referência dá um salto e a saída do controlador apresenta um pico de uma amostra. A causa mais provável:', options: ['Saturação do integrador (windup)', 'Derivada atuando sobre o erro', 'Filtro da derivada forte demais', 'Período de amostragem pequeno demais'], answer: 1, explain: 'Um degrau em r é uma derivada infinita por uma amostra. A derivada sobre a medição (−dy/dt) enxerga as mesmas perturbações, porém não enxerga o degrau de referência.' },
    { id: 'pid3', q: 'Uma malha de aquecimento fica saturada em 100 % por um minuto durante o aquecimento inicial, depois ultrapassa a referência em 15 °C antes de voltar. O que está faltando?', options: ['Ação derivativa', 'Amostragem mais rápida', 'Anti-windup', 'Um Kp maior'], answer: 2, explain: 'Enquanto a saída estava no limite, o integrador continuou acumulando. Ele precisa descarregar antes que a saída possa cair: windup clássico. A limitação condicional ou o retrocálculo interrompem o acúmulo durante a saturação.' },
  ];
  CT.quizzes.tuning = [
    { id: 'tun1', q: 'Um ensaio de degrau fornece K = 2, τ = 10 s, L = 1 s. O Kp de Ziegler–Nichols em malha aberta para PID é…', options: ['6', '12', '1,2', '0,6'], answer: 0, explain: 'Kp = 1,2 τ/(K L) = 1,2·10/(2·1) = 6, com Ti = 2 s e Td = 0,5 s. Agressivo: IMC com λ = L dá cerca de 3,5.' },
    { id: 'tun2', q: 'No ensaio com relé, o que define a amplitude da oscilação?', options: ['Apenas o ganho da planta', 'A amplitude do relé d, escalada pela planta', 'A histerese', 'A referência'], answer: 1, explain: 'a ≈ (4d/π)·|G(jω_u)|. Quem escolhe d escolhe o quanto o processo é perturbado. É isso que torna o ensaio seguro em comparação com elevar Kp até o limite.' },
    { id: 'tun3', q: 'Uma malha tem L/τ = 3. A melhor expectativa é…', options: ['Um PID sintonizado por Cohen–Coon será rápido', 'Qualquer regra funciona; escolha a mais rápida', 'Um PI lento; o tempo morto limita a velocidade atingível', 'Aumentar Kd para compensar o atraso'], answer: 2, explain: 'Dominada pelo tempo morto. O cruzamento de ganho não pode passar de aproximadamente 1/L com qualquer controlador, e a ação derivativa não prevê através de um atraso. PI lento, ou um preditor de Smith se o modelo for bom.' },
  ];
  CT.quizzes.digital = [
    { id: 'dig1', q: 'O tempo de subida em malha fechada é de cerca de 2 s. Um período de amostragem razoável é…', options: ['2 s', '0,5 s', '0,1 s', '1 ms é obrigatório'], answer: 2, explain: '10 a 30 amostras por tempo de subida → 70 ms a 200 ms. Com 0,5 s são 4 amostras por tempo de subida, o que degrada a malha de forma visível; 1 ms funciona, porém é 2000 vezes mais do que o necessário e torna Ki·Ts minúsculo.' },
    { id: 'dig2', q: 'Em comparação com o projeto contínuo, o retentor de ordem zero acrescenta…', options: ['ganho', 'um atraso de cerca de Ts/2', 'um integrador a mais', 'nada mensurável'], answer: 1, explain: 'O sinal retido fica em média meia amostra atrás do ideal. No cruzamento de ganho, isso são ω_gc·Ts/2 radianos de atraso de fase adicional.' },
    { id: 'dig3', q: 'Qual ordem dentro de uma atualização do PID está correta?', options: ['Saturar o erro, depois calcular P, I, D', 'Calcular a saída não saturada, saturá-la, depois corrigir o integrador', 'Corrigir o integrador, depois calcular a saída', 'Saturar apenas o integrador'], answer: 1, explain: 'O anti-windup precisa tanto do valor não saturado v quanto do saturado u, portanto a correção do integrador acontece depois da saturação. Saturar o erro ou apenas o integrador não interrompe o windup.' },
  ];
  CT.quizzes.frequency = [
    { id: 'frq1', q: 'No cruzamento de ganho, a fase da malha é −135°. A margem de fase é…', options: ['135°', '45°', '−45°', '225°'], answer: 1, explain: 'MF = 180° + ∠L(jω_gc) = 180 − 135 = 45°: aceitável, no lado baixo para uma malha com incerteza de modelo.' },
    { id: 'frq2', q: 'Acrescentam-se 0,5 s de tempo morto a uma malha cujo cruzamento de ganho está em 2 rad/s. Aproximadamente quanta margem de fase se perde?', options: ['cerca de 6°', 'cerca de 57°', 'cerca de 1°', 'nenhuma; o atraso só afeta o módulo'], answer: 1, explain: 'A fase do atraso é −ωL = −1 rad ≈ −57° em 2 rad/s. O módulo não muda, portanto o cruzamento fica no lugar e os 57° inteiros saem da margem.' },
    { id: 'frq3', q: 'Ms = max|S(jω)| = 3,5 significa que…', options: ['a malha tolera bem erros de modelo', 'algumas frequências de perturbação são amplificadas 3,5 vezes e o traçado de Nyquist passa a 0,29 do ponto −1', 'a malha fechada é instável', 'a margem de ganho é 3,5 dB'], answer: 1, explain: 'Ms é o inverso da menor aproximação ao ponto −1. Valores acima de 2 implicam margens pequenas (MG ≥ Ms/(Ms−1) = 1,4 e MF ≥ 2·asen(1/(2Ms)) ≈ 16°) e uma sensibilidade ressonante.' },
  ];
  CT.quizzes.rootlocus = [
    { id: 'rl1', q: 'Um ramo do lugar das raízes deixa o eixo real. A partir desse ganho, a resposta ao degrau…', options: ['é instável', 'passa a oscilar', 'fica mais lenta', 'não tem sobressinal'], answer: 1, explain: 'Deixar o eixo real significa um par de polos complexos: a resposta oscila. A instabilidade só vem quando um ramo cruza para o semiplano direito.' },
    { id: 'rl2', q: 'Acrescentar um zero de PD em s = −2 a uma planta com polos em 0 e −1 faz o quê com o lugar das raízes?', options: ['Empurra-o para a direita', 'Puxa os ramos para a esquerda, em direção ao zero', 'Nada, até K ser grande', 'Acrescenta um terceiro ramo'], answer: 1, explain: 'Os ramos terminam nos zeros. Um zero no semiplano esquerdo atrai o lugar das raízes, e é por isso que a ação derivativa permite elevar o ganho mantendo o amortecimento.' },
    { id: 'rl3', q: 'Para G = 1/(s(s+1)(s+2)), o lugar das raízes cruza o eixo imaginário em K = 6. Esse K também é…', options: ['o ganho crítico Ku do método de Ziegler–Nichols', 'o ganho para ζ = 0,7', 'o ganho DC', 'o ganho derivativo'], answer: 0, explain: 'Sobre o eixo, a malha é marginalmente estável e oscila na frequência do cruzamento: exatamente os Ku e Pu que os métodos de ganho crítico e do relé estimam.' },
  ];
})(window.CT);
