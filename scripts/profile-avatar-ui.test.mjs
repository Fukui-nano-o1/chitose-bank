import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.env.CB_AVATAR_BASELINE === '1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const end = Date.now() + 6000;
  while (!fn()) { assert.ok(Date.now() < end, label); await pause(10); }
}
const button = (w, label) => [...w.document.querySelectorAll('button')].find(b => b.textContent.trim() === label);

test('real worker and employer avatar screens preserve data and report confirmed outcomes', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-avatar-ui-'));
  let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'avatar-fixture', enforce: 'pre', resolveId(id) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/avatar-ui-client.js');
      },
      load(id) {
        if (baseline && /\/(?:WorkerProfileEdit\.jsx|EmployerProfileEdit\.jsx|avatarUpload\.js)$/.test(id)) {
          return execFileSync('git', ['show', 'b17b6ef9a838afd554636f5391b44b19b6a3308b:' + path.relative(root, id)], { cwd: root, encoding: 'utf8' });
        }
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/avatar-ui-entry.jsx'), name: 'AvatarQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    async function mount(role, options) {
      dom?.window.close();
      dom = new JSDOM('<div id="root"></div>', { url: `https://ui.test/#/profile/${role}/profile/avatar`, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
      const w = dom.window;
      Object.assign(w, { Blob, Response, Request, Headers, TextEncoder, TextDecoder, qaRole: role, qaOptions: options, qaChanges: [], qaAlerts: [] });
      Object.defineProperty(w.crypto, 'randomUUID', { value: randomUUID });
      w.alert = message => w.qaAlerts.push(message);
      w.fetch = () => { throw new Error('Unexpected real network'); };
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
      w.URL.createObjectURL = () => 'blob:fixture'; w.URL.revokeObjectURL = () => {};
      w.Image = class { width = 64; height = 64; set src(value) { queueMicrotask(() => this.onload()); } };
      w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
      w.HTMLCanvasElement.prototype.toBlob = cb => cb(new Blob(['new image bytes'], { type: 'image/jpeg' }));
      w.eval(script);
      await until(() => w.document.querySelector('input[type="file"]'), `${role} avatar screen ready`);
      return w;
    }
    async function choose(w, twice = false) {
      const input = w.document.querySelector('input[type="file"]');
      Object.defineProperty(input, 'files', { configurable: true, value: [new w.File(['input'], 'avatar.png', { type: 'image/png' })] });
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
      if (twice) input.dispatchEvent(new w.Event('change', { bubbles: true }));
      await pause(30);
      await until(() => !input.disabled, 'upload finishes');
    }
    for (const role of ['worker', 'employer']) {
      for (const mode of ['uploadError', 'dbError', 'deleteError']) {
        await t.test(`${role}: ${mode} keeps the old image visible and alerts instead of false success`, async () => {
          const w = await mount(role, { [mode === 'deleteError' ? 'dbError' : mode]: true });
          const f = w.qaAvatar;
          if (mode === 'deleteError') { button(w, '削除').click(); await pause(30); await until(() => !w.document.querySelector('input[type="file"]').disabled, 'delete finishes'); }
          else await choose(w);
          assert.ok(f.state.objects.has(f.oldPath), 'old object survives');
          assert.equal(f.state.rows[f.table].avatar_url, f.oldUrl);
          assert.ok([...w.document.querySelectorAll('img')].some(img => img.src === f.oldUrl));
          assert.ok(w.qaAlerts.length > 0); assert.equal(w.qaChanges.length, 0);
        });
      }
      if (baseline) continue;
      for (const mode of ['normal', 'uploadLostResponse', 'dbLostResponse', 'doubleChange']) {
        await t.test(`${role}: ${mode} updates visible avatar and cache only after commit`, async () => {
          const w = await mount(role, { [mode]: true }); const f = w.qaAvatar;
          await choose(w, mode === 'doubleChange');
          const url = f.state.rows[f.table].avatar_url;
          assert.notEqual(url, f.oldUrl);
          assert.ok([...w.document.querySelectorAll('img')].some(img => img.src === url));
          assert.equal(w.qaAlerts.length, 0);
          const snap = JSON.parse(w.localStorage.getItem('cb_snap_' + (role === 'worker' ? 'wMini' : 'empMini')));
          assert.equal(snap.avatar_url, url);
          assert.equal(f.state.events.filter(e => e.type === 'update' || e.type === 'insert').length, 1);
          if (mode === 'doubleChange') assert.equal(f.state.events.filter(e => e.type === 'upload').length, 1);
          button(w, '完了').click(); await pause(20);
          assert.equal(f.state.events.filter(e => e.type === 'upsert').length, 0, 'avatar Done never saves unrelated profile fields');
        });
      }
      await t.test(`${role}: unconfirmed save retains objects and displays recovery guidance`, async () => {
        const w = await mount(role, { dbLostResponse: true, readErrorAfterWrite: true }); const f = w.qaAvatar;
        await choose(w); assert.equal(f.state.objects.size, 2); assert.equal(w.qaChanges.length, 0);
        assert.ok(w.qaAlerts.some(message => message.includes('保存結果を確認できません')));
        assert.ok([...w.document.querySelectorAll('img')].some(img => img.src === f.oldUrl));
      });
    }
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
