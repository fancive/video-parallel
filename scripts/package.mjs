import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseDir = resolve(root, "release");
const manifest = JSON.parse(await readFile(resolve(root, "public/manifest.json"), "utf8"));
const archive = resolve(releaseDir, `video-parallel-v${manifest.version}.zip`);

await mkdir(releaseDir, { recursive: true });
await rm(archive, { force: true });

const result = spawnSync("zip", ["-qr", archive, "."], {
  cwd: resolve(root, "dist"),
  stdio: "inherit",
});

if (result.status !== 0) {
  throw new Error("Could not create release archive with zip.");
}

console.log(`Created ${archive}`);
