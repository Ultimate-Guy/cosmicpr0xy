/**
 * Service-worker runtimes: Ultraviolet and Scramjet.
 *
 * How these differ from the iframe runtime: the iframe runtime asks the
 * browser to load the target origin directly, so the target's headers decide
 * whether anything renders at all (`X-Frame-Options`, CSP, SameSite cookies),
 * and the page stays opaque to us. Ultraviolet and Scramjet instead register a
 * service worker on *this* origin and rewrite the page:
 *
 *   page asks for https://site/x
 *     → rewritten to <origin>/service/<engine>/<encoded https://site/x>
 *     → service worker intercepts, fetches over the Wisp transport (server/index.js)
 *     → response headers are stripped/rewritten, HTML/CSS/JS rewritten
 *     → the document runs same-origin, so titles and in-page navigation are visible
 *
 * Ultraviolet rewrites documents and scripts ahead of execution; Scramjet
 * rewrites JavaScript at runtime (proxied `window`/`location`, dynamic `eval`),
 * which is slower to start but survives modern single-page apps.
 *
 * Both require `npm start` (the static UI alone cannot proxy anything) and a
 * Wisp endpoint you host.
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
        el.onerror = () => reject(new Error(`Could not load ${src}. Is the Cosmic server running?`));
        document.head.appendChild(el);
      })
    );
  }
  return scripts.get(src);
}

let transportPromise = null;
let transportWisp = '';

/**
 * Register the service worker and point bare-mux at the Epoxy/Wisp transport.
 * Shared by both engines and only performed once per Wisp endpoint.
 */
export function connectTransport(wispUrl = defaultWispUrl()) {
  if (transportPromise && transportWisp === wispUrl) return transportPromise;
  transportWisp = wispUrl;
  transportPromise = (async () => {
    if (!proxySupported()) {
      throw new Error('Proxy runtimes need a service worker: use https or localhost.');
    }
    await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
    await navigator.serviceWorker.ready;
    const { BareMuxConnection } = await import('/baremux/index.mjs');
    const connection = new BareMuxConnection('/baremux/worker.js');
    await connection.setTransport('/epoxy/index.mjs', [{ wisp: wispUrl }]);
  })();
  transportPromise.catch(() => {
    transportPromise = null;
  });
  return transportPromise;
}

/**
 * Shared plumbing for frame-backed runtimes: one viewport per tab, load
 * timeouts, visibility, and event fan-out. `engine` supplies the parts that
 * differ between Ultraviolet and Scramjet.
 *
 * engine: {
 *   name, init(wispUrl), createFrame(), destroyFrame(handle),
 *   go(handle, url), back(handle), forward(handle), reload(handle),
 *   watch(handle, { onNavigate, onLoad })
 * }
 */
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
      start().catch(() => {
        /* surfaced per-tab on the first load */
      });
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

/** Read the real URL and title out of a proxied (same-origin) frame. */
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
        handle.el.src = UV_PREFIX + self.__uv$config.encodeUrl(url);
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
        const { ScramjetController } = window.$scramjetLoadController();
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
          } catch {
            /* not readable yet */
          }
          if (url) onNavigate(url);
          onLoad(url, title);
        });
      },
    },
    wispUrl
  );
}

/** Register both engines so `createRuntime(name)` can build them. */
export function registerProxyRuntimes(getWispUrl = defaultWispUrl) {
  registerRuntime('ultraviolet', () => createUltravioletRuntime(getWispUrl()));
  registerRuntime('scramjet', () => createScramjetRuntime(getWispUrl()));
}
