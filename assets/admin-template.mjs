function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('finen-ficha-maestra', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('plantillas');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function localMaster(bytes) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const write = bytes !== undefined;
      const tx = db.transaction('plantillas', write ? 'readwrite' : 'readonly');
      const table = tx.objectStore('plantillas');
      const request = write ? table.put(bytes, 'maestra') : table.get('maestra');
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
