/**
 * Service-worker runtimes: Ultraviolet and Scramjet.
 *
 * Both runtimes are started on the Render-hosted Cosmic origin. The browser
 * registers Cosmic's root service worker, connects BareMux to Epoxy/Wisp,
 * then creates the selected runtime's browsing frame.
 */
import { registerRuntime, createEmitter, LOAD_TIMEOUT_MS } from './runtime.js';

const UV_PREFIX = '/service/uv/';
const SCRAM_PREFIX = '/service/scram/';
const SW_PATH = '/sw.js';

const FRAME_SANDBOX =
  'allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads';

export function defaultWispUrl() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/wisp/`;
}

/** Proxy runtimes need a service worker, which needs a secure context. */
export function proxySupported() {
  return 'serviceWorker' in navigator && window.isSecureContext;
}

/**
 * Verify that the Render Node server is actually serving the runtime assets.
 * A static copy of Cosmic can still return HTTP 200 for the homepage, so one
 * homepage request is not enough to prove that the proxy backend exists.
 */
let serverProbe = null;
export function probeServer() {
  serverProbe ??= Promise.all([
    '/sw.js',
    '/baremux/index.mjs',
    '/epoxy/index.mjs',
    '/uv/uv.bundle.js',
    '/scram/scramjet.all.js',
  ].map(async (path) => {
    const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  }))
    .then((results) => results.every(Boolean))
    .catch(() => false);
  return serverProbe;
}

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.async = false;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(`Could not load ${src}. Check the Render deployment and runtime assets.`));
        document.head.appendChild(el);
      })
    );
  }
  return scripts.get(src);
}

let transportPromise = null;
let transportWisp = '';

/**
 * Register the root service worker and configure the shared BareMux →
 * Epoxy → Wisp transport. Both proxy engines use the same connection.
 */
export async function connectTransport(wispUrl = defaultWispUrl()) {
  if (transportPromise && transportWisp === wispUrl) return transportPromise;

  transportWisp = wispUrl;
  transportPromise = (async () => {
    if (!proxySupported()) {
      throw new Error('Proxy runtimes need a service worker: use https or localhost.');
    }

    const registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: '/',
      updateViaCache: 'none',
    });
    await navigator.serviceWorker.ready;

    // A freshly-installed worker may not have controlled the top-level page
    // yet. That is fine for startup: the proxied iframe is a new navigation
    // under / and will be controlled by the active worker.
    if (!registration.active) {
      throw new Error('Cosmic service worker did not become active.');
    }

    const { BareMuxConnection } = await import('/baremux/index.mjs');
    const connection = new BareMuxConnection('/baremux/worker.js');
    await connection.setTransport('/epoxy/index.mjs', [{ wisp: wispUrl }]);

    return { registration, connection, wispUrl };
  })();

  transportPromise.catch(() => {
    transportPromise = null;
  });
  return transportPromise;
}

function createFrameRuntime(engine, wispUrl) {
  const emitter = createEmitter();
  const tabsFrames = new Map();
  let container = null;
  let ready = null;

  function start() {
    if (!ready) ready = engine.init(wispUrl);
    return ready;
  }

  function settle(entry) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  function fail(tabId, entry, message) {
    settle(entry);
    emitter.emit('error', { tabId, url: entry.url, message });
  }

  return {
    name: engine.name,
    mount(el) {
      container = el;
      start().catch(() => {});
    },
    open(tabId) {
      if (tabsFrames.has(tabId)) return;
      const entry = { handle: null, url: '', pending: '', timer: null, hidden: true };
      tabsFrames.set(tabId, entry);
      start()
        .then(() => {
          if (!tabsFrames.has(tabId)) return;
          entry.handle = engine.createFrame();
          entry.handle.el.className = 'viewport';
          entry.handle.el.hidden = entry.hidden;
          entry.handle.el.title = 'Cosmic web viewport';
          entry.handle.el.setAttribute('sandbox', FRAME_SANDBOX);
          entry.handle.el.setAttribute(
            'allow',
            'fullscreen; autoplay; picture-in-picture; clipboard-read; clipboard-write'
          );
          container?.appendChild(entry.handle.el);
          engine.watch(entry.handle, {
            onLoad: (url, title) => {
              settle(entry);
              emitter.emit('load', { tabId, url: url || entry.url });
              if (title) emitter.emit('title', { tabId, url: url || entry.url, title });
            },
            onNavigate: (url) => {
              if (!url || url === entry.url) return;
              entry.url = url;
              emitter.emit('navigate', { tabId, url });
            },
          });
          if (entry.pending) {
            const url = entry.pending;
            entry.pending = '';
            this.load(tabId, url);
          }
        })
        .catch((err) => {
          const entry2 = tabsFrames.get(tabId);
          if (entry2) fail(tabId, entry2, err.message || 'The proxy runtime failed to start.');
        });
    },
    close(tabId) {
      const entry = tabsFrames.get(tabId);
      if (!entry) return;
      settle(entry);
      if (entry.handle) engine.destroyFrame(entry.handle);
      tabsFrames.delete(tabId);
    },
    show(tabId) {
      tabsFrames.forEach((entry, id) => {
        entry.hidden = id !== tabId;
        if (entry.handle) entry.handle.el.hidden = entry.hidden;
      });
    },
    load(tabId, url) {
      const entry = tabsFrames.get(tabId);
      if (!entry) return;
      entry.url = url;
      if (!entry.handle) {
        entry.pending = url;
        return;
      }
      settle(entry);
      entry.timer = setTimeout(() => {
        fail(tabId, entry, `${engine.name} could not load this page in time.`);
      }, LOAD_TIMEOUT_MS);
      try {
        engine.go(entry.handle, url);
      } catch (err) {
        fail(tabId, entry, err.message || 'Navigation failed.');
      }
    },
    reload(tabId) {
      const entry = tabsFrames.get(tabId);
      if (entry?.handle) engine.reload(entry.handle);
      else if (entry?.url) this.load(tabId, entry.url);
    },
    back(tabId) {
      const entry = tabsFrames.get(tabId);
      if (!entry?.handle) return false;
      engine.back(entry.handle);
      return true;
    },
    forward(tabId) {
      const entry = tabsFrames.get(tabId);
      if (!entry?.handle) return false;
      engine.forward(entry.handle);
      return true;
    },
    on: emitter.on,
  };
}

function readFrame(el, decodePath) {
  try {
    const { pathname, search, hash } = el.contentWindow.location;
    const url = decodePath(pathname);
    return { url: url ? url + search + hash : '', title: el.contentDocument?.title || '' };
  } catch {
    return { url: '', title: '' };
  }
}

function decodeUv(pathname) {
  if (!pathname.startsWith(UV_PREFIX) || !self.__uv$config) return '';
  try {
    return self.__uv$config.decodeUrl(pathname.slice(UV_PREFIX.length));
  } catch {
    return '';
  }
}

export function createUltravioletRuntime(wispUrl) {
  return createFrameRuntime(
    {
      name: 'Ultraviolet (service worker)',
      async init(wisp) {
        await loadScript('/uv/uv.bundle.js');
        await loadScript('/uv/uv.config.js');
        await connectTransport(wisp);
      },
      createFrame: () => ({ el: document.createElement('iframe') }),
      destroyFrame: (handle) => handle.el.remove(),
      go(handle, url) {
        const encoded = self.__uv$config.encodeUrl(url);
        handle.el.src = UV_PREFIX + encoded;
      },
      back: (handle) => handle.el.contentWindow?.history.back(),
      forward: (handle) => handle.el.contentWindow?.history.forward(),
      reload: (handle) => handle.el.contentWindow?.location.reload(),
      watch(handle, { onLoad, onNavigate }) {
        handle.el.addEventListener('load', () => {
          const { url, title } = readFrame(handle.el, decodeUv);
          if (url) onNavigate(url);
          onLoad(url, title);
        });
      },
    },
    wispUrl
  );
}

export function createScramjetRuntime(wispUrl) {
  let controller = null;

  return createFrameRuntime(
    {
      name: 'Scramjet (service worker)',
      async init(wisp) {
        await loadScript('/scram/scramjet.all.js');
        await connectTransport(wisp);
        if (typeof window.$scramjetLoadController !== 'function') {
          throw new Error('Scramjet controller failed to load from /scram/scramjet.all.js.');
        }
        const { ScramjetController } = window.$scramjetLoadController();
        if (typeof ScramjetController !== 'function') {
          throw new Error('ScramjetController is missing from the loaded runtime.');
        }
        controller = new ScramjetController({
          prefix: SCRAM_PREFIX,
          files: {
            wasm: '/scram/scramjet.wasm.wasm',
            all: '/scram/scramjet.all.js',
            sync: '/scram/scramjet.sync.js',
          },
        });
        await controller.init();
      },
      createFrame() {
        const frame = controller.createFrame();
        return { el: frame.frame, frame };
      },
      destroyFrame: (handle) => handle.el.remove(),
      go: (handle, url) => handle.frame.go(url),
      back: (handle) => handle.frame.back(),
      forward: (handle) => handle.frame.forward(),
      reload: (handle) => handle.frame.reload(),
      watch(handle, { onLoad, onNavigate }) {
        handle.frame.addEventListener('urlchange', (event) => {
          if (event.url) onNavigate(String(event.url));
        });
        handle.el.addEventListener('load', () => {
          let url = '';
          let title = '';
          try {
            url = String(handle.frame.url || '');
            title = handle.el.contentDocument?.title || '';
          } catch {}
          if (url) onNavigate(url);
          onLoad(url, title);
        });
      },
    },
    wispUrl
  );
}

export function registerProxyRuntimes(getWispUrl = defaultWispUrl) {
  registerRuntime('ultraviolet', () => createUltravioletRuntime(getWispUrl()));
  registerRuntime('scramjet', () => createScramjetRuntime(getWispUrl()));
}
