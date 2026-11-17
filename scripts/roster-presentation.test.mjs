import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROSTER_PRESENTATION_ENABLED } from '../src/features/farmer/dashboard/rosterPresentation.js';
const source = readFileSync(new URL('../src/components/FarmerDashboard.jsx', import.meta.url), 'utf8');
test('disabled roster never reads cached rows or calls the roster fetch', async () => {
 assert.equal(ROSTER_PRESENTATION_ENABLED, false);
 const init = source.match(/useState\(\(\) => (ROSTER_PRESENTATION_ENABLED[^\n]+)\); \/\/ また呼びたいリスト/)[1];
 const fail = () => { throw new Error('unexpected personal-data read'); };
 assert.deepEqual(Function('ROSTER_PRESENTATION_ENABLED', 'getCache', `return ${init}`)(false, fail), []);
 const fetch = source.match(/(ROSTER_PRESENTATION_ENABLED \? fetchMyRoster\(uid\) : Promise.resolve\(\{ data: \[\] \}\))/)[1];
 assert.deepEqual(await Function('ROSTER_PRESENTATION_ENABLED','fetchMyRoster','uid',`return ${fetch}`)(false,fail,'synthetic'), {data:[]});
 assert.match(source, /if \(ROSTER_PRESENTATION_ENABLED && rosterData/);
});
test('direct detail and mutation handlers return before any operation', async () => {
 for (const name of ['openRosterDetail','toggleDoneFavorite','stopRosterNotify']) {
  const prefix = source.slice(source.indexOf(`const ${name} =`)).match(/=> \{\s*(if \(!ROSTER_PRESENTATION_ENABLED\) return;)/)[1];
  let called = false;
  await Function('ROSTER_PRESENTATION_ENABLED','operation',`${prefix} operation();`)(false,()=>{called=true;});
  assert.equal(called,false,name);
 }
});
test('ordinary review survives while favorite enrollment and success state are disabled', () => {
 assert.match(source,/favorite: ROSTER_PRESENTATION_ENABLED && completeAnswers.want_again_choice === "yes" && completeNotifyNext/);
 assert.match(source,/const favorited = ROSTER_PRESENTATION_ENABLED && !!data.favorited/);
 assert.match(source,/wantAgainChoice: completeAnswers.want_again_choice/);
 assert.match(source,/emitConfirmedRefresh\(REFRESH_APPLICATIONS\)/);
});
test('list, stale modal states and all registration controls stay behind the boundary', () => {
 for (const fragment of ['ROSTER_PRESENTATION_ENABLED && <div style={{ marginTop:16 }}>', 'ROSTER_PRESENTATION_ENABLED && rosterDetail &&', 'ROSTER_PRESENTATION_ENABLED && favDone &&', 'extra={ROSTER_PRESENTATION_ENABLED && wantAgain', 'confirmExtra={ROSTER_PRESENTATION_ENABLED && wantAgain', 'ROSTER_PRESENTATION_ENABLED && <label']) assert.ok(source.includes(fragment),fragment);
 assert.match(source,/また呼びたいリスト/);
 const stage=readFileSync(new URL('../src/components/StageBoxBody.jsx',import.meta.url),'utf8');
 assert.match(stage,/F_WORKED_STEPS = PRESERVED_F_WORKED_STEPS.filter/);
 assert.match(stage,/ROSTER_PRESENTATION_ENABLED \|\| step.icon !== "heart"/);
});
