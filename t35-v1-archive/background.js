// T35 VPN - background service worker (MV3) v1.2
// Proxy + auth + kill-switch + webrtc shield + adblock + split-tunnel + usage + auto-reconnect

const DEFAULT_SERVERS = [
  { id: "server17", name: "Server 17 - Main", host: "server17.t35.net", port: 3128, scheme: "http", username: "frontend", password: "" } // enter password in popup (Advanced) — never commit secrets
];
const STORAGE_KEYS = { state: "vpn_state", servers: "vpn_servers", creds: "vpn_creds", features: "vpn_features", usage: "vpn_usage" };
const DEFAULT_FEATURES = { webrtc: true, adblock: true, geoSpoof: false, autoReconnect: true, failover: true, clearOnDisconnect: false, splitBypass: "" };
let failoverInProgress = false;

async function getState() {
  const d = await chrome.storage.local.get([STORAGE_KEYS.state, STORAGE_KEYS.servers, STORAGE_KEYS.creds, STORAGE_KEYS.features, STORAGE_KEYS.usage]);
  return {
    state: d[STORAGE_KEYS.state] || { connected: false, serverId: "server17", killSwitch: true },
    servers: d[STORAGE_KEYS.servers] || DEFAULT_SERVERS,
    creds: d[STORAGE_KEYS.creds] || {},
    features: { ...DEFAULT_FEATURES, ...(d[STORAGE_KEYS.features] || {}) },
    usage: d[STORAGE_KEYS.usage] || {}
  };
}
function getCredsFor(server, storedCreds) {
  const o = storedCreds?.[server.id];
  return { username: o?.username || server.username, password: o?.password || server.password };
}
function parseBypass(raw) {
  const base = ["localhost", "127.0.0.1", "<local>"];
  if (!raw) return base;
  const extra = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 50);
  return [...base, ...extra];
}
function proxyConfigFor(server, features) {
  return { mode: "fixed_servers", rules: { singleProxy: { scheme: server.scheme || "http", host: server.host, port: server.port }, bypassList: parseBypass(features?.splitBypass) } };
}
async function setBadge(connected, killActive = false) {
  if (killActive) { await chrome.action.setBadgeText({ text: "!" }); await chrome.action.setBadgeBackgroundColor({ color: "#d32f2f" }); await chrome.action.setTitle({ title: "T35 VPN - BLOCKED by Kill-Switch" }); }
  else if (connected) { await chrome.action.setBadgeText({ text: "ON" }); await chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" }); await chrome.action.setTitle({ title: "T35 VPN - Connected" }); }
  else { await chrome.action.setBadgeText({ text: "OFF" }); await chrome.action.setBadgeBackgroundColor({ color: "#616161" }); await chrome.action.setTitle({ title: "T35 VPN - Disconnected" }); }
}

// --- kill-switch ---
const KILLSWITCH_RULE_ID = 999991;
async function applyKillSwitch(enable) {
  try {
    if (enable) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [KILLSWITCH_RULE_ID], addRules: [{ id: KILLSWITCH_RULE_ID, priority: 1, action: { type: "block" }, condition: { urlFilter: "|http*", resourceTypes: ["main_frame","sub_frame","xmlhttprequest","websocket","other","script","image","stylesheet","font","media"] } }] });
    else await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [KILLSWITCH_RULE_ID] });
  } catch (e) { console.warn("killswitch failed", e); }
}
// --- webrtc shield ---
async function applyWebRTC(enabled) {
  try {
    if (chrome.privacy?.network?.webRTCIPHandlingPolicy)
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: enabled ? "disable_non_proxied_udp" : "default" });
  } catch (e) { console.warn("webrtc", e); }
}
// --- adblock ---
async function applyAdblock(enabled) {
  try {
    if (enabled) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ["adblock"] });
    else await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ["adblock"] });
  } catch (e) { console.warn("adblock", e); }
}
async function applyFeatures(features) {
  await applyWebRTC(features.webrtc !== false);
  await applyAdblock(features.adblock !== false);
}

// --- connect / disconnect ---
async function connect(serverId) {
  const { servers, creds, state, features } = await getState();
  const server = servers.find(s => s.id === serverId) || servers[0];
  if (!server) throw new Error("No server configured");
  await applyKillSwitch(false);
  await chrome.proxy.settings.set({ value: proxyConfigFor(server, features), scope: "regular" });
  await applyFeatures(features);
  const newState = { connected: true, serverId: server.id, killSwitch: state.killSwitch ?? true };
  await chrome.storage.local.set({ [STORAGE_KEYS.state]: newState, connected_since: Date.now() });
  await setBadge(true);
  return { ok: true, server };
}
async function disconnect(activateKill = true) {
  const { state, features } = await getState();
  await chrome.proxy.settings.clear({ scope: "regular" });
  const killOn = state.killSwitch ?? true;
  if (killOn && activateKill) { await applyKillSwitch(true); await setBadge(false, true); }
  else { await applyKillSwitch(false); await setBadge(false, false); }
  await chrome.storage.local.set({ [STORAGE_KEYS.state]: { ...state, connected: false } });
  await chrome.storage.local.remove("connected_since");
  // Privacy: wipe site data on disconnect if enabled
  if (features.clearOnDisconnect) {
    try {
      await chrome.browsingData.remove({ since: 0 }, { cookies: true, localStorage: true, cache: true });
    } catch (e) { console.warn("clear cookies failed", e); }
  }
  return { ok: true, killActive: killOn && activateKill, cleared: !!features.clearOnDisconnect };
}

