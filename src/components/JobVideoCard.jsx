import { useEffect, useId, useRef, useState } from 'react';
import { photoThumb } from '../lib/utils';
import { youtubeEmbedUrl } from '../lib/youtube';
import { NavIcon } from './NavIcons';

const PLAY_EVENT = 'cb:job-card-video-play';
const controlStyle = { border: '1px solid #ddd', borderRadius: 8, background: '#fff', color: '#222', minWidth: 44, minHeight: 44, font: 'inherit', fontSize: 13, padding: '8px 12px', cursor: 'pointer' };
const stopPropagation = event => event.stopPropagation();

// Shared by all JobCard variants, including jobs without a video.
// The poster replaces the iframe until an explicit play action (web.dev click-to-load).
export function JobVideoCardMedia({ videoId = '', photos = [], title, height = 220, priority = false, href, onOpen, standalone = false }) {
  const instance = useId();
  const scroller = useRef(null);
  const root = useRef(null);
  const gesture = useRef(null);
  const suppressClickUntil = useRef(0);
  const currentIndex = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState(0);
  const [posterFailed, setPosterFailed] = useState(false);
  const images = (Array.isArray(photos) ? photos : []).filter(photo => photoThumb(photo));
  const hasVideo = !!videoId;
  const count = images.length + (hasVideo ? 1 : 0);
  // A standalone player is responsive, with the YouTube minimum control height.
  const standaloneVideo = standalone && hasVideo && images.length === 0;

  useEffect(() => {
    if (!hasVideo) return;
    const stop = () => setPlaying(false);
    const otherStarted = event => { if (event.detail !== instance) stop(); };
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener(PLAY_EVENT, otherStarted);
    window.addEventListener('hashchange', stop);
    document.addEventListener('visibilitychange', hidden);
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
  }, [hasVideo, instance]);

  // Rotation/resizing keeps the selected media aligned rather than showing two halves.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => { el.scrollLeft = currentIndex.current * el.clientWidth; });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startGesture = event => {
    event.stopPropagation();
    const point = event.touches?.[0] || event;
    gesture.current = { x: point.clientX, y: point.clientY, moved: false };
    suppressClickUntil.current = 0;
  };
  const trackGesture = event => {
    if (!gesture.current) return;
    const point = event.touches?.[0] || event;
    const dx = Math.abs(point.clientX - gesture.current.x);
    const dy = Math.abs(point.clientY - gesture.current.y);
    if (Math.max(dx, dy) > 8) {
      gesture.current.moved = true;
      suppressClickUntil.current = Date.now() + 500;
    }
    if (dx > dy) event.stopPropagation();
  };
  const endGesture = event => {
    event.stopPropagation();
    if (gesture.current?.moved) suppressClickUntil.current = Date.now() + 500;
    gesture.current = null;
  };
  const guardClick = event => {
    if (Date.now() < suppressClickUntil.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntil.current = 0;
    }
  };
  const start = event => {
    event.preventDefault(); event.stopPropagation();
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: instance }));
    setPlaying(true);
  };
  const move = (index, event) => {
    event?.preventDefault(); event?.stopPropagation();
    const next = Math.max(0, Math.min(index, count - 1));
    if (!hasVideo || next !== 0) setPlaying(false);
    currentIndex.current = next;
    setActive(next);
    const el = scroller.current;
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: 'auto' });
  };
  const onScroll = event => {
    const el = event.currentTarget;
    if (!el.clientWidth) return;
    const index = Math.max(0, Math.min(Math.round(el.scrollLeft / el.clientWidth), count - 1));
    currentIndex.current = index;
    setActive(index);
    if (!hasVideo || index !== 0) setPlaying(false);
  };
  const photoOpen = event => {
    event.stopPropagation();
    if (onOpen) { event.preventDefault(); onOpen(); }
  };
  const mediaLabel = hasVideo && active === 0 ? 'YouTube' : `写真${active + 1 - (hasVideo ? 1 : 0)}`;

  return <div ref={root} className="job-card-video-media">
    <div ref={scroller} onScroll={onScroll} className="carousel-scroll job-card-media-scroll"
      role="region" tabIndex={count > 1 ? 0 : -1} aria-roledescription="カルーセル"
      aria-label={hasVideo ? (images.length ? 'YouTubeと求人写真' : 'YouTube作業動画') : '求人写真'}
      onPointerDown={startGesture} onPointerMove={trackGesture} onPointerUp={endGesture} onPointerCancel={endGesture}
      onTouchStart={startGesture} onTouchMove={trackGesture} onTouchEnd={endGesture} onTouchCancel={endGesture}
      onClickCapture={guardClick}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight') move(active + 1, event);
        if (event.key === 'ArrowLeft') move(active - 1, event);
      }}
      style={{ display: 'flex', width: '100%', minWidth: 0, height: standaloneVideo ? 'auto' : height, aspectRatio: standaloneVideo ? '16 / 9' : undefined, minHeight: standaloneVideo ? 200 : undefined, overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', overscrollBehaviorX: 'contain', touchAction: 'pan-x pan-y pinch-zoom', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', borderRadius: 16 }}>
      {hasVideo && <div data-media-type="youtube" style={{ flex: '0 0 100%', minWidth: 0, height: standaloneVideo ? 'auto' : height, scrollSnapAlign: 'start', background: '#111', position: 'relative' }}>
        {playing && active === 0 ? <iframe
          title={`作業動画：${title}`} src={youtubeEmbedUrl(videoId)}
          allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={event => event.currentTarget.focus({ preventScroll: true })}
          style={{ display: 'block', position: standaloneVideo ? 'absolute' : undefined, inset: standaloneVideo ? 0 : undefined, width: '100%', height: '100%', border: 0 }} />
          : <button type="button" className="job-video-facade" onClick={start} aria-label="作業動画を再生"
            style={{ display: 'block', position: standaloneVideo ? 'absolute' : 'relative', inset: standaloneVideo ? 0 : undefined, width: '100%', height: '100%', padding: 0, border: 0, color: '#fff', background: '#222', cursor: 'pointer' }}>
            {!posterFailed && <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt={`${title}の作業動画`}
              draggable={false} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined}
              onError={() => setPosterFailed(true)}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />}
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span className="f-sans" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,.76)', color: '#fff', padding: '12px 18px', borderRadius: 24, fontSize: 14, fontWeight: 700 }}>
                <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M2 1 L15 9 L2 17 Z" fill="currentColor" /></svg>
                作業動画を見る
              </span>
            </span>
          </button>}
      </div>}
      {images.map((photo, index) => <a key={index} data-media-type="photo" className="job-card-photo-link"
        href={href} target={onOpen ? undefined : '_blank'} rel="noopener noreferrer" onClick={photoOpen}
        aria-label={`求人を開く：${title}（写真${index + 1}）`}
        tabIndex={active === index + (hasVideo ? 1 : 0) ? 0 : -1}
        draggable={false}
        style={{ display: 'block', flex: '0 0 100%', minWidth: 0, height, scrollSnapAlign: 'start', background: '#f7f7f7' }}>
        <img src={photoThumb(photo)} alt={typeof photo === 'string' ? `求人写真 ${index + 1}` : photo.caption || `求人写真 ${index + 1}`}
          draggable={false} loading={!hasVideo && index === 0 && priority ? 'eager' : 'lazy'}
          fetchPriority={!hasVideo && index === 0 && priority ? 'high' : undefined}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
      </a>)}
    </div>
    {/* Controls never cover the YouTube player. Both media types remain discoverable. */}
    {hasVideo && images.length > 0 && <div className="job-card-media-types" style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      <button type="button" onClick={event => move(0, event)} aria-pressed={active === 0}
        style={{ ...controlStyle, flex: 1, background: active === 0 ? '#f1f5f3' : '#fff' }}>YouTube</button>
      <button type="button" onClick={event => move(active > 0 ? active : 1, event)} aria-pressed={active > 0}
        style={{ ...controlStyle, flex: 1, background: active > 0 ? '#f1f5f3' : '#fff' }}>写真（{images.length}枚）</button>
    </div>}
    {(count > 1 || hasVideo) && <div className="f-sans job-card-media-controls" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6, minHeight: 44 }}>
      {count > 1 && <>
        <button type="button" onClick={event => move(active - 1, event)} disabled={active === 0} aria-label="前の画像・動画" style={{ ...controlStyle, opacity: active === 0 ? .4 : 1 }}>‹</button>
        <span aria-live="polite" style={{ color: '#717171', fontSize: 12 }}>{mediaLabel} · {active + 1}/{count}</span>
        <button type="button" onClick={event => move(active + 1, event)} disabled={active === count - 1} aria-label="次の画像・動画" style={{ ...controlStyle, opacity: active === count - 1 ? .4 : 1 }}>›</button>
      </>}
      {hasVideo && <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer" onClick={stopPropagation}
        style={{ marginLeft: 'auto', color: '#717171', fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3, padding: '10px 0' }}>YouTubeで開く</a>}
    </div>}
  </div>;
}

// All variants retain their original outer width and the existing summary/link rendering.
export function JobVideoCard({ job, videoId = '', saved, onToggleSave, onOpen, views, priority, summary, height = 220, hideEndLabel, cardStyle, videoPlacement }) {
  const ended = job.filled || job.expired || job.closed;
  const endLabel = job.filled ? (job.closed || job.expired ? '掲載終了（満員）' : '募集終了（満員）') : job.closed ? '募集終了' : '募集期間終了';
  return <article data-guide="job-card" className={`job-media-card${videoId ? ' job-video-card' : ' job-photo-card'}${videoPlacement === 'below' && !videoId ? ' job-card-photo-summary' : ''}`}
    style={{ ...cardStyle, minWidth: 0, textAlign: 'left', cursor: 'default' }}>
    <div className="f-sans job-card-media-header" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 44, marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: '#717171' }}>{videoId ? '作業動画' : '求人写真'}</span>
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
    <JobVideoCardMedia videoId={videoId} photos={job.photos} title={`${job.crop} ${job.task}`} height={height} priority={priority}
      href={`#/work/job/${job.id}`} onOpen={onOpen} />
    {summary}
  </article>;
}
