/**
 * Safe localStorage wrapper. Falls back to an in-memory map when storage is
 * unavailable (private mode, disabled storage, quota errors) and reports the
 * failure once through `onUnavailable` so the UI can warn the user.
 */
const memory = new Map();
let available = null;
let warned = false;
let onUnavailable = () => {};

function probe() {
  if (available !== null) return available;
  try {
    const key = '__cosmic_probe__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

function warn(reason) {
  if (warned) return;
  warned = true;
  onUnavailable(reason);
}

export const storage = {
  setUnavailableHandler(fn) {
    onUnavailable = fn;
  },
  isAvailable: () => probe(),
  get(key, fallback) {
    try {
      const raw = probe() ? window.localStorage.getItem(key) : memory.get(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    if (!probe()) {
      memory.set(key, raw);
      warn('Local storage is unavailable. Changes will be lost when you leave.');
      return false;
    }
    try {
      window.localStorage.setItem(key, raw);
      return true;
    } catch {
      memory.set(key, raw);
      warn('Local storage is full or blocked. Changes may not persist.');
      return false;
    }
  },
  remove(key) {
    memory.delete(key);
    try {
      if (probe()) window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