// Next server for failover (round-robin, skip current)
function nextServer(servers, currentId) {
  if (!servers.length) return null;
  if (servers.length === 1) return servers[0];
  const i = servers.findIndex(s => s.id === currentId);
  return servers[(i + 1) % servers.length];
}

async function failover(reason) {
  if (failoverInProgress) return;
  failoverInProgress = true;
  try {
    const { state, servers, features } = await getState();
    if (!state.connected) return;
    if (features.failover === false || servers.length < 2) {
      // single-server retry
      if (features.autoReconnect !== false) { await connect(state.serverId); console.log("reconnected same server after", reason); }
      return;
    }
    const nxt = nextServer(servers, state.serverId);
    console.log("failover", state.serverId, "->", nxt.id, reason);
    await connect(nxt.id);
  } catch (e) { console.warn("failover failed", e); }
  finally { failoverInProgress = false; }
}

// --- usage meter (approx via content-length) ---
function todayKey() { return new Date().toISOString().slice(0, 10); }
chrome.webRequest.onHeadersReceived.addListener((details) => {
  if (details.tabId === -1) return;
  const cl = details.responseHeaders?.find(h => h.name.toLowerCase() === "content-length");
  const n = cl ? parseInt(cl.value, 10) : 0;
  if (!n || n <= 0 || n > 500_000_000) return;
  chrome.storage.local.get(STORAGE_KEYS.usage, (d) => {
    const u = d[STORAGE_KEYS.usage] || {};
    const k = todayKey();
    u[k] = (u[k] || 0) + n;
    u.session = (u.session || 0) + n;
    chrome.storage.local.set({ [STORAGE_KEYS.usage]: u });
  });
}, { urls: ["<all_urls>"] }, ["responseHeaders"]);

// --- auth ---
chrome.webRequest.onAuthRequired.addListener(async (details, callback) => {
  if (!details.isProxy) return;
  const { servers, creds, state } = await getState();
  if (!state.connected) return;
  const server = servers.find(s => s.id === state.serverId) || servers[0];
  const c = getCredsFor(server, creds);
  if (c.username) callback({ authCredentials: { username: c.username, password: c.password } });
}, { urls: ["<all_urls>"] }, ["asyncBlocking"]);

// --- auto-reconnect + failover on proxy error ---
if (chrome.proxy?.onProxyError) {
  chrome.proxy.onProxyError.addListener(async (details) => {
    console.warn("proxy error", details);
    const { state, features } = await getState();
    if (!state.connected || features.autoReconnect === false) return;
    setTimeout(() => failover("proxy-error"), 2500);
  });
}

// Periodic health check: every 2 min, if connected, verify proxy answers
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "health") return;
  const { state, features } = await getState();
  if (!state.connected || features.autoReconnect === false) return;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    await fetch("https://api.ipify.org?format=json", { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
  } catch (e) {
    console.warn("health check failed, failover", e);
    failover("health-check");
  }
});
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("health", { periodInMinutes: 2 }).catch(() => {}));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("health", { periodInMinutes: 2 }).catch(() => {}));

