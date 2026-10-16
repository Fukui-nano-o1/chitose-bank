// Read-only source inventory. No Supabase client, credentials or network calls.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
export function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true,
    /tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
}
export function nodes(tree, predicate) {
  const found = [];
  function visit(n) { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }
  visit(tree); return found;
}
export function namedFunction(file, name) {
  const tree = source(file);
  const found = nodes(tree, n => (ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.getText(tree) === name);
  if (found.length !== 1) throw new Error(`${file}: expected one ${name}, found ${found.length}`);
  return (found[0].initializer || found[0]).getText(tree).replace(/^export\s+(default\s+)?/, '');
}
export function firstEffect(file, component) {
  const tree = source(file);
  const fn = nodes(tree, n => ts.isFunctionDeclaration(n) && n.name?.text === component)[0];
  const effect = nodes(fn, n => ts.isCallExpression(n) && n.expression.getText(tree) === 'useEffect')[0];
  return effect.arguments[0].getText(tree);
}

function files(dir) {
  return fs.readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(`${dir}/${e.name}`) : /\.(jsx?|tsx?)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}
function target(n, tree) {
  const calls = nodes(n.expression, x => ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'from');
  return calls[0]?.arguments[0]?.getText(tree) || '';
}
export function inventory() {
  const result = { sourceFiles: 0, controls: [], operations: [] };
  for (const file of [...files('src'), ...files('api'), ...files('supabase/functions')].sort()) {
    result.sourceFiles++;
    const tree = source(file);
    const line = n => tree.getLineAndCharacterOfPosition(n.getStart(tree)).line + 1;
    for (const n of nodes(tree, n => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'call' && file === 'src/lib/supportClient.js')) {
      result.operations.push({file,line:line(n),kind:'rpc-wrapper',method:'call',target:n.arguments[0]?.getText(tree)});
    }
    for (const n of nodes(tree, n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression))) {
      const method = n.expression.name.text, expr = n.expression.expression.getText(tree), table = target(n, tree);
      let kind;
      if (method === 'rpc') kind = 'rpc';
      else if (['insert', 'upsert', 'update', 'delete'].includes(method) && table) kind = 'database';
      else if (['upload', 'remove'].includes(method) && (table || /bucket|storage/i.test(expr))) kind = 'storage';
      else if (method === 'setItem' || (/window\.storage/.test(expr) && ['set', 'delete'].includes(method))) kind = 'device';
      else if (/\.auth$/.test(expr) && /^(sign|update|verify|reset)/.test(method)) kind = 'auth';
      else if (method === 'call' || method === 'invoke') kind = 'indirect';
      if (kind) result.operations.push({ file, line: line(n), kind, method, target: method === 'rpc' ? n.arguments[0]?.getText(tree) : table || expr });
    }
    for (const n of nodes(tree, n => ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n))) {
      const tag = n.tagName.getText(tree);
      if (['input','textarea','select'].includes(tag)) result.controls.push({ file, line: line(n), tag });
    }
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const data = inventory();
  const out = process.argv[2];
  if (out) fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  console.log(JSON.stringify({ sourceFiles: data.sourceFiles, controls: data.controls.length,
    operations: Object.fromEntries([...new Set(data.operations.map(x => x.kind))].map(k => [k, data.operations.filter(x => x.kind === k).length])),
    operationFiles: new Set(data.operations.map(x => x.file)).size, output: out || null }, null, 2));
}
