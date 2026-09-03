import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest keeps host access and the content script scoped to supported video sites", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version?: string;
  };
  const manifest = JSON.parse(await readFile("public/manifest.json", "utf8")) as {
    manifest_version?: number;
    version?: string;
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    content_scripts?: Array<{ matches?: string[] }>;
    side_panel?: { default_path?: string };
    commands?: Record<string, { suggested_key?: { default?: string } }>;
  };

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  const supportedVideoSites = ["https://www.youtube.com/*", "https://www.bilibili.com/*"];
  assert.deepEqual(manifest.host_permissions, supportedVideoSites);
  assert.deepEqual(
    manifest.content_scripts?.map(({ matches }) => matches),
    [supportedVideoSites],
  );
  assert.ok(manifest.permissions?.includes("sidePanel"));
  assert.ok(manifest.optional_host_permissions?.includes("https://*/*"));
  assert.ok(!manifest.host_permissions?.includes("<all_urls>"));
  assert.ok(!manifest.host_permissions?.some((host) => /api\.bilibili\.com|hdslb\.com/.test(host)));
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.commands?.["toggle-side-panel"], undefined);
  assert.equal(manifest.commands?._execute_action?.suggested_key?.default, "Alt+Shift+P");
  assert.equal(
    (manifest.commands?._execute_action?.suggested_key as { mac?: string } | undefined)?.mac,
    "Option+Shift+9",
  );
  assert.equal(manifest.commands?.["process-video"]?.suggested_key?.default, "Alt+Shift+S");
});
