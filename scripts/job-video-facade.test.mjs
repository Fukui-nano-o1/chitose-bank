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
      { id: 9005, crop: '米', task: '袋詰め', workVideoUrl: 'https://youtu.be/aKydtOXW8mI', photos: [], variant: "related" },
    ];
    w.fetch = () => { throw Error('Unexpected network'); };
    w.eval(await readFile(path.join(output, 'fixture.iife.js'), 'utf8'));
    await until(() => w.document.querySelectorAll('.job-video-card').length === 3, 'video cards across variants');
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
    assert.match(search, /variant="list" priority=/);
    const cardSource = await readFile(path.join(root, 'src/components/JobCard.jsx'), 'utf8');
    assert.doesNotMatch(cardSource, /props\.videoPreview|props\.variant === "list" \? youtubeVideoId/);

    // All list/wide/related/default variants: video+photos and photos-only.
    Object.defineProperty(w.document, 'hidden', { configurable:true, value:false });
    const variants = ['list', 'wide', 'related', ''];
    const jobs = variants.flatMap((variant, index) => [
      { id:9100+index*2, variant, crop:'野菜', task:'収穫', photos:['/first.jpg', { url:'/second.jpg', thumb:'/second-thumb.jpg' }] },
      { id:9101+index*2, variant, crop:'野菜', task:'選別', workVideoUrl:'https://youtu.be/aKydtOXW8mI', photos:['/first.jpg','/second.jpg'] },
    ]);
    jobs.push({ id:9190, crop:'ナス', task:'収穫', photos:['/single.jpg'] },
      { id:9191, crop:'ネギ', task:'選別', photos:null },
      { id:9192, crop:'米', task:'調整', workVideoUrl:'https://example.com/video', photos:[null, {}, '/valid-one.jpg','/valid-two.jpg'] });
    w.qaRender(jobs);
    await until(() => w.document.querySelectorAll('.job-media-card').length === 9, 'shared media for all variants');
    assert.equal(w.document.querySelectorAll('iframe').length, 0);
    for (let i=0; i<8; i++) {
      const card = w.document.querySelectorAll('.job-media-card')[i];
      const strip = card.querySelector('.job-card-media-scroll');
      Object.defineProperty(strip, 'clientWidth', { value:280 });
      assert.equal(strip.style.height, '220px');
      assert.equal(card.querySelectorAll('[data-media-type="photo"]').length,2);
      assert.equal(card.querySelectorAll('[data-media-type="youtube"]').length, i%2);
      assert.equal(card.querySelector('a[href="#/work/job/'+jobs[i].id+'"]').getAttribute('href'), '#/work/job/'+jobs[i].id);
      const oldOpened = w.qaOpened;
      card.querySelector('[aria-label="次の画像・動画"]').click();
      await until(() => strip.scrollLeft === 280, 'next item in variant');
      await until(() => card.querySelector('[aria-live]').textContent.includes(i%2 ? '写真1' : '写真2'), 'correct media counter');
      assert.equal(w.qaOpened,oldOpened,'arrow never opens a job');
      card.querySelector('[aria-label="前の画像・動画"]').click();
      await until(() => strip.scrollLeft === 0, 'return to first item');
      strip.dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true,cancelable:true}));
      await until(() => strip.scrollLeft === 280, 'keyboard navigation');
      assert.equal(w.qaOpened,oldOpened);
      if (i%2) {
        assert.equal(card.querySelectorAll('.job-card-media-types button').length,2);
        card.querySelector('.job-card-media-types button').click();
        await until(() => strip.scrollLeft === 0, 'YouTube type selector');
        assert.equal(card.querySelectorAll('iframe').length,0,'selecting YouTube alone never downloads its player');
      } else {
        assert.equal(card.querySelector('.job-card-media-types'),null,'no blank YouTube tab');
        assert.equal(card.querySelector('.job-video-facade'),null);
      }
    }
    const photoCard = w.document.querySelector('.job-photo-card');
    const strip = photoCard.querySelector('.job-card-media-scroll');
    const photoLink = photoCard.querySelector('.job-card-photo-link');
    const openedBeforeSwipe = w.qaOpened;
    strip.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,clientX:220,clientY:100}));
    strip.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true,clientX:30,clientY:101}));
    strip.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,clientX:30,clientY:101}));
    photoLink.click();
    assert.equal(w.qaOpened,openedBeforeSwipe,'synthetic click after a swipe cannot open the job');
    strip.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,clientX:50,clientY:50}));
    strip.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,clientX:50,clientY:50}));
    photoLink.click();
    assert.equal(w.qaOpened,openedBeforeSwipe+1,'ordinary photo tap still opens the job');
    const relatedCard = [...w.document.querySelectorAll('.job-media-card')][4];
    assert.equal(relatedCard.style.maxWidth,'280px');
    assert.equal(relatedCard.querySelector(':scope > a').style.maxWidth,'none');
    assert.equal(w.document.querySelector('[href="#/work/job/9190"]').querySelector('img').getAttribute('src'),'/single.jpg');
    assert.ok(w.document.querySelector('[href="#/work/job/9191"]'),'empty media keeps the existing fallback link');
    w.qaRender([{...jobs[1],photos:['/short.jpg']}]);
    await until(() => w.document.querySelectorAll('[data-media-type="photo"]').length === 1,'changed photos reset media');
    assert.match(w.document.querySelector('[aria-live]').textContent,/YouTube.*1\/2/);
    assert.deepEqual(errors,[]);
    assert.equal(w.qaCalls.length,0);

    // Search-only layout: shared photo/summary first, optional standalone YouTube below.
    {
      const baseJob = {id:9301,variant:'list',videoPlacement:'below',priority:true,crop:'ブロッコリー',task:'収穫',region:'徳島県吉野川市',dateStartRaw:'2026-11-01',pay:10000,beginnerOk:true,views:8,photos:['/search-one.jpg','/search-two.jpg'],workVideoUrl:'https://youtu.be/aKydtOXW8mI'};
      w.qaRender([baseJob,{...baseJob,id:9302,photos:[]},{...baseJob,id:9303,photos:['/single.jpg']},{...baseJob,id:9304,workVideoUrl:''},{...baseJob,id:9305,workVideoUrl:'https://youtube.com.evil.test/watch?v=aKydtOXW8mI'},{...baseJob,id:9306,closed:true}]);
      await until(()=>w.document.querySelectorAll('.job-card-with-video').length===4,'only valid videos create a lower section');
      const shell=w.document.querySelector('.job-card-with-video');
      const card=shell.firstElementChild;
      const below=shell.lastElementChild;
      assert.equal(card.dataset.guide,'job-card');
      assert.ok(below.classList.contains('job-card-video-below'));
      assert.equal(card.style.marginBottom,'0px','one outer card spacing, not two');
      for(const text of ['ブロッコリー','収穫','徳島県吉野川市','#9301','10,000','初心者大歓迎'])assert.ok(card.textContent.includes(text),text+' stays in the upper card');
      assert.equal(card.querySelectorAll('[data-media-type="photo"]').length,2);
      assert.equal(card.querySelector('[data-media-type="youtube"]'),null,'no video replaces a photo');
      assert.equal(below.querySelector('[data-media-type="photo"]'),null);
      assert.equal(below.querySelectorAll('[data-media-type="youtube"]').length,1);
      assert.equal(shell.querySelector('.job-card-media-types'),null,'no redundant photo/YouTube selector');
      assert.equal(below.querySelectorAll('[aria-label="次の画像・動画"]').length,0);
      assert.equal(w.document.querySelectorAll('iframe').length,0,'separate videos also stay click-to-load');
      assert.equal(card.querySelector('img').getAttribute('loading'),'eager','first photo remains prioritized');
      assert.equal(below.querySelector('img').getAttribute('loading'),'lazy','lower poster is not prioritized over the card');
      assert.ok(card.querySelector('[aria-label="閲覧数 8"]'));
      const opened=w.qaOpened, likes=w.qaLikes;
      card.querySelector('[aria-label="いいね"]').click();
      assert.equal(w.qaLikes,likes+1);assert.equal(w.qaOpened,opened);
      below.querySelector('.job-video-facade').click();
      await until(()=>below.querySelector('iframe'),'lower player loads');
      assert.equal(w.qaOpened,opened);assert.equal(below.querySelector('iframe').closest('a'),null);
      assert.equal(below.querySelector('.job-video-facade'),null,'native controls have no facade overlay');
      const photos=card.querySelector('.job-card-media-scroll');
      Object.defineProperty(photos,'clientWidth',{value:300});
      card.querySelector('[aria-label="次の画像・動画"]').click();
      await until(()=>photos.scrollLeft===300,'search photo carousel still advances');
      assert.match(card.querySelector('[aria-live]').textContent,/写真2.*2\/2/);
      assert.equal(w.qaOpened,opened);
      assert.ok(below.querySelector('iframe'),'photos and the separate video have independent state');
      card.querySelector(':scope > a').click();assert.equal(w.qaOpened,opened+1);
      const all=[...w.document.querySelectorAll('.job-card-with-video')];
      assert.ok(all[1].firstElementChild.textContent.includes('#9302'),'no-photo job retains its real summary');
      assert.ok(all[2].firstElementChild.querySelector('img[src="/single.jpg"]'));
      assert.equal(all[3].firstElementChild.querySelector('[aria-label="いいね"]'),null,'closed job cannot be liked');
      assert.match(all[3].firstElementChild.textContent,/募集終了/);
      all[1].querySelector('.job-video-facade').click();
      await until(()=>all[1].querySelector('iframe')&&!below.querySelector('iframe'),'only one lower player plays');
      w.dispatchEvent(new w.Event('hashchange'));
      await until(()=>w.document.querySelectorAll('iframe').length===0,'navigation stops lower players');
      below.querySelector('.job-video-facade').click();await until(()=>below.querySelector('iframe'),'replay before source change');
      w.qaRender([{...baseJob,workVideoUrl:'https://youtu.be/ogfYd705cRs'}]);
      await until(()=>w.document.querySelectorAll('.job-card-with-video').length===1&&!w.document.querySelector('iframe'),'source change releases old player');
      assert.match(w.document.querySelector('.job-card-video-below img').src,/ogfYd705cRs/);
      w.qaRender([{...baseJob,workVideoUrl:''}]);
      await until(()=>!w.document.querySelector('.job-card-with-video'),'removing video leaves no blank section');
      assert.ok(w.document.querySelector('[href="#/work/job/9301"]'));
      assert.match(search,/variant="list" priority=\{index === 0\} videoPlacement="below"/,'real search page opts into the split layout');
      assert.deepEqual(errors,[]);assert.equal(w.qaCalls.length,0);
    }

  } finally { dom?.window.close(); await rm(output, { recursive: true, force: true }); }
});
