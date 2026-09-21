/* labs-pid.js — labs for modules 5, 6, 9 and 10: PID sandbox, tuning bench, sampling, reference code, challenges. */
(function (CT) {
  'use strict';
  const { el, slider, select, toggle, metrics, table, fmt, fmtG, frame, plantPicker, group, button, tabs, codeBlock, store } = CT.ui;
  const { P, TF, C } = CT;
  const { labFrame, plotIn, readout, polesText, simT } = CT.labs.util;

  // ------------------------------------------------------------ helpers
  /* Open-loop step test on a plant → FOPDT fit → IMC PID. Fallbacks for plants that do not settle. */
  function autoTune(tf, plantId) {
    if (plantId === 'integrator') return { Kp: 2 / TF.dcGain(TF.make(tf.num, P.trim(tf.den).slice(0, -1))), Ki: 0, Kd: 0.8 / TF.dcGain(TF.make(tf.num, P.trim(tf.den).slice(0, -1))), why: 'integrating plant: PD preset (no FOPDT fit possible)' };
    const poles = TF.poles(tf);
    const T = simT(poles, 5, 400, 10) + (tf.delay || 0) * 3;
    const res = CT.simulate({ plant: tf, T, Ts: T / 3000, uOpen: () => 1 });
    const id = CT.identifyFOPDT(res, 1);
    if (!id || !isFinite(id.K) || id.K === 0 || !(id.tau > 0)) return { Kp: 1, Ki: 0.1, Kd: 0, why: 'fit failed: generic PI' };
    const lambda = Math.max(id.L, 0.3 * id.tau, 0.05);
    const g = CT.ruleById['imc-pid'].fn(id, lambda);
    const p = CT.standardToParallel(g.Kp, g.Ti, g.Td);
    return { ...p, ident: id, lambda, why: `IMC with λ = ${fmt(lambda)} s on the fitted FOPDT (K ${fmt(id.K)}, τ ${fmt(id.tau)} s, L ${fmt(id.L)} s)` };
  }

  function gainSliders(prefix, st, onInput, ranges = {}) {
    const r = Object.assign({ Kp: [0, 20, 0.05], Ki: [0, 3, 0.01], Kd: [0, 5, 0.01] }, ranges);
    const sKp = slider({ id: prefix + '-Kp', label: 'Kp (proportional)', min: r.Kp[0], max: r.Kp[1], step: r.Kp[2], value: st.Kp, onInput: v => { st.Kp = v; onInput(); } });
    const sKi = slider({ id: prefix + '-Ki', label: 'Ki (integral, per s)', min: r.Ki[0], max: r.Ki[1], step: r.Ki[2], value: st.Ki, onInput: v => { st.Ki = v; onInput(); } });
    const sKd = slider({ id: prefix + '-Kd', label: 'Kd (derivative, s)', min: r.Kd[0], max: r.Kd[1], step: r.Kd[2], value: st.Kd, onInput: v => { st.Kd = v; onInput(); } });
    const eq = el('div', { class: 'ctl-hint' });
    const root = el('div', { class: 'ctl-group-inner', style: 'display:flex;flex-direction:column;gap:8px' }, sKp.root, sKi.root, sKd.root, eq);
    const refresh = () => {
      sKp.set(st.Kp); sKi.set(st.Ki); sKd.set(st.Kd);
      const s = CT.parallelToStandard(st.Kp, st.Ki, st.Kd);
      eq.textContent = `Standard form: Ti = ${isFinite(s.Ti) ? fmt(s.Ti) + ' s' : '∞ (no integral)'}, Td = ${fmt(s.Td)} s`;
    };
    refresh();
    return { root, refresh, sliders: { sKp, sKi, sKd } };
  }

  function tailTV(res, seconds) {
    const t = res.t; let i0 = t.length - 1; while (i0 > 0 && t[t.length - 1] - t[i0] < seconds) i0--;
    return CT.totalVariation(res.u, i0);
  }

  // ====================================================== 5.1 PID sandbox
  CT.labs['pid-sandbox'] = root => {
    const f = labFrame(root);
    const st = { Kp: 1, Ki: 0, Kd: 0, N: 10, dOnMeas: true, aw: 'clamp', limits: false, umin: -1, umax: 2, noise: 0, dist: -0.5, b: 1, T: 60, parts: false, Ts: 0.05 };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l51', value: 'fopdt', onChange: () => upd() });
    const gains = gainSliders('l51', st, () => { presets.set('custom'); upd(); });
    const presets = select({
      id: 'l51-preset', label: 'Preset', value: 'custom',
      options: [{ value: 'custom', label: '— custom —' }, { value: 'p', label: 'P only (Kp = 1)' }, { value: 'pi', label: 'PI (Kp = 1, Ki = 0.2)' }, { value: 'pid', label: 'PID (Kp = 1.5, Ki = 0.2, Kd = 1)' }, { value: 'auto', label: 'Auto-tune (IMC on a step-test fit)' }],
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
    const sMin = slider({ id: 'l51-umin', label: 'u min', min: -3, max: 0, step: 0.1, value: st.umin, onInput: v => { st.umin = v; upd(); } });
    const sMax = slider({ id: 'l51-umax', label: 'u max', min: 0.5, max: 5, step: 0.1, value: st.umax, onInput: v => { st.umax = v; upd(); } });
    const awSel = select({ id: 'l51-aw', label: 'Anti-windup', value: st.aw, options: [{ value: 'clamp', label: 'Clamping (conditional integration)' }, { value: 'backcalc', label: 'Back-calculation (Tt = Ti)' }, { value: 'none', label: 'None (watch it wind up)' }], onChange: v => { st.aw = v; upd(); } });
    const limBox = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, sMin.root, sMax.root, awSel.root);
    limBox.hidden = true;
    f.controls.append(
      picker.root,
      group('Controller (parallel form)', presets.root, whyEl, gains.root),
      group('Practical details',
        slider({ id: 'l51-N', label: 'Derivative filter N (Tf = Td/N)', min: 2, max: 50, step: 1, value: st.N, onInput: v => { st.N = v; upd(); } }).root,
        toggle({ id: 'l51-dom', label: 'Derivative on measurement', checked: st.dOnMeas, hint: 'off = derivative on error (setpoint kick)', onChange: v => { st.dOnMeas = v; upd(); } }).root,
        slider({ id: 'l51-b', label: 'Setpoint weight b', min: 0, max: 1, step: 0.1, value: st.b, onInput: v => { st.b = v; upd(); } }).root,
        toggle({ id: 'l51-lim', label: 'Actuator limits', checked: st.limits, onChange: v => { st.limits = v; limBox.hidden = !v; upd(); } }).root,
        limBox,
      ),
      group('Scenario',
        slider({ id: 'l51-T', label: 'Simulation length', min: 20, max: 300, step: 10, value: st.T, unit: 's', onInput: v => { st.T = v; upd(); } }).root,
        slider({ id: 'l51-dist', label: 'Load disturbance at T/2', min: -1, max: 1, step: 0.1, value: st.dist, onInput: v => { st.dist = v; upd(); } }).root,
        slider({ id: 'l51-noise', label: 'Sensor noise σ', min: 0, max: 0.05, step: 0.005, value: st.noise, digits: 3, onInput: v => { st.noise = v; upd(); } }).root,
        toggle({ id: 'l51-parts', label: 'Show P / I / D contributions', checked: st.parts, onChange: v => { st.parts = v; partsPlot.el.hidden = !v; upd(); } }).root,
      ),
    );
    const yPlot = plotIn(f.plots, { height: 260, xLabel: 't (s)', yLabel: 'y', title: 'Process variable and setpoint', ariaLabel: 'Closed-loop response' });
    const uPlot = plotIn(f.plots, { height: 170, xLabel: 't (s)', yLabel: 'u', title: 'Controller output' });
    const partsPlot = plotIn(f.plots, { height: 190, xLabel: 't (s)', yLabel: 'contribution', title: 'Term contributions' });
    partsPlot.el.hidden = true;
    const mEl = el('div'); f.plots.append(mEl);
    const pidLine = el('div', { class: 'status-line' }); f.plots.append(pidLine);
    function update() {
      const p = picker.get();
      const T = st.T, tD = T / 2, Ts = st.Ts;
      const pid = new CT.PID({ Kp: st.Kp, Ki: st.Ki, Kd: st.Kd, Ts, N: st.N, dOnMeasurement: st.dOnMeas, antiWindup: st.aw, b: st.b, umin: st.limits ? st.umin : -Infinity, umax: st.limits ? st.umax : Infinity });
      const res = CT.simulate({ plant: p.tf, T, Ts, controller: pid, disturbance: CT.stepAt(tD, st.dist), noise: st.noise, seed: 5, record: 'parts' });
      const series = [{ name: 'setpoint r', x: res.t, y: res.r, color: 'ink-2', width: 1 }];
      if (st.noise > 0) series.push({ name: 'measured', x: res.t, y: res.ym, color: 'muted', width: 1, alpha: 0.7 });
      series.push({ name: 'output y', x: res.t, y: res.y, color: 'series-1' });
      yPlot.set({ series, vlines: [{ x: tD, label: 'load step' }] });
      uPlot.set({ series: [{ name: 'u', x: res.t, y: res.u, color: 'series-2' }], refLines: st.limits ? [{ y: st.umax, label: 'u max', color: 'crit' }, { y: st.umin, label: 'u min', color: 'crit' }] : [] });
      if (st.parts) partsPlot.set({ series: [{ name: 'P', x: res.t, y: res.parts.P, color: 'series-1' }, { name: 'I', x: res.t, y: res.parts.I, color: 'series-3' }, { name: 'D', x: res.t, y: res.parts.D, color: 'series-2' }] });
      const m = CT.stepMetrics(res, { t1: tD, ref: 1 });
      const d = CT.disturbanceMetrics(res, { tD, scale: 1 });
      metrics(mEl, [
        { label: 'Rise 10–90 %', value: m.rise, unit: 's' },
        { label: 'Overshoot', value: m.overshoot, unit: '%', digits: 1, status: m.overshoot < 10 ? 'good' : m.overshoot < 25 ? 'warn' : 'crit', note: m.overshoot < 10 ? 'ok' : m.overshoot < 25 ? 'high' : 'ringing' },
        { label: 'Settling 2 %', value: m.settled ? m.settling : NaN, unit: m.settled ? 's' : 'not settled', status: m.settled ? undefined : 'warn', note: 'before T/2' },
        { label: 'Steady-state error', value: m.ess, digits: 3, status: Math.abs(m.ess) < 0.01 ? 'good' : 'warn', note: Math.abs(m.ess) < 0.01 ? 'none' : 'offset' },
        { label: 'IAE (setpoint)', value: m.iae, digits: 2 },
        { label: 'Load: peak deviation', value: d ? d.peak : NaN, digits: 3 },
        { label: 'Load: recovery 2 %', value: d && !isNaN(d.recovery) ? d.recovery : NaN, unit: 's' },
        { label: 'Control effort TV(u)', value: CT.totalVariation(res.u), digits: 1 },
        { label: 'Time saturated', value: 100 * res.satFraction, unit: '%', digits: 0, status: res.satFraction > 0.3 ? 'warn' : undefined, note: 'windup risk' },
      ]);
      const Ctf = CT.pidTF(st.Kp, st.Ki, st.Kd, st.N);
      pidLine.textContent = `C(s) = ${TF.toString(Ctf)}   ·   Ts = ${Ts} s`;
    }
    update();
    f.foot.append(el('p', { text: 'Suggested route: Preset “P only”, raise Kp to 4 on the FOPDT plant and watch it ring. Back off to 2, add Ki = 0.25: the offset goes, the overshoot grows. Add Kd = 2: damped. Now enable actuator limits with u max = 1.2 and switch anti-windup to “None”: the integrator keeps charging while the actuator is pinned, and the loop overshoots by a mile when it lets go.' }));
  };

  // ====================================================== 6.1 tuning bench
  CT.labs['tuning-bench'] = root => {
    const f = labFrame(root);
    const st = { du: 1, lambda: 1, lambdaAuto: true, selected: new Set(['imc-pid', 'zn-ol-pid', 'simc-pi']), d: 1, eps: 0.02, ident: null, relay: null, exact: null, plant: null };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l61', value: 'cubic', onChange: () => { st.lambdaAuto = true; upd(); } });
    const sLam = slider({ id: 'l61-lam', label: 'λ (IMC / SIMC closed-loop time constant)', min: 0.05, max: 50, log: true, value: st.lambda, unit: 's', onInput: v => { st.lambda = v; st.lambdaAuto = false; upd(); } });
    const lamHint = el('div', { class: 'ctl-hint', text: 'Default λ = L (the fitted dead time). Move it to trade speed for robustness.' });
    f.controls.append(
      picker.root,
      group('Step test', slider({ id: 'l61-du', label: 'Step size Δu', min: 0.2, max: 2, step: 0.1, value: st.du, onInput: v => { st.du = v; upd(); } }).root),
      group('Rules', sLam.root, lamHint, el('div', { class: 'ctl-hint', text: 'Tick up to four rules in the table to compare them.' })),
      group('Relay experiment',
        slider({ id: 'l61-d', label: 'Relay amplitude d', min: 0.2, max: 2, step: 0.1, value: st.d, onInput: v => { st.d = v; upd(); } }).root,
        slider({ id: 'l61-eps', label: 'Hysteresis ε', min: 0, max: 0.1, step: 0.005, value: st.eps, digits: 3, onInput: v => { st.eps = v; upd(); } }).root,
      ),
    );
    const steps = el('div', { class: 'lab-steps' }, el('span', { class: 'step-chip is-on', text: '1 · Identify' }), el('span', { class: 'step-chip is-on', text: '2 · Apply rules & compare' }), el('span', { class: 'step-chip is-on', text: '3 · Relay experiment' }));
    f.plots.append(steps);
    const stepPlot = plotIn(f.plots, { height: 230, xLabel: 't (s)', yLabel: 'y', title: 'Step 1 — open-loop step test and FOPDT fit' });
    const identEl = el('div'); f.plots.append(identEl);
    const rulesWrap = el('div', { class: 'table-wrap' }); f.plots.append(el('div', { class: 'plot-title', text: 'Step 2 — gains from each rule (standard and parallel form)' }), rulesWrap);
    const cmpPlot = plotIn(f.plots, { height: 270, xLabel: 't (s)', yLabel: 'y', title: 'Closed-loop responses on the true plant (setpoint step, then load −0.5 at T/2)' });
    const cmpU = plotIn(f.plots, { height: 160, xLabel: 't (s)', yLabel: 'u', title: 'Controller outputs' });
    const cmpWrap = el('div', { class: 'table-wrap' }); f.plots.append(cmpWrap);
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const relayY = plotIn(row, { height: 200, xLabel: 't (s)', yLabel: 'y', title: 'Step 3 — relay experiment: output' });
    const relayU = plotIn(row, { height: 200, xLabel: 't (s)', yLabel: 'u', title: 'Relay output' });
    const relayEl = el('div'); f.plots.append(relayEl);
    function update() {
      const p = picker.get();
      const tf = p.tf;
      // Step 1: identification
      const poles = TF.poles(tf);
      const integrating = p.def.id === 'integrator';
      const T1 = simT(poles, 5, 400, 10) + (tf.delay || 0) * 3;
      const res = CT.simulate({ plant: tf, T: T1, Ts: T1 / 3000, uOpen: () => st.du });
      st.ident = integrating ? null : CT.identifyFOPDT(res, st.du);
      const id = st.ident;
      const series = [{ name: 'true plant', x: res.t, y: res.y, color: 'series-1' }];
      const markers = [];
      if (id && isFinite(id.K) && id.tau > 0) {
        const fit = TF.make([id.K], [id.tau, 1], id.L);
        const rf = CT.simulate({ plant: fit, T: T1, Ts: T1 / 3000, uOpen: () => st.du });
        series.push({ name: 'FOPDT fit', x: rf.t, y: rf.y, color: 'series-2' });
        markers.push({ x: id.t28, y: id.y0 + 0.283 * (id.yss - id.y0), label: 't₂₈' }, { x: id.t63, y: id.y0 + 0.632 * (id.yss - id.y0), label: 't₆₃' });
        if (st.lambdaAuto) { st.lambda = Math.max(0.05, id.L || 0.3 * id.tau); sLam.set(st.lambda); }
        const ratio = id.L / id.tau;
        identEl.replaceChildren(readout([
          ['fitted model', `K = ${fmt(id.K, 3)},  τ = ${fmt(id.tau)} s,  L = ${fmt(id.L)} s`],
          ['method', `two-point: τ = 1.5 (t₆₃ − t₂₈) = 1.5 (${fmt(id.t63)} − ${fmt(id.t28)}),  L = t₆₃ − τ`],
          ['difficulty L/τ', el('span', {}, `${fmt(ratio)}  `, el('span', { class: 'pill ' + (ratio < 0.1 ? 'pill-good' : ratio < 1 ? 'pill-good' : 'pill-warn'), text: ratio < 0.1 ? '✓ lag dominant: easy' : ratio < 1 ? '✓ balanced: any good rule works' : '△ dead-time dominant: go slow, PI' }))],
          ['true plant', TF.toString(tf)],
        ]));
      } else {
        identEl.replaceChildren(el('div', { class: 'status-line warn', text: integrating ? 'This plant integrates: the open-loop step never settles, so an FOPDT fit is meaningless. Only the ultimate-gain rules (step 3) apply here.' : 'The step test did not produce a usable fit.' }));
      }
      stepPlot.set({ series, markers, refLines: id ? [{ y: id.yss, label: 'final value' }] : [] });
      // Step 3: relay + exact ultimate values
      const bd = CT.bode(tf, 1e-3, 1e3, 1200);
      const mg = CT.margins(bd);
      st.exact = mg.gmDb != null ? { Ku: Math.pow(10, mg.gmDb / 20), Pu: 2 * Math.PI / mg.wpc } : null;
      const Tr = Math.min(600, Math.max(40, st.exact ? 12 * st.exact.Pu : 60));
      const rl = CT.relayTest(tf, { d: st.d, eps: st.eps, T: Tr, Ts: Tr / 6000 });
      st.relay = rl.ok ? rl : null;
      relayY.set({ series: [{ name: 'y', x: rl.res.t, y: rl.res.y, color: 'series-1' }], refLines: [{ y: 0, label: 'setpoint' }], bands: rl.ok ? [{ x0: rl.tStart, color: 'series-3', alpha: 0.08 }] : [] });
      relayU.set({ series: [{ name: 'relay u', x: rl.res.t, y: rl.res.u, color: 'series-2' }] });
      relayEl.replaceChildren(readout([
        ['limit cycle', rl.ok ? `amplitude a = ${fmt(rl.a, 3)},  period Pu = ${fmt(rl.Pu)} s  (measured over the shaded window)` : 'no stable limit cycle detected in the run'],
        ['relay estimate', rl.ok ? `Ku = 4d/(π√(a² − ε²)) = ${fmt(rl.Ku)}` : '—'],
        ['exact from L(jω)', st.exact ? `Ku = ${fmt(st.exact.Ku)} (gain margin of the plant alone),  Pu = ${fmt(st.exact.Pu)} s` : 'no phase crossover: proportional gain alone cannot destabilize this plant, so Ku does not exist and the relay numbers are an artifact of the hysteresis'],
      ]));
      // Step 2: rules table and comparison
      const rows = [];
      const gainsById = {};
      CT.rules.forEach((r, i) => {
        let g = null, avail = true;
        if (r.needs === 'fopdt') { if (id && isFinite(id.K) && id.tau > 0 && id.L > 0) g = r.fn(id, st.lambda); else if (id && id.L === 0 && r.hasLambda) g = r.fn({ ...id, L: 1e-3 }, st.lambda); else avail = false; }
        else { if (st.relay) g = r.fn({ Ku: st.relay.Ku, Pu: st.relay.Pu }); else avail = false; }
        if (g && (!isFinite(g.Kp) || g.Kp <= 0)) { g = null; avail = false; }
        gainsById[r.id] = g;
        const par = g ? CT.standardToParallel(g.Kp, g.Ti, g.Td) : null;
        const cb = el('input', { type: 'checkbox', id: 'l61-sel-' + r.id, checked: st.selected.has(r.id) ? true : null, disabled: !avail ? true : null });
        cb.addEventListener('change', () => { if (cb.checked) { if (st.selected.size >= 4) { cb.checked = false; return; } st.selected.add(r.id); } else st.selected.delete(r.id); upd(); });
        const key = el('span', { class: 'legend-glyph', style: `--c: var(--series-${i + 1}); margin-right:6px` });
        rows.push({ r, g, par, avail, cb, key, i });
      });
      rulesWrap.replaceChildren(table([
        { label: '', get: x => x.cb },
        { label: 'Rule', get: x => el('span', {}, x.key, el('label', { for: 'l61-sel-' + x.r.id, text: x.r.name })) },
        { label: 'Kp', num: true, get: x => x.g ? fmt(x.g.Kp, 3) : (x.r.needs === 'ultimate' ? 'needs relay' : 'needs fit') },
        { label: 'Ti (s)', num: true, get: x => x.g ? (isFinite(x.g.Ti) ? fmt(x.g.Ti) : '∞') : '—' },
        { label: 'Td (s)', num: true, get: x => x.g ? fmt(x.g.Td) : '—' },
        { label: 'Ki', num: true, get: x => x.par ? fmt(x.par.Ki, 3) : '—' },
        { label: 'Kd', num: true, get: x => x.par ? fmt(x.par.Kd, 3) : '—' },
        { label: 'Character', get: x => x.r.note },
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
        mrows.push({ name: x.r.name, key: el('span', { class: 'legend-glyph', style: `--c: var(--series-${x.i + 1}); margin-right:6px` }), os: fmt(m.overshoot, 1), ts: m.settled ? fmt(m.settling, 1) : 'no', iae: fmt(m.iae, 2), pk: d ? fmt(d.peak, 3) : '—', rec: d && !isNaN(d.recovery) ? fmt(d.recovery, 1) : 'no', tv: fmt(CT.totalVariation(cr.u), 1) });
      }
      ySeries.unshift({ name: 'setpoint', x: [0, Tc], y: [1, 1], color: 'ink-2', width: 1, noTip: true });
      cmpPlot.set({ series: ySeries, vlines: [{ x: tD, label: 'load −0.5' }] });
      cmpU.set({ series: uSeries });
      cmpWrap.replaceChildren(mrows.length ? table([
        { label: 'Rule', get: x => el('span', {}, x.key, x.name) },
        { label: 'Overshoot %', key: 'os', num: true }, { label: 'Settling 2 % (s)', key: 'ts', num: true }, { label: 'IAE setpoint', key: 'iae', num: true },
        { label: 'Load peak dev.', key: 'pk', num: true }, { label: 'Load recovery (s)', key: 'rec', num: true }, { label: 'TV(u)', key: 'tv', num: true },
      ], mrows) : el('p', { class: 'ctl-hint', text: 'Select at least one rule with available gains.' }));
    }
    update();
    f.foot.append(el('p', { text: 'Things to notice: on the three-lag plant the FOPDT fit is decent, and the quarter-decay rules (ZN, Cohen–Coon) do exactly what they promise: fast and ringing. IMC and SIMC with λ = L are calmer with similar load rejection. Compare the relay estimate of Ku with the exact one: the describing-function approximation is usually within 10–15 %. Then switch to the FOPDT plant and raise L to 8 s (L/τ = 1): the aggressive rules fall apart, the λ rules simply slow down.' }));
  };

  // ====================================================== 9.1 sampling
  CT.labs['sampling'] = root => {
    const f = labFrame(root);
    const st = { Ts: 0.05, noise: 0, N: 10, gains: null };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l91', value: 'second', params: { K: 1, wn: 1, zeta: 0.3 }, onChange: () => { st.gains = null; upd(); } });
    const gEl = el('div', { class: 'ctl-hint' });
    f.controls.append(
      picker.root,
      group('Controller (fixed, auto-tuned)', gEl, button('Re-tune for this plant', () => { st.gains = null; upd(); }, 'btn secondary')),
      group('Implementation',
        slider({ id: 'l91-Ts', label: 'Sample time Ts', min: 0.005, max: 3, log: true, value: st.Ts, unit: 's', onInput: v => { st.Ts = v; upd(); } }).root,
        slider({ id: 'l91-N', label: 'Derivative filter N', min: 1, max: 50, step: 1, value: st.N, onInput: v => { st.N = v; upd(); } }).root,
        slider({ id: 'l91-noise', label: 'Sensor noise σ', min: 0, max: 0.05, step: 0.005, value: st.noise, digits: 3, onInput: v => { st.noise = v; upd(); } }).root,
      ),
    );
    const verdict = el('div', { class: 'status-line' }); f.controls.append(verdict);
    const yPlot = plotIn(f.plots, { height: 250, xLabel: 't (s)', yLabel: 'y', title: 'Closed-loop response: fine sampling vs the chosen Ts' });
    const uPlot = plotIn(f.plots, { height: 190, xLabel: 't (s)', yLabel: 'u', title: 'Controller output (held between samples)' });
    const mEl = el('div'); f.plots.append(mEl);
    function update() {
      const p = picker.get();
      if (!st.gains) { st.gains = autoTune(p.tf, p.def.id); gEl.textContent = `Kp = ${fmt(st.gains.Kp, 3)}, Ki = ${fmt(st.gains.Ki, 3)}, Kd = ${fmt(st.gains.Kd, 3)} — ${st.gains.why}`; }
      const g = st.gains;
      const T = Math.min(200, Math.max(10, simT(TF.poles(p.tf), 5, 200, 12) + 4 * (p.tf.delay || 0)));
      const mk = Ts => new CT.PID({ Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, Ts, N: st.N });
      const fine = CT.simulate({ plant: p.tf, T, Ts: 0.005, controller: mk(0.005), noise: st.noise, seed: 9, disturbance: CT.stepAt(T / 2, -0.4) });
      const cur = CT.simulate({ plant: p.tf, T, Ts: st.Ts, controller: mk(st.Ts), noise: st.noise, seed: 9, disturbance: CT.stepAt(T / 2, -0.4) });
      yPlot.set({ series: [{ name: 'Ts = 5 ms (reference)', x: fine.t, y: fine.y, color: 'series-3', width: 1.5 }, { name: `Ts = ${CT.fmtNum(st.Ts, 3)} s`, x: cur.t, y: cur.y, color: 'series-1' }], refLines: [{ y: 1, label: 'setpoint' }], vlines: [{ x: T / 2, label: 'load −0.4' }] });
      uPlot.set({ series: [{ name: 'Ts = 5 ms', x: fine.t, y: fine.u, color: 'series-3', width: 1.5 }, { name: `Ts = ${CT.fmtNum(st.Ts, 3)} s`, x: cur.t, y: cur.u, color: 'series-1' }] });
      const mf = CT.stepMetrics(fine, { t1: T / 2, ref: 1 }), mc = CT.stepMetrics(cur, { t1: T / 2, ref: 1 });
      const spr = mf.rise / st.Ts;
      const lvl = spr >= 10 ? 'good' : spr >= 4 ? 'warn' : 'crit';
      verdict.className = 'status-line ' + lvl;
      verdict.textContent = `${fmt(spr, 1)} samples per rise time (rise ${fmt(mf.rise)} s at fine sampling). ${lvl === 'good' ? 'Comfortable: the hold delay Ts/2 is a small fraction of the loop dynamics.' : lvl === 'warn' ? 'Marginal: the hold delay is eating phase margin; expect more overshoot.' : 'Too slow: the controller is reacting to stale information.'}`;
      metrics(mEl, [
        { label: 'Overshoot (fine)', value: mf.overshoot, unit: '%', digits: 1 },
        { label: 'Overshoot (Ts)', value: mc.overshoot, unit: '%', digits: 1, status: mc.overshoot > mf.overshoot + 10 ? 'warn' : undefined, note: 'degraded' },
        { label: 'IAE (fine)', value: mf.iae, digits: 2 },
        { label: 'IAE (Ts)', value: mc.iae, digits: 2 },
        { label: 'TV(u) (fine)', value: CT.totalVariation(fine.u), digits: 1 },
        { label: 'TV(u) (Ts)', value: CT.totalVariation(cur.u), digits: 1 },
        { label: 'Hold delay Ts/2', value: st.Ts / 2, unit: 's', digits: 3 },
      ]);
    }
    update();
    f.foot.append(el('p', { text: 'Try: slide Ts up until the samples-per-rise-time reading drops below 10 and watch the overshoot climb; below 4 the loop is a different loop. Then set noise to 0.02 with N = 50: the derivative turns noise into a jagged u. Bring N down to 5 and it calms with almost no change in y. That is why the filter is part of the controller, not an option.' }));
  };

  // ====================================================== 9 reference code
  CT.labs['pid-code'] = root => {
    const ts = `// pid.ts — discrete PID: parallel form, derivative on measurement with
// first-order filter, anti-windup (clamp or back-calculation), output limits.
export interface PidConfig {
  kp: number; ki: number; kd: number;   // parallel gains (ki in 1/s, kd in s)
  ts: number;                            // sample time [s]
  n?: number;                            // derivative filter ratio, Tf = Td/N (default 10)
  umin?: number; umax?: number;          // output limits
  antiWindup?: 'clamp' | 'backcalc' | 'none';
  dOnMeasurement?: boolean;              // default true: no derivative kick
  b?: number;                            // setpoint weight on P (default 1)
}

export class Pid {
  private i = 0; private d = 0; private prevX: number | null = null;
  constructor(private c: PidConfig) {}

  /** Bumpless start: make the first output equal to the current manual output. */
  reset(y: number, u0 = 0): void { this.i = u0; this.d = 0; this.prevX = this.c.dOnMeasurement === false ? 0 : -y; }

  update(r: number, y: number): number {
    const { kp, ki, kd, ts } = this.c;
    const n = this.c.n ?? 10, b = this.c.b ?? 1;
    const umin = this.c.umin ?? -Infinity, umax = this.c.umax ?? Infinity;
    const e = r - y;
    const p = kp * (b * r - y);
    // filtered derivative (backward Euler on the filter)
    const x = this.c.dOnMeasurement === false ? e : -y;
    if (this.prevX === null) this.prevX = x;
    const td = kp !== 0 ? kd / Math.abs(kp) : kd;
    const tf = td / n;
    this.d = kd === 0 ? 0 : (tf / (tf + ts)) * this.d + (kd / (tf + ts)) * (x - this.prevX);
    this.prevX = x;
    // integral (backward Euler), then saturation, then anti-windup correction
    const di = ki * ts * e;
    let i = this.i + di;
    const v = p + i + this.d;
    const u = Math.min(umax, Math.max(umin, v));
    if (u !== v) {
      const mode = this.c.antiWindup ?? 'clamp';
      if (mode === 'clamp' && Math.sign(di) === Math.sign(v - u)) i = this.i;       // stop pushing into the limit
      else if (mode === 'backcalc') { const tt = ki > 0 ? kp / ki : 1; i += (ts / tt) * (u - v); }
    }
    this.i = i;
    return u;
  }
}`;
    const dart = `// pid.dart — same controller for Flutter / embedded Dart.
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

  /// Bumpless start: seed the integrator with the current manual output.
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
    const c = `/* pid.c — fixed-rate PID for an MCU or PLC task. Call pid_update() once every ts seconds. */
typedef struct {
  float kp, ki, kd, ts, n, b, umin, umax;
  int d_on_measurement;      /* 1: derivative on -y (no kick); 0: on error */
  int backcalc;              /* 0: clamping anti-windup, 1: back-calculation */
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
    root.append(el('p', { class: 'ctl-hint', text: 'Units: Kp is output units per process unit; Ki is Kp/Ti (per second); Kd is Kp·Td (seconds). Run the update at a fixed rate from a timer, never from the main loop cadence, and feed it the measured value even in manual mode so the derivative and the reset stay meaningful.' }));
  };

  // ====================================================== 10 challenges
  const challenges = [
    {
      id: 'offset', title: 'Kill the offset', short: 'First-order thermal process. No offset, no overshoot, hold under load.', plant: () => TF.make([2], [5, 1]), T: 40, tD: 20, dist: -0.5, noise: 0,
      brief: 'A first-order thermal process (K = 2, τ = 5 s). Reach the setpoint with no steady-state error and almost no overshoot, and hold it when the load changes.',
      specs: [
        { label: 'Steady-state error below 1 % (before the load step)', test: g => Math.abs(g.m.ess) < 0.01, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'Overshoot below 5 %', test: g => g.m.overshoot < 5, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Back within 2 % less than 12 s after the load step', test: g => g.d.recovery < 12, show: g => isNaN(g.d.recovery) ? 'never' : `${fmt(g.d.recovery, 1)} s` },
      ],
      hint: 'P alone leaves an error of 1/(1 + Kp·K) (module 3). Integral action raises the system type and removes it (module 5); too much of it brings the overshoot back.',
      start: { Kp: 1, Ki: 0, Kd: 0 },
    },
    {
      id: 'deadtime', title: 'Respect the dead time', short: 'FOPDT with L/τ = 0.5. Fast is tempting; the delay says otherwise.', plant: () => TF.make([1], [4, 1], 2), T: 60, tD: 30, dist: -0.5, noise: 0,
      brief: 'FOPDT with K = 1, τ = 4 s, L = 2 s (L/τ = 0.5). Fast is tempting; the delay says otherwise.',
      specs: [
        { label: 'Overshoot below 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Settled to 2 % in less than 25 s', test: g => g.m.settled && g.m.settling < 25, show: g => g.m.settled ? `${fmt(g.m.settling, 1)} s` : 'not settled' },
        { label: 'Steady-state error below 1 %', test: g => Math.abs(g.m.ess) < 0.01, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'Load peak deviation below 0.35', test: g => g.d.peak < 0.35, show: g => fmt(g.d.peak, 3) },
      ],
      hint: 'Module 6: with L/τ = 0.5 an IMC or SIMC rule with λ ≈ L lands close. Module 7 explains why the gain crossover cannot go much above 1/L.',
      start: { Kp: 3, Ki: 0.5, Kd: 0 },
    },
    {
      id: 'motor', title: 'Position a motor', short: 'Integrating plant. The setpoint is easy; the torque load is the test.', plant: () => TF.make([1], [0.5, 1, 0]), T: 12, tD: 6, dist: -0.3, noise: 0,
      brief: 'An integrating plant: motor position, G = 1/(s(0.5s + 1)). The setpoint is easy. The torque load at t = 6 s is the real test.',
      specs: [
        { label: 'Overshoot below 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Settled to 2 % in less than 3 s', test: g => g.m.settled && g.m.settling < 3, show: g => g.m.settled ? `${fmt(g.m.settling, 2)} s` : 'not settled' },
        { label: 'Load peak deviation below 0.08', test: g => g.d.peak < 0.08, show: g => fmt(g.d.peak, 3) },
        { label: 'Back within 2 % less than 4 s after the load', test: g => g.d.recovery < 4, show: g => isNaN(g.d.recovery) ? 'never' : `${fmt(g.d.recovery, 2)} s` },
      ],
      hint: 'The plant already integrates, so P gives zero setpoint error (module 3) and D adds the damping the integrator lacks (module 8: the PD zero pulls the locus left). But an input load on an integrating plant still leaves an offset of d/Kp without integral action.',
      start: { Kp: 2, Ki: 0, Kd: 0 },
    },
    {
      id: 'ringing', title: 'Tame the resonance', short: 'Second order with ζ = 0.15. The controller has to supply the damping.', plant: () => TF.make([4], [1, 0.6, 4]), T: 20, tD: 10, dist: -0.5, noise: 0,
      brief: 'A lightly damped second-order plant, ζ = 0.15 at ωₙ = 2 rad/s. It rings by itself; the controller has to supply the damping.',
      specs: [
        { label: 'Overshoot below 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Settled to 2 % in less than 5 s', test: g => g.m.settled && g.m.settling < 5, show: g => g.m.settled ? `${fmt(g.m.settling, 2)} s` : 'not settled' },
        { label: 'Steady-state error below 1 %', test: g => Math.abs(g.m.ess) < 0.01, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'Back within 2 % less than 6 s after the load', test: g => g.d.recovery < 6, show: g => isNaN(g.d.recovery) ? 'never' : `${fmt(g.d.recovery, 2)} s` },
      ],
      hint: 'Derivative action is velocity feedback: it moves the closed-loop poles away from the imaginary axis (module 8). Then integral action for the offset, gently.',
      start: { Kp: 1, Ki: 0, Kd: 0 },
    },
    {
      id: 'noisy', title: 'Quiet actuator, noisy sensor', short: 'FOPDT with a noisy measurement. Meet the specs with a calm control signal.', plant: () => TF.make([1.5], [8, 1], 1), T: 80, tD: 40, dist: -0.5, noise: 0.01,
      brief: 'FOPDT (K = 1.5, τ = 8 s, L = 1 s) with a noisy measurement (σ = 0.01). Meet the response specs while keeping the control signal calm: total variation of u over the last 20 s must stay small.',
      specs: [
        { label: 'Overshoot below 10 %', test: g => g.m.overshoot < 10, show: g => `${fmt(g.m.overshoot, 1)} %` },
        { label: 'Settled to 2 % in less than 30 s', test: g => g.m.settled && g.m.settling < 30, show: g => g.m.settled ? `${fmt(g.m.settling, 1)} s` : 'not settled' },
        { label: 'Steady-state error below 2 %', test: g => Math.abs(g.m.ess) < 0.02, show: g => `${fmt(100 * g.m.ess, 2)} %` },
        { label: 'TV(u) over the final 20 s below 30', test: g => g.tv < 30, show: g => fmt(g.tv, 1) },
      ],
      hint: 'Module 5 and 9: derivative gain multiplies sensor noise by Kd/(Tf + Ts). Either filter hard (small N), or accept that a lag-dominant plant with a noisy sensor is a PI loop.',
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
        const btn = el('button', { type: 'button', class: 'challenge-card' + (active === ch ? ' is-active' : '') }, el('b', { text: `${i + 1}. ${ch.title}` }), el('span', { text: ch.short }), el('span', { class: 'badge pill ' + (b[ch.id] ? 'pill-good' : ''), text: b[ch.id] ? '✓ solved' : 'not yet' }));
        btn.addEventListener('click', () => open(ch));
        cards.append(btn);
      });
    }
    function open(ch) {
      active = ch; renderCards();
      panel.textContent = '';
      const st = { ...ch.start, N: 10, dOnMeas: true };
      const upd = frame(update);
      panel.append(el('div', { class: 'lab-head' }, el('span', { class: 'lab-kicker', text: 'Challenge' }), el('h3', { text: ch.title }), el('p', { text: ch.brief })));
      const f = labFrame(panel);
      const gains = gainSliders('ch-' + ch.id, st, upd, { Kp: [0, 30, 0.05], Ki: [0, 5, 0.01], Kd: [0, 10, 0.01] });
      f.controls.append(
        group('Your controller', gains.root),
        group('Details',
          slider({ id: `ch-${ch.id}-N`, label: 'Derivative filter N', min: 1, max: 50, step: 1, value: st.N, onInput: v => { st.N = v; upd(); } }).root,
          toggle({ id: `ch-${ch.id}-dom`, label: 'Derivative on measurement', checked: true, onChange: v => { st.dOnMeas = v; upd(); } }).root,
        ),
        el('details', {}, el('summary', { text: 'Hint' }), el('p', { class: 'ctl-hint', text: ch.hint })),
      );
      const specEl = el('ul', { class: 'spec-list' }); f.plots.append(el('div', { class: 'plot-title', text: 'Specification' }), specEl);
      const status = el('div', { class: 'status-line' }); f.plots.append(status);
      const yPlot = plotIn(f.plots, { height: 240, xLabel: 't (s)', yLabel: 'y', title: 'Response' });
      const uPlot = plotIn(f.plots, { height: 150, xLabel: 't (s)', yLabel: 'u', title: 'Controller output' });
      function update() {
        const plant = ch.plant();
        const Ts = 0.05;
        const pid = new CT.PID({ Kp: st.Kp, Ki: st.Ki, Kd: st.Kd, Ts, N: st.N, dOnMeasurement: st.dOnMeas });
        const res = CT.simulate({ plant, T: ch.T, Ts, controller: pid, disturbance: CT.stepAt(ch.tD, ch.dist), noise: ch.noise, seed: 21 });
        const g = { m: CT.stepMetrics(res, { t1: ch.tD, ref: 1 }), d: CT.disturbanceMetrics(res, { tD: ch.tD, scale: 1 }) || { peak: NaN, recovery: NaN }, tv: tailTV(res, 20), umax: CT.maxAbs(res.u) };
        const series = [{ name: 'setpoint', x: res.t, y: res.r, color: 'ink-2', width: 1 }];
        if (ch.noise) series.push({ name: 'measured', x: res.t, y: res.ym, color: 'muted', width: 1, alpha: 0.7 });
        series.push({ name: 'output y', x: res.t, y: res.y, color: 'series-1' });
        yPlot.set({ series, vlines: [{ x: ch.tD, label: 'load step' }] });
        uPlot.set({ series: [{ name: 'u', x: res.t, y: res.u, color: 'series-2' }] });
        specEl.textContent = '';
        let all = true;
        for (const s of ch.specs) {
          const ok = !!s.test(g); all = all && ok;
          specEl.append(el('li', {}, el('span', { class: 'pill ' + (ok ? 'pill-good' : 'pill-crit'), text: ok ? '✓ pass' : '✕ fail' }), el('span', { text: s.label + ' — ' }), el('strong', { class: 'mono', text: s.show(g) })));
        }
        status.className = 'status-line ' + (all ? 'good' : '');
        if (all) {
          status.textContent = `Solved with Kp = ${fmt(st.Kp)}, Ki = ${fmt(st.Ki)}, Kd = ${fmt(st.Kd)}. Badge saved.`;
          const b = badges(); if (!b[ch.id]) { b[ch.id] = true; store.set('badges', b); renderCards(); document.dispatchEvent(new CustomEvent('ctw:progress')); }
        } else status.textContent = 'Adjust the gains until every line passes. The metrics update as you move the sliders.';
      }
      update();
    }
    renderCards();
    open(challenges[0]);
  };
  CT.challenges = challenges;

  // ====================================================== quizzes 5, 6, 9
  CT.quizzes.pid = [
    { id: 'pid1', q: 'Your PLC uses the standard form with Kp = 2 and Ti = 8 s. The equivalent parallel integral gain Ki is…', options: ['16', '0.25', '4', '0.5'], answer: 1, explain: 'Ki = Kp/Ti = 2/8 = 0.25 per second. Typing 16 into a parallel-form controller would be 64× too much integral action.' },
    { id: 'pid2', q: 'The setpoint jumps and the controller output spikes for one sample. The most likely cause:', options: ['Integral windup', 'Derivative acting on the error', 'The derivative filter is too strong', 'Sample time too small'], answer: 1, explain: 'A step in r is an infinite derivative for one sample. Derivative on measurement (−dy/dt) sees the same disturbances but not the setpoint step.' },
    { id: 'pid3', q: 'A heater loop saturates at 100 % for a minute during warm-up, then overshoots the setpoint by 15 °C before coming back. What is missing?', options: ['Derivative action', 'A faster sample time', 'Anti-windup', 'A larger Kp'], answer: 2, explain: 'While the output was pinned, the integrator kept accumulating. It has to unwind before the output can drop: classic windup. Clamping or back-calculation stops the accumulation while saturated.' },
  ];
  CT.quizzes.tuning = [
    { id: 'tun1', q: 'A step test gives K = 2, τ = 10 s, L = 1 s. Ziegler–Nichols open loop PID Kp is…', options: ['6', '12', '1.2', '0.6'], answer: 0, explain: 'Kp = 1.2 τ/(K L) = 1.2·10/(2·1) = 6, with Ti = 2 s and Td = 0.5 s. Aggressive: IMC with λ = L gives about 3.5.' },
    { id: 'tun2', q: 'In the relay experiment, what sets the amplitude of the oscillation?', options: ['The plant gain only', 'The relay amplitude d, scaled by the plant', 'The hysteresis', 'The setpoint'], answer: 1, explain: 'a ≈ (4d/π)·|G(jω_u)|. You choose d, so you choose how much the process is disturbed. That is what makes it safe compared with raising Kp to the edge.' },
    { id: 'tun3', q: 'A loop has L/τ = 3. The best expectation is…', options: ['PID tuned by Cohen–Coon will be fast', 'Any rule works, pick the fastest', 'A slow PI; the dead time caps the achievable speed', 'Increase Kd to compensate the delay'], answer: 2, explain: 'Dead-time dominant. The gain crossover cannot exceed roughly 1/L whatever the controller, and derivative action does not predict through a delay. Slow PI, or a Smith predictor if the model is good.' },
  ];
  CT.quizzes.digital = [
    { id: 'dig1', q: 'The closed-loop rise time is about 2 s. A reasonable sample time is…', options: ['2 s', '0.5 s', '0.1 s', '1 ms is required'], answer: 2, explain: '10–30 samples per rise time → 70–200 ms. 0.5 s is 4 samples per rise time and visibly degrades the loop; 1 ms works but is 2000× more than needed and makes Ki·Ts tiny.' },
    { id: 'dig2', q: 'Compared with the continuous design, the zero-order hold adds…', options: ['gain', 'a delay of about Ts/2', 'an extra integrator', 'nothing measurable'], answer: 1, explain: 'The held signal lags the ideal one by half a sample on average. At the gain crossover that is ω_gc·Ts/2 radians of extra phase lag.' },
    { id: 'dig3', q: 'Which order inside one PID update is correct?', options: ['Saturate the error, then compute P, I, D', 'Compute the unsaturated output, saturate it, then correct the integrator', 'Correct the integrator, then compute the output', 'Saturate the integrator only'], answer: 1, explain: 'Anti-windup needs both the unsaturated value v and the saturated u, so the integrator correction happens after saturation. Saturating the error or only the integrator does not stop the wind-up.' },
  ];
  CT.quizzes.frequency = [
    { id: 'frq1', q: 'At the gain crossover the loop phase is −135°. The phase margin is…', options: ['135°', '45°', '−45°', '225°'], answer: 1, explain: 'PM = 180° + ∠L(jω_gc) = 180 − 135 = 45°: acceptable, on the low side for a loop with model uncertainty.' },
    { id: 'frq2', q: 'You add 0.5 s of dead time to a loop whose gain crossover is at 2 rad/s. Roughly how much phase margin do you lose?', options: ['about 6°', 'about 57°', 'about 1°', 'none, delay only affects magnitude'], answer: 1, explain: 'Delay phase is −ωL = −1 rad ≈ −57° at 2 rad/s. The magnitude does not change, so the crossover stays put and the whole −57° comes off the margin.' },
    { id: 'frq3', q: 'Ms = max|S(jω)| = 3.5 means…', options: ['the loop is robust', 'some disturbance frequencies are amplified 3.5× and the Nyquist locus passes within 0.29 of −1', 'the closed loop is unstable', 'the gain margin is 3.5 dB'], answer: 1, explain: 'Ms is the inverse of the closest approach to −1. Values above 2 imply small margins (GM ≥ Ms/(Ms−1) = 1.4 and PM ≥ 2·asin(1/(2Ms)) ≈ 16°) and a resonant sensitivity.' },
  ];
  CT.quizzes.rootlocus = [
    { id: 'rl1', q: 'A locus branch leaves the real axis. From that gain on, the step response…', options: ['is unstable', 'becomes oscillatory', 'becomes slower', 'has no overshoot'], answer: 1, explain: 'Leaving the real axis means a complex pole pair: the response rings. Instability only comes when a branch crosses into the right half-plane.' },
    { id: 'rl2', q: 'Adding a PD zero at s = −2 to a plant with poles at 0 and −1 does what to the locus?', options: ['Pushes it toward the right', 'Pulls the branches left, toward the zero', 'Nothing until K is large', 'Adds a third branch'], answer: 1, explain: 'Branches end at zeros. A left-half-plane zero attracts the locus, which is why derivative action lets you raise the gain while keeping damping.' },
    { id: 'rl3', q: 'For G = 1/(s(s+1)(s+2)) the locus crosses the imaginary axis at K = 6. This K is also…', options: ['the ultimate gain Ku of the Ziegler–Nichols method', 'the gain for ζ = 0.7', 'the DC gain', 'the derivative gain'], answer: 0, explain: 'On the axis the loop is marginally stable and oscillates at the crossing frequency: exactly the Ku and Pu the ultimate-gain and relay methods estimate.' },
  ];
})(window.CT);
