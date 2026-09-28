const api = typeof browser !== "undefined" && browser.runtime ? browser : chrome;
const $ = (id) => document.getElementById(id);

function setStatus(s) {
  const el = $("status");
  if (s.enabled) {
    if (s.level && s.level !== "controlled_by_this_extension") {
      el.className = "status warn";
      el.textContent = "On, but another app owns the proxy: " + s.level.replace(/_/g, " ");
      return;
    }
    if (!s.password) {
      el.className = "status warn";
      el.textContent = "On, but no password saved - the proxy will ask";
      return;
    }
    el.className = "status on";
    el.textContent = "Connected via " + s.host + ":" + s.port + " as " + s.username;
    return;
  }
  if (s.killSwitch) {
    el.className = "status kill";
    el.textContent = "Killed - all web traffic is blocked until you connect";
    return;
  }
  el.className = "status off";
  el.textContent = "Off - traffic is going direct";
}

async function load() {
  const s = await api.runtime.sendMessage({ type: "getState" });
  $("engine").textContent = s.isFirefox ? "Firefox" : "Chromium";
  $("enabled").checked = s.enabled;
  $("killSwitch").checked = s.killSwitch;
  $("host").value = s.host;
  $("port").value = s.port;
  $("username").value = s.username;
  $("password").value = s.password;
  setStatus(s);
}

async function save() {
  const host = $("host").value.trim();
  const port = parseInt($("port").value, 10);
  if (!host || !port || port < 1 || port > 65535) {
    $("out").textContent = "Enter a valid host and port.";
    return;
  }
  await api.runtime.sendMessage({
    type: "save",
    values: {
      enabled: $("enabled").checked,
      killSwitch: $("killSwitch").checked,
      host,
      port,
      username: $("username").value.trim(),
      password: $("password").value
    }
  });
  $("out").textContent = "Saved.";
  load();
}

$("save").addEventListener("click", save);
$("enabled").addEventListener("change", save);
$("killSwitch").addEventListener("change", save);

$("check").addEventListener("click", async () => {
  $("out").textContent = "Checking...";
  const r = await api.runtime.sendMessage({ type: "checkIP" });
  $("out").innerHTML = r.ok
    ? "Exit IP: <span class='ip'>" + r.ip + "</span> (" + r.ms + " ms)"
    : "Failed: " + r.reason + (r.detail ? " - " + r.detail : "");
});

load();
