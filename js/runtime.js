/**
 * Runtime adapter layer.
 *
 * The browser UI never talks to a transport directly. It talks to a
 * `RuntimeAdapter`, which owns one viewport per tab and reports lifecycle
 * events back through a small set of callbacks. Swapping the underlying web
 * runtime (for example a service-worker based runtime you host yourself) only
 * requires implementing this interface and registering it with
 * `createRuntime`.
 *
 * Interface (all methods synchronous unless noted):
 *
 *   name: string                       Human readable adapter name (shown in Settings).
 *   mount(container: HTMLElement)      Called once with the element that hosts viewports.
 *   open(tabId: string)                Create a viewport for a tab (idempotent).
 *   close(tabId: string)               Destroy a tab's viewport.
 *   show(tabId: string | null)         Make one viewport visible, hide the others.
 *   load(tabId: string, url: string)   Load a URL into a tab's viewport.
 *   reload(tabId: string)              Reload the current document.
 *   back(tabId: string): boolean       Go back inside the viewport when possible.
 *   forward(tabId: string): boolean    Go forward inside the viewport when possible.
 *   on(event, handler)                 Subscribe: 'load' | 'error' | 'title' | 'navigate'.
 *                                      Handlers receive ({ tabId, url, title?, message? }).
 *
 * 'navigate' is emitted when the page itself moved somewhere else (a link
 * click inside the viewport). Adapters that cannot observe in-viewport
 * navigation simply never emit it.
 *
 * Adapters may resolve an outbound URL differently (e.g. rewrite it for a
 * transport you control) but must report the *logical* URL in events.
 */

export const LOAD_TIMEOUT_MS = 20000;

export function createEmitter() {
  const handlers = { load: [], error: [], title: [], navigate: [] };
  return {
    on(event, fn) {
      if (handlers[event]) handlers[event].push(fn);
    },
    emit(event, payload) {
      (handlers[event] || []).forEach((fn) => fn(payload));
    },
  };
}

/**
 * Default runtime: a sandboxed iframe per tab. It intentionally does nothing
 * to alter the request; it simply hosts whatever the target site allows to be
 * embedded. Sites that refuse embedding surface as a timeout/error state.
 */
export function createIframeRuntime() {
  const emitter = createEmitter();
  const frames = new Map();
  let container = null;

  function frameFor(tabId) {
    return frames.get(tabId);
  }

  function settleTimer(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
  }

  return {
    name: 'Embedded viewport (iframe)',
    mount(el) {
      container = el;
    },
    open(tabId) {
      if (frames.has(tabId)) return;
      const frame = document.createElement('iframe');
      frame.className = 'viewport';
      frame.hidden = true;
      frame.title = 'Cosmic web viewport';
      frame.setAttribute('allow', 'fullscreen; autoplay; picture-in-picture; clipboard-read; clipboard-write');
      frame.setAttribute(
        'sandbox',
        'allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts'
      );
      const entry = { frame, url: '', timer: null };
      frame.addEventListener('load', () => {
        if (!entry.url) return;
        settleTimer(entry);
        emitter.emit('load', { tabId, url: entry.url });
        let title = '';
        try {
          title = frame.contentDocument?.title || '';
        } catch {
          /* cross-origin: title unavailable */
        }
        if (title) emitter.emit('title', { tabId, url: entry.url, title });
      });
      frames.set(tabId, entry);
      container?.appendChild(frame);
    },
    close(tabId) {
      const entry = frameFor(tabId);
      if (!entry) return;
      settleTimer(entry);
      entry.frame.remove();
      frames.delete(tabId);
    },
    show(tabId) {
      frames.forEach((entry, id) => {
        entry.frame.hidden = id !== tabId;
      });
    },
    load(tabId, url) {
      const entry = frameFor(tabId);
      if (!entry) return;
      settleTimer(entry);
      entry.url = url;
      entry.timer = setTimeout(() => {
        emitter.emit('error', {
          tabId,
          url,
          message: 'The page is taking too long or refuses to be embedded.',
        });
      }, LOAD_TIMEOUT_MS);
      try {
        entry.frame.src = url;
      } catch (err) {
        settleTimer(entry);
        emitter.emit('error', { tabId, url, message: err.message || 'Navigation failed.' });
      }
    },
    reload(tabId) {
      const entry = frameFor(tabId);
      if (entry?.url) this.load(tabId, entry.url);
    },
    back(tabId) {
      const entry = frameFor(tabId);
      try {
        entry.frame.contentWindow.history.back();
        return true;
      } catch {
        return false;
      }
    },
    forward(tabId) {
      const entry = frameFor(tabId);
      try {
        entry.frame.contentWindow.history.forward();
        return true;
      } catch {
        return false;
      }
    },
    on: emitter.on,
  };
}

const registry = new Map([['iframe', createIframeRuntime]]);

/** Register a custom runtime factory under a name, e.g. registerRuntime('mine', createMyRuntime). */
export function registerRuntime(name, factory) {
  registry.set(name, factory);
}

/** Create a runtime by name, falling back to the built-in iframe runtime. */
export function createRuntime(name = 'iframe') {
  const factory = registry.get(name) || registry.get('iframe');
  return factory();
}
