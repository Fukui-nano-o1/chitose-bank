// Only known YouTube video URLs are accepted. Never use user-provided HTML as an embed.
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
