# Cosmic

A lightweight web-browser workspace: tabs, navigation, a Cosmic new-tab page, Apps, Saved pages, History and Settings — plain HTML, CSS and ES modules on the front end, with three pluggable **web runtimes**: direct embed, [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) and [Scramjet](https://github.com/MercuryWorkshop/scramjet).

## Run

```sh
npm install
npm start          # http://localhost:8080  (PORT / HOST env to change)
```

`server/index.js` serves the site, the Ultraviolet/Scramjet/BareMux/Epoxy assets, the service worker, and a [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) relay at `ws://<host>/wisp/`. Node 20+.

UI only (no proxy runtimes): the front end is still a static site, so `python3 -m http.server 8080` or GitHub Pages works — Cosmic detects that no server is behind the page, shows a notice in Settings, and falls back to the *Direct embed* runtime.

## Deploy

The proxy runtimes need the Node server (for the runtime assets and the Wisp relay), so a static host is not enough. Any Node host that runs `npm start` and supports WebSockets works:

- **Render**: connect the GitHub repo; `render.yaml` in the root sets it up as a Node web service (free plan, `npm ci` + `npm start`). Render's free instances sleep when idle, so the first request after a while is slow.
- Railway / Fly.io / Koyeb / a VPS: same two commands. Set `PORT` if the platform does not.
- Cloudflare (DNS/proxy) can sit in front of that host; enable WebSockets. Cloudflare Pages/Workers alone cannot run the relay.

Environment variables: `PORT`, `HOST`, `WISP_DNS_ORDER` (`ipv4first` default), `WISP_STREAMS_TOTAL`, `WISP_ALLOW_HOSTS` (comma-separated regex allowlist of destination hosts).

## Layout

```
index.html        Markup for the shell, panels and dialogs
styles.css        Design tokens, dark/light themes, responsive rules
js/app.js         UI orchestration: renders views, wires events
js/tabs.js        Tab manager (pure state + change events)
js/navigation.js  Input → URL resolution, per-tab logical history
js/runtime.js     Runtime adapter interface + default iframe adapter
js/runtime-proxy.js  Ultraviolet + Scramjet adapters, BareMux/Epoxy transport bootstrap
sw.js             Service worker: routes /service/uv/* to UV and /service/scram/* to Scramjet
proxy/uv.config.js   Ultraviolet config (prefix, codec, asset paths)
server/index.js   Express static server + Wisp relay
js/store.js       Shortcuts / saved pages / history / settings persistence
js/storage.js     Safe localStorage wrapper with in-memory fallback
js/render.js      Escaped HTML helpers for cards, rows, tabs
```

Data flows one way:

```
UI (app.js) → Tab Manager → Navigation Manager → Runtime Adapter → Web Transport
```

The UI never touches an iframe or transport directly; it only calls the runtime adapter.

## Runtime adapter

`js/runtime.js` defines the contract the UI depends on. The default adapter renders each tab in a sandboxed `<iframe>`. To plug in a runtime you control, implement the same interface and register it:

```js
import { registerRuntime } from './js/runtime.js';

registerRuntime('my-runtime', () => ({
  name: 'My runtime',
  mount(container) {},          // called once with the viewport element
  open(tabId) {},               // create a surface for a tab
  close(tabId) {},              // destroy it
  show(tabId) {},               // make this tab's surface visible
  load(tabId, url) {},          // navigate; emit 'load' / 'error' / 'title'
  reload(tabId) {},
  back(tabId) {},
  forward(tabId) {},
  on(event, handler) {},        // events: load, error, title, navigate
}));
```

Then set `settings.runtime` to `'my-runtime'` (see `DEFAULT_SETTINGS` in `js/store.js`).

## Web runtimes

Pick one in **Settings → Web runtime**. Switching reloads Cosmic; the choice and the Wisp endpoint are stored in `localStorage`.

| Runtime | How a page is fetched | Trade-off |
| --- | --- | --- |
| **Direct embed** (`iframe`) | The browser loads the site itself in a sandboxed `<iframe>`. | Fastest, zero server work — but the site's `X-Frame-Options`/CSP decide whether it shows, and Cosmic can't see its title or in-page navigation. |
| **Ultraviolet** | The frame points at `/service/uv/<encoded url>`. `sw.js` intercepts every request, rewrites HTML/CSS/JS ahead of time and fetches the origin over your Wisp relay. | Light, works for most classic sites; heavy SPAs that rely on dynamic `eval`/`location` tricks can break. |
| **Scramjet** | Same service-worker model at `/service/scram/`, but JavaScript is rewritten at runtime (proxied `window`/`location`, wasm-based rewriter). | Handles modern apps better; larger download, more CPU. |

With the proxy runtimes the page is same-origin with Cosmic, so titles, in-frame navigation (`navigate` events → address bar and History) and real Back/Forward/Reload all work.

### Transport

Both proxy runtimes send traffic through [BareMux](https://github.com/MercuryWorkshop/bare-mux) → [Epoxy](https://github.com/MercuryWorkshop/epoxy-tls) → Wisp. Epoxy does TLS *in the browser*, so the Wisp relay only forwards opaque TCP streams — it never sees decrypted page content.

The Wisp endpoint defaults to `/wisp/` on the same host. Point **Settings → Wisp endpoint** at another relay you run (`wss://relay.example/wisp/`) if you host the static site and the relay separately. Only proxy runtimes need it; leaving it empty uses the bundled server.

Server environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Listen address |
| `WISP_ALLOW_HOSTS` | *(unset = any public host)* | Comma-separated hostname regexes; when set, the relay refuses everything else, e.g. `^(.*\.)?wikipedia\.org$,^example\.com$` |
| `WISP_STREAMS_TOTAL` | `512` | Max concurrent TCP streams |
| `WISP_DNS_ORDER` | `ipv4first` | Node `dns.setDefaultResultOrder` value |

The relay always refuses private, loopback and `localhost` destinations and UDP, so it can't be used to reach your own network from outside.

### Requirements and responsibilities

- Service workers need a secure context: serve Cosmic over **https** (or `localhost` for development). Over plain http on another host only *Direct embed* is offered.
- `sw.js`, the UV/Scramjet assets and the page must be on the **same origin**; the relay can live elsewhere.
- The relay opens outbound connections on behalf of whoever can reach it. Run it for yourself and people you're responsible for, keep it behind auth or a network boundary if it's on the public internet, and use `WISP_ALLOW_HOSTS` when you only need specific sites.

Cosmic does not include, and is not designed to include, anything intended to bypass school, workplace, network, browser or administrator restrictions — no cloaking, no hidden `about:blank` wrappers, no rotating domains. The runtimes are a way to browse through infrastructure **you** operate.

## Limitations

- The iframe adapter is subject to the sites' own embedding policies (`X-Frame-Options`, CSP). Many major sites refuse to be embedded; Cosmic shows a fallback with an "open in new window" action instead of a blank frame. Cross-origin pages there do not expose their title or in-frame navigation, so tab titles fall back to the hostname and Back/Forward operate on Cosmic's logical history.
- Proxy runtimes rewrite pages, so some sites (DRM video, WebRTC, aggressive anti-bot scripts) will still misbehave. Scramjet 1.x is used; the 2.x line is alpha at the time of writing.
- Login sessions inside proxied pages live in the service worker's cookie store for that origin; clearing site data for Cosmic clears them.
- All data (shortcuts, saved pages, history, settings) lives in `localStorage` on the device; if storage is unavailable Cosmic falls back to memory and tells you.

## Keyboard shortcuts

| Keys            | Action                     |
| --------------- | -------------------------- |
| `Alt+T`         | New tab                    |
| `Alt+W`         | Close tab                  |
| `Alt+L`         | Focus address bar          |
| `Alt+←` / `→`   | Back / Forward             |
| `Esc`           | Leave focus mode / close dialog |
