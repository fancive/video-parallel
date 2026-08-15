import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest keeps host access and the side panel scoped to YouTube tabs", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version?: string;
  };
  const manifest = JSON.parse(await readFile("public/manifest.json", "utf8")) as {
    manifest_version?: number;
    version?: string;
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    side_panel?: { default_path?: string };
    commands?: Record<string, { suggested_key?: { default?: string } }>;
  };

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*"]);
  assert.ok(manifest.permissions?.includes("sidePanel"));
  assert.ok(manifest.optional_host_permissions?.includes("https://*/*"));
  assert.ok(!manifest.host_permissions?.includes("<all_urls>"));
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.commands?.["toggle-side-panel"]?.suggested_key?.default, "Alt+Shift+P");
  assert.equal(manifest.commands?.["process-video"]?.suggested_key?.default, "Alt+Shift+S");
});
