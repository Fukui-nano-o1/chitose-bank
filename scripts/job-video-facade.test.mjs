import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { youtubeVideoId, youtubeEmbedUrl } from '../src/lib/youtube.js';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require(process.env.CB_TEST_NODE_MODULES ? `${process.env.CB_TEST_NODE_MODULES}/jsdom` : 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, `timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('YouTube URLs: accepted hosts and paths only, with validated video IDs', () => {
  const id = 'aKydtOXW8mI';
  for (const url of [`https://youtu.be/${id}?si=share`, `https://www.youtube.com/watch?v=${id}&t=30`, `https://m.youtube.com/watch?v=${id}`, `https://youtube.com/shorts/${id}`, `https://youtube.com/embed/${id}`, `https://youtube.com/live/${id}`]) assert.equal(youtubeVideoId(url), id);
  for (const url of ['', 'javascript:alert(1)', `https://youtube.com.evil.test/watch?v=${id}`, `https://example.com/watch?v=${id}`, `https://user:pass@youtube.com/watch?v=${id}`, `https://youtube.com:444/watch?v=${id}`, 'https://youtube.com/watch?v=bad', `https://youtu.be/${id}/extra`]) assert.equal(youtubeVideoId(url), '');
  assert.equal(youtubeEmbedUrl('bad'), '');
  const explicit = new URL(youtubeEmbedUrl(id));
  assert.equal(explicit.host, 'www.youtube-nocookie.com');
  assert.equal(explicit.searchParams.get('controls'), '1');
  assert.equal(explicit.searchParams.get('mute'), null);
  assert.equal(new URL(youtubeEmbedUrl(id, { muted: true })).searchParams.get('mute'), '1');
});

test('real job cards: facade loads on tap only, native controls, preserved photos and separate job/save actions', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'cb-video-ui-'));
  let dom; const errors = [];
  try {
    await build({ configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{
      name: 'video-fixture', enforce: 'pre', resolveId(module) {
        if (/(?:^|\/)supabase(?:\.js)?$/.test(module)) return path.join(root, 'scripts/fixtures/analytics/client.js');
      },
    }, react()], build: { outDir: output, lib: { entry: path.join(root, 'scripts/fixtures/job-video/entry.jsx'), name: 'VideoQA', formats: ['iife'], fileName: 'fixture' }, minify: false } });
    const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message)); console.on('error', (...args) => errors.push(args.join(' ')));
    dom = new JSDOM('<div id="root"></div>', { url: 'https://ui.test/#/work/search', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console });
    const w = dom.window;
    Object.assign(w, { Response, Request, Headers, AbortController, AbortSignal, TextEncoder, TextDecoder });
    w.Element.prototype.scrollTo = function (options) { this.scrollLeft = options.left || 0; this.dispatchEvent(new w.Event('scroll')); };
    w.qaCalls = []; w.qaLikes = 0; w.qaOpened = 0;
    w.qaJobs = [
      { id: 9001, crop: 'ブロッコリー', task: '収穫', workVideoUrl: 'https://youtu.be/aKydtOXW8mI', photos: [{ url: '/one.jpg' }, { url: '/two.jpg' }], pay: 10000 },
      { id: 9002, crop: 'ネギ', task: '調整', workVideoUrl: 'https://youtube.com/watch?v=ogfYd705cRs', photos: [] },
      { id: 9003, crop: 'ナス', task: '収穫', photos: [{ url: '/plain.jpg' }] },
      { id: 9004, crop: '人参', task: '選別', workVideoUrl: 'https://youtube.com.evil.test/watch?v=aKydtOXW8mI', photos: [] },
      { id: 9005, crop: '米', task: '袋詰め', workVideoUrl: 'https://youtu.be/aKydtOXW8mI', photos: [], noVideoPreview: true },
    ];
    w.fetch = () => { throw Error('Unexpected network'); };
    w.eval(await readFile(path.join(output, 'fixture.iife.js'), 'utf8'));
    await until(() => w.document.querySelectorAll('.job-video-card').length === 2, 'video cards');
    const cards = w.document.querySelectorAll('.job-video-card');
    assert.equal(w.document.querySelectorAll('iframe').length, 0, 'No YouTube player is loaded on listing render');
    const first = cards[0], second = cards[1];
    const media = first.querySelector('.job-card-media-scroll');
    Object.defineProperty(media, 'clientWidth', { value: 320 });
    const heightBefore = media.style.height;
    assert.equal(heightBefore, '220px');
    assert.equal(first.querySelectorAll('.job-card-media-scroll img').length, 3, 'Poster plus both original photos');
    const play = first.querySelector('.job-video-facade');
    assert.equal(play.closest('a'), null, 'Play control is not nested inside the job link');
    first.querySelector('[aria-label="いいね"]').click();
    assert.equal(w.qaLikes, 1); assert.equal(w.qaOpened, 0);
    play.click();
    await until(() => first.querySelector('iframe'), 'click loads player');
    assert.equal(w.document.querySelectorAll('iframe').length, 1);
    assert.equal(first.querySelector('.job-video-facade'), null, 'Facade removed, not layered over player');
    assert.equal(media.style.height, heightBefore, 'Player uses exactly the reserved poster frame');
    const frame = first.querySelector('iframe');
    assert.equal(frame.closest('a'), null);
    assert.equal(frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
    assert.equal(new URL(frame.src).searchParams.get('controls'), '1');
    assert.equal(w.qaOpened, 0, 'Playing does not open a job');
    second.querySelector('.job-video-facade').click();
    await until(() => second.querySelector('iframe') && !first.querySelector('iframe'), 'only selected card plays');
    first.querySelector('[aria-label="次の画像・動画"]').click();
    await until(() => first.textContent.includes('写真1'), 'next photo');
    assert.equal(media.scrollLeft, 320);
    first.querySelector('[aria-label="前の画像・動画"]').click();
    await until(() => media.scrollLeft === 0, 'back to video');
    first.querySelector('.job-video-facade').click();
    await until(() => first.querySelector('iframe'), 'replay facade');
    media.scrollLeft = 320; media.dispatchEvent(new w.Event('scroll'));
    await until(() => !first.querySelector('iframe'), 'swiping to photos releases player');
    first.querySelector('a[href="#/work/job/9001"]').click();
    assert.equal(w.qaOpened, 1, 'Job summary link preserves navigation');
    second.querySelector('.job-video-facade').click();
    await until(() => second.querySelector('iframe'), 'second video');
    Object.defineProperty(w.document, 'hidden', { configurable: true, value: true });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    await until(() => w.document.querySelectorAll('iframe').length === 0, 'background tab stops playback');
    assert.deepEqual(errors, []);
    assert.equal(w.qaCalls.length, 0, 'Cards do not issue database queries');
    const panel = await readFile(path.join(root, 'src/features/jobs/search/components/JobDetailPanel.jsx'), 'utf8');
    const video = panel.slice(panel.indexOf('export function JobWorkVideo('), panel.indexOf('export function JobThingsToKnow('));
    assert.doesNotMatch(video, /タップして音声を再生|postMessage|setVolume|unMute|<button/);
    const search = await readFile(path.join(root, 'src/components/JobSearchMapView.jsx'), 'utf8');
    assert.match(search, /variant="list" videoPreview/);
  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
