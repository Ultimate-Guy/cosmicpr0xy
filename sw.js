/* global UVServiceWorker, __uv$config, $scramjetLoadWorker */
/**
 * Cosmic service worker.
 *
 * Both proxy runtimes intercept requests here: whatever a proxied page asks
 * for, the browser asks this worker for, and the worker rewrites it and sends
 * it out over the Wisp transport instead of hitting the origin directly. That
 * is the whole difference from the iframe runtime, which never gets a say.
 *
 * Routing is by prefix:
 *   /service/uv/...     → Ultraviolet
 *   /service/scram/...  → Scramjet (plus its wasm, which it serves as a JS shim)
 *   anything else       → the network, untouched (Cosmic's own assets)
 */
importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts(__uv$config.sw || '/uv/uv.sw.js');
importScripts('/scram/scramjet.all.js');

const uv = new UVServiceWorker();
const { ScramjetServiceWorker } = $scramjetLoadWorker();

const UV_PREFIX = __uv$config.prefix;
const SCRAM_PREFIX = '/service/scram/';
const SCRAM_WASM = '/scram/scramjet.wasm.wasm';
const SCRAM_DB = '$scramjet';
const SCRAM_STORES = ['config', 'cookies', 'redirectTrackers', 'referrerPolicies', 'publicSuffixList'];

// ScramjetServiceWorker opens its IndexedDB without an upgrade handler, so if
// the worker starts before the page-side controller the database would be
// created empty. Create the stores here first.
function ensureScramjetDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SCRAM_DB, 1);
    req.onupgradeneeded = () => {
      for (const name of SCRAM_STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

let scramjetPromise = null;
function getScramjet() {
  scramjetPromise ??= ensureScramjetDb().then(() => new ScramjetServiceWorker());
  return scramjetPromise;
}

async function handleRequest(event) {
  const { pathname } = new URL(event.request.url);
  if (pathname.startsWith(SCRAM_PREFIX) || pathname === SCRAM_WASM) {
    const scramjet = await getScramjet();
    await scramjet.loadConfig();
    if (scramjet.route(event)) return scramjet.fetch(event);
  }
  if (pathname.startsWith(UV_PREFIX) && uv.route(event)) return uv.fetch(event);
  return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  const { pathname } = new URL(event.request.url);
  if (!pathname.startsWith(UV_PREFIX) && !pathname.startsWith(SCRAM_PREFIX) && pathname !== SCRAM_WASM) return;
  event.respondWith(handleRequest(event));
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
