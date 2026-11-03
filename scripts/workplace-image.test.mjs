import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWorkplaceImage, validateWorkplaceImage, WORKPLACE_IMAGE_MAX_BYTES } from '../src/lib/workplaceImage.js';

// Test pixels/encoding control flow locally; no browser, network or user photos.
function fixture(t, options = {}) {
  const state = { created: [], revoked: [], draws: 0, encoded: [], canvases: [] };
  const originals = { Image: globalThis.Image, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = file => { state.created.push(file); return 'blob:synthetic'; };
  URL.revokeObjectURL = url => state.revoked.push(url);
  globalThis.Image = class {
    naturalWidth = options.width ?? 3200;
    naturalHeight = options.height ?? 2400;
    set src(value) { assert.equal(value, 'blob:synthetic'); queueMicrotask(() => options.decodeError ? this.onerror() : this.onload()); }
  };
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = {
      getContext(type) {
        assert.equal(type, '2d');
        if (options.noContext) return null;
        return { fillRect() {}, drawImage() { if (options.drawError) throw new Error('draw failed'); state.draws++; } };
      },
      toBlob(callback, type, quality) {
        state.encoded.push({ type, quality });
        if (options.encodeThrow) throw new Error('encode failed');
        callback(options.nullBlob ? null : new Blob([options.oversized ? new Uint8Array(WORKPLACE_IMAGE_MAX_BYTES + 1) : 'fresh pixels without original metadata'], { type: options.wrongMime ? 'image/png' : type }));
      },
    };
    state.canvases.push(canvas); return canvas;
  } };
  t.after(() => {
    for (const key of ['Image', 'document']) if (originals[key] === undefined) delete globalThis[key]; else globalThis[key] = originals[key];
    URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke;
  });
  return state;
}

test('rejects missing/unsupported/empty/oversized source before decoding', async t => {
  const state = fixture(t);
  for (const file of [null, { type: 'image/svg+xml', size: 20 }, { type: 'image/heic', size: 20 }, { type: 'image/jpeg', size: 0 }, { type: 'image/png', size: WORKPLACE_IMAGE_MAX_BYTES + 1 }]) {
    assert.throws(() => validateWorkplaceImage(file));
    await assert.rejects(encodeWorkplaceImage(file));
  }
  assert.equal(state.created.length, 0);
});

for (const [name, width, height, resultWidth, resultHeight] of [['large landscape', 3200, 2400, 1600, 1200], ['portrait', 1200, 2400, 800, 1600], ['tiny', 20, 10, 20, 10]]) {
  test(`always freshly JPEG-encodes ${name}, never returning original metadata bytes`, async t => {
    const state = fixture(t, { width, height });
    const source = new Blob(['EXIF: GPS original synthetic bytes'], { type: 'image/jpeg' });
    const result = await encodeWorkplaceImage(source);
    assert.notEqual(result, source);
    assert.equal(result.type, 'image/jpeg');
    assert.equal(await result.text(), 'fresh pixels without original metadata');
    assert.equal(state.draws, 1);
    assert.deepEqual(state.encoded, [{ type: 'image/jpeg', quality: 0.85 }]);
    assert.equal(state.canvases[0].width, resultWidth); assert.equal(state.canvases[0].height, resultHeight);
    assert.deepEqual(state.revoked, ['blob:synthetic']);
  });
}

for (const type of ['image/png', 'image/webp']) {
  test(`${type} input also produces JPEG`, async t => {
    fixture(t); assert.equal((await encodeWorkplaceImage(new Blob(['synthetic'], { type }))).type, 'image/jpeg');
  });
}

for (const options of [{ decodeError: true }, { width: 0 }, { height: 0 }, { noContext: true }, { drawError: true }, { encodeThrow: true }, { nullBlob: true }, { wrongMime: true }, { oversized: true }]) {
  test(`fails closed and releases temporary URL: ${JSON.stringify(options)}`, async t => {
    const state = fixture(t, options);
    await assert.rejects(encodeWorkplaceImage(new Blob(['raw bytes must never be returned'], { type: 'image/png' })));
    assert.deepEqual(state.revoked, ['blob:synthetic']);
  });
}
