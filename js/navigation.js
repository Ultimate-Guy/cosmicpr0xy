import { TAB_STATUS } from './tabs.js';

const SEARCH_URL = 'https://duckduckgo.com/?q=';
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const HOSTNAME_RE = /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i;

/** Turn free text into a navigable URL, or a search URL when it is not one. Returns '' for empty input. */
export function resolveInput(raw) {
  const value = (raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (SCHEME_RE.test(value)) return /^(javascript|data|file):/i.test(value) ? '' : value;
  if (!/\s/.test(value) && HOSTNAME_RE.test(value)) return `https://${value}`;
  return SEARCH_URL + encodeURIComponent(value);
}

export function displayUrl(url) {
  return (url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * NavigationManager: connects tab state to the runtime. Maintains a per-tab
 * logical history stack so back/forward work even when the viewport cannot
 * expose its own history (cross-origin content).
 */
export function createNavigationManager({ tabs, runtime, onVisit }) {
  runtime.on('load', ({ tabId, url }) => {
    const tab = tabs.get(tabId);
    if (!tab || tab.url !== url) return;
    tabs.update(tabId, { status: TAB_STATUS.READY, error: '' });
  });

  runtime.on('error', ({ tabId, url, message }) => {
    const tab = tabs.get(tabId);
    if (!tab || tab.url !== url) return;
    tabs.update(tabId, { status: TAB_STATUS.ERROR, error: message });
  });

  runtime.on('title', ({ tabId, url, title }) => {
    const tab = tabs.get(tabId);
    if (!tab || tab.url !== url || !title) return;
    tabs.update(tabId, { title });
  });

  function load(tab, url) {
    runtime.open(tab.id);
    tabs.update(tab.id, { url, title: hostOf(url), status: TAB_STATUS.LOADING, error: '' });
    runtime.load(tab.id, url);
  }

  // The empty string is a history entry meaning "the Cosmic new-tab page".
  function showHome(tab) {
    tabs.update(tab.id, { url: '', title: 'New tab', status: TAB_STATUS.IDLE, error: '' });
  }

  function push(tab, entry) {
    const history = tab.history.slice(0, tab.historyIndex + 1);
    history.push(entry);
    tabs.update(tab.id, { history, historyIndex: history.length - 1 });
  }

  function goToIndex(tab, index) {
    tabs.update(tab.id, { historyIndex: index });
    const entry = tab.history[index];
    if (entry === '') showHome(tab);
    else load(tab, entry);
    return true;
  }

  const api = {
    /** Navigate the tab to raw user input. Returns false when input is empty/invalid. */
    go(tabId, raw) {
      const tab = tabs.get(tabId);
      const url = resolveInput(raw);
      if (!tab || !url) return false;
      push(tab, url);
      load(tab, url);
      onVisit?.({ url, title: hostOf(url), time: Date.now() });
      return true;
    },
    canGoBack: (tab) => !!tab && tab.historyIndex > 0,
    canGoForward: (tab) => !!tab && tab.historyIndex < tab.history.length - 1,
    back(tabId) {
      const tab = tabs.get(tabId);
      return api.canGoBack(tab) && goToIndex(tab, tab.historyIndex - 1);
    },
    forward(tabId) {
      const tab = tabs.get(tabId);
      return api.canGoForward(tab) && goToIndex(tab, tab.historyIndex + 1);
    },
    reload(tabId) {
      const tab = tabs.get(tabId);
      if (!tab?.url) return false;
      load(tab, tab.url);
      return true;
    },
    /** Return the tab to the Cosmic new-tab page, keeping its history so back still works. */
    home(tabId) {
      const tab = tabs.get(tabId);
      if (!tab) return;
      if (tab.history[tab.historyIndex] !== '') push(tab, '');
      showHome(tab);
    },
  };

  return api;
}
