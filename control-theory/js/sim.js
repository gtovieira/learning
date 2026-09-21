/* sim.js — plant catalogue, discrete PID, closed-loop simulation (RK4 plant, sampled
   controller, dead time), performance metrics, FOPDT identification, tuning rules and
   relay auto-tuning. Everything works in deviation variables around an operating point. */
(function (CT) {
  'use strict';
  const { P, TF } = CT;

  // ------------------------------------------------------------ random
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    const next = () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { next, gauss() { let u = 0, v = 0; while (u === 0) u = next(); while (v === 0) v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } };
  }

  // ------------------------------------------------------------ plants
  const plants = [
    {
      id: 'first', name: 'Atraso de primeira ordem', tag: 'térmico / RC / nível de tanque',
      formula: 'G(s) = \\dfrac{K}{\\tau s + 1}',
      params: [
        { key: 'K', label: 'Ganho K', min: 0.2, max: 5, step: 0.1, def: 2 },
        { key: 'tau', label: 'Constante de tempo τ', min: 0.5, max: 20, step: 0.5, def: 5, unit: 's' },
      ],
      build: p => TF.make([p.K], [p.tau, 1]),
    },
    {
      id: 'second', name: 'Segunda ordem (massa, mola, amortecedor)', tag: 'ressonante; ζ define o amortecimento',
      formula: 'G(s) = \\dfrac{K\\,\\omega_n^2}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}',
      params: [
        { key: 'K', label: 'Ganho K', min: 0.2, max: 3, step: 0.1, def: 1 },
        { key: 'wn', label: 'Frequência natural ωₙ', min: 0.2, max: 5, step: 0.1, def: 1, unit: 'rad/s' },
        { key: 'zeta', label: 'Fator de amortecimento ζ', min: 0.05, max: 1.5, step: 0.05, def: 0.3 },
      ],
      build: p => TF.make([p.K * p.wn * p.wn], [1, 2 * p.zeta * p.wn, p.wn * p.wn]),
    },
    {
      id: 'fopdt', name: 'Primeira ordem com tempo morto (FOPDT)', tag: 'o modelo de trabalho do controle de processos',
      formula: 'G(s) = \\dfrac{K\\,e^{-Ls}}{\\tau s + 1}',
      params: [
        { key: 'K', label: 'Ganho K', min: 0.2, max: 5, step: 0.1, def: 1.5 },
        { key: 'tau', label: 'Constante de tempo τ', min: 0.5, max: 20, step: 0.5, def: 8, unit: 's' },
        { key: 'L', label: 'Tempo morto L', min: 0, max: 10, step: 0.25, def: 2, unit: 's' },
      ],
      build: p => TF.make([p.K], [p.tau, 1], p.L),
    },
    {
      id: 'cubic', name: 'Três atrasos iguais', tag: 'ordem superior; visto de fora, parece FOPDT',
      formula: 'G(s) = \\dfrac{K}{(\\tau s + 1)^3}',
      params: [
        { key: 'K', label: 'Ganho K', min: 0.2, max: 5, step: 0.1, def: 1 },
        { key: 'tau', label: 'Cada constante de tempo τ', min: 0.2, max: 5, step: 0.1, def: 1, unit: 's' },
      ],
      build: p => { const f = [p.tau, 1]; return TF.make([p.K], P.mul(P.mul(f, f), f)); },
    },
    {
      id: 'integrator', name: 'Integrador + atraso (posição de motor)', tag: 'planta tipo 1: erro nulo ao degrau só com P',
      formula: 'G(s) = \\dfrac{K}{s(\\tau s + 1)}',
      params: [
        { key: 'K', label: 'Ganho K', min: 0.2, max: 5, step: 0.1, def: 1 },
        { key: 'tau', label: 'Constante de tempo τ', min: 0.05, max: 2, step: 0.05, def: 0.5, unit: 's' },
      ],
      build: p => TF.make([p.K], [p.tau, 1, 0]),
    },
    {
      id: 'nmp', name: 'Fase não mínima (zero no semiplano direito)', tag: 'resposta inversa: parte primeiro no sentido errado',
      formula: 'G(s) = \\dfrac{K(1 - T_z s)}{(\\tau s + 1)^2}',
      params: [
        { key: 'K', label: 'Ganho K', min: 0.2, max: 3, step: 0.1, def: 1 },
        { key: 'tau', label: 'Constante de tempo τ', min: 0.5, max: 5, step: 0.1, def: 2, unit: 's' },
        { key: 'Tz', label: 'Constante do zero Tz', min: 0, max: 5, step: 0.1, def: 1, unit: 's' },
      ],
      build: p => TF.make([-p.K * p.Tz, p.K], P.mul([p.tau, 1], [p.tau, 1])),
    },
  ];
  const plantById = Object.fromEntries(plants.map(p => [p.id, p]));
  function plantDefaults(def) { const o = {}; def.params.forEach(p => { o[p.key] = p.def; }); return o; }

  // ------------------------------------------------------------ PID
  /* Discrete PID, parallel form u = Kp·e + Ki∫e + Kd·de/dt with:
     - first-order derivative filter (Tf = Td/N, backward Euler)
     - derivative on measurement (default) or on error
     - output saturation with anti-windup: 'clamp' (conditional integration), 'backcalc', or 'none'
     - setpoint weighting b on the proportional term. */
  class PID {
    constructor(o) {
      this.Kp = o.Kp ?? 1; this.Ki = o.Ki ?? 0; this.Kd = o.Kd ?? 0;
      this.Ts = o.Ts ?? 0.05; this.N = o.N ?? 10;
      this.umin = o.umin ?? -Infinity; this.umax = o.umax ?? Infinity;
      this.dOnMeasurement = o.dOnMeasurement ?? true;
      this.antiWindup = o.antiWindup ?? 'clamp';
      this.b = o.b ?? 1;
      this.Tt = o.Tt ?? null;
      this.reset();
    }
    get Tf() {
      if (this.Kd === 0) return 0;
      const Td = this.Kp !== 0 ? this.Kd / Math.abs(this.Kp) : this.Kd;
      return Td / this.N;
    }
    reset(y0 = 0, u0 = 0) {
      this.I = u0; this.D = 0; this.prevX = null; this.y0 = y0;
      this.parts = { P: 0, I: 0, D: 0, v: 0, u: 0, sat: false };
    }
    update(r, y) {
      const e = r - y;
      const Pterm = this.Kp * (this.b * r - y);
      const x = this.dOnMeasurement ? -y : e;
      if (this.prevX === null) this.prevX = x;
      const Tf = this.Tf, Ts = this.Ts;
      if (this.Kd !== 0) {
        this.D = (Tf / (Tf + Ts)) * this.D + (this.Kd / (Tf + Ts)) * (x - this.prevX);
      } else this.D = 0;
      this.prevX = x;
      const dI = this.Ki * Ts * e;
      let I = this.I + dI;
      const v = Pterm + I + this.D;
      let u = Math.min(this.umax, Math.max(this.umin, v));
      const sat = u !== v;
      if (sat) {
        if (this.antiWindup === 'clamp') {
          if (Math.sign(dI) === Math.sign(v - u)) I = this.I;
        } else if (this.antiWindup === 'backcalc') {
          const Ti = this.Ki !== 0 ? this.Kp / this.Ki : 1;
          const Tt = this.Tt ?? Math.max(Ti, 1e-3);
          I += (Ts / Tt) * (u - v);
        }
      }
      this.I = I;
      this.parts = { P: Pterm, I: this.I, D: this.D, v, u, sat };
      return u;
    }
  }
  const standardToParallel = (Kp, Ti, Td) => ({ Kp, Ki: Ti > 0 ? Kp / Ti : 0, Kd: Kp * Td });
  const parallelToStandard = (Kp, Ki, Kd) => ({ Kp, Ti: Ki > 0 ? Kp / Ki : Infinity, Td: Kp !== 0 ? Kd / Kp : 0 });

  // ------------------------------------------------------------ simulation
  /* opts: { plant:{num,den,delay}, T, Ts, controller:{reset,update}|null, uOpen(t), setpoint(t), disturbance(t),
             noise, seed, record:'parts' } */
  function simulate(opts) {
    const plant = opts.plant;
    const T = opts.T ?? 40;
    const Ts = opts.Ts ?? 0.05;
    const ss = TF.toSS({ num: plant.num, den: plant.den });
    const poles = TF.poles({ num: plant.num, den: plant.den });
    const maxAbs = poles.reduce((m, p) => Math.max(m, Math.hypot(p.re, p.im)), 0) || 1;
    let h = Math.min(Ts / 2, T / 3000, 0.05 / maxAbs);
    h = Math.max(h, T / 80000);
    const stepsPerTs = Math.max(1, Math.round(Ts / h));
    h = Ts / stepsPerTs;
    const N = Math.round(T / h);
    const delaySteps = Math.round((plant.delay || 0) / h);
    const buf = new Float64Array(delaySteps + 1);
    let bufIdx = 0;
    const x = new Float64Array(ss.n), k1 = new Float64Array(ss.n), k2 = new Float64Array(ss.n), k3 = new Float64Array(ss.n), k4 = new Float64Array(ss.n), xt = new Float64Array(ss.n);
    const rnd = rng(opts.seed ?? 7);
    const noise = opts.noise ?? 0;
    const setpoint = opts.setpoint || (() => 1);
    const disturbance = opts.disturbance || (() => 0);
    const ctrl = opts.controller || null;
    const uOpen = opts.uOpen || null;
    const rec = opts.record === 'parts';
    const t = new Float64Array(N + 1), r = new Float64Array(N + 1), y = new Float64Array(N + 1), ym = new Float64Array(N + 1), u = new Float64Array(N + 1), d = new Float64Array(N + 1);
    const pP = rec ? new Float64Array(N + 1) : null, pI = rec ? new Float64Array(N + 1) : null, pD = rec ? new Float64Array(N + 1) : null;
    if (ctrl && ctrl.reset) ctrl.reset(0, 0);
    let uc = 0, sat = 0;
    const output = (ud) => { let s = ss.D * ud; for (let i = 0; i < ss.n; i++) s += ss.C[i] * x[i]; return s; };
    const deriv = (xin, ud, out) => {
      for (let i = 0; i < ss.n - 1; i++) out[i] = xin[i + 1];
      if (ss.n > 0) { let s = ud; for (let i = 0; i < ss.n; i++) s += ss.lastRow[i] * xin[i]; out[ss.n - 1] = s; }
    };
    let ud = 0;
    for (let k = 0; k <= N; k++) {
      const tk = k * h;
      const rk = setpoint(tk), dk = disturbance(tk);
      const yk = output(ud);
      const ymk = yk + (noise ? noise * rnd.gauss() : 0);
      if (k % stepsPerTs === 0) {
        if (ctrl) uc = ctrl.update(rk, ymk, tk);
        else if (uOpen) uc = uOpen(tk, ymk);
        else uc = rk;
        if (ctrl && ctrl.parts && ctrl.parts.sat) sat++;
      }
      t[k] = tk; r[k] = rk; y[k] = yk; ym[k] = ymk; u[k] = uc; d[k] = dk;
      if (rec && ctrl && ctrl.parts) { pP[k] = ctrl.parts.P; pI[k] = ctrl.parts.I; pD[k] = ctrl.parts.D; }
      const up = uc + dk;
      buf[bufIdx] = up;
      bufIdx = (bufIdx + 1) % buf.length;
      ud = buf[bufIdx];
      if (ss.n > 0) {
        deriv(x, ud, k1);
        for (let i = 0; i < ss.n; i++) xt[i] = x[i] + 0.5 * h * k1[i];
        deriv(xt, ud, k2);
        for (let i = 0; i < ss.n; i++) xt[i] = x[i] + 0.5 * h * k2[i];
        deriv(xt, ud, k3);
        for (let i = 0; i < ss.n; i++) xt[i] = x[i] + h * k3[i];
        deriv(xt, ud, k4);
        for (let i = 0; i < ss.n; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      }
    }
    return { t, r, y, ym, u, d, h, Ts, parts: rec ? { P: pP, I: pI, D: pD } : null, satFraction: ctrl ? sat / Math.floor(N / stepsPerTs + 1) : 0 };
  }

  // ------------------------------------------------------------ metrics
  function idxAt(t, tv) { let lo = 0, hi = t.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < tv) lo = m + 1; else hi = m; } return lo; }

  /* Step-response metrics on the window [t0, t1): rise 10–90 %, overshoot, 2 % settling,
     steady-state error against ref, IAE/ISE over the window. */
  function stepMetrics(res, { t0 = 0, t1 = null, ref = null, band = 0.02 } = {}) {
    const { t, y, r } = res;
    const i0 = idxAt(t, t0), i1 = t1 == null ? t.length : idxAt(t, t1);
    const n = i1 - i0;
    if (n < 10) return null;
    const y0 = y[i0];
    const tail = Math.max(5, Math.floor(n * 0.1));
    let yss = 0; for (let i = i1 - tail; i < i1; i++) yss += y[i]; yss /= tail;
    const target = ref == null ? r[i1 - 1] : ref;
    const dy = yss - y0;
    const out = { y0, yss, target, ess: target - yss, settled: true };
    let ymax = -Infinity, imax = i0;
    for (let i = i0; i < i1; i++) if (y[i] > ymax) { ymax = y[i]; imax = i; }
    if (Math.abs(dy) > 1e-9) {
      const sgn = Math.sign(dy);
      let i10 = -1, i90 = -1;
      for (let i = i0; i < i1; i++) {
        const f = (y[i] - y0) / dy;
        if (i10 < 0 && f >= 0.1) i10 = i;
        if (i90 < 0 && f >= 0.9) { i90 = i; break; }
      }
      out.rise = (i10 >= 0 && i90 >= 0) ? t[i90] - t[i10] : NaN;
      let ext = y0, iext = i0;
      for (let i = i0; i < i1; i++) if (sgn * (y[i] - ext) > 0) { ext = y[i]; iext = i; }
      out.overshoot = Math.max(0, (sgn * (ext - yss) / Math.abs(dy)) * 100);
      out.peakTime = t[iext] - t0;
      let last = i0 - 1;
      for (let i = i0; i < i1; i++) if (Math.abs(y[i] - yss) > band * Math.abs(dy)) last = i;
      out.settling = last >= i1 - 2 ? NaN : t[last + 1] - t0;
      out.settled = !isNaN(out.settling);
      let dev = 0; for (let i = i1 - tail; i < i1; i++) dev = Math.max(dev, Math.abs(y[i] - yss));
      if (dev > band * Math.abs(dy)) out.settled = false;
    } else { out.rise = NaN; out.overshoot = NaN; out.settling = NaN; out.peakTime = NaN; }
    let iae = 0, ise = 0, itae = 0;
    for (let i = i0; i < i1 - 1; i++) { const e = Math.abs(target - y[i]); const dt = t[i + 1] - t[i]; iae += e * dt; ise += e * e * dt; itae += (t[i] - t0) * e * dt; }
    out.iae = iae; out.ise = ise; out.itae = itae; out.ymax = ymax; out.tmax = t[imax];
    return out;
  }

  /* Load-disturbance metrics on [tD, t1): peak deviation from the level just before tD and recovery time to the band. */
  function disturbanceMetrics(res, { tD, t1 = null, scale = 1, band = 0.02 } = {}) {
    const { t, y } = res;
    const iD = idxAt(t, tD), i1 = t1 == null ? t.length : idxAt(t, t1);
    if (i1 - iD < 10) return null;
    const base = y[Math.max(0, iD - 1)];
    let peak = 0, ipeak = iD;
    for (let i = iD; i < i1; i++) { const dv = Math.abs(y[i] - base); if (dv > peak) { peak = dv; ipeak = i; } }
    let last = iD - 1;
    for (let i = iD; i < i1; i++) if (Math.abs(y[i] - base) > band * Math.abs(scale)) last = i;
    const recovery = last >= i1 - 2 ? NaN : t[last + 1] - tD;
    let iae = 0; for (let i = iD; i < i1 - 1; i++) iae += Math.abs(y[i] - base) * (t[i + 1] - t[i]);
    return { peak, peakTime: t[ipeak] - tD, recovery, iae, base };
  }

  function totalVariation(u, from = 0) { let tv = 0; for (let i = Math.max(1, from); i < u.length; i++) tv += Math.abs(u[i] - u[i - 1]); return tv; }
  function maxAbs(u) { let m = 0; for (let i = 0; i < u.length; i++) m = Math.max(m, Math.abs(u[i])); return m; }

  // ------------------------------------------------------------ identification
  /* Two-point FOPDT fit of an open-loop step response (input step du at t = 0, y from rest).
     t28 and t63: times at 28.3 % and 63.2 % of the final change. τ = 1.5 (t63 − t28); L = t63 − τ. */
  function identifyFOPDT(res, du = 1) {
    const { t, y } = res;
    const n = t.length;
    const tail = Math.max(5, Math.floor(n * 0.05));
    let yss = 0; for (let i = n - tail; i < n; i++) yss += y[i]; yss /= tail;
    const y0 = y[0], dy = yss - y0;
    if (Math.abs(dy) < 1e-9) return null;
    const cross = f => { for (let i = 1; i < n; i++) { const a = (y[i - 1] - y0) / dy, b = (y[i] - y0) / dy; if (a < f && b >= f) { const s = (f - a) / (b - a); return t[i - 1] + s * (t[i] - t[i - 1]); } } return NaN; };
    const t28 = cross(0.283), t63 = cross(0.632);
    const tau = 1.5 * (t63 - t28);
    const L = Math.max(0, t63 - tau);
    return { K: dy / du, tau, L, t28, t63, yss, y0 };
  }

  // ------------------------------------------------------------ tuning rules
  /* All rules return {Kp, Ti, Td} (standard/ISA form). FOPDT parameters: K, tau (T), L. */
  /* Eight rules, so each keeps a fixed color slot in the comparison plot. */
  const rules = [
    {
      id: 'imc-pid', name: 'IMC PID (λ)', needs: 'fopdt', hasLambda: true,
      fn: ({ K, tau, L }, lambda) => ({ Kp: (tau + L / 2) / (K * (lambda + L / 2)), Ti: tau + L / 2, Td: tau * L / (2 * tau + L) }),
      note: 'Um único ajuste: λ é a constante de tempo desejada em malha fechada. λ maior: mais lenta e mais tolerante a erro de modelo.',
    },
    {
      id: 'zn-ol-pid', name: 'Ziegler–Nichols (malha aberta) PID', needs: 'fopdt',
      fn: ({ K, tau, L }) => ({ Kp: 1.2 * tau / (K * L), Ti: 2 * L, Td: 0.5 * L }),
      note: 'Projetada para decaimento de um quarto: rápida, oscilatória, sensível a erro em L.',
    },
    {
      id: 'simc-pi', name: 'SIMC PI (Skogestad)', needs: 'fopdt', hasLambda: true,
      fn: ({ K, tau, L }, lambda) => ({ Kp: tau / (K * (lambda + L)), Ti: Math.min(tau, 4 * (lambda + L)), Td: 0 }),
      note: 'τc = λ; o padrão τc = L equilibra velocidade e tolerância a erro de modelo. O min() evita ação integral lenta em plantas dominadas pelo atraso.',
    },
    {
      id: 'cc-pid', name: 'Cohen–Coon PID', needs: 'fopdt',
      fn: ({ K, tau, L }) => { const r = L / tau; return { Kp: (tau / (K * L)) * (4 / 3 + r / 4), Ti: L * (32 + 6 * r) / (13 + 8 * r), Td: 4 * L / (11 + 2 * r) }; },
      note: 'Os maiores ganhos do conjunto clássico; corrige ZN para L/τ maior. Exige filtro na derivada.',
    },
    {
      id: 'zn-cl-pid', name: 'Ziegler–Nichols (ganho crítico) PID', needs: 'ultimate',
      fn: ({ Ku, Pu }) => ({ Kp: 0.6 * Ku, Ti: Pu / 2, Td: Pu / 8 }),
      note: 'Linha clássica do PID: Ti = 4 Td. Oscilatória por projeto.',
    },
    {
      id: 'tl-pid', name: 'Tyreus–Luyben PID', needs: 'ultimate',
      fn: ({ Ku, Pu }) => ({ Kp: 0.45 * Ku, Ti: 2.2 * Pu, Td: Pu / 6.3 }),
      note: 'Regra conservadora de ganho crítico; sobressinal bem menor que ZN.',
    },
    {
      id: 'zn-ol-pi', name: 'Ziegler–Nichols (malha aberta) PI', needs: 'fopdt',
      fn: ({ K, tau, L }) => ({ Kp: 0.9 * tau / (K * L), Ti: L / 0.3, Td: 0 }),
      note: 'PI de decaimento de um quarto. Espere sobressinal grande.',
    },
    {
      id: 'zn-cl-pi', name: 'Ziegler–Nichols (ganho crítico) PI', needs: 'ultimate',
      fn: ({ Ku, Pu }) => ({ Kp: 0.45 * Ku, Ti: Pu / 1.2, Td: 0 }),
      note: 'Linha clássica da tabela para PI.',
    },
  ];
  const ruleById = Object.fromEntries(rules.map(r => [r.id, r]));

  // ------------------------------------------------------------ relay auto-tune
  /* Relay feedback: u = ±d around the setpoint with hysteresis eps. The loop settles into a limit
     cycle whose amplitude a and period Pu give Ku = 4d / (π √(a² − eps²)). */
  function relayTest(plant, { d = 1, eps = 0.02, T = 120, Ts = 0.02, noise = 0, seed = 3 } = {}) {
    let state = 1;
    const switches = [];
    const ctrl = {
      reset() { state = 1; switches.length = 0; },
      update(r, y, t) {
        const e = r - y;
        if (state === 1 && e < -eps) { state = -1; switches.push(t); }
        else if (state === -1 && e > eps) { state = 1; switches.push(t); }
        return d * state;
      },
    };
    const res = simulate({ plant, T, Ts, controller: ctrl, setpoint: () => 0, noise, seed });
    const out = { res, ok: false };
    if (switches.length < 7) return out;
    const last = switches.slice(-7);
    const halfPeriods = [];
    for (let i = 1; i < last.length; i++) halfPeriods.push(last[i] - last[i - 1]);
    const Pu = 2 * halfPeriods.reduce((a, b) => a + b, 0) / halfPeriods.length;
    const tStart = last[0];
    let ymax = -Infinity, ymin = Infinity;
    for (let i = 0; i < res.t.length; i++) if (res.t[i] >= tStart) { ymax = Math.max(ymax, res.y[i]); ymin = Math.min(ymin, res.y[i]); }
    const a = (ymax - ymin) / 2;
    const inner = Math.max(1e-9, a * a - eps * eps);
    const Ku = 4 * d / (Math.PI * Math.sqrt(inner));
    Object.assign(out, { ok: true, a, Pu, Ku, switches: last, tStart });
    return out;
  }

  // ------------------------------------------------------------ helpers
  const stepAt = (t0, amp = 1) => t => (t >= t0 ? amp : 0);
  function pidTF(Kp, Ki, Kd, N = 10) {
    if (Kd === 0) return Ki === 0 ? TF.make([Kp], [1]) : TF.make([Kp, Ki], [1, 0]);
    const Td = Kp !== 0 ? Kd / Math.abs(Kp) : Kd;
    const Tf = Td / N;
    return TF.make([Kp * Tf + Kd, Kp + Ki * Tf, Ki], [Tf, 1, 0]);
  }

  CT.plants = plants; CT.plantById = plantById; CT.plantDefaults = plantDefaults;
  CT.PID = PID; CT.standardToParallel = standardToParallel; CT.parallelToStandard = parallelToStandard;
  CT.simulate = simulate; CT.stepMetrics = stepMetrics; CT.disturbanceMetrics = disturbanceMetrics;
  CT.totalVariation = totalVariation; CT.maxAbs = maxAbs; CT.identifyFOPDT = identifyFOPDT;
  CT.rules = rules; CT.ruleById = ruleById; CT.relayTest = relayTest; CT.stepAt = stepAt; CT.pidTF = pidTF; CT.rng = rng;
})(window.CT);
