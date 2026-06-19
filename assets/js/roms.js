(function (window) {
  "use strict";

  // Memorise la ROM fournie par le joueur dans IndexedDB (16 Mo, hors localStorage).
  // Une seule ROM (la derniere deposee). Rien n'est heberge cote serveur.

  var DB = "valdoria", STORE = "roms", KEY = "rom", VERSION = 1;

  function open() {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open(DB, VERSION);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  }

  function put(buffer) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(buffer, KEY);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function get() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var rq = tx.objectStore(STORE).get(KEY);
        rq.onsuccess = function () { db.close(); resolve(rq.result || null); };
        rq.onerror = function () { db.close(); reject(rq.error); };
      });
    });
  }

  function has() {
    return get().then(function (b) { return !!b; }).catch(function () { return false; });
  }

  window.Valdoria.roms = { put: put, get: get, has: has };
})(window);
