from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    content = p.read_text()
    assert content.count(old) == 1, f'Expected one anchor in {path}: {old[:80]}'
    p.write_text(content.replace(old, new, 1))


Path('src/lib/youtube.js').write_text(r'''// Only known YouTube video URLs are accepted. Never use user-provided HTML as an embed.
export function youtubeVideoId(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1] || '';
    else if (host === 'youtube.com' || host === 'm.youtube.com') {
      id = url.pathname === '/watch' ? url.searchParams.get('v') || ''
        : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1] || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  } catch { return ''; }
}

export function youtubeEmbedUrl(id, { muted = false } = {}) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return '';
  const params = new URLSearchParams({ autoplay: '1', playsinline: '1', controls: '1', rel: '0' });
  if (muted) params.set('mute', '1');
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}
''')

Path('src/components/JobVideoCard.jsx').write_text(r'''import { useEffect, useId, useRef, useState } from 'react';
import { photoThumb } from '../lib/utils';
import { youtubeEmbedUrl } from '../lib/youtube';
import { NavIcon } from './NavIcons';

const PLAY_EVENT = 'cb:job-card-video-play';
const controlStyle = { border: '1px solid #ddd', borderRadius: 8, background: '#fff', color: '#222', minWidth: 44, minHeight: 44, font: 'inherit', fontSize: 13, padding: '8px 12px', cursor: 'pointer' };

// Search-list-only media. The poster exists instead of, not on top of, the YouTube player.
// https://web.dev/articles/embed-best-practices#use_click-to-load_to_enhance_facades
export function JobVideoCardMedia({ videoId, photos = [], title, height = 220, priority = false }) {
  const instance = useId();
  const scroller = useRef(null);
  const root = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState(0);
  const [posterFailed, setPosterFailed] = useState(false);
  const images = (Array.isArray(photos) ? photos : []).filter(photo => photoThumb(photo));
  const count = images.length + 1;

  useEffect(() => {
    const stop = () => setPlaying(false);
    const otherStarted = event => { if (event.detail !== instance) stop(); };
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener(PLAY_EVENT, otherStarted);
    window.addEventListener('hashchange', stop);
    document.addEventListener('visibilitychange', hidden);
    // Do not leave an offscreen card playing or downloading in the background.
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) stop();
    }, { threshold: 0 }) : null;
    if (root.current) observer?.observe(root.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener(PLAY_EVENT, otherStarted);
      window.removeEventListener('hashchange', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [instance]);

  const start = event => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: instance }));
    setPlaying(true);
  };
  const move = index => {
    const next = Math.max(0, Math.min(index, count - 1));
    if (next !== 0) setPlaying(false);
    setActive(next);
    scroller.current?.scrollTo({ left: next * scroller.current.clientWidth, behavior: 'auto' });
  };
  const onScroll = event => {
    const el = event.currentTarget;
    if (!el.clientWidth) return;
    const index = Math.max(0, Math.min(Math.round(el.scrollLeft / el.clientWidth), count - 1));
    setActive(index);
    if (index !== 0) setPlaying(false);
  };

  return <div ref={root} className="job-card-video-media">
    <div ref={scroller} onScroll={onScroll} className="carousel-scroll job-card-media-scroll"
      aria-label="作業動画と求人写真"
      style={{ display: 'flex', width: '100%', height, overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', overscrollBehaviorX: 'contain', WebkitOverflowScrolling: 'touch', borderRadius: 16 }}>
      <div style={{ flex: '0 0 100%', minWidth: 0, height, scrollSnapAlign: 'start', background: '#111', position: 'relative' }}>
        {playing && active === 0 ? <iframe
          title={`作業動画：${title}`} src={youtubeEmbedUrl(videoId)}
          allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={event => event.currentTarget.focus({ preventScroll: true })}
          style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />
          : <button type="button" className="job-video-facade" onClick={start} aria-label="作業動画を再生"
            style={{ display: 'block', position: 'relative', width: '100%', height: '100%', padding: 0, border: 0, color: '#fff', background: '#222', cursor: 'pointer' }}>
            {!posterFailed && <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt={`${title}の作業動画`}
              loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined}
              onError={() => setPosterFailed(true)}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />}
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span className="f-sans" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,.76)', color: '#fff', padding: '12px 18px', borderRadius: 24, fontSize: 14, fontWeight: 700 }}>
                <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M2 1 L15 9 L2 17 Z" fill="currentColor" /></svg>
                作業動画を見る
              </span>
            </span>
          </button>}
      </div>
      {images.map((photo, index) => <div key={index} style={{ flex: '0 0 100%', minWidth: 0, height, scrollSnapAlign: 'start', background: '#f7f7f7' }}>
        <img src={photoThumb(photo)} alt={typeof photo === 'string' ? `求人写真 ${index + 1}` : photo.caption || `求人写真 ${index + 1}`}
          loading="lazy" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>)}
    </div>
    {/* Controls stay outside the iframe, leaving YouTube branding, ads and controls unobscured. */}
    <div className="f-sans job-card-media-controls" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6, minHeight: 44 }}>
      {count > 1 && <>
        <button type="button" onClick={() => move(active - 1)} disabled={active === 0} aria-label="前の画像・動画" style={{ ...controlStyle, opacity: active === 0 ? .4 : 1 }}>‹</button>
        <span aria-live="polite" style={{ color: '#717171', fontSize: 12 }}>{active === 0 ? '動画' : `写真${active}`} · {active + 1}/{count}</span>
        <button type="button" onClick={() => move(active + 1)} disabled={active === count - 1} aria-label="次の画像・動画" style={{ ...controlStyle, opacity: active === count - 1 ? .4 : 1 }}>›</button>
      </>}
      <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer"
        style={{ marginLeft: 'auto', color: '#717171', fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3, padding: '10px 0' }}>YouTubeで開く</a>
    </div>
  </div>;
}

// Only the media differs. Summary/link rendering stays in the existing JobCard implementation.
export function JobVideoCard({ job, videoId, saved, onToggleSave, views, priority, summary, height = 220, hideEndLabel }) {
  const ended = job.filled || job.expired || job.closed;
  const endLabel = job.filled ? (job.closed || job.expired ? '掲載終了（満員）' : '募集終了（満員）') : job.closed ? '募集終了' : '募集期間終了';
  return <article data-guide="job-card" className="job-video-card" style={{ width: '100%', minWidth: 0, textAlign: 'left' }}>
    <div className="f-sans" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 44, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#717171' }}>作業動画</span>
      {job.isNew && !ended && <span style={{ fontSize: 12, fontWeight: 700 }}>新着</span>}
      {!hideEndLabel && ended && <span style={{ fontSize: 12, fontWeight: 700, color: '#555' }}>{endLabel}</span>}
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {Number(views) > 0 && <span aria-label={`閲覧数 ${views}`} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#555', fontSize: 13 }}><NavIcon name="views" size={15} />{views}</span>}
        {typeof onToggleSave === 'function' && !ended && <button type="button"
          onClick={event => { event.preventDefault(); event.stopPropagation(); onToggleSave(job); }}
          aria-label={saved ? 'いいねを解除' : 'いいね'} style={{ ...controlStyle, borderRadius: '50%', padding: 10, display: 'grid', placeItems: 'center', color: saved ? '#E24B4A' : '#717171' }}>
          <NavIcon name={saved ? 'heartFill' : 'heart'} size={22} />
        </button>}
      </span>
    </div>
    <JobVideoCardMedia key={videoId} videoId={videoId} photos={job.photos} title={`${job.crop} ${job.task}`} height={height} priority={priority} />
    {summary}
  </article>;
}
''')

