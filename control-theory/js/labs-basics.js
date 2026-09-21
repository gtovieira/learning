/* labs-basics.js — labs for modules 1–4: modeling, Laplace, block algebra, open loop vs feedback. */
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
  function polesText(poles) { return poles.length ? poles.map(p => C.fmt(p, 3)).join(',  ') : 'none'; }
  function stabilityPill(poles) {
    const ok = poles.every(p => p.re < -1e-9);
    const marginal = !ok && poles.every(p => p.re <= 1e-9);
    return el('span', { class: 'pill ' + (ok ? 'pill-good' : marginal ? 'pill-warn' : 'pill-crit'), text: ok ? '✓ stable' : marginal ? '△ marginal' : '✕ unstable' });
  }
  function clipUnstable(y, lim = 50) { const out = new Float64Array(y.length); for (let i = 0; i < y.length; i++) out[i] = Math.abs(y[i]) > lim ? NaN : y[i]; return out; }
  const simT = (poles, lo = 5, hi = 200, mult = 6) => {
    const re = poles.map(p => Math.abs(p.re)).filter(v => v > 1e-6);
    const slow = re.length ? Math.min(...re) : 1;
    return Math.min(hi, Math.max(lo, mult / slow));
  };
  CT.labs.util = { labFrame, plotIn, readout, polesText, stabilityPill, clipUnstable, simT };

  // ====================================================== 1.1 first order
  CT.labs['first-order'] = root => {
    const f = labFrame(root);
    const st = { K: 2, tau: 5, u0: 1 };
    const upd = frame(update);
    f.controls.append(
      slider({ id: 'l11-K', label: 'Gain K', min: 0.2, max: 5, step: 0.1, value: st.K, onInput: v => { st.K = v; upd(); } }).root,
      slider({ id: 'l11-tau', label: 'Time constant τ', min: 0.5, max: 20, step: 0.5, value: st.tau, unit: 's', onInput: v => { st.tau = v; upd(); } }).root,
      slider({ id: 'l11-u0', label: 'Input step u₀', min: 0.5, max: 2, step: 0.1, value: st.u0, onInput: v => { st.u0 = v; upd(); } }).root,
    );
    const ro = el('div'); f.controls.append(ro);
    const stepPlot = plotIn(f.plots, { height: 260, xLabel: 't (s)', yLabel: 'y', title: 'Step response', ariaLabel: 'First-order step response' });
    const polePlot = plotIn(f.plots, { height: 190, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 's-plane', equal: true, xDomain: [-2.4, 0.4], yDomain: [-0.8, 0.8], includeZeroX: true, table: false });
    function update() {
      const G = TF.make([st.K], [st.tau, 1]);
      const T = Math.max(6 * st.tau, 4);
      const res = CT.simulate({ plant: G, T, Ts: T / 1500, uOpen: () => st.u0 });
      const yf = st.K * st.u0;
      stepPlot.set({
        series: [
          { name: 'y(t)', x: res.t, y: res.y, color: 'series-1', area: true },
          { name: 'tangent at t = 0', x: [0, st.tau], y: [0, yf], color: 'muted', width: 1, noTip: true },
        ],
        refLines: [{ y: yf, label: `final value ${fmt(yf)}` }],
        markers: [{ x: st.tau, y: 0.632 * yf, label: 'τ · 63.2 %' }, { x: 4 * st.tau, y: 0.982 * yf, label: '4τ · 98.2 %', align: 'right' }],
      });
      polePlot.set({ points: [{ name: 'pole', x: [-1 / st.tau], y: [0], shape: 'x', color: 'series-1', r: 6, labels: [`p = −${fmt(1 / st.tau, 3)}`] }] });
      ro.replaceChildren(readout([
        ['G(s) =', TF.toString(G)],
        ['pole', `s = −1/τ = −${fmt(1 / st.tau, 3)}`],
        ['2 % settling', `3.9 τ = ${fmt(3.9 * st.tau, 1)} s`],
        ['initial slope', `K u₀ / τ = ${fmt(yf / st.tau, 3)} per s`],
      ]));
    }
    update();
    f.foot.append(el('p', { text: 'Try: double τ and confirm the tangent still hits the final value at exactly τ. Then change K and notice τ does not move. Gain and speed are independent knobs in a first-order system.' }));
  };

  // ====================================================== 1.2 second order
  CT.labs['second-order'] = root => {
    const f = labFrame(root);
    const st = { K: 1, wn: 1, zeta: 0.3 };
    const upd = frame(update);
    f.controls.append(
      slider({ id: 'l12-K', label: 'Gain K', min: 0.2, max: 3, step: 0.1, value: st.K, onInput: v => { st.K = v; upd(); } }).root,
      slider({ id: 'l12-wn', label: 'Natural frequency ωₙ', min: 0.2, max: 5, step: 0.1, value: st.wn, unit: 'rad/s', onInput: v => { st.wn = v; upd(); } }).root,
      slider({ id: 'l12-z', label: 'Damping ratio ζ', min: 0.05, max: 2, step: 0.05, value: st.zeta, onInput: v => { st.zeta = v; upd(); } }).root,
    );
    const regime = el('div', { class: 'status-line' }); f.controls.append(regime);
    const ro = el('div'); f.controls.append(ro);
    const stepPlot = plotIn(f.plots, { height: 260, xLabel: 't (s)', yLabel: 'y', title: 'Step response', ariaLabel: 'Second-order step response' });
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const polePlot = plotIn(row, { height: 220, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 's-plane (circle: radius ωₙ)', equal: true, includeZeroX: true, table: false });
    const mEl = el('div'); row.append(el('div', {}, el('div', { class: 'plot-title', text: 'Measured from the simulation' }), mEl));
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
        points: [{ name: 'closed-loop poles', x: poles.map(p => p.re), y: poles.map(p => p.im), shape: 'x', color: 'series-1', r: 6, labels: poles.map(p => C.fmt(p)) }],
      });
      const m = CT.stepMetrics(res, { ref: K });
      const Mp = zeta < 1 ? 100 * Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)) : 0;
      const tp = zeta < 1 ? Math.PI / (wn * Math.sqrt(1 - zeta * zeta)) : NaN;
      stepPlot.set({
        series: [{ name: 'y(t)', x: res.t, y: res.y, color: 'series-1', area: true }],
        refLines: [{ y: K, label: `final value ${fmt(K)}` }],
        markers: zeta < 1 ? [{ x: m.tmax, y: m.ymax, label: `peak: +${fmt(m.overshoot, 1)} %` }] : [],
        bands: [{ y0: K * 0.98, y1: K * 1.02, color: 'series-1', alpha: 0.12 }],
      });
      regime.textContent = zeta < 1 ? `Underdamped (ζ < 1): oscillates at ωd = ωₙ√(1−ζ²) = ${fmt(wn * Math.sqrt(1 - zeta * zeta))} rad/s` : zeta === 1 ? 'Critically damped (ζ = 1): repeated real pole, fastest response with no overshoot' : 'Overdamped (ζ > 1): two real poles, the slow one dominates';
      ro.replaceChildren(readout([
        ['poles', polesText(poles)],
        ['predicted Mp', zeta < 1 ? `${fmt(Mp, 1)} %` : '0 (no overshoot)'],
        ['predicted tp', zeta < 1 ? `${fmt(tp)} s` : '—'],
        ['predicted ts (2 %)', `4/(ζωₙ) = ${fmt(4 / (zeta * wn))} s`],
        ['tr ≈ 1.8/ωₙ', `${fmt(1.8 / wn)} s`],
      ]));
      metrics(mEl, [
        { label: 'Overshoot', value: m.overshoot, unit: '%', digits: 1 },
        { label: 'Peak time', value: m.peakTime, unit: 's' },
        { label: 'Settling (2 %)', value: m.settled ? m.settling : NaN, unit: 's' },
        { label: 'Rise 10–90 %', value: m.rise, unit: 's' },
      ]);
    }
    update();
    f.foot.append(el('p', { text: 'Try: set ζ = 0.7 and read the overshoot (about 4.6 %). Then hold ζ and change ωₙ: the shape stays identical, only the time axis stretches. Shape is ζ; speed is ωₙ.' }));
  };

  // ====================================================== 1.3 DC motor
  CT.labs['motor'] = root => {
    const f = labFrame(root);
    const st = { J: 0.01, b: 0.1, Kt: 0.1, R: 1, L: 0.5 };
    const upd = frame(update);
    f.controls.append(
      slider({ id: 'l13-J', label: 'Inertia J', min: 0.001, max: 0.1, log: true, value: st.J, unit: 'kg·m²', onInput: v => { st.J = v; upd(); } }).root,
      slider({ id: 'l13-b', label: 'Friction b', min: 0.01, max: 1, log: true, value: st.b, unit: 'N·m·s', onInput: v => { st.b = v; upd(); } }).root,
      slider({ id: 'l13-Kt', label: 'Kt = Ke', min: 0.01, max: 1, log: true, value: st.Kt, unit: 'N·m/A', onInput: v => { st.Kt = v; upd(); } }).root,
      slider({ id: 'l13-R', label: 'Resistance R', min: 0.2, max: 10, step: 0.1, value: st.R, unit: 'Ω', onInput: v => { st.R = v; upd(); } }).root,
      slider({ id: 'l13-L', label: 'Inductance L', min: 0.01, max: 2, log: true, value: st.L, unit: 'H', onInput: v => { st.L = v; upd(); } }).root,
    );
    const ro = el('div'); f.controls.append(ro);
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const wPlot = plotIn(row, { height: 230, xLabel: 't (s)', yLabel: 'ω (rad/s)', title: 'Speed for a 1 V step' });
    const iPlot = plotIn(row, { height: 230, xLabel: 't (s)', yLabel: 'i (A)', title: 'Armature current for a 1 V step' });
    function update() {
      const { J, b, Kt, R, L } = st;
      const den = P.add(P.mul([L, R], [J, b]), [Kt * Kt]);
      const Gw = TF.make([Kt], den), Gi = TF.make([J, b], den);
      const poles = TF.poles(Gw);
      const T = simT(poles, 0.2, 60, 7);
      const rw = CT.simulate({ plant: Gw, T, Ts: T / 2000, uOpen: () => 1 });
      const ri = CT.simulate({ plant: Gi, T, Ts: T / 2000, uOpen: () => 1 });
      wPlot.set({ series: [{ name: 'ω(t)', x: rw.t, y: rw.y, color: 'series-1', area: true }], refLines: [{ y: TF.dcGain(Gw), label: `DC gain ${fmt(TF.dcGain(Gw), 3)} rad/s per V` }] });
      iPlot.set({ series: [{ name: 'i(t)', x: ri.t, y: ri.y, color: 'series-2', area: true }], refLines: [{ y: TF.dcGain(Gi), label: `steady current ${fmt(TF.dcGain(Gi), 3)} A` }] });
      ro.replaceChildren(readout([
        ['Ω(s)/V(s) =', TF.toString(Gw)],
        ['poles', polesText(poles)],
        ['mechanical τ = J/b', `${fmt(J / b, 3)} s`],
        ['electrical τ = L/R', `${fmt(L / R, 3)} s`],
        ['stall current V/R', `${fmt(1 / R, 3)} A`],
      ]));
    }
    update();
    f.foot.append(el('p', { text: 'Try: make L small (0.01 H). The two poles separate widely, the current becomes almost algebraic, and the speed looks first order: the model a speed loop can use. Now make Kt large: the back-EMF coupling starts to dominate over friction and the DC gain approaches 1/Ke.' }));
  };

  // ====================================================== 2.1 signals
  CT.labs['signals'] = root => {
    const f = labFrame(root);
    const sigs = {
      step: { name: 'Unit step', f: () => 1, F: '\\dfrac{1}{s}', poles: () => [C.of(0)], zeros: () => [], T: () => 10 },
      ramp: { name: 'Ramp t', f: t => t, F: '\\dfrac{1}{s^2}', poles: () => [C.of(0), C.of(0)], zeros: () => [], T: () => 10 },
      exp: { name: 'Exponential e^{−at}', f: (t, p) => Math.exp(-p.a * t), F: '\\dfrac{1}{s+a}', poles: p => [C.of(-p.a)], zeros: () => [], T: p => 6 / p.a, params: ['a'] },
      texp: { name: 't·e^{−at}', f: (t, p) => t * Math.exp(-p.a * t), F: '\\dfrac{1}{(s+a)^2}', poles: p => [C.of(-p.a), C.of(-p.a)], zeros: () => [], T: p => 8 / p.a, params: ['a'] },
      sin: { name: 'sin ωt', f: (t, p) => Math.sin(p.w * t), F: '\\dfrac{\\omega}{s^2+\\omega^2}', poles: p => [C.of(0, p.w), C.of(0, -p.w)], zeros: () => [], T: p => 3 * 2 * Math.PI / p.w, params: ['w'] },
      cos: { name: 'cos ωt', f: (t, p) => Math.cos(p.w * t), F: '\\dfrac{s}{s^2+\\omega^2}', poles: p => [C.of(0, p.w), C.of(0, -p.w)], zeros: () => [C.of(0)], T: p => 3 * 2 * Math.PI / p.w, params: ['w'] },
      dsin: { name: 'e^{−at} sin ωt', f: (t, p) => Math.exp(-p.a * t) * Math.sin(p.w * t), F: '\\dfrac{\\omega}{(s+a)^2+\\omega^2}', poles: p => [C.of(-p.a, p.w), C.of(-p.a, -p.w)], zeros: () => [], T: p => Math.max(5 / p.a, 2 * 2 * Math.PI / p.w), params: ['a', 'w'] },
      dcos: { name: 'e^{−at} cos ωt', f: (t, p) => Math.exp(-p.a * t) * Math.cos(p.w * t), F: '\\dfrac{s+a}{(s+a)^2+\\omega^2}', poles: p => [C.of(-p.a, p.w), C.of(-p.a, -p.w)], zeros: p => [C.of(-p.a)], T: p => Math.max(5 / p.a, 2 * 2 * Math.PI / p.w), params: ['a', 'w'] },
    };
    const st = { id: 'dsin', a: 0.5, w: 3 };
    const upd = frame(update);
    const sel = select({ id: 'l21-sig', label: 'Signal f(t)', value: st.id, options: Object.entries(sigs).map(([k, v]) => ({ value: k, label: v.name })), onChange: v => { st.id = v; showParams(); upd(); } });
    const sa = slider({ id: 'l21-a', label: 'Decay rate a', min: 0.1, max: 5, step: 0.1, value: st.a, onInput: v => { st.a = v; upd(); } });
    const sw = slider({ id: 'l21-w', label: 'Frequency ω', min: 0.5, max: 10, step: 0.5, value: st.w, unit: 'rad/s', onInput: v => { st.w = v; upd(); } });
    const Fel = el('div');
    f.controls.append(sel.root, sa.root, sw.root, el('div', {}, el('div', { class: 'ctl-label', text: 'F(s)' }), Fel));
    const ro = el('div'); f.controls.append(ro);
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const tPlot = plotIn(row, { height: 240, xLabel: 't (s)', yLabel: 'f(t)', title: 'Time domain' });
    const sPlot = plotIn(row, { height: 240, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 's-plane: × poles, ○ zeros', equal: true, includeZeroX: true, table: false });
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
          { name: 'poles', x: poles.map(p => p.re), y: poles.map(p => p.im), shape: 'x', color: 'series-1', r: 6, labels: poles.map(p => C.fmt(p)) },
          { name: 'zeros', x: zeros.map(p => p.re), y: zeros.map(p => p.im), shape: 'o', color: 'series-2', r: 6, labels: zeros.map(p => C.fmt(p)) },
        ],
      });
      Fel.replaceChildren(tex(s.F, true));
      ro.replaceChildren(readout([['poles', polesText(poles)], ['zeros', zeros.length ? polesText(zeros) : 'none'], ['mode', st.id.startsWith('d') ? `decays with e^{−${st.a}t}, rings at ${st.w} rad/s` : sigs[st.id].name]]));
    }
    showParams(); update();
    f.foot.append(el('p', { text: 'Every entry is the same picture: real part of the pole → decay rate, imaginary part → oscillation frequency, and a zero only changes the phase of the ring (compare sin and cos).' }));
  };

  // ====================================================== 2.2 pole drag
  CT.labs['pole-drag'] = root => {
    const f = labFrame(root);
    const st = { mode: 'pair', zero: false, real: { re: -1.5 }, pair: { re: -0.5, im: 2 }, z: { re: -3 } };
    const upd = frame(update);
    const sel = select({ id: 'l22-mode', label: 'Pole configuration', value: st.mode, options: [{ value: 'real', label: 'One real pole' }, { value: 'pair', label: 'Complex pair' }, { value: 'both', label: 'Real pole + complex pair' }], onChange: v => { st.mode = v; upd(); } });
    const tz = toggle({ id: 'l22-zero', label: 'Add a real zero (drag the ○)', checked: st.zero, onChange: v => { st.zero = v; upd(); } });
    f.controls.append(sel.root, tz.root);
    const ro = el('div'); f.controls.append(ro);
    const fvt = el('div', { class: 'status-line' }); f.controls.append(fvt);
    const sPlot = plotIn(f.plots, {
      height: 300, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 's-plane — drag the handles', equal: true, includeZeroX: true, table: false,
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
    const impPlot = plotIn(row, { height: 220, xLabel: 't (s)', yLabel: 'g(t)', title: 'Impulse response' });
    const stepPlot = plotIn(row, { height: 220, xLabel: 't (s)', yLabel: 'y(t)', title: 'Step response' });
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
      if (st.mode === 'real' || st.mode === 'both') drags.push({ id: 'real', x: st.real.re, y: 0, label: 'real pole', snapReal: true });
      if (st.mode === 'pair' || st.mode === 'both') drags.push({ id: 'pair', x: st.pair.re, y: st.pair.im, label: 'pair' });
      if (st.zero) drags.push({ id: 'zero', x: st.z.re, y: 0, shape: 'o', label: 'zero', color: 'series-2', snapReal: true });
      const mirror = (st.mode !== 'real' && st.pair.im >= 0.02) ? [{ name: 'conjugate', x: [st.pair.re], y: [-st.pair.im], shape: 'x', color: 'series-1', r: 6 }] : [];
      sPlot.set({ drags, points: mirror, bands: [{ x0: 0, x1: 2, color: 'crit', alpha: 0.07 }], texts: [{ x: 0.15, y: 4.1, text: 'unstable region', color: 'muted' }] });
      impPlot.set({ series: [{ name: 'g(t)', x: imp.t, y: clipUnstable(imp.y, 30), color: 'series-3' }] });
      stepPlot.set({ series: [{ name: 'y(t)', x: resS.t, y: clipUnstable(resS.y, 30), color: 'series-1', area: true }], refLines: stable ? [{ y: TF.dcGain(G), label: `G(0) = ${fmt(TF.dcGain(G))}` }] : [] });
      const modes = poles.filter((p, i) => p.im >= 0).map(p => p.im > 1e-9 ? `e^{${fmt(p.re)} t}·sin(${fmt(p.im)} t + φ)` : `e^{${fmt(p.re)} t}`);
      ro.replaceChildren(readout([
        ['G(s) =', TF.toString(G)],
        ['poles', polesText(poles)],
        ['zeros', zeros.length ? polesText(zeros) : 'none'],
        ['modes', modes.join(',  ')],
      ]));
      const yEnd = resS.y[resS.y.length - 1];
      fvt.className = 'status-line ' + (stable ? 'good' : 'crit');
      fvt.textContent = stable
        ? `Final value theorem: lim s·Y(s) = G(0) = ${fmt(TF.dcGain(G), 3)}. Simulated y(${fmt(T, 0)} s) = ${fmt(yEnd, 3)}.`
        : 'A pole has Re ≥ 0: the final value theorem does not apply and the response does not settle.';
    }
    update();
    f.foot.append(el('p', { text: 'Try: drag the pair straight up. The decay stays the same and only the ring frequency changes. Drag it left: same ring, faster decay. Push it across the axis: growth. Then add the zero and bring it toward the origin from the left: overshoot appears with no change in poles. Cross into the right half-plane with the zero and the step response starts in the wrong direction.' }));
  };

  // ====================================================== 3.1 block algebra
  CT.labs['block-algebra'] = root => {
    const f = labFrame(root);
    const st = { gn: '1', gd: '1, 3, 2', hn: '1', hd: '1', K: 4 };
    const upd = frame(update);
    const fields = [
      textField({ id: 'l31-gn', label: 'G numerator', value: st.gn, onChange: v => { st.gn = v; upd(); } }),
      textField({ id: 'l31-gd', label: 'G denominator', value: st.gd, hint: 'coefficients, highest power first: "1, 3, 2" = s² + 3s + 2', onChange: v => { st.gd = v; upd(); } }),
      textField({ id: 'l31-hn', label: 'H numerator', value: st.hn, onChange: v => { st.hn = v; upd(); } }),
      textField({ id: 'l31-hd', label: 'H denominator', value: st.hd, onChange: v => { st.hd = v; upd(); } }),
    ];
    const sK = slider({ id: 'l31-K', label: 'Loop gain K (in front of G)', min: 0.01, max: 200, log: true, value: st.K, onInput: v => { st.K = v; upd(); } });
    f.controls.append(...fields.map(x => x.root), sK.root);
    const err = el('div', { class: 'status-line crit', hidden: true }); f.controls.append(err);
    const ro = el('div'); f.plots.append(ro);
    const stepPlot = plotIn(f.plots, { height: 250, xLabel: 't (s)', yLabel: 'y', title: 'Closed-loop step response  r → y' });
    const polePlot = plotIn(f.plots, { height: 200, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 'Closed-loop poles (×) and zeros (○)', equal: true, includeZeroX: true, table: false });
    function update() {
      const gn = parsePoly(st.gn), gd = parsePoly(st.gd), hn = parsePoly(st.hn), hd = parsePoly(st.hd);
      if (!gn || !gd || !hn || !hd) { err.hidden = false; err.textContent = 'Could not parse a coefficient list. Use numbers separated by commas or spaces.'; return; }
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
      try { res = CT.simulate({ plant: Tcl, T, Ts: T / 2000, uOpen: () => 1 }); } catch (e) { err.hidden = false; err.textContent = e.message; }
      if (res) stepPlot.set({ series: [{ name: 'y(t)', x: res.t, y: clipUnstable(res.y, 50), color: 'series-1', area: true }], refLines: [{ y: 1, label: 'r = 1' }, ...(stable ? [{ y: TF.dcGain(Tcl), label: `T(0) = ${fmt(TF.dcGain(Tcl), 3)}`, color: 'muted' }] : [])] });
      const lim = Math.max(1, ...poles.map(p => Math.hypot(p.re, p.im)), ...zeros.map(p => Math.hypot(p.re, p.im))) * 1.25;
      polePlot.opts.xDomain = [-lim, lim * 0.4]; polePlot.opts.yDomain = [-lim, lim];
      polePlot.set({ points: [
        { name: 'poles', x: poles.map(p => p.re), y: poles.map(p => p.im), shape: 'x', color: 'series-1', r: 6, labels: poles.map(p => C.fmt(p)) },
        { name: 'zeros', x: zeros.map(p => p.re), y: zeros.map(p => p.im), shape: 'o', color: 'series-2', r: 6, labels: zeros.map(p => C.fmt(p)) },
      ], bands: [{ x0: 0, x1: lim, color: 'crit', alpha: 0.07 }] });
      const box = readout([
        ['L(s) = K·G·H =', TF.toString(L)],
        ['T(s) = KG/(1+KGH) =', TF.toString(Tcl)],
        ['closed-loop poles', el('span', {}, polesText(poles) + '  ', stabilityPill(poles))],
        ['closed-loop zeros', zeros.length ? polesText(zeros) : 'none'],
        ['DC gain T(0)', fmtG(TF.dcGain(Tcl))],
        ['system type', `${type} → step error ${type === 0 ? fmt(1 / (1 + Kp), 3) + ' (Kp = ' + fmt(Kp, 3) + ')' : '0'}, ramp error ${type === 0 ? '∞' : type === 1 ? fmt(1 / Kv, 3) + ' (Kv = ' + fmt(Kv, 3) + ')' : '0'}`],
      ]);
      ro.replaceChildren(box);
    }
    update();
    f.foot.append(el('p', { text: 'Try: G = 1/(s² + 3s + 2), H = 1. Sweep K from 0.1 to 200: the DC gain climbs toward 1 but never reaches it (type 0), and the poles leave the real axis and head for the imaginary axis without ever crossing (a second-order loop with P cannot go unstable). Then put a zero-free integrator in: G denominator "1, 3, 2, 0". Now it can.' }));
  };

  // ====================================================== 3.2 Routh
  CT.labs['routh'] = root => {
    const f = labFrame(root);
    const st = { n: '1', d: '1, 3, 2, 0', K: 3 };
    const upd = frame(update);
    f.controls.append(
      textField({ id: 'l32-n', label: 'N(s)', value: st.n, onChange: v => { st.n = v; upd(); } }).root,
      textField({ id: 'l32-d', label: 'D(s)', value: st.d, hint: 'characteristic polynomial = D(s) + K·N(s)', onChange: v => { st.d = v; upd(); } }).root,
      slider({ id: 'l32-K', label: 'Gain K', min: 0.1, max: 100, log: true, value: st.K, onInput: v => { st.K = v; upd(); } }).root,
    );
    const verdict = el('div', { class: 'status-line' }); f.controls.append(verdict);
    const tblWrap = el('div', { class: 'table-wrap' }); f.plots.append(el('div', { class: 'plot-title', text: 'Routh table' }), tblWrap);
    const notes = el('ul', { class: 'ref-list' }); f.plots.append(notes);
    const rootsEl = el('div'); f.plots.append(el('div', { class: 'plot-title', text: 'Numerical roots (for confirmation)' }), rootsEl);
    function update() {
      const n = parsePoly(st.n), d = parsePoly(st.d);
      if (!n || !d) { verdict.className = 'status-line crit'; verdict.textContent = 'Could not parse the polynomials.'; return; }
      const poly = P.add(d, P.scale(n, st.K));
      const r = CT.routh(poly);
      const t = el('table', { class: 'routh-table' });
      const thead = el('thead', {}, el('tr', {}, el('th', { text: 'row' }), ...r.rows[0].map((_, j) => el('th', { text: `col ${j + 1}` }))));
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
      rootsEl.replaceChildren(el('div', { class: 'readout-box' }, el('div', {}, el('b', { text: 'polynomial ' }), P.toString(poly)), el('div', {}, el('b', { text: 'roots ' }), polesText(roots), '  ', stabilityPill(roots))));
      verdict.className = 'status-line ' + (r.rhp === 0 ? 'good' : 'crit');
      verdict.textContent = r.rhp === 0 ? `No sign change in the first column: all roots in the left half-plane at K = ${fmt(st.K)}.` : `${r.rhp} sign change${r.rhp > 1 ? 's' : ''} in the first column → ${r.rhp} right-half-plane root${r.rhp > 1 ? 's' : ''} at K = ${fmt(st.K)}.`;
    }
    update();
    f.foot.append(el('p', { text: 'Try: with the default s³ + 3s² + 2s + K, the s¹ row is (6 − K)/3. Sweep K across 6 and watch the sign flip while the roots cross the imaginary axis at ±j√2. Then try D = "1, 0, 1, 0" (s³ + s) with N = "1": a zero-row case.' }));
  };

  // ====================================================== 4.1 open loop vs closed loop
  CT.labs['ol-vs-cl'] = root => {
    const f = labFrame(root);
    const nominal = { K: 2, tau: 5 };
    const st = { drift: 0, dist: -0.5, noise: 0, mode: 'P', Kp: 3, Ti: 5 };
    const upd = frame(update);
    const sTi = slider({ id: 'l41-Ti', label: 'Integral time Ti', min: 0.5, max: 50, step: 0.5, value: st.Ti, unit: 's', onInput: v => { st.Ti = v; upd(); } });
    f.controls.append(
      CT.ui.group('Reality vs model',
        slider({ id: 'l41-drift', label: 'Real plant gain vs nominal', min: -60, max: 60, step: 5, value: st.drift, unit: '%', onInput: v => { st.drift = v; upd(); } }).root,
        slider({ id: 'l41-dist', label: 'Load disturbance at t = 25 s', min: -1, max: 1, step: 0.1, value: st.dist, onInput: v => { st.dist = v; upd(); } }).root,
        slider({ id: 'l41-noise', label: 'Sensor noise σ', min: 0, max: 0.05, step: 0.005, value: st.noise, digits: 3, onInput: v => { st.noise = v; upd(); } }).root,
      ),
      CT.ui.group('Feedback controller',
        select({ id: 'l41-mode', label: 'Type', value: st.mode, options: [{ value: 'P', label: 'P' }, { value: 'PI', label: 'PI' }], onChange: v => { st.mode = v; sTi.root.hidden = v !== 'PI'; upd(); } }).root,
        slider({ id: 'l41-Kp', label: 'Proportional gain Kp', min: 0.1, max: 50, log: true, value: st.Kp, onInput: v => { st.Kp = v; upd(); } }).root,
        sTi.root,
      ),
    );
    sTi.root.hidden = true;
    const yPlot = plotIn(f.plots, { height: 250, xLabel: 't (s)', yLabel: 'y', title: 'Output: open loop vs closed loop' });
    const uPlot = plotIn(f.plots, { height: 170, xLabel: 't (s)', yLabel: 'u', title: 'Control signal' });
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const sPlot = plotIn(row, { height: 220, xLabel: 'ω (rad/s)', yLabel: '|S|', title: 'Sensitivity |S(jω)| = |1/(1+L)|', xLog: true, yLog: true, includeZero: false });
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
        series: [{ name: 'open loop', x: ol.t, y: ol.y, color: 'series-2' }, { name: 'closed loop', x: cl.t, y: cl.y, color: 'series-1' }],
        refLines: [{ y: 1, label: 'setpoint' }], vlines: [{ x: tD, label: 'disturbance' }],
      });
      uPlot.set({ series: [{ name: 'open loop', x: ol.t, y: ol.u, color: 'series-2' }, { name: 'closed loop', x: cl.t, y: cl.u, color: 'series-1' }] });
      const Ctf = CT.pidTF(st.Kp, st.mode === 'PI' ? st.Kp / st.Ti : 0, 0);
      const L = TF.series(Ctf, plant);
      const n = 200, w = new Float64Array(n), S = new Float64Array(n), one = new Float64Array(n).fill(1);
      for (let i = 0; i < n; i++) { w[i] = Math.pow(10, -2.5 + 3.5 * i / (n - 1)); S[i] = 1 / C.abs(C.add(C.of(1), TF.freq(L, w[i]))); }
      sPlot.set({ series: [{ name: 'open loop (no rejection)', x: w, y: one, color: 'series-2' }, { name: 'closed loop', x: w, y: S, color: 'series-1' }] });
      const mo = CT.stepMetrics(ol, { t1: tD, ref: 1 }), mc = CT.stepMetrics(cl, { t1: tD, ref: 1 });
      const dO = CT.disturbanceMetrics(ol, { tD, scale: 1 }), dC = CT.disturbanceMetrics(cl, { tD, scale: 1 });
      mEl.replaceChildren(el('div', { class: 'plot-title', text: 'Measured' }), table([
        { key: 'm', label: '' }, { key: 'ol', label: 'Open loop', num: true }, { key: 'cl', label: 'Closed loop', num: true },
      ], [
        { m: 'Steady-state error (before t = 25 s)', ol: fmt(mo.ess, 3), cl: fmt(mc.ess, 3) },
        { m: 'Overshoot %', ol: fmt(mo.overshoot, 1), cl: fmt(mc.overshoot, 1) },
        { m: 'Peak deviation after disturbance', ol: fmt(dO.peak, 3), cl: fmt(dC.peak, 3) },
        { m: 'Recovery to 2 % (s)', ol: isNaN(dO.recovery) ? 'never' : fmt(dO.recovery, 1), cl: isNaN(dC.recovery) ? 'never' : fmt(dC.recovery, 1) },
        { m: 'Control signal spread', ol: fmt(CT.maxAbs(ol.u), 2), cl: fmt(CT.maxAbs(cl.u), 2) },
      ]));
    }
    update();
    f.foot.append(el('p', { text: 'Try: with 0 % drift and no disturbance, open loop wins: exact, no overshoot, no noise in u. Now drift the gain by −30 %: open loop lands at 0.7 forever; P feedback lands closer, and PI lands at 1. Add noise: only the closed loop passes it into u. That trade is the whole subject.' }));
  };

  // ====================================================== quizzes 1–4
  CT.quizzes.modeling = [
    { id: 'mod1', q: 'A first-order process reaches 63 % of its final value 8 s after a step. Roughly when is it within 2 % of the final value?', options: ['16 s', '24 s', '31 s', '64 s'], answer: 2, explain: 'τ = 8 s and the 2 % settling time is about 3.9τ ≈ 31 s (4τ = 32 s is the usual round number).' },
    { id: 'mod2', q: 'You double the damping coefficient c of a mass–spring–damper. What happens to the overshoot and to the natural frequency?', options: ['Both drop', 'Overshoot drops, ωₙ unchanged', 'Overshoot unchanged, ωₙ drops', 'Overshoot rises'], answer: 1, explain: 'ωₙ = √(k/m) does not contain c. ζ = c/(2√(km)) doubles, and overshoot depends on ζ alone.' },
    { id: 'mod3', q: 'Which of these has no rational transfer function?', options: ['A tank with a leak', 'A DC motor', 'A conveyor moving material to a sensor', 'An RC filter'], answer: 2, explain: 'Transport delay is e^{−Ls}: no poles, no zeros, and phase that grows without bound. It can only be approximated rationally (Padé).' },
  ];
  CT.quizzes.laplace = [
    { id: 'lap1', q: 'Y(s) = 5/(s(s+2)). What is lim y(t) as t → ∞?', options: ['0', '2.5', '5', 'The theorem does not apply'], answer: 1, explain: 'sY(s) = 5/(s+2) has its pole at −2, so the final-value theorem applies: 5/2 = 2.5.' },
    { id: 'lap2', q: 'A system has poles at −1 ± 4j. Its impulse response is…', options: ['a pure sinusoid at 4 rad/s', 'a decaying oscillation, envelope e^{−t}, ringing at 4 rad/s', 'a growing oscillation', 'a sum of two real exponentials'], answer: 1, explain: 'Real part −1 → envelope e^{−t}; imaginary part ±4 → sin/cos at 4 rad/s.' },
    { id: 'lap3', q: 'Adding a zero to a transfer function…', options: ['adds a new decaying mode', 'changes how the existing modes are weighted', 'always makes it unstable', 'removes the slowest mode'], answer: 1, explain: 'Modes come from poles only. The zero changes the partial-fraction residues, so the same exponentials add up differently: more overshoot for a LHP zero near the origin, inverse response for a RHP zero.' },
  ];
  CT.quizzes.transfer = [
    { id: 'tf1', q: 'Unity feedback around L(s) = 10/(s+1). The steady-state error to a unit step is…', options: ['0', '1/11', '1/10', '10/11'], answer: 1, explain: 'Type 0, Kp = L(0) = 10, error = 1/(1 + Kp) = 1/11 ≈ 0.09.' },
    { id: 'tf2', q: 'The characteristic polynomial is s³ + 2s² + 3s + K. For which K is the loop stable?', options: ['K > 0 only', '0 < K < 6', '0 < K < 3', 'K < 2'], answer: 1, explain: 'Routh row s¹ is (2·3 − K)/2, positive while K < 6; row s⁰ is K, positive while K > 0.' },
    { id: 'tf3', q: 'What does negative feedback do to the poles of G?', options: ['Nothing; poles are a property of the plant', 'Moves them: the closed-loop poles are the roots of 1 + GH', 'Removes them', 'Mirrors them into the right half-plane'], answer: 1, explain: 'The closed-loop denominator is D_G D_H + N_G N_H. Feedback is the only composition rule that changes where the poles are, which is why it can both stabilize and destabilize.' },
  ];
  CT.quizzes.feedback = [
    { id: 'fb1', q: 'At a frequency where |L(jω)| = 100, an output disturbance is attenuated by roughly…', options: ['a factor 100', 'a factor 2', 'nothing', 'a factor 10'], answer: 0, explain: '|S| = 1/|1 + L| ≈ 1/100 there. Large loop gain is what feedback buys; the price is paid where |L| approaches 1.' },
    { id: 'fb2', q: 'Which statement about S and T is always true?', options: ['|S| + |T| = 1', 'S + T = 1', 'S·T = 1', 'T = 1/S'], answer: 1, explain: 'S + T = 1/(1+L) + L/(1+L) = 1 exactly, at every frequency. Magnitudes do not add, which is why both can be larger than 1 near crossover.' },
    { id: 'fb3', q: 'Open-loop control of a stable plant can never…', options: ['be exact', 'be fast', 'reject a disturbance it does not measure', 'avoid sensor noise'], answer: 2, explain: 'Without a measurement of the output there is no information about the disturbance in the controller. Everything else on the list is a strength of open loop.' },
  ];
})(window.CT);
