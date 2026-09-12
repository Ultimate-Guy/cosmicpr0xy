import { storage } from './storage.js';
import { createStore } from './store.js';
import { createRuntime } from './runtime.js';
import { createTabManager, TAB_STATUS } from './tabs.js';
import { createNavigationManager, resolveInput, hostOf, displayUrl } from './navigation.js';
import { esc, formatTime, dayLabel, emptyState, appCard, listRow, tabButton } from './render.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const PANELS = ['home', 'apps', 'saved', 'history', 'settings'];
const HOME_RECENT_LIMIT = 6;
const HOME_SAVED_LIMIT = 6;
const HOME_SHORTCUT_LIMIT = 8;

// ---------------------------------------------------------------------------
// Core objects
// ---------------------------------------------------------------------------
const store = createStore();
const settings = store.settings;
const runtime = createRuntime(settings.get().runtime);
const tabs = createTabManager();
const nav = createNavigationManager({
  tabs,
  runtime,
  onVisit: (entry) => store.history.add(entry),
});

/** `view` is either 'tab' (show the active tab's content) or a sidebar panel name. */
let view = 'tab';
let toastTimer = null;

// ---------------------------------------------------------------------------
// Feedback helpers
// ---------------------------------------------------------------------------
function setStatus(text) {
  $('status').textContent = text;
}

function toast(text, { duration = 2600 } = {}) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), duration);
}

storage.setUnavailableHandler((reason) => {
  toast(reason, { duration: 6000 });
  $('storageState').textContent = 'Unavailable';
});

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------
function activeContentView() {
  const tab = tabs.active();
  return tab?.url ? 'page' : 'home';
}

