/**
 * TabManager: pure tab state. Knows nothing about the DOM or the runtime.
 * Emits 'change' whenever the list or active tab changes.
 */
let counter = 0;
const nextId = () => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const TAB_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
};

export function createTab(overrides = {}) {
  return {
    id: nextId(),
    title: 'New tab',
    url: '',
    status: TAB_STATUS.IDLE,
    error: '',
    pinned: false,
    // Logical history; '' is the Cosmic new-tab page, which every tab starts on.
    history: [''],
    historyIndex: 0,
    ...overrides,
  };
}

export function createTabManager() {
  const tabs = [];
  let activeId = null;
  const listeners = new Set();

  const notify = () => listeners.forEach((fn) => fn(api));

  const api = {
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    list: () => tabs.slice(),
    get: (id) => tabs.find((t) => t.id === id) || null,
    active: () => api.get(activeId),
    activeId: () => activeId,
    count: () => tabs.length,

    add(overrides = {}, { activate = true } = {}) {
      const tab = createTab(overrides);
      const lastPinned = tabs.reduce((idx, t, i) => (t.pinned ? i : idx), -1);
      if (tab.pinned) tabs.splice(lastPinned + 1, 0, tab);
      else tabs.push(tab);
      if (activate || tabs.length === 1) activeId = tab.id;
      notify();
      return tab;
    },

    activate(id) {
      if (!api.get(id) || id === activeId) return;
      activeId = id;
      notify();
    },

    update(id, patch) {
      const tab = api.get(id);
      if (!tab) return null;
      Object.assign(tab, patch);
      notify();
      return tab;
    },

    /**
     * Remove a tab. When the active tab is closed the tab to its right is
     * selected, falling back to the left neighbour. Closing the last tab
     * leaves a fresh empty tab so the workspace is never empty.
     */
    close(id) {
      const index = tabs.findIndex((t) => t.id === id);
      if (index === -1) return null;
      const [removed] = tabs.splice(index, 1);
      if (tabs.length === 0) {
        const fresh = createTab();
        tabs.push(fresh);
        activeId = fresh.id;
      } else if (activeId === id) {
        const neighbour = tabs[index] || tabs[index - 1];
        activeId = neighbour.id;
      }
      notify();
      return removed;
    },

    move(id, toIndex) {
      const from = tabs.findIndex((t) => t.id === id);
      if (from === -1) return;
      const [tab] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
      notify();
    },

    togglePinned(id) {
      const tab = api.get(id);
      if (!tab) return;
      tab.pinned = !tab.pinned;
      const others = tabs.filter((t) => t.id !== id);
      const lastPinned = others.reduce((idx, t, i) => (t.pinned ? i : idx), -1);
      tabs.length = 0;
      others.splice(tab.pinned ? lastPinned + 1 : others.length, 0, tab);
      tabs.push(...others);
      notify();
    },
  };

  return api;
}
