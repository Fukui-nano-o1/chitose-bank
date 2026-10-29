import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { FILES, collect, render, compareFingerprints } from './search-fingerprint.mjs';
import { collectSemanticContracts } from './search-fingerprint-contracts.mjs';

const sources = new Map(FILES.map(file => [file, fs.readFileSync(file, 'utf8')]));
const baseline = fs.readFileSync('scripts/search-fingerprint.baseline.txt', 'utf8');
const read = file => sources.get(file) ?? null;
const changed = (file, from, to) => {
  const source = read(file);
  assert.ok(source?.includes(from), `mutation anchor missing: ${file}: ${from}`);
  return name => name === file ? source.replace(from, to) : read(name);
};
const different = (expected, actual) => {
  const diff = compareFingerprints(expected, actual);
  return [...diff.lost, ...diff.gained];
};

test('the reviewed fingerprint matches the current canonical source owners', () => {
  assert.deepEqual(compareFingerprints(baseline, render(collect(read))), { lost: [], gained: [] });
  assert.ok(!FILES.includes('src/components/JobSearchMapView.jsx'));
  assert.ok(!FILES.includes('src/lib/searchJobs.js'));
});

test('required sources and definitions fail closed instead of silently disappearing', () => {
  for (const file of FILES) assert.throws(() => collect(name => name === file ? null : read(name)), /必須ソース/);
  assert.throws(() => collect(changed('src/features/jobs/search/JobSearchMapView.jsx',
    'const applyBtnDisabled =', 'const removedApplyBtnDisabled =')), /applyBtnDisabled/);
  assert.throws(() => collect(changed('src/components/JobLocationMap.jsx',
    'const isVisitor =', 'const isVisitor = ;')), /解析できません/);
  assert.throws(() => collect(changed('src/components/JobLocationMap.jsx',
    'if (lat == null || lng == null) {', 'if (false) {')), /missing coordinates fallback/);
});

test('semantic extraction tolerates whitespace/comments, not changed conditions', () => {
  const original = {}, formatted = {};
  const add = target => (key, value) => { (target[key] ??= []).push(value); };
  collectSemanticContracts(read, add(original));
  collectSemanticContracts(changed('src/features/jobs/search/JobSearchMapView.jsx',
    'const applyBtnOnClick = !me ?', 'const applyBtnOnClick =\n    /* explanatory comment */ !me\n    ?'), add(formatted));
  assert.deepEqual(formatted, original);
});

test('comparison keeps section identity, multiplicity, and ignores historical notes only', () => {
  const twoSections = '# title\n\n## a\n  same  x1\n\n## b\n  same  x1\n';
  assert.ok(different(twoSections, '# title\n\n## a\n\n## b\n  same  x1\n').length);
  assert.ok(different(twoSections, twoSections.replace('same  x1', 'same  x2')).length);
  const note = '\n# ── 採取時点のDB実測（静的解析では出ない値）\nold observation';
  assert.deepEqual(different(twoSections, twoSections + note), []);
});