function setView(next) {
  view = next;
  const shown = next === 'tab' ? activeContentView() : next;
  $$('.view').forEach((el) => (el.hidden = el.dataset.view !== shown));
  $$('.nav[data-view]').forEach((btn) => {
    const isActive = btn.dataset.view === shown;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  runtime.show(shown === 'page' ? tabs.activeId() : null);
  if (shown === 'home') renderHome();
  if (shown === 'page') renderPageState();
  if (shown === 'settings') renderSettings();
}

function showTab() {
  setView('tab');
}

// ---------------------------------------------------------------------------
// Rendering: tabs + toolbar
// ---------------------------------------------------------------------------
function renderTabs() {
  const list = tabs.list();
  const activeId = tabs.activeId();
  $('tabs').innerHTML = list.map((t) => tabButton(t, t.id === activeId)).join('');
  $('tabCount').textContent = `${list.length} tab${list.length === 1 ? '' : 's'}`;
  const activeEl = $('tabs').querySelector('.tab.active');
  activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderToolbar() {
  const tab = tabs.active();
  const addr = $('addressBar');
  if (document.activeElement !== addr) addr.value = tab?.url || '';
  $('backBtn').disabled = !nav.canGoBack(tab);
  $('forwardBtn').disabled = !nav.canGoForward(tab);
  $('reloadBtn').disabled = !tab?.url;
  $('openBtn').disabled = !tab?.url;
  $('favoriteBtn').disabled = !tab?.url;
  const saved = !!tab?.url && store.saved.has(tab.url);
  $('favoriteBtn').textContent = saved ? '★' : '☆';
  $('favoriteBtn').setAttribute('aria-pressed', String(saved));
  $('favoriteBtn').title = saved ? 'Remove from saved' : 'Save page';
  $('addressIcon').textContent = tab?.url?.startsWith('https://') ? '◈' : tab?.url ? '○' : '✦';
  $('progress').hidden = tab?.status !== TAB_STATUS.LOADING;
  $('clearBtn').hidden = !addr.value;
}

function renderPageState() {
  const tab = tabs.active();
  const loading = $('loading');
  const fallback = $('fallback');
  if (!tab?.url) {
    loading.hidden = true;
    fallback.hidden = true;
    setStatus('Ready');
    return;
  }
  loading.hidden = tab.status !== TAB_STATUS.LOADING;
  $('loadingText').textContent = displayUrl(tab.url);
  fallback.hidden = tab.status !== TAB_STATUS.ERROR;
  if (tab.status === TAB_STATUS.ERROR) {
    $('fallbackTitle').textContent = 'This page can’t be shown here';
    $('fallbackText').textContent = `${tab.error || 'The page failed to load.'} Some sites refuse to be embedded; you can open ${hostOf(tab.url)} in a new window instead.`;
  }
  const label = { loading: 'Loading', ready: 'Ready', error: 'Failed to load', idle: 'Ready' }[tab.status] || 'Ready';
  setStatus(`${label} — ${displayUrl(tab.url)}`);
}

// ---------------------------------------------------------------------------
// Rendering: new-tab page and panels
// ---------------------------------------------------------------------------
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Late night orbit.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function renderClock() {
  const show = settings.get().clock;
  $('clock').hidden = !show;
  if (!show) return;
  const now = new Date();
  $('clockTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('clockDate').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function renderHome() {
  $('greeting').textContent = greeting();
  renderClock();
  const shortcuts = store.shortcuts.all().slice(0, HOME_SHORTCUT_LIMIT);
  $('homeShortcuts').innerHTML = shortcuts.length
    ? shortcuts.map((s, i) => appCard(s, i)).join('')
    : emptyState('▦', 'No apps yet', 'Add an app to get one-click access from every new tab.');
  const recent = store.history.all().slice(0, HOME_RECENT_LIMIT);
  $('homeRecent').innerHTML = recent.length
    ? recent.map((h) => listRow(h, { meta: formatTime(h.time) })).join('')
    : emptyState('◷', 'Nothing yet', 'Pages you visit will show up here.');
  const saved = store.saved.all().slice(0, HOME_SAVED_LIMIT);
  $('homeSaved').innerHTML = saved.length
    ? saved.map((s) => listRow({ ...s, icon: '★' })).join('')
    : emptyState('★', 'Nothing saved', 'Press ☆ in the toolbar to keep a page here.');
  const count = tabs.count();
  $('ntpStatus').innerHTML = [
    `<span><b>${count}</b> open tab${count === 1 ? '' : 's'}</span>`,
    `<span><b>${store.saved.all().length}</b> saved</span>`,
    `<span>${esc(runtime.name)}</span>`,
    `<span>${storage.isAvailable() ? 'Local storage on' : 'Storage unavailable'}</span>`,
  ].join('<i aria-hidden="true">·</i>');
}

function renderApps() {
  const items = store.shortcuts.all();
  $('appsGrid').innerHTML = items.length
    ? items.map((s, i) => appCard(s, i, { editable: true })).join('')
    : emptyState('▦', 'No apps', 'Add your first app or reset the defaults.');
}

function renderSaved() {
  const items = store.saved.all();
  $('savedList').innerHTML = items.length
    ? items.map((s) => listRow({ ...s, icon: '★' }, { removable: true, meta: formatTime(s.time) })).join('')
    : emptyState('★', 'Nothing saved yet', 'Open a page and press ☆ in the toolbar to save it.');
  $('clearSaved').disabled = !items.length;
}

function renderHistory() {
  const items = store.history.all();
  $('clearHistory').disabled = !items.length;
  if (!items.length) {
    $('historyList').innerHTML = emptyState('◷', 'No history', 'Pages you visit will be listed here with timestamps.');
    return;
  }
  const groups = new Map();
  items.forEach((h) => {
    const key = dayLabel(h.time || 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  });
  $('historyList').innerHTML = Array.from(groups)
    .map(
      ([label, rows]) =>
        `<h3 class="group-label">${esc(label)}</h3>` +
        rows.map((h) => listRow(h, { removable: true, meta: formatTime(h.time) })).join('')
    )
    .join('');
}

function renderSettings() {
  const s = settings.get();
  $$('input[name="theme"]').forEach((r) => (r.checked = r.value === s.theme));
  $$('input[name="sidebar"]').forEach((r) => (r.checked = r.value === s.sidebar));
  $$('input[name="startup"]').forEach((r) => (r.checked = r.value === s.startup));
  $('clockToggle').checked = !!s.clock;
  $('runtimeName').textContent = runtime.name;
  $('storageState').textContent = storage.isAvailable() ? 'Available' : 'Unavailable';
}

function applySettings() {
  const s = settings.get();
  document.body.dataset.theme = s.theme;
  document.querySelector('meta[name="theme-color"]').content = s.theme === 'light' ? '#f3f5fb' : '#080b16';
  const collapsed = s.sidebar === 'compact';
  $('sidebar').classList.toggle('collapsed', collapsed);
  $('collapseBtn').setAttribute('aria-expanded', String(!collapsed));
  $('collapseBtn').dataset.tip = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  $('collapseBtn').querySelector('.nav-label').textContent = collapsed ? 'Expand' : 'Collapse';
  $('collapseBtn').querySelector('.nav-icon').textContent = collapsed ? '›' : '‹';
  document.body.classList.toggle('startup-blank', s.startup === 'blank');
  renderClock();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function navigate(raw) {
  const tab = tabs.active();
  if (!tab) return;
  if (!resolveInput(raw)) {
    toast('Enter a web address or search term.');
    return;
  }
  nav.go(tab.id, raw);
  showTab();
}

function closeTab(id) {
  runtime.close(id);
  tabs.close(id);
}

function openInNewTab(url) {
  const tab = tabs.add();
  nav.go(tab.id, url);
  showTab();
}

function toggleSaved() {
  const tab = tabs.active();
  if (!tab?.url) {
    toast('Open a page first to save it.');
    return;
  }
  const added = store.saved.toggle({ url: tab.url, title: tab.title || hostOf(tab.url) });
  toast(added ? 'Saved to your space.' : 'Removed from saved.');
  renderToolbar();
}

function openExternally(url) {
  if (!url) return toast('Nothing to open yet.');
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) toast('Pop-up blocked. Allow pop-ups to open pages externally.');
}

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return toast('Fullscreen is not available here.');
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => toast('Fullscreen was blocked.'));
}

function openShortcutDialog() {
  const dialog = $('shortcutDialog');
  if (typeof dialog.showModal !== 'function') {
    const name = prompt('App name');
    const url = resolveInput(prompt('Website address') || '');
    if (name && url) store.shortcuts.add({ name, url });
    return;
  }
  $('shortcutForm').reset();
  $('shortcutError').hidden = true;
  dialog.showModal();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
function bindTabs() {
  const bar = $('tabs');
  bar.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) {
      closeTab(close.dataset.close);
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      tabs.activate(tab.dataset.tab);
      showTab();
    }
  });
  bar.addEventListener('auxclick', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab && e.button === 1) {
      e.preventDefault();
      closeTab(tab.dataset.tab);
    }
  });
  bar.addEventListener('keydown', (e) => {
    const current = e.target.closest('[data-tab]');
    if (!current) return;
    const list = tabs.list();
    const index = list.findIndex((t) => t.id === current.dataset.tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = list[(index + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
      tabs.activate(next.id);
      showTab();
      bar.querySelector('.tab.active')?.focus();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      closeTab(current.dataset.tab);
      bar.querySelector('.tab.active')?.focus();
    }
  });
  $('newTab').addEventListener('click', () => {
    tabs.add();
    showTab();
    $('homeInput').focus();
  });
}

function bindToolbar() {
  const addr = $('addressBar');
  $('addressForm').addEventListener('submit', (e) => {
    e.preventDefault();
    navigate(addr.value);
    addr.blur();
  });
  addr.addEventListener('focus', () => addr.select());
  addr.addEventListener('input', () => ($('clearBtn').hidden = !addr.value));
  addr.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      addr.value = tabs.active()?.url || '';
      addr.blur();
    }
  });
  $('clearBtn').addEventListener('click', () => {
    addr.value = '';
    $('clearBtn').hidden = true;
    addr.focus();
  });
  $('backBtn').addEventListener('click', () => {
    if (!nav.back(tabs.activeId())) toast('Nothing to go back to.');
    showTab();
  });
  $('forwardBtn').addEventListener('click', () => {
    if (!nav.forward(tabs.activeId())) toast('Nothing to go forward to.');
    showTab();
  });
  $('reloadBtn').addEventListener('click', () => {
    if (!nav.reload(tabs.activeId())) toast('Nothing to reload on the Cosmic page.');
    showTab();
  });
  $('homeBtn').addEventListener('click', () => {
    nav.home(tabs.activeId());
    showTab();
  });
  $('favoriteBtn').addEventListener('click', toggleSaved);
  $('openBtn').addEventListener('click', () => openExternally(tabs.active()?.url));
  $('fullscreenBtn').addEventListener('click', toggleFullscreen);
  $('themeBtn').addEventListener('click', () => settings.set({ theme: settings.get().theme === 'dark' ? 'light' : 'dark' }));
  $('fallbackOpen').addEventListener('click', () => openExternally(tabs.active()?.url));
  $('fallbackRetry').addEventListener('click', () => nav.reload(tabs.activeId()));
  $('fallbackHome').addEventListener('click', () => {
    nav.home(tabs.activeId());
    showTab();
  });
}

