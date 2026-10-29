import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { calcMaxPay, normalizeDateRange } from '../src/features/jobs/search/model.js';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const configPath = path.join(root, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);

function check(overrides = new Map(), extraFiles = []) {
  const host = ts.createCompilerHost(config.options);
  const read = host.readFile;
  host.readFile = file => overrides.get(path.resolve(file)) ?? read(file);
  const exists = host.fileExists;
  host.fileExists = file => overrides.has(path.resolve(file)) || exists(file);
  const program = ts.createProgram([...config.fileNames, ...extraFiles], config.options, host);
  return ts.getPreEmitDiagnostics(program);
}

function messages(diagnostics) {
  return diagnostics.map(d => `${d.file?.fileName ?? ''}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`).join('\n');
}

test('incremental app typecheck includes real JS and JSX, strict checks and no suppressions', () => {
  assert.equal(config.options.strict, true);
  assert.equal(config.options.allowJs, true);
  assert.equal(config.options.checkJs, true);
  assert.equal(config.options.noEmit, true);
  assert.notEqual(config.options.skipLibCheck, true);
  assert.notEqual(config.options.noCheck, true);
  assert.deepEqual(config.fileNames.map(file => path.relative(root, file)).sort(), [
    'src/components/SearchLaneTabs.jsx',
    'src/features/jobs/model/jobStatus.js',
    'src/features/jobs/search/model.js',
    'src/lib/calendarDate.js',
    'src/lib/jobSearchVisibility.js',
  ]);
  assert.ok(config.fileNames.some(file => file.endsWith('.js')));
  assert.ok(config.fileNames.some(file => file.endsWith('.jsx')));
  for (const file of config.fileNames) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /@ts-(?:nocheck|ignore)|@type\s*\{any\}/);
  }
  const diagnostics = check();
  assert.equal(diagnostics.length, 0, messages(diagnostics));
});

test('JS implementation regression is rejected, not just imported or parsed', () => {
  const file = path.join(root, 'src/features/jobs/model/jobStatus.js');
  const source = fs.readFileSync(file, 'utf8');
  const mutant = source.replace('nowMs >= end', 'nowMs.toUpperCase() >= end');
  assert.notEqual(mutant, source);
  const diagnostics = check(new Map([[file, mutant]]));
  assert.ok(diagnostics.some(d => d.file?.fileName === file && d.code === 2339), messages(diagnostics));
});

test('JS contracts and JSX props reject invalid callers without editing production sources', () => {
  const file = path.join(root, 'scripts/typecheck-negative-fixture.tsx');
  const fixture = `
import { isJobEnded } from '../src/features/jobs/model/jobStatus.js';
import { calcMaxPay } from '../src/features/jobs/search/model.js';
import { SearchLaneTabs } from '../src/components/SearchLaneTabs.jsx';
isJobEnded({}, false);
calcMaxPay({ payType: 'daily', pay: 'not a number' });
const tab = <SearchLaneTabs value={123} onChange={() => {}} lanes={[]} />;
`;
  const diagnostics = check(new Map([[file, fixture]]), [file]);
  const local = diagnostics.filter(d => d.file?.fileName === file);
  assert.equal(local.length, 3, messages(diagnostics));
  assert.deepEqual(local.map(d => d.code), [2345, 2322, 2322]);
});


test('date-coercion annotations preserve existing Date and numeric model inputs', () => {
  const start = new Date('2030-01-02T00:00:00Z');
  const end = new Date('2030-01-04T00:00:00Z');
  for (const dates of [{ dateStart: start, dateEnd: end }, { dateStart: +start, dateEnd: +end }]) {
    assert.equal(calcMaxPay({ ...dates, payType: 'daily', pay: 8000 }), 24000);
    assert.equal(calcMaxPay({ ...dates, payType: 'hourly', pay: 1000, workTime: '8:00〜16:00' }), 21000);
  }
  assert.deepEqual(normalizeDateRange({ start: '2030-01-04', end: '2030-01-02' }), { start: '2030-01-02', end: '2030-01-04' });
  for (const value of [null, 1, [], { start: false }, new Date()]) assert.equal(normalizeDateRange(value), null);
});

test('real Deno checker rejects an invalid Edge Function response without running it', () => {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/send-push/index.ts'), 'utf8');
  const mutant = source.replace("status: 401", "status: 'not a number'");
  assert.notEqual(mutant, source);
  const directory = fs.mkdtempSync(path.join(root, 'scripts/.typecheck-'));
  const file = path.join(directory, 'send-push.ts');
  try {
    fs.writeFileSync(file, mutant);
    const result = spawnSync(path.join(root, 'node_modules/.bin/deno'), [
      'check', '--cached-only', '--config', path.join(root, 'supabase/functions/deno.json'), file,
    ], { cwd: root, encoding: 'utf8', timeout: 60000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /TS2322/);
    assert.match(result.stdout + result.stderr, /not a number/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
