/* labs-freq.js — laboratórios dos módulos 7 e 8: moldagem da malha por Bode / Nyquist e lugar das raízes. */
(function (CT) {
  'use strict';
  const { el, slider, select, toggle, metrics, fmt, frame, plantPicker, group, button } = CT.ui;
  const { P, TF, C } = CT;
  const { labFrame, plotIn, readout, polesText, stabilityPill, clipUnstable, simT } = CT.labs.util;

  function gainSliders(prefix, st, onInput) {
    const sKp = slider({ id: prefix + '-Kp', label: 'Kp', min: 0, max: 20, step: 0.05, value: st.Kp, onInput: v => { st.Kp = v; onInput(); } });
    const sKi = slider({ id: prefix + '-Ki', label: 'Ki (por s)', min: 0, max: 3, step: 0.01, value: st.Ki, onInput: v => { st.Ki = v; onInput(); } });
    const sKd = slider({ id: prefix + '-Kd', label: 'Kd (s)', min: 0, max: 5, step: 0.01, value: st.Kd, onInput: v => { st.Kd = v; onInput(); } });
    return { root: el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, sKp.root, sKi.root, sKd.root), refresh: () => { sKp.set(st.Kp); sKi.set(st.Ki); sKd.set(st.Kd); } };
  }

  // ====================================================== 7.1 Bode / Nyquist
  CT.labs['bode'] = root => {
    const f = labFrame(root);
    const st = { Kp: 1.5, Ki: 0.15, Kd: 0, N: 10 };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l71', value: 'fopdt', label: 'Planta', onChange: () => upd() });
    const gains = gainSliders('l71', st, upd);
    f.controls.append(
      picker.root,
      group('Controlador C(s)', gains.root,
        slider({ id: 'l71-N', label: 'Filtro da derivada N', min: 2, max: 50, step: 1, value: st.N, onInput: v => { st.N = v; upd(); } }).root,
        button('Só P (Kp = 1)', () => { Object.assign(st, { Kp: 1, Ki: 0, Kd: 0 }); gains.refresh(); upd(); }, 'btn secondary')),
    );
    const verdict = el('div', { class: 'status-line' }); f.controls.append(verdict);
    const mEl = el('div'); f.controls.append(mEl);
    const magPlot = plotIn(f.plots, { height: 220, xLabel: 'ω (rad/s)', yLabel: '|L| (dB)', title: 'Malha aberta L(jω) = C(jω)·G(jω) — módulo', xLog: true, includeZero: true });
    const phPlot = plotIn(f.plots, { height: 220, xLabel: 'ω (rad/s)', yLabel: '∠L (°)', title: 'Malha aberta — fase', xLog: true, yDomain: [-360, 45] });
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const nyq = plotIn(row, { height: 260, xLabel: 'Re L(jω)', yLabel: 'Im L(jω)', title: 'Traçado de Nyquist (ω > 0) e o ponto −1', equal: true, xDomain: [-3, 1.5], yDomain: [-3, 1.5], includeZeroX: true, table: false });
    const stepPlot = plotIn(row, { height: 260, xLabel: 't (s)', yLabel: 'y', title: 'Resposta ao degrau em malha fechada (simulada)' });
    function update() {
      const p = picker.get();
      const G = p.tf;
      const Ctf = CT.pidTF(st.Kp, st.Ki, st.Kd, st.N);
      const L = TF.series(Ctf, G);
      const wmin = 1e-2, wmax = 1e2;
      const bd = CT.bode(L, wmin, wmax, 800);
      const mg = CT.margins(bd);
      const sp = CT.sensitivityPeak(L, wmin, wmax, 800);
      const vl = [], magMarkers = [], phMarkers = [];
      if (mg.wgc != null) { vl.push({ x: mg.wgc, label: `ω_gc ${fmt(mg.wgc, 2)}` }); phMarkers.push({ x: mg.wgc, y: -180 + mg.pm, label: `MF ${fmt(mg.pm, 0)}°`, color: 'series-1' }); }
      if (mg.wpc != null) { vl.push({ x: mg.wpc, label: `ω_pc ${fmt(mg.wpc, 2)}`, labelOffset: 16 }); magMarkers.push({ x: mg.wpc, y: -mg.gmDb, label: `MG ${fmt(mg.gmDb, 1)} dB`, color: 'series-2' }); }
      magPlot.set({ series: [{ name: '|L| dB', x: bd.w, y: bd.db, color: 'series-1' }], refLines: [{ y: 0, label: '0 dB' }], vlines: vl, markers: magMarkers });
      phPlot.set({ series: [{ name: '∠L', x: bd.w, y: bd.phase, color: 'series-1' }], refLines: [{ y: -180, label: '−180°' }], vlines: vl, markers: phMarkers });
      const ny = CT.nyquist(L, wmin, wmax, 1200);
      const re = new Float64Array(ny.re.length), im = new Float64Array(ny.im.length);
      for (let i = 0; i < re.length; i++) { const big = Math.hypot(ny.re[i], ny.im[i]) > 6; re[i] = big ? NaN : ny.re[i]; im[i] = big ? NaN : ny.im[i]; }
      const circ = { x: [], y: [] }; for (let i = 0; i <= 72; i++) { circ.x.push(Math.cos(2 * Math.PI * i / 72)); circ.y.push(Math.sin(2 * Math.PI * i / 72)); }
      nyq.set({
        series: [{ name: 'L(jω)', x: re, y: im, color: 'series-1', noTip: true }],
        guides: [{ x: circ.x, y: circ.y, label: '|L| = 1' }],
        points: [{ name: '−1', x: [-1], y: [0], shape: 'x', color: 'crit', r: 6, labels: ['−1 + 0j'] }],
        markers: sp.Ms > 0 && isFinite(sp.Ms) ? [(() => { const v = TF.freq(L, sp.wMs); return { x: v.re, y: v.im, label: `ponto mais próximo: 1/Ms = ${fmt(1 / sp.Ms, 2)}`, color: 'series-2' }; })()] : [],
      });
      const stableGuess = (mg.pm == null || mg.pm > 0) && (mg.gmDb == null || mg.gmDb > 0);
      const T = Math.min(300, Math.max(10, simT(TF.poles(G), 5, 200, 10) + 4 * (G.delay || 0)));
      const pid = new CT.PID({ Kp: st.Kp, Ki: st.Ki, Kd: st.Kd, Ts: Math.min(0.02, T / 5000), N: st.N });
      const res = CT.simulate({ plant: G, T, Ts: Math.min(0.02, T / 5000), controller: pid });
      stepPlot.set({ series: [{ name: 'y(t)', x: res.t, y: clipUnstable(res.y, 20), color: 'series-1', area: true }], refLines: [{ y: 1, label: 'referência' }] });
      const m = CT.stepMetrics(res, { ref: 1 });
      let lvl = 'good', txt;
      const gmTxt = mg.gmDb == null ? '∞' : fmt(mg.gmDb, 1) + ' dB';
      if (!stableGuess) { lvl = 'crit'; txt = 'Margem negativa: a malha fechada é instável (confira na resposta ao degrau).'; }
      else if (mg.pm == null) { lvl = 'warn'; txt = '|L| nunca chega a 1 nesta faixa de frequência: não há cruzamento de ganho, e a malha está fazendo muito pouco.'; }
      else if (mg.pm >= 45 && (mg.gmDb == null || mg.gmDb >= 6)) txt = `MF ${fmt(mg.pm, 0)}°, MG ${gmTxt}: margens confortáveis.`;
      else if (mg.pm >= 30) { lvl = 'warn'; txt = `MF ${fmt(mg.pm, 0)}°, MG ${gmTxt}: estável, porém a resposta vai oscilar e a malha tolera pouco erro de modelo.`; }
      else { lvl = 'crit'; txt = `MF ${fmt(mg.pm, 0)}°: no limite da estabilidade.`; }
      verdict.className = 'status-line ' + lvl; verdict.textContent = txt;
      metrics(mEl, [
        { label: 'Cruzamento de ganho ω_gc', value: mg.wgc, unit: 'rad/s', digits: 3 },
        { label: 'Margem de fase', value: mg.pm, unit: '°', digits: 1 },
        { label: 'Cruzamento de fase ω_pc', value: mg.wpc, unit: 'rad/s', digits: 3 },
        { label: 'Margem de ganho', value: mg.gmDb == null ? '∞' : mg.gmDb, unit: mg.gmDb == null ? '' : 'dB', digits: 1 },
        { label: 'Pico de sensibilidade Ms', value: sp.Ms, digits: 2, status: sp.Ms <= 2 ? 'good' : 'warn', note: sp.Ms <= 1.6 ? 'boa tolerância' : sp.Ms <= 2 ? 'aceitável' : 'frágil' },
        { label: 'Sobressinal (simulado)', value: m.overshoot, unit: '%', digits: 1 },
        { label: 'MF ≈ 100 ζ → ζ', value: mg.pm != null ? Math.min(1, mg.pm / 100) : NaN, digits: 2 },
      ]);
    }
    update();
    f.foot.append(el('p', { text: 'O diagrama de Bode é construído com C(s) tendo derivada sobre o erro; a simulação usa derivada sobre a medição. Os dois têm o mesmo ganho de malha, portanto as margens valem para ambos e apenas a resposta à referência difere. Experimente: planta FOPDT, só P, eleve Kp até a MF chegar a 30° e leia o sobressinal. Depois leve L a 6 s e veja a fase despencar: o cruzamento de ganho precisa se mover para a esquerda para manter a margem, o que significa uma malha mais lenta.' }));
  };

  // ====================================================== 8.1 lugar das raízes
  CT.labs['rlocus'] = root => {
    const f = labFrame(root);
    const st = { K: 1 };
    const upd = frame(update);
    const picker = plantPicker({ id: 'l81', value: 'cubic', label: 'Planta', onChange: () => upd() });
    const sK = slider({ id: 'l81-K', label: 'Ganho proporcional K', min: 0.01, max: 100, log: true, value: st.K, onInput: v => { st.K = v; upd(); } });
    f.controls.append(picker.root, group('Controlador', sK.root));
    const note = el('div', { class: 'ctl-hint' }); f.controls.append(note);
    const ro = el('div'); f.controls.append(ro);
    const row = el('div', { class: 'plots-row' }); f.plots.append(row);
    const rl = plotIn(row, { height: 320, xLabel: 'Re(s)', yLabel: 'Im(s)', title: 'Lugar das raízes para K = 0,01 … 100 (semirretas: ζ = 0,3; 0,5; 0,7)', equal: true, includeZeroX: true, table: false });
    const stepPlot = plotIn(row, { height: 320, xLabel: 't (s)', yLabel: 'y', title: 'Resposta ao degrau em malha fechada neste K' });
    function update() {
      const p = picker.get();
      let G = TF.make(p.tf.num, p.tf.den);
      if (p.tf.delay) { G = TF.series(G, TF.make([-p.tf.delay / 2, 1], [p.tf.delay / 2, 1])); note.textContent = `O tempo morto L = ${fmt(p.tf.delay)} s é representado no lugar das raízes por uma aproximação de Padé de primeira ordem (acrescenta um zero no semiplano direito e um polo no esquerdo, em ±2/L). A resposta ao degrau usa o atraso verdadeiro.`; }
      else note.textContent = '';
      const Ks = []; for (let i = 0; i <= 320; i++) Ks.push(Math.pow(10, -2 + 4 * i / 320));
      const branches = CT.rootLocus(G, Ks);
      const olp = TF.poles(G), olz = TF.zeros(G);
      let maxR = Math.max(1, ...olp.map(q => Math.hypot(q.re, q.im)), ...olz.map(q => Math.hypot(q.re, q.im)));
      let brR = 0; for (const b of branches) for (const q of b) brR = Math.max(brR, Math.hypot(q.re, q.im));
      const box = Math.min(brR * 1.15, 8 * maxR);
      const series = branches.map((b, i) => ({ name: `ramo ${i + 1}`, x: b.map(q => Math.hypot(q.re, q.im) > box ? NaN : q.re), y: b.map(q => Math.hypot(q.re, q.im) > box ? NaN : q.im), color: 'series-1', width: 1.5, noTip: true, noLegend: true }));
      const cl = P.roots(P.add(G.den, P.scale(G.num, st.K)));
      const guides = [0.3, 0.5, 0.7].map(z => { const th = Math.acos(z); const r = box; return { x: [0, -r * Math.cos(th)], y: [0, r * Math.sin(th)], label: `ζ=${CT.dec(z)}`, alpha: 0.5 }; });
      guides.push(...[0.3, 0.5, 0.7].map(z => { const th = Math.acos(z); const r = box; return { x: [0, -r * Math.cos(th)], y: [0, -r * Math.sin(th)], alpha: 0.5 }; }));
      rl.opts.xDomain = [-box, box * 0.5]; rl.opts.yDomain = [-box, box];
      rl.set({
        series, guides,
        points: [
          { name: 'polos de malha aberta', x: olp.map(q => q.re), y: olp.map(q => q.im), shape: 'x', color: 'ink', r: 6, labels: olp.map(q => C.fmt(q)) },
          { name: 'zeros de malha aberta', x: olz.map(q => q.re), y: olz.map(q => q.im), shape: 'o', color: 'ink', r: 6, labels: olz.map(q => C.fmt(q)) },
          { name: `polos de malha fechada em K = ${fmt(st.K)}`, x: cl.map(q => q.re), y: cl.map(q => q.im), shape: 'dot', color: 'series-2', r: 5, labels: cl.map(q => C.fmt(q)) },
        ],
        bands: [{ x0: 0, x1: box, color: 'crit', alpha: 0.06 }],
      });
      let Ku = null, wu = null;
      outer: for (const b of branches) for (let i = 1; i < b.length; i++) if (b[i - 1].re < 0 && b[i].re >= 0) { const t = -b[i - 1].re / (b[i].re - b[i - 1].re); Ku = b[i - 1].K + t * (b[i].K - b[i - 1].K); wu = Math.abs(b[i - 1].im + t * (b[i].im - b[i - 1].im)); break outer; }
      const stable = cl.every(q => q.re < -1e-9);
      const T = stable ? simT(cl, 4, 200, 8) + 3 * (p.tf.delay || 0) : 15;
      const pid = new CT.PID({ Kp: st.K, Ki: 0, Kd: 0, Ts: Math.min(0.02, T / 4000) });
      const res = CT.simulate({ plant: p.tf, T, Ts: Math.min(0.02, T / 4000), controller: pid });
      stepPlot.set({ series: [{ name: 'y(t)', x: res.t, y: clipUnstable(res.y, 20), color: 'series-2', area: true }], refLines: [{ y: 1, label: 'referência' }] });
      const dom = cl.filter(q => q.im >= 0).sort((a, b) => Math.abs(a.re) - Math.abs(b.re))[0];
      const zeta = dom && dom.im > 1e-9 ? -dom.re / Math.hypot(dom.re, dom.im) : (dom ? 1 : NaN);
      ro.replaceChildren(readout([
        ['polos de malha fechada', el('span', {}, polesText(cl) + '  ', stabilityPill(cl))],
        ['polo dominante', dom ? `${C.fmt(dom)} → ζ ≈ ${fmt(zeta)}` : '—'],
        ['cruzamento do eixo imaginário', Ku != null ? `K_u ≈ ${fmt(Ku)} em ω ≈ ${fmt(wu)} rad/s (P_u ≈ ${fmt(2 * Math.PI / wu)} s)` : 'nenhum abaixo de K = 100'],
        ['ganho DC neste K', fmt(TF.dcGain(TF.feedback(TF.make(P.scale(G.num, st.K), G.den))), 3)],
      ]));
    }
    update();
    f.foot.append(el('p', { text: 'Experimente: na planta de três atrasos, eleve K. Os três ramos partem do polo triplo; um segue para a esquerda pelo eixo real e dois saem a ±60° e cruzam o eixo imaginário em K = 8 (exatamente o resultado de Routh para (s+1)³ + K). Leia ζ onde o ramo dominante encontra a semirreta de ζ = 0,5, ajuste esse K e confira o sobressinal. Depois troque para a planta com integrador: os ramos nunca cruzam, e a resposta apenas fica mais oscilatória conforme K sobe.' }));
  };
})(window.CT);