card = Path('src/components/JobCard.jsx')
s = card.read_text()
s = s.replace('import { useState } from "react";', 'import { useState } from "react";\nimport { youtubeVideoId } from "../lib/youtube";\nimport { JobVideoCard } from "./JobVideoCard";', 1)
old = 'export function JobCard({ job, variant, saved, onToggleSave, onOpen, hideEndLabel, views, priority = false }) {'
assert s.count(old) == 1
s = s.replace(old, '''export function JobCard(props) {
  const videoId = props.videoPreview && props.variant === "list" ? youtubeVideoId(props.job?.workVideoUrl) : "";
  if (videoId) return <JobVideoCard key={`${props.job.id}:${videoId}`} {...props} videoId={videoId} height={JOB_CARD_PHOTO_H}
    summary={<StaticJobCard {...props} hideMedia />} />;
  return <StaticJobCard {...props} />;
}

function StaticJobCard({ job, variant, saved, onToggleSave, onOpen, hideEndLabel, views, priority = false, hideMedia = false }) {''', 1)
s = s.replace('data-guide="job-card"', 'data-guide={hideMedia ? undefined : "job-card"}', 1)
start = s.index('      {/* 👀 閲覧数')
end = s.index('      {/* 概要＝写真の下', start)
s = s[:start] + '      {!hideMedia && <>\n' + s[start:end] + '      </>}\n' + s[end:]
card.write_text(s)

