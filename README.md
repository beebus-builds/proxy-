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
4. Click the icon and press **Connect**
5. **Check connection** - the exit IP must differ from your normal one

### Firefox

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on...** -> pick **`manifest.firefox.json`**
3. Icon -> **Connect** -> **Check connection**

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
  `password: ""` on purpose; local defaults live in the gitignored
  `secrets.local.json`.
- **This is a proxy, not a VPN.** Traffic is not encrypted on the hop to
  `174.138.190.164`. HTTPS sites stay end-to-end encrypted, so the operator sees
  *which* sites you visit, and can read or modify anything sent over plain HTTP.
  Never log in to anything sensitive over plain HTTP through this.
- The operator can log every destination, timestamp and payload they can read.
  Only use it if you trust them as much as your ISP, or better.
- **Not anonymity.** If the proxy is shared, so are its logs. For real anonymity
  use Tor or a proper VPN.
- The exit address and its geolocation can change at any time.

## Never typing the password again

The popup saves what you type in extension-local storage, so normally you type the
password **once per browser**, not every session.

Firefox *temporary* add-ons are the exception: they are removed when Firefox
closes and take their stored data with them, so you would re-enter it on every
restart. To avoid that, drop your credentials in a local file the extension
reads on startup:

`secrets.local.json` (already gitignored, never committed):

```json
{
  "username": "frontend",
  "password": "your-proxy-password"
}
```

`background.js` fetches it at startup and uses it as the default, so the popup
opens with everything filled in. It works in both engines and survives extension
updates. Any value typed in the popup still wins, so you can override per
browser. A fresh clone has no such file, which is fine - the popup asks once.

This file is plaintext on disk. Anyone with access to this machine can read it,
so do not commit it, put it in a screenshot, or ship it in a shared zip.

## Commit guard

`.githooks/pre-commit` refuses commits that would publish credentials. It runs
three checks:

1. `secrets.local.json` (or any `.env`) is never tracked, even via `git add -f`
2. your exact password value does not appear in any staged file
3. no file hardcodes `PROXY_USER=` / `PROXY_PASS=` (markdown is exempt, since it
   documents those variables with placeholders)

The hook contains no secrets itself - it reads the value from your local
`secrets.local.json`, so it works on your machine and is simply inert on clones
that do not have the file.

Activate it once per clone:

```sh
git config core.hooksPath .githooks
```

`--no-verify` bypasses it, deliberately.

## Using the popup

- **Connect** - one tap, applies immediately
- **Status line** - the coloured dot shows connected, direct, or killed, and
  pulses while a check is in flight
- **Exit IP / latency** - last result is remembered between popup opens
- **Settings** - collapsible; server, credentials, kill-switch. Fields save as
  you type (debounced) and on Enter
- **Warnings** - the banner tells you when another app has taken over the proxy,
  when no password is saved, and when the kill-switch is blocking you

## Kill-switch

On while disconnected, a `declarativeNetRequest` dynamic rule blocks
`main_frame` and `sub_frame` requests, so pages fail to load instead of leaking
over a direct connection. It re-enables the moment you connect. Defaults to
**off** - if it misbehaves, untick it and reload the extension.

## Files

```
manifest.json          Chromium
manifest.firefox.json  Firefox
background.js          shared: proxy, auth, kill-switch, badge, local secrets
popup.html / .css / .js shared: connect, credentials, check, kill-switch
bridge/                optional all-apps forwarder
secrets.local.json     your credentials, gitignored, never committed
t35-v1-archive/        previous Chrome-only v1.4.0 build, kept for reference
```

`t35-v1-archive/` is the superseded v1 code (adblock rules, WebRTC shield,
fingerprint spoofing, multi-server, backup/restore). It is not loaded and not
maintained. Delete it whenever you are done with it - the original is also
preserved in git history.
