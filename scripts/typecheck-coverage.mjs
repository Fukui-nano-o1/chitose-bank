import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
if (config.errors.length) throw new Error(config.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
const program = ts.createProgram(config.fileNames, config.options);
const covered = new Set(program.getSourceFiles().map(f => path.relative(root, f.fileName)).filter(f => !f.includes('node_modules') && !f.startsWith('..')));
const files = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const file = `${dir}/${entry.name}`;
  return entry.isDirectory() ? files(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
});
const app = [...files('src'), ...files('api')];
const excluded = app.filter(file => !covered.has(file));
const edge = files('supabase/functions');
const edgeEntries = edge.filter(file => /^supabase\/functions\/[^/]+\/[^/]+\.ts$/.test(file));
const otherEdgeSources = edge.filter(file => !edgeEntries.includes(file));
console.log(`Incremental strict JS/JSX coverage: ${covered.size}/${app.length} source files. Not full-app type safety.`);
console.log('\nChecked by tsc:\n' + [...covered].sort().join('\n'));
console.log('\nChecked separately by Deno (npm run typecheck:edge):\n' + edgeEntries.sort().join('\n'));
if (!process.argv.includes('--summary')) console.log('\nNot in the passing incremental gate (npm run typecheck:full audits these too):\n' + excluded.sort().join('\n'));
if (!process.argv.includes('--summary')) console.log('\nBuild configuration, scripts/ test fixtures and public/ worker artifacts are outside this application gate.');
if (process.argv.includes('--summary')) console.log('\nUse npm run typecheck:coverage for every excluded path; typecheck:full audits the full app and currently fails.');
if (otherEdgeSources.length) console.log('\nOther Edge sources (not CLI entry points; imports may include them):\n' + otherEdgeSources.sort().join('\n'));
