import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfPageSlices } from '../src/lib/pdfExport.js';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));

test('PDF page breaks keep text lines and photos intact without losing vertical content', () => {
  assert.deepEqual(pdfPageSlices(2800, 1000, [{ top: 980, bottom: 1020 }, { top: 1950, bottom: 2020 }]), [
    { top: 0, height: 980 }, { top: 980, height: 970 }, { top: 1950, height: 850 },
  ]);
  assert.deepEqual(pdfPageSlices(2000, 1000, [{ top: 0, bottom: 1900 }]), [
    { top: 0, height: 1000 }, { top: 1000, height: 1000 },
  ], 'oversized content must still make progress');
  assert.throws(() => pdfPageSlices(2000, 0), /PDF_EMPTY_DOCUMENT/);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out: ${label}`);
    await pause(10);
  }
}

test('notice PDF isolates stalled page resources, bounds canvases, recovers from timeout and never downloads a late result', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-pdf-ui-'));
  let dom;
  const errors = [];
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'pdf-export-fixture', enforce: 'pre', resolveId(id) {
        if (process.env.CB_PDF_EXPORT_SOURCE && /(?:^|\/)pdfExport(?:\.js)?$/.test(id)) return path.resolve(process.env.CB_PDF_EXPORT_SOURCE);
        if (id === 'html2canvas') return path.join(root, 'scripts/fixtures/pdf-export/renderer.js');
        if (/(?:^|\/)supabase(?:\.js)?$/.test(id)) return path.join(root, 'scripts/fixtures/schedule/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/pdf-export/entry.jsx'), name: 'PdfQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const script = await readFile(path.join(output, 'fixture.iife.js'), 'utf8');
    const console = new VirtualConsole();
    console.on('jsdomError', e => { if (!/CSS|navigation/.test(e.message)) errors.push(e.message); });
    console.on('error', (...args) => errors.push(args.join(' ')));
    dom = new JSDOM('<style>.f-sans{font-family:NeverReadyFont}</style><img id="unrelated-image" src="https://unreachable.test/photo.jpg"><div id="root"></div>', {
      url: 'https://ui.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
    });
    const w = dom.window;
    Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder });
    w.qaMe = { id: '30000000-0000-4000-8000-000000000003' };
    w.qaApplicationId = '10000000-0000-4000-8000-000000000001';
    w.qaContracts = [{ id: w.qaApplicationId, job_number: 1311, status: 'approved',
      terms_confirmed_worker_at: '2026-09-21', terms_confirmed_farmer_at: '2026-09-22',
      terms_snapshot: { crop: 'ブロッコリー', task: '播種', date_start: '2026-09-24', work_time: '10:00〜12:00',
        pay_type: '日給', daily_wage: 2500, party_names: { farmer: 'テスト農家', worker: 'テスト働き手' },
      },
    }];
    w.qaEntries = [];
    w.qaCaptures = [];
    const alerts = [];
    w.alert = message => alerts.push(message);
    w.fetch = () => { errors.push('Unexpected network'); return Promise.reject(new Error('Unexpected network')); };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.scrollTo = () => {};
    Object.defineProperty(w.document, 'fonts', { value: { ready: new Promise(() => {}) } });
    let width = 390, height = 3000;
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height });
    // jsdom has no layout engine. Supply dimensions, including inside the new document.
    const iframeDocument = Object.getOwnPropertyDescriptor(w.HTMLIFrameElement.prototype, 'contentDocument').get;
    Object.defineProperty(w.HTMLIFrameElement.prototype, 'contentDocument', { get() {
      const doc = iframeDocument.call(this);
      if (doc) Object.defineProperty(doc.defaultView.HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => height });
      return doc;
    } });
    const realTimer = w.setTimeout.bind(w);
    // Keep the exact production deadline value; shorten only the test's wall-clock wait.
    const deadlines = [];
    w.setTimeout = (fn, ms, ...args) => { if (ms === 20000) deadlines.push(ms); return realTimer(fn, ms === 20000 ? 200 : ms, ...args); };
    const blobs = [], downloads = [], canvases = [];
    w.URL.createObjectURL = blob => { blobs.push(blob); return `blob:fixture-${blobs.length}`; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, href: this.href }); };
    const canvas = options => {
      const c = { width: Math.floor(options.width * options.scale), height: Math.floor(options.height * options.scale),
        toDataURL: () => 'data:image/jpeg;base64,/9j/2Q==',
      };
      canvases.push(c); return c;
    };
    w.qaCapture = async (_el, options) => canvas(options);
    w.eval(script);
    await until(() => w.document.querySelector('.cb-ctr-print'), 'notice loaded');
    const expected = w.document.querySelector('.cb-ctr-print').cloneNode(true);
    expected.querySelectorAll('.no-print').forEach(n => n.remove());
    const save = () => [...w.document.querySelectorAll('button')].find(b => b.textContent === 'PDFで保存');
    save().click();
    await until(() => downloads.length === 1, 'PDF downloaded despite stalled unrelated resources');
    assert.equal(downloads[0].filename, '労働条件通知書_No1311_ブロッコリー 播種.pdf');
    const pageHeight = Math.floor(width * (841.89 - 72) / (595.28 - 72));
    assert.equal(w.qaCaptures.length, Math.ceil(height / pageHeight));
    assert.deepEqual(w.qaCaptures.map(c => c.options.y), Array.from({ length: w.qaCaptures.length }, (_, i) => i * pageHeight));
    assert.equal(w.qaCaptures.reduce((sum, c) => sum + c.options.height, 0), height, 'all vertical content is captured once');
    for (const c of w.qaCaptures) {
      assert.equal(c.isolated, true);
      assert.equal(c.controls, 0);
      assert.equal(c.extraResources, 0);
      assert.equal(c.text, expected.textContent, 'every displayed notice field and provenance statement is preserved');
      assert.ok(c.fonts.every(font => font.includes('sans-serif') && !font.includes('NeverReadyFont')));
      for (const text of ['労働条件通知書', 'テスト農家', 'テスト働き手', '日給 2500円', '10:00〜12:00', '記録にありません']) assert.ok(c.text.includes(text), text);
    }
    assert.ok(canvases.every(c => c.width === 0 && c.height === 0), 'release canvas memory after encoding');
    assert.equal(w.document.querySelectorAll('iframe').length, 0);
    const bytes = new Uint8Array(await new Promise(resolve => { const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blobs[0]); }));
    const pdf = Buffer.from(bytes).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4'));
    assert.match(pdf, new RegExp(`/Count ${w.qaCaptures.length}\\b`));
    const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    assert.equal(pdf.slice(xref, xref + 4), 'xref');

    let release;
    w.qaCapture = (_el, options) => new Promise(resolve => { release = () => resolve(canvas(options)); });
    save().click();
    await until(() => alerts.length === 1 && save() && !save().disabled, 'timeout releases busy state and permits retry');
    assert.match(alerts[0], /時間内に完了しませんでした/);
    assert.equal(w.document.querySelectorAll('iframe').length, 0, 'timeout removes isolated document and nested capture frames');
    release(); await pause(30);
    assert.equal(downloads.length, 1, 'late rasterizer result must not download');
    w.qaCapture = async (_el, options) => canvas(options);
    save().click();
    await until(() => downloads.length === 2 && save() && !save().disabled, 'retry creates a new PDF');

    // Large document: no full-document allocation, and each page remains below 2.12 MP.
    width = 900; height = 18000; w.qaCaptures = [];
    const count = await w.qaSavePdf(w.document.querySelector('.cb-ctr-print'), 'long-notice');
    assert.ok(count > 10);
    assert.ok(w.qaCaptures.every(c => c.options.width * c.options.scale <= 1200 &&
      c.options.width * c.options.scale * c.options.height * c.options.scale < 2120000));
    assert.equal(downloads.length, 3);
    w.qaCapture = async () => ({ width: 0, height: 0 });
    await assert.rejects(w.qaSavePdf(w.document.querySelector('.cb-ctr-print'), 'empty'), /PDF_EMPTY_CANVAS/);
    assert.equal(downloads.length, 3, 'empty render is an error, not a corrupt download or zero-step loop');
    assert.equal(w.document.querySelectorAll('iframe').length, 0);
    assert.ok(deadlines.length >= 5);
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await rm(output, { recursive: true, force: true });
  }
});
