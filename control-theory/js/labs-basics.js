/* labs-basics.js — laboratórios dos módulos 1 a 4: modelagem, Laplace, álgebra de blocos, malha aberta e realimentação. */
(function (CT) {
  'use strict';
  const { el, slider, select, toggle, textField, metrics, table, tex, renderMath, fmt, fmtG, frame, parsePoly } = CT.ui;
  const { P, TF, C, Plot } = CT;
  CT.labs = CT.labs || {};
  CT.quizzes = CT.quizzes || {};

  function labFrame(root) {
    const body = el('div', { class: 'lab-body' });
    const controls = el('div', { class: 'lab-controls' });
    const plots = el('div', { class: 'lab-plots' });
    body.append(controls, plots);
    const foot = el('div', { class: 'lab-foot' });
    root.append(body, foot);
    return { controls, plots, foot };
  }
  function plotIn(parent, opts) { const c = el('div'); parent.append(c); return new Plot(c, opts); }
  function readout(lines) {
    const box = el('div', { class: 'readout-box' });
    for (const [k, v] of lines) box.append(el('div', {}, el('b', { text: k + ' ' }), v));
    return box;
  }
  function polesText(poles) { return poles.length ? poles.map(p => C.fmt(p, 3)).join(',  ') : 'nenhum'; }
  function stabilityPill(poles) {
    const ok = poles.every(p => p.re < -1e-9);
    const marginal = !ok && poles.every(p => p.re <= 1e-9);
    return el('span', { class: 'pill ' + (ok ? 'pill-good' : marginal ? 'pill-warn' : 'pill-crit'), text: ok ? '✓ estável' : marginal ? '△ marginal' : '✕ instável' });
  }
  function clipUnstable(y, lim = 50) { const out = new Float64Array(y.length); for (let i = 0; i < y.length; i++) out[i] = Math.abs(y[i]) > lim ? NaN : y[i]; return out; }
  const simT = (poles, lo = 5, hi = 200, mult = 6) => {
    const re = poles.map(p => Math.abs(p.re)).filter(v => v > 1e-6);
    const slow = re.length ? Math.min(...re) : 1;
    return Math.min(hi, Math.max(lo, mult / slow));
  };
  CT.labs.util = { labFrame, plotIn, readout, polesText, stabilityPill, clipUnstable, simT };

  // ====================================================== 1.1 primeira ordem
  CT.labs['first-order'] = root => {
    const f = labFrame(root);
    const st = { K: 2, tau: 5, u0: 1 };
    const upd = frame(update);
    f.controls.append(
      slider({ id: 'l11-K', label: 'Ganho K', min: 0.2, max: 5, step: 0.1, value: st.K, onInput: v => { st.K = v; upd(); } }).root,
      slider({ id: 'l11-tau', label: 'Constante de tempo τ', min: 0.5, max: 20, step: 0.5, value: st.tau, unit: 's', onInput: v => { st.tau = v; upd(); } }).root,
      slider({ id: 'l11-u0', label: 'Degrau de entrada u₀', min: 0.5, max: 2, step: 0.1, value: st.u0, onInput: v => { st.u0 = v; upd(); } }).root,
    );
    const ro = el('div'); f.controls.append(ro);
    const stepPlot = plotIn(f.plots, { height: 260, xLabel: 't (s)', yLabel: 'y', title: 'Resposta ao degrau', ariaLabel: 'Resposta ao degrau de primeira ordem' });
    const polePlot = plotIn(f.plots, { height: 190, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 'Plano s', equal: true, xDomain: [-2.4, 0.4], yDomain: [-0.8, 0.8], includeZeroX: true, table: false });
    function update() {
      const G = TF.make([st.K], [st.tau, 1]);
      const T = Math.max(6 * st.tau, 4);
      const res = CT.simulate({ plant: G, T, Ts: T / 1500, uOpen: () => st.u0 });
      const yf = st.K * st.u0;
      stepPlot.set({
        series: [
          { name: 'y(t)', x: res.t, y: res.y, color: 'series-1', area: true },
          { name: 'tangente em t = 0', x: [0, st.tau], y: [0, yf], color: 'muted', width: 1, noTip: true },
        ],
        refLines: [{ y: yf, label: `valor final ${fmt(yf)}` }],
        markers: [{ x: st.tau, y: 0.632 * yf, label: 'τ · 63,2 %' }, { x: 4 * st.tau, y: 0.982 * yf, label: '4τ · 98,2 %', align: 'right' }],
      });
      polePlot.set({ points: [{ name: 'polo', x: [-1 / st.tau], y: [0], shape: 'x', color: 'series-1', r: 6, labels: [`p = −${fmt(1 / st.tau, 3)}`] }] });
      ro.replaceChildren(readout([
        ['G(s) =', TF.toString(G)],
        ['polo', `s = −1/τ = −${fmt(1 / st.tau, 3)}`],
        ['acomodação a 2 %', `3,9 τ = ${fmt(3.9 * st.tau, 1)} s`],
        ['inclinação inicial', `K u₀ / τ = ${fmt(yf / st.tau, 3)} por s`],
      ]));
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: dobre τ e confirme que a tangente continua atingindo o valor final exatamente em τ. Depois altere K e note que τ não se move. Em um sistema de primeira ordem, ganho e velocidade são ajustes independentes.' }));
  };

  // ====================================================== 1.2 segunda ordem
  CT.labs['second-order'] = root => {
    const f = labFrame(root);
    const st = { K: 1, wn: 1, zeta: 0.3 };
    const upd = frame(update);
    f.controls.append(
      slider({ id: 'l12-K', label: 'Ganho K', min: 0.2, max: 3, step: 0.1, value: st.K, onInput: v => { st.K = v; upd(); } }).root,
      slider({ id: 'l12-wn', label: 'Frequência natural ωₙ', min: 0.2, max: 5, step: 0.1, value: st.wn, unit: 'rad/s', onInput: v => { st.wn = v; upd(); } }).root,
      slider({ id: 'l12-z', label: 'Fator de amortecimento ζ', min: 0.05, max: 2, step: 0.05, value: st.zeta, onInput: v => { st.zeta = v; upd(); } }).root,
    );
    const regime = el('div', { class: 'status-line' }); f.controls.append(regime);
    const ro = el('div'); f.controls.append(ro);
    const stepPlot = plotIn(f.plots, { height: 260, xLabel: 't (s)', yLabel: 'y', title: 'Resposta ao degrau', ariaLabel: 'Resposta ao degrau de segunda ordem' });
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const polePlot = plotIn(row, { height: 220, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 'Plano s (círculo: raio ωₙ)', equal: true, includeZeroX: true, table: false });
    const mEl = el('div'); row.append(el('div', {}, el('div', { class: 'plot-title', text: 'Medido na simulação' }), mEl));
    function update() {
      const { K, wn, zeta } = st;
      const G = TF.make([K * wn * wn], [1, 2 * zeta * wn, wn * wn]);
      const T = Math.min(300, Math.max(4, 12 / wn, 8 / (zeta * wn)));
      const res = CT.simulate({ plant: G, T, Ts: T / 2000, uOpen: () => 1 });
      const poles = TF.poles(G);
      const circ = { x: [], y: [] };
      for (let i = 0; i <= 64; i++) { const a = Math.PI / 2 + Math.PI * i / 64; circ.x.push(wn * Math.cos(a)); circ.y.push(wn * Math.sin(a)); }
      const lim = 1.25 * wn * Math.max(1, zeta + Math.sqrt(Math.max(0, zeta * zeta - 1)));
      polePlot.opts.xDomain = [-lim, 0.25 * wn]; polePlot.opts.yDomain = [-1.2 * wn, 1.2 * wn];
      polePlot.set({
        guides: [{ x: circ.x, y: circ.y, label: 'ωₙ' }],
        points: [{ name: 'polos', x: poles.map(p => p.re), y: poles.map(p => p.im), shape: 'x', color: 'series-1', r: 6, labels: poles.map(p => C.fmt(p)) }],
      });
      const m = CT.stepMetrics(res, { ref: K });
      const Mp = zeta < 1 ? 100 * Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)) : 0;
      const tp = zeta < 1 ? Math.PI / (wn * Math.sqrt(1 - zeta * zeta)) : NaN;
      stepPlot.set({
        series: [{ name: 'y(t)', x: res.t, y: res.y, color: 'series-1', area: true }],
        refLines: [{ y: K, label: `valor final ${fmt(K)}` }],
        markers: zeta < 1 ? [{ x: m.tmax, y: m.ymax, label: `pico: +${fmt(m.overshoot, 1)} %` }] : [],
        bands: [{ y0: K * 0.98, y1: K * 1.02, color: 'series-1', alpha: 0.12 }],
      });
      regime.textContent = zeta < 1 ? `Subamortecido (ζ < 1): oscila em ωd = ωₙ√(1−ζ²) = ${fmt(wn * Math.sqrt(1 - zeta * zeta))} rad/s` : zeta === 1 ? 'Criticamente amortecido (ζ = 1): polo real repetido, a resposta mais rápida sem sobressinal' : 'Sobreamortecido (ζ > 1): dois polos reais, o mais lento domina';
      ro.replaceChildren(readout([
        ['polos', polesText(poles)],
        ['Mp previsto', zeta < 1 ? `${fmt(Mp, 1)} %` : '0 (sem sobressinal)'],
        ['tp previsto', zeta < 1 ? `${fmt(tp)} s` : '—'],
        ['ts previsto (2 %)', `4/(ζωₙ) = ${fmt(4 / (zeta * wn))} s`],
        ['tr ≈ 1,8/ωₙ', `${fmt(1.8 / wn)} s`],
      ]));
      metrics(mEl, [
        { label: 'Sobressinal', value: m.overshoot, unit: '%', digits: 1 },
        { label: 'Tempo de pico', value: m.peakTime, unit: 's' },
        { label: 'Acomodação (2 %)', value: m.settled ? m.settling : NaN, unit: 's' },
        { label: 'Subida 10–90 %', value: m.rise, unit: 's' },
      ]);
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: ajuste ζ = 0,7 e leia o sobressinal (cerca de 4,6 %). Depois mantenha ζ e altere ωₙ: a forma permanece idêntica, apenas o eixo do tempo se estica. A forma é ζ; a velocidade é ωₙ.' }));
  };

  // ====================================================== 1.3 motor CC
  CT.labs['motor'] = root => {
    const f = labFrame(root);
    const st = { J: 0.01, b: 0.1, Kt: 0.1, R: 1, L: 0.5 };
    const upd = frame(update);
    f.controls.append(
      slider({ id: 'l13-J', label: 'Inércia J', min: 0.001, max: 0.1, log: true, value: st.J, unit: 'kg·m²', onInput: v => { st.J = v; upd(); } }).root,
      slider({ id: 'l13-b', label: 'Atrito viscoso b', min: 0.01, max: 1, log: true, value: st.b, unit: 'N·m·s', onInput: v => { st.b = v; upd(); } }).root,
      slider({ id: 'l13-Kt', label: 'Kt = Ke', min: 0.01, max: 1, log: true, value: st.Kt, unit: 'N·m/A', onInput: v => { st.Kt = v; upd(); } }).root,
      slider({ id: 'l13-R', label: 'Resistência R', min: 0.2, max: 10, step: 0.1, value: st.R, unit: 'Ω', onInput: v => { st.R = v; upd(); } }).root,
      slider({ id: 'l13-L', label: 'Indutância L', min: 0.01, max: 2, log: true, value: st.L, unit: 'H', onInput: v => { st.L = v; upd(); } }).root,
    );
    const ro = el('div'); f.controls.append(ro);
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const wPlot = plotIn(row, { height: 230, xLabel: 't (s)', yLabel: 'ω (rad/s)', title: 'Velocidade para um degrau de 1 V' });
    const iPlot = plotIn(row, { height: 230, xLabel: 't (s)', yLabel: 'i (A)', title: 'Corrente de armadura para um degrau de 1 V' });
    function update() {
      const { J, b, Kt, R, L } = st;
      const den = P.add(P.mul([L, R], [J, b]), [Kt * Kt]);
      const Gw = TF.make([Kt], den), Gi = TF.make([J, b], den);
      const poles = TF.poles(Gw);
      const T = simT(poles, 0.2, 60, 7);
      const rw = CT.simulate({ plant: Gw, T, Ts: T / 2000, uOpen: () => 1 });
      const ri = CT.simulate({ plant: Gi, T, Ts: T / 2000, uOpen: () => 1 });
      wPlot.set({ series: [{ name: 'ω(t)', x: rw.t, y: rw.y, color: 'series-1', area: true }], refLines: [{ y: TF.dcGain(Gw), label: `ganho DC ${fmt(TF.dcGain(Gw), 3)} rad/s por V` }] });
      iPlot.set({ series: [{ name: 'i(t)', x: ri.t, y: ri.y, color: 'series-2', area: true }], refLines: [{ y: TF.dcGain(Gi), label: `corrente em regime ${fmt(TF.dcGain(Gi), 3)} A` }] });
      ro.replaceChildren(readout([
        ['Ω(s)/V(s) =', TF.toString(Gw)],
        ['polos', polesText(poles)],
        ['τ mecânica = J/b', `${fmt(J / b, 3)} s`],
        ['τ elétrica = L/R', `${fmt(L / R, 3)} s`],
        ['corrente de partida V/R', `${fmt(1 / R, 3)} A`],
      ]));
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: reduza L a 0,01 H. Os dois polos se afastam, a corrente passa a ser quase algébrica e a velocidade se comporta como primeira ordem: é o modelo que uma malha de velocidade pode usar. Agora aumente Kt: o acoplamento pela força contraeletromotriz passa a dominar o atrito e o ganho DC se aproxima de 1/Ke.' }));
  };

  // ====================================================== 2.1 sinais
  CT.labs['signals'] = root => {
    const f = labFrame(root);
    const sigs = {
      step: { name: 'Degrau unitário', f: () => 1, F: '\\dfrac{1}{s}', poles: () => [C.of(0)], zeros: () => [], T: () => 10 },
      ramp: { name: 'Rampa t', f: t => t, F: '\\dfrac{1}{s^2}', poles: () => [C.of(0), C.of(0)], zeros: () => [], T: () => 10 },
      exp: { name: 'Exponencial e^{−at}', f: (t, p) => Math.exp(-p.a * t), F: '\\dfrac{1}{s+a}', poles: p => [C.of(-p.a)], zeros: () => [], T: p => 6 / p.a, params: ['a'] },
      texp: { name: 't·e^{−at}', f: (t, p) => t * Math.exp(-p.a * t), F: '\\dfrac{1}{(s+a)^2}', poles: p => [C.of(-p.a), C.of(-p.a)], zeros: () => [], T: p => 8 / p.a, params: ['a'] },
      sin: { name: 'sen ωt', f: (t, p) => Math.sin(p.w * t), F: '\\dfrac{\\omega}{s^2+\\omega^2}', poles: p => [C.of(0, p.w), C.of(0, -p.w)], zeros: () => [], T: p => 3 * 2 * Math.PI / p.w, params: ['w'] },
      cos: { name: 'cos ωt', f: (t, p) => Math.cos(p.w * t), F: '\\dfrac{s}{s^2+\\omega^2}', poles: p => [C.of(0, p.w), C.of(0, -p.w)], zeros: () => [C.of(0)], T: p => 3 * 2 * Math.PI / p.w, params: ['w'] },
      dsin: { name: 'e^{−at} sen ωt', f: (t, p) => Math.exp(-p.a * t) * Math.sin(p.w * t), F: '\\dfrac{\\omega}{(s+a)^2+\\omega^2}', poles: p => [C.of(-p.a, p.w), C.of(-p.a, -p.w)], zeros: () => [], T: p => Math.max(5 / p.a, 2 * 2 * Math.PI / p.w), params: ['a', 'w'] },
      dcos: { name: 'e^{−at} cos ωt', f: (t, p) => Math.exp(-p.a * t) * Math.cos(p.w * t), F: '\\dfrac{s+a}{(s+a)^2+\\omega^2}', poles: p => [C.of(-p.a, p.w), C.of(-p.a, -p.w)], zeros: p => [C.of(-p.a)], T: p => Math.max(5 / p.a, 2 * 2 * Math.PI / p.w), params: ['a', 'w'] },
    };
    const st = { id: 'dsin', a: 0.5, w: 3 };
    const upd = frame(update);
    const sel = select({ id: 'l21-sig', label: 'Sinal f(t)', value: st.id, options: Object.entries(sigs).map(([k, v]) => ({ value: k, label: v.name })), onChange: v => { st.id = v; showParams(); upd(); } });
    const sa = slider({ id: 'l21-a', label: 'Taxa de decaimento a', min: 0.1, max: 5, step: 0.1, value: st.a, onInput: v => { st.a = v; upd(); } });
    const sw = slider({ id: 'l21-w', label: 'Frequência ω', min: 0.5, max: 10, step: 0.5, value: st.w, unit: 'rad/s', onInput: v => { st.w = v; upd(); } });
    const Fel = el('div');
    f.controls.append(sel.root, sa.root, sw.root, el('div', {}, el('div', { class: 'ctl-label', text: 'F(s)' }), Fel));
    const ro = el('div'); f.controls.append(ro);
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const tPlot = plotIn(row, { height: 240, xLabel: 't (s)', yLabel: 'f(t)', title: 'Domínio do tempo' });
    const sPlot = plotIn(row, { height: 240, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 'Plano s: × polos, ○ zeros', equal: true, includeZeroX: true, table: false });
    function showParams() { const s = sigs[st.id]; sa.root.hidden = !(s.params || []).includes('a'); sw.root.hidden = !(s.params || []).includes('w'); }
    function update() {
      const s = sigs[st.id];
      const T = s.T(st), n = 600;
      const x = new Float64Array(n), y = new Float64Array(n);
      for (let i = 0; i < n; i++) { x[i] = T * i / (n - 1); y[i] = s.f(x[i], st); }
      tPlot.set({ series: [{ name: 'f(t)', x, y, color: 'series-1' }] });
      const poles = s.poles(st), zeros = s.zeros(st);
      const lim = Math.max(1, ...poles.map(p => Math.hypot(p.re, p.im)), ...zeros.map(p => Math.hypot(p.re, p.im))) * 1.3;
      sPlot.opts.xDomain = [-lim, lim * 0.4]; sPlot.opts.yDomain = [-lim, lim];
      sPlot.set({
        points: [
          { name: 'polos', x: poles.map(p => p.re), y: poles.map(p => p.im), shape: 'x', color: 'series-1', r: 6, labels: poles.map(p => C.fmt(p)) },
          { name: 'zeros', x: zeros.map(p => p.re), y: zeros.map(p => p.im), shape: 'o', color: 'series-2', r: 6, labels: zeros.map(p => C.fmt(p)) },
        ],
      });
      Fel.replaceChildren(tex(s.F, true));
      ro.replaceChildren(readout([['polos', polesText(poles)], ['zeros', zeros.length ? polesText(zeros) : 'nenhum'], ['modo', st.id.startsWith('d') ? `decai com e^{−${fmt(st.a, 1)}t} e oscila a ${fmt(st.w, 1)} rad/s` : sigs[st.id].name]]));
    }
    showParams(); update();
    f.foot.append(el('p', { text: 'Toda entrada da tabela é a mesma imagem: parte real do polo → taxa de decaimento, parte imaginária → frequência de oscilação, e um zero apenas altera a fase da oscilação (compare seno e cosseno).' }));
  };

  // ====================================================== 2.2 arrastar polos
  CT.labs['pole-drag'] = root => {
    const f = labFrame(root);
    const st = { mode: 'pair', zero: false, real: { re: -1.5 }, pair: { re: -0.5, im: 2 }, z: { re: -3 } };
    const upd = frame(update);
    const sel = select({ id: 'l22-mode', label: 'Configuração de polos', value: st.mode, options: [{ value: 'real', label: 'Um polo real' }, { value: 'pair', label: 'Par complexo' }, { value: 'both', label: 'Polo real + par complexo' }], onChange: v => { st.mode = v; upd(); } });
    const tz = toggle({ id: 'l22-zero', label: 'Acrescentar um zero real (arraste o ○)', checked: st.zero, onChange: v => { st.zero = v; upd(); } });
    f.controls.append(sel.root, tz.root);
    const ro = el('div'); f.controls.append(ro);
    const fvt = el('div', { class: 'status-line' }); f.controls.append(fvt);
    const sPlot = plotIn(f.plots, {
      height: 300, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 'Plano s — arraste os marcadores', equal: true, includeZeroX: true, table: false,
      xDomain: [-5.5, 2], yDomain: [-4.5, 4.5],
      onDrag: (g, x, y) => {
        x = Math.max(-5, Math.min(1.5, x)); y = Math.max(0, Math.min(4, y));
        if (g.id === 'real') { st.real.re = x; }
        else if (g.id === 'pair') { st.pair.re = x; st.pair.im = y; }
        else if (g.id === 'zero') { st.z.re = x; }
        upd();
      },
    });
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const impPlot = plotIn(row, { height: 220, xLabel: 't (s)', yLabel: 'g(t)', title: 'Resposta ao impulso' });
    const stepPlot = plotIn(row, { height: 220, xLabel: 't (s)', yLabel: 'y(t)', title: 'Resposta ao degrau' });
    function update() {
      const poles = [];
      let den = [1];
      if (st.mode === 'real' || st.mode === 'both') { poles.push(C.of(st.real.re)); den = P.mul(den, P.fromReal(st.real.re)); }
      if (st.mode === 'pair' || st.mode === 'both') {
        if (st.pair.im < 0.02) { poles.push(C.of(st.pair.re), C.of(st.pair.re)); den = P.mul(den, P.mul(P.fromReal(st.pair.re), P.fromReal(st.pair.re))); }
        else { poles.push(C.of(st.pair.re, st.pair.im), C.of(st.pair.re, -st.pair.im)); den = P.mul(den, P.fromPair(st.pair.re, st.pair.im)); }
      }
      let num = [1];
      const zeros = [];
      if (st.zero) { num = P.fromReal(st.z.re); zeros.push(C.of(st.z.re)); }
      const N0 = P.evalR(num, 0), D0 = P.evalR(den, 0);
      const c = (Math.abs(N0) > 1e-6 && Math.abs(D0) > 1e-6) ? Math.abs(D0) / Math.abs(N0) : (Math.abs(D0) > 1e-6 ? Math.abs(D0) : 1);
      num = P.scale(num, c);
      const G = TF.make(num, den);
      const stable = poles.every(p => p.re < -1e-9);
      const T = stable ? simT(poles, 4, 60, 7) : 12;
      const resS = CT.simulate({ plant: G, T, Ts: T / 2000, uOpen: () => 1 });
      let imp;
      const sG = TF.make(P.mul(num, [1, 0]), den);
      if (P.degree(sG.num) <= P.degree(sG.den)) { imp = CT.simulate({ plant: sG, T, Ts: T / 2000, uOpen: () => 1 }); imp = { t: imp.t, y: imp.y }; }
      else { const y = new Float64Array(resS.t.length); for (let i = 1; i < y.length; i++) y[i] = (resS.y[i] - resS.y[i - 1]) / resS.h; y[0] = NaN; imp = { t: resS.t, y }; }
      const drags = [];
      if (st.mode === 'real' || st.mode === 'both') drags.push({ id: 'real', x: st.real.re, y: 0, label: 'polo real', snapReal: true });
      if (st.mode === 'pair' || st.mode === 'both') drags.push({ id: 'pair', x: st.pair.re, y: st.pair.im, label: 'par' });
      if (st.zero) drags.push({ id: 'zero', x: st.z.re, y: 0, shape: 'o', label: 'zero', color: 'series-2', snapReal: true });
      const mirror = (st.mode !== 'real' && st.pair.im >= 0.02) ? [{ name: 'conjugado', x: [st.pair.re], y: [-st.pair.im], shape: 'x', color: 'series-1', r: 6 }] : [];
      sPlot.set({ drags, points: mirror, bands: [{ x0: 0, x1: 2, color: 'crit', alpha: 0.07 }], texts: [{ x: 0.15, y: 4.1, text: 'região instável', color: 'muted' }] });
      impPlot.set({ series: [{ name: 'g(t)', x: imp.t, y: clipUnstable(imp.y, 30), color: 'series-3' }] });
      stepPlot.set({ series: [{ name: 'y(t)', x: resS.t, y: clipUnstable(resS.y, 30), color: 'series-1', area: true }], refLines: stable ? [{ y: TF.dcGain(G), label: `G(0) = ${fmt(TF.dcGain(G))}` }] : [] });
      const modes = poles.filter((p, i) => p.im >= 0).map(p => p.im > 1e-9 ? `e^{${fmt(p.re)} t}·sen(${fmt(p.im)} t + φ)` : `e^{${fmt(p.re)} t}`);
      ro.replaceChildren(readout([
        ['G(s) =', TF.toString(G)],
        ['polos', polesText(poles)],
        ['zeros', zeros.length ? polesText(zeros) : 'nenhum'],
        ['modos', modes.join(',  ')],
      ]));
      const yEnd = resS.y[resS.y.length - 1];
      fvt.className = 'status-line ' + (stable ? 'good' : 'crit');
      fvt.textContent = stable
        ? `Teorema do valor final: lim s·Y(s) = G(0) = ${fmt(TF.dcGain(G), 3)}. Simulado: y(${fmt(T, 0)} s) = ${fmt(yEnd, 3)}.`
        : 'Há polo com Re ≥ 0: o teorema do valor final não se aplica e a resposta não acomoda.';
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: arraste o par para cima em linha reta. O decaimento não muda e apenas a frequência de oscilação varia. Arraste-o para a esquerda: mesma oscilação, decaimento mais rápido. Empurre-o através do eixo: crescimento. Depois acrescente o zero e traga-o em direção à origem pela esquerda: surge sobressinal sem qualquer mudança nos polos. Cruze para o semiplano direito com o zero e a resposta ao degrau parte no sentido errado.' }));
  };

  // ====================================================== 3.1 álgebra de blocos
  CT.labs['block-algebra'] = root => {
    const f = labFrame(root);
    const st = { gn: '1', gd: '1 3 2', hn: '1', hd: '1', K: 4 };
    const upd = frame(update);
    const fields = [
      textField({ id: 'l31-gn', label: 'Numerador de G', value: st.gn, onChange: v => { st.gn = v; upd(); } }),
      textField({ id: 'l31-gd', label: 'Denominador de G', value: st.gd, hint: 'coeficientes, maior potência primeiro, separados por espaço: "1 3 2" = s² + 3s + 2', onChange: v => { st.gd = v; upd(); } }),
      textField({ id: 'l31-hn', label: 'Numerador de H', value: st.hn, onChange: v => { st.hn = v; upd(); } }),
      textField({ id: 'l31-hd', label: 'Denominador de H', value: st.hd, onChange: v => { st.hd = v; upd(); } }),
    ];
    const sK = slider({ id: 'l31-K', label: 'Ganho de malha K (à frente de G)', min: 0.01, max: 200, log: true, value: st.K, onInput: v => { st.K = v; upd(); } });
    f.controls.append(...fields.map(x => x.root), sK.root);
    const err = el('div', { class: 'status-line crit', hidden: true }); f.controls.append(err);
    const ro = el('div'); f.plots.append(ro);
    const stepPlot = plotIn(f.plots, { height: 250, xLabel: 't (s)', yLabel: 'y', title: 'Resposta ao degrau em malha fechada  r → y' });
    const polePlot = plotIn(f.plots, { height: 200, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 'Polos (×) e zeros (○) de malha fechada', equal: true, includeZeroX: true, table: false });
    function update() {
      const gn = parsePoly(st.gn), gd = parsePoly(st.gd), hn = parsePoly(st.hn), hd = parsePoly(st.hd);
      if (!gn || !gd || !hn || !hd) { err.hidden = false; err.textContent = 'Não foi possível interpretar uma das listas de coeficientes. Use números separados por espaço; a vírgula decimal é aceita.'; return; }
      err.hidden = true;
      const G = TF.make(P.scale(gn, st.K), gd), H = TF.make(hn, hd);
      const L = TF.series(G, H);
      const Tcl = TF.feedback(G, H);
      const poles = TF.poles(Tcl), zeros = TF.zeros(Tcl);
      const stable = poles.every(p => p.re < -1e-9);
      const type = P.trim(L.den).slice().reverse().findIndex(c => Math.abs(c) > 1e-12);
      const Kp = type === 0 ? TF.dcGain(L) : Infinity;
      const Kv = type === 1 ? P.evalR(L.num, 0) / P.trim(L.den).slice(0, -1).slice(-1)[0] : (type > 1 ? Infinity : 0);
      const T = stable ? simT(poles, 4, 80, 7) : 10;
      let res = null;
      try { res = CT.simulate({ plant: Tcl, T, Ts: T / 2000, uOpen: () => 1 }); } catch (e) { err.hidden = false; err.textContent = 'A função de transferência resultante é imprópria (grau do numerador maior que o do denominador) e não pode ser simulada.'; }
      if (res) stepPlot.set({ series: [{ name: 'y(t)', x: res.t, y: clipUnstable(res.y, 50), color: 'series-1', area: true }], refLines: [{ y: 1, label: 'r = 1' }, ...(stable ? [{ y: TF.dcGain(Tcl), label: `T(0) = ${fmt(TF.dcGain(Tcl), 3)}`, color: 'muted' }] : [])] });
      const lim = Math.max(1, ...poles.map(p => Math.hypot(p.re, p.im)), ...zeros.map(p => Math.hypot(p.re, p.im))) * 1.25;
      polePlot.opts.xDomain = [-lim, lim * 0.4]; polePlot.opts.yDomain = [-lim, lim];
      polePlot.set({ points: [
        { name: 'polos', x: poles.map(p => p.re), y: poles.map(p => p.im), shape: 'x', color: 'series-1', r: 6, labels: poles.map(p => C.fmt(p)) },
        { name: 'zeros', x: zeros.map(p => p.re), y: zeros.map(p => p.im), shape: 'o', color: 'series-2', r: 6, labels: zeros.map(p => C.fmt(p)) },
      ], bands: [{ x0: 0, x1: lim, color: 'crit', alpha: 0.07 }] });
      const box = readout([
        ['L(s) = K·G·H =', TF.toString(L)],
        ['T(s) = KG/(1+KGH) =', TF.toString(Tcl)],
        ['polos de malha fechada', el('span', {}, polesText(poles) + '  ', stabilityPill(poles))],
        ['zeros de malha fechada', zeros.length ? polesText(zeros) : 'nenhum'],
        ['ganho DC T(0)', fmtG(TF.dcGain(Tcl))],
        ['tipo do sistema', `${type} → erro ao degrau ${type === 0 ? fmt(1 / (1 + Kp), 3) + ' (Kp = ' + fmt(Kp, 3) + ')' : '0'}, erro à rampa ${type === 0 ? '∞' : type === 1 ? fmt(1 / Kv, 3) + ' (Kv = ' + fmt(Kv, 3) + ')' : '0'}`],
      ]);
      ro.replaceChildren(box);
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: G = 1/(s² + 3s + 2), H = 1. Varra K de 0,1 a 200: o ganho DC sobe em direção a 1 sem nunca chegar lá (tipo 0), e os polos deixam o eixo real e seguem para o eixo imaginário sem cruzá-lo (uma malha de segunda ordem com P não instabiliza). Depois acrescente um integrador: denominador de G "1 3 2 0". Agora ela instabiliza.' }));
  };

  // ====================================================== 3.2 Routh
  CT.labs['routh'] = root => {
    const f = labFrame(root);
    const st = { n: '1', d: '1 3 2 0', K: 3 };
    const upd = frame(update);
    f.controls.append(
      textField({ id: 'l32-n', label: 'N(s)', value: st.n, onChange: v => { st.n = v; upd(); } }).root,
      textField({ id: 'l32-d', label: 'D(s)', value: st.d, hint: 'polinômio característico = D(s) + K·N(s); coeficientes separados por espaço', onChange: v => { st.d = v; upd(); } }).root,
      slider({ id: 'l32-K', label: 'Ganho K', min: 0.1, max: 100, log: true, value: st.K, onInput: v => { st.K = v; upd(); } }).root,
    );
    const verdict = el('div', { class: 'status-line' }); f.controls.append(verdict);
    const tblWrap = el('div', { class: 'table-wrap' }); f.plots.append(el('div', { class: 'plot-title', text: 'Tabela de Routh' }), tblWrap);
    const notes = el('ul', { class: 'ref-list' }); f.plots.append(notes);
    const rootsEl = el('div'); f.plots.append(el('div', { class: 'plot-title', text: 'Raízes numéricas (para confirmação)' }), rootsEl);
    function update() {
      const n = parsePoly(st.n), d = parsePoly(st.d);
      if (!n || !d) { verdict.className = 'status-line crit'; verdict.textContent = 'Não foi possível interpretar os polinômios.'; return; }
      const poly = P.add(d, P.scale(n, st.K));
      const r = CT.routh(poly);
      const t = el('table', { class: 'routh-table' });
      const thead = el('thead', {}, el('tr', {}, el('th', { text: 'linha' }), ...r.rows[0].map((_, j) => el('th', { text: `col ${j + 1}` }))));
      const tb = el('tbody');
      r.rows.forEach((row, i) => {
        const tr = el('tr', {}, el('td', { text: `s^${r.powers[i]}` }));
        row.forEach((v, j) => tr.append(el('td', { text: Math.abs(v) < 1e-12 ? '0' : CT.fmtNum(v, 4), style: j === 0 ? 'font-weight:600' : null })));
        tb.append(tr);
      });
      t.append(thead, tb);
      tblWrap.replaceChildren(t);
      notes.replaceChildren(...r.notes.map(x => el('li', { text: x })));
      const roots = P.roots(poly);
      rootsEl.replaceChildren(el('div', { class: 'readout-box' }, el('div', {}, el('b', { text: 'polinômio ' }), P.toString(poly)), el('div', {}, el('b', { text: 'raízes ' }), polesText(roots), '  ', stabilityPill(roots))));
      verdict.className = 'status-line ' + (r.rhp === 0 ? 'good' : 'crit');
      verdict.textContent = r.rhp === 0 ? `Nenhuma troca de sinal na primeira coluna: todas as raízes no semiplano esquerdo para K = ${fmt(st.K)}.` : `${r.rhp} troca${r.rhp > 1 ? 's' : ''} de sinal na primeira coluna → ${r.rhp} raiz${r.rhp > 1 ? 'es' : ''} no semiplano direito para K = ${fmt(st.K)}.`;
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: com o padrão s³ + 3s² + 2s + K, a linha s¹ vale (6 − K)/3. Varra K através de 6 e observe o sinal inverter enquanto as raízes cruzam o eixo imaginário em ±j√2. Depois tente D = "1 0 1 0" (s³ + s) com N = "1": um caso de linha nula.' }));
  };

  // ====================================================== 4.1 malha aberta × malha fechada
  CT.labs['ol-vs-cl'] = root => {
    const f = labFrame(root);
    const nominal = { K: 2, tau: 5 };
    const st = { drift: 0, dist: -0.5, noise: 0, mode: 'P', Kp: 3, Ti: 5 };
    const upd = frame(update);
    const sTi = slider({ id: 'l41-Ti', label: 'Tempo integral Ti', min: 0.5, max: 50, step: 0.5, value: st.Ti, unit: 's', onInput: v => { st.Ti = v; upd(); } });
    f.controls.append(
      CT.ui.group('Realidade × modelo',
        slider({ id: 'l41-drift', label: 'Ganho real da planta em relação ao nominal', min: -60, max: 60, step: 5, value: st.drift, unit: '%', onInput: v => { st.drift = v; upd(); } }).root,
        slider({ id: 'l41-dist', label: 'Perturbação de carga em t = 25 s', min: -1, max: 1, step: 0.1, value: st.dist, onInput: v => { st.dist = v; upd(); } }).root,
        slider({ id: 'l41-noise', label: 'Ruído do sensor σ', min: 0, max: 0.05, step: 0.005, value: st.noise, digits: 3, onInput: v => { st.noise = v; upd(); } }).root,
      ),
      CT.ui.group('Controlador com realimentação',
        select({ id: 'l41-mode', label: 'Tipo', value: st.mode, options: [{ value: 'P', label: 'P' }, { value: 'PI', label: 'PI' }], onChange: v => { st.mode = v; sTi.root.hidden = v !== 'PI'; upd(); } }).root,
        slider({ id: 'l41-Kp', label: 'Ganho proporcional Kp', min: 0.1, max: 50, log: true, value: st.Kp, onInput: v => { st.Kp = v; upd(); } }).root,
        sTi.root,
      ),
    );
    sTi.root.hidden = true;
    const yPlot = plotIn(f.plots, { height: 250, xLabel: 't (s)', yLabel: 'y', title: 'Saída: malha aberta × malha fechada' });
    const uPlot = plotIn(f.plots, { height: 170, xLabel: 't (s)', yLabel: 'u', title: 'Sinal de controle' });
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const sPlot = plotIn(row, { height: 220, xLabel: 'ω (rad/s)', yLabel: '|S|', title: 'Sensibilidade |S(jω)| = |1/(1+L)|', xLog: true, yLog: true, includeZero: false });
    const mEl = el('div'); row.append(mEl);
    function update() {
      const Kreal = nominal.K * (1 + st.drift / 100);
      const plant = TF.make([Kreal], [nominal.tau, 1]);
      const T = 50, Ts = 0.05, tD = 25;
      const dist = CT.stepAt(tD, st.dist);
      const ol = CT.simulate({ plant, T, Ts, uOpen: r => 1 / nominal.K, disturbance: dist, noise: st.noise, seed: 11 });
      const pid = new CT.PID({ Kp: st.Kp, Ki: st.mode === 'PI' ? st.Kp / st.Ti : 0, Kd: 0, Ts });
      const cl = CT.simulate({ plant, T, Ts, controller: pid, disturbance: dist, noise: st.noise, seed: 11 });
      yPlot.set({
        series: [{ name: 'malha aberta', x: ol.t, y: ol.y, color: 'series-2' }, { name: 'malha fechada', x: cl.t, y: cl.y, color: 'series-1' }],
        refLines: [{ y: 1, label: 'referência' }], vlines: [{ x: tD, label: 'perturbação' }],
      });
      uPlot.set({ series: [{ name: 'malha aberta', x: ol.t, y: ol.u, color: 'series-2' }, { name: 'malha fechada', x: cl.t, y: cl.u, color: 'series-1' }] });
      const Ctf = CT.pidTF(st.Kp, st.mode === 'PI' ? st.Kp / st.Ti : 0, 0);
      const L = TF.series(Ctf, plant);
      const n = 200, w = new Float64Array(n), S = new Float64Array(n), one = new Float64Array(n).fill(1);
      for (let i = 0; i < n; i++) { w[i] = Math.pow(10, -2.5 + 3.5 * i / (n - 1)); S[i] = 1 / C.abs(C.add(C.of(1), TF.freq(L, w[i]))); }
      sPlot.set({ series: [{ name: 'malha aberta (sem rejeição)', x: w, y: one, color: 'series-2' }, { name: 'malha fechada', x: w, y: S, color: 'series-1' }] });
      const mo = CT.stepMetrics(ol, { t1: tD, ref: 1 }), mc = CT.stepMetrics(cl, { t1: tD, ref: 1 });
      const dO = CT.disturbanceMetrics(ol, { tD, scale: 1 }), dC = CT.disturbanceMetrics(cl, { tD, scale: 1 });
      mEl.replaceChildren(el('div', { class: 'plot-title', text: 'Medido' }), table([
        { key: 'm', label: '' }, { key: 'ol', label: 'Malha aberta', num: true }, { key: 'cl', label: 'Malha fechada', num: true },
      ], [
        { m: 'Erro em regime (antes de t = 25 s)', ol: fmt(mo.ess, 3), cl: fmt(mc.ess, 3) },
        { m: 'Sobressinal %', ol: fmt(mo.overshoot, 1), cl: fmt(mc.overshoot, 1) },
        { m: 'Desvio máximo após a perturbação', ol: fmt(dO.peak, 3), cl: fmt(dC.peak, 3) },
        { m: 'Recuperação a 2 % (s)', ol: isNaN(dO.recovery) ? 'nunca' : fmt(dO.recovery, 1), cl: isNaN(dC.recovery) ? 'nunca' : fmt(dC.recovery, 1) },
        { m: 'Excursão do sinal de controle', ol: fmt(CT.maxAbs(ol.u), 2), cl: fmt(CT.maxAbs(cl.u), 2) },
      ]));
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: com desvio de 0 % e sem perturbação, a malha aberta vence: exata, sem sobressinal, sem ruído em u. Agora reduza o ganho real em 30 %: a malha aberta fica em 0,7 para sempre; a realimentação P chega mais perto e a PI chega a 1. Acrescente ruído: só a malha fechada o transfere para u. Essa troca é a disciplina inteira.' }));
  };

  // ====================================================== questionários 1 a 4
  CT.quizzes.modeling = [
    { id: 'mod1', q: 'Um processo de primeira ordem atinge 63 % do valor final 8 s após um degrau. Aproximadamente quando ele fica dentro de 2 % do valor final?', options: ['16 s', '24 s', '31 s', '64 s'], answer: 2, explain: 'τ = 8 s, e o tempo de acomodação a 2 % vale cerca de 3,9τ ≈ 31 s (4τ = 32 s é o número redondo usual).' },
    { id: 'mod2', q: 'O coeficiente de amortecimento c de um sistema massa–mola–amortecedor é dobrado. O que acontece com o sobressinal e com a frequência natural?', options: ['Ambos diminuem', 'O sobressinal diminui; ωₙ não muda', 'O sobressinal não muda; ωₙ diminui', 'O sobressinal aumenta'], answer: 1, explain: 'ωₙ = √(k/m) não contém c. ζ = c/(2√(km)) dobra, e o sobressinal depende apenas de ζ.' },
    { id: 'mod3', q: 'Qual destes não tem função de transferência racional?', options: ['Um tanque com vazamento', 'Um motor CC', 'Uma esteira que leva material até um sensor', 'Um filtro RC'], answer: 2, explain: 'O atraso de transporte é e^{−Ls}: sem polos, sem zeros e com fase que cresce sem limite. Só pode ser aproximado racionalmente (Padé).' },
  ];
  CT.quizzes.laplace = [
    { id: 'lap1', q: 'Y(s) = 5/(s(s+2)). Qual é o limite de y(t) quando t → ∞?', options: ['0', '2,5', '5', 'O teorema não se aplica'], answer: 1, explain: 'sY(s) = 5/(s+2) tem o polo em −2, portanto o teorema do valor final se aplica: 5/2 = 2,5.' },
    { id: 'lap2', q: 'Um sistema tem polos em −1 ± 4j. Sua resposta ao impulso é…', options: ['uma senoide pura a 4 rad/s', 'uma oscilação amortecida, envoltória e^{−t}, a 4 rad/s', 'uma oscilação crescente', 'uma soma de duas exponenciais reais'], answer: 1, explain: 'Parte real −1 → envoltória e^{−t}; parte imaginária ±4 → seno/cosseno a 4 rad/s.' },
    { id: 'lap3', q: 'Acrescentar um zero a uma função de transferência…', options: ['acrescenta um novo modo decrescente', 'altera o peso com que os modos existentes se combinam', 'sempre a torna instável', 'remove o modo mais lento'], answer: 1, explain: 'Os modos vêm apenas dos polos. O zero altera os resíduos das frações parciais, de modo que as mesmas exponenciais se somam de forma diferente: mais sobressinal para um zero no semiplano esquerdo próximo da origem, resposta inversa para um zero no semiplano direito.' },
  ];
  CT.quizzes.transfer = [
    { id: 'tf1', q: 'Realimentação unitária em torno de L(s) = 10/(s+1). O erro em regime permanente para um degrau unitário é…', options: ['0', '1/11', '1/10', '10/11'], answer: 1, explain: 'Tipo 0, Kp = L(0) = 10, erro = 1/(1 + Kp) = 1/11 ≈ 0,09.' },
    { id: 'tf2', q: 'O polinômio característico é s³ + 2s² + 3s + K. Para quais K a malha é estável?', options: ['Apenas K > 0', '0 < K < 6', '0 < K < 3', 'K < 2'], answer: 1, explain: 'A linha s¹ de Routh vale (2·3 − K)/2, positiva enquanto K < 6; a linha s⁰ vale K, positiva enquanto K > 0.' },
    { id: 'tf3', q: 'O que a realimentação negativa faz com os polos de G?', options: ['Nada; os polos são propriedade da planta', 'Move-os: os polos de malha fechada são as raízes de 1 + GH', 'Remove-os', 'Espelha-os para o semiplano direito'], answer: 1, explain: 'O denominador de malha fechada é D_G D_H + N_G N_H. A realimentação é a única regra de composição que muda a posição dos polos, e por isso pode tanto estabilizar quanto instabilizar.' },
  ];
  CT.quizzes.feedback = [
    { id: 'fb1', q: 'Em uma frequência em que |L(jω)| = 100, uma perturbação na saída é atenuada aproximadamente por…', options: ['um fator 100', 'um fator 2', 'nada', 'um fator 10'], answer: 0, explain: '|S| = 1/|1 + L| ≈ 1/100 ali. Ganho de malha alto é o que a realimentação compra; o preço é pago onde |L| se aproxima de 1.' },
    { id: 'fb2', q: 'Qual afirmação sobre S e T é sempre verdadeira?', options: ['|S| + |T| = 1', 'S + T = 1', 'S·T = 1', 'T = 1/S'], answer: 1, explain: 'S + T = 1/(1+L) + L/(1+L) = 1 exatamente, em toda frequência. Os módulos não se somam, e por isso ambos podem passar de 1 perto do cruzamento.' },
    { id: 'fb3', q: 'O controle em malha aberta de uma planta estável nunca consegue…', options: ['ser exato', 'ser rápido', 'rejeitar uma perturbação que não mede', 'evitar o ruído do sensor'], answer: 2, explain: 'Sem medição da saída, não há no controlador nenhuma informação sobre a perturbação. Todo o resto da lista é um ponto forte da malha aberta.' },
  ];
})(window.CT);