const map = 'src/components/JobLocationMap.jsx';
const search = 'src/features/jobs/search/JobSearchMapView.jsx';
const page = 'src/features/jobs/search/components/ApplicationPage.jsx';
const jobs = 'src/features/jobs/search/searchJobs.js';
const api = 'src/features/jobs/search/jobSearchApi.js';
const farmerApi = 'src/features/farmer/dashboard/farmerDashboardApi.js';
const mutations = [
  ['literal label whitespace changes', search, '承認されました — チャットを開く', '承認されました  — チャットを開く', 'apply:contract:applyBtnLabel'],
  ['map bypasses real-session check', map, 'const authAlive = useAuthAlive();', 'const authAlive = true;', 'map:authSource'],
  ['confirmation route no longer renders', search, 'if (applicationStep !== null && selectedJob)', 'if (false && selectedJob)', 'apply:page'],
  ['unconfirmed map session becomes visible', map, 'authAlive !== true', 'authAlive === false', 'map:visitor'],
  ['visitor loads Leaflet and tiles', map, 'if (isVisitor) return;', '', 'map:lifecycle'],
  ['visitor triggers precise geocoding', map, 'if (isVisitor || !addressShown', 'if (!addressShown', 'map:lifecycle'],
  ['hidden address triggers precise geocoding', map, '|| !addressShown ||', '||', 'map:lifecycle'],
  ['map survives unmount', map, 'mapRef.current?.remove();', '', 'map:lifecycle'],
  ['late library load creates a detached map', map, 'if (cancelled) return;', '', 'map:lifecycle'],
  ['map ignores a visitor-role change', map, '[lat, lng, radius, isVisitor]', '[lat, lng, radius]', 'map:lifecycle'],
  ['map geometry changes', map, 'toBounds(r * 2)', 'toBounds(r)', 'map:lifecycle'],
  ['map becomes interactive', map, 'dragging: false', 'dragging: true', 'map:lifecycle'],
  ['visitor mosaic exposes a coordinate', map, 'data-testid="job-map-mosaic"', 'data-testid="job-map-mosaic" data-lat={lat}', 'map:visitorRender'],
  ['application loading guard disappears', search, '|| appPending;', ';', 'apply:contract:applyBtnDisabled'],
  ['existing applied state submits instead of cancels', search, ': myAppStatus === "applied" ? cancelMyApplication', ': myAppStatus === "applied" ? openApplicationPage', 'apply:contract:applyBtnOnClick'],
  ['new application bypasses confirmation', search, ': openApplicationPage;', ': handleApply;', 'apply:contract:applyBtnOnClick'],
  ['completed application shows a new-apply entry', search, 'recruitClosed && myAppLoaded && !appHasAction', 'recruitClosed && myAppLoaded && !myAppStatus', 'apply:contract:hideApply'],
  ['available days include holidays', search, 'if (!hs.has(y)) out.push(y);', 'out.push(y);', 'apply:contract:periodDays'],
  ['application submit loses duplicate-request lock', search, 'applySubmittingRef.current || applying ||', 'applying ||', 'apply:contract:handleApply'],
  ['application page loses account/job remount key', search, 'key={`${me?.id || "anon"}_${selectedJob.id}`}', 'key="shared"', 'apply:page'],
  ['closed listing no longer blocks confirmation', search, 'blocked={!me || recruitClosed ||', 'blocked={!me ||', 'apply:page'],
  ['confirmation no longer waits for own-listing lookup', search, 'checking={!myAppLoaded || !ownLoaded}', 'checking={!myAppLoaded}', 'apply:page'],
  ['availability draft is shared across accounts', page, "${me?.id || 'anon'}_${selectedJob?.id}", '${selectedJob?.id}', 'apply:page:draftKey'],
  ['saved unavailable dates are submitted', page, 'selection.dates.filter(d => periodDays.includes(d))', 'selection.dates', 'apply:page:dates'],
  ['confirmation submit ignores blocked/loading', page, 'if (!validDates || applying || unavailable) return;', 'if (!validDates || applying) return;', 'apply:page:submit'],
  ['confirmation next bypasses date selection', page, 'disabled={applying || unavailable || (step === 2 && !validDates)}', 'disabled={applying || unavailable}', 'apply:page:button'],
  ['public listing query reverses order', jobs, '{ ascending: false }', '{ ascending: true }', 'rule:jobs:loadPublicJobs'],
  ['closed listings enter search', jobs, 'mapped = visibleSearchJobs(mapped);', '', 'rule:jobs:orderSearchJobs'],
  ['fresh listings lose priority', jobs, '[...shuffleArr(freshNew), ...shuffleArr(rest), ...shuffleArr(ended)]', '[...shuffleArr(rest), ...shuffleArr(freshNew), ...shuffleArr(ended)]', 'rule:jobs:orderSearchJobs'],
  ['newer refresh is overwritten by stale prefetch', jobs, 'version !== getConfirmedRefreshVersion(REFRESH_JOBS) ||', '', 'rule:jobs:prefetchSearchJobs'],
  ['No. filter disappears', search, 'if (noQuery && !String(j.id).startsWith(noQuery)) return false;', '', 'rule:search'],
  ['region filter disappears', search, 'if (selRegions.length && !selRegions.includes(j.region || "")) return false;', '', 'rule:search'],
  ['date-range filter disappears', search, 'if (selRange && !jobInDateRange(j, selRange)) return false;', '', 'rule:search'],
  ['expired filter disappears', 'src/lib/jobSearchVisibility.js', '&& !isJobEnded(job, now)', '', 'rule:visibility:isSearchJobVisible'],
  ['Japanese end time shifts to UTC', 'src/features/jobs/model/jobStatus.js', 'T00:00:00+09:00', 'T00:00:00Z', 'rule:expiry:jobEndTimeMs'],
  ['public row expiry is always false', 'src/features/jobs/model/jobPresentation.js', 'expired: isJobEnded(j)', 'expired: false', 'rule:jobFlag'],
  ['personal application read loses owner filter', api, '.eq("worker_id", workerId).neq("status", "canceled");', '.neq("status", "canceled");', 'data:contract:search'],
  ['farmer rejection becomes approval', farmerApi, 'p_approve: false', 'p_approve: true', 'data:contract:farmer'],
  ['roster read loses farmer scope', farmerApi, '.eq("farmer_id", uid)', '', 'data:contract:farmer'],
  ['farmer unpublished job moves out of active bucket', 'src/lib/farmerJobLists.js', '|| isJobUnpublished(row)', '', 'farmer:classification'],
  ['farmer hides working applicants', 'src/components/FarmerDashboard.jsx', '["rejected", "expired", "canceled"]', '["rejected", "expired", "canceled", "working"]', 'farmer:appFilter'],
  ['today can reintroduce retired stages', 'src/components/TodayPage.jsx', 'new Set(["approve", "interview", "w_interview"])', 'new Set([])', 'today:contract:REMOVED_STAGES'],
  ['private job fallback calls a different API', 'src/lib/jobForMe.js', '"job_details_for_party"', '"jobs_unrestricted"', 'data:detailWindow'],
];

