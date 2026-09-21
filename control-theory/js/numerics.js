/* numerics.js — complex arithmetic, polynomials, transfer functions,
   frequency response, root locus and the Routh–Hurwitz table.
   Polynomials are coefficient arrays, highest degree first: [1, 3, 2] = s² + 3s + 2. */
window.CT = window.CT || {};
(function (CT) {
  'use strict';
  const EPS = 1e-12;

  // ---------------------------------------------------------------- complex
  const C = {
    of: (re, im = 0) => ({ re, im }),
    add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
    sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
    mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
    div: (a, b) => {
      const d = b.re * b.re + b.im * b.im;
      return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
    },
    scale: (a, k) => ({ re: a.re * k, im: a.im * k }),
    abs: a => Math.hypot(a.re, a.im),
    arg: a => Math.atan2(a.im, a.re),
    exp: a => { const m = Math.exp(a.re); return { re: m * Math.cos(a.im), im: m * Math.sin(a.im) }; },
    isReal: (a, tol = 1e-7) => Math.abs(a.im) <= tol * Math.max(1, Math.abs(a.re)),
    fmt(a, d = 3) {
      const re = +a.re.toFixed(d), im = +a.im.toFixed(d);
      if (Math.abs(im) < Math.pow(10, -d)) return `${re}`;
      return `${re} ${im < 0 ? '−' : '+'} ${Math.abs(im)}j`;
    },
  };

  // ------------------------------------------------------------ polynomials
  const P = {
    trim(p) {
      let i = 0;
      while (i < p.length - 1 && Math.abs(p[i]) < EPS) i++;
      return p.slice(i);
    },
    degree(p) { return P.trim(p).length - 1; },
    add(a, b) {
      const n = Math.max(a.length, b.length);
      const out = new Array(n).fill(0);
      for (let i = 0; i < a.length; i++) out[n - a.length + i] += a[i];
      for (let i = 0; i < b.length; i++) out[n - b.length + i] += b[i];
      return out;
    },
    scale(a, k) { return a.map(v => v * k); },
    mul(a, b) {
      const out = new Array(a.length + b.length - 1).fill(0);
      for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
      return out;
    },
    evalR(p, x) { let acc = 0; for (const c of p) acc = acc * x + c; return acc; },
    evalC(p, s) { let acc = C.of(0); for (const c of p) acc = C.add(C.mul(acc, s), C.of(c)); return acc; },
    deriv(p) {
      const n = p.length - 1;
      if (n <= 0) return [0];
      return p.slice(0, n).map((c, i) => c * (n - i));
    },
    fromReal(r) { return [1, -r]; },
    fromPair(re, im) { return [1, -2 * re, re * re + im * im]; },
    /* Roots by Durand–Kerner (simultaneous iteration). Degree ≤ 2 is closed form. */
    roots(p0) {
      let p = P.trim(p0);
      const out = [];
      while (p.length > 1 && Math.abs(p[p.length - 1]) < EPS) { out.push(C.of(0)); p = p.slice(0, -1); }
      const n = p.length - 1;
      if (n < 1) return out;
      if (n === 1) { out.push(C.of(-p[1] / p[0])); return out; }
      if (n === 2) {
        const [a, b, c] = p;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          const q = -0.5 * (b + (b < 0 ? -1 : 1) * sq);
          out.push(C.of(q / a));
          out.push(C.of(q !== 0 ? c / q : -b / (2 * a)));
        } else {
          const re = -b / (2 * a), im = Math.sqrt(-disc) / (2 * Math.abs(a));
          out.push(C.of(re, im), C.of(re, -im));
        }
        return out;
      }
      const m = p.map(c => c / p[0]);
      const r0 = Math.pow(Math.abs(m[n]), 1 / n) || 1;
      let z = [];
      for (let k = 0; k < n; k++) z.push(C.scale(C.exp(C.of(0, 2 * Math.PI * k / n + 0.4)), r0));
      for (let iter = 0; iter < 1000; iter++) {
        let maxd = 0;
        for (let k = 0; k < n; k++) {
          const num = P.evalC(m, z[k]);
          let den = C.of(1);
          for (let j = 0; j < n; j++) if (j !== k) den = C.mul(den, C.sub(z[k], z[j]));
          if (C.abs(den) < 1e-300) den = C.of(1e-300);
          const d = C.div(num, den);
          z[k] = C.sub(z[k], d);
          maxd = Math.max(maxd, C.abs(d) / (1 + C.abs(z[k])));
        }
        if (maxd < 1e-14) break;
      }
      for (const r of z) out.push(C.isReal(r) ? C.of(r.re) : r);
      out.sort((a, b) => (a.re - b.re) || (b.im - a.im));
      return out;
    },
    /* Human-readable polynomial in s. */
    toString(p, v = 's', d = 3) {
      p = P.trim(p);
      const n = p.length - 1;
      const parts = [];
      p.forEach((c, i) => {
        if (Math.abs(c) < EPS) return;
        const pow = n - i;
        const mag = Math.abs(c);
        const num = (mag === 1 && pow > 0) ? '' : fmtNum(mag, d);
        const sv = pow === 0 ? '' : pow === 1 ? v : `${v}^${pow}`;
        const term = num && sv ? `${num} ${sv}` : (num || sv);
        parts.push({ sign: c < 0 ? '−' : '+', term });
      });
      if (!parts.length) return '0';
      return parts.map((t, i) => (i === 0 ? (t.sign === '−' ? '−' : '') : ` ${t.sign} `) + t.term).join('');
    },
  };

  function fmtNum(x, d = 3) {
    if (!isFinite(x)) return String(x);
    const ax = Math.abs(x);
    if (ax !== 0 && (ax < 1e-3 || ax >= 1e6)) return x.toExponential(2);
    return String(+x.toPrecision(Math.max(1, d)));
  }

  // ------------------------------------------------------ transfer functions
  const TF = {
    make(num, den, delay = 0) { return { num: P.trim(num), den: P.trim(den), delay }; },
    gain(k) { return TF.make([k], [1]); },
    series(a, b) { return TF.make(P.mul(a.num, b.num), P.mul(a.den, b.den), (a.delay || 0) + (b.delay || 0)); },
    parallel(a, b) { return TF.make(P.add(P.mul(a.num, b.den), P.mul(b.num, a.den)), P.mul(a.den, b.den)); },
    /* Negative feedback: G / (1 + G H). Delays are not representable rationally; callers simulate them in time. */
    feedback(G, H = { num: [1], den: [1] }) {
      return TF.make(P.mul(G.num, H.den), P.add(P.mul(G.den, H.den), P.mul(G.num, H.num)));
    },
    poles(G) { return P.roots(G.den); },
    zeros(G) { return P.degree(G.num) > 0 ? P.roots(G.num) : []; },
    dcGain(G) {
      const d = G.den[G.den.length - 1], n = G.num[G.num.length - 1];
      return Math.abs(d) < EPS ? (Math.abs(n) < EPS ? NaN : Infinity) : n / d;
    },
    isStable(G) { return TF.poles(G).every(p => p.re < -1e-9); },
    evalC(G, s) { return C.div(P.evalC(G.num, s), P.evalC(G.den, s)); },
    freq(G, w) {
      let v = TF.evalC(G, C.of(0, w));
      if (G.delay) v = C.mul(v, C.exp(C.of(0, -w * G.delay)));
      return v;
    },
    /* Controllable canonical state-space realisation of a proper TF. */
    toSS(G) {
      const den = P.trim(G.den);
      const n = den.length - 1;
      const a = den.map(c => c / den[0]);
      const num = P.trim(G.num).map(c => c / den[0]);
      if (num.length > n + 1) throw new Error('Improper transfer function (numerator degree > denominator degree)');
      const b = new Array(n + 1 - num.length).fill(0).concat(num);
      const D = b[0];
      const bs = [];
      for (let i = 1; i <= n; i++) bs.push(b[i] - a[i] * D);
      const lastRow = new Float64Array(n);
      for (let i = 0; i < n; i++) lastRow[i] = -a[n - i];
      const Cv = new Float64Array(n);
      for (let i = 0; i < n; i++) Cv[i] = bs[n - 1 - i];
      return { n, lastRow, C: Cv, D };
    },
    toString(G, d = 3) {
      const num = P.toString(G.num, 's', d), den = P.toString(G.den, 's', d);
      const dl = G.delay ? ` · e^(−${fmtNum(G.delay, d)} s)` : '';
      if (den === '1') return num + dl;
      return `(${num}) / (${den})${dl}`;
    },
  };

  // -------------------------------------------------------- frequency domain
  /* Bode data for G over [wmin, wmax], n points, log spaced. Phase is unwrapped and
     the dead-time phase (−ωL) is added analytically so it never wraps. */
  function bode(G, wmin, wmax, n = 600) {
    const w = new Float64Array(n), mag = new Float64Array(n), db = new Float64Array(n), ph = new Float64Array(n);
    const lw0 = Math.log10(wmin), lw1 = Math.log10(wmax);
    const rational = { num: G.num, den: G.den, delay: 0 };
    let prev = null;
    for (let i = 0; i < n; i++) {
      const wi = Math.pow(10, lw0 + (lw1 - lw0) * i / (n - 1));
      const v = TF.freq(rational, wi);
      const m = C.abs(v);
      let p = C.arg(v) * 180 / Math.PI;
      if (prev !== null) {
        while (p - prev > 180) p -= 360;
        while (p - prev < -180) p += 360;
      }
      prev = p;
      w[i] = wi; mag[i] = m; db[i] = 20 * Math.log10(m);
      ph[i] = p - (G.delay || 0) * wi * 180 / Math.PI;
    }
    return { w, mag, db, phase: ph };
  }

  function interpLog(x0, x1, y0, y1, yTarget) {
    const t = (yTarget - y0) / (y1 - y0);
    return Math.exp(Math.log(x0) + t * (Math.log(x1) - Math.log(x0)));
  }
  function interpAt(bd, key, w) {
    const { w: ws } = bd;
    let i = 0;
    while (i < ws.length - 2 && ws[i + 1] < w) i++;
    const t = (Math.log(w) - Math.log(ws[i])) / (Math.log(ws[i + 1]) - Math.log(ws[i]));
    return bd[key][i] + t * (bd[key][i + 1] - bd[key][i]);
  }

  /* Gain and phase margins from bode data. Returns the most critical of each. */
  function margins(bd) {
    const n = bd.w.length;
    const gainX = [], phaseX = [];
    for (let i = 0; i < n - 1; i++) {
      if ((bd.db[i] >= 0) !== (bd.db[i + 1] >= 0)) {
        const wc = interpLog(bd.w[i], bd.w[i + 1], bd.db[i], bd.db[i + 1], 0);
        let pm = interpAt(bd, 'phase', wc) + 180;
        pm = ((pm + 180) % 360 + 360) % 360 - 180;
        gainX.push({ w: wc, pm });
      }
      const q0 = Math.floor((bd.phase[i] + 180) / 360), q1 = Math.floor((bd.phase[i + 1] + 180) / 360);
      if (q0 !== q1) {
        const target = (q0 > q1 ? q0 : q1) * 360 - 180;
        const wp = interpLog(bd.w[i], bd.w[i + 1], bd.phase[i], bd.phase[i + 1], target);
        const gmDb = -interpAt(bd, 'db', wp);
        phaseX.push({ w: wp, gmDb });
      }
    }
    let pm = null, wgc = null, gmDb = null, wpc = null;
    if (gainX.length) { const g = gainX.reduce((m, x) => x.pm < m.pm ? x : m); pm = g.pm; wgc = g.w; }
    if (phaseX.length) { const g = phaseX.reduce((m, x) => x.gmDb < m.gmDb ? x : m); gmDb = g.gmDb; wpc = g.w; }
    return { pm, wgc, gmDb, wpc, gainCrossings: gainX.length, phaseCrossings: phaseX.length };
  }

  /* Nyquist locus for ω in [wmin, wmax] (positive frequencies only). */
  function nyquist(G, wmin, wmax, n = 800) {
    const re = new Float64Array(n), im = new Float64Array(n), w = new Float64Array(n);
    const lw0 = Math.log10(wmin), lw1 = Math.log10(wmax);
    for (let i = 0; i < n; i++) {
      const wi = Math.pow(10, lw0 + (lw1 - lw0) * i / (n - 1));
      const v = TF.freq(G, wi);
      re[i] = v.re; im[i] = v.im; w[i] = wi;
    }
    return { re, im, w };
  }

  /* Peak of |S(jω)| = 1/|1+L| — a compact robustness number. */
  function sensitivityPeak(L, wmin, wmax, n = 600) {
    let Ms = 0, wMs = wmin;
    const lw0 = Math.log10(wmin), lw1 = Math.log10(wmax);
    for (let i = 0; i < n; i++) {
      const wi = Math.pow(10, lw0 + (lw1 - lw0) * i / (n - 1));
      const v = TF.freq(L, wi);
      const s = 1 / C.abs(C.add(C.of(1), v));
      if (s > Ms) { Ms = s; wMs = wi; }
    }
    return { Ms, wMs };
  }

  // ------------------------------------------------------------- root locus
  /* Closed-loop poles of 1 + K·G = 0 for each K. Branches are matched by proximity. */
  function rootLocus(G, Ks) {
    const branches = [];
    let prev = null;
    for (const K of Ks) {
      const poly = P.add(G.den, P.scale(G.num, K));
      let r = P.roots(poly);
      if (prev) {
        const used = new Set(), ordered = [];
        for (const p of prev) {
          let best = -1, bd = Infinity;
          r.forEach((x, i) => { if (!used.has(i)) { const d = Math.hypot(x.re - p.re, x.im - p.im); if (d < bd) { bd = d; best = i; } } });
          if (best >= 0) { used.add(best); ordered.push(r[best]); }
        }
        r.forEach((x, i) => { if (!used.has(i)) ordered.push(x); });
        r = ordered;
      }
      r.forEach((x, i) => { if (!branches[i]) branches[i] = []; branches[i].push({ K, re: x.re, im: x.im }); });
      prev = r;
    }
    return branches;
  }

  // ---------------------------------------------------------- Routh–Hurwitz
  function routh(coeffs) {
    const p = P.trim(coeffs);
    const n = p.length - 1;
    const notes = [];
    if (n < 1) return { rows: [[p[0]]], powers: [0], rhp: 0, notes: ['Constant polynomial: nothing to test.'], valid: false };
    const negFirst = p[0] < 0;
    const q = negFirst ? p.map(c => -c) : p;
    if (negFirst) notes.push('Leading coefficient was negative: the whole polynomial was multiplied by −1 (same roots).');
    if (q.some(c => c <= 0)) notes.push('Necessary condition already fails: a coefficient is zero or negative, so at least one root is not in the open left half-plane.');
    const width = Math.ceil((n + 1) / 2);
    const r0 = [], r1 = [];
    for (let i = 0; i < q.length; i += 2) r0.push(q[i]);
    for (let i = 1; i < q.length; i += 2) r1.push(q[i]);
    while (r0.length < width) r0.push(0);
    while (r1.length < width) r1.push(0);
    const rows = [r0, r1];
    const powers = [n, n - 1];
    for (let k = 2; k <= n; k++) {
      const prev2 = rows[k - 2];
      let prev1 = rows[k - 1];
      if (prev1.every(v => Math.abs(v) < 1e-12)) {
        const deg = n - (k - 2);
        prev1 = prev2.map((c, j) => c * (deg - 2 * j));
        rows[k - 1] = prev1;
        notes.push(`Row s^${deg - 1} was entirely zero: it was replaced by the derivative of the auxiliary polynomial A(s) formed from row s^${deg}. A(s) has roots placed symmetrically about the origin (a pair on the jω axis, or mirrored real roots).`);
      }
      let pivot = prev1[0];
      if (Math.abs(pivot) < 1e-12) {
        pivot = 1e-9;
        prev1[0] = pivot;
        notes.push(`A zero appeared in the first column of row s^${n - (k - 1)}: replaced by a small positive ε (taken as +10⁻⁹) to continue the table.`);
      }
      const row = [];
      for (let j = 0; j < width; j++) {
        const a = prev2[j + 1] ?? 0, b = prev1[j + 1] ?? 0;
        row.push((pivot * a - prev2[0] * b) / pivot);
      }
      rows.push(row);
      powers.push(n - k);
    }
    let rhp = 0;
    for (let i = 1; i < rows.length; i++) {
      const s0 = Math.sign(rows[i - 1][0]) || 1, s1 = Math.sign(rows[i][0]) || 1;
      if (s0 !== s1) rhp++;
    }
    return { rows, powers, rhp, notes, valid: true };
  }

  CT.C = C; CT.P = P; CT.TF = TF;
  CT.bode = bode; CT.margins = margins; CT.nyquist = nyquist; CT.sensitivityPeak = sensitivityPeak;
  CT.rootLocus = rootLocus; CT.routh = routh; CT.fmtNum = fmtNum;
})(window.CT);
