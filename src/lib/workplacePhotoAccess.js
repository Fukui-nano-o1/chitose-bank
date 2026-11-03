// Object identifiers only, never arbitrary URLs. Separate from all job/consignment media.
export const validWorkplacePhotoPath = path => typeof path === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.jpg$/.test(path);

export function createWorkplacePhotoReader(client, urlApi = URL) {
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
    async acquire(path) {
      if (!validWorkplacePhotoPath(path)) throw new Error('PHOTO_NOT_AVAILABLE');
      const session = await client.auth.getSession();
      const owner = session.data?.session?.user?.id || null;
      if (session.error) throw new Error('PHOTO_NOT_AUTHENTICATED');
      // Only Storage RLS can authorize a published independent workplace photo.
      if (account === undefined) account = owner;
      else if (account !== owner) { account = owner; clear(); }
      const current = generation;
      const key = `${owner}:workplace-photos/${path}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { count: 0, controller: new AbortController(), url: null };
        entries.set(key, entry);
        entry.promise = (async () => {
          const timer = setTimeout(() => entry.controller.abort(), 15000);
          try {
          const { data, error } = await client.storage.from('workplace-photos').download(
            path, {}, { cache: 'no-store', signal: entry.controller.signal });
          const after = await client.auth.getSession();
          if (error || !data || after.error || (after.data?.session?.user?.id || null) !== owner || generation !== current || entry.controller.signal.aborted) {
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
