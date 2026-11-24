function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('finen-ficha-maestra', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('plantillas')) db.createObjectStore('plantillas');
      if (!db.objectStoreNames.contains('copias')) db.createObjectStore('copias');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function localFile(store, key, bytes) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const write = bytes !== undefined;
      const tx = db.transaction(store, write ? 'readwrite' : 'readonly');
      const table = tx.objectStore(store);
      const request = write ? table.put(bytes, key) : table.get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const localMaster = bytes => localFile('plantillas', 'maestra', bytes);
export const localCopy = (folio, token, bytes) => localFile('copias', folio + ':' + token, bytes);
