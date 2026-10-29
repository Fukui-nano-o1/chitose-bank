import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureId = path.join(root, 'scripts/fixtures/pill-select-virtual.jsx');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LFPillSelect } from '../../src/components/ui.jsx';
import { LFPillSelect as canonical } from '../../src/components/LFPillSelect.jsx';
window.qaSameComponent = LFPillSelect === canonical;
const root = createRoot(document.getElementById('root'));
window.qaRender = props => flushSync(() => root.render(
  <form onSubmit={event => { event.preventDefault(); window.qaSubmissions++; }}>
    <LFPillSelect options={['収穫','選果','定植']} {...props} onSelect={option => window.qaSelections.push(option)} />
  </form>
));
`;

test('shared pill selector has one implementation and preserves controlled interaction', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'pill-select-ui-'));
  let dom;
  try {
    await build({ configFile: false, root, logLevel: 'error',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{ name: 'isolated-pill-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === fixtureId) return id;
          if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return '\0pill-client';
        },
        load(id) {
          if (id === fixtureId) return fixture;
          if (id === '\0pill-client') return 'export const supabase = {};';
        },
      }, react()],
      build: { outDir: output, lib: { entry: fixtureId, name: 'PillQA', formats: ['iife'], fileName: 'fixture' }, minify: false },
    });
    const errors = [], console = new VirtualConsole();
    console.on('jsdomError', error => errors.push(error.message));
    dom = new JSDOM('<div id="root"></div>', { url: 'https://pill.test', runScripts: 'outside-only', virtualConsole: console });
    const w = dom.window;
    w.qaSelections = [];
    w.qaSubmissions = 0;
    w.fetch = () => { throw new Error('Unexpected network'); };
    w.eval(await readFile(path.join(output, 'fixture.iife.js'), 'utf8'));
    const buttons = () => [...w.document.querySelectorAll('button')];
    const pressed = () => buttons().map(button => button.getAttribute('aria-pressed'));

    await t.test('barrel selects canonical component without a shadow implementation', async () => {
      assert.equal(w.qaSameComponent, true);
      const primitives = await readFile(path.join(root, 'src/components/uiPrimitives.jsx'), 'utf8');
      assert.doesNotMatch(primitives, /\bLFPillSelect\b/);
    });
    await t.test('single selection retains accessibility, classes and green styling', () => {
      w.qaRender({ value: '収穫' });
      assert.deepEqual(pressed(), ['true', 'false', 'false']);
      assert.ok(w.document.querySelector('.lf-pill-select'));
      assert.ok(buttons().every(button => button.type === 'button' && button.classList.contains('lf-pill-option')));
      assert.equal(buttons()[0].style.background, 'rgb(230, 247, 239)');
      assert.equal(buttons()[0].style.color, 'rgb(0, 168, 107)');
      assert.equal(buttons()[1].style.background, 'rgb(255, 255, 255)');
    });
    await t.test('repeated clicks emit exact options without implicit toggle or form submit', () => {
      buttons()[1].click();
      buttons()[1].click();
      assert.deepEqual(Array.from(w.qaSelections), ['選果', '選果']);
      assert.deepEqual(pressed(), ['true', 'false', 'false']);
      assert.equal(w.qaSubmissions, 0);
      w.qaRender({ value: '選果' });
      assert.deepEqual(pressed(), ['false', 'true', 'false']);
    });
    await t.test('multiple selection takes precedence and preserves role/custom soft colors', () => {
      w.qaRender({ value: '選果', values: ['収穫', '定植'], accent: '#F28C28' });
      assert.deepEqual(pressed(), ['true', 'false', 'true']);
      assert.equal(buttons()[0].style.background, 'rgb(255, 241, 232)');
      assert.equal(buttons()[0].style.color, 'rgb(242, 140, 40)');
      w.qaRender({ values: ['選果'], accent: '#123456', accentSoft: '#abcdef' });
      assert.deepEqual(pressed(), ['false', 'true', 'false']);
      assert.equal(buttons()[1].style.background, 'rgb(171, 205, 239)');
      w.qaRender({ value: '収穫', values: [] });
      assert.deepEqual(pressed(), ['false', 'false', 'false']);
    });
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
