import test from 'node:test';
import assert from 'node:assert/strict';
import { saveProfileAvatar } from '../src/lib/profileAvatar.js';
import { uploadAvatarResilient } from '../src/lib/avatarUpload.js';
import { avatarFixture, origin, uid } from './fixtures/avatar-client.mjs';
const photo = () => new Blob(['new image bytes'], { type: 'image/jpeg' });
const save = (f, blob = photo()) => saveProfileAvatar({ ...f.args, blob });

for (const role of ['worker', 'employer']) {
  test(`${role}: reference commits before the exact old file is removed; unrelated fields and files survive`, async () => {
    const f = avatarFixture(role); f.state.objects.set(f.folder + '/unrelated.jpg', photo());
    const result = await save(f);
    assert.notEqual(result.url, f.oldUrl);
    assert.match(result.url, /\/avatar-[a-f0-9-]+\.jpg$/);
    assert.equal(f.state.rows[f.table].avatar_url, result.url);
    assert.equal(f.state.rows[f.table].transport, '自転車');
    assert.ok(f.state.events.find(e => e.type === 'upload').options.upsert === false);
    assert.ok(f.state.events.findIndex(e => e.type === 'remove') > f.state.events.findIndex(e => e.type === 'update'));
    assert.equal(f.state.objects.has(f.oldPath), false);
    assert.equal(f.state.objects.has(f.folder + '/unrelated.jpg'), true);
  });
  for (const mode of ['uploadError', 'dbError', 'readError']) {
    test(`${role}: ${mode} preserves the old image and DB reference`, async () => {
      const f = avatarFixture(role, { [mode]: true });
      await assert.rejects(save(f));
      assert.equal(f.state.rows[f.table].avatar_url, f.oldUrl);
      assert.ok(f.state.objects.has(f.oldPath));
      assert.equal(f.state.events.filter(e => e.type === 'remove').length, 0);
      if (mode === 'readError') assert.equal(f.state.events.filter(e => e.type === 'upload').length, 0);
    });
  }
  test(`${role}: delete rejection preserves both the reference and object`, async () => {
    const f = avatarFixture(role, { dbError: true });
    await assert.rejects(save(f, null));
    assert.equal(f.state.rows[f.table].avatar_url, f.oldUrl); assert.ok(f.state.objects.has(f.oldPath));
  });
  test(`${role}: successful delete unlinks first, then removes only its old object`, async () => {
    const f = avatarFixture(role); const result = await save(f, null);
    assert.equal(result.url, ''); assert.equal(f.state.rows[f.table].avatar_url, '');
    assert.equal(f.state.objects.has(f.oldPath), false);
    assert.ok(f.state.events.findIndex(e => e.type === 'update') < f.state.events.findIndex(e => e.type === 'remove'));
  });
}
test('upload response loss recovers only by verifying the exact new object contents', async () => {
  const f = avatarFixture('worker', { uploadLostResponse: true });
  const result = await save(f);
  assert.equal(result.url, f.state.rows[f.table].avatar_url);
  assert.equal(f.state.events.filter(e => e.type === 'upload').length, 2);
  assert.equal(f.state.events.filter(e => e.type === 'download').length, 1);
});
test('an existing file with different content cannot disguise an upload failure', async () => {
  const f = avatarFixture('worker', { uploadError: true });
  f.state.objects.set(f.oldPath, new Blob(['old image bytes']));
  assert.equal(f.state.objects.get(f.oldPath).size, photo().size);
  await assert.rejects(uploadAvatarResilient(f.client, f.oldPath, photo()), { code: 'AVATAR_UPLOAD' });
  assert.equal(await f.state.objects.get(f.oldPath).text(), 'old image bytes');
});
test('DB response loss is recovered by matching the unique saved URL', async () => {
  const f = avatarFixture('worker', { dbLostResponse: true }); const result = await save(f);
  assert.equal(result.url, f.state.rows[f.table].avatar_url);
  assert.equal(f.state.writes, 1); assert.equal(f.state.objects.has(f.oldPath), false);
});
test('unconfirmed DB result retains both objects; reloading can recover the canonical URL', async () => {
  const f = avatarFixture('worker', { dbLostResponse: true, readErrorAfterWrite: true });
  await assert.rejects(save(f), { code: 'AVATAR_UNCONFIRMED' });
  assert.equal(f.state.objects.size, 2); assert.notEqual(f.state.rows[f.table].avatar_url, f.oldUrl);
});
test('two editors with the same baseline produce one winner; the losing editor cannot delete either active image', async () => {
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const f = avatarFixture('worker', { afterUpload: async () => { if (++arrivals === 2) release(); await barrier; } });
  const results = await Promise.allSettled([save(f), save(f)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'AVATAR_CONFLICT');
  const path = f.state.rows[f.table].avatar_url.slice(origin.length);
  assert.ok(f.state.objects.has(path));
  assert.equal(f.state.events.filter(e => e.type === 'remove').length, 1);
});
test('same URL with a changed revision is a conflict and does not revert another field', async () => {
  const f = avatarFixture('worker', { beforeWrite: s => { s.rows.worker_profiles.updated_at = '2026-10-02T00:00:00.000Z'; s.rows.worker_profiles.transport = '徒歩'; } });
  await assert.rejects(save(f), { code: 'AVATAR_CONFLICT' });
  assert.equal(f.state.rows[f.table].transport, '徒歩'); assert.ok(f.state.objects.has(f.oldPath));
});
test('stale displayed URL and missing authentication stop before any upload', async () => {
  for (const mode of ['stale', 'anonymous', 'different-user']) {
    const f = avatarFixture();
    if (mode === 'stale') f.args.expectedUrl = 'stale'; else f.state.userId = mode === 'anonymous' ? null : 'other';
    await assert.rejects(save(f)); assert.equal(f.state.events.filter(e => e.type === 'upload').length, 0);
  }
});
test('session change during upload prevents the DB write and old-file cleanup', async () => {
  const f = avatarFixture('worker', { afterUpload: s => { s.userId = null; } });
  await assert.rejects(save(f), { code: 'AVATAR_SESSION' });
  assert.equal(f.state.writes, 0); assert.ok(f.state.objects.has(f.oldPath));
});
test('initial avatar inserts only a missing row; concurrent profile creation is not overwritten', async () => {
  const f = avatarFixture(); delete f.state.rows[f.table]; f.args.expectedUrl = '';
  const result = await save(f); assert.equal(f.state.rows[f.table].avatar_url, result.url);
  const g = avatarFixture('worker', { beforeWrite: s => { s.rows.worker_profiles = { auth_id: uid, avatar_url: 'other', updated_at: '2026-10-03', nickname: 'Other' }; } });
  delete g.state.rows[g.table]; g.args.expectedUrl = '';
  await assert.rejects(save(g), { code: 'AVATAR_CONFLICT' }); assert.equal(g.state.rows[g.table].nickname, 'Other');
});
test('cleanup failure is a warning after a confirmed save, and borrowed images are preserved', async () => {
  const f = avatarFixture('worker', { removeError: true });
  const result = await save(f); assert.ok(result.warning); assert.equal(result.url, f.state.rows[f.table].avatar_url); assert.ok(f.state.objects.has(f.oldPath));
  const g = avatarFixture(); g.state.rows.employer_profiles = { avatar_url: g.oldUrl };
  const second = await save(g); assert.equal(second.warning, ''); assert.ok(g.state.objects.has(g.oldPath));
});
