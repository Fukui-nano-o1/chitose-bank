import { useEffect, useState } from 'react';
import { createWorkplacePhotoReader, validWorkplacePhotoPath } from '../lib/workplacePhotoAccess.js';
let readerPromise;
const getReader = () => readerPromise ||= import('../lib/supabase').then(({ supabase }) => createWorkplacePhotoReader(supabase));

// Deliberately no src/public-URL fallback: an unconfigured or denied bucket is blank.
export function WorkplacePhoto({ path, alt = '職場で働く様子', ...props }) {
  const [image, setImage] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!validWorkplacePhotoPath(path)) return;
    let active = true, lease, unsubscribe;
    (async () => {
      try {
        const reader = await getReader();
        if (!active) return;
        unsubscribe = reader.subscribe(() => { if (active) { setImage(null); setRevision(n => n + 1); } });
        const result = await reader.acquire(path);
        if (!active) { result.release(); return; }
        lease = result;
        setImage({ path, revision, url: result.url });
      } catch { if (active) setImage({ path, revision, failed: true }); }
    })();
    return () => { active = false; unsubscribe?.(); lease?.release(); };
  }, [path, revision]);
  const current = image?.path === path && image.revision === revision ? image : null;
  return <img {...props} alt={alt} src={current?.url}
    data-workplace-photo={current?.url ? 'ready' : (!validWorkplacePhotoPath(path) || current?.failed) ? 'unavailable' : 'loading'} />;
}
