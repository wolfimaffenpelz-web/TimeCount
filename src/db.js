import { defaults, validate } from "./core.js";
const COLLECTIONS = [
  "schedules",
  "sessions",
  "breaks",
  "absences",
  "overrides",
  "adjustments",
];
const STORES = ["meta", ...COLLECTIONS];
let connection;
export function openDB() {
  if (connection) return Promise.resolve(connection);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("timecount", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("meta", { keyPath: "id" });
      for (const name of COLLECTIONS) {
        const store = db.createObjectStore(name, { keyPath: "id" });
        store.createIndex(
          name === "schedules"
            ? "from"
            : name === "breaks"
              ? "sessionId"
              : "date",
          name === "schedules"
            ? "from"
            : name === "breaks"
              ? "sessionId"
              : "date",
          {
            unique:
              name === "absences" ||
              name === "overrides" ||
              name === "schedules",
          },
        );
      }
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(
        Error(
          "Datenbank-Update blockiert. Bitte andere TimeCount-Tabs schließen.",
        ),
      );
    req.onsuccess = () => {
      connection = req.result;
      connection.onversionchange = () => {
        connection.close();
        connection = null;
      };
      resolve(connection);
    };
  });
}
function transaction(db, mode, change, expected) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, mode),
      loaded = {};
    let result, error;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(
        error ||
          tx.error ||
          Error(
            "Speichern abgebrochen. Es wurden keine Änderungen übernommen.",
          ),
      );
    tx.onerror = () => {};
    let remaining = STORES.length;
    for (const name of STORES) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => {
        loaded[name] = req.result;
        if (--remaining) return;
        try {
          const meta = loaded.meta.find((x) => x.id === "state");
          const revision = meta?.revision ?? 0;
          const data = meta
            ? {
                schemaVersion: 1,
                settings: meta.settings,
                initial: meta.initial,
                ...Object.fromEntries(COLLECTIONS.map((k) => [k, loaded[k]])),
              }
            : defaults();
          validate(data);
          if (change) {
            if (expected !== undefined && expected !== revision)
              throw Error(
                "Die Daten wurden in einem anderen Tab geändert. Ansicht wurde aktualisiert; bitte erneut bearbeiten.",
              );
            const changed = change(structuredClone(data));
            if (changed && typeof changed.then === "function")
              throw Error("Asynchrone Datenänderung nicht zulässig.");
            validate(changed);
            for (const key of COLLECTIONS) {
              const store = tx.objectStore(key);
              store.clear();
              for (const row of changed[key]) store.put(row);
            }
            tx.objectStore("meta").put({
              id: "state",
              revision: revision + 1,
              settings: changed.settings,
              initial: changed.initial,
            });
            result = { data: changed, revision: revision + 1 };
          } else result = { data, revision };
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
    }
  });
}
export async function load() {
  const db = await openDB();
  const first = await transaction(db, "readonly");
  if (first.revision === 0) return transaction(db, "readwrite", (d) => d);
  return first;
}
export async function update(change, expected) {
  return transaction(await openDB(), "readwrite", change, expected);
}
