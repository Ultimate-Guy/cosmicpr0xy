/**
 * Cosmic server.
 *
 * Serves the static UI plus the client assets of the two service-worker
 * runtimes (Ultraviolet and Scramjet), and terminates the Wisp websocket that
 * those runtimes use as their transport.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { server as wisp } from '@mercuryworkshop/wisp-js/server';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { baremuxPath } from '@mercuryworkshop/bare-mux/node';
import { epoxyPath } from '@mercuryworkshop/epoxy-transport';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 8080;
const WISP_PATH = '/wisp/';

wisp.options.dns_result_order = process.env.WISP_DNS_ORDER || 'ipv4first';
wisp.options.allow_udp_streams = false;
wisp.options.stream_limit_total = Number(process.env.WISP_STREAMS_TOTAL) || 512;
wisp.options.hostname_blacklist = [/^localhost$/i];
if (process.env.WISP_ALLOW_HOSTS) {
  wisp.options.hostname_whitelist = process.env.WISP_ALLOW_HOSTS
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(pattern, 'i'));
}

const app = express();

// Render and other hosts can use this without loading the full UI.
app.get('/healthz', (_req, res) => {
  res.status(200).type('text/plain').send('ok');
});

app.get('/sw.js', (_req, res) => {
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(join(root, 'sw.js'));
});

// Our config is mounted before the package assets so /uv/uv.config.js wins.
app.use('/uv', express.static(join(root, 'proxy')));
app.use('/uv', express.static(uvPath));
app.use('/scram', express.static(scramjetPath));
app.use('/baremux', express.static(baremuxPath));
app.use('/epoxy', express.static(epoxyPath));
app.use(express.static(root, { extensions: ['html'] }));

const server = app.listen(PORT, HOST, () => {
  console.log(`Cosmic listening on ${HOST}:${PORT}`);
  console.log(`Wisp transport on ws://${HOST}:${PORT}${WISP_PATH}`);
});

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://cosmic.local').pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname === WISP_PATH) {
    req.url = WISP_PATH;
    try {
      wisp.routeRequest(req, socket, head);
    } catch (error) {
      console.error('Wisp upgrade failed:', error);
      socket.destroy();
    }
    return;
  }

  socket.end();
});

server.on('error', (error) => console.error('Cosmic server error:', error));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