function bindSidebar() {
  $$('.nav[data-view]').forEach((btn) =>
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      if (btn.dataset.view === 'home') $('homeInput').focus();
    })
  );
  $('brandHome').addEventListener('click', () => setView('home'));
  $('collapseBtn').addEventListener('click', () =>
    settings.set({ sidebar: settings.get().sidebar === 'compact' ? 'expanded' : 'compact' })
  );
  $('focusBtn').addEventListener('click', () => {
    const on = document.body.classList.toggle('focus');
    $('focusBtn').setAttribute('aria-pressed', String(on));
    toast(on ? 'Focus mode on — press Esc to exit.' : 'Focus mode off.');
  });
}

/** Cards and list rows across all panels share one delegated handler. */
function bindContent() {
  const content = $('content');
  content.addEventListener('click', (e) => {
    const link = e.target.closest('[data-view-link]');
    if (link) return setView(link.dataset.viewLink);
    if (e.target.closest('[data-action="add-shortcut"]')) return openShortcutDialog();
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const item = store.shortcuts.all()[+remove.dataset.remove];
      store.shortcuts.remove(+remove.dataset.remove);
      toast(`Removed ${item?.name || 'app'}.`);
      return;
    }
    const removeUrl = e.target.closest('[data-remove-url]');
    if (removeUrl) {
      const url = removeUrl.dataset.removeUrl;
      if (removeUrl.closest('#savedList')) store.saved.remove(url);
      else store.history.remove(url);
      return;
    }
    const open = e.target.closest('[data-url]');
    if (open) {
      if (e.ctrlKey || e.metaKey) openInNewTab(open.dataset.url);
      else navigate(open.dataset.url);
    }
  });
  content.addEventListener('auxclick', (e) => {
    const open = e.target.closest('[data-url]');
    if (open && e.button === 1) {
      e.preventDefault();
      openInNewTab(open.dataset.url);
    }
  });
  $('homeSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    navigate($('homeInput').value);
    $('homeInput').value = '';
  });
  bindAppsDragging();
}

