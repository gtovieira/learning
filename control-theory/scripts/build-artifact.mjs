#!/usr/bin/env node
/* Builds dist/artifact.html: the page as a single fragment (no <html>/<head>/<body>),
   with the stylesheet and all local scripts inlined. That is the format the claude.ai
   Artifact publisher expects; index.html stays the multi-file version for local use. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
const fonts = (html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/) || [''])[0];
const katex = (html.match(/<script src="https:\/\/cdnjs\.cloudflare\.com[^>]*><\/script>/) || [''])[0];
const cssHref = (html.match(/<link rel="stylesheet" href="(css\/[^"]+)">/) || [])[1];
const css = cssHref ? readFileSync(join(root, cssHref), 'utf8') : '';
const body = (html.match(/<body>([\s\S]*)<\/body>/) || ['', ''])[1];

const inlined = body.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) => {
  const code = readFileSync(join(root, src), 'utf8');
  if (code.includes('</script')) throw new Error(`${src} contains a closing script tag and cannot be inlined`);
  return `<script>\n${code}\n</script>`;
});

const out = `${title}\n${fonts}\n<style>\n${css}\n</style>\n${katex}\n${inlined}`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'artifact.html'), out);
console.log(`dist/artifact.html: ${(out.length / 1024).toFixed(0)} KB`);
