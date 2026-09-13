import { storage } from './storage.js';

/** Persisted user data: shortcuts, saved pages, history and settings. */
const KEYS = {
  shortcuts: 'cosmicShortcuts',
  saved: 'cosmicFavorites',
  history: 'cosmicHistory',
  settings: 'cosmicSettings',
};

const HISTORY_LIMIT = 200;

export const DEFAULT_SHORTCUTS = [
  { name: 'YouTube', url: 'https://www.youtube.com', icon: '▶', description: 'Video' },
  { name: 'GitHub', url: 'https://github.com', icon: '◈', description: 'Code' },
  { name: 'Wikipedia', url: 'https://www.wikipedia.org', icon: 'W', description: 'Reference' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com', icon: '⌕', description: 'Search' },
  { name: 'Reddit', url: 'https://www.reddit.com', icon: '◉', description: 'Community' },
  { name: 'Discord', url: 'https://discord.com/app', icon: '◍', description: 'Chat' },
];

export const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark' | 'light'
  sidebar: 'expanded', // 'expanded' | 'compact'
  startup: 'cosmic', // 'cosmic' | 'blank'
  clock: true,
  engine: 'duckduckgo', // key of SEARCH_ENGINES in navigation.js
  runtime: 'iframe', // 'iframe' | 'ultraviolet' | 'scramjet'
  wisp: '', // empty = the Wisp endpoint served next to this page
};

function createCollection(key, fallback) {
  let items = storage.get(key, null);
  if (!Array.isArray(items)) items = fallback.slice();
  const listeners = new Set();
  const commit = () => {
    storage.set(key, items);
    listeners.forEach((fn) => fn(items));
  };
  return {
    all: () => items.slice(),
    onChange(fn) {
      listeners.add(fn);
    },
    set(next) {
      items = next;
      commit();
    },
    commit,
    get items() {
      return items;
    },
  };
}

export function createStore() {
  const shortcuts = createCollection(KEYS.shortcuts, DEFAULT_SHORTCUTS);
  const saved = createCollection(KEYS.saved, []);
  const history = createCollection(KEYS.history, []);

  const settingsListeners = new Set();
  let settings = { ...DEFAULT_SETTINGS, ...(storage.get(KEYS.settings, null) || {}) };
  const commitSettings = () => {
    storage.set(KEYS.settings, settings);
    settingsListeners.forEach((fn) => fn(settings));
  };
  // Migrate the legacy single 'cosmicHome' key from earlier versions.
  const legacyHome = storage.get('cosmicHome', null);
  if (legacyHome && !storage.get(KEYS.settings, null)) {
    settings.startup = legacyHome === 'blank' ? 'blank' : 'cosmic';
    storage.remove('cosmicHome');
  }

  return {
    shortcuts: {
      all: shortcuts.all,
      onChange: shortcuts.onChange,
      add(item) {
        shortcuts.set([...shortcuts.items, { icon: '✦', ...item }]);
      },
      remove(index) {
        shortcuts.set(shortcuts.items.filter((_, i) => i !== index));
      },
      move(from, to) {
        const next = shortcuts.items.slice();
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        shortcuts.set(next);
      },
      reset() {
        shortcuts.set(DEFAULT_SHORTCUTS.slice());
      },
    },
    saved: {
      all: saved.all,
      onChange: saved.onChange,
      has: (url) => saved.items.some((s) => s.url === url),
      toggle(page) {
        if (saved.items.some((s) => s.url === page.url)) {
          saved.set(saved.items.filter((s) => s.url !== page.url));
          return false;
        }
        saved.set([{ time: Date.now(), ...page }, ...saved.items]);
        return true;
      },
      remove(url) {
        saved.set(saved.items.filter((s) => s.url !== url));
      },
      clear() {
        saved.set([]);
      },
    },
    history: {
      all: history.all,
      onChange: history.onChange,
      add(entry) {
        const next = history.items.filter((h) => h.url !== entry.url);
        next.unshift(entry);
        history.set(next.slice(0, HISTORY_LIMIT));
      },
      updateTitle(url, title) {
        const hit = history.items.find((h) => h.url === url);
        if (hit && hit.title !== title) {
          hit.title = title;
          history.commit();
        }
      },
      remove(url) {
        history.set(history.items.filter((h) => h.url !== url));
      },
      clear() {
        history.set([]);
      },
    },
    settings: {
      get: () => ({ ...settings }),
      onChange(fn) {
        settingsListeners.add(fn);
      },
      set(patch) {
        settings = { ...settings, ...patch };
        commitSettings();
      },
      reset() {
        settings = { ...DEFAULT_SETTINGS };
        commitSettings();
      },
    },
  };
}
