# T35 VPN — v1 Chrome Extension

Browser-proxy VPN (protects Chrome traffic only).
Server: `server17.t35.net:3128` (http proxy, auth: frontend / ****22)

## Files
- `manifest.json` — MV3, permissions: proxy, storage, webRequestAuthProvider, declarativeNetRequest
- `background.js` — connect/disconnect, proxy auth, kill-switch (DNR block), badge
- `popup.html/js/css` — UI: Connect, server list, kill-switch toggle, credentials, check IP
- `icons/` — extension icons

## Test in Chrome (2 min)
1. Open `chrome://extensions` → enable **Developer mode** (top right)
2. Click **Load unpacked** → select folder `C:\Users\bibas\OneDrive\Desktop\vpn`
3. Pin T35 VPN, click icon → **Connect**
4. Click **check IP** — should show server IP, not your home IP. Visit `https://whatismyipaddress.com` to double-check.
5. Click **Disconnect** — internet in Chrome should BLOCK (kill-switch). Toggle kill-switch off if you need normal browsing.
6. If auth fails (407): open Proxy credentials → re-enter username `frontend` + password, Save, reconnect.

## How kill-switch works
- ON + disconnected = DNR rule blocks all `http/https` requests in Chrome.
- ON + connected = DNR removed, traffic goes via proxy.
- OFF + disconnected = direct, unprotected (badge OFF gray).

## Security notes
- Credentials stored in `chrome.storage.local` (local only). Don't commit real password to public git.
- v1 is HTTP proxy: traffic between you and server17 is proxied; use HTTPS sites for end-to-end encryption.
- This does NOT protect other apps (Discord, games). Full system VPN needs APK/Windows app (phase 2/3).

## Next phases
- **Phase 2 APK (Android):** best = native `VpnService` + WireGuard, or fast port = Capacitor wrapper reusing proxy for in-app browser only. Needs Play `QUERY_ALL_PACKAGES` / VPN permission + privacy policy.
- **Phase 3 Microsoft Store:** Edge extension = same code as Chrome (upload to Edge Add-ons), then package as MSIX/PWA for Store. Or full Windows app with WinTun/WireGuard.
