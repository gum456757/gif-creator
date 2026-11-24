// Each completed edit writes one Blob and the active step in the same transaction.
const editorDraft = (() => {
  let connection, session;
  function open() {
    if (!session) {
      session = sessionStorage.getItem("gif-editor-session") || crypto.randomUUID();
      sessionStorage.setItem("gif-editor-session", session);
    }
    if (!connection) connection = new Promise((resolve,reject) => {
      const req = indexedDB.open("gif-editor-history",1);
      req.onupgradeneeded = () => req.result.createObjectStore("steps");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return connection;
  }
  const range = (from = -1) => IDBKeyRange.bound([session,from],[session,Number.MAX_SAFE_INTEGER]);
  async function read() {
    const db = await open();
    return new Promise((resolve,reject) => {
      const req = db.transaction("steps").objectStore("steps").getAll(range());
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function write(meta,step) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction("steps","readwrite");
      const store = tx.objectStore("steps");
      if (!meta) store.delete(range());
      else {
        if (step) {
          store.delete(range(meta.position));
          store.put(step,[session,meta.position]);
        }
        store.put(meta,[session,-1]);
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  }
  return {read,write};
})();