replace_once('src/components/JobSearchMapView.jsx',
    '<JobCard key={job.id} job={job} variant="list" priority={index === 0}',
    '<JobCard key={job.id} job={job} variant="list" videoPreview priority={index === 0}')

panel = Path('src/features/jobs/search/components/JobDetailPanel.jsx')
s = panel.read_text()
anchor = 'import { useState, useEffect, useRef } from "react";'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + '\nimport { youtubeVideoId, youtubeEmbedUrl } from "../../../../lib/youtube";', 1)
start = s.index('export function JobWorkVideo(')
end = s.index('export function JobThingsToKnow(', start)
assert 'タップして音声を再生' in s[start:end]
s = s[:start] + '''export function JobWorkVideo({ job, compact = false }) {
  const id = youtubeVideoId(job?.workVideoUrl);
  if (!id) return null;
  // Keep muted autoplay on detail pages. Sound is controlled by YouTube's native controls.
  return (
    <div style={{ margin: compact ? 0 : "0 0 28px", width:"100%", height: compact ? "100%" : "auto" }}>
      {!compact && <h3 className="f-sans" style={{ fontSize:20, fontWeight:700, color:"#222", margin:"0 0 14px" }}>作業動画</h3>}
      <div style={{ position:"relative", width:"100%", height: compact ? "100%" : "auto", aspectRatio: compact ? "auto" : "16 / 9", overflow:"hidden", borderRadius: compact ? 0 : 12, background:"#000" }}>
        <iframe title="作業動画" src={youtubeEmbedUrl(id, { muted: true })} loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", border:0 }} />
      </div>
    </div>
  );
}

''' + s[end:]
panel.write_text(s)

fixture = Path('scripts/fixtures/job-video')
fixture.mkdir(parents=True, exist_ok=True)
(fixture / 'entry.jsx').write_text(r'''import { createRoot } from 'react-dom/client';
import { JobCard } from '../../../src/components/JobCard';
const root = createRoot(document.getElementById('root'));
window.qaRender = jobs => root.render(<>{jobs.map(job => <JobCard key={job.id} job={job} variant="list" videoPreview={!job.noVideoPreview}
  saved={false} onToggleSave={() => { window.qaLikes++; }} onOpen={() => { window.qaOpened++; }} />)}</>);
window.qaRender(window.qaJobs);
''')
Path('scripts/job-video-facade.test.mjs').write_text(r'''import test from 'node:test';
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
''')

package = Path('package.json')
p = json.loads(package.read_text())
assert 'scripts/job-video-facade.test.mjs' not in p['scripts']['test:critical']
p['scripts']['test:critical'] += ' scripts/job-video-facade.test.mjs'
package.write_text(json.dumps(p, ensure_ascii=False, indent=2) + '\n')
print('Updated source and tests. No database, listing forms, or review inputs were changed.')
