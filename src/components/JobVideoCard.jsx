import { useEffect, useId, useRef, useState } from 'react';
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
