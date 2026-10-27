// Optional evidence replay, not part of CI: use a separately downloaded, pinned Google bundle.
// No Google source is redistributed and no translation/network request is made.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

if (!process.argv[2]) throw new Error('Usage: node scripts/verify-google-translate-la.mjs <downloaded el_main file>');
const source = await readFile(process.argv[2], 'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'), '7037ed3a247dbb650761b2cc4fcee3ce2faf31d37dc4ebb871d8c1cca5987dba', 'Use the exact 2026-10-27 evidence bundle');
const marker = '_.oa();\n}catch(e)';
const at = source.lastIndexOf(marker);
assert.ok(at > 0);
// No added newline before the original code: retain all recorded line/column positions.
const entry = 'window.__qaRejectTranslate=function(){Sr="prod";Vr=new Pr;Zr="te_lib";fx=function(){window.__qaRequestCalled=true;return Promise.reject(Error("simulated translation request failure"));};return gx(kx(new jx,["<p>test only</p>"]).eb("ja").va("en"));};';
const instrumented = source.slice(0, at) + entry + source.slice(at);
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://test.invalid/', runScripts: 'outside-only' });
try {
  const w = dom.window;
  w.fetch = () => { throw new Error('Unexpected network'); };
  w.XMLHttpRequest = function () { throw new Error('Unexpected network'); };
  w._DumpException = error => { throw error; };
  vm.runInContext(instrumented, dom.getInternalVMContext(), { filename: 'https://test.invalid/', timeout: 5000 });
  await assert.rejects(w.__qaRejectTranslate(), error => {
    assert.equal(w.__qaRequestCalled, true);
    assert.equal(error.message, 'La');
    assert.match(error.stack, /:518:339/);
    assert.match(error.stack, /Li .*:196:220/);
    assert.match(error.stack, /:197:336/);
    console.log(error.stack);
    return true;
  });
  console.log('PASS: Original Google failure handler reproduced La; external network disabled.');
} finally { dom.window.close(); }
