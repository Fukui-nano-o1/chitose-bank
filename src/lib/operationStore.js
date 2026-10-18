// A read-write transaction serializes get-or-create across tabs as well as reloads.
// A failed durable write blocks the RPC, so there is always an ID to retry.
export function createOperationStore(dbName, indexed = globalThis.indexedDB) {
  const transact = (key, proposal, removeId, readOnly = false) => new Promise((resolve, reject) => {
    if (!indexed) { reject(Error('IndexedDB unavailable')); return; }
    const open = indexed.open(dbName, 1);
    let blocked = false;
    open.onupgradeneeded = () => open.result.createObjectStore('pending');
    open.onerror = () => reject(open.error);
    open.onblocked = () => { blocked = true; reject(Error('Operation storage blocked')); };
    open.onsuccess = () => {
      const db = open.result;
      if (blocked) { db.close(); return; }
      let result;
      let tx, store;
      try { tx = db.transaction('pending', readOnly ? 'readonly' : 'readwrite'); store = tx.objectStore('pending'); }
      catch (e) { db.close(); reject(e); return; }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || Error('Operation storage failed')); };
      const get = store.get(key);
      get.onsuccess = () => {
        result = get.result || null;
        if (readOnly) return;
        if (removeId) { if (result?.requestId === removeId) store.delete(key); }
        else if (!result) { result = proposal; store.add(proposal, key); }
      };
    };
  });
  return { read: key => transact(key, null, null, true), acquire: (key, proposal) => transact(key, proposal, null), clear: (key, id) => transact(key, null, id) };
}
