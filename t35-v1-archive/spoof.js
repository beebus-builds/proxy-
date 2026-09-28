// spoof.js — runs at document_start. Fakes geolocation when enabled.
(async () => {
  try {
    const d = await chrome.storage.local.get("vpn_features");
    const f = d.vpn_features || {};
    if (!f.geoSpoof) return;
    // Frankfurt coords near server17 (generic EU). 
    const FAKE = { latitude: 50.1109, longitude: 8.6821, accuracy: 1200 };
    const wrap = (orig) => function (success, error, opts) {
      if (typeof success === "function") {
        success({ coords: { ...FAKE, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
        return;
      }
      return orig?.apply(this, arguments);
    };
    if (navigator.geolocation) {
      try {
        Object.defineProperty(navigator.geolocation, "getCurrentPosition", { value: wrap(navigator.geolocation.getCurrentPosition), configurable: true });
        Object.defineProperty(navigator.geolocation, "watchPosition", { value: (s) => { s?.({ coords: { ...FAKE, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() }); return 1; }, configurable: true });
      } catch {}
    }
  } catch {}
})();
