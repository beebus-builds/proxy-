#!/usr/bin/env node
/*
 * Free local credential-injecting HTTP forwarder.
 *
 * Why this exists: browsers cannot store proxy credentials in a PAC file, and most
 * non-browser apps cannot either. This listens on 127.0.0.1 and forwards everything
 * to the upstream proxy, attaching the Proxy-Authorization header for you. Then you
 * point ANY app (or all of them) at 127.0.0.1:8899 and never type a password again.
 *
 * Usage (env vars keep the password out of the file and out of your shell history):
 *   $env:PROXY_USER="your-user"
 *   $env:PROXY_PASS="your-pass"
 *   node proxy-bridge.js
 *
 * Optional: PROXY_HOST, PROXY_PORT, LISTEN_PORT, VERBOSE
 */

const http = require("http");
const net = require("net");

const LISTEN_PORT = Number(process.env.LISTEN_PORT || 8899);
const LISTEN_HOST = process.env.LISTEN_HOST || "127.0.0.1";
const UPSTREAM_HOST = process.env.PROXY_HOST || "server17.t35.net";
const UPSTREAM_PORT = Number(process.env.PROXY_PORT || 3128);
const USERNAME = process.env.PROXY_USER || "";
const PASSWORD = process.env.PROXY_PASS || "";
const VERBOSE = process.env.VERBOSE === "1";

const AUTH_HEADER = USERNAME
  ? "Proxy-Authorization: Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")
  : null;

const log = (...a) => VERBOSE && console.log("[bridge]", ...a);

if (!AUTH_HEADER) {
  console.warn("PROXY_USER is not set - requests will be forwarded without credentials.");
}

// ---------------------------------------------------------------------------
// HTTPS: the client sends CONNECT host:port. We open a tunnel to the upstream
// proxy, authenticate, and once it answers 200 we splice the two sockets.
// ---------------------------------------------------------------------------
function handleConnect(req, clientSocket, head) {
  const target = req.url;
  const [host, port] = splitHostPort(target);
  clientSocket.setNoDelay(true);

  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`, "Proxy-Connection: Keep-Alive"];
    if (AUTH_HEADER) lines.push(AUTH_HEADER);
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    log("CONNECT", target);
  });

  let buf = "";
  const onHandshake = (chunk) => {
    buf += chunk.toString("latin1");
    const end = buf.indexOf("\r\n\r\n");
    if (end === -1) return;

    upstream.off("data", onHandshake);
    const headText = buf.slice(0, end);
    const leftover = buf.slice(end + 4);
    const statusLine = headText.split("\r\n")[0];
    const code = Number((/HTTP\/1\.[01] (\d+)/.exec(statusLine) || [])[1]);

    if (code !== 200) {
      log("upstream refused", statusLine);
      clientSocket.end(
        "HTTP/1.1 502 Bad Gateway\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          `Upstream proxy refused the tunnel: ${statusLine}`
      );
      upstream.end();
      return;
    }

    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (leftover.length) upstream.write(Buffer.from(leftover, "latin1"));
    if (head && head.length) upstream.write(head);

    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  };

  upstream.on("data", onHandshake);
  upstream.on("error", (err) => failSocket(clientSocket, "upstream", err));
  clientSocket.on("error", (err) => upstream.destroy());
}

function splitHostPort(target) {
  const i = target.lastIndexOf(":");
  return [target.slice(0, i), target.slice(i + 1)];
}

function failSocket(sock, side, err) {
  log(side, "error:", err.message);
  if (!sock.destroyed) {
    sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\nUpstream proxy unreachable.");
  }
}

// ---------------------------------------------------------------------------
// Plain HTTP: the client sends an absolute-URI request line. Forward it to the
// upstream proxy verbatim (minus hop-by-hop headers) plus our auth header.
// ---------------------------------------------------------------------------
const HOP_BY_HOP = new Set([
  "proxy-authorization",
  "proxy-connection",
  "proxy-authenticate",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer"
]);

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  for (const h of HOP_BY_HOP) delete headers[h];
  if (AUTH_HEADER) headers["proxy-authorization"] = AUTH_HEADER.replace("Proxy-Authorization: ", "");

  const upstreamReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers
    },
    (upstreamRes) => {
      const outHeaders = { ...upstreamRes.headers };
      for (const h of HOP_BY_HOP) delete outHeaders[h];
      res.writeHead(upstreamRes.statusCode, outHeaders);
      upstreamRes.pipe(res);
      log(req.method, req.url, "->", upstreamRes.statusCode);
    }
  );

  upstreamReq.on("error", (err) => {
    log("error", err.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Upstream proxy unreachable: ${err.message}`);
  });

  req.pipe(upstreamReq);
});

server.on("connect", handleConnect);
server.on("clientError", (err, socket) => {
  if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`bridge listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`forwarding to  ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
  console.log(`auth:          ${USERNAME ? "Basic, user " + USERNAME : "NONE (will likely 407)"}`);
  console.log("");
  console.log("Point any app at:  " + LISTEN_HOST + ":" + LISTEN_PORT);
  console.log("Press Ctrl+C to stop.");
});
