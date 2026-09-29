// The one way out of a sandbox once the model is at work: HTTPS tunnels to the
// hosts in ALLOWED, nothing else. A CONNECT tunnel, so TLS stays end to end
// and nothing passing through is read. Run by lib/sandbox.ts as its own
// container, on the sandboxes' internal network and on one that reaches out.
import http from 'node:http';
import net from 'node:net';

const allowed = new Set((process.env.ALLOWED || '').split(' ').filter(Boolean));
const server = http.createServer((req, res) => res.writeHead(403).end('Only HTTPS tunnels to allowed hosts.\n'));
server.on('connect', (req, client, head) => {
  const [host, port] = String(req.url).split(':');
  if (!allowed.has(host) || port !== '443') return client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  const upstream = net.connect(443, host, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(client).pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});
server.listen(3128);
