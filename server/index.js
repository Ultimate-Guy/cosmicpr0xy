/**
 * Cosmic server.
 *
 * Serves the static UI plus the client assets of the two service-worker
 * runtimes (Ultraviolet and Scramjet), and terminates the Wisp websocket that
 * those runtimes use as their transport.
 *
 * Everything here runs on infrastructure you operate: the browser talks to
 * this server, and this server opens the outbound TCP connections.
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

// wisp-js already refuses private and loopback destinations; these tighten the
// rest. WISP_ALLOW_HOSTS="^example\.com$,^.*\.wikipedia\.org$" restricts the
// relay to an allow-list of hostname patterns.
wisp.options.dns_result_order = process.env.WISP_DNS_ORDER || 'ipv4first';
wisp.options.allow_udp_streams = false;
wisp.options.stream_limit_total = Number(process.env.WISP_STREAMS_TOTAL) || 512;
wisp.options.hostname_blacklist = [/^localhost$/i];
if (process.env.WISP_ALLOW_HOSTS) {
  wisp.options.hostname_whitelist = process.env.WISP_ALLOW_HOSTS.split(',').map((p) => new RegExp(p.trim(), 'i'));
}

const app = express();

// Cosmic's own service worker must be allowed to control the whole origin.
app.get('/sw.js', (_req, res) => {
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(join(root, 'sw.js'));
});

// Our Ultraviolet config wins over the one shipped in the package.
app.use('/uv', express.static(join(root, 'proxy')));
app.use('/uv', express.static(uvPath));
app.use('/scram', express.static(scramjetPath));
app.use('/baremux', express.static(baremuxPath));
app.use('/epoxy', express.static(epoxyPath));
app.use(express.static(root, { extensions: ['html'] }));

const server = app.listen(PORT, HOST, () => {
  console.log(`Cosmic on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Wisp transport on ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${WISP_PATH}`);
});

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith(WISP_PATH)) wisp.routeRequest(req, socket, head);
  else socket.end();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
