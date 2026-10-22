import { useEffect, useRef, useState } from 'react';
import { createListingPhotoReader, listingPhotoReference } from '../lib/listingPhotoAccess.js';

let readerPromise;
function getReader() {
  // Static images and external fixtures never initialize the Supabase client.
  readerPromise ||= import('../lib/supabase').then(({ supabase }) => createListingPhotoReader(supabase));
  return readerPromise;
}

export function ListingPhoto({ src, alt = '', ref: forwardedRef, loading, onError, ...props }) {
  const element = useRef(null);
  const [image, setImage] = useState(null);
  const [revision, setRevision] = useState(0);
  const reference = listingPhotoReference(src, import.meta.env.VITE_SUPABASE_URL);
  const protectedPhoto = !!reference;
  useEffect(() => {
    if (!protectedPhoto) return;
    let active = true, lease, unsubscribe, observer;
    const load = async () => {
      try {
        const reader = await getReader();
        if (!active) return;
        unsubscribe = reader.subscribe(() => {
          if (active) { setImage(null); setRevision(value => value + 1); }
        });
        const loaded = await reader.acquire(listingPhotoReference(src, import.meta.env.VITE_SUPABASE_URL));
        if (!active) { loaded.release(); return; }
        lease = loaded;
        setImage({ source: src, revision, url: loaded.url });
      } catch {
        if (active) setImage({ source: src, revision, failed: true });
      }
    };
    if (loading === 'lazy' && typeof IntersectionObserver !== 'undefined' && element.current) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
      }, { rootMargin: '240px' });
      observer.observe(element.current);
    } else { load(); }
    return () => { active = false; observer?.disconnect(); unsubscribe?.(); lease?.release(); };
  }, [src, protectedPhoto, revision, loading]);
  const current = image?.source === src && image?.revision === revision ? image : null;
  // A denied/expired session never falls back to the persisted public URL.
  return <img {...props} alt={alt} loading={loading} src={protectedPhoto ? current?.url : src}
    data-photo-access={protectedPhoto ? (current?.failed ? 'unavailable' : current?.url ? 'authenticated' : 'loading') : undefined}
    ref={node => { element.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }}
    onError={onError} />;
}
