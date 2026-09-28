const api = typeof browser !== "undefined" && browser.runtime ? browser : chrome;
const $ = (id) => document.getElementById(id);

const el = {
  dot: $("dot"),
  headline: $("headline"),
  subline: $("subline"),
  toggle: $("toggle"),
  toggleLabel: $("toggleLabel"),
  exitIp: $("exitIp"),
  latency: $("latency"),
  check: $("check"),
  banner: $("banner"),
  settings: $("settings"),
  saved: $("saved"),
  host: $("host"),
  port: $("port"),
  username: $("username"),
  password: $("password"),
  killSwitch: $("killSwitch"),
  engine: $("engine")
};

let state = null;
let busy = false;
let saveTimer = null;
let savedTimer = null;

function flashSaved() {
  el.saved.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.saved.hidden = true), 1200);
}

function render() {
  if (!state) return;

  // `active` is the browser's own answer, not our stored flag. Chrome releases
  // proxy control on extension reload, so `enabled` can be true while nothing
  // is actually being proxied. Trusting `enabled` here is what made a dead
  // proxy look like a working connection.
  const live = state.active === true;

  const busyClass = busy ? " busy" : "";
  el.dot.className = "dot" + (live ? " on" : state.killSwitch ? " kill" : "") + busyClass;

  if (live) {
    el.headline.textContent = "Connected";
    el.subline.textContent = `${state.host}:${state.port} · ${state.username || "no user"}`;
    el.toggleLabel.textContent = "Disconnect";
    el.toggle.classList.add("off");
  } else if (state.enabled) {
    el.headline.textContent = "Not connected";
    el.subline.textContent = "Proxy is not in effect — traffic is going direct";
    el.toggleLabel.textContent = "Reconnect";
    el.toggle.classList.remove("off");
  } else if (state.killSwitch) {
    el.headline.textContent = "Killed";
    el.subline.textContent = "All web traffic is blocked";
    el.toggleLabel.textContent = "Connect";
    el.toggle.classList.remove("off");
  } else {
    el.headline.textContent = "Disconnected";
    el.subline.textContent = "Traffic is going direct";
    el.toggleLabel.textContent = "Connect";
    el.toggle.classList.remove("off");
  }

  // Warnings, most important first. levelOfControl has four distinct values and
  // only one of them actually means "someone else owns it".
  let banner = "";
  let bad = false;
  if (state.level === "controlled_by_other_extensions") {
    banner = "Another extension controls the proxy. Traffic may bypass it.";
  } else if (state.level === "not_controllable") {
    banner = "This extension cannot control the proxy — a browser policy owns it.";
  } else if (state.enabled && !live) {
    banner = "The browser is not applying the proxy. Your traffic is NOT being hidden.";
  } else if (live && !state.password) {
    banner = "No password saved — the proxy will prompt you on every page.";
  } else if (!state.enabled && state.killSwitch) {
    banner = "Kill-switch is on. Nothing loads until you connect.";
    bad = true;
  }
  el.banner.textContent = banner;
  el.banner.hidden = !banner;
  el.banner.classList.toggle("bad", bad);

  el.engine.textContent = state.isFirefox ? "Firefox" : "Chromium";
}

function renderCheck(result) {
  if (!result) {
    el.exitIp.textContent = "—";
    el.latency.textContent = "—";
    return;
  }
  if (result.ok) {
    el.exitIp.textContent = result.ip;
    el.latency.textContent = result.ms + " ms";
  } else {
    el.exitIp.textContent = "Failed";
    el.latency.textContent = result.reason;
  }
}

function readFields() {
  const host = el.host.value.trim();
  const port = parseInt(el.port.value, 10);
  return {
    host,
    port: port >= 1 && port <= 65535 ? port : (state && state.port) || 3128,
    username: el.username.value.trim(),
    password: el.password.value,
    killSwitch: el.killSwitch.checked
  };
}

async function load() {
  state = await api.runtime.sendMessage({ type: "getState" });
  el.host.value = state.host;
  el.port.value = state.port;
  el.username.value = state.username;
  el.password.value = state.password;
  el.killSwitch.checked = state.killSwitch;
  render();
  if (state.lastCheck) renderCheck(state.lastCheck);
}

async function applyValues(extra) {
  const values = { ...readFields(), ...extra };
  if (!values.host) {
    el.banner.textContent = "Enter a server host first.";
    el.banner.hidden = false;
    return;
  }
  await api.runtime.sendMessage({ type: "save", values });
  flashSaved();
  await load();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => applyValues({}), 450);
}

function saveNow() {
  clearTimeout(saveTimer);
  applyValues({});
}

el.toggle.addEventListener("click", async () => {
  if (!state) return;
  const next = !state.enabled;

  // Nothing to authenticate with: help instead of failing on every page load.
  if (next && !state.password) {
    el.settings.open = true;
    el.password.focus();
    el.banner.textContent = "Add your proxy password to connect.";
    el.banner.hidden = false;
    el.banner.classList.remove("bad");
    return;
  }

  el.toggle.disabled = true;
  try {
    await applyValues({ enabled: next });
  } finally {
    el.toggle.disabled = false;
  }
});

el.check.addEventListener("click", async () => {
  busy = true;
  el.check.disabled = true;
  el.check.textContent = "Checking…";
  render();
  try {
    const result = await api.runtime.sendMessage({ type: "checkIP" });
    renderCheck(result);
    await api.storage.local.set({ lastCheck: result });
  } finally {
    busy = false;
    el.check.disabled = false;
    el.check.textContent = "Check connection";
    render();
  }
});

for (const input of [el.host, el.port, el.username, el.password]) {
  input.addEventListener("input", scheduleSave);
  input.addEventListener("change", saveNow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveNow();
    }
  });
}

el.killSwitch.addEventListener("change", saveNow);

load();
