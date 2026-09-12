# Cosmic

A lightweight, dependency-free web-browser workspace: tabs, navigation, a Cosmic new-tab page, Apps, Saved pages, History and Settings — all in plain HTML, CSS and ES modules.

## Run

It is a static site. Serve the folder with any HTTP server (ES modules do not load from `file://`):

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

No build step, no dependencies.

## Layout

```
index.html        Markup for the shell, panels and dialogs
styles.css        Design tokens, dark/light themes, responsive rules
js/app.js         UI orchestration: renders views, wires events
js/tabs.js        Tab manager (pure state + change events)
js/navigation.js  Input → URL resolution, per-tab logical history
js/runtime.js     Runtime adapter interface + default iframe adapter
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
  on(event, handler) {},        // events: load, error, title
}));
```

Then set `settings.runtime` to `'my-runtime'` (see `DEFAULT_SETTINGS` in `js/store.js`).

Cosmic does not include, and is not designed to include, anything intended to bypass school, workplace, network, browser or administrator restrictions. The adapter is a seam for a legitimate runtime that you operate.

## Limitations

- The default iframe adapter is subject to the sites' own embedding policies (`X-Frame-Options`, CSP). Many major sites refuse to be embedded; Cosmic shows a fallback with an "open in new window" action instead of a blank frame.
- Cross-origin pages do not expose their title or in-frame navigation, so tab titles fall back to the hostname and Back/Forward operate on Cosmic's logical history.
- All data (shortcuts, saved pages, history, settings) lives in `localStorage` on the device; if storage is unavailable Cosmic falls back to memory and tells you.

## Keyboard shortcuts

| Keys            | Action                     |
| --------------- | -------------------------- |
| `Alt+T`         | New tab                    |
| `Alt+W`         | Close tab                  |
| `Alt+L`         | Focus address bar          |
| `Alt+←` / `→`   | Back / Forward             |
| `Esc`           | Leave focus mode / close dialog |
