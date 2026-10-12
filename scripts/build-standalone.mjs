// Builds single-file versions of SecondLook with no server and no network needed:
//   dist/secondlook.html           open it from disk, email it, put it on a USB stick
//   dist/secondlook-artifact.html  the same page in the shape claude.ai artifacts expect
//
// The app's ES modules are bundled by a deliberately tiny bundler: it supports
// the import/export forms this codebase uses and fails loudly on anything else.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\};?\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

async function bundle(entry) {
  const modules = new Map();
  const order = [];

  async function visit(rel) {
    if (modules.has(rel)) return;
    modules.set(rel, null);
    const source = await readFile(path.join(publicDir, rel), 'utf8');
    const deps = [];
    let code = source.replace(IMPORT_RE, (_, names, spec) => {
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      deps.push(dep);
      const bindings = names.split(',').map((n) => n.trim()).filter(Boolean)
        .map((n) => n.replace(/\s+as\s+/, ': '));
      return `const { ${bindings.join(', ')} } = __modules[${JSON.stringify(dep)}];`;
    });
    if (/^\s*import\s/m.test(code) || /\bimport\(/.test(code)) throw new Error(`${rel}: unsupported import form`);

    const exported = [];
    code = code.replace(EXPORT_LIST_RE, (_, names) => {
      exported.push(...names.split(',').map((n) => n.trim()).filter(Boolean));
      return '';
    });
    code = code.replace(EXPORT_DECL_RE, (_, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    });
    if (/^\s*export\s/m.test(code)) throw new Error(`${rel}: unsupported export form`);

    for (const dep of deps) await visit(dep);
    modules.set(rel, `__modules[${JSON.stringify(rel)}] = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();`);
    order.push(rel);
  }

  await visit(entry);
  return `(() => {\n'use strict';\nconst __modules = {};\n${order.map((m) => `// ${m}\n${modules.get(m)}`).join('\n\n')}\n})();\n`;
}

function between(html, start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a < 0 || b < 0) throw new Error(`markers ${start} / ${end} not found`);
  return html.slice(a + start.length, b).trim();
}

const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');

export async function build() {
  const [html, css, js] = await Promise.all([
    readFile(path.join(publicDir, 'index.html'), 'utf8'),
    readFile(path.join(publicDir, 'styles.css'), 'utf8'),
    bundle('js/app.js'),
  ]);

  const standalone = html
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
    .replace('<script type="module" src="js/app.js"></script>', () => `<script>\n${safeScript(js)}</script>`);

  const title = html.match(/<title>[^<]*<\/title>/)[0];
  const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
  const app = between(html, '<!-- app:start -->', '<!-- app:end -->');
  const artifact = `${title}\n${fonts}\n<style>\n${css}</style>\n${app}\n<script>\n${safeScript(js)}</script>\n`;

  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, 'secondlook.html'), standalone);
  await writeFile(path.join(distDir, 'secondlook-artifact.html'), artifact);
  return { standalone: standalone.length, artifact: artifact.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sizes = await build();
  console.log(`Built dist/secondlook.html (${Math.round(sizes.standalone / 1024)} KB) and dist/secondlook-artifact.html (${Math.round(sizes.artifact / 1024)} KB)`);
}
