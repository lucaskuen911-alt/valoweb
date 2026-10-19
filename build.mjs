// Zero-dependency bundler for the ES-module source tree.
//
// Resolves relative imports from src/main.js, orders modules depth-first, wraps each in a
// function scope, and inlines the result plus tools/template.html into dist/hairline.html.
// Supported syntax (enforced): `import { a, b } from './x.js';`, `import * as N from './x.js';`
// and `export function|class|const|let` declarations. No default exports, no cycles.
//
// Usage: node tools/build.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/main.js');
const modules = new Map();
const order = [];
const visiting = new Set();

const IMPORT_RE = /^import\s+(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+'([^']+)';\s*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

function load(file) {
  if (modules.has(file)) return;
  if (visiting.has(file)) throw new Error(`Import cycle through ${relative(root, file)}`);
  visiting.add(file);
  let src = readFileSync(file, 'utf8');
  if (/^export\s+(default|\{)/m.test(src)) throw new Error(`${relative(root, file)}: only named declaration exports are supported`);
  const deps = [];
  src = src.replace(IMPORT_RE, (_, names, ns, spec) => {
    const dep = resolve(dirname(file), spec);
    deps.push(dep);
    const id = JSON.stringify(relative(root, dep));
    if (ns) return `const ${ns} = __require(${id});`;
    const bindings = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${bindings.join(', ')} } = __require(${id});`;
  });
  const exported = [];
  src = src.replace(EXPORT_RE, (m, kind, name) => {
    exported.push(name);
    return m.replace(/^export\s+/, '');
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`${relative(root, file)}: unsupported import form`);
  for (const d of deps) load(d);
  visiting.delete(file);
  modules.set(file, { src, exported });
  order.push(file);
}

load(entry);

let bundle = `(function () {\n'use strict';\nconst __mods = {};\nconst __require = (id) => { const m = __mods[id]; if (!m) throw new Error('Module not loaded: ' + id); return m; };\n`;
for (const file of order) {
  const { src, exported } = modules.get(file);
  const id = JSON.stringify(relative(root, file));
  bundle += `\n// ---- ${relative(root, file)}\n__mods[${id}] = (function () {\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
}
bundle += '\n})();\n';

const template = readFileSync(resolve(root, 'tools/template.html'), 'utf8');
const html = `${template}\n<script>\n${bundle.replace(/<\/script/g, '<\\/script')}</script>\n`;
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/hairline.html'), html);
console.log(`Bundled ${order.length} modules, ${(html.length / 1024).toFixed(1)} KB -> dist/hairline.html`);
