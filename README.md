# T35 Proxy

One codebase, every major browser. Routes browser traffic through the
`server17.t35.net:3128` HTTP proxy, with proxy-auth and a kill-switch.

**The proxy requires HTTP Basic authentication.** Verified 2026-09-28: it is
Squid 3.5.20 on `174.138.190.164:3128` and returns
`407 Proxy Authentication Required` with `Proxy-Authenticate: Basic realm="proxy"`
unless credentials are supplied. Nothing works without them.

## Install

### Chrome / Edge / Brave / Opera / Vivaldi / Arc / Dia / Thorium / Yandex

1. `chrome://extensions` (or `edge://extensions`, `brave://extensions`, ...)
2. Turn on **Developer mode**
3. **Load unpacked** -> this repo folder (it reads `manifest.json`)
4. Click the icon, enter your proxy **password**, tick **Connect through proxy**,
   **Save & apply**
5. **Check IP** - the exit IP must differ from your normal one

### Firefox

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on...** -> pick **`manifest.firefox.json`**
3. Icon -> enter password -> connect -> **Check IP**

Temporary add-ons are removed when Firefox closes. For a permanent install,
sign the extension at addons.mozilla.org, or run `npx web-ext run` during
development.

### Why two manifests

Chrome MV3 only accepts `background.service_worker`; Firefox MV3 only accepts
`background.scripts`. That is the sole reason there are two files. Everything
else - `background.js`, `popup.html`, `popup.js` - is shared, and
`background.js` detects the engine at runtime and builds the matching proxy
config shape.

| | Chromium | Firefox |
|---|---|---|
| Proxy config | `{mode, rules:{singleProxy}}` | `{proxyType, http, ssl, passthrough}` |
| Bypass list | `;<local>`, `127.*` patterns | plain hosts, CIDR |
| DNS via proxy | no | yes (`proxyDNS: true`) |
| Popup API | `chrome.*` | `browser.*` |

The bypass list is **empty by default** on purpose. Chromium and Firefox want
incompatible syntax, and both engines already bypass loopback on their own, so
the safest shared default is none. Fill it in only if you need it, using the
syntax for the browser you are running.

Firefox is the better choice for privacy here: `proxyDNS: true` sends DNS
lookups to the proxy instead of leaking them to your ISP.

## Non-browser apps (optional)

`bridge/proxy-bridge.js` - free, local, Node 18+. Most apps cannot store proxy
credentials; the bridge holds them for the whole machine.

```powershell
$env:PROXY_USER="frontend"
$env:PROXY_PASS="your-password"
node bridge\proxy-bridge.js
```

Then point any app at `127.0.0.1:8899` with no username or password. Env vars
keep the password out of the file and out of shell history.

To cover everything using WinINET at once, set the Windows manual proxy to
`127.0.0.1:8899` (Settings > Network & internet > Proxy > Manual) while the
bridge runs.

### Why not PAC / auto-detect

PAC is the usual free "works everywhere" answer and it cannot be used here: no
browser accepts credentials inside a PAC file. `PROXY user:pass@host:port` looks
like a real thing but every engine ignores it, so a PAC connects, gets a 407 and
fails. The bridge is the free equivalent because it injects the
`Proxy-Authorization` header on the wire.

## Security

- **Credentials live in extension-local storage only.** No password is committed
  to this repository, and none should ever be. `background.js` ships
  `password: ""` on purpose.
- **This is a proxy, not a VPN.** Traffic is not encrypted on the hop to
  `174.138.190.164`. HTTPS sites stay end-to-end encrypted, so the operator sees
  *which* sites you visit, and can read or modify anything sent over plain HTTP.
  Never log in to anything sensitive over plain HTTP through this.
- The operator can log every destination, timestamp and payload they can read.
  Only use it if you trust them as much as your ISP, or better.
- **Not anonymity.** If the proxy is shared, so are its logs. For real anonymity
  use Tor or a proper VPN.
- The exit address and its geolocation can change at any time.

## Kill-switch

On while disconnected, a `declarativeNetRequest` dynamic rule blocks
`main_frame` and `sub_frame` requests, so pages fail to load instead of leaking
over a direct connection. It re-enables the moment you connect. Defaults to
**off** - if it misbehaves, untick it and reload the extension.

## Files

```
manifest.json          Chromium
manifest.firefox.json  Firefox
background.js          shared: proxy, auth, kill-switch, badge
popup.html / popup.js  shared: connect, credentials, check IP
bridge/                optional all-apps forwarder
t35-v1-archive/        previous Chrome-only v1.4.0 build, kept for reference
```

`t35-v1-archive/` is the superseded v1 code (adblock rules, WebRTC shield,
fingerprint spoofing, multi-server, backup/restore). It is not loaded and not
maintained. Delete it whenever you are done with it - the original is also
preserved in git history.