// --- messages ---
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "GET_STATUS") {
        const { state, servers, features, usage } = await getState();
        const server = servers.find(s => s.id === state.serverId) || servers[0];
        const rules = await chrome.declarativeNetRequest.getDynamicRules().catch(() => []);
        sendResponse({ ok: true, state, features, usage, servers: servers.map(s => ({ ...s, password: undefined })), current: server ? { ...server, password: undefined } : null, killRuleActive: rules.some(r => r.id === KILLSWITCH_RULE_ID) });
      } else if (msg.type === "CONNECT") sendResponse(await connect(msg.serverId));
      else if (msg.type === "DISCONNECT") sendResponse(await disconnect(msg.activateKill !== false));
      else if (msg.type === "RECONNECT") { const { state } = await getState(); await disconnect(false); sendResponse(await connect(msg.serverId || state.serverId)); }
      else if (msg.type === "SET_KILLSWITCH") {
        const { state } = await getState();
        const ns = { ...state, killSwitch: !!msg.enabled };
        await chrome.storage.local.set({ [STORAGE_KEYS.state]: ns });
        if (!ns.connected) { if (ns.killSwitch) { await applyKillSwitch(true); await setBadge(false, true); } else { await applyKillSwitch(false); await setBadge(false, false); } }
        sendResponse({ ok: true, state: ns });
      } else if (msg.type === "SET_FEATURE") {
        const { features, state, servers } = await getState();
        features[msg.key] = msg.value;
        await chrome.storage.local.set({ [STORAGE_KEYS.features]: features });
        await applyFeatures(features);
        if ((msg.key === "splitBypass") && state.connected) {
          const server = servers.find(s => s.id === state.serverId) || servers[0];
          await chrome.proxy.settings.set({ value: proxyConfigFor(server, features), scope: "regular" });
        }
        sendResponse({ ok: true, features });
      } else if (msg.type === "RESET_SESSION_USAGE") {
        const { usage } = await getState(); usage.session = 0;
        await chrome.storage.local.set({ [STORAGE_KEYS.usage]: usage });
        sendResponse({ ok: true });
      } else if (msg.type === "SAVE_CREDS") {
        const { creds } = await getState();
        creds[msg.serverId] = { username: msg.username, password: msg.password };
        await chrome.storage.local.set({ [STORAGE_KEYS.creds]: creds });
        sendResponse({ ok: true });
      } else if (msg.type === "ADD_SERVER") {
        const { servers } = await getState();
        const id = "srv_" + Date.now().toString(36);
        const srv = { id, name: msg.name || msg.host, host: msg.host, port: msg.port || 3128, scheme: "http", username: msg.username || "frontend", password: msg.password || "" };
        if (!srv.host) throw new Error("host required");
        servers.push(srv);
        await chrome.storage.local.set({ [STORAGE_KEYS.servers]: servers });
        sendResponse({ ok: true, server: srv });
      } else if (msg.type === "REMOVE_SERVER") {
        const { servers, state } = await getState();
        if (servers.length <= 1) throw new Error("cannot remove last server");
        const ns = servers.filter(s => s.id !== msg.serverId);
        await chrome.storage.local.set({ [STORAGE_KEYS.servers]: ns });
        if (state.serverId === msg.serverId) {
          if (state.connected) { await disconnect(false); await connect(ns[0].id); }
          else await chrome.storage.local.set({ [STORAGE_KEYS.state]: { ...state, serverId: ns[0].id } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === "EXPORT_CONFIG") {
        const { servers, features, state } = await getState();
        const auto = await chrome.storage.local.get("auto_connect");
        // Never export passwords / creds
        sendResponse({ ok: true, config: { app: "t35-vpn", version: 1, exportedAt: new Date().toISOString(), servers: servers.map(s => ({ name: s.name, host: s.host, port: s.port, username: s.username })), features, killSwitch: state.killSwitch, autoConnect: !!auto.auto_connect } });
      } else if (msg.type === "IMPORT_CONFIG") {
        const c = msg.config;
        if (!c || c.app !== "t35-vpn" || !Array.isArray(c.servers) || !c.servers.length) throw new Error("invalid backup file");
        if (c.servers.length > 20) throw new Error("too many servers (max 20)");
        const clean = c.servers.map((s, i) => ({
          id: "srv_imp" + Date.now().toString(36) + i,
          name: String(s.name || s.host).slice(0, 60),
          host: String(s.host || "").trim().slice(0, 253),
          port: Math.min(65535, Math.max(1, parseInt(s.port, 10) || 3128)),
          scheme: "http",
          username: String(s.username || "frontend").slice(0, 128),
          password: ""
        })).filter(s => s.host);
        if (!clean.length) throw new Error("no valid servers");
        const { state } = await getState();
        const wasConnected = state.connected;
        if (wasConnected) await disconnect(false);
        await chrome.storage.local.set({
          [STORAGE_KEYS.servers]: clean,
          [STORAGE_KEYS.state]: { connected: false, serverId: clean[0].id, killSwitch: c.killSwitch !== false },
          [STORAGE_KEYS.features]: { ...DEFAULT_FEATURES, ...(c.features || {}) }
        });
        if (c.autoConnect !== undefined) await chrome.storage.local.set({ auto_connect: !!c.autoConnect });
        await applyFeatures({ ...DEFAULT_FEATURES, ...(c.features || {}) });
        sendResponse({ ok: true, count: clean.length, note: "passwords not included — re-enter in Advanced" });
      } else sendResponse({ ok: false, error: "unknown message" });
    } catch (e) { sendResponse({ ok: false, error: String(e?.message || e) }); }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const { state, features } = await getState();
  await chrome.storage.local.set({ [STORAGE_KEYS.servers]: DEFAULT_SERVERS, [STORAGE_KEYS.state]: { connected: false, serverId: "server17", killSwitch: state.killSwitch ?? true }, [STORAGE_KEYS.features]: { ...DEFAULT_FEATURES, ...(features || {}) } });
  await applyKillSwitch(true); await applyFeatures({ ...DEFAULT_FEATURES, ...(features || {}) }); await setBadge(false, true);
});
chrome.runtime.onStartup.addListener(async () => {
  const auto = await chrome.storage.local.get("auto_connect");
  const { state, features } = await getState();
  await applyFeatures(features);
  if (auto.auto_connect) { try { await connect(state.serverId || "server17"); return; } catch (e) { console.warn(e); } }
  if (!state.connected && (state.killSwitch ?? true)) { await applyKillSwitch(true); await setBadge(false, true); }
  else if (!state.connected) await setBadge(false, false);
});