for (const [name, file, from, to, section] of mutations) {
  test(`negative proof: ${name}`, () => {
    const diff = different(baseline, render(collect(changed(file, from, to))));
    assert.ok(diff.some(line => line.startsWith(`## ${section}\n`)), `mutation escaped its expected section: ${section}`);
  });
}

// Exercise the command-line contract using a private source-only copy. No
// application imports, real session, network, or repository mutation is used.
test('CLI exits 0 for current source, 1 for a removed guard, 2 for a missing owner', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'search-fingerprint-'));
  try {
    for (const [file, content] of [...sources, ['scripts/search-fingerprint.baseline.txt', baseline]]) {
      const target = path.join(temp, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const run = () => spawnSync(process.execPath,
      [fileURLToPath(new URL('./search-fingerprint.mjs', import.meta.url)), '--check'], { cwd: temp, encoding: 'utf8' });
    const clean = run();
    assert.equal(clean.status, 0, clean.stderr);
    fs.writeFileSync(path.join(temp, map), read(map).replace('if (isVisitor) return;', ''));
    const mutated = run();
    assert.equal(mutated.status, 1, mutated.stderr);
    assert.match(mutated.stderr, /map:lifecycle/);
    fs.unlinkSync(path.join(temp, map));
    assert.equal(run().status, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

// Execute small pure expressions from the actual source, not a reimplementation
// of the rules. These assertions remain meaningful when reviewing a new baseline.
const expression = (file, name, variables) => {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(initializer, name);
  return vm.runInNewContext(`(${initializer.getText(ast)})`, variables);
};

test('map visitor gate stays closed until a real session is known', () => {
  for (const visitor of [false, true]) for (const authAlive of [null, false, true]) {
    assert.equal(expression(map, 'isVisitor', { visitor, authAlive }), visitor || authAlive !== true);
  }
});

test('application state routes visitors, active relationships, pending and new applicants correctly', () => {
  for (const status of [undefined, 'applied', 'approved', 'contracted', 'working']) {
    const calls = [];
    const window = { location: { hash: '' } };
    const vars = { me: { id: 'synthetic-user' }, selectedJob: { id: 17 }, myApplication: { id: 'synthetic-application' },
      myAppStatus: status, myPending: false, window,
      cancelMyApplication: () => calls.push('cancel'), openApplicationPage: () => calls.push('confirm'),
      visitorGuide: () => calls.push('visitor'), setApplyReturn: id => calls.push(`return:${id}`) };
    expression(search, 'applyBtnOnClick', vars)();
    if (['approved', 'contracted', 'working'].includes(status)) assert.equal(window.location.hash, '/chat/synthetic-application');
    else assert.deepEqual(calls, [status === 'applied' ? 'cancel' : 'confirm']);
    if (status === undefined) {
      calls.length = 0; vars.myPending = true;
      expression(search, 'applyBtnOnClick', vars)();
      assert.equal(window.location.hash, '/apply/pending');
      calls.length = 0; vars.me = null;
      expression(search, 'applyBtnOnClick', vars)();
      assert.deepEqual(calls, ['return:17', 'visitor']);
    }
  }
});

test('closed listings retain relationship actions but not a new application entry', () => {
  for (const myAppStatus of [undefined, 'applied', 'approved', 'contracted', 'working', 'rejected', 'completed', 'expired']) {
    const myPending = false;
    const appHasAction = expression(search, 'appHasAction', { myAppStatus, myPending });
    const hideApply = expression(search, 'hideApply', { recruitClosed: true, myAppLoaded: true, appHasAction });
    assert.equal(hideApply, [undefined, 'completed', 'expired'].includes(myAppStatus));
    const disabled = expression(search, 'applyBtnDisabled', { myAppStatus, appPending: false });
    assert.equal(disabled, ['rejected', 'completed'].includes(myAppStatus));
    assert.equal(expression(search, 'applyBtnDisabled', { myAppStatus, appPending: true }), true);
  }
});

test('semantic normalization preserves repeated whitespace inside template/storage keys', () => {
  const oneSpace = render(collect(changed(page, 'cb_application_dates_v1_', 'cb_application dates_v1_')));
  const twoSpaces = render(collect(changed(page, 'cb_application_dates_v1_', 'cb_application  dates_v1_')));
  assert.ok(different(oneSpace, twoSpaces).some(line => line.startsWith('## apply:page:draftKey\n')));
});
