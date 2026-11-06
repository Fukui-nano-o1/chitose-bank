import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const source = path => readFile(new URL('../src/' + path, import.meta.url), 'utf8');
test('roster and review help retain new-job purpose without retired approval promises', async () => {
 const dashboard = await source('components/FarmerDashboard.jsx');
 assert.doesNotMatch(dashboard, /リピート即決|また呼びたい即決|自動で承認/);
 assert.match(dashboard, /また呼びたいリスト/);
 assert.match(dashboard, /新しい求人のお知らせ/);
 assert.match(dashboard, /upsertRoster, deleteRoster/);
 assert.doesNotMatch(await source('App.jsx'), /リピート即決|初心者大歓迎/);
 assert.doesNotMatch(await source('components/StageBoxBody.jsx'), /即決|自動で承認/);
});
test('help retains roster notice and normal approvals but no retired mail help', async () => {
 const help = await source('app/help/HelpCenter.jsx');
 assert.doesNotMatch(help, /mails-repeatInstant|リピート即決|即決で承認/);
 assert.match(help, /mails-repeatNewJob/);
 const archive = await source('features/jobs/retiredFlags/legacySurfaceCopy.js');
 assert.match(archive, /mails-repeatInstant/);
 assert.match(archive, /リピート即決/);
 assert.doesNotMatch(help, /import.*legacySurfaceCopy/);
});

test('retired implementation is an inert archive with no active application imports', async () => {
 const root = new URL('../src/', import.meta.url);
 for (const path of await readdir(root, { recursive: true })) {
  if (!/\.[jt]sx?$/.test(path) || path.includes('retiredFlags/')) continue;
  const code = await readFile(new URL(path, root), 'utf8');
  assert.doesNotMatch(code, /(?:from\s*|import\s*\()(["'])[^"']*retiredFlags\//, path);
 }
});
