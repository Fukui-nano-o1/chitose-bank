from pathlib import Path
p = Path('src/features/jobs/search/components/JobDetailPanel.jsx')
s = p.read_text()
assert 'import "./jobWorkVideo.css";' not in s
s = 'import "./jobWorkVideo.css";\n' + s
start = s.index('export function JobWorkVideo(')
end = s.index('export function JobThingsToKnow(', start)
video = s[start:end]
a = '<div style={{ margin: compact ? 0 : "0 0 28px", width:"100%", height: compact ? "100%" : "auto" }}>'
b = '<div className={compact ? "job-work-video job-work-video--gallery" : "job-work-video"} style={{ margin: compact ? 0 : "0 0 28px", width:"100%", height: compact ? "100%" : "auto" }}>'
assert video.count(a) == 1
video = video.replace(a, b)
a = '<div style={{ position:"relative", width:"100%", height: compact ? "100%" : "auto", aspectRatio: compact ? "auto" : "16 / 9", overflow:"hidden", borderRadius: compact ? 0 : 12, background:"#000" }}>'
b = '<div className="job-work-video-frame" style={{ position:"relative", width:"100%", height:"auto", aspectRatio:"16 / 9", overflow:"hidden", borderRadius: compact ? 0 : 12, background:"#000" }}>'
assert video.count(a) == 1
video = video.replace(a, b)
s = s[:start] + video + s[end:]
a = '<div className="job-photo-carousel" style={{ position:"relative" }}>'
b = '<div className={hasVideo ? "job-photo-carousel job-photo-carousel--has-video" : "job-photo-carousel"} style={{ position:"relative" }}>'
assert s.count(a) == 1
s = s.replace(a, b)
a = '<div className="job-photo-slide" style={{ position:"relative", flexShrink:0, width:"100%", height:392, background:"#000", scrollSnapAlign:"start", overflow:"hidden" }}>'
b = '<div className="job-photo-slide job-work-video-slide" style={{ position:"relative", flexShrink:0, width:"100%", height:392, background:"#000", scrollSnapAlign:"start", overflow:"hidden" }}>'
assert s.count(a) == 1
s = s.replace(a, b)
a = 'stretchTargetRef.current = () => stretch ? ((scrollerRef && scrollerRef.current) || fallbackRef.current) : null;'
b = '// A player must not be enlarged into the status/navigation area by photo pull-to-stretch.\n  stretchTargetRef.current = () => stretch && !youtubeVideoId(job?.workVideoUrl) ? ((scrollerRef && scrollerRef.current) || fallbackRef.current) : null;'
assert s.count(a) == 1
s = s.replace(a, b)
p.write_text(s)
print('Scoped detail/review video safe-area fix applied. Search cards, photos, DB and listing inputs unchanged.')
