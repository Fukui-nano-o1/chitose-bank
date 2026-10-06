from pathlib import Path

def replace(p, a, b):
    s = p.read_text()
    assert s.count(a) == 1, (str(p), a[:120], s.count(a))
    p.write_text(s.replace(a, b))

p = Path('src/components/JobCard.jsx')
replace(p, 'import { JobVideoCard } from "./JobVideoCard";', 'import { JobVideoCard, JobVideoCardMedia } from "./JobVideoCard";')
replace(p, '  const videoId = youtubeVideoId(props.job?.workVideoUrl);', '  const videoId = youtubeVideoId(props.job?.workVideoUrl);\n  // Search keeps the same photo/summary card as related jobs, with video below it.\n  const videoBelow = props.videoPlacement === "below" && !!videoId;\n  const galleryVideoId = videoBelow ? "" : videoId;')
replace(p, '''  // Every variant shares the same carousel. A single photo needs no empty extra slides.
  if (videoId || images.length > 1) return <JobVideoCard key={JSON.stringify([props.job.id, videoId, images.map(photoThumb)])}
    {...props} videoId={videoId} height={JOB_CARD_PHOTO_H} cardStyle={cardStyle}
    summary={<StaticJobCard {...props} hideMedia />} />;
  return <StaticJobCard {...props} />;''', '''  // Reuse the existing card and its real job object, including save/open actions.
  const nestedStyle = videoBelow ? { ...cardStyle, width:"100%", maxWidth:"none", marginBottom:0 } : cardStyle;
  const card = galleryVideoId || images.length > 1
    ? <JobVideoCard key={JSON.stringify([props.job.id, galleryVideoId, images.map(photoThumb)])}
        {...props} videoId={galleryVideoId} height={JOB_CARD_PHOTO_H} cardStyle={nestedStyle}
        summary={<StaticJobCard {...props} hideMedia />} />
    : <StaticJobCard {...props} attachedVideo={videoBelow} />;
  if (!videoBelow) return card;
  return <div className="job-card-with-video" style={{ ...cardStyle, minWidth:0 }}>
    {card}
    <div className="job-card-video-below" style={{ marginTop:12 }}>
      <JobVideoCardMedia key={`${props.job.id}:${videoId}`} videoId={videoId}
        title={`${props.job.crop} ${props.job.task}`} standalone />
    </div>
  </div>;''')
replace(p, 'priority = false, hideMedia = false }) {', 'priority = false, hideMedia = false, attachedVideo = false }) {')
replace(p, 'style={hideMedia ? { ...cardStyle, width:"100%", maxWidth:"none", marginBottom:0 } : cardStyle}', 'style={hideMedia || attachedVideo ? { ...cardStyle, width:"100%", maxWidth:"none", marginBottom:0 } : cardStyle}')
p = Path('src/components/JobVideoCard.jsx')
replace(p, "height = 220, priority = false, href, onOpen }) {", "height = 220, priority = false, href, onOpen, standalone = false }) {")
replace(p, '  const count = images.length + (hasVideo ? 1 : 0);', '  const count = images.length + (hasVideo ? 1 : 0);\n  // A standalone player is responsive, with the YouTube minimum control height.\n  const standaloneVideo = standalone && hasVideo && images.length === 0;')
replace(p, "aria-label={hasVideo ? 'YouTubeと求人写真' : '求人写真'}", "aria-label={hasVideo ? (images.length ? 'YouTubeと求人写真' : 'YouTube作業動画') : '求人写真'}")
replace(p, "minWidth: 0, height, overflowX: 'auto'", "minWidth: 0, height: standaloneVideo ? 'auto' : height, aspectRatio: standaloneVideo ? '16 / 9' : undefined, minHeight: standaloneVideo ? 200 : undefined, overflowX: 'auto'")
replace(p, "minWidth: 0, height, scrollSnapAlign: 'start', background: '#111'", "minWidth: 0, height: standaloneVideo ? 'auto' : height, scrollSnapAlign: 'start', background: '#111'")
replace(p, "style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />", "style={{ display: 'block', position: standaloneVideo ? 'absolute' : undefined, inset: standaloneVideo ? 0 : undefined, width: '100%', height: '100%', border: 0 }} />")
replace(p, "style={{ display: 'block', position: 'relative', width: '100%', height: '100%', padding: 0, border: 0, color: '#fff'", "style={{ display: 'block', position: standaloneVideo ? 'absolute' : 'relative', inset: standaloneVideo ? 0 : undefined, width: '100%', height: '100%', padding: 0, border: 0, color: '#fff'")
p = Path('src/components/JobSearchMapView.jsx')
replace(p, 'variant="list" priority={index === 0} saved=', 'variant="list" priority={index === 0} videoPlacement="below" saved=')
p = Path('scripts/fixtures/job-video/entry.jsx')
replace(p, '  saved={false} onToggleSave=', '  videoPlacement={job.videoPlacement} priority={job.priority} views={job.views} saved={false} onToggleSave=')
p = Path('scripts/job-video-facade.test.mjs')
replace(p, "    assert.equal(w.qaCalls.length,0);\n\n  } finally", "    assert.equal(w.qaCalls.length,0);\n\n" + Path('scripts/search-card-video-assertions.txt').read_text() + "\n  } finally")
Path('scripts/search-card-video-assertions.txt').unlink()
print('Applied search-only photo/summary card with separate optional video. Related/detail, data and authentication unchanged.')