function bindAppsDragging() {
  const grid = $('appsGrid');
  let dragIndex = null;
  grid.addEventListener('dragstart', (e) => {
    const wrap = e.target.closest('.card-wrap');
    if (!wrap) return;
    dragIndex = +wrap.dataset.index;
    wrap.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  grid.addEventListener('dragover', (e) => {
    if (dragIndex === null) return;
    e.preventDefault();
    $$('.card-wrap', grid).forEach((w) => w.classList.toggle('drop-target', w === e.target.closest('.card-wrap')));
  });
  grid.addEventListener('drop', (e) => {
    const wrap = e.target.closest('.card-wrap');
    if (wrap && dragIndex !== null) {
      e.preventDefault();
      store.shortcuts.move(dragIndex, +wrap.dataset.index);
    }
  });
  grid.addEventListener('dragend', () => {
    dragIndex = null;
    $$('.card-wrap', grid).forEach((w) => w.classList.remove('dragging', 'drop-target'));
  });
}

function bindPanels() {
  $('resetShortcuts').addEventListener('click', () => {
    store.shortcuts.reset();
    toast('Apps reset to defaults.');
  });
  $('clearSaved').addEventListener('click', () => {
    store.saved.clear();
    toast('Saved pages cleared.');
  });
  $('clearHistory').addEventListener('click', () => {
    store.history.clear();
    toast('History cleared.');
  });
  $('settingsClearHistory').addEventListener('click', () => {
    store.history.clear();
    toast('History cleared.');
  });
  $('settingsClearSaved').addEventListener('click', () => {
    store.saved.clear();
    toast('Saved pages cleared.');
  });
  $('resetSettings').addEventListener('click', () => {
    settings.reset();
    toast('Cosmic settings reset.');
  });
  $$('input[name="theme"], input[name="sidebar"], input[name="startup"]').forEach((input) =>
    input.addEventListener('change', () => settings.set({ [input.name]: input.value }))
  );
  $('clockToggle').addEventListener('change', (e) => settings.set({ clock: e.target.checked }));

  const dialog = $('shortcutDialog');
  $('shortcutCancel').addEventListener('click', () => dialog.close());
  $('shortcutForm').addEventListener('submit', (e) => {
    const data = new FormData(e.target);
    const url = resolveInput(String(data.get('url')));
    if (!url || url.includes('duckduckgo.com/?q=')) {
      e.preventDefault();
      $('shortcutError').textContent = 'Enter a valid web address, e.g. example.com';
      $('shortcutError').hidden = false;
      return;
    }
    store.shortcuts.add({
      name: String(data.get('name')).trim(),
      url,
      icon: String(data.get('icon')).trim() || '✦',
      description: String(data.get('description')).trim(),
    });
    toast('App added.');
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('focus')) {
      document.body.classList.remove('focus');
      $('focusBtn').setAttribute('aria-pressed', 'false');
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key === 't') {
      e.preventDefault();
      tabs.add();
      showTab();
      $('homeInput').focus();
    } else if (key === 'w') {
      e.preventDefault();
      closeTab(tabs.activeId());
    } else if (key === 'l') {
      e.preventDefault();
      $('addressBar').focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nav.back(tabs.activeId());
      showTab();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nav.forward(tabs.activeId());
      showTab();
    }
  });
}

// ---------------------------------------------------------------------------
// Reactive wiring: state changes → renders
// ---------------------------------------------------------------------------
function bindState() {
  let lastActive = null;
  tabs.onChange(() => {
    renderTabs();
    renderToolbar();
    const active = tabs.activeId();
    if (active !== lastActive) {
      lastActive = active;
      if (view === 'tab') setView('tab');
    } else if (view === 'tab') {
      // Same tab, but its url/status may have changed (home ↔ page).
      const shown = activeContentView();
      if ($(`${shown}View`).hidden) setView('tab');
      else if (shown === 'page') renderPageState();
    }
    if (!tabs.get(lastActive)) lastActive = tabs.activeId();
  });

  runtime.on('title', ({ url, title }) => store.history.updateTitle(url, title));

  store.shortcuts.onChange(() => {
    renderApps();
    if (!$('homeView').hidden) renderHome();
  });
  store.saved.onChange(() => {
    renderSaved();
    renderToolbar();
    if (!$('homeView').hidden) renderHome();
  });
  store.history.onChange(() => {
    renderHistory();
    if (!$('homeView').hidden) renderHome();
  });
  settings.onChange(() => {
    applySettings();
    if (!$('settingsView').hidden) renderSettings();
  });

  document.addEventListener('fullscreenchange', () => {
    $('fullscreenBtn').textContent = document.fullscreenElement ? '⤢' : '⛶';
    $('fullscreenBtn').title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  });

  setInterval(() => {
    if (!$('homeView').hidden) renderClock();
  }, 30000);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
  runtime.mount($('viewports'));
  bindTabs();
  bindToolbar();
  bindSidebar();
  bindContent();
  bindPanels();
  bindKeyboard();
  bindState();
  applySettings();
  renderApps();
  renderSaved();
  renderHistory();
  tabs.add();
  showTab();

  // Small public surface for integrations and debugging.
  window.Cosmic = {
    tabs,
    navigation: nav,
    runtime,
    store,
    navigate,
    openInNewTab,
    setView,
  };
}

init();
