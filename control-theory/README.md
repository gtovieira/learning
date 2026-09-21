# Control Loop Workshop

Interactive control-theory workshop: ten modules of theory with browser-side simulation
labs (system modeling, Laplace transforms, block algebra and Routh, open loop vs
feedback, PID, tuning rules and relay auto-tuning, Bode/Nyquist margins, root locus,
digital implementation, design challenges).

Static site, no build step and no framework. Everything runs client-side.

## Run it

Open `index.html` directly, or serve the folder:

```sh
npx http-server control-theory -p 8080
# → http://localhost:8080/#/modeling
```

Formulas render through KaTeX (MathML output) loaded from cdnjs; without network the
TeX source is shown in monospace instead.

## Layout

| Path | What |
|---|---|
| `index.html` | All module content, block diagrams (inline SVG) and lab mount points |
| `css/portal.css` | Tokens (light/dark), layout, labs, plots, quizzes |
| `js/numerics.js` | Complex numbers, polynomials (roots via Durand–Kerner), transfer functions, Bode/margins/Nyquist, root locus, Routh table |
| `js/sim.js` | Plant catalogue, discrete PID (filtered D, anti-windup, limits), RK4 closed-loop simulation with dead time and sampling, metrics, FOPDT identification, tuning rules, relay test |
| `js/plot.js` | Canvas plots: line/scatter, log axes, equal-aspect s-plane, crosshair tooltip, legend, table view, draggable handles |
| `js/ui.js` | Sliders, selects, plant picker, metric grids, quizzes, tabs, math rendering, localStorage |
| `js/labs-basics.js` | Labs for modules 1–4 and their quizzes |
| `js/labs-pid.js` | PID sandbox, tuning bench, sampling lab, reference PID code (TS/Dart/C), challenges |
| `js/labs-freq.js` | Bode/Nyquist loop-shaping lab, root-locus lab |
| `js/app.js` | Hash router, navigation, lazy lab mounting, progress |
| `scripts/build-artifact.mjs` | Produces `dist/artifact.html`, a single-file fragment for publishing as a claude.ai artifact |

## Publishing as an artifact

```sh
node control-theory/scripts/build-artifact.mjs
```

`dist/artifact.html` has no `<html>/<head>/<body>` wrapper (the publisher adds one) and
carries the stylesheet and scripts inline. `dist/` is git-ignored.

## Conventions worth knowing

- Polynomials are coefficient arrays, highest power first (`[1, 3, 2]` = s² + 3s + 2).
- Everything is in deviation variables around an operating point; plants start at rest.
- The simulator integrates the plant with RK4 at a fine step and runs the controller at
  `Ts` with zero-order hold, so sampling effects are real, not approximated.
- Colors for plot series come from CSS tokens (`--series-1 … --series-8`), assigned in
  fixed order per entity so a rule or signal keeps its color across filters.
