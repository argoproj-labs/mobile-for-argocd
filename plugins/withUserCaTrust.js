// Trust user-installed CA certificates on Android.
//
// Since Android 7 (API 24) apps trust only system CAs unless they opt in with a
// network security config. Without this, an Argo CD server whose certificate
// chains to a private CA fails the TLS handshake even when the user has
// installed that CA on the device. iOS already trusts CAs the user installs
// and enables as a profile, so this brings Android in line.
//
// Cleartext stays as before: off in release (the default for targetSdk >= 28),
// on in the debug variants so Metro keeps working. A network security config
// overrides android:usesCleartextTraffic, so the debug source sets get their
// own copy that permits it.
const {
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const RESOURCE = "network_security_config";

const xml = (cleartext) => `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="${cleartext}">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

const SOURCE_SETS = {
  main: false,
  debug: true,
  debugOptimized: true,
};

function withUserCaTrust(config) {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const src = path.join(cfg.modRequest.platformProjectRoot, "app/src");
      for (const [set, cleartext] of Object.entries(SOURCE_SETS)) {
        // Only write into source sets the template generated (main always is).
        if (set !== "main" && !fs.existsSync(path.join(src, set))) continue;
        const dir = path.join(src, set, "res/xml");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${RESOURCE}.xml`), xml(cleartext));
      }
      return cfg;
    },
  ]);

  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults,
    );
    app.$["android:networkSecurityConfig"] = `@xml/${RESOURCE}`;
    return cfg;
  });
}

module.exports = withUserCaTrust;
