import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [
    resolve(root, "src/background.ts"),
    resolve(root, "src/content.ts"),
    resolve(root, "src/sidepanel.ts"),
    resolve(root, "src/options.ts"),
  ],
  outdir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  sourcemap: false,
  minify: false,
  legalComments: "none",
});

await cp(resolve(root, "public"), outdir, { recursive: true });
console.log(`Built extension in ${outdir}`);
