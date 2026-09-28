/*
 * T35 Proxy - single codebase for every major browser.
 *
 * Chrome/Edge/Brave/Opera/Vivaldi and Firefox disagree on two things:
 *   1. the manifest background type (service_worker vs scripts)  -> two manifests
 *   2. the shape of the proxy config object                       -> detected below
 * Everything else is identical, which is why one file drives both engines.
 *
 * Secrets: the password is never stored in this file. It lives in
 * extension-local storage only, entered via the popup, exactly like v1.
 */

const api = typeof browser !== "undefined" && browser.proxy ? browser : chrome;
const IS_FIREFOX = typeof browser !== "undefined" && browser.runtime.getBrowserInfo === "function";
const action = api.action || api.browserAction;

const KILL_RULE_ID = 1;

const DEFAULTS = {
  enabled: false,
  host: "server17.t35.net",
  port: 3128,
  username: "frontend",
  password: "",
  // Left empty on purpose: Chromium wants "<local>"/"127.*" patterns while Firefox
  // wants plain hosts and CIDRs, and the two are not interchangeable. Both engines
  // already bypass loopback on their own, so the safest shared default is none.
  bypassList: "",
  killSwitch: false
};

let cached = null;
let secrets = {};
let secretsLoaded = false;

// Optional machine-local defaults, shaped like DEFAULTS, e.g.
//   { "username": "frontend", "password": "..." }
// This file is gitignored on purpose: it is this machine's copy, never the
// repository's. A fresh clone simply won't have it and the popup asks once.
async function loadSecrets() {
  try {
    const res = await fetch(api.runtime.getURL("secrets.local.json"));
    if (!res.ok) return {};
    const parsed = JSON.parse(await res.text());
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function getSettings() {
  if (cached) return cached;
  if (!secretsLoaded) {
    secretsLoaded = true;
    secrets = await loadSecrets();
  }
  // get(null) rather than get(DEFAULTS): passing DEFAULTS makes storage fill in
  // blank values for keys the user never saved, which would mask secrets.
  const stored = await api.storage.local.get(null);
  const merged = { ...DEFAULTS, ...secrets, ...stored };
  if (!merged.password && secrets.password) merged.password = secrets.password;
  cached = merged;
  return cached;
}

function buildProxyValue(s) {
  const endpoint = `${s.host}:${s.port}`;

  if (IS_FIREFOX) {
    const value = {
      proxyType: "fixedServers",
      http: endpoint,
      ssl: endpoint,
      // Firefox-only: send DNS to the proxy too, so lookups don't leak to the ISP.
      proxyDNS: true
    };
    if (s.bypassList) value.passthrough = s.bypassList;
    return value;
  }

  const servers = { http: endpoint, https: endpoint };
  if (s.bypassList) {
    servers.bypassList = s.bypassList
      .split(/[;,]/)
      .map((e) => e.trim())
      .filter(Boolean);
  }
  return { mode: "fixed_servers", rules: { singleProxy: servers } };
}

async function setKillSwitch(on) {
  if (!api.declarativeNetRequest) return;
  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [KILL_RULE_ID],
      addRules: on
        ? [
            {
              id: KILL_RULE_ID,
              priority: 1,
              action: { type: "block" },
              condition: { urlFilter: "*", resourceTypes: ["main_frame", "sub_frame"] }
            }
          ]
        : []
    });
  } catch (err) {
    console.warn("kill-switch failed:", err.message);
  }
}

async function apply() {
  const s = await getSettings();

  // Proxy is always configured, so the kill-switch has something to fall back from.
  if (IS_FIREFOX) {
    await api.proxy.settings.set({ value: buildProxyValue(s) });
  } else {
    await api.proxy.settings.set({ value: buildProxyValue(s), scope: "regular" });
  }

  await setKillSwitch(s.killSwitch && !s.enabled);
  await refreshBadge();
}

async function refreshBadge() {
  const s = await getSettings();
  const text = s.enabled ? "ON" : s.killSwitch ? "KILL" : "";
  const color = s.enabled ? "#1a7f37" : s.killSwitch ? "#b23b3b" : "#6b7280";
  try {
    await action.setBadgeText({ text });
    await action.setBadgeBackgroundColor({ color });
  } catch (err) {
    /* badge is cosmetic */
  }
}

// --- proxy auth -----------------------------------------------------------
// "asyncBlocking" is the only value accepted by both Chrome MV3 and Firefox MV3.
api.webRequest.onAuthRequired.addListener(
  (details) => {
    if (!details.isProxy) return {};
    return getSettings().then((s) =>
      s.username
        ? { authCredentials: { username: s.username, password: s.password || "" } }
        : {}
    );
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

api.runtime.onInstalled.addListener(async () => {
  cached = null;
  await getSettings();
  await apply();
});

api.runtime.onStartup.addListener(async () => {
  cached = null;
  await getSettings();
  await apply();
});

api.storage.onChanged.addListener(async () => {
  cached = null;
  await getSettings();
  await apply();
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "getState") {
      const s = await getSettings();
      sendResponse({ ...s, isFirefox: IS_FIREFOX, level: await levelOfControl() });
      return;
    }
    if (msg.type === "save") {
      cached = null;
      await api.storage.local.set(msg.values);
      await getSettings();
      await apply();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "checkIP") {
      sendResponse(await checkIP());
    }
  })();
  return true;
});

async function levelOfControl() {
  try {
    return (await api.proxy.settings.get({})).levelOfControl;
  } catch (err) {
    return null;
  }
}

async function checkIP() {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) return { ok: false, reason: "HTTP " + res.status, ms: Date.now() - started };
    const data = await res.json();
    return { ok: true, ip: data.ip, ms: Date.now() - started };
  } catch (err) {
    const msg = err.message || String(err);
    let reason = "unreachable";
    if (err.name === "AbortError") reason = "timed out";
    else if (/407|AUTH/i.test(msg)) reason = "proxy rejected the credentials (407)";
    else if (/ERR_TUNNEL_CONNECTION_FAILED/i.test(msg)) reason = "proxy blocked the tunnel";
    else if (/ERR_PROXY_CONNECTION_FAILED/i.test(msg)) reason = "proxy refused the connection";
    else if (/ERR_BLOCKED_BY_CLIENT|Failed to fetch/i.test(msg))
      reason = "no response - kill-switch may be blocking everything";
    return { ok: false, reason, detail: msg, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
