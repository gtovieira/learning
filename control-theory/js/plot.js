/* plot.js — small canvas plotting layer for the workshop: line series, reference lines,
   scatter marks (poles/zeros), log axes, equal-aspect s-plane, crosshair tooltip,
   legend, table view and draggable handles. Colors come from CSS tokens so both themes work. */
(function (CT) {
  'use strict';
  const TOKENS = ['ink', 'ink-2', 'muted', 'grid', 'axis', 'surface', 'accent', 'font-mono', 'font-body',
    'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8', 'good', 'warn', 'crit'];

  function readTokens(el) {
    const cs = getComputedStyle(el);
    const o = {};
    for (const n of TOKENS) o[n] = cs.getPropertyValue('--' + n).trim();
    return o;
  }
  function niceStep(range, n) {
    const raw = range / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const r = raw / mag;
    return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  }
  function linTicks(min, max, n = 5) {
    if (!(max > min)) return { ticks: [min], step: 1 };
    const step = niceStep(max - min, n);
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return { ticks: out, step };
  }
  function fmtTick(v, step) {
    if (Math.abs(v) < 1e-12) return '0';
    const dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
    if (Math.abs(v) >= 1e5) return CT.dec(v.toExponential(1));
    return CT.dec(v.toFixed(dec));
  }
  function fmtLog(v) {
    const k = Math.round(Math.log10(v));
    if (Math.abs(Math.log10(v) - k) < 1e-9) return k >= -3 && k <= 5 ? CT.dec(Math.pow(10, k)) : `1e${k}`;
    return CT.fmtNum(v, 2);
  }
  function fmtVal(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return CT.dec(v.toFixed(0));
    if (a >= 10) return CT.dec(v.toFixed(2));
    if (a >= 0.01) return CT.dec(v.toFixed(3));
    return CT.dec(v.toExponential(2));
  }
  function bsearch(x, v) {
    let lo = 0, hi = x.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (x[m] < v) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(x[lo - 1] - v) < Math.abs(x[lo] - v)) lo--;
    return lo;
  }

  class Plot {
    constructor(container, opts = {}) {
      this.el = container;
      this.opts = Object.assign({ height: 240, xLabel: '', yLabel: '', xLog: false, yLog: false, equal: false, includeZero: true, legend: true, table: true, padY: 0.08, title: '' }, opts);
      this.data = { series: [], refLines: [], vlines: [], markers: [], points: [], texts: [], drags: [], bands: [] };
      this.hover = null;
      this.tableOpen = false;
      this.build();
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(this.wrap);
    }
    build() {
      const el = this.el;
      el.classList.add('plot');
      const head = document.createElement('div'); head.className = 'plot-head';
      this.titleEl = document.createElement('div'); this.titleEl.className = 'plot-title'; this.titleEl.textContent = this.opts.title;
      this.legendEl = document.createElement('div'); this.legendEl.className = 'plot-legend';
      head.append(this.titleEl, this.legendEl);
      if (this.opts.table) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'plot-table-btn'; btn.textContent = 'Tabela';
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', () => { this.tableOpen = !this.tableOpen; btn.setAttribute('aria-expanded', String(this.tableOpen)); this.tableEl.hidden = !this.tableOpen; if (this.tableOpen) this.renderTable(); });
        head.append(btn);
      }
      this.wrap = document.createElement('div'); this.wrap.className = 'plot-canvas-wrap'; this.wrap.style.height = this.opts.height + 'px';
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('role', 'img');
      if (this.opts.ariaLabel) this.canvas.setAttribute('aria-label', this.opts.ariaLabel);
      this.tip = document.createElement('div'); this.tip.className = 'plot-tip'; this.tip.hidden = true;
      this.wrap.append(this.canvas, this.tip);
      this.tableEl = document.createElement('div'); this.tableEl.className = 'plot-table'; this.tableEl.hidden = true;
      el.append(head, this.wrap, this.tableEl);
      this.ctx = this.canvas.getContext('2d');
      this.canvas.addEventListener('pointermove', e => this.onMove(e));
      this.canvas.addEventListener('pointerleave', () => { if (!this.dragging) { this.hover = null; this.tip.hidden = true; this.draw(); } });
      this.canvas.addEventListener('pointerdown', e => this.onDown(e));
      this.canvas.addEventListener('pointerup', e => this.onUp(e));
      this.canvas.addEventListener('pointercancel', e => this.onUp(e));
    }
    setTitle(t) { this.titleEl.textContent = t; }
    set(data) {
      Object.assign(this.data, data);
      this.renderLegend();
      this.draw();
      if (this.tableOpen) this.renderTable();
    }
    color(c) { return this.tk[c] || c; }
    renderLegend() {
      const L = this.legendEl;
      L.textContent = '';
      const items = [];
      this.data.series.forEach(s => { if (s.name && !s.noLegend) items.push({ name: s.name, color: s.color || 'series-1', glyph: 'line' }); });
      this.data.points.forEach(p => { if (p.name) items.push({ name: p.name, color: p.color || 'ink', glyph: p.shape || 'dot' }); });
      if (items.length < 2 || !this.opts.legend) return;
      const tk = readTokens(this.el);
      for (const it of items) {
        const chip = document.createElement('span'); chip.className = 'legend-item';
        const g = document.createElement('span'); g.className = 'legend-glyph legend-' + it.glyph; g.style.setProperty('--c', tk[it.color] || it.color);
        if (it.glyph === 'x') g.textContent = '×'; else if (it.glyph === 'o') g.textContent = '○';
        const t = document.createElement('span'); t.textContent = it.name;
        chip.append(g, t); L.append(chip);
      }
    }
    renderTable() {
      const T = this.tableEl; T.textContent = '';
      const series = this.data.series.filter(s => s.x && s.x.length);
      if (!series.length) { T.textContent = 'Ainda sem dados.'; return; }
      const table = document.createElement('table');
      const thead = document.createElement('thead'), trh = document.createElement('tr');
      const th0 = document.createElement('th'); th0.textContent = this.opts.xLabel || 'x'; trh.append(th0);
      series.forEach((s, i) => { const th = document.createElement('th'); th.textContent = s.name || `série ${i + 1}`; trh.append(th); });
      thead.append(trh); table.append(thead);
      const tbody = document.createElement('tbody');
      const base = series[0].x;
      const rows = Math.min(40, base.length);
      for (let k = 0; k < rows; k++) {
        const i = rows === 1 ? 0 : Math.round(k * (base.length - 1) / (rows - 1));
        const tr = document.createElement('tr');
        const td0 = document.createElement('td'); td0.textContent = fmtVal(base[i]); tr.append(td0);
        for (const s of series) {
          const j = s.x === base ? i : bsearch(s.x, base[i]);
          const td = document.createElement('td'); td.textContent = fmtVal(s.y[j]); tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      const note = document.createElement('p'); note.className = 'plot-table-note';
      note.textContent = `${rows} de ${base.length} amostras exibidas, igualmente espaçadas.`;
      T.append(table, note);
    }
    // ---- scales
    domain() {
      const d = this.data, o = this.opts;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const addX = v => { if (isFinite(v)) { if (v < x0) x0 = v; if (v > x1) x1 = v; } };
      const addY = v => { if (isFinite(v)) { if (v < y0) y0 = v; if (v > y1) y1 = v; } };
      for (const s of d.series) for (let i = 0; i < s.x.length; i++) { addX(s.x[i]); if (!s.noScale) addY(s.y[i]); }
      for (const p of d.points) for (let i = 0; i < p.x.length; i++) { addX(p.x[i]); addY(p.y[i]); }
      for (const r of d.refLines) addY(r.y);
      for (const m of d.markers) { addX(m.x); addY(m.y); }
      for (const g of d.drags) { addX(g.x); addY(g.y); }
      if (o.includeZero && !o.yLog) addY(0);
      if (o.includeZeroX && !o.xLog) addX(0);
      if (o.xDomain) [x0, x1] = o.xDomain;
      if (o.yDomain) [y0, y1] = o.yDomain;
      if (o.xMin != null) x0 = Math.min(x0, o.xMin); if (o.xMax != null) x1 = Math.max(x1, o.xMax);
      if (o.yMin != null) y0 = Math.min(y0, o.yMin); if (o.yMax != null) y1 = Math.max(y1, o.yMax);
      if (!isFinite(x0)) { x0 = 0; x1 = 1; } if (!isFinite(y0)) { y0 = 0; y1 = 1; }
      if (o.yLog) { y0 = Math.max(y0, 1e-6); y1 = Math.max(y1, y0 * 10); }
      if (o.xLog) { x0 = Math.max(x0, 1e-6); x1 = Math.max(x1, x0 * 10); }
      if (!o.yDomain) {
        if (o.yLog) { const l0 = Math.log10(y0), l1 = Math.log10(y1); y0 = Math.pow(10, l0 - 0.05 * (l1 - l0)); y1 = Math.pow(10, l1 + 0.05 * (l1 - l0)); }
        else { const pad = (y1 - y0) * o.padY || 1; y0 -= pad; y1 += pad; }
      }
      if (x1 - x0 <= 0) { x1 = x0 + 1; }
      if (y1 - y0 <= 0) { y1 = y0 + 1; }
      return { x0, x1, y0, y1 };
    }
    layout() {
      const o = this.opts, tk = this.tk;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(120, this.wrap.clientWidth), H = this.opts.height;
      if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
        this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
        this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
      }
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let dom = this.domain();
      ctx.font = `11px ${tk['font-mono']}`;
      const yt = o.yLog ? this.logTicks(dom.y0, dom.y1) : linTicks(dom.y0, dom.y1, Math.max(3, Math.floor(H / 55)));
      let labelW = 0;
      for (const v of yt.ticks) labelW = Math.max(labelW, ctx.measureText(o.yLog ? fmtLog(v) : fmtTick(v, yt.step)).width);
      const ml = Math.ceil(labelW) + 10 + (o.yLabel ? 16 : 0);
      const mb = 22 + (o.xLabel ? 16 : 0);
      const mt = 10, mr = 14;
      const pw = W - ml - mr, ph = H - mt - mb;
      if (o.equal) {
        const ux = (dom.x1 - dom.x0) / pw, uy = (dom.y1 - dom.y0) / ph, u = Math.max(ux, uy);
        const cx = (dom.x0 + dom.x1) / 2, cy = (dom.y0 + dom.y1) / 2;
        dom = { x0: cx - u * pw / 2, x1: cx + u * pw / 2, y0: cy - u * ph / 2, y1: cy + u * ph / 2 };
      }
      const lx0 = o.xLog ? Math.log10(dom.x0) : dom.x0, lx1 = o.xLog ? Math.log10(dom.x1) : dom.x1;
      const ly0 = o.yLog ? Math.log10(dom.y0) : dom.y0, ly1 = o.yLog ? Math.log10(dom.y1) : dom.y1;
      const sx = v => ml + ((o.xLog ? Math.log10(v) : v) - lx0) / (lx1 - lx0) * pw;
      const sy = v => mt + ph - ((o.yLog ? Math.log10(v) : v) - ly0) / (ly1 - ly0) * ph;
      const ix = px => { const t = lx0 + (px - ml) / pw * (lx1 - lx0); return o.xLog ? Math.pow(10, t) : t; };
      const iy = py => { const t = ly0 + (mt + ph - py) / ph * (ly1 - ly0); return o.yLog ? Math.pow(10, t) : t; };
      return { W, H, ml, mr, mt, mb, pw, ph, dom, sx, sy, ix, iy, yt };
    }
    logTicks(min, max) {
      const k0 = Math.floor(Math.log10(min)), k1 = Math.ceil(Math.log10(max));
      const ticks = [], minor = [];
      for (let k = k0; k <= k1; k++) {
        const d = Math.pow(10, k);
        if (d >= min && d <= max) ticks.push(d);
        for (let m = 2; m < 10; m++) { const v = m * d; if (v >= min && v <= max) minor.push(v); }
      }
      return { ticks, minor, step: 1 };
    }
    // ---- drawing
    draw() {
      if (!this.wrap.clientWidth) return;
      this.tk = readTokens(this.el);
      const tk = this.tk, o = this.opts, ctx = this.ctx, d = this.data;
      const L = this.layout(); this.L = L;
      const { W, H, ml, mt, pw, ph, dom, sx, sy } = L;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = tk.surface; ctx.fillRect(0, 0, W, H);
      // grid + ticks
      ctx.lineWidth = 1; ctx.strokeStyle = tk.grid; ctx.fillStyle = tk.muted;
      ctx.font = `11px ${tk['font-mono']}`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const yt = L.yt;
      if (o.yLog && yt.minor) { ctx.strokeStyle = tk.grid; ctx.globalAlpha = 0.45; for (const v of yt.minor) { const py = Math.round(sy(v)) + 0.5; ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + pw, py); ctx.stroke(); } ctx.globalAlpha = 1; }
      for (const v of yt.ticks) {
        const py = Math.round(sy(v)) + 0.5;
        ctx.strokeStyle = tk.grid; ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + pw, py); ctx.stroke();
        ctx.fillText(o.yLog ? fmtLog(v) : fmtTick(v, yt.step), ml - 6, py);
      }
      const xt = o.xLog ? this.logTicks(dom.x0, dom.x1) : linTicks(dom.x0, dom.x1, Math.max(3, Math.floor(pw / 70)));
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      if (o.xLog && xt.minor) { ctx.globalAlpha = 0.45; for (const v of xt.minor) { const px = Math.round(sx(v)) + 0.5; ctx.beginPath(); ctx.moveTo(px, mt); ctx.lineTo(px, mt + ph); ctx.stroke(); } ctx.globalAlpha = 1; }
      for (const v of xt.ticks) {
        const px = Math.round(sx(v)) + 0.5;
        ctx.strokeStyle = tk.grid; ctx.beginPath(); ctx.moveTo(px, mt); ctx.lineTo(px, mt + ph); ctx.stroke();
        ctx.fillStyle = tk.muted; ctx.fillText(o.xLog ? fmtLog(v) : fmtTick(v, xt.step), px, mt + ph + 5);
      }
      // axes at zero
      ctx.strokeStyle = tk.axis;
      if (!o.yLog && dom.y0 <= 0 && dom.y1 >= 0) { const py = Math.round(sy(0)) + 0.5; ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + pw, py); ctx.stroke(); }
      if (!o.xLog && dom.x0 <= 0 && dom.x1 >= 0) { const px = Math.round(sx(0)) + 0.5; ctx.beginPath(); ctx.moveTo(px, mt); ctx.lineTo(px, mt + ph); ctx.stroke(); }
      // frame bottom/left
      ctx.beginPath(); ctx.moveTo(ml + 0.5, mt); ctx.lineTo(ml + 0.5, mt + ph + 0.5); ctx.lineTo(ml + pw, mt + ph + 0.5); ctx.stroke();
      // axis labels
      ctx.fillStyle = tk['ink-2']; ctx.font = `11px ${tk['font-body']}`;
      if (o.xLabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(o.xLabel, ml + pw / 2, H - 2); }
      if (o.yLabel) { ctx.save(); ctx.translate(11, mt + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.yLabel, 0, 0); ctx.restore(); }
      // clip to plot area
      ctx.save(); ctx.beginPath(); ctx.rect(ml, mt, pw, ph); ctx.clip();
      // bands
      for (const b of d.bands) { ctx.fillStyle = this.color(b.color || 'muted'); ctx.globalAlpha = b.alpha ?? 0.08; const x0 = b.x0 != null ? sx(b.x0) : ml, x1 = b.x1 != null ? sx(b.x1) : ml + pw; const y0 = b.y0 != null ? sy(b.y0) : mt + ph, y1 = b.y1 != null ? sy(b.y1) : mt; ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.globalAlpha = 1; }
      // guide lines (light, thin)
      for (const g of (d.guides || [])) { ctx.strokeStyle = this.color(g.color || 'axis'); ctx.lineWidth = 1; ctx.globalAlpha = g.alpha ?? 0.7; ctx.beginPath(); for (let i = 0; i < g.x.length; i++) { const px = sx(g.x[i]), py = sy(g.y[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke(); ctx.globalAlpha = 1; if (g.label) { ctx.fillStyle = tk.muted; ctx.font = `10px ${tk['font-mono']}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(g.label, sx(g.x[g.x.length - 1]) + 3, sy(g.y[g.y.length - 1]) - 2); } }
      // series
      for (const s of d.series) {
        const col = this.color(s.color || 'series-1');
        const n = s.x.length;
        if (!n) continue;
        if (s.area) {
          ctx.fillStyle = col; ctx.globalAlpha = 0.1; ctx.beginPath();
          const base = sy(Math.max(dom.y0, Math.min(dom.y1, 0)));
          ctx.moveTo(sx(s.x[0]), base);
          for (let i = 0; i < n; i++) ctx.lineTo(sx(s.x[i]), sy(s.y[i]));
          ctx.lineTo(sx(s.x[n - 1]), base); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = col; ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.globalAlpha = s.alpha ?? 1;
        if (s.dash) ctx.setLineDash(s.dash); else ctx.setLineDash([]);
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < n; i++) {
          const yv = s.y[i];
          if (!isFinite(yv) || (o.yLog && yv <= 0)) { pen = false; continue; }
          const px = sx(s.x[i]), py = sy(yv);
          if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (s.endLabel) { ctx.fillStyle = tk['ink-2']; ctx.font = `11px ${tk['font-body']}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(s.endLabel, sx(s.x[n - 1]) - 2, sy(s.y[n - 1]) - 4); }
      }
      // reference lines
      for (const r of d.refLines) {
        ctx.strokeStyle = this.color(r.color || 'ink-2'); ctx.lineWidth = 1; ctx.globalAlpha = r.alpha ?? 0.8;
        const py = Math.round(sy(r.y)) + 0.5; ctx.beginPath(); ctx.moveTo(ml, py); ctx.lineTo(ml + pw, py); ctx.stroke(); ctx.globalAlpha = 1;
        if (r.label) { ctx.fillStyle = tk['ink-2']; ctx.font = `11px ${tk['font-body']}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(r.label, ml + pw - 4, py - 3); }
      }
      for (const v of d.vlines) {
        ctx.strokeStyle = this.color(v.color || 'ink-2'); ctx.lineWidth = 1; ctx.globalAlpha = v.alpha ?? 0.7;
        const px = Math.round(sx(v.x)) + 0.5; ctx.beginPath(); ctx.moveTo(px, mt); ctx.lineTo(px, mt + ph); ctx.stroke(); ctx.globalAlpha = 1;
        if (v.label) { ctx.fillStyle = tk['ink-2']; ctx.font = `11px ${tk['font-body']}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(v.label, px + 4, mt + 4 + (v.labelOffset || 0)); }
      }
      // points (poles/zeros/dots)
      for (const p of d.points) {
        const col = this.color(p.color || 'ink');
        const r = p.r || 5;
        for (let i = 0; i < p.x.length; i++) {
          const px = sx(p.x[i]), py = sy(p.y[i]);
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
          if (p.shape === 'x') { ctx.beginPath(); ctx.moveTo(px - r, py - r); ctx.lineTo(px + r, py + r); ctx.moveTo(px + r, py - r); ctx.lineTo(px - r, py + r); ctx.stroke(); }
          else if (p.shape === 'o') { ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke(); }
          else { ctx.beginPath(); ctx.arc(px, py, r + 2, 0, Math.PI * 2); ctx.fillStyle = tk.surface; ctx.fill(); ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
        }
      }
      // markers with label
      for (const m of d.markers) {
        const px = sx(m.x), py = sy(m.y), col = this.color(m.color || 'ink');
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = tk.surface; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        if (m.label) { ctx.fillStyle = tk['ink-2']; ctx.font = `11px ${tk['font-body']}`; ctx.textAlign = m.align || 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(m.label, px + (m.align === 'right' ? -8 : 8), py - 6 + (m.dy || 0)); }
      }
      // draggable handles
      for (const g of d.drags) {
        const px = sx(g.x), py = sy(g.y), col = this.color(g.color || 'accent');
        ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fillStyle = col; ctx.globalAlpha = this.hover && this.hover.drag === g ? 0.25 : 0.12; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = col; ctx.lineWidth = 2.5;
        if (g.shape === 'o') { ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6); ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6); ctx.stroke(); }
        if (g.label) { ctx.fillStyle = tk['ink-2']; ctx.font = `11px ${tk['font-body']}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(g.label, px + 12, py - 8); }
      }
      for (const t of d.texts) { ctx.fillStyle = this.color(t.color || 'ink-2'); ctx.font = `${t.size || 11}px ${tk['font-body']}`; ctx.textAlign = t.align || 'left'; ctx.textBaseline = t.baseline || 'top'; ctx.fillText(t.text, sx(t.x) + (t.dx || 0), sy(t.y) + (t.dy || 0)); }
      // crosshair
      if (this.hover && this.hover.x != null && !this.hover.drag && d.series.length) {
        const px = Math.round(sx(this.hover.x)) + 0.5;
        ctx.strokeStyle = tk['ink-2']; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(px, mt); ctx.lineTo(px, mt + ph); ctx.stroke(); ctx.globalAlpha = 1;
        for (const h of this.hover.hits) { ctx.beginPath(); ctx.arc(sx(h.x), sy(h.y), 5, 0, Math.PI * 2); ctx.fillStyle = tk.surface; ctx.fill(); ctx.beginPath(); ctx.arc(sx(h.x), sy(h.y), 3.5, 0, Math.PI * 2); ctx.fillStyle = this.color(h.color); ctx.fill(); }
      }
      ctx.restore();
    }
    // ---- interaction
    pos(e) { const r = this.canvas.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; }
    onMove(e) {
      if (!this.L) return;
      const { px, py } = this.pos(e);
      const L = this.L;
      if (this.dragging) {
        const g = this.dragging;
        let x = L.ix(Math.max(L.ml, Math.min(L.ml + L.pw, px)));
        let y = L.iy(Math.max(L.mt, Math.min(L.mt + L.ph, py)));
        if (g.snapReal && Math.abs(py - L.sy(0)) < 10) y = 0;
        if (this.opts.onDrag) this.opts.onDrag(g, x, y);
        return;
      }
      // drag hover
      let dragHit = null;
      for (const g of this.data.drags) { if (Math.hypot(L.sx(g.x) - px, L.sy(g.y) - py) < 14) dragHit = g; }
      if (dragHit) { this.hover = { drag: dragHit }; this.canvas.style.cursor = 'grab'; this.tip.hidden = true; this.draw(); return; }
      this.canvas.style.cursor = this.data.series.length ? 'crosshair' : 'default';
      if (px < L.ml || px > L.ml + L.pw || py < L.mt || py > L.mt + L.ph) { this.hover = null; this.tip.hidden = true; this.draw(); return; }
      const hits = [];
      let xv = null;
      if (this.data.series.length) {
        const xd = L.ix(px);
        const s0 = this.data.series.find(s => s.x.length) || null;
        if (s0) {
          const i0 = bsearch(s0.x, xd); xv = s0.x[i0];
          for (const s of this.data.series) { if (!s.x.length || s.noTip) continue; const i = s.x === s0.x ? i0 : bsearch(s.x, xv); hits.push({ name: s.name || '', x: s.x[i], y: s.y[i], color: s.color || 'series-1' }); }
        }
      }
      let pointHit = null;
      for (const p of this.data.points) for (let i = 0; i < p.x.length; i++) { const dd = Math.hypot(L.sx(p.x[i]) - px, L.sy(p.y[i]) - py); if (dd < 12 && (!pointHit || dd < pointHit.d)) pointHit = { d: dd, name: p.name, x: p.x[i], y: p.y[i], label: p.labels ? p.labels[i] : null }; }
      this.hover = { x: xv, hits };
      this.showTip(px, py, xv, hits, pointHit);
      this.draw();
    }
    showTip(px, py, xv, hits, pointHit) {
      const tip = this.tip; tip.textContent = '';
      const tk = this.tk;
      if (pointHit) {
        const h = document.createElement('div'); h.className = 'tip-x'; h.textContent = pointHit.name || 'ponto';
        const v = document.createElement('div'); v.className = 'tip-row';
        const val = document.createElement('strong'); val.textContent = pointHit.label || `${fmtVal(pointHit.x)}, ${fmtVal(pointHit.y)}`;
        v.append(val); tip.append(h, v);
      } else if (hits.length) {
        const h = document.createElement('div'); h.className = 'tip-x'; h.textContent = `${this.opts.xLabel || 'x'} ${fmtVal(xv)}`;
        tip.append(h);
        for (const it of hits) {
          const row = document.createElement('div'); row.className = 'tip-row';
          const key = document.createElement('span'); key.className = 'tip-key'; key.style.background = tk[it.color] || it.color;
          const val = document.createElement('strong'); val.textContent = fmtVal(it.y);
          const name = document.createElement('span'); name.className = 'tip-name'; name.textContent = it.name;
          row.append(key, val, name); tip.append(row);
        }
      } else { tip.hidden = true; return; }
      tip.hidden = false;
      const W = this.wrap.clientWidth;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = px + 14; if (left + tw > W - 4) left = px - tw - 14;
      let top = py - th / 2; top = Math.max(4, Math.min(this.opts.height - th - 4, top));
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    onDown(e) {
      if (!this.L) return;
      const { px, py } = this.pos(e);
      for (const g of this.data.drags) {
        if (Math.hypot(this.L.sx(g.x) - px, this.L.sy(g.y) - py) < 14) {
          this.dragging = g; this.canvas.setPointerCapture(e.pointerId); this.canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
        }
      }
    }
    onUp(e) {
      if (this.dragging) { this.dragging = null; this.canvas.style.cursor = 'grab'; if (this.opts.onDragEnd) this.opts.onDragEnd(); }
    }
  }

  CT.Plot = Plot; CT.fmtVal = fmtVal; CT.readTokens = readTokens;
})(window.CT);
