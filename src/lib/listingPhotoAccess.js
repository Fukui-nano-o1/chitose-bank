// Persisted public URLs remain stable object identifiers. They are never used
// as image requests for these private buckets, and credentials stay in Storage.
export function listingPhotoReference(source, projectUrl) {
  if (!source || !projectUrl) return null;
  let url, base;
  try { url = new URL(source); base = new URL(projectUrl); } catch { return null; }
  if (url.origin !== base.origin) return null;
  const match = url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|authenticated|sign)\/(job-photos|consignment-photos)\/(.+)$/);
  if (!match) return null;
  let path;
  try { path = decodeURIComponent(match[2]); } catch { return { blocked: true }; }
  if (path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\\') || [...path].some(c => c.charCodeAt(0) < 32)) return { blocked: true };
  return { bucket: match[1], path };
}

// Deduplicate simultaneous renders only. Nothing is kept in localStorage,
// Cache Storage or a signed bearer URL; the last unmount revokes the blob URL.
export function createListingPhotoReader(client, urlApi = URL) {
  const entries = new Map(), listeners = new Set();
  let generation = 0, account;
  function clear() {
    generation++;
    for (const entry of entries.values()) {
      entry.controller.abort();
      if (entry.url) urlApi.revokeObjectURL(entry.url);
    }
    entries.clear();
    for (const listener of listeners) listener();
  }
  client.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id || null;
    if (account === undefined) account = next;
    else if (account !== next) { account = next; clear(); }
  });
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async acquire(reference) {
      if (!reference || reference.blocked) throw new Error('PHOTO_NOT_AVAILABLE');
      const session = await client.auth.getSession();
      const owner = session.data?.session?.user?.id;
      if (session.error || !owner) throw new Error('PHOTO_NOT_AUTHENTICATED');
      if (account === undefined) account = owner;
      else if (account !== owner) { account = owner; clear(); }
      const current = generation;
      const key = `${owner}:${reference.bucket}/${reference.path}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { count: 0, controller: new AbortController(), url: null };
        entries.set(key, entry);
        entry.promise = (async () => {
          const timer = setTimeout(() => entry.controller.abort(), 15000);
          try {
          const { data, error } = await client.storage.from(reference.bucket).download(
            reference.path, {}, { cache: 'no-store', signal: entry.controller.signal });
          const after = await client.auth.getSession();
          if (error || !data || after.error || after.data?.session?.user?.id !== owner || generation !== current || entry.controller.signal.aborted) {
            throw new Error('PHOTO_NOT_AVAILABLE');
          }
          entry.url = urlApi.createObjectURL(data);
          return entry.url;
          } finally { clearTimeout(timer); }
        })();
      }
      entry.count++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (--entry.count === 0) {
          entry.controller.abort();
          if (entry.url) urlApi.revokeObjectURL(entry.url);
          if (entries.get(key) === entry) entries.delete(key);
        }
      };
      try { return { url: await entry.promise, release }; }
      catch (error) { release(); throw error; }
    },
  };
}
